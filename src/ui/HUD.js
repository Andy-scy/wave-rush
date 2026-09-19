// 比赛 HUD —— 位置/圈数/时间/ Boost / 排名板 / 特技弹幕 / 小地图
import { TRACK } from '../game/Track.js';
import { GO_TEXT } from './Countdown.js';
import { MiniMap } from './MiniMap.js';

const $ = id => document.getElementById(id);

export function formatTime(ms) {
  ms = Math.max(0, ms);
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 10)).padStart(2, '0')}`;
}

export class HUD {
  constructor() {
    this._boardAcc = 0;
    this._toastCount = 0;
    this.miniMap = new MiniMap(document.getElementById('minimap'));
  }

  show(totalSkis, laps) {
    $('hud').classList.remove('hidden');
    $('countdown').classList.add('hidden');
    $('hud-pos-total').textContent = `/${totalSkis}`;
    $('hud-lap').textContent = `1/${laps}`;
    $('hud-best').textContent = '--:--.--';
    // 检查点圆点（8 个检查点，起点线不算）
    const cps = $('hud-cps');
    cps.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const d = document.createElement('div');
      d.className = 'cp-dot';
      cps.appendChild(d);
    }
    this.setBoost(50, false);
    $('hud-wrongway').classList.add('hidden');
    $('hud-rankboard').innerHTML = '';
    $('hud-compass').style.opacity = 1;
  }

  hide() {
    $('hud').classList.add('hidden');
    $('countdown').classList.add('hidden');
  }

  update(game) {
    const rm = game.raceManager, me = game.skis[0];
    if (!rm || !me) return;

    $('hud-pos').textContent = me.rank || '-';
    $('hud-lap').textContent = `${Math.min(me.lap, game.laps)}/${game.laps}`;
    $('hud-time').textContent = formatTime(rm.raceTime * 1000);
    $('hud-best').textContent = me.bestLap < Infinity ? formatTime(me.bestLap * 1000) : '--:--.--';
    $('hud-speed').textContent = Math.round(Math.abs(me.speed) * 3.6);

    // 检查点圆点：目标 = (cpIndex+1)%9
    const next = (me.cpIndex + 1) % 9;
    const dots = $('hud-cps').children;
    for (let i = 0; i < dots.length; i++) {
      const cp = i + 1;
      dots[i].classList.toggle('done', me.cpIndex >= cp || next === 0);
      dots[i].classList.toggle('next', cp === next);
    }
    $('hud-cpnum').textContent = `下一检查点 ${next === 0 ? 8 : next}/8`;

    // 罗盘 + 距离
    const marker = $('compass-marker'), distEl = $('compass-dist');
    if (me.finished) {
      $('hud-compass').style.opacity = 0;
      $('hud-wrongway').classList.add('hidden');
    } else {
      $('hud-compass').style.opacity = 1;
      const target = TRACK[next];
      const dx = target.x - me.pos.x, dz = target.z - me.pos.z;
      const dist = Math.hypot(dx, dz);
      const bearing = Math.atan2(dx, dz) - me.yaw;
      // 相对方位 → 条带位置（±110° 内线性映射，超出钉在边缘）
      const clamped = Math.max(-1.92, Math.min(1.92, bearing));
      const xPct = 50 + (clamped / 1.92) * 45;
      marker.style.left = xPct.toFixed(1) + '%';
      marker.style.color = Math.abs(bearing) > 1.92 ? '#ff8a5c' : '#ffd23d';
      distEl.textContent = dist >= 1000 ? `${(dist / 1000).toFixed(2)}km` : `${Math.round(dist)}m`;
      // 逆行提示（与 3D 箭头变红阈值一致：偏离目标方向 >110°）
      const wrong = Math.abs(bearing) > 1.92 && Math.abs(me.speed) > 5 && dist > 60;
      $('hud-wrongway').classList.toggle('hidden', !wrong);
    }

    // 排名板（0.3s 节流）
    this._boardAcc += 1 / 60;
    if (this._boardAcc > 0.3) {
      this._boardAcc = 0;
      this.setRankBoard(rm.getStandings());
    }

    // 小地图
    if (this.miniMap) this.miniMap.update(game, 1 / 60);
  }

  setBoost(meter, boosting) {
    const fill = $('hud-boost');
    fill.style.width = `${Math.max(0, Math.min(100, meter))}%`;
    fill.classList.toggle('ready', boosting || meter >= 99.5);
  }

  setFps(fps) {
    const el = $('fps-meter');
    el.textContent = `${fps} FPS`;
    el.classList.toggle('low', fps < 30);
    el.classList.toggle('mid', fps >= 30 && fps < 50);
  }

  showTrick(label, pts, combo) {
    const box = $('hud-tricktoast');
    while (box.children.length >= 3) box.removeChild(box.firstChild);
    const el = document.createElement('div');
    el.className = 'tt-item' + (combo >= 2 ? ' combo' : '');
    el.textContent = `${label} +${pts}`;
    box.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  flashLap(lap, total) {
    const el = $('hud-lapflash');
    el.textContent = lap >= total ? '最后一圈!' : `圈数 ${lap + 1}/${total}`;
    el.classList.remove('hidden', 'lapin');
    void el.offsetWidth;
    el.classList.add('lapin');
    setTimeout(() => el.classList.add('hidden'), 1700);
  }

  setCountdown(text) {
    const box = $('countdown'), num = $('countdown-num');
    if (!text) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    num.classList.remove('go', 'pop');
    void num.offsetWidth;
    num.textContent = text;
    if (text === GO_TEXT) num.classList.add('go');
    num.classList.add('pop');
  }

  setRankBoard(standings) {
    if (!standings || !standings.length) return;
    const rows = standings.slice(0, 4);
    const meRow = standings.find(s => s.e.isPlayer);
    if (meRow && meRow.rank > 4) rows.push(meRow);
    $('hud-rankboard').innerHTML = rows.map(s =>
      `<div class="rb-row${s.e.isPlayer ? ' me' : ''}"><span class="rb-pos">${s.rank}</span><span class="rb-name">${s.e.name}</span><span class="rb-tm">${s.finished ? formatTime(s.time * 1000) : '圈' + s.lap}</span></div>`
    ).join('');
  }
}
