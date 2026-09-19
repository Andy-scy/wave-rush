// 道具系统 —— BOOST(氮气) / SHIELD(护盾) / TURBO(极速) 浮环
import * as THREE from 'three';
import { PICKUP_SPOTS } from './Track.js';
import { oceanHeight } from './WaveMath.js';

export const PICKUP_COLORS = ['#ffd23d', '#4dc8ff', '#ff5c8a'];

export class Pickups {
  constructor(scene) {
    this.items = [];
    const ringGeo = new THREE.TorusGeometry(1.5, 0.13, 10, 26);
    const glowGeo = new THREE.TorusGeometry(1.85, 0.07, 8, 26);
    const iconGeos = [
      new THREE.OctahedronGeometry(0.6, 0),          // BOOST：晶体
      new THREE.IcosahedronGeometry(0.55, 0),        // SHIELD：盾形
      new THREE.ConeGeometry(0.5, 1.0, 6),           // TURBO：箭头
    ];

    for (const spot of PICKUP_SPOTS) {
      const kind = spot.kind;
      const color = PICKUP_COLORS[kind];
      const g = new THREE.Group();
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
      const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
      const icon = new THREE.Mesh(iconGeos[kind], new THREE.MeshBasicMaterial({ color, toneMapped: false }));
      if (kind === 2) icon.rotation.x = Math.PI; // 箭头朝上
      icon.position.y = kind === 0 ? 0 : 0.02;
      g.add(ring, glow, icon);
      g.position.set(spot.x, 0, spot.z);
      scene.add(g);
      this.items.push({ g, ring, glow, icon, kind, x: spot.x, z: spot.z, active: true, respawnT: 0, phase: Math.random() * 6 });
    }
  }

  checkCollide(pos) {
    for (const it of this.items) {
      if (!it.active) continue;
      const dx = pos.x - it.x, dz = pos.z - it.z;
      if (dx * dx + dz * dz < 36) {
        it.active = false;
        it.respawnT = 20;
        return it.kind;
      }
    }
    return null;
  }

  update(dt, t) {
    for (const it of this.items) {
      const baseY = oceanHeight(it.x, it.z, t) + 1.35 + Math.sin(t * 1.7 + it.phase) * 0.18;
      if (it.active) {
        it.g.visible = true;
        it.g.position.y = baseY;
        it.ring.rotation.y += dt * 1.2;
        it.icon.rotation.y -= dt * 1.8;
        it.icon.rotation.x += dt * 0.8;
        const pulse = 1 + Math.sin(t * 4 + it.phase) * 0.08;
        it.glow.scale.setScalar(pulse);
        it.g.scale.setScalar(1);
      } else {
        it.respawnT -= dt;
        if (it.respawnT <= 0) {
          it.active = true;
        } else if (it.respawnT > 19.6) {
          // 收集缩放动画
          it.g.scale.setScalar(Math.max((it.respawnT - 19.6) / 0.4, 0.01));
          it.g.position.y = baseY;
        } else {
          it.g.visible = false;
        }
      }
    }
  }
}
