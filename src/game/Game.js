// 游戏总控 —— 渲染管线 / 状态机 / 碰撞 / 画质自适应 / 联机桥接
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { Ocean } from './Ocean.js';
import { Sky, SUN_DIR } from './Sky.js';
import { Player } from './Player.js';
import { AIPlayer } from './AIPlayer.js';
import { RaceManager } from './RaceManager.js';
import { RIDER_PRESETS } from './JetSki.js';
import { Environment } from './Environment.js';
import { Pickups } from './Pickups.js';
import { TrackGuide } from './TrackGuide.js';
import { Effects } from './Effects.js';
import { CameraRig } from './CameraRig.js';
import { Input } from './Input.js';
import { AudioManager } from './AudioManager.js';
import { RAMP } from './Track.js';
import { oceanHeight, oceanNormal } from './WaveMath.js';
import { HUD } from '../ui/HUD.js';
import { Countdown } from '../ui/Countdown.js';
import { Results } from '../ui/Results.js';
import { Menu } from '../ui/Menu.js';
import { SettingsUI } from '../ui/Settings.js';
import { TouchUI } from '../ui/Touch.js';
import { store } from '../data/store.js';
import { QUALITY_PRESETS, QUALITY_TIERS, autoStartTier, isMobileDevice } from './Quality.js';

const AI_SKILLS = [2, 1, 1, 0, 2, 1, 2];

// 完赛后玩家的自动巡航输入（只读共享对象，由 Game 注入 player.autoInput）
const AUTO_INPUT = { throttle: 0.55, steer: 0, boost: false, pitch: 0 };

export class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.settings = { shake: store.data.shake };
    this.laps = store.data.laps;
    this.aiDifficulty = store.data.aiDifficulty ?? 1;   // 0=低 1=中 2=高
    this.state = 'menu';   // menu | countdown | race | paused | results
    this.time = 0;
    this.skis = [];
    this.remotePlayers = new Map();
    this._colCd = 0;
    this._finTimer = -1;
    this._lastCpSent = -1;
    this._idleN = new THREE.Vector3();   // _idleBob 用的浪面法线（复用，零分配）
    this._lastLoopErr = null;
    this._lastRenderErr = null;

    // ---------- 画质 ----------
    this._gfxMode = store.data.graphics;
    this._autoTier = autoStartTier();
    const initial = this._gfxMode === 'AUTO' ? this._autoTier : this._gfxMode;
    this.qualityName = initial;
    this.qualityPreset = QUALITY_PRESETS[initial];

    // ---------- 渲染器 ----------
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.qualityPreset.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = this.qualityPreset.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#a8dcff', this.qualityPreset.fogNear, this.qualityPreset.fogFar);

    // ---------- 光照 ----------
    this.cameraRig = new CameraRig(this);
    this.cameraRig.cinematic = true;

    const sun = this.sun = new THREE.DirectionalLight('#fff3d6', 2.6);
    sun.position.copy(SUN_DIR).multiplyScalar(300);
    sun.shadow.camera.left = -110; sun.shadow.camera.right = 110;
    sun.shadow.camera.top = 110; sun.shadow.camera.bottom = -110;
    sun.shadow.camera.near = 20; sun.shadow.camera.far = 800;
    sun.shadow.mapSize.set(this.qualityPreset.shadowRes, this.qualityPreset.shadowRes);
    sun.shadow.bias = -0.0004;
    this.sunTarget = new THREE.Object3D();
    this.scene.add(this.sunTarget);
    sun.target = this.sunTarget;
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight('#8ecfff', '#0a4d7e', 0.95));
    this.scene.add(new THREE.AmbientLight('#4d7ea8', 0.35));

    // ---------- 场景系统 ----------
    this.ocean = new Ocean(this.scene, this.qualityPreset);
    this.sky = new Sky(this.scene);
    this.effects = new Effects(this);
    this.environment = new Environment(this.scene);
    this.pickups = new Pickups(this.scene);
    this.trackGuide = new TrackGuide(this.scene);
    this.audio = new AudioManager();
    this.input = new Input(this);
    this.hud = new HUD();
    this.countdown = new Countdown(this);
    this.results = new Results(this);
    this.launchZones = [{ x: RAMP.x, z: RAMP.z, yaw: RAMP.yaw, w: RAMP.w, d: RAMP.d }];

    // ---------- 车手 ----------
    this._buildRoster();
    this.raceManager = new RaceManager(this.scene, this.laps);
    this.raceManager.setup(this._raceEntities());

    // ---------- UI ----------
    this.menu = new Menu(this);
    this.settingsUI = new SettingsUI(this);
    this.touch = new TouchUI(this.input);
    this.touch.setEnabled(isMobileDevice());

    // ---------- 联机（可选，失败不影响单机） ----------
    this.net = null;
    this._rpCtor = null;
    if (location.protocol.startsWith('http')) this._initNet();

    // ---------- 后处理 ----------
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.cameraRig.cam));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.38, 0.5, 0.9);
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
    this._applyBloom(this.qualityPreset.bloom);

    addEventListener('resize', () => this._resize());
    this._resize();
    this._applyQuality(initial);   // 初始化画质相关子系统（雾/阴影/bloom/粒子）

    try { this.audio.setVolumes(store.data.master, store.data.music, store.data.sfx); } catch (e) { /* 未就绪 */ }

    // 首次手势解锁音频
    const unlock = () => {
      this.audio.resume();
      if (this.state === 'menu') this.audio.playMenu();
      removeEventListener('pointerdown', unlock);
      removeEventListener('keydown', unlock);
    };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);

    this._fps = { acc: 0, n: 0, good: 0 };
    this.clock = new THREE.Clock();
    this._started = false;
  }

  start() {
    if (this._started) return;
    this._started = true;
    document.getElementById('loading').style.display = 'none';
    this._loop();
  }

  // ================= 车手 =================
  _buildRoster() {
    this.player = new Player(this, { ...RIDER_PRESETS[0] }, true);
    this.ais = [];
    for (let i = 1; i < RIDER_PRESETS.length; i++) {
      this.ais.push(new AIPlayer(this, { ...RIDER_PRESETS[i] }, AI_SKILLS[i - 1]));
    }
  }

  _raceEntities() {
    // 玩家 + 按画质取 N 个 AI + 联机远程玩家（缓存到 this.skis 供 HUD 等读取）
    const n = this.qualityPreset.aiCount;
    const list = [this.player];
    this.ais.forEach((ai, i) => {
      ai.group.visible = i < n;
      if (i < n) list.push(ai);
    });
    for (const rp of this.remotePlayers.values()) list.push(rp);
    this.skis = list;
    return list;
  }

  // ================= 比赛 =================
  // 交互后主动移除焦点：防止 PLAY/RESUME 等按钮保持焦点后被 Space/Enter 重复触发，
  // 或隐藏面板后焦点路由异常导致按键“失灵”
  _blurFocus() {
    try {
      const ae = document.activeElement;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
    } catch (e) { /* 忽略 */ }
  }

  startRace() {
    if (this.state === 'countdown') return;
    // 房间内：由房主统一开赛
    if (this.net && this.net.inRoom) {
      const host = this.net.players.find(p => p.host);
      if (host && host.id === this.net.myId) this.net.hostStart(store.data.laps);
      return;
    }
    this._blurFocus();
    this.laps = store.data.laps;
    this.aiDifficulty = store.data.aiDifficulty ?? 1;   // 开赛时应用所选 AI 难度
    this._resetSkis();
    this.raceManager.dispose?.();
    this.raceManager = new RaceManager(this.scene, this.laps);
    this.raceManager.setup(this._raceEntities());

    this.menu.hideAll();
    this.results.hide();
    this.state = 'countdown';
    this.input.jump = false;      // 菜单期间积压的一次性跳跃不带入比赛
    this.cameraRig.cinematic = false;
    this.cameraRig.mode = 0;
    this._finTimer = -1;
    this._lastCpSent = -1;
    this.hud.show(this._raceEntities().length, this.laps);
    this.audio.resume();
    this.audio.startEngine();
    this.countdown.run(() => {
      this.state = 'race';
      this.raceManager.begin();
      this.audio.playRace();
    });
  }

  _resetSkis() {
    for (const s of [this.player, ...this.ais]) {
      s.trickCount = 0; s.trickScore = 0; s.boostUsed = 0;
      s.combo = 0; s.finished = false; s.rank = 1;
      s.shieldT = 0; s.turboT = 0; s.stunT = 0;
    }
    this.player.autoInput = null;   // 恢复玩家手动控制（清除完赛巡航输入）
    this.player.shieldMesh.visible = false;
  }

  restartRace() {
    this._blurFocus();
    this.results.hide();
    this.menu.hidePause();
    if (this.net && this.net.inRoom) {
      const host = this.net.players.find(p => p.host);
      if (host && host.id === this.net.myId) this.net.hostStart(this.laps);
      return;
    }
    this.startRace();
  }

  backToMenu() {
    this.state = 'menu';
    this.results.hide();
    this.menu.hideAll();
    this.hud.hide();
    this.countdown.cancel();
    this.cameraRig.cinematic = true;
    this.audio.stopEngine();
    this.audio.playMenu();
    this._resetSkis();
    this.raceManager.setup(this._raceEntities());
  }

  togglePause() {
    this._blurFocus();
    if (this.state === 'race') {
      this.state = 'paused';
      this.menu.showPause();
      this.audio.stopEngine();
    } else if (this.state === 'paused') {
      this.state = 'race';
      this.menu.hidePause();
      this.audio.startEngine();
      this.input.jump = false;    // 暂停期间积压的跳跃不带入恢复
    }
  }

  onCameraKey() {
    if (this.state === 'race' || this.state === 'countdown') this.cameraRig.cycleMode();
  }

  onPauseKey() {
    if (this.state === 'race' || this.state === 'paused') this.togglePause();
  }

  onTrick(ski, label, pts) {
    this.hud.showTrick(label, pts, ski.combo);
  }

  onPickup(ski, kind) {
    if (kind === 0) ski.boostMeter = Math.min(100, ski.boostMeter + 40);
    else if (kind === 1) { ski.shieldT = 6; ski.shieldMesh.visible = true; }
    else { ski.turboT = 4; }
    try { this.audio.pickup(kind); } catch (e) { /* 未就绪 */ }
    this.effects.splashRing(ski.pos, 0.9);
  }

  // ================= 联机 =================
  _initNet() {
    Promise.all([
      import('../multiplayer/NetClient.js'),
      import('../multiplayer/RemotePlayer.js'),
    ]).then(([{ NetClient }, { RemotePlayer }]) => {
      this._rpCtor = RemotePlayer;
      const net = this.net = new NetClient();
      net.onPlayers = list => this.menu.onPlayers && this.menu.onPlayers(list);
      net.onCreated = code => this.menu.onRoomCreated && this.menu.onRoomCreated(code);
      net.onJoined = (code, id, players) => this.menu.onPlayers && this.menu.onPlayers(players);
      net.onStart = ({ laps }) => this._startNetRace(laps);
      net.onState = (id, d) => {
        const rp = this.remotePlayers.get(id);
        if (rp) rp.applyState(d);
      };
      net.onRank = order => {
        // 服务端权威排名 → 远程玩家实体
        order.forEach((entry, i) => {
          const rp = this.remotePlayers.get(entry.id);
          if (rp && rp.applyRank) rp.applyRank(entry, i + 1);
        });
      };
      net.onOver = order => {
        // 服务端终局名单：标记远程玩家完赛时间（结算以本地检测为主）
        order.forEach(o => {
          const rp = this.remotePlayers.get(o.id);
          if (rp && o.time) { rp.finished = true; rp.finishTime = o.time / 1000; }
        });
      };
      net.onError = msg => this.menu.onMpError && this.menu.onMpError(msg);
      net.connect();
    }).catch(() => { this.net = null; });  // 联机模块缺失 → 纯单机
  }

  _startNetRace(laps) {
    this.laps = laps || 3;
    this._blurFocus();
    for (const rp of this.remotePlayers.values()) rp.dispose();
    this.remotePlayers.clear();
    if (this._rpCtor) {
      for (const p of this.net.players) {
        if (p.id === this.net.myId) continue;
        const rp = new this._rpCtor(this, p);
        rp.grounded = true;
        this.remotePlayers.set(p.id, rp);
      }
    }
    this._resetSkis();
    this.raceManager.dispose?.();
    this.raceManager = new RaceManager(this.scene, this.laps);
    this.raceManager.setup(this._raceEntities());

    this.menu.hideAll();
    this.results.hide();
    this.state = 'countdown';
    this.input.jump = false;      // 菜单期间积压的一次性跳跃不带入比赛
    this.cameraRig.cinematic = false;
    this._finTimer = -1;
    this._lastCpSent = -1;
    this.hud.show(this._raceEntities().length, this.laps);
    this.audio.resume();
    this.audio.startEngine();
    this.countdown.run(() => {
      this.state = 'race';
      this.raceManager.begin();
      this.audio.playRace();
    });
  }

  // ================= 画质 =================
  applyGraphics(mode) {
    this._gfxMode = mode;
    this._applyQuality(mode === 'AUTO' ? this._autoTier : mode);
  }

  _applyQuality(name) {
    const preset = QUALITY_PRESETS[name];
    if (!preset) return;
    this.qualityName = name;
    this.qualityPreset = preset;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, preset.pixelRatio));
    this.renderer.shadowMap.enabled = preset.shadows;
    this.sun.castShadow = preset.shadows;
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.sun.shadow.mapSize.set(preset.shadowRes, preset.shadowRes);
    this.scene.fog.near = preset.fogNear;
    this.scene.fog.far = preset.fogFar;
    this.ocean.setQuality(preset);
    this.effects.setQuality(preset);
    this.environment.setQuality(preset);
    // 阴影开关运行时切换需要刷新材质编译
    this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    this._applyBloom(preset.bloom);
    this._resize();
  }

  _applyBloom(on) {
    const passes = this.composer.passes;
    if (on && !passes.includes(this.bloomPass)) this.composer.insertPass(this.bloomPass, 1);
    else if (!on && passes.includes(this.bloomPass)) this.composer.removePass(this.bloomPass);
  }

  _resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(innerWidth, innerHeight);
    this.cameraRig.cam.aspect = innerWidth / innerHeight;
    this.cameraRig.cam.updateProjectionMatrix();
  }

  _autoQuality(dt) {
    if (this._gfxMode !== 'AUTO' || this.state !== 'race') return;
    const f = this._fps;
    f.acc += dt; f.n++;
    if (f.acc < 1.5) return;
    const avg = f.n / f.acc;
    f.acc = 0; f.n = 0;
    const idx = QUALITY_TIERS.indexOf(this._autoTier);
    const cap = isMobileDevice() ? 2 : 3;
    if (avg < 42 && idx > 0) {
      this._autoTier = QUALITY_TIERS[idx - 1];
      this._applyQuality(this._autoTier);
      f.good = 0;
    } else if (avg > 57 && idx < cap) {
      if (++f.good >= 3) {
        this._autoTier = QUALITY_TIERS[idx + 1];
        this._applyQuality(this._autoTier);
        f.good = 0;
      }
    } else {
      f.good = 0;
    }
  }

  // ================= 碰撞 =================
  _collide(dt) {
    const list = this._raceEntities().filter(s => s.update && s.vel);
    this._colCd -= dt;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        const R = 2.3;
        if (d2 < R * R && d2 > 0.0001) {
          const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, push = (R - d) / 2;
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          b.pos.x += nx * push; b.pos.z += nz * push;
          // 沿法线弹开（防止持续贴身顶牛磨掉速度）
          const rel = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
          if (rel < 0) {
            const imp = Math.max(-rel * 0.6, 2.2);
            a.vel.x -= nx * imp * 0.5; a.vel.z -= nz * imp * 0.5;
            b.vel.x += nx * imp * 0.5; b.vel.z += nz * imp * 0.5;
          }
          const aShield = a.shieldT > 0, bShield = b.shieldT > 0;
          if (aShield !== bShield) {
            const victim = aShield ? b : a;
            const dir = aShield ? 1 : -1;
            victim.vel.x *= 0.6; victim.vel.z *= 0.6; victim.speed *= 0.6;
            victim.pos.x += nx * dir * 0.8;
            victim.pos.z += nz * dir * 0.8;
          }
          if (this._colCd <= 0 && (a.isPlayer || b.isPlayer)) {
            this._colCd = 0.4;
            if (!aShield) a.speed *= 0.92;
            if (!bShield) b.speed *= 0.92;
            this.cameraRig.shake(0.22);
            this.effects.sprayBurst(a.pos, 10, 1.0);
            try { this.audio.crash(0.5); } catch (e) { /* 未就绪 */ }
          }
        }
      }
      // 障碍物
      if (a._obsCd === undefined) a._obsCd = 0;
      a._obsCd -= dt;
      for (const o of this.environment.colliders) {
        const dx = a.pos.x - o.x, dz = a.pos.z - o.z;
        const rr = o.r + 1.5;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          a.pos.x = o.x + dx / d * rr;
          a.pos.z = o.z + dz / d * rr;
          a.vel.x *= 0.7; a.vel.z *= 0.7; a.speed *= 0.72;
          if (a.isPlayer && a._obsCd <= 0) {
            a._obsCd = 0.5;
            this.cameraRig.shake(0.4);
            this.effects.sprayBurst(a.pos, 18, 1.4);
            try { this.audio.crash(0.8); } catch (e) { /* 未就绪 */ }
          }
        }
      }
    }
  }

  // ================= 主循环 =================
  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    // 每帧更新整体包裹 try/catch：任何子系统异常只打印一次并继续跑，
    // 保证按键响应与渲染循环绝不因单帧异常而“锁死”
    try {
      if (this.state !== 'paused') {
        this.time += dt;
        const t = this.ocean.time;
        this.input.update();

        this.ocean.update(dt, this.cameraRig.cam.position);
        this.sky.update(dt, this.cameraRig.cam.position);
        this.environment.update(dt, t, this.cameraRig.cam.position);
        this.pickups.update(dt, t);
        this.effects.update(dt, t);

        const entities = this._raceEntities();

        if (this.state === 'menu' || this.state === 'countdown') {
          this._idleBob(entities, t);
          // 菜单/倒计时期间同步起点门视觉（浮标起伏 + 格纹带贴浪倾斜），防止边缘穿进海面
          this.raceManager.update(0, t, entities);
        } else if (this.state === 'race' || this.state === 'results') {        for (const s of entities) {
          if (!s.group.visible) continue;
          if (s === this.player && s.finished) {
            // 完赛后自动巡航：注入输入对象（而非覆写 getInput 方法——
            // 覆写会在重赛/回菜单后永久夺走玩家控制权，表现为“全部按键无响应”）
            s.autoInput = AUTO_INPUT;
            s.update(dt, t);
          } else if (s.update) {
            s.update(dt, t);
          }
          if (s.update) this.effects.emitWake(s, dt);
        }
        if (this.state === 'race') {
          this._collide(dt);
          this.raceManager.update(dt, t, entities);
          this._checkPickups();
          this._netSync();
          this._checkFinish(dt);
        } else {
          this.raceManager._updateVisuals(t);   // 结算镜头里起点门也随浪起伏
        }
      }

      this.cameraRig.update(dt, this.player, t);

      // 赛道指引（菜单中隐藏）
      this.trackGuide.update(dt, t, this.player, (this.player.cpIndex + 1) % 9, this.state !== 'menu');

      // FPS 显示（指数平滑，4Hz 刷新）
      const instFps = 1 / Math.max(dt, 0.0001);
      this._fpsShow = this._fpsShow ? this._fpsShow + (instFps - this._fpsShow) * 0.08 : instFps;
      this._fpsAcc = (this._fpsAcc || 0) + dt;
      if (this._fpsAcc > 0.25) {
        this._fpsAcc = 0;
        this.hud.setFps(Math.round(this._fpsShow));
      }

      if (this.state === 'race') {
        const p = this.player;
        this.audio.updateEngine?.(Math.min(Math.abs(p.speed) / 38, 1), p.boosting, p.grounded);
        this.audio.setRaceIntensity?.(p.lap >= this.laps ? 1 : 0);
      }

      if (this.state === 'race' || this.state === 'countdown') {
        this.hud.update(this);
        this.hud.setBoost(this.player.boostMeter, this.player.boosting);
      }

      this._updateOverlays();
      this._updateSun();
      this._autoQuality(dt);
      }
    } catch (err) {
      const msg = String((err && err.message) || err);
      if (msg !== this._lastLoopErr) {
        this._lastLoopErr = msg;
        console.error('[WaveRush] 主循环异常（已拦截，循环继续）:', err);
      }
    }

    // 渲染独立兜底：即使上面的更新抛异常，本帧画面也要照常输出
    try {
      this.composer.render();
    } catch (err) {
      const msg = String((err && err.message) || err);
      if (msg !== this._lastRenderErr) {
        this._lastRenderErr = msg;
        console.error('[WaveRush] 渲染异常（已拦截）:', err);
      }
    }
  }

  _idleBob(entities, t) {
    // 菜单/倒计时：艇体每帧贴合真实浪面（海面一直在动，不能沿用静止的 pos.y），
    // 姿态按浪面法线轻微随浪 + 待机微摆（与 Player.updateVisual 同一套俯仰/侧倾约定）
    const n = this._idleN;
    for (const s of entities) {
      if (!s.group.visible) continue;
      const h = oceanHeight(s.pos.x, s.pos.z, t);
      s.group.position.set(s.pos.x, h + Math.sin(t * 1.4 + s.pos.x) * 0.08, s.pos.z);
      oceanNormal(s.pos.x, s.pos.z, t, n);
      const yaw = s.yaw || 0;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const rx = fz, rz = -fx;   // 右方向
      const slopeF = (n.x * fx + n.z * fz) / Math.max(n.y, 0.3);
      const slopeR = (n.x * rx + n.z * rz) / Math.max(n.y, 0.3);
      s.group.rotation.order = 'YXZ';
      s.group.rotation.y = yaw;
      s.group.rotation.x = Math.atan(slopeF) * 0.9 + Math.sin(t * 0.9) * 0.03;
      s.group.rotation.z = Math.atan(slopeR) * 0.9 + Math.sin(t * 1.1 + s.pos.z) * 0.04;
    }
  }

  _updateSun() {
    const p = this.player ? this.player.pos : this.cameraRig.cam.position;
    this.sunTarget.position.set(p.x, 0, p.z);
    this.sun.position.set(p.x + SUN_DIR.x * 300, SUN_DIR.y * 300, p.z + SUN_DIR.z * 300);
  }

  _checkPickups() {
    const kind = this.pickups.checkCollide(this.player.pos);
    if (kind !== null) this.onPickup(this.player, kind);
  }

  _netSync() {
    if (!this.net || !this.net.inRoom) return;
    this.net.sendState(this.player);
    if (this.player.cpIndex !== this._lastCpSent) {
      this._lastCpSent = this.player.cpIndex;
      this.net.sendCp(this.player.cpIndex);
    }
  }

  _checkFinish(dt) {
    const p = this.player;
    if (!p.finished) return;
    if (this._finTimer < 0) this._finTimer = 6;   // 最多再等 6 秒收尾
    this._finTimer -= dt;
    if (this._finTimer <= 0 || this.raceManager.allFinished) {
      this._finTimer = -1;
      this._showResults();
    }
  }

  _showResults() {
    const standings = this.raceManager.getStandings();
    const p = this.player;
    const total = Math.round(p.finishTime * 1000);

    if (store.data.bestTime == null || total < store.data.bestTime) {
      store.data.bestTime = total; store.save();
    }
    let bestLapMs = null;
    if (p.bestLap < Infinity) {
      bestLapMs = Math.round(p.bestLap * 1000);
      if (store.data.bestLap == null || bestLapMs < store.data.bestLap) {
        store.data.bestLap = bestLapMs; store.save();
      }
    }

    this.state = 'results';
    this.cameraRig.cinematic = true;
    try { this.audio.finish(p.rank === 1); } catch (e) { /* 未就绪 */ }
    this.audio.stopEngine();
    this.hud.hide();
    this.results.show({
      place: p.rank,
      total,
      time: total,
      bestLap: bestLapMs,
      tricks: p.trickCount,
      boostUsed: p.boostUsed,
      distKm: p.distance / 1000,
      score: p.trickScore,
      standings: standings.map(s => ({
        name: s.e.name,
        time: s.finished ? Math.round((s.time ?? s.e.finishTime ?? 0) * 1000) : null,
        me: !!s.e.isPlayer,
        pos: s.rank,
      })),
    });
  }

  _updateOverlays() {
    const p = this.player;
    const spd = Math.min(Math.max((Math.abs(p.speed) - 16) / 22, 0), 1);
    document.getElementById('fx-speedlines').style.opacity =
      Math.min(spd + (p.boosting ? 0.45 : 0), 1).toFixed(2);
    document.getElementById('fx-boost').style.opacity = p.boosting ? 0.8 : 0;
  }
}
