// 海上环境 —— 低模岛屿/灯塔/礁石/跳台/浮标/海鸥/远处船只（Stylized 明亮风）
import * as THREE from 'three';
import { OBSTACLES, RAMP, TRACK } from './Track.js';
import { oceanHeight } from './WaveMath.js';

const flat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0, ...opts });

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.colliders = OBSTACLES;
    this.floaters = [];   // {obj, phase, baseY} 随浪漂浮物
    this.gulls = [];
    this.beam = null;

    this._buildIslands();
    this._buildRamp();
    this._buildBuoys();
    this._buildShips();
    this._buildGulls(9);
  }

  // ---------- 岛屿 ----------
  _islandMesh(r, big) {
    const g = new THREE.Group();
    const sand = new THREE.Mesh(new THREE.ConeGeometry(r, r * 0.28, 9), flat('#efd98a'));
    sand.rotation.x = Math.PI;
    sand.position.y = r * 0.14;
    g.add(sand);
    const grass = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.8, r * 0.22, 9), flat(big ? '#5fce6e' : '#7ad877'));
    grass.position.y = r * 0.30;
    g.add(grass);
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r * 0.4, 0), flat('#9aa7b0'));
    rock.position.set(r * 0.3, r * 0.45, -r * 0.2);
    rock.rotation.set(0.4, 0.8, 0.2);
    g.add(rock);
    return g;
  }

  _buildIslands() {
    // 大岛 + 灯塔
    const big = OBSTACLES[0];
    const isl = this._islandMesh(big.r, true);
    isl.position.set(big.x, oceanHeight(big.x, big.z, 0) * 0.5, big.z);
    this.scene.add(isl);

    const lh = new THREE.Group();
    const matW = flat('#f4f8fc', { roughness: 0.5 }), matR = flat('#ff4040', { roughness: 0.5 });
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(2.4 - i * 0.35, 2.7 - i * 0.35, 4.2, 10), i % 2 ? matR : matW);
      seg.position.y = 2.1 + i * 4.2;
      lh.add(seg);
    }
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 2.2, 10),
      new THREE.MeshBasicMaterial({ color: '#fff3b0', toneMapped: false }));
    lamp.position.y = 19;
    lh.add(lamp);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.6, 10), matR);
    cap.position.y = 21;
    lh.add(cap);
    // 旋转扫光
    const beam = this.beam = new THREE.Mesh(
      new THREE.ConeGeometry(7, 60, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: '#fff6c8', transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
    );
    beam.rotation.z = Math.PI / 2;
    beam.position.y = 19;
    const beamPivot = new THREE.Group();
    beamPivot.position.y = 19;
    beam.position.set(30, 0, 0);
    beamPivot.add(beam);
    lh.add(beamPivot);
    this.beamPivot = beamPivot;
    lh.position.set(big.x, big.r * 0.32, big.z);
    this.scene.add(lh);

    // 小岛
    const small = OBSTACLES[1];
    const isl2 = this._islandMesh(small.r, false);
    isl2.position.set(small.x, 0, small.z);
    this.scene.add(isl2);

    // 礁石群
    for (let i = 2; i < OBSTACLES.length; i++) {
      const o = OBSTACLES[i];
      for (let j = 0; j < 5; j++) {
        const a = (j / 5) * Math.PI * 2 + i;
        const rr = o.r * (0.35 + Math.random() * 0.5);
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(rr * 0.55, 0), flat('#8b98a3'));
        const x = o.x + Math.cos(a) * o.r * 0.6, z = o.z + Math.sin(a) * o.r * 0.6;
        rock.position.set(x, oceanHeight(x, z, 0) + rr * 0.18, z);
        rock.rotation.set(Math.random(), Math.random() * 6, Math.random());
        this.scene.add(rock);
      }
    }

    // 岸边泡沫环
    this.foamRings = [];
    for (const o of OBSTACLES) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(o.r * 1.02, o.r * 1.18, 40),
        new THREE.MeshBasicMaterial({ color: '#eaffff', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, toneMapped: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(o.x, 0.2, o.z);
      ring.renderOrder = 2;
      this.scene.add(ring);
      this.foamRings.push(ring);
    }
  }

  // ---------- 跳台 ----------
  _buildRamp() {
    const g = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(RAMP.w, 0.6, RAMP.d * 1.35), flat('#b98a4e', { roughness: 0.7 }));
    deck.rotation.x = -0.21;                     // 抬升远端
    deck.position.set(0, 1.0, RAMP.d * 0.18);
    g.add(deck);
    for (let i = 0; i < 3; i++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(RAMP.w, 0.06, 0.7), flat('#ffb020', { roughness: 0.5 }));
      stripe.rotation.x = -0.21;
      stripe.position.set(0, 1.0 + (i - 1) * 1.15, RAMP.d * 0.18 + (i - 1) * 1.35);
      g.add(stripe);
    }
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.2, 0.5), flat('#6e4f2a'));
    legL.position.set(-RAMP.w / 2 + 0.6, 0.6, RAMP.d * 0.5);
    const legR = legL.clone(); legR.position.x = RAMP.w / 2 - 0.6;
    g.add(legL, legR);
    g.position.set(RAMP.x, oceanHeight(RAMP.x, RAMP.z, 0) - 0.35, RAMP.z);
    g.rotation.y = RAMP.yaw;
    this.scene.add(g);
    this.ramp = g;
    this.floaters.push({ obj: g, phase: 0, baseY: g.position.y, amp: 0.18 });
  }

  // ---------- 浮标 ----------
  _buildBuoys() {
    const buoyGeo = new THREE.ConeGeometry(0.8, 2.0, 8);
    const ringGeo = new THREE.TorusGeometry(0.55, 0.1, 6, 14);
    const mats = [flat('#ff4646', { roughness: 0.4 }), flat('#ffd23d', { roughness: 0.4 })];
    const glowMat = new THREE.MeshBasicMaterial({ color: '#ffe27a', toneMapped: false });
    for (let i = 0; i < 8; i++) {
      // 散布在赛道线外侧
      const t = i / 8, a = t * Math.PI * 2;
      const cx = 140 + Math.cos(a) * 380, cz = 230 + Math.sin(a) * 330;
      const x = cx + (Math.random() - 0.5) * 60, z = cz + (Math.random() - 0.5) * 60;
      if (this._nearTrack(x, z, 30)) continue;
      const m = new THREE.Mesh(buoyGeo, mats[i % 2]);
      m.position.set(x, oceanHeight(x, z, 0), z);
      const glow = new THREE.Mesh(ringGeo, glowMat);
      glow.rotation.x = Math.PI / 2;
      glow.position.y = 1.4;
      m.add(glow);
      this.scene.add(m);
      this.floaters.push({ obj: m, phase: Math.random() * 6, baseY: m.position.y, amp: 0.3, sway: true });
    }
  }

  _nearTrack(x, z, minD) {
    for (let i = 0; i < TRACK.length; i++) {
      const a = TRACK[i], b = TRACK[(i + 1) % TRACK.length];
      const abx = b.x - a.x, abz = b.z - a.z;
      const apx = x - a.x, apz = z - a.z;
      const len2 = abx * abx + abz * abz;
      const tt = Math.max(0, Math.min(1, (apx * abx + apz * abz) / len2));
      const dx = x - (a.x + abx * tt), dz = z - (a.z + abz * tt);
      if (dx * dx + dz * dz < minD * minD) return true;
    }
    return false;
  }

  // ---------- 远处船只 ----------
  _buildShips() {
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 26), flat(i ? '#c9d4dc' : '#e08840'));
      hull.position.y = 1;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 8), flat('#f4f8fc'));
      cab.position.set(0, 4, -3);
      g.add(hull, cab);
      const a = Math.random() * Math.PI * 2;
      const r = 950 + Math.random() * 450;
      g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      g.rotation.y = Math.random() * 6;
      this.scene.add(g);
    }
  }

  // ---------- 海鸥 ----------
  _buildGulls(n) {
    const bodyGeo = new THREE.ConeGeometry(0.22, 1.1, 6);
    bodyGeo.rotateX(Math.PI / 2);
    const wingGeo = new THREE.PlaneGeometry(1.3, 0.42);
    const mat = flat('#fbfdff', { roughness: 0.6 });
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, mat);
      const wl = new THREE.Mesh(wingGeo, mat); wl.rotation.y = Math.PI / 2; wl.position.x = -0.68;
      const wr = wl.clone(); wr.position.x = 0.68;
      g.add(body, wl, wr);
      this.scene.add(g);
      this.gulls.push({
        g, wl, wr,
        cx: (Math.random() - 0.5) * 700, cz: 250 + (Math.random() - 0.5) * 600,
        r: 25 + Math.random() * 45, spd: 0.25 + Math.random() * 0.3,
        a: Math.random() * 6, y0: 7 + Math.random() * 9, flap: 6 + Math.random() * 4,
      });
    }
  }

  setQuality(q) {
    this.gulls.forEach((b, i) => { b.g.visible = i < q.gulls; });
  }

  update(dt, t, camPos) {
    // 漂浮物贴浪
    for (const f of this.floaters) {
      f.obj.position.y = oceanHeight(f.obj.position.x, f.obj.position.z, t) + f.amp + Math.sin(t * 1.6 + f.phase) * 0.12;
      if (f.sway) f.obj.rotation.z = Math.sin(t * 1.8 + f.phase) * 0.14;
    }
    // 泡沫环脉动
    for (let i = 0; i < this.foamRings.length; i++) {
      const r = this.foamRings[i];
      r.position.y = oceanHeight(r.position.x, r.position.z, t) + 0.15;
      const s = 1 + Math.sin(t * 2 + i) * 0.02;
      r.scale.set(s, s, 1);
      r.material.opacity = 0.35 + Math.sin(t * 2 + i) * 0.15;
    }
    // 灯塔扫光
    if (this.beamPivot) this.beamPivot.rotation.y = t * 0.6;
    // 海鸥
    for (const b of this.gulls) {
      if (!b.g.visible) continue;
      b.a += b.spd * dt;
      const x = b.cx + Math.cos(b.a) * b.r, z = b.cz + Math.sin(b.a) * b.r;
      b.g.position.set(x, oceanHeight(x, z, t) + b.y0 + Math.sin(t * 0.7 + b.a) * 1.2, z);
      b.g.rotation.y = -b.a; // 朝向切线
      const flap = Math.sin(t * b.flap + b.a * 3) * 0.55;
      b.wl.rotation.x = flap;
      b.wr.rotation.x = -flap;
    }
  }
}
