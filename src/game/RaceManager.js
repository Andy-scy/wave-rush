// 比赛管理器 —— 检查点竞速核心：网格排位 / 过点判定 / 圈数与单圈时间 / 实时名次 / 检查点视觉
// 过点判定：与下一 CP 中心水平距离 < 22m（顺序由"只检测下一 CP"天然保证，环形 mod 前进）
// 视觉：每 CP 左右红白浮标（间隔 26m，门线垂直于指向下一 CP 的方向）+ 发光门柱光束（additive）；
//       玩家下一目标门金色高亮且光柱加粗加高（半径~1.4 / 高~44m）+ 两柱顶端亮点小球，
//       其余淡蓝（仅切换共享材质引用）；起点线为黑白格纹带
// 指引：巨型编号浮标 —— 下一 CP 门中心上方 7m 悬浮大号数字牌（金色），
//       下下 CP 同款灰白半透明弱化；9 张 CanvasTexture 构建期缓存（1..8 + 终点），每帧零开销
// 联动：constructor 会把 this 注册到 scene.userData.raceManager（AIPlayer 读取
//       player.progress / entities / started / raceTime 实现 rubber-band、避让与卡死检测）
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRACK } from './Track.js';
import { oceanHeight } from './WaveMath.js';

const N_CPS = TRACK.length;   // 9 个环形检查点（0 = 起点/终点线）
const PASS_DIST = 22;         // 过点判定半径（m）
const GATE_HALF = 13;         // 浮标间隔 26m
const MAX_DT = 0.1;           // 防切页大步长一步跳过检查点
const ENH_R = 1.4 / 0.55;     // 目标门光柱加粗倍数（共享几何 0.55 → 半径 ~1.4m）
const ENH_H = 4.4;            // 目标门光柱增高倍数（10 → 44m）
const ENH_CY = 21.6;          // 加高后光柱中心高度（相对浪面，柱底仍在浪下 0.4m）
const ENH_ORB_Y = 43.6;       // 光柱顶端亮点高度（相对浪面）

// 模块级复用（每帧零分配）
const _order = [];
const _keys = [];
const _byRank = (a, b) => _keys[b] - _keys[a];

// 顶点着色（与 JetSki 同套路：合并几何 + vertexColors）
function paint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const c = new THREE.Color(hex);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// 红白浮标（全部实例共享一份几何）
function buildBuoyGeo() {
  const parts = [];
  let g = new THREE.CylinderGeometry(0.62, 0.8, 0.5, 10); g.translate(0, 0.25, 0);
  parts.push(paint(g, '#f4f8fc'));
  g = new THREE.CylinderGeometry(0.56, 0.62, 0.42, 10); g.translate(0, 0.71, 0);
  parts.push(paint(g, '#ff3b30'));
  g = new THREE.CylinderGeometry(0.42, 0.56, 0.42, 10); g.translate(0, 1.13, 0);
  parts.push(paint(g, '#f4f8fc'));
  g = new THREE.CylinderGeometry(0.16, 0.42, 0.5, 10); g.translate(0, 1.59, 0);
  parts.push(paint(g, '#ff3b30'));
  g = new THREE.SphereGeometry(0.15, 8, 6); g.translate(0, 1.9, 0);
  parts.push(paint(g, '#ffd76a'));
  return mergeGeometries(parts);
}

// 起点黑白格纹（8 x 2 格）
function makeCheckerTexture() {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 80;
  const g = c.getContext('2d');
  for (let r = 0; r < 2; r++) {
    for (let col = 0; col < 8; col++) {
      g.fillStyle = ((r + col) & 1) ? '#15181d' : '#f2f5f9';
      g.fillRect(col * 40, r * 40, 40, 40);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// 巨型编号牌贴图（构建期生成，9 张缓存）：亮色圆底 + 深色粗斜体数字/文字。
// 圆底画成亮白渐变 → 由材质 color 染色：目标门染金（0xffc63f）、下下门染灰白（弱化），
// 一张贴图两处复用，缓存总量保持 9 张
function makeNumberTexture(label) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 114, 24, 128, 128, 118);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.72, '#eef0f2');
  grad.addColorStop(1, '#c7cdd4');
  g.fillStyle = grad;
  g.beginPath(); g.arc(128, 128, 118, 0, Math.PI * 2); g.fill();
  g.lineWidth = 9;
  g.strokeStyle = 'rgba(22, 28, 38, 0.85)';
  g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.stroke();
  // 深色粗斜体（canvas 斜切变换保证斜体观感，不依赖字体自带斜体）
  g.save();
  g.translate(128, 136);
  g.transform(1, 0, -0.22, 1, 0, 0);
  g.fillStyle = '#141a26';
  g.strokeStyle = '#0c1018';
  g.lineWidth = 7;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = label.length > 1
    ? '900 84px "Microsoft YaHei", "PingFang SC", Arial, sans-serif'
    : '900 152px "Arial Black", Arial, sans-serif';
  g.strokeText(label, 0, 0);
  g.fillText(label, 0, 0);
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// 编号牌双面 billboard：每帧渲染前 quaternion.copy(camera.quaternion)，
// 并同步刷新 matrixWorld（onBeforeRender 在 modelViewMatrix 计算之前触发 → 无一帧朝向延迟）
function makeBillboard(mesh) {
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    mesh.quaternion.copy(camera.quaternion);
    if (mesh.parent) {
      mesh.updateMatrix();
      mesh.matrixWorld.multiplyMatrices(mesh.parent.matrixWorld, mesh.matrix);
    }
  };
}

export class RaceManager {
  constructor(scene, laps) {
    this.scene = scene;
    this.totalLaps = laps || 1;
    this.raceTime = 0;
    this.player = null;      // entities[0]（本地玩家），setup/update 时刷新
    this.entities = null;    // 参赛名单（AI 的 rubber-band / 避让数据源）

    this._running = false;
    this._built = false;
    this._hl = -1;                               // 当前金色高亮的 CP 索引
    this._posts = [];                            // { mesh, beam, x, z, ph, enh, orb }
    this._beams = [];                            // 每 CP 的 [beamL, beamR]
    this._band = null;
    this._buoyGeo = null; this._matBuoy = null;
    this._beamGeo = null; this._matNext = null; this._matIdle = null;
    this._bandGeo = null; this._bandMat = null; this._bandTex = null;
    this._numTexs = null;                        // 9 张编号牌贴图（构建期缓存）
    this._boardGeo = null;
    this._matBoardNext = null; this._matBoardNext2 = null;
    this._boardNext = null; this._boardNext2 = null;
    this._orbGeo = null; this._matOrb = null; this._orbs = null;
    this._enhPosts = [];                         // 当前被加粗加高的目标门柱记录

    this.root = new THREE.Group();
    this.root.name = 'race-gates';
    scene.add(this.root);
    scene.userData.raceManager = this;           // 供 AIPlayer / 主程序访问
  }

  get allFinished() {
    const es = this.entities;
    if (!es || es.length === 0) return false;
    for (let i = 0; i < es.length; i++) if (!es[i].finished) return false;
    return true;
  }

  // 比赛是否已开始（begin 之后 true）—— AI 在倒计时期间据此怠速
  get started() { return this._running; }

  // —— 排位 + 竞速字段重置 + 检查点视觉 ——
  setup(entities) {
    this.entities = entities;
    this.player = entities && entities[0] ? entities[0] : null;
    this.raceTime = 0;
    this._running = false;
    this._hl = -1;

    const n = entities ? entities.length : 0;
    for (let i = 0; i < n; i++) {
      const e = entities[i];
      const x = (i % 2 === 0) ? -2.8 : 2.8;
      const z = -10 - Math.floor(i / 2) * 7;
      if (typeof e.reset === 'function') {
        e.reset(x, z, 0);                        // yaw=0 朝 +Z（CP1 方向）
      } else {
        // RemotePlayer 等无 reset 的实体：直接摆位
        if (e.pos) e.pos.set(x, e.pos.y, z);
        e.yaw = 0;
        if (e.vel && typeof e.vel.set === 'function') e.vel.set(0, 0, 0);
      }
      e.lap = 1; e.cpIndex = 0; e.progress = 0; e.rank = i + 1;
      e.finished = false; e.finishTime = 0;
      e.bestLap = Infinity; e._lapStart = 0;
    }

    this._buildGates();
  }

  begin() {
    this.raceTime = 0;
    this._running = true;
  }

  update(dt, t, entities) {
    if (dt > MAX_DT) dt = MAX_DT;
    if (entities && entities.length) { this.entities = entities; this.player = entities[0]; }
    const es = this.entities;
    if (!es) return;
    const n = es.length;

    if (this._running) this.raceTime += dt;
    const canPass = this._running;

    for (let i = 0; i < n; i++) {
      const e = es[i];
      if (e.lap == null) {                       // 未经历 setup 的实体（联机中途加入）兜底
        e.lap = 1; e.cpIndex = 0; e.progress = 0; e.rank = i + 1;
        e.finished = false; e.finishTime = 0; e.bestLap = Infinity; e._lapStart = 0;
      }
      const p = e.pos;
      if (!p) { _keys[i] = -1e9; continue; }

      let cpi = e.cpIndex | 0;
      let ni = (cpi + 1) % N_CPS;
      let dx = TRACK[ni].x - p.x, dz = TRACK[ni].z - p.z;
      let d = Math.sqrt(dx * dx + dz * dz);

      if (canPass && !e.finished && d < PASS_DIST) {
        e.cpIndex = ni;
        if (ni === 0) {                          // 回绕到 0 = 过终点线
          const lt = this.raceTime - e._lapStart;
          if (lt < e.bestLap) e.bestLap = lt;
          if (e.lap >= this.totalLaps) {
            e.finished = true;
            e.finishTime = this.raceTime;
          } else {
            e._lapStart = this.raceTime;
            e.lap++;
          }
        }
        cpi = e.cpIndex;
        ni = (cpi + 1) % N_CPS;
        dx = TRACK[ni].x - p.x; dz = TRACK[ni].z - p.z;
        d = Math.sqrt(dx * dx + dz * dz);
      }

      e.progress = e.lap * 10000 + cpi * 1000 - d;
      // 已完赛者按冲线时间先后排前（时间越小 key 越大）
      _keys[i] = e.finished ? (2e9 - e.finishTime) : e.progress;
    }

    // 名次（复用模块级数组，零分配）
    if (_order.length !== n) _order.length = n;
    for (let i = 0; i < n; i++) _order[i] = i;
    _order.sort(_byRank);
    for (let i = 0; i < n; i++) es[_order[i]].rank = i + 1;

    this._updateVisuals(t);
  }

  getStandings() {
    const es = this.entities || [];
    const list = [];
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      list.push({ e, rank: e.rank, lap: e.lap, cp: e.cpIndex, finished: e.finished, time: e.finishTime });
    }
    list.sort((a, b) => (a.rank || 99) - (b.rank || 99));
    return list;
  }

  // —— 检查点视觉（首次 setup 构建，几何/材质全程共享） ——
  _buildGates() {
    if (this._built) return;
    this._built = true;

    this._buoyGeo = buildBuoyGeo();
    this._matBuoy = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.05 });

    this._beamGeo = new THREE.CylinderGeometry(0.55, 0.55, 10, 10, 1, true);
    this._matNext = new THREE.MeshBasicMaterial({
      color: 0xffc63f, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    this._matIdle = new THREE.MeshBasicMaterial({
      color: 0x5fa8ff, transparent: true, opacity: 0.2,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });

    for (let i = 0; i < N_CPS; i++) {
      const c = TRACK[i], nx = TRACK[(i + 1) % N_CPS];
      let dx = nx.x - c.x, dz = nx.z - c.z;
      const L = Math.sqrt(dx * dx + dz * dz) || 1;
      dx /= L; dz /= L;
      const px = dz, pz = -dx;                   // 门线方向（垂直于指向下一 CP 的航向）
      const pair = [];
      for (let s = -1; s <= 1; s += 2) {
        const bx = c.x + px * GATE_HALF * s;
        const bz = c.z + pz * GATE_HALF * s;
        const buoy = new THREE.Mesh(this._buoyGeo, this._matBuoy);
        buoy.position.set(bx, 0, bz);
        buoy.rotation.y = Math.random() * Math.PI;
        this.root.add(buoy);
        const beam = new THREE.Mesh(this._beamGeo, this._matIdle);
        beam.position.set(bx, 4.6, bz);
        beam.renderOrder = 5;
        this.root.add(beam);
        this._posts.push({ mesh: buoy, beam, x: bx, z: bz, ph: Math.random() * Math.PI * 2, enh: false, orb: null });
        pair.push(beam);
      }
      this._beams.push(pair);
    }

    // —— 巨型编号浮标：下一 CP 金色 / 下下 CP 灰白半透明（弱化），双面 billboard ——
    // 贴图 9 张构建期缓存（CP1..8 数字 + CP0"终点"），每帧只换 map 引用，零纹理开销
    this._numTexs = [];
    for (let i = 0; i < N_CPS; i++) this._numTexs.push(makeNumberTexture(i === 0 ? '终点' : String(i)));
    this._boardGeo = new THREE.PlaneGeometry(5, 5);
    this._matBoardNext = new THREE.MeshBasicMaterial({
      map: this._numTexs[1], color: 0xffc63f, transparent: true, opacity: 0.95,
      side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
    });
    this._matBoardNext2 = new THREE.MeshBasicMaterial({
      map: this._numTexs[2], color: 0xb9c3cd, transparent: true, opacity: 0.55,
      side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
    });
    this._boardNext = new THREE.Mesh(this._boardGeo, this._matBoardNext);
    this._boardNext2 = new THREE.Mesh(this._boardGeo, this._matBoardNext2);
    makeBillboard(this._boardNext);
    makeBillboard(this._boardNext2);
    this._boardNext.renderOrder = 6;
    this._boardNext2.renderOrder = 6;
    this._boardNext.visible = false;
    this._boardNext2.visible = false;
    this.root.add(this._boardNext);
    this.root.add(this._boardNext2);

    // —— 目标门两柱顶端亮点小球（共享几何/材质，仅目标门可见） ——
    this._orbGeo = new THREE.SphereGeometry(1.0, 12, 8);
    this._matOrb = new THREE.MeshBasicMaterial({
      color: 0xffe27a, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this._orbs = [];
    for (let i = 0; i < 2; i++) {
      const orb = new THREE.Mesh(this._orbGeo, this._matOrb);
      orb.renderOrder = 5;
      orb.visible = false;
      this.root.add(orb);
      this._orbs.push(orb);
    }

    // 起点黑白格纹带（CP0，门线垂直于 CP0→CP1 方向）
    this._bandGeo = new THREE.PlaneGeometry(24, 3.6);
    this._bandGeo.rotateX(-Math.PI / 2);
    this._bandTex = makeCheckerTexture();
    this._bandMat = new THREE.MeshBasicMaterial({
      map: this._bandTex, transparent: true, opacity: 0.92,
      side: THREE.DoubleSide, depthWrite: false,
    });
    this._band = new THREE.Mesh(this._bandGeo, this._bandMat);
    const c0 = TRACK[0], n0 = TRACK[1];
    let bdx = n0.x - c0.x, bdz = n0.z - c0.z;
    const bl = Math.sqrt(bdx * bdx + bdz * bdz) || 1;
    bdx /= bl; bdz /= bl;
    const bpx = bdz, bpz = -bdx;
    // 带体两轴的世界方向（浪面采样用）：局部 X=横向门线，局部 Z=纵深航向
    this._bandF = { x: bdx, z: bdz };
    this._bandP = { x: bpx, z: bpz };
    // —— 贴浪采样网格（5×3）与最小二乘平面拟合权重（构建期预计算，逐帧零分配） ——
    // 网格对称 → XᵀX=diag(15,360,6.48)，权重 = [1/15, u/360, v/6.48]
    this._bandGrid = [];
    for (let u = -12; u <= 12; u += 6) {
      for (let v = -1.8; v <= 1.8; v += 1.8) this._bandGrid.push([u, v]);
    }
    this._bandH = new Float64Array(this._bandGrid.length);
    this._bandW = this._bandGrid.map(([u, v]) => [1 / 15, u / 360, v / 6.48]);
    this._band.rotation.order = 'YXZ';       // 先偏航，再在局部系里俯仰/侧倾
    this._band.rotation.y = Math.atan2(-bpz, bpx);
    this._band.position.set(c0.x, 0.5, c0.z);
    this._band.renderOrder = 2;
    this.root.add(this._band);
  }

  // 检查点视觉每帧更新：目标门切换（材质引用/加粗标记/编号牌换图）→ 浮标随浪 → 编号牌贴浪
  _updateVisuals(t) {
    if (!this._built) return;
    const posts = this._posts;
    const pl = this.player;
    const target = pl ? (((pl.cpIndex | 0) + 1) % N_CPS) : -1;

    // —— 目标门切换（仅状态变化时执行）：金色材质 + 光柱加粗加高 + 顶端亮点 + 编号牌 ——
    if (target !== this._hl) {
      const enh = this._enhPosts;
      for (let i = 0; i < enh.length; i++) { enh[i].enh = false; enh[i].orb = null; }
      enh.length = 0;
      this._hl = target;
      for (let i = 0; i < N_CPS; i++) {
        const m = i === target ? this._matNext : this._matIdle;
        const pair = this._beams[i];
        if (pair[0].material !== m) pair[0].material = m;
        if (pair[1].material !== m) pair[1].material = m;
      }
      if (target >= 0) {
        const pL = posts[target * 2], pR = posts[target * 2 + 1];
        pL.enh = true; pR.enh = true;
        pL.orb = this._orbs[0]; pR.orb = this._orbs[1];
        enh.push(pL, pR);
        this._orbs[0].visible = true;
        this._orbs[1].visible = true;
        this._matBoardNext.map = this._numTexs[target];
        this._matBoardNext2.map = this._numTexs[(target + 1) % N_CPS];
      } else {
        this._orbs[0].visible = false;
        this._orbs[1].visible = false;
      }
    }

    // —— 浮标随浪起伏微摆；目标门两柱加粗加高（共享几何 → mesh 缩放，柱底仍压浪面） ——
    for (let i = 0; i < posts.length; i++) {
      const b = posts[i];
      const h = oceanHeight(b.x, b.z, t);
      b.mesh.position.y = h + 0.32 + Math.sin(t * 2.1 + b.ph) * 0.09;
      b.mesh.rotation.z = Math.sin(t * 1.6 + b.ph) * 0.06;
      b.mesh.rotation.x = Math.cos(t * 1.3 + b.ph) * 0.05;
      if (b.enh) {
        b.beam.scale.set(ENH_R, ENH_H, ENH_R);
        b.beam.position.y = h + ENH_CY;
        b.orb.position.set(b.x, h + ENH_ORB_Y + Math.sin(t * 2.3 + b.ph) * 0.35, b.z);
        b.orb.scale.setScalar(1 + Math.sin(t * 5.2 + b.ph) * 0.2);
      } else {
        b.beam.scale.set(1, 1, 1);
        b.beam.position.y = h + 4.6;
      }
    }
    if (this._band) {
      // 格纹带贴浪：对带体足迹（24m×3.6m，5×3 网格）的海高做最小二乘平面拟合，
      // 平面整体抬升 0.5 + 最大残差 → 网格所有采样点恒高于海面 ≥0.5m，
      // 波峰波谷的曲率（中心可能是浪谷）不再导致边缘穿进海面
      const c0 = TRACK[0], F = this._bandF, P = this._bandP;
      const G = this._bandGrid, H = this._bandH, W = this._bandW;
      for (let i = 0; i < G.length; i++) {
        H[i] = oceanHeight(c0.x + (G[i][0] * P.x + G[i][1] * F.x), c0.z + (G[i][0] * P.z + G[i][1] * F.z), t);
      }
      let y0 = 0, a = 0, b = 0;   // 拟合平面 y = y0 + a·u + b·v
      for (let i = 0; i < G.length; i++) {
        y0 += W[i][0] * H[i]; a += W[i][1] * H[i]; b += W[i][2] * H[i];
      }
      let rmax = 0;
      for (let i = 0; i < G.length; i++) {
        const r = H[i] - (y0 + a * G[i][0] + b * G[i][1]);
        if (r > rmax) rmax = r;
      }
      const CLAMP = 0.2;   // 倾斜限幅 ≈11.5°，保持“轻摇”观感
      const ang = s => Math.max(-CLAMP, Math.min(CLAMP, s));
      this._band.position.y = y0 + 0.5 + rmax;
      this._band.rotation.x = -ang(Math.atan(b));   // 局部 +Z（纵深）端随浪
      this._band.rotation.z = ang(Math.atan(a));    // 局部 +X（横向）端随浪
    }

    // —— 巨型编号浮标：门中心上方 7m 悬浮贴浪（双面 billboard 朝向在渲染前刷新） ——
    const showB = target >= 0;
    this._boardNext.visible = showB;
    this._boardNext2.visible = showB;
    if (showB) {
      const cA = TRACK[target], cB = TRACK[(target + 1) % N_CPS];
      this._boardNext.position.set(
        cA.x, oceanHeight(cA.x, cA.z, t) + 7 + Math.sin(t * 1.7) * 0.22, cA.z);
      this._boardNext2.position.set(
        cB.x, oceanHeight(cB.x, cB.z, t) + 7 + Math.sin(t * 1.7 + 1.9) * 0.22, cB.z);
    }

    this._matNext.opacity = 0.55 + Math.sin(t * 5.2) * 0.28;   // 目标门脉动（加强）
  }

  // 可选清理（重开新 RaceManager 时由主程序调用）
  dispose() {
    this.scene.remove(this.root);
    if (this.scene.userData.raceManager === this) delete this.scene.userData.raceManager;
    if (this._buoyGeo) this._buoyGeo.dispose();
    if (this._beamGeo) this._beamGeo.dispose();
    if (this._bandGeo) this._bandGeo.dispose();
    if (this._matBuoy) this._matBuoy.dispose();
    if (this._matNext) this._matNext.dispose();
    if (this._matIdle) this._matIdle.dispose();
    if (this._bandMat) this._bandMat.dispose();
    if (this._bandTex) this._bandTex.dispose();
    if (this._boardGeo) this._boardGeo.dispose();
    if (this._orbGeo) this._orbGeo.dispose();
    if (this._matBoardNext) this._matBoardNext.dispose();
    if (this._matBoardNext2) this._matBoardNext2.dispose();
    if (this._matOrb) this._matOrb.dispose();
    if (this._numTexs) {
      for (let i = 0; i < this._numTexs.length; i++) this._numTexs[i].dispose();
      this._numTexs = null;
    }
    this._built = false;
    this._posts.length = 0;
    this._beams.length = 0;
    this._enhPosts.length = 0;
    this._band = null;
    this._boardNext = null;
    this._boardNext2 = null;
    this._orbs = null;
  }
}
