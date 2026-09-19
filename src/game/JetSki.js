// 摩托艇 —— 程序化 Stylized 建模 v2（真正"载具级"造型）
// 船体：分段放样（锐艏上翘 + 舷侧外飘 + 折角腰线双色调 + 龙骨/双防溅条 + 甲板伏贴）
// 座舱：双层座椅 + 防滑条纹载物架 + 尾翼 + 侧进气口 + 排水口 + 半透明风挡 + 整流罩接缝
// 骑手：屈膝坐姿（大腿水平/小腿近竖直）+ 前倾躯干 + 护具/手套/头盔鳍
// 顶点色合并，每艘艇 6 个 draw call：
//   body(船体+座舱, vertexColors) / rider(骑手, vertexColors) / glow(灯带)
//   decal(号码贴纸) / glass(风挡玻璃) / chrome(镀铬件：车把/扶手/喷水口环)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _q = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);

const v = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- 基础工具 ----------
function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  const c = new THREE.Color(hex);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i*3] = c.r; arr[i*3+1] = c.g; arr[i*3+2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function shade(hex, k) { return '#' + new THREE.Color(hex).multiplyScalar(k).getHexString(); }

// 在 from→to 之间生成锥形圆柱（手臂/腿，顶点色）
function limb(from, to, r, hex) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(r * 0.8, r, len, 7);
  _q.setFromUnitVectors(_yAxis, dir.clone().normalize());
  geo.applyQuaternion(_q);
  geo.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  return colored(geo, hex);
}

// 在 from→to 之间生成圆柱（镀铬件，不着色，材质统一金属）
function tubeBetween(from, to, r0, r1) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(r1, r0, len, 10);
  _q.setFromUnitVectors(_yAxis, dir.normalize());
  geo.applyQuaternion(_q);
  geo.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  return geo;
}

// ---------- 放样工具 ----------
// rows：若干截面行（每行点数一致），相邻行间连四边形；flip 控制绕向（法线朝外）
// 平滑着色（索引共享顶点），折角处由调用方拆分成独立条带
function loft(rows, flip) {
  const R = rows.length, C = rows[0].length;
  const pos = new Float32Array(R * C * 3);
  let p = 0;
  for (const row of rows) for (const pt of row) { pos[p++] = pt[0]; pos[p++] = pt[1]; pos[p++] = pt[2]; }
  const idx = [];
  for (let r = 0; r < R - 1; r++) {
    for (let c = 0; c < C - 1; c++) {
      const a = r * C + c, b = a + 1, d = a + C, e = d + 1;
      if (flip) idx.push(a, e, b, a, d, e);
      else idx.push(a, b, e, a, e, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(R * C * 2), 2));
  return g;
}

// 平面着色版本（非索引，每个面独立法线）——用于船底：龙骨/防溅条呈硬朗棱面
function loftFacet(rows, flip) {
  const tris = [];
  const R = rows.length, C = rows[0].length;
  const push = (pt) => tris.push(pt[0], pt[1], pt[2]);
  for (let r = 0; r < R - 1; r++) {
    for (let c = 0; c < C - 1; c++) {
      const a = rows[r][c], b = rows[r][c + 1], d = rows[r + 1][c], e = rows[r + 1][c + 1];
      if (flip) { push(a); push(e); push(b); push(a); push(d); push(e); }
      else { push(a); push(b); push(e); push(a); push(e); push(d); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris), 3));
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(tris.length / 3 * 2), 2));
  return g;
}

// ---------- 号码贴纸（圆角面板 + 斜切角 + 装饰条纹） ----------
function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function makeNumberTexture(name, number, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  // 面板路径：圆角 + 右上斜切角
  const P = new Path2D();
  P.moveTo(56, 10);
  P.lineTo(382, 10);
  P.lineTo(502, 130);          // 斜切角
  P.lineTo(502, 456);
  P.arcTo(502, 502, 456, 502, 46);
  P.lineTo(56, 502);
  P.arcTo(10, 502, 10, 456, 46);
  P.lineTo(10, 56);
  P.arcTo(10, 10, 56, 10, 46);
  P.closePath();
  g.fillStyle = '#f2f6fa';
  g.fill(P);
  g.strokeStyle = '#0c1420';
  g.lineWidth = 12;
  g.stroke(P);
  g.save();
  g.clip(P);
  // 斜向装饰条纹（主色）
  g.save();
  g.translate(256, 256);
  g.rotate(-0.45);
  g.fillStyle = color;
  g.globalAlpha = 0.85;
  g.fillRect(-400, 148, 800, 40);
  g.fillRect(-400, 204, 800, 16);
  g.restore();
  g.globalAlpha = 1;
  // 大号码
  g.fillStyle = '#0c1420';
  g.font = 'italic 900 200px "Segoe UI", Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(number, 248, 185);
  // 名字深色圆角条
  g.fillStyle = '#0c1420';
  roundRectPath(g, 106, 342, 300, 72, 30);
  g.fill();
  g.fillStyle = '#f2f6fa';
  g.font = 'italic 800 42px "Segoe UI", Arial';
  g.fillText(name.slice(0, 9), 256, 380);
  // 左下角标三角
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(10, 502); g.lineTo(120, 502); g.lineTo(10, 392);
  g.closePath();
  g.fill();
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function buildJetSki({ color, accent, name, number }) {
  const group = new THREE.Group();
  const bodyGeos = [];
  const glowGeos = [];
  const chromeGeos = [];

  // ================= 船体（分段放样） =================
  // 截面表 [z, 舷缘半宽, 折角半宽, 舷缘高, 折角高, 龙骨底, 甲板中线高]
  // 艏部收尖并上翘（railY/keelY 抬升），舷侧外飘（railX > chineX）
  const SEC = [
    [-1.70, 0.460, 0.420, 0.580, 0.170, 0.020, 0.545],
    [-1.35, 0.520, 0.465, 0.605, 0.160, 0.008, 0.565],
    [-0.95, 0.545, 0.490, 0.615, 0.152, -0.002, 0.575],
    [-0.50, 0.555, 0.500, 0.620, 0.148, -0.008, 0.585],
    [-0.05, 0.545, 0.490, 0.615, 0.144, -0.012, 0.590],
    [0.45, 0.520, 0.465, 0.610, 0.142, -0.002, 0.600],
    [0.90, 0.470, 0.410, 0.635, 0.160, 0.050, 0.635],
    [1.30, 0.385, 0.320, 0.700, 0.220, 0.150, 0.695],
    [1.60, 0.270, 0.215, 0.775, 0.315, 0.280, 0.770],
    [1.80, 0.130, 0.100, 0.830, 0.390, 0.375, 0.825],
    [1.90, 0.020, 0.015, 0.855, 0.435, 0.425, 0.850],
  ];
  const expand = (row) => {
    const [z, railX, chineX, railY, chineY, keelY, deckY] = row;
    return {
      z, railX, chineX, railY, chineY, keelY, deckY,
      bilgeX: chineX * 0.58, bilgeY: keelY + 0.055,          // 舭部
      strakeX: chineX * 0.32, strakeY: keelY + 0.008,        // 防溅条（低于底面弦线 → 纵向凸棱）
      midX: (railX + chineX) / 2 + 0.008, midY: (railY + chineY) / 2, // 侧腰鼓点 = 腰线
    };
  };
  const SECS = SEC.map(expand);
  const secAt = (z) => {
    if (z <= SECS[0].z) return SECS[0];
    if (z >= SECS[SECS.length - 1].z) return SECS[SECS.length - 1];
    for (let i = 0; i < SECS.length - 1; i++) {
      const a = SECS[i], b = SECS[i + 1];
      if (z >= a.z && z <= b.z) {
        const t = (z - a.z) / (b.z - a.z);
        const mix = (k) => a[k] + (b[k] - a[k]) * t;
        return expand([z, mix('railX'), mix('chineX'), mix('railY'), mix('chineY'), mix('keelY'), mix('deckY')]);
      }
    }
    return SECS[0];
  };

  const upperRowS = (s) => [[s.railX, s.railY, s.z], [s.midX, s.midY, s.z]];
  const lowerRowS = (s) => [[s.midX, s.midY, s.z], [s.chineX, s.chineY, s.z]];
  const upperRowP = (s) => [[-s.railX, s.railY, s.z], [-s.midX, s.midY, s.z]];
  const lowerRowP = (s) => [[-s.midX, s.midY, s.z], [-s.chineX, s.chineY, s.z]];
  const bottomRow = (s) => [
    [s.chineX, s.chineY, s.z], [s.bilgeX, s.bilgeY, s.z], [s.strakeX, s.strakeY, s.z],
    [0, s.keelY, s.z],
    [-s.strakeX, s.strakeY, s.z], [-s.bilgeX, s.bilgeY, s.z], [-s.chineX, s.chineY, s.z],
  ];
  const deckRow = (s) => [
    [-s.railX, s.railY, s.z], [-s.railX * 0.55, s.deckY + 0.015, s.z], [0, s.deckY, s.z],
    [s.railX * 0.55, s.deckY + 0.015, s.z], [s.railX, s.railY, s.z],
  ];

  // 侧壁双色调：腰线以上主色 / 以下暗色（腰线明显），折角处拆条带形成硬边
  bodyGeos.push(colored(loft(SECS.map(upperRowS), true), color));
  bodyGeos.push(colored(loft(SECS.map(lowerRowS), true), shade(color, 0.74)));
  bodyGeos.push(colored(loft(SECS.map(upperRowP), false), color));
  bodyGeos.push(colored(loft(SECS.map(lowerRowP), false), shade(color, 0.74)));
  // 船底：棱面着色，龙骨 + 双防溅条呈纵向凸棱
  bodyGeos.push(colored(loftFacet(SECS.map(bottomRow), true), shade(color, 0.55)));
  // 甲板（微拱）
  bodyGeos.push(colored(loft(SECS.map(deckRow), true), color));

  // 尾板（艉封板，accent 色面板）
  {
    const s = SECS[0];
    const ring = [
      [0, s.keelY], [s.strakeX, s.strakeY], [s.bilgeX, s.bilgeY], [s.chineX, s.chineY],
      [s.midX, s.midY], [s.railX, s.railY], [s.railX * 0.55, s.deckY + 0.015], [0, s.deckY],
      [-s.railX * 0.55, s.deckY + 0.015], [-s.railX, s.railY], [-s.midX, s.midY], [-s.chineX, s.chineY],
      [-s.bilgeX, s.bilgeY], [-s.strakeX, s.strakeY],
    ];
    const tris = [];
    const cy = (s.keelY + s.deckY) / 2;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      tris.push(0, cy, s.z, b[0], b[1], s.z, a[0], a[1], s.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris), 3));
    g.computeVertexNormals();
    bodyGeos.push(colored(g, accent));
  }

  // 舷缘护栏管（accent 色软垫护栏，沿舷缘全线；末端收进包络内）
  for (const side of [1, -1]) {
    const pts = SECS.map((s) => v(side * (s.railX - 0.002), s.railY + 0.008, Math.min(s.z, 1.876)));
    bodyGeos.push(colored(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 36, 0.02, 6), accent));
  }

  // 艏柱护带（accent，覆盖收尖缝隙）
  const stem = new THREE.BoxGeometry(0.055, 0.46, 0.07);
  stem.translate(0, 0.645, 1.862);
  bodyGeos.push(colored(stem, accent));
  // 艏部甲板装饰板
  const nosePlate = new THREE.BoxGeometry(0.20, 0.014, 0.26);
  nosePlate.rotateX(-0.15);
  nosePlate.translate(0, 0.723, 1.38);
  bodyGeos.push(colored(nosePlate, accent));

  // ================= 侧踏板（内凹防滑槽） =================
  for (const side of [1, -1]) {
    const tray = new THREE.BoxGeometry(0.183, 0.165, 1.0);
    tray.translate(side * 0.4365, 0.5425, -0.18);
    bodyGeos.push(colored(tray, '#10141b'));
    const rec = new THREE.BoxGeometry(0.13, 0.145, 0.92);
    rec.translate(side * 0.44, 0.53, -0.18);
    bodyGeos.push(colored(rec, '#0a0e14'));
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.BoxGeometry(0.125, 0.018, 0.035);
      rib.translate(side * 0.44, 0.609, -0.5 + i * 0.24);
      bodyGeos.push(colored(rib, accent));
    }
  }

  // ================= 座舱（双层座椅） =================
  const seatBase = new THREE.CylinderGeometry(0.135, 0.165, 0.92, 4, 1);
  seatBase.rotateY(Math.PI / 4); seatBase.rotateX(Math.PI / 2); seatBase.scale(1.25, 0.62, 1);
  seatBase.translate(0, 0.66, -0.32);
  bodyGeos.push(colored(seatBase, '#141920'));
  const seatMid = new THREE.CylinderGeometry(0.125, 0.155, 0.98, 4, 1);
  seatMid.rotateY(Math.PI / 4); seatMid.rotateX(Math.PI / 2); seatMid.scale(1.3, 0.66, 1);
  seatMid.translate(0, 0.79, -0.28);
  bodyGeos.push(colored(seatMid, '#181c24'));
  const cushion = new THREE.CapsuleGeometry(0.155, 0.60, 4, 12);
  cushion.rotateX(Math.PI / 2); cushion.scale(1, 0.58, 1);
  cushion.translate(0, 0.855, -0.26);
  bodyGeos.push(colored(cushion, '#181c24'));
  for (const side of [1, -1]) {
    const st = new THREE.BoxGeometry(0.02, 0.05, 0.66);
    st.translate(side * 0.15, 0.865, -0.26);
    bodyGeos.push(colored(st, accent));
  }
  // 后座垫 + 扶手
  const pillion = new THREE.BoxGeometry(0.25, 0.06, 0.28);
  pillion.translate(0, 0.90, -0.82);
  bodyGeos.push(colored(pillion, accent));
  chromeGeos.push(tubeBetween(v(-0.085, 0.90, -0.82), v(-0.085, 0.975, -0.82), 0.015, 0.015));
  chromeGeos.push(tubeBetween(v(0.085, 0.90, -0.82), v(0.085, 0.975, -0.82), 0.015, 0.015));
  chromeGeos.push(tubeBetween(v(-0.12, 0.985, -0.82), v(0.12, 0.985, -0.82), 0.018, 0.018));

  // ================= 尾部载物架（防滑条纹）+ 尾翼 =================
  const rack = new THREE.BoxGeometry(0.50, 0.09, 0.60);
  rack.translate(0, 0.595, -1.26);
  bodyGeos.push(colored(rack, '#141920'));
  for (let i = 0; i < 5; i++) {
    const rib = new THREE.BoxGeometry(0.44, 0.02, 0.045);
    rib.translate(0, 0.646, -1.455 + i * 0.1075);
    bodyGeos.push(colored(rib, accent));
  }
  for (const side of [1, -1]) {
    const strut = new THREE.BoxGeometry(0.04, 0.17, 0.06);
    strut.translate(side * 0.17, 0.715, -1.40);
    bodyGeos.push(colored(strut, '#10141b'));
    const plate = new THREE.BoxGeometry(0.018, 0.10, 0.17);
    plate.translate(side * 0.229, 0.845, -1.40);
    bodyGeos.push(colored(plate, '#10141b'));
  }
  const wing = new THREE.BoxGeometry(0.46, 0.035, 0.16);
  wing.rotateX(0.14);
  wing.translate(0, 0.845, -1.40);
  bodyGeos.push(colored(wing, accent));

  // ================= 前整流罩 + 接缝 + 侧进气口 =================
  const cowl = new THREE.CylinderGeometry(0.15, 0.235, 0.58, 4, 1);
  cowl.rotateY(Math.PI / 4); cowl.rotateX(Math.PI / 2); cowl.scale(1.35, 0.58, 1);
  cowl.translate(0, 0.695, 0.60);
  bodyGeos.push(colored(cowl, accent));
  for (const [z, w, y] of [[0.42, 0.36, 0.793], [0.60, 0.33, 0.7845], [0.78, 0.29, 0.7745]]) {
    const sm = new THREE.BoxGeometry(w, 0.012, 0.018);
    sm.translate(0, y, z);
    bodyGeos.push(colored(sm, '#10141b'));
  }
  for (const side of [1, -1]) {
    for (const [z, x] of [[0.46, 0.201], [0.62, 0.178]]) {
      const vent = new THREE.BoxGeometry(0.016, 0.04, 0.11);
      vent.translate(side * x, 0.70, z);
      bodyGeos.push(colored(vent, '#0a0e14'));
    }
    // 侧进气口（舷侧凸出铲形口 + accent 唇边）
    const duct = new THREE.BoxGeometry(0.05, 0.15, 0.40);
    duct.rotateZ(-side * 0.12);
    duct.translate(side * 0.53, 0.42, -0.85);
    bodyGeos.push(colored(duct, '#10141b'));
    const lip = new THREE.BoxGeometry(0.014, 0.16, 0.42);
    lip.rotateZ(-side * 0.12);
    lip.translate(side * 0.552, 0.42, -0.85);
    bodyGeos.push(colored(lip, accent));
    // 侧排水口
    const drain = new THREE.BoxGeometry(0.035, 0.05, 0.16);
    drain.rotateZ(-side * 0.12);
    drain.translate(side * 0.497, 0.235, -1.12);
    bodyGeos.push(colored(drain, '#0a0e14'));
  }

  // ================= 车把（握把位 (±0.3, 1.0, 0.34)）+ 仪表座 =================
  chromeGeos.push(tubeBetween(v(0, 0.60, 0.46), v(0, 0.99, 0.355), 0.062, 0.05));
  const bar = new THREE.CylinderGeometry(0.027, 0.027, 0.58, 10);
  bar.rotateZ(Math.PI / 2);
  bar.translate(0, 1.0, 0.34);
  chromeGeos.push(bar);
  for (const side of [1, -1]) {
    const grip = new THREE.CylinderGeometry(0.047, 0.047, 0.13, 10);
    grip.rotateZ(Math.PI / 2);
    grip.translate(side * 0.30, 1.0, 0.34);
    bodyGeos.push(colored(grip, '#10141b'));
    const cap = new THREE.CylinderGeometry(0.05, 0.05, 0.02, 10);
    cap.rotateZ(Math.PI / 2);
    cap.translate(side * 0.373, 1.0, 0.34);
    bodyGeos.push(colored(cap, accent));
  }
  const consoleBox = new THREE.BoxGeometry(0.15, 0.07, 0.10);
  consoleBox.translate(0, 1.005, 0.43);
  bodyGeos.push(colored(consoleBox, '#10141b'));

  // ================= 喷水口（尾部 z≈-1.6~-1.75, y≈0.14）+ 进水栅 =================
  const nozBody = new THREE.CylinderGeometry(0.125, 0.105, 0.20, 12);
  nozBody.rotateX(Math.PI / 2);
  nozBody.translate(0, 0.14, -1.60);
  bodyGeos.push(colored(nozBody, '#181c24'));
  const nozTip = new THREE.CylinderGeometry(0.085, 0.118, 0.16, 12);
  nozTip.rotateX(-Math.PI / 2);
  nozTip.translate(0, 0.14, -1.76);
  bodyGeos.push(colored(nozTip, '#181c24'));
  for (const side of [1, -1]) {
    const fin = new THREE.BoxGeometry(0.018, 0.06, 0.34);
    fin.translate(side * 0.075, -0.008, -1.02);
    bodyGeos.push(colored(fin, '#10141b'));
  }

  // ================= 轮廓灯带（发光） =================
  // 侧灯带：贴合舷侧的放样窄带（t 0.04~0.17 舷缘下方），沿外法线微微抬出
  for (const side of [1, -1]) {
    const rows = [];
    for (const z of [-0.85, -0.5, -0.15, 0.2]) {
      const s = secAt(z);
      const dx = s.chineX - s.railX, dy = s.chineY - s.railY;
      const len = Math.hypot(dx, dy);
      const nx = -dy / len, ny = dx / len;
      const p = (t) => [side * (s.railX + dx * t + nx * 0.012), s.railY + dy * t + ny * 0.012, z];
      rows.push([p(0.04), p(0.17)]);
    }
    glowGeos.push(loft(rows, side === 1));
  }
  const tailGlow = new THREE.BoxGeometry(0.26, 0.05, 0.03);
  tailGlow.translate(0, 0.44, -1.708);
  glowGeos.push(tailGlow);
  const screenGlow = new THREE.BoxGeometry(0.10, 0.045, 0.014);
  screenGlow.translate(0, 1.015, 0.481);
  glowGeos.push(screenGlow);
  const glowMesh = new THREE.Mesh(
    mergeGeometries(glowGeos),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), toneMapped: false })
  );
  group.add(glowMesh);

  // ================= 号码贴纸（侧 ×2 + 艏部前贴） =================
  const tex = makeNumberTexture(name, number, color);
  const decalMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const decalGeos = [];
  const dL = new THREE.PlaneGeometry(0.44, 0.44);
  dL.rotateY(-Math.PI / 2); dL.rotateZ(0.08); dL.translate(-0.545, 0.30, -0.35);
  const dR = new THREE.PlaneGeometry(0.44, 0.44);
  dR.rotateY(Math.PI / 2); dR.rotateZ(-0.08); dR.translate(0.545, 0.30, -0.35);
  const dF = new THREE.PlaneGeometry(0.32, 0.28);
  dF.rotateX(-0.18); dF.translate(0, 0.82, 1.09);   // 艏部立式号码牌，底缘略高于甲板
  decalGeos.push(dL, dR, dF);
  const decalMesh = new THREE.Mesh(mergeGeometries(decalGeos), decalMat);
  group.add(decalMesh);

  // ================= 船头小风挡（半透明弧面玻璃） =================
  const glassGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.30, 12, 1, true, -0.6, 1.2);
  glassGeo.rotateX(-0.5);
  glassGeo.translate(0, 0.89, 0.768);
  const glassMesh = new THREE.Mesh(glassGeo, new THREE.MeshStandardMaterial({
    color: '#8fd0f0', transparent: true, opacity: 0.30, roughness: 0.12, metalness: 0.25,
    side: THREE.DoubleSide, depthWrite: false,
  }));
  group.add(glassMesh);
  const wsTop = new THREE.BoxGeometry(0.32, 0.014, 0.022);
  wsTop.rotateX(-0.5);
  wsTop.translate(0, 1.026, 0.696);
  bodyGeos.push(colored(wsTop, '#10141b'));
  // 仪表台（风挡基座）
  const dash = new THREE.BoxGeometry(0.30, 0.05, 0.14);
  dash.rotateX(-0.35);
  dash.translate(0, 0.735, 0.82);
  bodyGeos.push(colored(dash, '#10141b'));

  // ================= 驾驶角色（独立 Group，姿态由外部驱动） =================
  // 屈膝坐姿：大腿水平、小腿近竖直；躯干前倾；骑行夹克(accent) + 主色护具
  const rider = new THREE.Group();
  const rg = [];
  const PANTS = '#151a21', GLOVE = '#0f131a', HELMET = '#e8edf4', LENS = '#10141c';
  const pelvis = new THREE.BoxGeometry(0.26, 0.15, 0.24);
  pelvis.translate(0, 0.985, -0.28);
  rg.push(colored(pelvis, PANTS));
  const torso = new THREE.CapsuleGeometry(0.15, 0.10, 4, 10);
  torso.rotateX(0.60); torso.translate(0, 1.155, -0.175);          // 前倾 34°
  rg.push(colored(torso, accent));
  const chest = new THREE.CapsuleGeometry(0.163, 0.05, 4, 10);     // 胸部主色护甲带
  chest.rotateX(0.60); chest.translate(0, 1.25, -0.115);
  rg.push(colored(chest, color));
  const hump = new THREE.SphereGeometry(0.07, 8, 6);               // 骑行驼峰
  hump.translate(0, 1.30, -0.31);
  rg.push(colored(hump, color));
  const neck = new THREE.CylinderGeometry(0.06, 0.07, 0.14, 8);
  neck.rotateX(0.55); neck.translate(0, 1.36, 0.0);
  rg.push(colored(neck, PANTS));
  const helmet = new THREE.SphereGeometry(0.145, 14, 12);
  helmet.translate(0, 1.435, 0.10);                                 // 头顶 ≤1.6
  rg.push(colored(helmet, HELMET));
  const visor = new THREE.SphereGeometry(0.118, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.42);
  visor.rotateX(0.5); visor.translate(0, 1.45, 0.175);
  rg.push(colored(visor, LENS));
  const chin = new THREE.BoxGeometry(0.13, 0.05, 0.10);
  chin.translate(0, 1.365, 0.175);
  rg.push(colored(chin, LENS));
  const fin = new THREE.BoxGeometry(0.024, 0.05, 0.16);            // 头盔鳍
  fin.rotateX(-0.1); fin.translate(0, 1.565, 0.02);
  rg.push(colored(fin, accent));
  for (const side of [1, -1]) {
    const pad = new THREE.SphereGeometry(0.068, 8, 6);              // 护肩
    pad.translate(side * 0.185, 1.27, -0.075);
    rg.push(colored(pad, color));
    // 手臂两段伸向握把 (±0.30, 1.0, 0.34)
    rg.push(limb(v(side * 0.185, 1.27, -0.075), v(side * 0.345, 1.14, 0.10), 0.052, accent));
    rg.push(limb(v(side * 0.345, 1.14, 0.10), v(side * 0.31, 1.02, 0.28), 0.044, accent));
    const glove = new THREE.SphereGeometry(0.052, 8, 6);
    glove.translate(side * 0.30, 1.0, 0.335);
    rg.push(colored(glove, GLOVE));
    // 腿：大腿近水平（髋→膝），小腿近竖直（膝→踝），踩侧踏板槽
    rg.push(limb(v(side * 0.135, 0.965, -0.26), v(side * 0.265, 0.93, 0.09), 0.078, PANTS));
    const knee = new THREE.SphereGeometry(0.082, 8, 6);             // 护膝
    knee.scale(1, 1, 0.85); knee.translate(side * 0.267, 0.93, 0.10);
    rg.push(colored(knee, color));
    rg.push(limb(v(side * 0.265, 0.92, 0.10), v(side * 0.375, 0.65, 0.03), 0.055, PANTS));
    const boot = new THREE.BoxGeometry(0.095, 0.075, 0.21);
    boot.translate(side * 0.415, 0.665, 0.045);
    rg.push(colored(boot, GLOVE));
  }
  for (const g of rg) g.translate(0, 0, 0.15);                      // rider group 位于 (0,0,-0.15)
  const riderMesh = new THREE.Mesh(mergeGeometries(rg), skiBodyMaterial());
  rider.add(riderMesh);
  rider.position.set(0, 0, -0.15);
  group.add(rider);

  // ================= 镀铬件（车把立柱/横杆、扶手、喷水口环） =================
  chromeGeos.push(new THREE.TorusGeometry(0.115, 0.017, 8, 16).translate(0, 0.14, -1.735));
  chromeGeos.push(new THREE.TorusGeometry(0.092, 0.013, 8, 14).translate(0, 0.14, -1.83));
  const chromeMesh = new THREE.Mesh(mergeGeometries(chromeGeos), new THREE.MeshStandardMaterial({
    color: '#d8dee8', roughness: 0.2, metalness: 0.85, envMapIntensity: 1.1,
  }));
  group.add(chromeMesh);

  const bodyMesh = new THREE.Mesh(mergeGeometries(bodyGeos), skiBodyMaterial());
  group.add(bodyMesh);

  return { group, rider, glowMesh, bodyMesh, decalMesh };
}

let _bodyMat = null;
function skiBodyMaterial() {
  if (!_bodyMat) {
    _bodyMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.3, metalness: 0.15, envMapIntensity: 0.7,
    });
  }
  return _bodyMat;
}

// ---------- 预设配色 ----------
export const RIDER_PRESETS = [
  { name: 'YOU',     number: '1', color: '#ff2d4d', accent: '#ffffff' },
  { name: 'NEON',    number: '7', color: '#19ffc4', accent: '#0b2e26' },
  { name: 'WAVE',    number: '3', color: '#2e7cff', accent: '#eaf2ff' },
  { name: 'RIDER_07',number: '7', color: '#ffcf3f', accent: '#2b2105' },
  { name: 'BLUE',    number: '4', color: '#3a5cff', accent: '#eaf2ff' },
  { name: 'STORM',   number: '9', color: '#ff3fa4', accent: '#2b0a1e' },
  { name: 'AQUA',    number: '2', color: '#00e5ff', accent: '#04222b' },
  { name: 'TURBO',   number: '5', color: '#ff6a00', accent: '#2b1200' },
];
