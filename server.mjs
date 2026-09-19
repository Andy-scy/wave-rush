// WAVE RUSH —— 局域网联机服务器（零 npm 依赖，仅 Node 内置模块）
// 功能：HTTP 静态文件服务 + 同端口 WebSocket（手写 RFC6455）+ 房间 / 服务端权威竞速逻辑
// 启动：node server.mjs    （环境变量 PORT，默认 8080，监听 0.0.0.0）
import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRACK } from './src/game/Track.js';

// ---------- 常量 ----------
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = (() => {
  const n = parseInt(process.env.PORT, 10);
  return Number.isFinite(n) && n > 0 ? n : 8080;
})();
const CP_COUNT = TRACK.length;                                    // 检查点数量（含起点/终点线 = 9）
const ROOM_CAP = 8;                                               // 每房间人数上限
const ROOM_CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';       // 5 位房间码字符集（去掉 0/O/1/I）
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';           // RFC6455 握手 GUID
const HEARTBEAT_MS = 30000;                                       // ping 间隔 30s
const HEARTBEAT_MAX_MISS = 2;                                     // 连续 2 次无 pong（≈60s）断开
const MAX_MSG_BYTES = 1 << 20;                                    // 单帧上限 1MB
const COUNTDOWN_MS = 3500;                                        // 开赛倒计时

const MIME = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  md: 'text/markdown; charset=utf-8',
  map: 'application/json; charset=utf-8',
  wasm: 'application/wasm',
  ttf: 'font/ttf',
};

// ---------- HTTP 静态文件服务 ----------
function sendText(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(reqIsHead(res.req) ? undefined : body);
}
function reqIsHead(req) { return !!req && req.method === 'HEAD'; }

async function serveStatic(req, res) {
  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return sendText(res, 400, '400 Bad Request');
  }
  if (pathname === '/') pathname = '/index.html';

  // 路径穿越防护：normalize 后必须仍在 ROOT 内
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return sendText(res, 403, '403 Forbidden');
  }

  let file = filePath;
  let stat = await fs.promises.stat(file).catch(() => null);
  if (stat && stat.isDirectory()) {
    file = path.join(file, 'index.html');
    stat = await fs.promises.stat(file).catch(() => null);
  }
  if (!stat || !stat.isFile()) return sendText(res, 404, '404 Not Found');

  try {
    const data = await fs.promises.readFile(file);
    const ext = path.extname(file).slice(1).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Length': data.length,
    });
    res.end(reqIsHead(req) ? undefined : data);
  } catch {
    sendText(res, 500, '500 Internal Server Error');
  }
}

// ---------- WebSocket（手写 RFC6455） ----------
const conns = new Set();   // 所有活跃连接
const rooms = new Map();   // code -> room
let nextPlayerId = 1;

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode; // FIN=1，服务端发送不掩码
  return Buffer.concat([header, payload]);
}

function sendFrame(conn, opcode, payload) {
  if (conn.closed || !conn.socket || conn.socket.destroyed || !conn.socket.writable) return;
  try { conn.socket.write(encodeFrame(opcode, payload)); } catch { /* 忽略写失败，close 事件兜底 */ }
}

function wsSend(conn, obj) {
  sendFrame(conn, 0x1, Buffer.from(JSON.stringify(obj), 'utf8'));
}

function wsSendRoom(room, obj, exceptConn) {
  for (const p of room.players.values()) {
    if (p.ws && p.ws !== exceptConn) wsSend(p.ws, obj);
  }
}

function parseFrames(conn) {
  const buf = conn.buf;
  let off = 0;
  while (!conn.closed) {
    if (buf.length - off < 2) break;
    const b0 = buf[off];
    const b1 = buf[off + 1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let head = 2;
    if (len === 126) {
      if (buf.length - off < 4) break;
      len = buf.readUInt16BE(off + 2);
      head = 4;
    } else if (len === 127) {
      if (buf.length - off < 10) break;
      const big = buf.readBigUInt64BE(off + 2);
      if (big > BigInt(MAX_MSG_BYTES)) { destroyConn(conn); return; }
      len = Number(big);
      head = 10;
    }
    if (len > MAX_MSG_BYTES) { destroyConn(conn); return; }
    let maskKey = null;
    if (masked) {
      if (buf.length - off < head + 4) break;
      maskKey = buf.subarray(off + head, off + head + 4);
      head += 4;
    }
    if (buf.length - off < head + len) break;

    let payload = buf.subarray(off + head, off + head + len);
    if (maskKey) { // 客户端帧必带掩码，剥离
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i & 3];
    }
    off += head + len;
    handleFrame(conn, fin, opcode, payload);
  }
  conn.buf = off >= buf.length ? Buffer.alloc(0) : buf.subarray(off);
}

function handleFrame(conn, fin, opcode, payload) {
  switch (opcode) {
    case 0x1: // 文本帧
    case 0x0: { // continuation：简单拼接分片
      if (opcode === 0x1 && fin) {
        conn.frags.length = 0;
        conn.fragLen = 0;
        deliver(conn, payload);
        return;
      }
      if (opcode === 0x1) { conn.frags = [payload]; conn.fragLen = payload.length; }
      else { conn.frags.push(payload); conn.fragLen += payload.length; }
      if (conn.fragLen > MAX_MSG_BYTES) {
        conn.frags.length = 0; conn.fragLen = 0;
        destroyConn(conn);
        return;
      }
      if (fin) {
        const full = Buffer.concat(conn.frags);
        conn.frags.length = 0; conn.fragLen = 0;
        deliver(conn, full);
      }
      return;
    }
    case 0x2: return; // 二进制帧：忽略
    case 0x8: { // close：回 应答码 后关闭
      const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
      const out = Buffer.alloc(2);
      out.writeUInt16BE(code >= 1000 && code <= 4999 ? code : 1000, 0);
      sendFrame(conn, 0x8, out);
      try { conn.socket.end(); } catch { destroyConn(conn); }
      return;
    }
    case 0x9: sendFrame(conn, 0xA, payload); return; // ping → pong（原样回 payload）
    case 0xA: conn.alive = true; conn.miss = 0; return; // pong → 心跳存活
    default: return;
  }
}

function deliver(conn, payload) {
  let msg;
  try { msg = JSON.parse(payload.toString('utf8')); } catch { return; } // 非 JSON 文本忽略
  if (!msg || typeof msg !== 'object') return;
  handleMessage(conn, msg);
}

// ---------- 房间 / 玩家 ----------
function freshRace() { return { lastCp: 0, lapsDone: 0, lap: 1, fin: 0, finishTime: 0 }; }

function cleanName(v) {
  const s = String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim();
  return (s || 'PLAYER').slice(0, 12);
}
function cleanCi(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(255, n)) : 0;
}
function makeRoomCode() {
  let code = '';
  for (let i = 0; i < 5; i++) code += ROOM_CODE_CHARS[crypto.randomInt(ROOM_CODE_CHARS.length)];
  return code;
}
function makePlayer(conn, room, msg, host) {
  const player = {
    id: 'p' + (nextPlayerId++).toString(36),
    name: cleanName(msg.name),
    ci: cleanCi(msg.ci),
    host: !!host,
    ws: conn,
    room,
    race: freshRace(),
  };
  conn.player = player;
  room.players.set(player.id, player);
  return player;
}
function roster(room) {
  return [...room.players.values()].map((p) => ({ id: p.id, name: p.name, ci: p.ci, host: p.host }));
}
function broadcastPlayers(room) {
  wsSendRoom(room, { t: 'players', players: roster(room) });
}
function dissolveRoom(room) {
  rooms.delete(room.code);
  for (const p of room.players.values()) {
    if (p.ws && p.ws.player === p) p.ws.player = null;
  }
  room.players.clear();
}

// 移除玩家：非 host → 广播名单；host → 广播 'host left' 并解散房间
function removePlayer(player) {
  const room = player.room;
  room.players.delete(player.id);
  if (player.ws && player.ws.player === player) player.ws.player = null;
  if (room.players.size === 0) { rooms.delete(room.code); return; }
  if (player.host) {
    for (const other of room.players.values()) wsSend(other.ws, { t: 'error', msg: 'host left' });
    dissolveRoom(room);
  } else {
    broadcastPlayers(room);
  }
}

// ---------- 服务端权威竞速 ----------
function sortRacers(room) {
  return [...room.players.values()].sort((a, b) => {
    const ra = a.race, rb = b.race;
    if (ra.fin && rb.fin) return ra.finishTime - rb.finishTime;
    if (ra.fin) return -1;
    if (rb.fin) return 1;
    return (rb.lapsDone * CP_COUNT + rb.lastCp) - (ra.lapsDone * CP_COUNT + ra.lastCp);
  });
}
function rankOrder(room) {
  return sortRacers(room).map((p) => ({ id: p.id, lap: p.race.lap, cp: p.race.lastCp, fin: p.race.fin }));
}
function finishRoom(room) {
  room.state = 'over';
  const order = sortRacers(room).map((p) => ({ id: p.id, time: p.race.finishTime || 0 }));
  wsSendRoom(room, { t: 'over', order });
}
function checkRaceOver(room) {
  if (room.state !== 'racing') return;
  for (const p of room.players.values()) if (!p.race.fin) return;
  finishRoom(room); // 全员完赛
}

// ---------- 消息分发 ----------
function handleMessage(conn, msg) {
  switch (msg.t) {
    case 'ping': wsSend(conn, { t: 'pong' }); return;
    case 'create': handleCreate(conn, msg); return;
    case 'join': handleJoin(conn, msg); return;
    case 'leave': handleLeave(conn); return;
    default: break;
  }
  // 以下消息要求已加入房间
  const player = conn.player;
  if (!player) return;
  const room = player.room;
  switch (msg.t) {
    case 'start': handleStart(player, room, msg); return;
    case 's': relayState(player, room, msg); return;
    case 'cp': handleCp(player, room, msg); return;
    case 'end': handleEnd(player, room); return;
    default: return;
  }
}

function handleCreate(conn, msg) {
  if (conn.player) { wsSend(conn, { t: 'error', msg: 'already in room' }); return; }
  let code;
  do { code = makeRoomCode(); } while (rooms.has(code));
  const room = { code, players: new Map(), state: 'lobby', laps: 3 };
  rooms.set(code, room);
  const player = makePlayer(conn, room, msg, true);
  wsSend(conn, { t: 'created', code: room.code, id: player.id });
  broadcastPlayers(room);
}

function handleJoin(conn, msg) {
  if (conn.player) { wsSend(conn, { t: 'error', msg: 'already in room' }); return; }
  const code = String(msg.code ?? '').trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) { wsSend(conn, { t: 'error', msg: 'room not found' }); return; }
  if (room.players.size >= ROOM_CAP) { wsSend(conn, { t: 'error', msg: 'room full' }); return; }
  if (room.state === 'racing') { wsSend(conn, { t: 'error', msg: 'race started' }); return; }
  const player = makePlayer(conn, room, msg, false);
  wsSend(conn, { t: 'joined', code: room.code, id: player.id, players: roster(room) });
  broadcastPlayers(room);
}

function handleLeave(conn) {
  const player = conn.player;
  if (player) removePlayer(player);
  wsSend(conn, { t: 'left' });
}

function handleStart(player, room, msg) {
  if (!player.host) { wsSend(player.ws, { t: 'error', msg: 'only host can start' }); return; }
  if (room.state === 'racing') return;
  const laps = parseInt(msg.laps, 10);
  room.laps = Number.isFinite(laps) ? Math.max(1, Math.min(20, laps)) : 3;
  room.state = 'racing';
  for (const p of room.players.values()) p.race = freshRace();
  wsSendRoom(room, { t: 'start', laps: room.laps, t0: Date.now() + COUNTDOWN_MS });
}

// {t:'s'} 状态原样转发（附加 id），不参与权威进度
function relayState(player, room, msg) {
  const out = { ...msg, t: 's', id: player.id };
  wsSendRoom(room, out, player.ws);
}

// {t:'cp', i}：服务端唯一信任的进度来源；cp 必须等于 expected=last+1 mod 轨道长，非法忽略
function handleCp(player, room, msg) {
  if (room.state !== 'racing') return;
  const i = parseInt(msg.i, 10);
  if (!Number.isInteger(i) || i < 0 || i >= CP_COUNT) return;
  const r = player.race;
  const expected = (r.lastCp + 1) % CP_COUNT;
  if (i !== expected) return;
  r.lastCp = i;
  if (i === 0) { // 回绕到起点/终点线：完成一圈
    r.lapsDone++;
    if (r.lapsDone >= room.laps) {
      if (!r.fin) { r.finishTime = Date.now(); r.fin = r.finishTime; } // 完赛判定
      r.lap = room.laps;
    } else {
      r.lap = r.lapsDone + 1;
    }
  }
  wsSendRoom(room, { t: 'rank', order: rankOrder(room) });
  checkRaceOver(room);
}

function handleEnd(player, room) {
  if (!player.host) { wsSend(player.ws, { t: 'error', msg: 'only host can end' }); return; }
  if (room.state !== 'racing') return;
  finishRoom(room);
}

// ---------- 连接生命周期 ----------
function destroyConn(conn) {
  if (conn.closed) return;
  conn.closed = true;
  try { conn.socket.destroy(); } catch { /* 已销毁 */ }
  dropConn(conn);
}

function dropConn(conn) {
  if (conn.dropped) return;
  conn.dropped = true;
  conn.closed = true;
  conns.delete(conn);
  const player = conn.player;
  if (player) {
    conn.player = null;
    player.ws = null;
    removePlayer(player); // 断开：广播名单 / host 离开解散
  }
}

const server = http.createServer((req, res) => {
  serveStatic(req, res).catch(() => sendText(res, 500, '500 Internal Server Error'));
});

server.on('upgrade', (req, socket) => {
  let pathname = '';
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { /* 按 /ws 之外处理 */ }
  const key = req.headers['sec-websocket-key'];
  const isWs = String(req.headers.upgrade || '').toLowerCase() === 'websocket';
  if (pathname !== '/ws' || !key || !isWs) {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  // RFC6455 握手：Sec-WebSocket-Accept = base64(sha1(key + GUID))
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n' +
    '\r\n'
  );
  socket.setNoDelay(true);

  const conn = {
    socket,
    buf: Buffer.alloc(0),
    frags: [],
    fragLen: 0,
    alive: true,   // pong / 新活动置 true
    miss: 0,       // 连续无 pong 次数
    player: null,
    closed: false,
    dropped: false,
  };
  conns.add(conn);
  socket.on('data', (chunk) => {
    if (conn.closed) return;
    conn.buf = Buffer.concat([conn.buf, chunk]);
    if (conn.buf.length > MAX_MSG_BYTES * 2) { destroyConn(conn); return; }
    parseFrames(conn);
  });
  socket.on('close', () => dropConn(conn));
  socket.on('error', () => dropConn(conn));

  wsSend(conn, { t: 'ok' }); // 连接确认
});

// 心跳：每 30s ping 一次，连续 2 次（≈60s）无 pong 断开
setInterval(() => {
  for (const conn of conns) {
    if (conn.closed) continue;
    if (!conn.alive) {
      conn.miss++;
      if (conn.miss >= HEARTBEAT_MAX_MISS) { destroyConn(conn); continue; }
    } else {
      conn.miss = 0;
    }
    conn.alive = false;
    sendFrame(conn, 0x9, Buffer.alloc(0));
  }
}, HEARTBEAT_MS).unref();

server.on('error', (err) => {
  console.error('[wave-rush] 服务器错误:', err.message);
  process.exitCode = 1;
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = [];
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const ni of list || []) {
      if (!ni.internal && ni.family === 'IPv4') ips.push(ni.address);
    }
  }
  console.log('==========================================');
  console.log('  WAVE RUSH 局域网服务器已启动');
  console.log('==========================================');
  console.log('  本机:      http://localhost:' + PORT);
  for (const ip of ips) console.log('  局域网:    打开 http://' + ip + ':' + PORT);
  console.log('  WebSocket: ws://<本机IP>:' + PORT + '/ws');
  console.log('  检查点数: ' + CP_COUNT + '  房间上限: ' + ROOM_CAP + ' 人');
});
