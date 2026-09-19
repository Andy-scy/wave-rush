// AI 车手 —— 只覆写 getInput()/tryAIJump() 提供虚拟输入，所有运动仍由 Player.update 街机物理驱动
// 目标点：TRACK[(cpIndex+1) % 9]（cpIndex 由 RaceManager 每帧写入；cpIndex=0 → 目标 TRACK[1]，
//         过 CP1 后 cpIndex=1 → 目标 TRACK[2] … cpIndex=8 → 目标 TRACK[0] 终点线）
// 难度：读取 game.aiDifficulty（0=低 1=中 2=高；undefined/缺失/非法时按 1=中 处理）。
//       全部缩放通过 getInput 输出塑形（油门上限/油门增益/boost 概率/转向特性）
//       与 tryAIJump 概率实现，不修改 Player 的物理常数。
// 依赖：RaceManager 在 constructor 里注册的 scene.userData.raceManager ——
//         started        倒计时期间怠速
//         player.progress  rubber-band（落后玩家 → 追赶，领先 → 周期松油）
//         entities         邻近实体(<8m)横向避让
//         raceTime > 0     卡死检测仅在开赛后生效
//       若 raceManager 不存在（独立调试），AI 退化为正常追踪 CP 行驶。
import { Player } from './Player.js';
import { TRACK } from './Track.js';
import { oceanHeight, ampAt } from './WaveMath.js';

const N_CPS = TRACK.length;
const TWO_PI = Math.PI * 2;

// 难度档位表（下标 = game.aiDifficulty：0=低 1=中 2=高）
// 注意：Player 地面物理的油门是【门控式】——>0 即全油门加速、=0 滑行(+滚阻)、<0 全力刹车，
// 数值大小只在空中（thr×2.5）生效。因此难度差异通过【满油/滑行/刹车】三态及其时机来表达：
// kp        转向增益（低档更小 → 更晚入弯）
// lag       转向低通速率（低档更小 → 响应更钝、转弯更迟）
// lane      车道偏移幅度（低档更散乱，高档更贴线）
// look      临近 CP 时瞄准方位混向出弯方向的比例（高档提前转向，线路更好）
// thrCap    油门上限（低档 0.82：压低空中加速；地面为门控油门，配合周期松油压低极速感受）
// brakeMul  预刹力度倍率：1=基准（中档各限值与旧版逐值一致）；高档 0.5 → 二级预刹由“滑行(0)”
//           变为“0.275(继续加速)”，弯道携带速度大幅提高（转向提前量更好）；低档 1.1 刹得更狠
// steerMax  转向输出阻尼（低档 0.85：打满也只出 85% 舵 → 线路更宽、转弯更迟）
// liftPeriod/liftDur/liftThr  低档周期性松油到 0（滑行阻力真正生效）→ 极速感受 ≈×0.86// boostP    boost 决策概率（每 0.5~1.2s 掷一次；低档 0.002 → 几乎不用）
// boostMin  boost 起用门槛（氮气表；高档满 30 就用——38m/s ≈ 极速 +33%，即“极速 ×1.04+”的兑现）
// jumpP     主动起跳概率（低档 0 = 不主动起跳）
// airSteer  空中转向输入倍率（高档 0.08：空中收舵防翻滚摔水；低/中档维持原行为）
// push/ease rubber-band 触发门槛（与玩家 progress 差：落后 push 触发、领先 ease 触发）
// pushMul   落后追赶油门增益上限（低档最高 ×1.06 追赶，保持比赛悬念；地面门控下等效于“取消松油全油门”）
// pushBoost 落后时 boost 概率倍率（高档减弱）
// easeMul   领先时松油频率倍率（>1 更常松油 → 低档不易拉开；<1 高档几乎不松油）
const DIFFS = [
  { kp: 1.7, lag: 3.6,  lane: 9.0, look: 0,    thrCap: 0.82, brakeMul: 1.1, steerMax: 0.85, liftPeriod: 3.2, liftDur: 0.45, liftThr: 0,
    boostP: 0.002, boostMin: 95, jumpP: 0.0,  airSteer: 1.0,  push: 650,  ease: -1400, pushMul: 0.06, pushBoost: 3.0, easeMul: 1.4 },
  { kp: 2.2, lag: 8.0,  lane: 6.0, look: 0,    thrCap: 1.0,  brakeMul: 1.0, steerMax: 1.0,  liftPeriod: 0,   liftDur: 0,   liftThr: 0,
    boostP: 0.30, boostMin: 25, jumpP: 0.02, airSteer: 1.0,  push: 1000, ease: -1900, pushMul: 0.0,  pushBoost: 2.5, easeMul: 1.0 },
  { kp: 2.6, lag: 12.0, lane: 3.5, look: 0.55, thrCap: 1.0,  brakeMul: 0.5, steerMax: 1.0,  liftPeriod: 0,   liftDur: 0,   liftThr: 0,
    boostP: 0.95, boostMin: 30, jumpP: 0.03, airSteer: 0.08, push: 1300, ease: -2600, pushMul: 0.0,  pushBoost: 1.5, easeMul: 0.7 },
];

// 每帧复用的输入对象（Player.update 同步消费，不保留引用 → 零分配）
const _INP = { throttle: 0, steer: 0, boost: false, pitch: 0 };

function wrapPi(a) {
  a %= TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  else if (a < -Math.PI) a += TWO_PI;
  return a;
}

export class AIPlayer extends Player {
  constructor(game, preset, skill) {
    super(game, preset, false);
    // skill 参数保留兼容旧调用签名（Game.js 会传入），仅作存档；
    // 实际难度运行时从 game.aiDifficulty 读取（见 _diff()）
    skill = skill | 0;
    if (skill < 0) skill = 0; else if (skill > 2) skill = 2;
    this._skill = skill;
    this._jitter = 0.92 + Math.random() * 0.16;   // 个体微差，避免整齐划一

    // 内部状态
    this._steer = 0;        // 低通后的转向（防抖；内部约定 + = yaw 增大，输出时统一取反）
    this._laneCp = -1;      // 上次掷车道偏移时的 cpIndex
    this._laneOff = 0;      // 当前车道横向偏移（m）
    this._turnAhead = 0;    // 目标 CP 处的弯道角度（提前减速用）
    this._boostT = 0;       // boost 决策计时
    this._boostOn = false;
    this._stuckT = 0;       // 卡死计时
    this._jumpCd = 0;       // 主动起跳冷却
    this._easeCd = 2;       // rubber-band 松油周期
    this._easeOff = 0;
    this._liftCd = 2.5;     // 低档周期性松油计时
    this._liftOff = 0;
    this._lastT = -1;       // 帧间隔估计（getInput 无 dt 参数）
    this._dt = 1 / 60;
  }

  // —— 难度档位：game.aiDifficulty（0=低 1=中 2=高；缺失/NaN → 1，越界截断） ——
  _diff() {
    const d = this.game.aiDifficulty;
    const i = (typeof d === 'number' && d === d) ? d | 0 : 1;   // d===d 排除 NaN
    return i < 0 ? 0 : (i > 2 ? 2 : i);
  }

  // —— 核心驱动：追踪下一 CP ——
  getInput() {
    const now = performance.now() * 0.001;
    let dt = this._lastT >= 0 ? now - this._lastT : 0.016;
    this._lastT = now;
    if (dt > 0.1) dt = 0.1; else if (dt <= 0) dt = 0.016;
    this._dt = dt;

    const D = DIFFS[this._diff()];

    const rm = this.game.scene.userData.raceManager;
    if (rm && !rm.started) {                 // 倒计时：熄火待发
      this._steer = 0; this._stuckT = 0;
      _INP.throttle = 0; _INP.steer = 0; _INP.boost = false; _INP.pitch = 0;
      return _INP;
    }

    const cpi = (this.cpIndex | 0) % N_CPS;
    const tgt = TRACK[(cpi + 1) % N_CPS];

    // —— 车道偏移 + 前瞻弯角（目标 CP 变化时重掷） ——
    if (this._laneCp !== cpi) {
      this._laneCp = cpi;
      this._laneOff = (Math.random() * 2 - 1) * D.lane * this._jitter;
      const pv = TRACK[cpi], nn = TRACK[(cpi + 2) % N_CPS];
      const da = wrapPi(
        Math.atan2(nn.x - tgt.x, nn.z - tgt.z) - Math.atan2(tgt.x - pv.x, tgt.z - pv.z)
      );
      this._turnAhead = da < 0 ? -da : da;
    }

    // —— 瞄准点 = 目标 CP + 航线垂直方向车道偏移（临近 45m 线性收窄回中） ——
    const tdx = tgt.x - this.pos.x, tdz = tgt.z - this.pos.z;
    const dist = Math.sqrt(tdx * tdx + tdz * tdz) || 1e-6;
    const pv = TRACK[cpi];
    let adx = tgt.x - pv.x, adz = tgt.z - pv.z;
    const al = Math.sqrt(adx * adx + adz * adz) || 1;
    adx /= al; adz /= al;
    const lane = this._laneOff * (dist < 45 ? dist / 45 : 1);
    const adx2 = tgt.x + adz * lane - this.pos.x;
    const adz2 = tgt.z - adx * lane - this.pos.z;

    // —— 转向：方位角误差 → 增益(难度) + 低通(难度)，避免抖动 ——
    // 内部约定 + = yaw 增大（屏幕左）；物理层 yawRate 已取反，输出时统一取反
    let bearing = Math.atan2(adx2, adz2);
    if (D.look > 0 && dist < 60) {
      // 高档前瞻：临近 CP 时把瞄准方位按比例混向出弯方向（提前转向，线路更好）
      const nx = TRACK[(cpi + 2) % N_CPS];
      const w = D.look * (1 - dist / 60);
      bearing += wrapPi(Math.atan2(nx.x - tgt.x, nx.z - tgt.z) - bearing) * w;
    }
    const err = wrapPi(bearing - this.yaw);
    let steerT = err * D.kp * this._jitter;
    if (steerT > 1) steerT = 1; else if (steerT < -1) steerT = -1;
    this._steer += (steerT - this._steer) * (1 - Math.exp(-D.lag * dt));
    let steer = this._steer;

    const av = this.speed < 0 ? -this.speed : this.speed;
    const ae = err < 0 ? -err : err;

    // —— 油门：弯中转角大减速，直道满油 ——
    let throttle = 1;
    if (ae > 1.8 && av > 9) throttle = -0.4 * D.brakeMul;
    else if (ae > 1.31 && av > 13) throttle = 0;
    else if (ae > 0.85 && av > 23) throttle = 0.5;
    // 弯前预刹（刹车/松油力度随难度：高档刹得更晚更柔 → 弯速更高；中档各限值与旧版逐值一致）
    if (dist < 80) {
      const ta = this._turnAhead;
      const b = D.brakeMul;
      if (ta > 1.4 && av > 11) throttle = Math.min(throttle, -0.25 * b);
      else if (ta > 0.95 && av > 16) throttle = Math.min(throttle, b < 1 ? 0.55 * (1 - b) : 0);
      else if (ta > 0.55 && av > 23) throttle = Math.min(throttle, 0.55 + (1 - 0.55) * (1 - Math.min(b, 1)));
    }

    // —— 难度油门塑形（只动 getInput 输出，不改物理常数） ——
    if (throttle > D.thrCap) throttle = D.thrCap;   // 低档 0.82：空中加速上限（地面为门控油门）
    if (D.liftPeriod > 0) {                          // 低档：周期性松油到 0 → 滑行阻力生效 → 极速感受 ≈×0.86
      this._liftCd -= dt;
      if (this._liftCd <= 0) {
        this._liftOff = D.liftDur * (0.8 + Math.random() * 0.6);
        this._liftCd = D.liftPeriod * (0.8 + Math.random() * 0.6);
      }
      if (this._liftOff > 0) {
        this._liftOff -= dt;
        if (throttle > D.liftThr) throttle = D.liftThr;
      }
    }

    // —— rubber-band：与玩家 progress 差 ——
    let push = false, ease = false, gap = 0;
    if (rm && rm.player && rm.player !== this) {
      gap = rm.player.progress - this.progress;
      if (gap > D.push) push = true;
      else if (gap < D.ease) ease = true;
    }

    // —— Boost：直线时按难度概率决策（非逐帧） ——
    this._boostT -= dt;
    if (this._boostT <= 0) {
      this._boostOn = false;
      if (ae < 0.4 && this.boostMeter > D.boostMin && Math.random() < D.boostP * (push ? D.pushBoost : 1)) {
        this._boostOn = true;
        this._boostT = 1.2 + Math.random() * 1.8;
      } else {
        this._boostT = 0.5 + Math.random() * 0.7;
      }
    }
    let boost = this._boostOn && ae < 0.55;

    if (push) {
      throttle = 1;
      if (D.pushMul > 0) {
        // 低档追赶：落后越多越快，油门最高 ×1.06（保持比赛悬念）
        let g = (gap - D.push) / 900;
        if (g > 1) g = 1; else if (g < 0) g = 0;
        throttle += g * D.pushMul;
      }
    }
    if (ease) {
      this._easeCd -= dt * D.easeMul;    // 低档更常松油（不易拉开差距），高档几乎不松
      if (this._easeCd <= 0) {
        this._easeOff = 0.55 + Math.random() * 0.5;
        this._easeCd = 2.5 + Math.random() * 2.5;
      }
      if (this._easeOff > 0) { this._easeOff -= dt; throttle = Math.min(throttle, 0); boost = false; }
    }

    // —— 邻近实体(<8m)横向避让（内部转向约定，输出处统一取反） ——
    if (rm && rm.entities) {
      const list = rm.entities;
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      let avoid = 0;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o === this || !o.pos) continue;
        const rx = o.pos.x - this.pos.x, rz = o.pos.z - this.pos.z;
        const d2 = rx * rx + rz * rz;
        if (d2 > 64 || d2 < 0.01) continue;
        if (rx * fx + rz * fz < -0.5) continue;          // 身后 0.5m 内不管
        const lat = rx * -fz + rz * fx;                  // 右向量 = (-cos yaw, sin yaw)
        avoid += (lat >= 0 ? 1 : -1) * (1 - Math.sqrt(d2) / 8) * 0.9;
      }
      steer += avoid;
      if (steer > 1) steer = 1; else if (steer < -1) steer = -1;
    }

    // —— 卡死检测：速度 <2 持续 3s → 摆回上一 CP 后 2.5m 重新出发 ——
    let respawned = false;
    if (rm && rm.raceTime > 0 && !this.finished) {
      if (av < 2 && this.grounded) {
        this._stuckT += dt;
        if (this._stuckT > 3) { this._respawn(); respawned = true; }
      } else {
        this._stuckT = 0;
      }
    }

    if (respawned) { steer = 0; throttle = 1; boost = false; }

    _INP.throttle = throttle;
    // 屏幕方向修正：物理层 yawRate 已取反（D/右 = yaw 减小），
    // AI 内部沿用 “+ = yaw 增大” 约定计算（追踪/避让/卡死恢复全部路径），
    // 在唯一输出口整体取反，保证寻路方向正确。
    // steerMax：低档转向输出阻尼（打满只出 85% 舵 → 更晚入弯）；airSteer：高档空中收舵防翻滚。
    _INP.steer = -steer * D.steerMax * (this.grounded ? 1 : D.airSteer);
    _INP.boost = boost;
    _INP.pitch = 0;
    return _INP;
  }

  // —— 主动起跳：难度越高越常在巨浪区起跳吃特技/越浪（低档 jumpP=0 不起跳） ——
  tryAIJump(vAbs) {
    const D = DIFFS[this._diff()];
    if (D.jumpP <= 0) return;
    this._jumpCd -= this._dt;
    if (this._jumpCd > 0 || vAbs < 10) return;
    if (this._steer > 0.6 || this._steer < -0.6) return;   // 急转不起跳（内部值，取对称判断）
    if (D.airSteer < 1 && this._turnAhead > 0.8) return;   // 空中收舵的档位（高档）遇急弯不起跳（防翻滚摔水）
    if (this._turnAhead > 0.8) return;                     // 前方是急弯不起跳（防空中翻滚摔水）
    if (ampAt(this.pos.x, this.pos.z) < 2.2) return;       // 仅巨浪区
    if (Math.random() > D.jumpP) return;
    this.launch(6.5 + vAbs * 0.09);
    this._jumpCd = 3.5 + Math.random() * 3;
  }

  // 卡死救援：摆回上一 CP（沿来向退 2.5m），船头对准下一 CP
  _respawn() {
    const cpi = (this.cpIndex | 0) % N_CPS;
    const cp = TRACK[cpi];
    const pv = TRACK[(cpi - 1 + N_CPS) % N_CPS];
    let dx = cp.x - pv.x, dz = cp.z - pv.z;
    const L = Math.sqrt(dx * dx + dz * dz) || 1;
    dx /= L; dz /= L;
    const px = cp.x - dx * 2.5, pz = cp.z - dz * 2.5;
    const nt = TRACK[(cpi + 1) % N_CPS];

    this.pos.set(px, 0, pz);
    const ot = this.game.ocean ? this.game.ocean.time : 0;
    this.pos.y = oceanHeight(px, pz, ot);
    this._prevSurfH = this.pos.y;
    this.vel.set(0, 0, 0);
    this.speed = 0; this.vy = 0;
    this.yaw = Math.atan2(nt.x - px, nt.z - pz);
    this.grounded = true;
    this.airTime = 0;
    this.stunT = 0;
    this._steer = 0;
    this._stuckT = 0;
    this._laneCp = -1;   // 下帧重掷车道偏移与前瞻弯角
  }
}
