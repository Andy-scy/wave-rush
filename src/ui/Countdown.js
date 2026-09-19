// 开场倒计时 3-2-1-出发
// GO_TEXT：出发提示文案。HUD.setCountdown 依据它加 .go 类，两处必须共用本常量。
export const GO_TEXT = '出发!';

export class Countdown {
  constructor(game) {
    this.game = game;
    this._timers = [];
  }

  run(onDone) {
    this.cancel();
    const g = this.game;
    const steps = [
      ['3', () => g.audio.countdownBeep(3), 850],
      ['2', () => g.audio.countdownBeep(2), 850],
      ['1', () => g.audio.countdownBeep(1), 850],
      [GO_TEXT, () => g.audio.go(), 800],
    ];
    let delay = 0;
    steps.forEach(([text, sound, dur], i) => {
      this._timers.push(setTimeout(() => {
        g.hud.setCountdown(text);
        sound();
        if (i === steps.length - 1) {
          this._timers.push(setTimeout(() => {
            g.hud.setCountdown('');
            onDone && onDone();
          }, dur));
        }
      }, delay));
      delay += dur;
    });
  }

  cancel() {
    this._timers.forEach(clearTimeout);
    this._timers = [];
    try { this.game.hud.setCountdown(''); } catch (e) { /* 未就绪 */ }
  }
}
