// 比赛结算界面
import { formatTime } from './HUD.js';

const $ = id => document.getElementById(id);

// 中文序数：第1名！第2名！…第8名！
function numToCn(n) {
  return `第${n}名！`;
}

export class Results {
  constructor(game) {
    this.game = game;
  }

  show(data) {
    $('res-place').textContent = numToCn(data.place);
    $('res-time').textContent = formatTime(data.time);
    $('res-bestlap').textContent = data.bestLap != null ? formatTime(data.bestLap) : '--';
    $('res-tricks').textContent = data.tricks;
    $('res-boost').textContent = data.boostUsed;
    $('res-dist').textContent = `${data.distKm.toFixed(2)} KM`;
    $('res-score').textContent = data.score;
    $('res-board').innerHTML = data.standings.map(s =>
      `<div class="rb-row${s.me ? ' me' : ''}"><span class="pos">第${s.pos}</span><span class="nm">${s.name}</span><span class="tm">${s.time != null ? formatTime(s.time) : '—'}</span></div>`
    ).join('');
    $('results-panel').classList.remove('hidden');
  }

  hide() {
    $('results-panel').classList.add('hidden');
  }
}
