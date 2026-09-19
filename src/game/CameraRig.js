// 第三人称追踪镜头 —— 速度 FOV / 动态后拉 / 转弯侧倾 / 震动 / 起飞落水反应
import * as THREE from 'three';
import { oceanHeight } from './WaveMath.js';

const MODES = [
  { dist: 7.2, height: 2.9, fov: 64, look: 1.4 },   // 近
  { dist: 10.5, height: 4.4, fov: 60, look: 1.6 },  // 远
  { dist: 4.2, height: 1.9, fov: 70, look: 1.2 },   // 追焦
];

export class CameraRig {
  constructor(game) {
    this.game = game;
    this.cam = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.1, 6000);
    this.mode = 0;
    this.shakeAmp = 0;
    this.fov = 64;
    this._pos = new THREE.Vector3(0, 6, -12);
    this._look = new THREE.Vector3();
    this._shakeX = 0; this._shakeY = 0;
    this.roll = 0;
    this.cinematic = true;   // 菜单模式：环绕镜头
    this.cineT = 0;
    this.enabled = true;
    addEventListener('resize', () => {
      this.cam.aspect = innerWidth / innerHeight;
      this.cam.updateProjectionMatrix();
    });
  }

  shake(a) { if (this.game.settings.shake) this.shakeAmp = Math.min(this.shakeAmp + a, 1.2); }

  cycleMode() { this.mode = (this.mode + 1) % MODES.length; }

  update(dt, ski, t) {
    const cam = this.cam;

    // ---- 菜单环绕镜头 ----
    if (this.cinematic && ski) {
      this.cineT += dt * 0.16;
      const r = 17 + Math.sin(this.cineT * 0.7) * 5;
      cam.position.set(
        ski.pos.x + Math.cos(this.cineT) * r,
        4.5 + Math.sin(this.cineT * 0.5) * 2.5,
        ski.pos.z + Math.sin(this.cineT) * r
      );
      // 浪头防穿：环绕镜头任何时刻不得低于其脚下海面 + 3.5m
      const minY = oceanHeight(cam.position.x, cam.position.z, t) + 3.5;
      if (cam.position.y < minY) cam.position.y = minY;
      this._look.set(ski.pos.x, ski.pos.y + 1.2, ski.pos.z);
      cam.lookAt(this._look);
      cam.fov += (58 - cam.fov) * 2 * dt;
      cam.updateProjectionMatrix();
      return;
    }
    if (!ski) return;

    const m = MODES[this.mode];
    const speedF = Math.min(ski.speed / 34, 1);

    // 目标位置：船后 + 高
    const fx = Math.sin(ski.yaw), fz = Math.cos(ski.yaw);
    const dist = m.dist + speedF * 1.8 + (ski.boosting ? 1.2 : 0);
    const height = m.height + speedF * 0.5;
    const tx = ski.pos.x - fx * dist;
    const tz = ski.pos.z - fz * dist;
    const ty = ski.pos.y + height;

    // 阻尼跟随（水平快、垂直稍慢 → 有漂浮感）
    const kPos = 1 - Math.exp(-7.5 * dt);
    const kY = 1 - Math.exp(-5.2 * dt);
    this._pos.x += (tx - this._pos.x) * kPos;
    this._pos.z += (tz - this._pos.z) * kPos;
    this._pos.y += (ty - this._pos.y) * kY;
    cam.position.copy(this._pos);

    // 视线：船头前方
    const kLook = 1 - Math.exp(-9 * dt);
    const lx = ski.pos.x + fx * 5;
    const lz = ski.pos.z + fz * 5;
    const ly = ski.pos.y + m.look + (ski.grounded ? 0 : 0.6);
    this._look.x += (lx - this._look.x) * kLook;
    this._look.z += (lz - this._look.z) * kLook;
    this._look.y += (ly - this._look.y) * kLook;

    // 转弯侧倾
    const steerLean = ski.isPlayer ? this.game.input.steer : (ski.visSteer || 0);
    this.roll += (-steerLean * speedF * 0.055 - this.roll) * 4 * dt;

    // 震动衰减
    this.shakeAmp *= Math.exp(-4.5 * dt);
    const sh = this.shakeAmp + speedF * speedF * 0.05 + (ski.boosting ? 0.06 : 0);
    const sx = (Math.sin(t * 61.7) + Math.sin(t * 39.3) * 0.6) * sh * 0.24;
    const sy = (Math.sin(t * 47.9) + Math.sin(t * 33.1) * 0.6) * sh * 0.2;

    cam.up.set(Math.sin(this.roll), Math.cos(this.roll), 0);
    cam.lookAt(this._look);
    cam.position.x += sx; cam.position.y += sy;
    cam.up.set(0, 1, 0);

    // FOV：速度 + Boost
    const targetFov = m.fov + speedF * 13 + (ski.boosting ? 8 : 0) + (ski.grounded ? 0 : -3);
    this.fov += (targetFov - this.fov) * 3.2 * dt;
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
  }
}
