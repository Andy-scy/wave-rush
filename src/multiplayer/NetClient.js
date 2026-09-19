// NetClient —— 浏览器端联机客户端（零依赖，连接 ws://<host>/ws）
// 用法：const net = new NetClient(); net.connect();
//       赋值回调 onStatus/onPlayers/onStart/onState/onRank/onOver/onError 后由主程序桥接。
// 协议（c→s）：create / join / leave / start / s(15Hz 节流) / cp / ping / end
// 协议（s→c）：ok / created / joined / players / start / s / rank / over / error / left / pong
export class NetClient {
  constructor() {
    this.status = 'off';        // 'off' | 'connecting' | 'on'
    this.inRoom = false;
    this.myId = null;
    this.roomCode = null;
    this.players = [];          // [{id, name, ci, host}]
    this.isHost = false;        // 便捷字段（由 players 派生）
    this.laps = 0;              // 最近一次 start 的圈数
    this.t0 = 0;                // 最近一次 start 的开赛时刻（Date.now() 基准）

    // ---- 回调属性（主程序赋值） ----
    this.onStatus = null;       // (status)
    this.onPlayers = null;      // (players)
    this.onStart = null;        // ({laps, t0})
    this.onState = null;        // (id, d) —— d 为 {t:'s',id,p,r,v,b,bo,cp,lap,fin}
    this.onRank = null;         // (order) —— [{id, lap, cp, fin}]
    this.onOver = null;         // (order) —— [{id, time}]
    this.onError = null;        // (msg)
    // 附加回调：房间创建/加入成功（便于 UI 展示房间码）
    this.onCreated = null;      // (code, id)
    this.onJoined = null;       // (code, id, players)

    this._ws = null;
    this._lastStateAt = -1e9;
    this._beforeunload = () => { this.leaveRoom(); this.disconnect(); };
    if (typeof window !== 'undefined') window.addEventListener('beforeunload', this._beforeunload);
  }

  // ---------- 连接 ----------
  connect() {
    if (this.status === 'connecting' || this.status === 'on') return this.status;
    const proto = typeof location !== 'undefined' ? location.protocol : '';
    if (proto !== 'http:' && proto !== 'https:') { // file:// 等环境直接离线
      this._setStatus('off');
      return this.status;
    }
    this._setStatus('connecting');
    let ws;
    try {
      ws = new WebSocket('ws://' + location.host + '/ws');
    } catch {
      this._setStatus('off');
      return this.status;
    }
    this._ws = ws;
    const timer = setTimeout(() => { // 3s 连接超时 → off
      if (this._ws === ws && this.status === 'connecting') {
        try { ws.close(); } catch { /* ignore */ }
        if (this._ws === ws) this._ws = null;
        this._setStatus('off');
      }
    }, 3000);
    ws.onopen = () => {
      if (this._ws !== ws) return;
      clearTimeout(timer);
      this._setStatus('on');
    };
    ws.onmessage = (ev) => this._onMessage(ev.data);
    ws.onclose = () => {
      clearTimeout(timer);
      if (this._ws === ws) this._ws = null;
      this._resetRoom();
      this._setStatus('off');
    };
    ws.onerror = () => { /* onclose 会紧随其后统一处理 */ };
    return this.status;
  }

  disconnect() {
    if (this._ws) {
      try { this._ws.close(); } catch { /* ignore */ }
      this._ws = null;
    }
    this._resetRoom();
    this._setStatus('off');
  }

  // ---------- 房间 ----------
  createRoom(name, ci) {
    if (!this._ready()) return;
    this._send({ t: 'create', name, ci });
  }

  joinRoom(code, name, ci) {
    if (!this._ready()) return;
    this._send({ t: 'join', code: String(code ?? '').trim().toUpperCase(), name, ci });
  }

  leaveRoom() {
    if (this.inRoom && this._ready()) this._send({ t: 'leave' });
    this._resetRoom();
  }

  hostStart(laps) {
    if (!this._ready()) return;
    this._send({ t: 'start', laps });
  }

  // ---------- 同步 ----------
  // 15Hz 节流；从 ski 读 pos/yaw/speed/boostMeter/boosting/cpIndex/lap/finished/finishTime
  sendState(ski) {
    if (!this.inRoom || !this._ready() || !ski) return;
    const now = performance.now();
    if (now - this._lastStateAt < 66) return; // ~15Hz（≤20Hz）
    this._lastStateAt = now;
    const p = ski.pos;
    const num = (v, f = 2) => (Number.isFinite(v) ? +v.toFixed(f) : 0);
    this._send({
      t: 's',
      p: [num(p.x), num(p.y), num(p.z)],
      r: num(ski.yaw, 3),
      v: num(ski.speed),
      b: num(ski.boostMeter),
      bo: ski.boosting ? 1 : 0,
      cp: ski.cpIndex | 0,
      lap: ski.lap | 0,
      fin: ski.finished ? (ski.finishTime || 1) : 0,
    });
  }

  // 通过检查点时上报（服务端权威进度来源）
  sendCp(i) {
    if (!this.inRoom || !this._ready()) return;
    this._send({ t: 'cp', i: i | 0 });
  }

  // host：全员完赛（或提前结束）触发
  sendEnd() {
    if (!this.inRoom || !this._ready()) return;
    this._send({ t: 'end' });
  }

  // ---------- 内部 ----------
  _ready() {
    return !!this._ws && this._ws.readyState === WebSocket.OPEN;
  }

  _send(obj) {
    if (!this._ready()) return;
    try { this._ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
  }

  _setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    if (this.onStatus) this.onStatus(s);
  }

  _resetRoom() {
    this.inRoom = false;
    this.myId = null;
    this.roomCode = null;
    this.players = [];
    this.isHost = false;
    this.laps = 0;
    this.t0 = 0;
  }

  _syncHost() {
    const me = this.players.find((p) => p.id === this.myId);
    this.isHost = !!(me && me.host);
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'ok': break; // 连接确认（status 已在 onopen 置 on）
      case 'created':
        this.inRoom = true;
        this.myId = msg.id;
        this.roomCode = msg.code;
        if (this.onCreated) this.onCreated(msg.code, msg.id);
        break;
      case 'joined':
        this.inRoom = true;
        this.myId = msg.id;
        this.roomCode = msg.code;
        this.players = Array.isArray(msg.players) ? msg.players : [];
        this._syncHost();
        if (this.onJoined) this.onJoined(msg.code, msg.id, this.players);
        break;
      case 'players':
        this.players = Array.isArray(msg.players) ? msg.players : [];
        this._syncHost();
        if (this.onPlayers) this.onPlayers(this.players);
        break;
      case 'start':
        this.inRoom = true;
        this.laps = msg.laps | 0;
        this.t0 = msg.t0 || 0;
        if (this.onStart) this.onStart({ laps: this.laps, t0: this.t0 });
        break;
      case 's':
        if (this.onState) this.onState(msg.id, msg);
        break;
      case 'rank':
        if (this.onRank) this.onRank(msg.order || []);
        break;
      case 'over':
        if (this.onOver) this.onOver(msg.order || []);
        break;
      case 'left':
        this._resetRoom();
        if (this.onPlayers) this.onPlayers(this.players);
        break;
      case 'error':
        if (msg.msg === 'host left') { // 房间已解散 → 回大厅
          this._resetRoom();
          if (this.onPlayers) this.onPlayers(this.players);
        }
        if (this.onError) this.onError(msg.msg || 'unknown error');
        break;
      case 'pong': break;
      default: break;
    }
  }
}
