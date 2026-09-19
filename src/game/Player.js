// Ħ��ͧ�ֻ����� ���� ����� AI ���ã�AI ͨ����д getInput �ṩ��������
import * as THREE from 'three';
import { buildJetSki } from './JetSki.js';
import { oceanHeight, oceanNormal } from './WaveMath.js';

const GRAV = 24;
const MAX_SPEED = 29, BOOST_SPEED = 38, TURBO_SPEED = 33.5;
const ACCEL = 15, BRAKE = 14;

export class Player {
  constructor(game, preset, isPlayer) {
    this.game = game;
    this.preset = preset;
    this.isPlayer = isPlayer;
    this.name = preset.name;
    this.color = preset.color;

    const built = buildJetSki(preset);
    this.group = built.group;
    this.rider = built.rider;
    this.group.rotation.order = 'YXZ';
    game.scene.add(this.group);

    // Boost β��
    this.flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.15, 0.8, 10),
      new THREE.MeshBasicMaterial({ color: '#7fe0ff', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, toneMapped: false, depthWrite: false })
    );
    this.flame.geometry.rotateX(-Math.PI / 2);
    this.flame.position.set(0, 0.14, -2.0);
    this.flame.visible = false;
    this.group.add(this.flame);

    // ����
    this.shieldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.7, 18, 14),
      new THREE.MeshBasicMaterial({ color: '#4dc8ff', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, toneMapped: false, depthWrite: false })
    );
    this.shieldMesh.position.y = 0.7;
    this.shieldMesh.visible = false;
    this.group.add(this.shieldMesh);

    // ״̬
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();     // ˮƽ���ٶ�
    this.yaw = 0;
    this.vy = 0;
    this.grounded = true;
    this.airTime = 0;
    this.surfH = 0;
    this._prevSurfH = 0;
    this.surfN = new THREE.Vector3(0, 1, 0);
    this.speed = 0;

    this.boostMeter = 50;               // 0..100
    this.boosting = false;
    this.turboT = 0;
    this.shieldT = 0;
    this.stunT = 0;

    // �ؼ�
    this.airRotX = 0; this.airRotZ = 0;
    this.combo = 0; this.comboT = 0;
    this.trickCount = 0; this.trickScore = 0;

    // ͳ��
    this.distance = 0; this.boostUsed = 0;
    this.finished = false; this.finishTime = 0;
    this.progress = 0;                  // RaceManager ��д

    this._n = new THREE.Vector3();
  }

  // ���� ������Դ��AI ��д�˷��������������룩 ����
  // autoInput���������� Game ע���Ѳ�����루����ע����Ǹ�д��������
  // ��֤����/�ز˵��� _resetSkis ������ɻָ��ֶ����ƣ�
  getInput() {
    if (this.autoInput) return this.autoInput;
    const inp = this.game.input;
    return { throttle: inp.throttle, steer: inp.steer, boost: inp.boost, pitch: inp.pitchKey };
  }

  reset(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.vy = 0;
    this.speed = 0;
    this.grounded = true;
    this.airTime = 0;
    this.boostMeter = 50;
    this.boosting = false;
    this.turboT = 0; this.shieldT = 0; this.stunT = 0;
    this.airRotX = 0; this.airRotZ = 0;
    this.combo = 0; this.comboT = 0;
    this.distance = 0;
    this.finished = false; this.finishTime = 0;
    this.surfH = oceanHeight(x, z, this.game.ocean.time);
    this.pos.y = this.surfH;
    this._prevSurfH = this.surfH;
    this.group.visible = true;
  }

  update(dt, t) {
    const inp = this.stunT > 0 ? { throttle: 0, steer: 0, boost: false, pitch: 0 } : this.getInput();
    if (this.stunT > 0) this.stunT -= dt;

    // ---------- Boost ----------
    const wantBoost = inp.boost && this.boostMeter > 1 && this.grounded && inp.throttle > 0;
    if (wantBoost && !this.boosting) this.boostUsed++;
    this.boosting = wantBoost;
    if (this.boosting) this.boostMeter = Math.max(0, this.boostMeter - 20 * dt);
    else if (this.finished === false) this.boostMeter = Math.min(100, this.boostMeter + 3.4 * dt);
    if (this.turboT > 0) this.turboT -= dt;
    if (this.shieldT > 0) { this.shieldT -= dt; if (this.shieldT <= 0) this.shieldMesh.visible = false; }
    this.shieldMesh.material.opacity = 0.12 + Math.sin(t * 8) * 0.05;
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }

    // ---------- ǰ���ٶ� ----------
    const turboMul = this.turboT > 0 ? 1.2 : 1;
    const vmax = (this.boosting ? BOOST_SPEED : (this.turboT > 0 ? TURBO_SPEED : MAX_SPEED)) * turboMul;
    const acc = ACCEL * (this.boosting ? 1.9 : 1) * (this.turboT > 0 ? 1.25 : 1);
    const thr = inp.throttle;

    if (!this.grounded) {
      // ���У������ٶȣ���΢����
      this.speed += thr * 2.5 * dt;
    } else if (thr > 0) {
      this.speed += acc * dt;
    } else if (thr < 0) {
      this.speed -= BRAKE * dt;
      if (this.speed < -7) this.speed = -7;
    }
    // �������ն��ٶ� �� 29 m/s �� 104 km/h��
    const drag = 0.10 * Math.abs(this.speed) + 0.0148 * this.speed * Math.abs(this.speed);
    const sgn = Math.sign(this.speed);
    this.speed -= sgn * Math.min(Math.abs(this.speed), (drag + (thr === 0 ? 2.2 : 0)) * dt);
    if (this.speed > vmax) this.speed -= (this.speed - vmax) * 2.2 * dt;

    // ---------- ת�� ----------
    const vAbs = Math.abs(this.speed);
    const turnEff = 1.9 * (0.4 + 0.6 * Math.min(vAbs / 9, 1)) * (1 - 0.42 * Math.min(vAbs / 32, 1));
    // 屏幕方向修正：相机在艇后沿艇艏朝向看，yaw=0 时艏朝 +Z，此时屏幕右方 = 世界 -X，
    // 因此 D/右（steer=+1）必须让 yaw 减小（艏从 +Z 转向 -X）才是屏幕右转 → 整体取反。
    // （倒车时沿用汽车逻辑：方向仍随 speed<0 反向，仅符号取反不改变该行为）
    const yawRate = this.grounded
      ? -inp.steer * turnEff * (this.speed < 0 ? -1 : 1)
      : -inp.steer * turnEff * 0.3;
    this.yaw += yawRate * dt;

    // ---------- �ٶ�������Ư�� = �ٶȷ����ͺ��ڴ�ͷ�� ----------
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const grip = this.grounded ? (vAbs > 16 && Math.abs(inp.steer) > 0.5 ? 3.4 : 5.2) : 0.45;
    const tx = fx * this.speed, tz = fz * this.speed;
    const k = 1 - Math.exp(-grip * dt);
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;
    if (!this.grounded) {
      // ���б���ǰ��ʸ��
      this.vel.x += (fx * this.speed - this.vel.x) * 0.5 * dt;
      this.vel.z += (fz * this.speed - this.vel.z) * 0.5 * dt;
    }
    // ���ټ�תƯ��ʱ�ٶ���΢��ʧ
    if (this.grounded && vAbs > 16 && Math.abs(inp.steer) > 0.5) {
      this.speed *= 1 - 0.28 * dt;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.distance += vAbs * dt;

    // ---------- ������� ----------
    const h = oceanHeight(this.pos.x, this.pos.z, t);
    oceanNormal(this.pos.x, this.pos.z, t, this.surfN);
    this.surfH = h;

    if (this.grounded) {
      this.pos.y = h;
      // ������ɼ�⣺���º������̧��
      const dhSurf = (h - this._prevSurfH) / dt;
      if (dhSurf > 5.0 && vAbs > 11) {
        this.launch(Math.min(3 + dhSurf * 0.75, 15) * (0.72 + vAbs * 0.012));
      } else {
        // ��Ծ
        if (this.isPlayer && this.game.input.consumeJump() && vAbs > 8) {
          this.launch(7.0 + vAbs * 0.07);
        } else if (!this.isPlayer) {
          this.tryAIJump(vAbs);
        }
        // ��̨
        this.checkRamp(vAbs);
      }
    } else {
      this.airTime += dt;
      this.vy -= GRAV * dt;
      this.pos.y += this.vy * dt;
      // �����ؼ���ת
      this.airRotX += inp.pitch * 5.8 * dt;
      this.airRotZ += inp.steer * 7.2 * dt;
      if (this.pos.y <= h + 0.04) this.land(h, vAbs);
    }
    this._prevSurfH = h;

    // ---------- �Ӿ���̬ ----------
    this.updateVisual(dt, inp, t);
  }

  tryAIJump(vAbs) {}   // AI ��д
  checkRamp(vAbs) {
    for (const r of this.game.launchZones) {
      const dx = this.pos.x - r.x, dz = this.pos.z - r.z;
      const c = Math.cos(-r.yaw), s = Math.sin(-r.yaw);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < r.w / 2 && Math.abs(lz) < r.d / 2 && vAbs > 14) {
        this.launch(8.5 + vAbs * 0.22);
        break;
      }
    }
  }

  launch(vy) {
    this.grounded = false;
    this.vy = vy;
    this.airRotX = 0; this.airRotZ = 0;
    this.airTime = 0;
    if (this.isPlayer) this.game.effects.sprayBurst(this.pos, 14, 1.3);
  }

  land(h, vAbs) {
    const impact = -this.vy;
    this.grounded = true;
    this.pos.y = h;
    this.vy = 0;
    const wasAir = this.airTime;
    this.airTime = 0;

    // �ؼ�����
    const flips = Math.round(this.airRotX / (Math.PI * 2));
    const rolls = Math.round(this.airRotZ / (Math.PI * 2));
    const flipClean = Math.abs(this.airRotX - flips * Math.PI * 2) < 1.1;
    const rollClean = Math.abs(this.airRotZ - rolls * Math.PI * 2) < 1.1;
    const nFlips = Math.abs(flips), nRolls = Math.abs(rolls);

    if (impact > 3.5) {
      this.game.effects.splashRing(this.pos, Math.min(impact * 0.09, 1.4));
      this.game.effects.sprayBurst(this.pos, Math.min(8 + impact * 2.2, 42), Math.min(impact * 0.11, 2.0));
      if (this.isPlayer) {
        this.game.cameraRig.shake(Math.min(impact * 0.022, 0.5));
        this.game.audio.land(impact);
      }
    }

    if ((nFlips > 0 && flipClean) || (nRolls > 0 && rollClean)) {
      let base = 0, label = '';
      if (nFlips > 0) { base = 250 * nFlips; label = (this.airRotX > 0 ? '前空翻' : '后空翻') + (nFlips > 1 ? ` x${nFlips}` : ''); }
      if (nRolls > 0) { base += 180 * nRolls; label += (label ? ' + ' : '') + (this.airRotZ > 0 ? '右滚翻' : '左滚翻') + (nRolls > 1 ? ` x${nRolls}` : ''); }
      if (wasAir > 1.1) { base += 120; label += ' 大腾空'; }
      this.combo = Math.min(this.combo + 1, 5);
      this.comboT = 3.5;
      const pts = base * this.combo;
      this.trickCount++;
      this.trickScore += pts;
      this.boostMeter = Math.min(100, this.boostMeter + 16);
      if (this.combo >= 2) label += `  连击x${this.combo}`;
      if (this.isPlayer) {
        this.game.onTrick(this, label, pts);
        this.game.audio.trick();
      }
      // 完美落地 ����
      if (impact < 7 && this.combo >= 2) {
        this.trickScore += 500;
        if (this.isPlayer) { this.game.onTrick(this, '完美落地', 500); this.game.audio.trick(); }
      }
    } else if (nFlips > 0 || nRolls > 0) {
      // ������תδ��� �� ��ˮ
      this.speed *= 0.35; this.vel.multiplyScalar(0.35);
      this.stunT = 1.0;
      this.combo = 0;
      this.game.effects.splashRing(this.pos, 1.6);
      this.game.effects.sprayBurst(this.pos, 40, 2.2);
      if (this.isPlayer) { this.game.cameraRig.shake(0.6); this.game.audio.crash(0.7); }
    }
    if (impact > 16) this.speed *= 0.9;
  }

  updateVisual(dt, inp, t) {
    const g = this.group;
    g.position.copy(this.pos);

    // ������̬
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = fz, rz = -fx; // �ҷ���
    const slopeF = (this.surfN.x * fx + this.surfN.z * fz) / Math.max(this.surfN.y, 0.3);
    const slopeR = (this.surfN.x * rx + this.surfN.z * rz) / Math.max(this.surfN.y, 0.3);
    let pitch = Math.atan(slopeF) * 0.9;
    let roll = Math.atan(slopeR) * 0.9;

    // ת����� + ����̧ͷ
    const lean = inp.steer * Math.min(Math.abs(this.speed) / 24, 1);
    // 屏幕方向修正：D 右转时车身向屏幕右侧压（+z 旋转 = 顶部向屏幕右倾，与取反后的 yawRate 一致）
    roll += lean * 0.38;
    pitch -= (inp.throttle > 0 ? 0.05 : 0) + Math.min(this.speed / 200, 0.05);

    if (!this.grounded) {
      pitch += this.airRotX;
      roll += this.airRotZ;
      pitch = Math.max(pitch, -0.15); // ��ˮʱ��΢̧ͷ
    }

    // steer 项随 yawRate 一并取反（空中机头视觉偏移方向与新的偏航方向一致）
    g.rotation.y = this.yaw + (this.grounded ? 0 : -inp.steer * this.airTime * 0.6);
    g.rotation.x += (pitch - g.rotation.x) * Math.min(10 * dt, 1);
    g.rotation.z += (roll - g.rotation.z) * Math.min(10 * dt, 1);

    // ��ʻ�У��������/ǰ��/��������
    const r = this.rider;
    const targetRz = lean * 0.5, targetRx = this.boosting ? -0.22 : (inp.throttle > 0 ? -0.12 : 0);
    if (!this.grounded) { r.rotation.z *= 0.9; r.position.y = Math.min(r.position.y + dt * 2, 0.12); }
    else { r.position.y += (0 - r.position.y) * 6 * dt; }
    r.rotation.z += (targetRz - r.rotation.z) * 8 * dt;
    r.rotation.x += (targetRx - r.rotation.x) * 6 * dt;

    // β��
    this.flame.visible = this.boosting;
    if (this.boosting) {
      this.flame.scale.set(1, 1, 0.8 + Math.sin(t * 40) * 0.25 + Math.random() * 0.2);
      this.flame.material.opacity = 0.7 + Math.random() * 0.3;
    }
  }
}
