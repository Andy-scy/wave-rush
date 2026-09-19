// 入口
import { store } from './data/store.js';
import { Game } from './game/Game.js';

// ---- 全局错误钩子：任何未捕获异常都留下痕迹（排障用），且不静默吞掉 ----
addEventListener('error', e => {
  console.error('[WaveRush] 全局异常:', e.message, `${e.filename}:${e.lineno}:${e.colno}`, e.error || '');
});
addEventListener('unhandledrejection', e => {
  console.error('[WaveRush] 未处理的 Promise 拒绝:', e.reason);
});

store.load();
const game = new Game();
game.start();

// ---- 构建时间戳标记（菜单左下角）：旧标签页/旧缓存一眼可辨 ----
try {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const stamp = document.createElement('div');
  stamp.id = 'build-stamp';
  stamp.textContent = `BUILD ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  stamp.style.cssText =
    'position:absolute;left:14px;bottom:18px;font-size:12px;letter-spacing:1.5px;' +
    'color:rgba(210,240,255,.4);pointer-events:none;user-select:none;';
  const menu = document.getElementById('menu');
  (menu || document.body).appendChild(stamp);
} catch (e) { /* 纯标识，失败不影响运行 */ }

// 调试句柄
window.__game = game;
