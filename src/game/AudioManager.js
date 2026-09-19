// 音频 —— 全程序合成：引擎声（随速变调）+ SFX + 程序生成音乐（lookahead 音序器）
const midi = m => 440 * Math.pow(2, (m - 69) / 12);

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = this.musicG = this.sfxG = null;
    this.vol = { master: 0.8, music: 0.7, sfx: 0.9 };
    this.musicMode = null;       // 'menu' | 'race'
    this.intensity = 0;
    this._seqTimer = null;
    this._step = 0; this._nextT = 0;
    this.enabled = true;
  }

  resume() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) this._build();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) { this.enabled = false; }
  }

  _build() {
    const C = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = C.createGain(); this.master.gain.value = this.vol.master;
    this.master.connect(C.destination);
    this.musicG = C.createGain(); this.musicG.gain.value = this.vol.music; this.musicG.connect(this.master);
    this.sfxG = C.createGain(); this.sfxG.gain.value = this.vol.sfx; this.sfxG.connect(this.master);

    // 白噪声缓冲（复用）
    const len = C.sampleRate * 2;
    this.noiseBuf = C.createBuffer(1, len, C.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // ---- 引擎声（常驻图） ----
    const eg = this.engG = C.createGain(); eg.gain.value = 0;
    const filt = this.engF = C.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 600; filt.Q.value = 1.2;
    eg.connect(filt); filt.connect(this.sfxG);

    const saw = this.engOsc = C.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = 55;
    const sawG = C.createGain(); sawG.gain.value = 0.5; saw.connect(sawG); sawG.connect(eg);
    const sub = this.engSub = C.createOscillator(); sub.type = 'square'; sub.frequency.value = 27;
    const subG = C.createGain(); subG.gain.value = 0.32; sub.connect(subG); subG.connect(eg);
    const det = this.engDet = C.createOscillator(); det.type = 'sawtooth'; det.frequency.value = 60; det.detune.value = 18;
    const detG = this.engDetG = C.createGain(); detG.gain.value = 0; det.connect(detG); detG.connect(eg);

    const nz = C.createBufferSource(); nz.buffer = this.noiseBuf; nz.loop = true;
    const nzF = this.engNzF = C.createBiquadFilter(); nzF.type = 'bandpass'; nzF.frequency.value = 900; nzF.Q.value = 0.6;
    const nzG = this.engNzG = C.createGain(); nzG.gain.value = 0.1;
    nz.connect(nzF); nzF.connect(nzG); nzG.connect(eg);

    saw.start(); sub.start(); det.start(); nz.start();
  }

  setVolumes(master, music, sfx) {
    this.vol = { master, music, sfx };
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(master, this.ctx.currentTime, 0.05);
    this.musicG.gain.setTargetAtTime(music, this.ctx.currentTime, 0.05);
    this.sfxG.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
  }

  // ---------- 引擎 ----------
  startEngine() { if (this.ctx && this.engG) this.engG.gain.setTargetAtTime(0.22, this.ctx.currentTime, 0.4); }
  stopEngine() { if (this.ctx && this.engG) this.engG.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3); }

  updateEngine(s, boosting, grounded) {
    if (!this.ctx || !this.engOsc) return;
    const t = this.ctx.currentTime, tc = 0.06;
    const f = 52 + s * 195 + (boosting ? 24 : 0);
    this.engOsc.frequency.setTargetAtTime(f, t, tc);
    this.engSub.frequency.setTargetAtTime(f * 0.5, t, tc);
    this.engDet.frequency.setTargetAtTime(f * 1.01 + 3, t, tc);
    this.engF.frequency.setTargetAtTime(420 + s * 3000 + (boosting ? 900 : 0), t, tc);
    this.engNzF.frequency.setTargetAtTime(700 + s * 2400, t, tc);
    this.engNzG.gain.setTargetAtTime((grounded ? 0.16 : 0.05) + s * 0.22, t, tc);
    this.engDetG.gain.setTargetAtTime(boosting ? 0.34 : 0, t, 0.1);
    this.engG.gain.setTargetAtTime((grounded ? 0.2 : 0.11) + s * 0.1, t, 0.15);
  }

  // ---------- SFX 工具 ----------
  _blip(freq, dur, type = 'square', gain = 0.25, slide = 0, delay = 0) {
    if (!this.ctx) return;
    const C = this.ctx, t0 = C.currentTime + delay;
    const o = C.createOscillator(), g = C.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(this.sfxG);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  _noise(dur, filterFreq, gain = 0.4, type = 'lowpass', delay = 0, freqEnd = 0) {
    if (!this.ctx) return;
    const C = this.ctx, t0 = C.currentTime + delay;
    const src = C.createBufferSource(); src.buffer = this.noiseBuf;
    const f = C.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(filterFreq, t0);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    const g = C.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.sfxG);
    src.start(t0, Math.random()); src.stop(t0 + dur + 0.05);
  }

  // ---------- SFX ----------
  uiClick() { this._blip(920, 0.06, 'square', 0.12); }
  countdownBeep(n) { this._blip(520, 0.14, 'sine', 0.4); this._blip(1040, 0.1, 'sine', 0.1, 0, 0.02); }
  go() {
    this._blip(880, 0.5, 'sawtooth', 0.3);
    this._blip(1320, 0.5, 'sawtooth', 0.2);
    this._noise(0.5, 3000, 0.3, 'highpass');
  }
  land(impact) {
    const p = Math.min(impact / 14, 1);
    this._noise(0.35, 900, 0.25 + p * 0.4);
    this._blip(90 - p * 30, 0.25, 'sine', 0.3 + p * 0.2, -40);
  }
  crash(v = 1) {
    this._noise(0.4, 2400, 0.5 * v, 'bandpass');
    this._blip(180, 0.3, 'square', 0.3 * v, -120);
  }
  trick() {
    this._blip(660, 0.09, 'square', 0.2);
    this._blip(880, 0.09, 'square', 0.2, 0, 0.07);
    this._blip(1320, 0.14, 'square', 0.22, 0, 0.14);
  }
  pickup(kind) {
    if (kind === 0) { this._blip(700, 0.08, 'square', 0.25); this._blip(1050, 0.12, 'square', 0.25, 0, 0.08); }
    else if (kind === 1) { this._blip(880, 0.3, 'sine', 0.3); this._blip(1108, 0.35, 'sine', 0.2, 0, 0.05); }
    else { this._blip(300, 0.25, 'sawtooth', 0.25, 900); }
  }
  lap() { this._blip(784, 0.12, 'square', 0.25); this._blip(1175, 0.2, 'square', 0.25, 0, 0.12); }
  finish(win) {
    const seq = win ? [523, 659, 784, 1047] : [440, 349, 262];
    seq.forEach((f, i) => this._blip(f, win ? 0.22 : 0.4, 'sawtooth', 0.3, 0, i * (win ? 0.16 : 0.28)));
    if (win) this._noise(0.6, 5000, 0.2, 'highpass', 0.1);
  }

  // ---------- 音乐音序器 ----------
  _note(freq, t0, dur, type, gain, filterF = 0, dest) {
    const C = this.ctx;
    const o = C.createOscillator(), g = C.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t0);
    g.gain.setTargetAtTime(0.0001, t0 + dur * 0.7, dur * 0.16);
    let node = o;
    if (filterF) {
      const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterF; f.Q.value = 2;
      o.connect(f); node = f;
    }
    node.connect(g); g.connect(dest || this.musicG);
    o.start(t0); o.stop(t0 + dur + 0.1);
  }
  _kick(t0, gain = 0.75) {
    const C = this.ctx;
    const o = C.createOscillator(), g = C.createGain();
    o.frequency.setValueAtTime(150, t0);
    o.frequency.exponentialRampToValueAtTime(42, t0 + 0.11);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
    o.connect(g); g.connect(this.musicG);
    o.start(t0); o.stop(t0 + 0.2);
  }
  _hat(t0, open = false) {
    const C = this.ctx;
    const src = C.createBufferSource(); src.buffer = this.noiseBuf;
    const f = C.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
    const g = C.createGain();
    const dur = open ? 0.14 : 0.045;
    g.gain.setValueAtTime(open ? 0.14 : 0.1, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.musicG);
    src.start(t0, Math.random()); src.stop(t0 + dur + 0.02);
  }
  _snare(t0) {
    const C = this.ctx;
    const src = C.createBufferSource(); src.buffer = this.noiseBuf;
    const f = C.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8;
    const g = C.createGain();
    g.gain.setValueAtTime(0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.13);
    src.connect(f); f.connect(g); g.connect(this.musicG);
    src.start(t0, Math.random()); src.stop(t0 + 0.15);
    this._note(midi(62), t0, 0.08, 'triangle', 0.12, 0, this.musicG);
  }

  // 和弦进行（Am 调式明亮进行）：Em C G D → 根音 MIDI
  static CHORDS = [[52, 55, 59], [48, 52, 55], [55, 59, 62], [50, 54, 57]];

  _schedStep(step, t0, spb) {
    const bar = Math.floor(step / 16) % 4, s16 = step % 16;
    const ch = AudioManager.CHORDS[bar];

    if (this.musicMode === 'race') {
      if (s16 % 4 === 0) this._kick(t0);
      if (s16 % 4 === 2) this._hat(t0, s16 === 14);
      if (s16 === 4 || s16 === 12) this._snare(t0);
      if (this.intensity >= 1 && s16 % 2 === 1) this._hat(t0);
      // 贝斯：根音 8 分 + 八度跳
      if (s16 % 2 === 0) {
        const oct = (s16 === 6 || s16 === 14) ? 12 : 0;
        this._note(midi(ch[0] - 12 + oct), t0, spb * 1.6, 'sawtooth', 0.28, 320 + this.intensity * 300);
      }
      // STAB 和弦：每小节第 2、10 步
      if (s16 === 2 || s16 === 10) ch.forEach(n => this._note(midi(n + 12), t0, spb * 1.2, 'sawtooth', 0.07, 1400 + this.intensity * 1600));
      // 主音 ARP（16 分上行）
      const arpN = ch[(s16 + bar) % 3] + (s16 % 8 < 4 ? 24 : 12);
      this._note(midi(arpN), t0, spb * 0.9, 'square', this.intensity >= 1 ? 0.075 : 0.05, 2600 + this.intensity * 2200);
    } else {
      // 菜单：轻松夏日
      if (s16 === 0) this._kick(t0, 0.4);
      if (s16 === 8) this._kick(t0, 0.3);
      if (s16 === 4 || s16 === 12) this._hat(t0);
      if (s16 === 0) ch.forEach(n => this._note(midi(n), t0, spb * 14, 'sawtooth', 0.035, 900)); // 长PAD
      if (s16 % 4 === 0) this._note(midi(ch[(s16 / 4) % 3] + 12), t0, spb * 3.2, 'triangle', 0.09, 1600); // 缓琶音
    }
  }

  _startSeq(bpm) {
    this._stopSeq();
    const spb = 60 / bpm / 4; // 16分音符时长
    this._step = 0;
    this._nextT = this.ctx.currentTime + 0.1;
    this._seqTimer = setInterval(() => {
      if (!this.ctx || this.musicMode === null) return;
      while (this._nextT < this.ctx.currentTime + 0.12) {
        this._schedStep(this._step, this._nextT, spb);
        this._step++;
        this._nextT += spb;
      }
    }, 25);
  }
  _stopSeq() { if (this._seqTimer) { clearInterval(this._seqTimer); this._seqTimer = null; } }

  playMenu() { if (!this.ctx) return; this.musicMode = 'menu'; this._startSeq(108); }
  playRace() { if (!this.ctx) return; this.musicMode = 'race'; this.intensity = 0; this._startSeq(132); }
  setRaceIntensity(l) { this.intensity = l; }
  stopMusic() { this.musicMode = null; this._stopSeq(); }
}
