// 设置面板 —— 画质/音量/震动/圈数
import { store } from '../data/store.js';

const $ = id => document.getElementById(id);

export class SettingsUI {
  constructor(game) {
    this.game = game;
    this._bindOpts('set-graphics', v => {
      store.data.graphics = v; store.save(); game.applyGraphics(v);
    });
    this._bindOpts('set-shake', v => {
      store.data.shake = v === 'ON'; store.save();
      game.settings.shake = store.data.shake;
    });
    this._bindOpts('set-laps', v => {
      store.data.laps = +v; store.save();
    });
    this._bindSlider('set-vol-master', v => {
      store.data.master = v / 100; store.save(); this._applyVolumes();
    });
    this._bindSlider('set-vol-music', v => {
      store.data.music = v / 100; store.save(); this._applyVolumes();
    });
    this._bindSlider('set-vol-sfx', v => {
      store.data.sfx = v / 100; store.save(); this._applyVolumes();
    });
  }

  _applyVolumes() {
    const d = store.data;
    try { this.game.audio.setVolumes(d.master, d.music, d.sfx); } catch (e) { /* 未就绪 */ }
  }

  _bindOpts(id, onPick) {
    const box = $(id);
    box.querySelectorAll('button').forEach(b => {
      b.onclick = () => {
        try { this.game.audio.uiClick(); } catch (e) { /* 未就绪 */ }
        onPick(b.dataset.v);
        this.render();
      };
    });
  }

  _bindSlider(id, onChange) {
    const el = $(id);
    el.oninput = () => {
      $(id + '-v').textContent = el.value;
      onChange(+el.value);
    };
  }

  render() {
    const d = store.data;
    const mark = (id, val) => {
      $(id).querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset.v === String(val)));
    };
    mark('set-graphics', d.graphics);
    mark('set-shake', d.shake ? 'ON' : 'OFF');
    mark('set-laps', d.laps);
    $('set-vol-master').value = Math.round(d.master * 100);
    $('set-vol-music').value = Math.round(d.music * 100);
    $('set-vol-sfx').value = Math.round(d.sfx * 100);
    $('set-vol-master-v').textContent = Math.round(d.master * 100);
    $('set-vol-music-v').textContent = Math.round(d.music * 100);
    $('set-vol-sfx-v').textContent = Math.round(d.sfx * 100);
  }
}
