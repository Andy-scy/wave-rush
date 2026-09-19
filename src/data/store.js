// localStorage 存档
const KEY = 'wave-rush-save';

export const store = {
  data: {
    graphics: 'AUTO', master: 0.8, music: 0.7, sfx: 0.9,
    shake: true, laps: 3, name: 'PLAYER', ci: 0, aiDifficulty: 1,
    bestTime: null, bestLap: null,
  },
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch (e) { /* 忽略损坏存档 */ }
    return this.data;
  },
  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* 隐私模式等 */ }
  },
};
