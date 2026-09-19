// 输入系统 —— 键盘 + 触摸统一抽象
export class Input {
  constructor(game) {
    this.game = game;
    this.keys = new Set();
    this.throttle = 0;   // -1..1
    this.steer = 0;      // -1..1
    this.boost = false;
    this.jump = false;   // 本帧按下（一次性）
    this.pitchKey = 0;   // 空中特技前后
    this.touch = { left: false, right: false, gas: false, brake: false, boost: false, jump: false };

    // 文本输入控件聚焦时不劫持按键（打字名号时 WASD/空格不应驱动摩托艇）
    this._isTextTarget = e => {
      const t = e.target;
      return !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
    };
    this._navKeys = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

    addEventListener('keydown', e => {
      if (this._isTextTarget(e)) return;   // 输入框内：不跟踪、不 preventDefault（保留空格/方向键打字）
      const k = e.code;
      // e.repeat 也写入集合：长按产生的重复事件、以及窗口失焦恢复后仍按住的键，
      // 都能保证 keys 集合与物理按键状态一致（防止“按住键失忆”）
      this.keys.add(k);
      if (!e.repeat) {
        if (k === 'Space') this.jump = true;
        if (k === 'KeyC' && game.onCameraKey) game.onCameraKey();
        if (k === 'Escape' && game.onPauseKey) game.onPauseKey();
      }
      if (this._navKeys.includes(k)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    // 失焦 / 切页：清空按键与一次性标志，防止“卡键”与残留跳输入
    addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
  }

  // 清空全部键盘状态（失焦/切页时调用；touch 状态由 TouchUI 的 pointerup/cancel 自行复位）
  reset() {
    this.keys.clear();
    this.jump = false;
    this.throttle = 0;
    this.steer = 0;
    this.boost = false;
    this.pitchKey = 0;
  }

  update() {
    const k = this.keys, t = this.touch;
    const up = k.has('KeyW') || k.has('ArrowUp') || t.gas;
    const down = k.has('KeyS') || k.has('ArrowDown') || t.brake;
    const left = k.has('KeyA') || k.has('ArrowLeft') || t.left;
    const right = k.has('KeyD') || k.has('ArrowRight') || t.right;

    this.throttle = (up ? 1 : 0) + (down ? -1 : 0);
    this.steer = (right ? 1 : 0) + (left ? -1 : 0);
    this.boost = k.has('ShiftLeft') || k.has('ShiftRight') || t.boost;
    this.pitchKey = this.throttle; // 空中 W=前空翻 S=后空翻
    if (t.jump) { this.jump = true; t.jump = false; }
  }

  consumeJump() { const j = this.jump; this.jump = false; return j; }
}
