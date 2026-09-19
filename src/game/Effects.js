// 特效 —— 水花 / 尾流泡沫 / 冲击水环（对象池 + Points 自定义着色器）
import * as THREE from 'three';
import { oceanHeight } from './WaveMath.js';

function makeSpriteTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePoolMaterial(tex) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: { uTex: { value: tex } },
    vertexShader: /* glsl */`
      attribute float aSize;
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (240.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uTex;
      varying float vAlpha;
      void main() {
        vec4 c = texture2D(uTex, gl_PointCoord);
        gl_FragColor = vec4(vec3(0.97, 0.99, 1.0), c.a * vAlpha);
      }`,
  });
}

class ParticlePool {
  constructor(scene, count, gravity) {
    this.count = count;
    this.gravity = gravity;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.size = new Float32Array(count);
    this.grow = new Float32Array(count);
    this.baseAlpha = new Float32Array(count);
    this.surface = false; // true = 贴海面（泡沫），false = 受重力（水花）
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.aSize = new THREE.BufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aAlpha', this.aAlpha);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.points = new THREE.Points(geo, makePoolMaterial(makeSpriteTexture()));
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, life, size, grow, alpha) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    this.pos[i*3] = x; this.pos[i*3+1] = y; this.pos[i*3+2] = z;
    this.vel[i*3] = vx; this.vel[i*3+1] = vy; this.vel[i*3+2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size; this.grow[i] = grow;
    this.baseAlpha[i] = alpha;
  }

  update(dt, t) {
    const g = this.gravity;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) { this.aAlpha.array[i] = 0; continue; }
      this.life[i] -= dt;
      const i3 = i * 3;
      if (!this.surface) {
        this.vel[i3+1] -= g * dt;
        this.pos[i3] += this.vel[i3] * dt;
        this.pos[i3+1] += this.vel[i3+1] * dt;
        this.pos[i3+2] += this.vel[i3+2] * dt;
        // 落回海面即消失
        if (this.pos[i3+1] < oceanHeight(this.pos[i3], this.pos[i3+2], t) - 0.1) this.life[i] = 0;
      } else {
        this.pos[i3] += this.vel[i3] * dt;
        this.pos[i3+2] += this.vel[i3+2] * dt;
        this.vel[i3] *= (1 - 0.8 * dt); this.vel[i3+2] *= (1 - 0.8 * dt);
        this.pos[i3+1] = oceanHeight(this.pos[i3], this.pos[i3+2], t) + 0.06;
      }
      this.size[i] += this.grow[i] * dt;
      const f = Math.max(this.life[i] / this.maxLife[i], 0);
      this.aSize.array[i] = this.size[i];
      this.aAlpha.array[i] = this.baseAlpha[i] * f * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
  }
}

export class Effects {
  constructor(game) {
    this.game = game;
    this.spray = new ParticlePool(game.scene, 900, 22);
    this.foam = new ParticlePool(game.scene, 700, 0);
    this.foam.surface = true;

    // 冲击水环池
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.7, 1.0, 28);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: '#eaffff', transparent: true, opacity: 0, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 2;
      game.scene.add(m);
      this.rings.push({ mesh: m, t: 0, dur: 0, scale0: 1 });
    }
    this._wakeAcc = 0;
  }

  setQuality(q) {
    this.sprayMaxEmit = q.particles;
  }

  // 速度型水花爆发（落水/碰撞/起飞）
  sprayBurst(pos, count, power) {
    const cap = Math.min(count * (this.game.qualityPreset.particles / 1.0), this.sprayMaxEmit || count);
    for (let i = 0; i < cap; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (2 + Math.random() * 7) * power;
      this.spray.emit(
        pos.x + (Math.random() - 0.5) * 1.6, pos.y + 0.15, pos.z + (Math.random() - 0.5) * 1.6,
        Math.cos(a) * sp, (2.5 + Math.random() * 5.5) * power * 0.8, Math.sin(a) * sp,
        0.7 + Math.random() * 0.7,
        0.55 + Math.random() * 0.75, 1.6, 0.85
      );
    }
  }

  splashRing(pos, scale) {
    for (const r of this.rings) {
      if (r.t >= r.dur) {
        r.t = 0; r.dur = 0.75; r.scale0 = scale;
        r.mesh.position.set(pos.x, pos.y + 0.1, pos.z);
        r.mesh.visible = true;
        return;
      }
    }
  }

  // 每帧为每艘艇发射尾流 + 侧向水花
  emitWake(ski, dt) {
    const v = Math.abs(ski.speed);
    if (v < 3 || !ski.grounded) {
      // 低速漂浮动
      this._wakeAcc += dt * 4;
      if (this._wakeAcc > 1) {
        this._wakeAcc = 0;
        const fx = Math.sin(ski.yaw), fz = Math.cos(ski.yaw);
        this.foam.emit(ski.pos.x - fx * 1.4, 0, ski.pos.z - fz * 1.4, 0, 0, 0, 1.6, 0.9, 0.5, 0.28);
      }
      return;
    }

    const rate = Math.min(v * 2.4, 90) * (ski.boosting ? 1.7 : 1) * this.game.qualityPreset.particles;
    this._wakeAcc += rate * dt;
    const fx = Math.sin(ski.yaw), fz = Math.cos(ski.yaw);
    const rx = fz, rz = -fx;
    const px = ski.pos.x - fx * 1.5, pz = ski.pos.z - fz * 1.5;

    while (this._wakeAcc > 1) {
      this._wakeAcc -= 1;
      const side = Math.random() < 0.5 ? -1 : 1;
      const off = (Math.random() - 0.5) * 1.1;
      // 尾流泡沫
      this.foam.emit(
        px + rx * off, 0, pz + rz * off,
        -fx * v * 0.12 + (Math.random() - 0.5) * 1.2, 0, -fz * v * 0.12 + (Math.random() - 0.5) * 1.2,
        1.4 + Math.random() * 1.2, 0.8 + Math.random() * 0.5, 1.9 + v * 0.05, 0.5
      );
      // 侧向飞溅水花（高速时更多）
      const sprayChance = Math.min((v - 12) / 26, 1) * (ski.boosting ? 1 : 0.7);
      if (Math.random() < sprayChance) {
        const sp = v * 0.24 * (0.5 + Math.random() * 0.8);
        this.spray.emit(
          ski.pos.x + rx * 0.55 * side + fx * 0.8, ski.pos.y + 0.2, ski.pos.z + rz * 0.55 * side + fz * 0.8,
          rx * sp * side + fx * v * 0.1, 1.8 + Math.random() * 3.2, rz * sp * side + fz * v * 0.1,
          0.5 + Math.random() * 0.5, 0.4 + Math.random() * 0.5, 1.2, 0.8
        );
      }
    }
    // Boost 强力尾喷
    if (ski.boosting && Math.random() < 0.7) {
      this.foam.emit(px, 0, pz, -fx * v * 0.35, 0, -fz * v * 0.35, 1.0, 1.4, 3.2, 0.75);
    }
  }

  update(dt, t) {
    this.spray.update(dt, t);
    this.foam.update(dt, t);
    for (const r of this.rings) {
      if (r.t < r.dur) {
        r.t += dt;
        const f = r.t / r.dur;
        const s = r.scale0 * (0.5 + f * 5.5);
        r.mesh.scale.set(s, s, 1);
        r.mesh.material.opacity = 0.75 * (1 - f) * (1 - f);
        if (r.t >= r.dur) r.mesh.visible = false;
      }
    }
  }
}
