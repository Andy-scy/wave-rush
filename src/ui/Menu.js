// 主菜单 / 联机面板 / 暂停 面板接线
import { store } from '../data/store.js';
import { RIDER_PRESETS } from '../game/JetSki.js';

const $ = id => document.getElementById(id);

function fmt(ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 10)).padStart(2, '0')}`;
}

export class Menu {
  constructor(game) {
    this.game = game;
    this._bindDifficulty();
    this.showMain();
    this._bindButtons();
    this._bindMp();
  }

  // AI 难度选择（低/中/高，存档并于开赛时应用）
  _bindDifficulty() {
    const row = document.getElementById('diff-row');
    if (!row) return;
    const sync = () => {
      row.querySelectorAll('.diff-chip').forEach(b =>
        b.classList.toggle('sel', +b.dataset.d === (store.data.aiDifficulty ?? 1)));
    };
    row.querySelectorAll('.diff-chip').forEach(b => {
      b.onclick = () => {
        store.data.aiDifficulty = +b.dataset.d;
        store.save();
        this._click();
        sync();
      };
    });
    sync();
  }

  _bindButtons() {
    $('btn-play').onclick = () => { this._click(); this.game.startRace(); };
    $('btn-mp').onclick = () => { this._click(); this.hideAll(); $('mp-panel').classList.remove('hidden'); this._refreshMp(); };
    $('btn-settings').onclick = () => {
      this._click(); this.hideAll();
      $('settings-panel').classList.remove('hidden');
      this.game.settingsUI.render();
    };
    $('btn-resume').onclick = () => this.game.togglePause();
    $('btn-restart').onclick = () => { this.hidePause(); this.game.restartRace(); };
    $('btn-quit').onclick = () => { this.hidePause(); this.game.backToMenu(); };
    $('btn-rematch').onclick = () => { this._click(); this.game.restartRace(); };
    $('btn-menu').onclick = () => { this._click(); this.game.backToMenu(); };
    $('settings-back').onclick = () => { this._click(); $('settings-panel').classList.add('hidden'); this.showMain(); };
    $('mp-back').onclick = () => { this._click(); $('mp-panel').classList.add('hidden'); this.showMain(); };
  }

  _click() { try { this.game.audio && this.game.audio.uiClick(); } catch (e) { /* 未就绪 */ } }

  // ---------- 联机 ----------
  _bindMp() {
    const g = this.game, net = () => g.net;
    $('mp-name').value = store.data.name;
    $('mp-name').oninput = () => { store.data.name = $('mp-name').value.trim() || 'PLAYER'; store.save(); };
    this._ci = store.data.ci || 0;

    // 色块
    const colors = $('mp-colors');
    RIDER_PRESETS.forEach((p, i) => {
      const b = document.createElement('div');
      b.className = 'csw' + (i === this._ci ? ' sel' : '');
      b.style.background = p.color;
      b.onclick = () => {
        this._ci = i; store.data.ci = i; store.save();
        colors.querySelectorAll('.csw').forEach((el, j) => el.classList.toggle('sel', j === i));
      };
      colors.appendChild(b);
    });

    $('mp-create').onclick = () => {
      this._click();
      if (!net()) return;
      net().createRoom(store.data.name, this._ci);
    };
    $('mp-join').onclick = () => {
      this._click();
      if (!net()) return;
      const code = $('mp-join-code').value.trim().toUpperCase();
      if (!code) return;
      net().joinRoom(code, store.data.name, this._ci);
    };
    $('mp-start').onclick = () => {
      this._click();
      if (net()) net().hostStart(store.data.laps);
    };
  }

  _refreshMp() {
    const g = this.game, net = g.net;
    const st = $('mp-status');
    if (!net || net.status !== 'on') {
      st.textContent = '未检测到局域网服务（请用 node server.mjs 启动）。单机模式不受影响。';
      st.className = 'mp-status bad';
      $('mp-create').disabled = $('mp-join').disabled = true;
      return;
    }
    st.textContent = '局域网服务已连接';
    st.className = 'mp-status ok';
    $('mp-create').disabled = $('mp-join').disabled = false;
  }

  onPlayers(list) {
    $('mp-count').textContent = list.length;
    $('mp-players').innerHTML = list.map(p =>
      `<div class="pl">${p.host ? '★ ' : ''}${p.name}${p.id === this.game.net.myId ? '（你）' : ''}</div>`).join('');
    $('mp-start').classList.toggle('hidden', !list.some(p => p.host && p.id === this.game.net.myId));
  }

  onRoomCreated(code) {
    $('mp-code').textContent = code;
    $('mp-code').classList.remove('hidden');
  }

  onMpError(msg) {
    const st = $('mp-status');
    st.textContent = msg;
    st.className = 'mp-status bad';
  }

  resetMpUi() {
    $('mp-code').classList.add('hidden');
    $('mp-start').classList.add('hidden');
    $('mp-players').innerHTML = '';
  }

  // ---------- 显隐 ----------
  showMain() {
    this.hideAll();
    $('menu').classList.remove('hidden');
    const best = $('menu-best');
    if (store.data.bestTime != null) {
      best.textContent = `最佳纪录  ${fmt(store.data.bestTime)}${store.data.bestLap != null ? `   ·   最佳单圈  ${fmt(store.data.bestLap)}` : ''}`;
      best.classList.remove('hidden');
    }
  }
  showPause() { $('pause-panel').classList.remove('hidden'); }
  hidePause() { $('pause-panel').classList.add('hidden'); }
  hideAll() {
    ['menu', 'mp-panel', 'settings-panel', 'pause-panel', 'results-panel'].forEach(id => $(id).classList.add('hidden'));
  }
}
