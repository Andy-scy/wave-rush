// 触摸控制 —— 虚拟按钮 → Input.touch 标志
const $ = id => document.getElementById(id);

export class TouchUI {
  constructor(input) {
    this.input = input;
    this.enabled = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    const hold = (id, key) => {
      const el = $(id);
      const on = e => { e.preventDefault(); input.touch[key] = true; el.classList.add('on'); };
      const off = e => { e.preventDefault(); input.touch[key] = false; el.classList.remove('on'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointerleave', off);
      el.addEventListener('pointercancel', off);
    };
    hold('t-left', 'left');
    hold('t-right', 'right');
    hold('t-gas', 'gas');
    hold('t-brake', 'brake');
    hold('t-boost', 'boost');
    // 跳跃：一次性
    const jump = $('t-jump');
    jump.addEventListener('pointerdown', e => {
      e.preventDefault();
      input.touch.jump = true;
      jump.classList.add('on');
    });
    jump.addEventListener('pointerup', () => jump.classList.remove('on'));

    // 横竖屏提示
    this._checkRot();
    addEventListener('resize', () => this._checkRot());
  }

  _checkRot() {
    if (!this.enabled) return;
    $('rot-hint').classList.toggle('hidden', innerWidth >= innerHeight);
  }

  setEnabled(b) {
    this.enabled = b;
    $('touch-ui').classList.toggle('hidden', !b);
    document.body.classList.toggle('touch-mode', b);
  }
}
