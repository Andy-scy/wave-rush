// RemotePlayer —— 远程玩家：持有对方摩托艇模型，对网络快照做插值渲染
// 快照流：NetClient.onState(id, d) → 主程序桥接 → rp.applyState(d)
// 排名流：NetClient.onRank(order)   → 主程序桥接 → rp.applyRank(order[i], i + 1)
import * as THREE from 'three';
import { buildJetSki, RIDER_PRESETS } from '../game/JetSki.js';
import { oceanHeight } from '../game/WaveMath.js';
import { TRACK } from '../game/Track.js';

const CP_COUNT = TRACK.length;    // 检查点数（含起点/终点线）
const INTERP_DELAY_MS = 120;      // 目标渲染时间 = now - 120ms
const MAX_EXTRAP_S = 0.25;        // 断流外推上限 250ms
const MAX_BUFFER = 20;            // 快照缓冲上限，超出丢最旧

// 最短角插值
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class RemotePlayer {
  // game: 含 .scene 的游戏对象（或直接传 Scene）；info: {id, name, ci}
  constructor(game, info) {
    this.game = game;
    this.id = info && info.id != null ? info.id : null;
    this.name = String((info && info.name) || 'RIDER');
    this.ci = Math.max(0, (info && info.ci) | 0);
    this.isPlayer = false;

    const preset = { ...RIDER_PRESETS[this.ci % RIDER_PRESETS.length] };
    preset.name = this.name; // 用远程玩家名替换预设名（号码贴纸随之更新）
    const built = buildJetSki(preset);
    this.group = built.group;
    this.rider = built.rider;
    this.bodyMesh = built.bodyMesh;
    this.group.rotation.order = 'YXZ';

    // 尾焰（buildJetSki 返回值不含 flame，这里按 Player 同款自建）
    this.flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.15, 0.8, 10),
      new THREE.MeshBasicMaterial({
        color: '#7fe0ff', transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, toneMapped: false, depthWrite: false,
      })
    );
    this.flame.geometry.rotateX(-Math.PI / 2);
    this.flame.position.set(0, 0.14, -2.0);
    this.flame.visible = false;
    this.group.add(this.flame);

    // ---- 竞速同步字段（由 NetClient onState/onRank 更新，主程序桥接） ----
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.boostMeter = 0;
    this.boosting = false;
    this.lap = 1;
    this.cpIndex = 0;
    this.progress = 0;
    this.rank = 0;
    this.finished = false;
    this.finishTime = 0;
    this.bestLap = Infinity;

    // ---- 插值缓冲 ----
    this._buf = []; // [{rt, p:[x,y,z], r, v, bm, bo}]

    this._scene = game && game.scene ? game.scene : game;
    if (this._scene && this._scene.add) this._scene.add(this.group);
    this.group.position.set(0, oceanHeight(0, 0, 0), 0);
  }

  // 快照入缓冲（≤20 帧，超出丢最旧），并同步 cp/lap/fin 显示字段
  applyState(d) {
    if (!d || !Array.isArray(d.p) || d.p.length < 3 || !d.p.every(Number.isFinite)) return;
    const snap = {
      rt: performance.now(),
      p: [d.p[0], d.p[1], d.p[2]],
      r: Number.isFinite(d.r) ? d.r : this.yaw,
      v: Number.isFinite(d.v) ? d.v : 0,
      bm: Number.isFinite(d.b) ? d.b : 0,
      bo: !!d.bo,
    };
    this._buf.push(snap);
    if (this._buf.length > MAX_BUFFER) this._buf.shift();

    // {t:'s'} 中的 cp/lap/fin 为显示值（权威进度以 rank 为准）
    if (Number.isFinite(d.cp)) this.cpIndex = d.cp | 0;
    if (Number.isFinite(d.lap)) this.lap = Math.max(1, d.lap | 0);
    if (d.fin) { // fin 只置位不复位（完赛为单向锁存，重启用 resetRace）
      this.finished = true;
      this.finishTime = d.fin;
    }
    this.progress = (this.lap - 1) * CP_COUNT + this.cpIndex;
  }

  // 服务端权威排名（NetClient.onRank 桥接）：entry = order 中的 {id, lap, cp, fin}
  applyRank(entry, rank) {
    if (!entry) return;
    if (Number.isFinite(rank)) this.rank = rank;
    if (Number.isFinite(entry.lap)) this.lap = Math.max(1, entry.lap | 0);
    if (Number.isFinite(entry.cp)) this.cpIndex = entry.cp | 0;
    if (entry.fin) {
      this.finished = true;
      this.finishTime = entry.fin;
    }
    this.progress = (this.lap - 1) * CP_COUNT + this.cpIndex;
  }

  // 新一局开赛：清空缓冲与竞速字段（主程序在 onStart 时对每个远程玩家调用）
  resetRace() {
    this.lap = 1;
    this.cpIndex = 0;
    this.progress = 0;
    this.rank = 0;
    this.finished = false;
    this.finishTime = 0;
    this.bestLap = Infinity;
    this._buf.length = 0;
  }

  // dt: 秒；t: 渲染时间（秒，与 oceanHeight 相位一致）
  update(dt, t) {
    const target = performance.now() - INTERP_DELAY_MS;
    const buf = this._buf;
    let px = this.pos.x, py = this.pos.y, pz = this.pos.z;
    let yw = this.yaw, v = this.speed, bm = this.boostMeter, bo = this.boosting;

    if (buf.length === 0) {
      // 无数据：静止浮在浪面
      py = oceanHeight(px, pz, t);
      bo = false;
    } else if (buf.length === 1) {
      const s = buf[0];
      px = s.p[0]; py = s.p[1]; pz = s.p[2];
      yw = s.r; v = s.v; bm = s.bm; bo = s.bo;
      if (target > s.rt) { // 单帧也允许有限外推
        const ex = Math.min((target - s.rt) / 1000, MAX_EXTRAP_S);
        px += Math.sin(yw) * v * ex;
        pz += Math.cos(yw) * v * ex;
      }
    } else {
      // 找到第一帧 rt >= target 的快照 i1
      let i1 = buf.length;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i].rt >= target) { i1 = i; break; }
      }
      if (i1 === 0) {
        // 目标时间早于首帧：停在首帧
        const s = buf[0];
        px = s.p[0]; py = s.p[1]; pz = s.p[2];
        yw = s.r; v = s.v; bm = s.bm;
      } else if (i1 === buf.length) {
        // 目标时间超过末帧：按最后速度方向外推 ≤250ms
        const s = buf[buf.length - 1];
        const ex = Math.min((target - s.rt) / 1000, MAX_EXTRAP_S);
        px = s.p[0] + Math.sin(s.r) * s.v * ex;
        py = s.p[1];
        pz = s.p[2] + Math.cos(s.r) * s.v * ex;
        yw = s.r; v = s.v; bm = s.bm;
      } else {
        // 区间插值：位置 lerp + yaw 最短角插值
        const s0 = buf[i1 - 1], s1 = buf[i1];
        const span = s1.rt - s0.rt;
        const a = span > 0 ? Math.min(1, Math.max(0, (target - s0.rt) / span)) : 1;
        px = s0.p[0] + (s1.p[0] - s0.p[0]) * a;
        py = s0.p[1] + (s1.p[1] - s0.p[1]) * a;
        pz = s0.p[2] + (s1.p[2] - s0.p[2]) * a;
        yw = lerpAngle(s0.r, s1.r, a);
        v = s0.v + (s1.v - s0.v) * a;
        bm = s0.bm + (s1.bm - s0.bm) * a;
      }
    }
    if (buf.length > 0) bo = buf[buf.length - 1].bo; // boosting 始终取最新快照（尾焰即时同步）

    this.pos.set(px, py, pz);
    this.yaw = yw;
    this.speed = v;
    this.boostMeter = bm;
    this.boosting = bo;

    // 尾焰同步 + 抖动（与 Player 一致）
    this.flame.visible = this.boosting;
    if (this.boosting) {
      this.flame.scale.set(1, 1, 0.8 + Math.sin(t * 40) * 0.25 + Math.random() * 0.2);
      this.flame.material.opacity = 0.7 + Math.random() * 0.3;
    }

    this.group.position.copy(this.pos);
    this.group.rotation.set(0, this.yaw, 0); // YXZ：y 为 yaw
  }

  // 从场景移除并释放资源（车体材质为 JetSki 模块级共享缓存，跳过不销毁）
  dispose() {
    if (this._scene && this._scene.remove) {
      try { this._scene.remove(this.group); } catch { /* ignore */ }
    }
    const sharedMat = this.bodyMesh ? this.bodyMesh.material : null;
    this.group.traverse((o) => {
      if (!o.isMesh) return;
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) {
        if (!m || m === sharedMat) continue;
        if (m.map) m.map.dispose();
        m.dispose();
      }
    });
    this._buf.length = 0;
  }
}
