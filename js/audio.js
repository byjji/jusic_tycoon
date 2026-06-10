// 효과음 엔진
// 1순위: sounds/ 폴더의 음원 파일 재생 (mp3 / wav / ogg)
// 2순위: 파일이 없으면 Web Audio 합성음으로 자동 대체
// 필요한 파일 목록은 sounds/README.md 참고
const SOUND_DEFS = {
  coaster:  { file: 'coaster_loop', loop: true }, // 주행 굉음 (루프)
  wind:     { file: 'wind_loop',    loop: true }, // 바람 (루프)
  clack:    { file: 'lift_clack' },               // 리프트 체인 딸깍 1회
  siren:    { file: 'siren_loop',   loop: true }, // 급락 사이렌 (루프)
  scream:   { file: 'scream' },                   // 비명
  firework: { file: 'firework' },                 // 폭죽
  launch:   { file: 'launch' },                   // 로켓 발사
  crash:    { file: 'crash' },                    // 충돌 폭발
  brake:    { file: 'brake' },                    // 브레이크
};
const EXTS = ['mp3', 'wav', 'ogg'];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.clackT = 0;
    this.climbing = false;
  }

  start() {
    if (!this.ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      this.ctx = new C();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1.0;
      this.master.connect(this.ctx.destination);
      this.noise = this._noiseBuffer(2);
      this._buildLoops();
      this._loadAll();
    }
    this.ctx.resume();
  }

  async _loadAll() {
    await Promise.all(Object.entries(SOUND_DEFS).map(async ([name, def]) => {
      for (const ext of EXTS) {
        try {
          const res = await fetch(`sounds/${def.file}.${ext}`);
          if (!res.ok) continue;
          this.buffers[name] = await this.ctx.decodeAudioData(await res.arrayBuffer());
          return;
        } catch { /* 다음 확장자 시도 */ }
      }
      console.info(`[audio] sounds/${def.file}.(mp3|wav|ogg) 없음 → 합성음으로 대체`);
    }));
    // 루프 음원이 로드됐으면 합성 루프를 파일 루프로 교체
    this._swapLoop('coaster');
    this._swapLoop('wind');
  }

  _noiseBuffer(sec) {
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.floor(sr * sec), sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // 합성 주행음/바람 루프 (게인 노드는 파일 루프로 교체돼도 그대로 사용)
  _buildLoops() {
    this.rumbleSynthSrc = this.ctx.createBufferSource();
    this.rumbleSynthSrc.buffer = this.noise;
    this.rumbleSynthSrc.loop = true;
    this.rumbleLP = this.ctx.createBiquadFilter();
    this.rumbleLP.type = 'lowpass';
    this.rumbleLP.frequency.value = 120;
    this.rumbleG = this.ctx.createGain();
    this.rumbleG.gain.value = 0;
    this.rumbleSynthSrc.connect(this.rumbleLP).connect(this.rumbleG).connect(this.master);
    this.rumbleSynthSrc.start();

    this.windSynthSrc = this.ctx.createBufferSource();
    this.windSynthSrc.buffer = this.noise;
    this.windSynthSrc.loop = true;
    const windBP = this.ctx.createBiquadFilter();
    windBP.type = 'bandpass';
    windBP.frequency.value = 2200;
    windBP.Q.value = 0.8;
    this.windG = this.ctx.createGain();
    this.windG.gain.value = 0;
    this.windSynthSrc.connect(windBP).connect(this.windG).connect(this.master);
    this.windSynthSrc.start();
  }

  _swapLoop(name) {
    const buf = this.buffers[name];
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    if (name === 'coaster') {
      if (this.rumbleSynthSrc) { this.rumbleSynthSrc.stop(); this.rumbleSynthSrc = null; }
      src.connect(this.rumbleG);
      this.rumbleFile = src;
    } else {
      if (this.windSynthSrc) { this.windSynthSrc.stop(); this.windSynthSrc = null; }
      src.connect(this.windG);
      this.windFile = src;
    }
    src.start();
  }

  // 파일 원샷 재생. 파일이 없으면 false → 호출부에서 합성음 폴백
  _play(name, { gain = 0.4, rate = 1 } = {}) {
    const buf = this.buffers[name];
    if (!buf || !this.ctx) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.start();
    return true;
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
    this.rumbleG.gain.setTargetAtTime(0.08 + v01 * 0.7, t, 0.1);
    this.windG.gain.setTargetAtTime(v01 * v01 * 0.6, t, 0.1);
    if (this.rumbleFile) this.rumbleFile.playbackRate.setTargetAtTime(0.75 + v01 * 0.5, t, 0.1);
    else this.rumbleLP.frequency.setTargetAtTime(90 + v01 * 320, t, 0.1);
    if (this.windFile) this.windFile.playbackRate.setTargetAtTime(0.8 + v01 * 0.4, t, 0.1);
  }

  // 리프트 체인 클랙클랙
  update(dt) {
    if (!this.ctx || !this.climbing) return;
    this.clackT -= dt;
    if (this.clackT <= 0) {
      this.clackT = 0.13;
      if (!this._play('clack', { gain: 0.35, rate: 0.95 + Math.random() * 0.1 })) {
        this._noiseShot(this.ctx.currentTime, 0.03, { type: 'highpass', freq: 600, gain: 0.22 });
      }
    }
  }

  siren(on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (on && !this._siren) {
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.34, t + 0.2);
      g.connect(this.master);
      const nodes = [];
      if (this.buffers.siren) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.buffers.siren;
        src.loop = true;
        src.connect(g);
        src.start();
        nodes.push(src);
      } else {
        const osc = this.ctx.createOscillator();
        osc.type = 'triangle'; osc.frequency.value = 800;
        const lfo = this.ctx.createOscillator();
        lfo.type = 'sine'; lfo.frequency.value = 1.2;
        const lfoG = this.ctx.createGain(); lfoG.gain.value = 170;
        lfo.connect(lfoG).connect(osc.frequency);
        osc.connect(g);
        osc.start(); lfo.start();
        nodes.push(osc, lfo);
      }
      this._siren = { g, nodes };
    } else if (!on && this._siren) {
      const { g, nodes } = this._siren;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      for (const n of nodes) n.stop(t + 0.5);
      this._siren = null;
    }
  }

  // 비명: 파일 우선, 없으면 만화풍 합성
  scream() {
    if (!this.ctx) return;
    if (this._play('scream', { gain: 0.55, rate: 0.95 + Math.random() * 0.1 })) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.32, t + 0.06);
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
    this._noiseShot(t, 1.2, { freq: 1500, q: 0.7, gain: 0.07 });
  }

  firework() {
    if (!this.ctx) return;
    if (this._play('firework', { gain: 0.55, rate: 0.85 + Math.random() * 0.3 })) return;
    const t = this.ctx.currentTime;
    this._noiseShot(t, 0.5, { type: 'lowpass', freq: 320, gain: 0.6 });
    for (let i = 0; i < 6; i++) {
      this._noiseShot(t + 0.12 + i * 0.06 + Math.random() * 0.05, 0.05, { freq: 2500, q: 2, gain: 0.15 });
    }
  }

  launch() {
    if (!this.ctx) return;
    if (this._play('launch', { gain: 0.55 })) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(620, t + 2.8);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 850;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.4);
    g.gain.setValueAtTime(0.3, t + 3.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 5.5);
    o.connect(lp).connect(g).connect(this.master);
    o.start(t); o.stop(t + 5.6);
    const sh = this._noiseShot(t, 5.5, { freq: 900, q: 0.6, gain: 0.0001, decay: false });
    sh.g.gain.exponentialRampToValueAtTime(0.4, t + 2);
    sh.g.gain.exponentialRampToValueAtTime(0.0001, t + 5.4);
  }

  crash() {
    if (!this.ctx) return;
    if (this._play('crash', { gain: 0.9 })) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const sh = this._noiseShot(t, 1.5, { type: 'lowpass', freq: 1200, gain: 1.0 });
    sh.f.frequency.exponentialRampToValueAtTime(80, t + 1.2);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(70, t);
    sub.frequency.exponentialRampToValueAtTime(25, t + 1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    sub.connect(g).connect(this.master);
    sub.start(t); sub.stop(t + 1.3);
  }

  brake() {
    if (!this.ctx) return;
    if (this._play('brake', { gain: 0.45 })) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(1500, t);
    o.frequency.exponentialRampToValueAtTime(650, t + 1.6);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.15, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    o.connect(bp).connect(g).connect(this.master);
    o.start(t); o.stop(t + 1.8);
    this._noiseShot(t, 1.5, { freq: 800, q: 0.7, gain: 0.12 });
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
