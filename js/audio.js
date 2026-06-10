// Web Audio API로 모든 효과음을 실시간 합성한다 (외부 음원 파일 불필요 → 정적 호스팅에 유리)
// - 주행 굉음/바람: 속도에 따라 음량·음색 변화
// - 리프트 클랙클랙, 사이렌(급락), 비명(급락/다이브), 폭죽(급등), 발사/충돌/브레이크
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.clackT = 0;
    this.climbing = false;
  }

  start() {
    if (!this.ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      this.ctx = new C();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(this.ctx.destination);
      this.noise = this._noiseBuffer(2);

      // 주행 굉음 (저역 노이즈 루프)
      this.rumbleSrc = this.ctx.createBufferSource();
      this.rumbleSrc.buffer = this.noise; this.rumbleSrc.loop = true;
      this.rumbleLP = this.ctx.createBiquadFilter();
      this.rumbleLP.type = 'lowpass'; this.rumbleLP.frequency.value = 120;
      this.rumbleG = this.ctx.createGain(); this.rumbleG.gain.value = 0;
      this.rumbleSrc.connect(this.rumbleLP).connect(this.rumbleG).connect(this.master);
      this.rumbleSrc.start();

      // 바람 소리 (중고역 노이즈 루프)
      this.windSrc = this.ctx.createBufferSource();
      this.windSrc.buffer = this.noise; this.windSrc.loop = true;
      const windBP = this.ctx.createBiquadFilter();
      windBP.type = 'bandpass'; windBP.frequency.value = 2200; windBP.Q.value = 0.8;
      this.windG = this.ctx.createGain(); this.windG.gain.value = 0;
      this.windSrc.connect(windBP).connect(this.windG).connect(this.master);
      this.windSrc.start();
    }
    this.ctx.resume();
  }

  _noiseBuffer(sec) {
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.floor(sr * sec), sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _noiseShot(when, dur, { type = 'bandpass', freq = 1000, q = 1, gain = 0.2, decay = true } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    if (decay) g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(when, Math.random());
    src.stop(when + dur + 0.05);
    return { f, g };
  }

  // 매 프레임: 속도(0~1)에 따라 굉음/바람 조절
  setMotion(v01, climbing) {
    if (!this.ctx) return;
    this.climbing = climbing;
    const t = this.ctx.currentTime;
    this.rumbleG.gain.setTargetAtTime(0.05 + v01 * 0.5, t, 0.1);
    this.rumbleLP.frequency.setTargetAtTime(90 + v01 * 320, t, 0.1);
    this.windG.gain.setTargetAtTime(v01 * v01 * 0.45, t, 0.1);
  }

  // 리프트 체인 클랙클랙
  update(dt) {
    if (!this.ctx || !this.climbing) return;
    this.clackT -= dt;
    if (this.clackT <= 0) {
      this.clackT = 0.13;
      this._noiseShot(this.ctx.currentTime, 0.03, { type: 'highpass', freq: 600, gain: 0.16 });
    }
  }

  siren(on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (on && !this._siren) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle'; osc.frequency.value = 800;
      const lfo = this.ctx.createOscillator();
      lfo.type = 'sine'; lfo.frequency.value = 1.2;
      const lfoG = this.ctx.createGain(); lfoG.gain.value = 170;
      lfo.connect(lfoG).connect(osc.frequency);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.15, t + 0.25);
      osc.connect(g).connect(this.master);
      osc.start(); lfo.start();
      this._siren = { osc, lfo, g };
    } else if (!on && this._siren) {
      const { osc, lfo, g } = this._siren;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.stop(t + 0.5); lfo.stop(t + 0.5);
      this._siren = null;
    }
  }

  // 만화 같은 "으아아악" 비명 합성
  scream() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.22, t + 0.06);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 1.5;
    bp.connect(out).connect(this.master);
    const vib = ctx.createOscillator();
    vib.frequency.value = 16;
    const vibG = ctx.createGain(); vibG.gain.value = 45;
    vib.connect(vibG);
    for (const det of [0, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(880 + det * 9, t);
      o.frequency.exponentialRampToValueAtTime(1350, t + 0.18);
      o.frequency.exponentialRampToValueAtTime(420, t + 1.45);
      vibG.connect(o.frequency);
      o.connect(bp);
      o.start(t); o.stop(t + 1.55);
    }
    vib.start(t); vib.stop(t + 1.55);
    this._noiseShot(t, 1.2, { freq: 1500, q: 0.7, gain: 0.05 });
  }

  firework() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._noiseShot(t, 0.5, { type: 'lowpass', freq: 320, gain: 0.45 });
    for (let i = 0; i < 6; i++) {
      this._noiseShot(t + 0.12 + i * 0.06 + Math.random() * 0.05, 0.05, { freq: 2500, q: 2, gain: 0.1 });
    }
  }

  launch() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(620, t + 2.8);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 850;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.4);
    g.gain.setValueAtTime(0.22, t + 3.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 5.5);
    o.connect(lp).connect(g).connect(this.master);
    o.start(t); o.stop(t + 5.6);
    const sh = this._noiseShot(t, 5.5, { freq: 900, q: 0.6, gain: 0.0001, decay: false });
    sh.g.gain.exponentialRampToValueAtTime(0.3, t + 2);
    sh.g.gain.exponentialRampToValueAtTime(0.0001, t + 5.4);
  }

  crash() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const sh = this._noiseShot(t, 1.5, { type: 'lowpass', freq: 1200, gain: 0.9 });
    sh.f.frequency.exponentialRampToValueAtTime(80, t + 1.2);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(70, t);
    sub.frequency.exponentialRampToValueAtTime(25, t + 1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    sub.connect(g).connect(this.master);
    sub.start(t); sub.stop(t + 1.3);
  }

  brake() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(1500, t);
    o.frequency.exponentialRampToValueAtTime(650, t + 1.6);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    o.connect(bp).connect(g).connect(this.master);
    o.start(t); o.stop(t + 1.8);
    this._noiseShot(t, 1.5, { freq: 800, q: 0.7, gain: 0.08 });
  }

  // 주행 관련 루프 음 끄기 (사이렌 포함)
  quiet() {
    if (!this.ctx) return;
    this.siren(false);
    this.climbing = false;
    const t = this.ctx.currentTime;
    this.rumbleG.gain.setTargetAtTime(0, t, 0.2);
    this.windG.gain.setTargetAtTime(0, t, 0.2);
  }
}
