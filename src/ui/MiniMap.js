// 小地图 —— 北朝上固定视角：赛道环线 + 检查点状态 + 玩家/AI 位置
import { TRACK } from '../game/Track.js';

const SIZE = 140, PAD = 14;

export class MiniMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    canvas.width = SIZE;
    canvas.height = SIZE;

    // 赛道包围盒 → 缩放（含边距）
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of TRACK) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const spanX = maxX - minX, spanZ = maxZ - minZ;
    const span = Math.max(spanX, spanZ);
    this.scale = (SIZE - PAD * 2) / span;
    this.cx = SIZE / 2 - ((minX + maxX) / 2) * this.scale;
    this.cy = SIZE / 2 + ((minZ + maxZ) / 2) * this.scale; // 注意 Z 翻转

    this._pulse = 0;
  }

  _to(x, z) {
    return [this.cx + x * this.scale, this.cy - z * this.scale]; // +Z 北 = 屏幕上方
  }

  update(game, dt) {
    const ctx = this.ctx;
    if (!ctx || !game.raceManager) return;
    this._pulse += dt;
    ctx.clearRect(0, 0, SIZE, SIZE);

    // 背景
    ctx.fillStyle = 'rgba(4,18,38,0.55)';
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(0, 0, SIZE, SIZE, 12); } else { ctx.rect(0, 0, SIZE, SIZE); }
    ctx.fill();

    // 赛道环线
    ctx.strokeStyle = 'rgba(150,215,255,0.55)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    TRACK.forEach((p, i) => {
      const [sx, sy] = this._to(p.x, p.z);
      i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    ctx.stroke();

    // 起点线刻度
    const [stx, sty] = this._to(TRACK[0].x, TRACK[0].z);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(stx - 4, sty - 4);
    ctx.lineTo(stx + 4, sty + 4);
    ctx.stroke();

    // 检查点
    const me = game.skis[0];
    if (me) {
      const next = (me.cpIndex + 1) % 9;
      for (let i = 1; i < 9; i++) {
        const [sx, sy] = this._to(TRACK[i].x, TRACK[i].z);
        const done = me.cpIndex >= i;
        ctx.beginPath();
        ctx.arc(sx, sy, i === next ? 5 : 3.2, 0, Math.PI * 2);
        if (i === next) {
          ctx.fillStyle = '#ffd23d';
          ctx.shadowColor = '#ffd23d';
          ctx.shadowBlur = 6 + Math.sin(this._pulse * 5) * 3;
        } else if (done) {
          ctx.fillStyle = '#37e0a0';
        } else {
          ctx.fillStyle = 'rgba(160,210,240,0.45)';
        }
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    // 其它选手（小圆点）
    for (const s of game.skis) {
      if (s.isPlayer || !s.group || !s.group.visible) continue;
      const [sx, sy] = this._to(s.pos.x, s.pos.z);
      ctx.beginPath();
      ctx.arc(sx, sy, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = s.color || '#8fd8ff';
      ctx.fill();
    }

    // 玩家（三角箭头，随朝向旋转）
    if (me) {
      const [px, py] = this._to(me.pos.x, me.pos.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(me.yaw);
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4.2, 5);
      ctx.lineTo(0, 2.6);
      ctx.lineTo(-4.2, 5);
      ctx.closePath();
      ctx.fillStyle = '#ff2d4d';
      ctx.shadowColor = '#ff2d4d';
      ctx.shadowBlur = 5;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    }
  }
}
