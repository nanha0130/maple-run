// Everything is synthesised at runtime: no audio files.
// Pentatonic koto-ish plucks over a light drum loop, wind in the maples, gravel footsteps, a station master's whistle.
const PENTA = [0, 2, 4, 7, 9]; // major pentatonic (yo scale feel)
const midi = n => 440 * Math.pow(2, (n - 69) / 12);

export class Audio {
  constructor() { this.ctx = null; this.ks = new Map(); this.muted = false; }
  // `offline`: an OfflineAudioContext to render into (tools/record.mjs replays logged events through it).
  init(offline) {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const ctx = this.ctx = offline || new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = .85; this.master.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = 0; this.music.connect(this.master);
    this.verb = ctx.createConvolver(); this.verb.buffer = this.impulse(2.2, 2.6); const vg = ctx.createGain(); vg.gain.value = .28; this.verb.connect(vg); vg.connect(this.master);
    this.music.connect(this.verb);
    this.startWind();
    this.beat = 0; this.nextBeat = 0; this.playing = false;
  }
  get t() { return this.forceT ?? this.ctx.currentTime; }
  impulse(sec, decay) {
    const ctx = this.ctx, len = ctx.sampleRate * sec, b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  }
  noiseBuffer(sec, brown = false) {
    const ctx = this.ctx, len = ctx.sampleRate * sec, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + .02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
    return b;
  }
  startWind() {
    const ctx = this.ctx;
    // soft wind + rustling leaves (a fluttering high band)
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer(6, true); src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = .6;
    const g = ctx.createGain(); g.gain.value = .16; src.connect(bp); bp.connect(g); g.connect(this.sfx); src.start();
    const r = ctx.createBufferSource(); r.buffer = this.noiseBuffer(4); r.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 5200; hp.Q.value = .8;
    const rg = ctx.createGain(); rg.gain.value = .0;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 7; const lg = ctx.createGain(); lg.gain.value = .012; lfo.connect(lg); lg.connect(rg.gain);
    r.connect(hp); hp.connect(rg); rg.connect(this.sfx); r.start(); lfo.start();
    this.rustle = rg; this.windGain = g;
  }
  setSpeed(k) { if (!this.ctx) return; this.windGain.gain.setTargetAtTime(.12 + k * .2, this.t, .3); this.rustle.gain.setTargetAtTime(.012 + k * .02, this.t, .3); }

  pluckBuffer(freq) {
    const key = Math.round(freq); if (this.ks.has(key)) return this.ks.get(key);
    const ctx = this.ctx, sr = ctx.sampleRate, len = Math.floor(sr * 1.8), b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    const N = Math.round(sr / freq), ring = new Float32Array(N); for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
    let p = 0; for (let i = 0; i < len; i++) { const nx = (p + 1) % N; const v = (ring[p] + ring[nx]) * .5 * .994; d[i] = ring[p]; ring[p] = v; p = nx; }
    this.ks.set(key, b); return b;
  }
  pluck(freq, when, vel = .3, dest = this.music) {
    const s = this.ctx.createBufferSource(); s.buffer = this.pluckBuffer(freq);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3200;
    const g = this.ctx.createGain(); g.gain.value = vel; s.connect(f); f.connect(g); g.connect(dest); s.start(when);
  }
  drum(when, { f0 = 140, f1 = 50, dur = .25, vel = .5, noise = 0 } = {}) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(f0, when); o.frequency.exponentialRampToValueAtTime(f1, when + dur * .8);
    g.gain.setValueAtTime(vel, when); g.gain.exponentialRampToValueAtTime(.001, when + dur);
    o.connect(g); g.connect(this.music); o.start(when); o.stop(when + dur + .05);
    if (noise) { const n = ctx.createBufferSource(); n.buffer = this.noiseBuffer(.2); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000; const ng = ctx.createGain();
      ng.gain.setValueAtTime(noise, when); ng.gain.exponentialRampToValueAtTime(.001, when + .06); n.connect(hp); hp.connect(ng); ng.connect(this.music); n.start(when); }
  }
  // 16-step loop at 132 bpm: taiko-ish kick, shaker, pentatonic plucks that walk a small chord cycle.
  startMusic() { if (!this.ctx) return; this.playing = true; this.nextBeat = this.t + .1; this.beat = 0; this.music.gain.setTargetAtTime(.55, this.t, .5); }
  stopMusic() { if (!this.ctx) return; this.playing = false; this.music.gain.setTargetAtTime(0, this.t, .4); }
  tick() {
    if (!this.ctx || !this.playing) return;
    const step = 60 / 132 / 4;
    while (this.nextBeat < this.t + .2) {
      const w = this.nextBeat, b = this.beat % 16, bar = Math.floor(this.beat / 16) % 4;
      if (b === 0 || b === 6 || b === 10) this.drum(w, { vel: .5 });
      if (b === 4 || b === 12) this.drum(w, { f0: 320, f1: 180, dur: .12, vel: .22, noise: .08 });
      if (b % 2 === 1) this.drum(w, { f0: 9000, f1: 8000, dur: .02, vel: .0, noise: .035 });
      const root = [62, 57, 59, 55][bar];
      const pat = [0, -1, 2, 4, -1, 3, 2, -1, 1, -1, 4, 2, -1, 5, 3, 1];
      const k = pat[b]; if (k >= 0) { const deg = k % 5, oct = Math.floor(k / 5); this.pluck(midi(root + 12 + PENTA[deg] + oct * 12), w, .22 + (b % 4 === 0 ? .08 : 0)); }
      if (b === 0 || b === 8) this.pluck(midi(root - 12), w, .35);
      this.nextBeat += step; this.beat++;
    }
  }

  // ---------------------------------------------------------------- sfx
  env(node, when, a, d, peak) { const g = this.ctx.createGain(); g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(peak, when + a); g.gain.exponentialRampToValueAtTime(.001, when + a + d); node.connect(g); g.connect(this.sfx); return g; }
  noiseHit(when, { f = 800, q = 1, type = 'bandpass', a = .003, d = .12, vel = .3, len = .4 } = {}) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuffer(len); const bp = this.ctx.createBiquadFilter(); bp.type = type; bp.frequency.value = f; bp.Q.value = q;
    s.connect(bp); this.env(bp, when, a, d, vel); s.start(when); s.stop(when + a + d + .05); return bp;
  }
  step() { if (!this.ctx) return; this.noiseHit(this.t, { f: 1400 + Math.random() * 600, q: .9, d: .07, vel: .12 }); }
  jump() { if (!this.ctx) return; const bp = this.noiseHit(this.t, { f: 900, q: 1.2, a: .02, d: .3, vel: .22 }); bp.frequency.exponentialRampToValueAtTime(2600, this.t + .3); }
  roll() { if (!this.ctx) return; const bp = this.noiseHit(this.t, { f: 2400, q: .8, a: .03, d: .4, vel: .18 }); bp.frequency.exponentialRampToValueAtTime(600, this.t + .4); }
  land() { if (!this.ctx) return; this.drum(this.t, { f0: 120, f1: 50, dur: .15, vel: .3 }); this.noiseHit(this.t, { f: 1200, d: .1, vel: .15 }); }
  swish() { if (!this.ctx) return; const bp = this.noiseHit(this.t, { f: 3000, q: 1.5, a: .01, d: .14, vel: .08 }); bp.frequency.exponentialRampToValueAtTime(1600, this.t + .15); }
  coin(streak = 0) {
    if (!this.ctx) return;
    const n = 79 + PENTA[streak % 5] + Math.floor(streak / 5) % 2 * 12, t = this.t;
    for (const [mul, v, type] of [[1, .12, 'sine'], [2, .05, 'triangle'], [3.01, .02, 'sine']]) {
      const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = midi(n) * mul; this.env(o, t, .002, .35, v); o.start(t); o.stop(t + .4);
    }
  }
  bump() { if (!this.ctx) return; this.drum(this.t, { f0: 90, f1: 40, dur: .3, vel: .6, noise: .15 }); this.whistle(.35); }
  crash() {
    if (!this.ctx) return; const t = this.t;
    this.drum(t, { f0: 70, f1: 30, dur: .6, vel: .9, noise: .3 }); this.noiseHit(t, { f: 500, q: .5, d: .5, vel: .5, len: .8 });
    this.stopMusic(); setTimeout(() => this.whistle(.9), 500);
  }
  whistle(dur = .5) {
    const ctx = this.ctx, t = this.t, o = ctx.createOscillator(); o.frequency.value = 2750;
    const v = ctx.createOscillator(); v.frequency.value = 38; const vg = ctx.createGain(); vg.gain.value = 180; v.connect(vg); vg.connect(o.frequency);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.09, t + .02); g.gain.setValueAtTime(.09, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + .05);
    o.connect(g); g.connect(this.sfx); o.start(t); v.start(t); o.stop(t + dur + .1); v.stop(t + dur + .1);
    this.noiseHit(t, { f: 2800, q: 4, a: .02, d: dur, vel: .05, len: dur + .2 });
  }
  horn() {
    if (!this.ctx) return; const ctx = this.ctx, t = this.t;
    for (const f of [311, 370]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.07, t + .05); g.gain.setValueAtTime(.07, t + .7); g.gain.linearRampToValueAtTime(0, t + .9);
      o.connect(lp); lp.connect(g); g.connect(this.sfx); g.connect(this.verb); o.start(t); o.stop(t + 1);
    }
  }
  rumble(on) {
    if (!this.ctx) return;
    if (!this.rumbleNode) {
      const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuffer(3, true); s.loop = true; const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
      const g = this.ctx.createGain(); g.gain.value = 0; s.connect(lp); lp.connect(g); g.connect(this.sfx); s.start(); this.rumbleNode = g;
    }
    this.rumbleNode.gain.setTargetAtTime(on, this.t, .2);
  }
  powerup() {
    if (!this.ctx) return; const t = this.t;
    [0, 4, 7, 12, 16].forEach((st, i) => { const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = midi(72 + st); this.env(o, t + i * .06, .005, .3, .09); o.start(t + i * .06); o.stop(t + i * .06 + .4); });
    const bp = this.noiseHit(t, { f: 1500, q: .7, a: .05, d: .5, vel: .12 }); bp.frequency.exponentialRampToValueAtTime(6000, t + .5);
  }
  powerEnding() { if (!this.ctx) return; const t = this.t; for (const k of [0, .18, .36]) { const o = this.ctx.createOscillator(); o.frequency.value = 880; this.env(o, t + k, .003, .08, .05); o.start(t + k); o.stop(t + k + .12); } }
  jet(on) {
    if (!this.ctx) return;
    if (!this.jetNode) {
      const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuffer(3); s.loop = true;
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = .5;
      const g = this.ctx.createGain(); g.gain.value = 0; s.connect(bp); bp.connect(g); g.connect(this.sfx); s.start(); this.jetNode = g;
    }
    this.jetNode.gain.setTargetAtTime(on ? .16 : 0, this.t, on ? .08 : .25);
  }
  setMuted(m) { this.muted = m; if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : .85, this.t, .05); }
}
