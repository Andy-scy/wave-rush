// 赛道指引系统 —— 沿赛道折线的流动箭头光带 + 头顶指向大箭头 + 目标门信标塔/光环
// 光带路径 = 玩家当前位置 → 下一CP → 下下CP → 下下下CP（最多展望 3 个 CP，总长截断 420m），
// chevron 沿折线按弧长均匀铺设（直线段直接铺、转角处朝向突变自然指出转向）；
// 玩家距下一折点 <25m 时路径自动切换到下一段；流动方向沿路径前进，贴 oceanHeight
import * as THREE from 'three';
import { TRACK } from './Track.js';
import { oceanHeight } from './WaveMath.js';

const CHEVRON_N = 26;    // 水面 chevron 池容量
const PATH_MAX = 420;    // 折线总长截断（m）
const BEND_SWITCH = 25;  // 距下一折点小于该值 → 光带切换到下一段
const START_SKIP = 7;    // 折线起点让位（chevron 不压在玩家正上方）
const END_KEEP = 3;      // 折线末端收尾（截断处淡出余量）

export class TrackGuide {
  constructor(scene) {
    this.scene = scene;
    this.flow = 0;
    this._arrowYaw = 0;
    this._vis = false;

    // ---------- 水面雪佛龙箭头（流动光带） ----------
    const shape = new THREE.Shape();
    shape.moveTo(-1.35, -0.5);
    shape.lineTo(0, 0.65);
    shape.lineTo(1.35, -0.5);
    shape.lineTo(1.35, -1.1);
    shape.lineTo(0, 0.05);
    shape.lineTo(-1.35, -1.1);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(Math.PI / 2); // 平躺，尖端朝 +Z
    this._chevGeo = geo;
    this._chevMat = new THREE.MeshBasicMaterial({
      color: '#ffb52e', transparent: true, opacity: 0.82,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    this.chevrons = [];
    for (let i = 0; i < CHEVRON_N; i++) {
      const m = new THREE.Mesh(geo, this._chevMat);
      m.renderOrder = 4;
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.chevrons.push(m);
    }

    // ---------- 头顶指向大箭头 ----------
    const arrowMat = this._arrowMat = new THREE.MeshBasicMaterial({
      color: '#ffc63d', transparent: true, opacity: 0.92,
      depthWrite: false, toneMapped: false,
    });
    const tip = new THREE.ConeGeometry(0.5, 1.25, 4);
    tip.rotateX(Math.PI / 2);
    const tail = new THREE.BoxGeometry(0.46, 0.13, 0.95);
    tail.translate(0, 0, -0.85);
    const arrow = new THREE.Group();
    arrow.add(new THREE.Mesh(tip, arrowMat));
    arrow.add(new THREE.Mesh(tail, arrowMat));
    arrow.visible = false;
    scene.add(arrow);
    this.arrow = arrow;

    // ---------- 折线路径复用缓冲（每帧零分配） ----------
    // 折线顶点 0 = 玩家，1..3 = 展望的 CP；cum = 各顶点累计弧长；seg* = 各段方向/朝向
    this._ptsX = new Float64Array(4);
    this._ptsZ = new Float64Array(4);
    this._cum = new Float64Array(4);
    this._segUx = new Float64Array(3);
    this._segUz = new Float64Array(3);
    this._segYaw = new Float64Array(3);

    // ---------- 目标门信标：光柱 + 脉冲光环 ----------
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.85, 34, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: '#ffd23d', transparent: true, opacity: 0.30,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide, toneMapped: false,
      })
    );
    beacon.renderOrder = 5;
    beacon.visible = false;
    scene.add(beacon);
    this.beacon = beacon;

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(9, 0.4, 8, 36),
      new THREE.MeshBasicMaterial({
        color: '#ffe27a', transparent: true, opacity: 0.75,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 4;
    ring.visible = false;
    scene.add(ring);
    this.ring = ring;
  }

  setVisible(v) {
    if (this._vis === v) return;
    this._vis = v;
    if (!v) {
      this.chevrons.forEach(m => { m.visible = false; });
      this.arrow.visible = false;
      this.beacon.visible = false;
      this.ring.visible = false;
    }
  }

  /**
   * 每帧更新
   * @param {boolean} active 比赛/倒计时中为 true，菜单为 false
   */
  update(dt, t, player, cpIndex, active) {
    this.setVisible(active);
    if (!active || !player) return;

    const target = TRACK[cpIndex % TRACK.length];
    const px = player.pos.x, pz = player.pos.z;
    const dx = target.x - px, dz = target.z - pz;
    const dist = Math.hypot(dx, dz) || 0.001;
    const ux = dx / dist, uz = dz / dist;
    const heading = Math.atan2(ux, uz);

    // ---------- 沿赛道折线的流动箭头光带 ----------
    // 路径 = 玩家 → 下一CP → 下下CP → 下下下CP（展望 3 个 CP，总长截断 420m）；
    // 玩家贴近下一折点（<25m）时路径自动切换到下一段
    this.flow = (this.flow + dt * (0.35 + Math.min(Math.abs(player.speed) / 60, 0.5))) % 1;
    const N = TRACK.length;
    const X = this._ptsX, Z = this._ptsZ, cum = this._cum;
    const sUx = this._segUx, sUz = this._segUz, sYaw = this._segYaw;
    let i0 = cpIndex % N;
    const bdx = TRACK[i0].x - px, bdz = TRACK[i0].z - pz;
    if (bdx * bdx + bdz * bdz < BEND_SWITCH * BEND_SWITCH) i0 = (i0 + 1) % N;
    X[0] = px; Z[0] = pz;
    for (let k = 1; k <= 3; k++) {
      const c = TRACK[(i0 + k - 1) % N];
      X[k] = c.x; Z[k] = c.z;
    }
    // 累计弧长 + 各段单位方向/朝向（超长截断）
    cum[0] = 0;
    let nSeg = 0, total = 0;
    for (let k = 0; k < 3; k++) {
      const sx = X[k + 1] - X[k], sz = Z[k + 1] - Z[k];
      const L = Math.sqrt(sx * sx + sz * sz);
      if (L < 0.5) break;
      if (total + L > PATH_MAX) {
        sUx[nSeg] = sx / L; sUz[nSeg] = sz / L;
        sYaw[nSeg] = Math.atan2(sUx[nSeg], sUz[nSeg]);
        nSeg++; total = PATH_MAX; cum[nSeg] = total;
        break;
      }
      total += L;
      sUx[nSeg] = sx / L; sUz[nSeg] = sz / L;
      sYaw[nSeg] = Math.atan2(sUx[nSeg], sUz[nSeg]);
      nSeg++; cum[nSeg] = total;
    }
    // chevron 沿折线按弧长均匀铺设（共享材质 → 近处淡入/远端淡出用缩放包络）
    const usable = total - START_SKIP - END_KEEP;
    const nCh = this.chevrons.length;
    for (let i = 0; i < nCh; i++) {
      const m = this.chevrons[i];
      if (nSeg === 0 || usable < 14) { m.visible = false; continue; }
      const s = (i / nCh + this.flow) % 1;
      const d = START_SKIP + s * usable;
      let k = 0;
      while (k < nSeg - 1 && d > cum[k + 1]) k++;
      const local = d - cum[k];
      const wx = X[k] + sUx[k] * local, wz = Z[k] + sUz[k] * local;
      m.visible = true;
      m.position.set(wx, oceanHeight(wx, wz, t) + 0.28, wz);
      m.rotation.y = sYaw[k];                       // 直线段沿段向铺设，转角处角度突变自然呈现
      const fade = Math.min(d / 12, 1) * Math.min((total - d) / 30 + 0.4, 1);
      const sc = (1.5 + s * 1.4) * Math.max(fade, 0.001);
      m.scale.set(sc, 1, sc);
    }

    // ---------- 头顶大箭头 ----------
    const showArrow = dist > 26 && !player.finished;
    this.arrow.visible = showArrow;
    if (showArrow) {
      // 平滑追踪：以箭头当前朝向为基准做最短角插值
      const diff = Math.atan2(Math.sin(heading - this._arrowYaw), Math.cos(heading - this._arrowYaw));
      this._arrowYaw += diff * Math.min(9 * dt, 1);
      this.arrow.rotation.y = this._arrowYaw;
      const wrong = Math.abs(diff) > 1.9;
      this._arrowMat.color.setHex(wrong ? 0xff4d4d : 0xffd23d);
      const pulse = wrong ? 1 + Math.sin(t * 9) * 0.18 : 1 + Math.sin(t * 3.2) * 0.06;
      this.arrow.scale.setScalar(pulse);
      this.arrow.position.set(px, player.pos.y + 3.0, pz);
    }

    // ---------- 目标门信标 ----------
    const ty = oceanHeight(target.x, target.z, t);
    this.beacon.visible = true;
    this.beacon.position.set(target.x, ty + 16.5, target.z);
    this.beacon.material.opacity = 0.24 + Math.sin(t * 3.4) * 0.10;
    this.ring.visible = dist > 40;
    this.ring.position.set(target.x, ty + 0.5, target.z);
    const rs = 1 + Math.sin(t * 2.6) * 0.12;
    this.ring.scale.set(rs, rs, 1);
    this.ring.rotation.z += dt * 0.8;
  }
}
