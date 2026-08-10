/* THE SOUND LAYER — procedural, seeded, per-world score + sound design.

   One engine owns the whole musical graph. It borrows the VoiceEngine's
   AudioContext when the mic came up (so music lands in the SAME
   MediaStreamDestination the recorder already takes — zero extra plumbing),
   and when the mic failed it builds its own context + destination so a
   video-only session still ships with score in the file.

   Everything is synthesized: no samples, no downloads, no network.
   Beds are deterministic from a world-keyed seed — the same world always
   sings the same song. */

/* per-world musical identity: root (Hz), scale intervals (semitones),
   tempo, filter brightness, character mix */
const WORLD_MUSIC = {
  'nebula-drift': { root: 110.0, scale: [0, 3, 5, 7, 10], bpm: 64, bright: 1400, swell: 0.15 },
  'red-planet': { root: 98.0, scale: [0, 1, 5, 7, 8], bpm: 56, bright: 900, swell: 0.35 },
  'derelict-station': { root: 82.4, scale: [0, 3, 5, 7, 10], bpm: 50, bright: 2100, swell: 0.22 },
  'asteroid-earth': { root: 130.8, scale: [0, 2, 4, 7, 9], bpm: 66, bright: 1700, swell: 0.1 },
  'dying-star': { root: 65.4, scale: [0, 2, 3, 7, 8], bpm: 46, bright: 700, swell: 0.5 },
};

/* deterministic PRNG — the bed for a world is the same on every boot */
function rng(seedStr) {
  let s = 0;
  for (let i = 0; i < seedStr.length; i++) s = (s * 31 + seedStr.charCodeAt(i)) >>> 0;
  s = s || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function noiseBuffer(ctx, seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

const BED_LEVEL = 0.055;   // ≈ -22 dBFS under voice
const BED_SOLO = 0.11;     // ≈ -16 dBFS when nothing else is talking
const DUCK_RATIO = 0.6;    // ~ -4.4 dB while the gate is open

export class MusicEngine {
  constructor(voice) {
    this.voice = voice || null;
    this.ready = false;
    this.enabled = true;
    this.bedVol = 1;
    this.sfxVol = 1;
    this.worldKey = null;
    this.bed = null;         // current bed graph
    this.ownCtx = false;
  }

  /* build the mix bus. Safe to call once; never throws. */
  init() {
    if (this.ready) return true;
    try {
      if (this.voice && this.voice.ready && this.voice.ctx) {
        this.ctx = this.voice.ctx;
      } else {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
        this.ownCtx = true;
      }
      const ctx = this.ctx;

      this.musicBus = ctx.createGain(); this.musicBus.gain.value = 1;
      this.bedBus = ctx.createGain(); this.bedBus.gain.value = BED_LEVEL;
      this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.22;
      this.duckGain = ctx.createGain(); this.duckGain.gain.value = 1;

      // gentle compressor before joining the recording path — the voice chain's
      // limiter still owns the final ceiling on the mic path
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -24; this.comp.knee.value = 12; this.comp.ratio.value = 2.5;
      this.comp.attack.value = 0.02; this.comp.release.value = 0.3;

      this.bedBus.connect(this.duckGain); this.duckGain.connect(this.musicBus);
      this.sfxBus.connect(this.musicBus);
      this.musicBus.connect(this.comp);

      // into the recording: the voice engine's dest when it exists, else our own
      if (this.voice && this.voice.ready && this.voice.dest) {
        this.comp.connect(this.voice.dest);
      } else {
        this.ownDest = ctx.createMediaStreamDestination();
        this.comp.connect(this.ownDest);
      }

      // local monitor (speakers/headphones) — separate from the recorded path
      this.monitorGain = ctx.createGain(); this.monitorGain.gain.value = 0.8;
      this.comp.connect(this.monitorGain);
      this.monitorGain.connect(ctx.destination);

      this.noise = noiseBuffer(ctx);
      this.ready = true;
      return true;
    } catch (_) {
      this.ready = false;
      return false;
    }
  }

  /* the recorded stream when the engine owns its own context (mic failed) */
  get stream() { return this.ready && this.ownDest ? this.ownDest.stream : null; }

  async resume() { if (this.ctx && this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch (_) {} } }

  _ramp(param, v, tc = 0.08) { try { param.setTargetAtTime(v, this.ctx.currentTime, tc); } catch (_) {} }

  setEnabled(on) {
    this.enabled = on;
    if (!this.ready) return;
    this._ramp(this.musicBus.gain, on ? 1 : 0, 0.2);
    if (on && !this.bed && this.worldKey) this._startBed(this.worldKey);
  }

  setBedVolume(v) { this.bedVol = v; if (this.ready) this._ramp(this.bedBus.gain, BED_LEVEL * v, 0.15); }
  setSfxVolume(v) { this.sfxVol = v; if (this.ready) this._ramp(this.sfxBus.gain, 0.22 * v, 0.1); }
  setMonitor(on) { if (this.ready) this._ramp(this.monitorGain.gain, on ? 0.8 : 0, 0.1); }

  /* sidechain-lite: poll the voice gate from the telemetry interval */
  duck(gateOpen) {
    if (!this.ready) return;
    this._ramp(this.duckGain.gain, gateOpen ? DUCK_RATIO : 1, gateOpen ? 0.06 : 0.35);
  }

  /* ------------------------------------------------------------------ */
  /* WORLD BEDS — drone + sparse pentatonic arp + character noise swell   */

  setWorld(key) {
    if (!this.ready || key === this.worldKey) { this.worldKey = key; return; }
    this.worldKey = key;
    if (!this.enabled) return;
    this._startBed(key);
  }

  _startBed(key) {
    const spec = WORLD_MUSIC[key] || WORLD_MUSIC['nebula-drift'];
    const ctx = this.ctx;
    const old = this.bed;

    // 1.5s crossfade between beds
    if (old) {
      this._ramp(old.gain.gain, 0, 0.5);
      setTimeout(() => old.stop(), 1800);
    }

    const rand = rng(key);
    const bedGain = ctx.createGain();
    bedGain.gain.value = 0;
    bedGain.connect(this.bedBus);
    this._ramp(bedGain.gain, 1, 0.55);

    const nodes = [];
    const timers = [];

    // drone layer: detuned saw/triangle through a slowly breathing lowpass
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = spec.bright; lp.Q.value = 0.6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + rand() * 0.04;
    const lfoAmt = ctx.createGain(); lfoAmt.gain.value = spec.bright * 0.35;
    lfo.connect(lfoAmt); lfoAmt.connect(lp.frequency); lfo.start();
    nodes.push(lfo);
    const droneOut = ctx.createGain(); droneOut.gain.value = 0.5;
    lp.connect(droneOut); droneOut.connect(bedGain);
    const detunes = [-7, 0, 5 + rand() * 4];
    detunes.forEach((cents, i) => {
      const o = ctx.createOscillator();
      o.type = i === 1 ? 'triangle' : 'sawtooth';
      o.frequency.value = spec.root * (i === 2 ? 2 : 1);
      o.detune.value = cents;
      const g = ctx.createGain(); g.gain.value = i === 1 ? 0.5 : 0.22;
      o.connect(g); g.connect(lp); o.start();
      nodes.push(o);
    });

    // character noise swell — dying-star / red-planet get heavy solar wind
    const nsrc = ctx.createBufferSource(); nsrc.buffer = this.noise; nsrc.loop = true;
    const nbp = ctx.createBiquadFilter(); nbp.type = 'bandpass'; nbp.frequency.value = 260 + rand() * 200; nbp.Q.value = 1.4;
    const nlfo = ctx.createOscillator(); nlfo.frequency.value = 0.03 + rand() * 0.03;
    const ng = ctx.createGain(); ng.gain.value = spec.swell * 0.4;
    const nlfoAmt = ctx.createGain(); nlfoAmt.gain.value = spec.swell * 0.3;
    nlfo.connect(nlfoAmt); nlfoAmt.connect(ng.gain); nlfo.start();
    nsrc.connect(nbp); nbp.connect(ng); ng.connect(bedGain);
    nsrc.start();
    nodes.push(nsrc, nlfo);

    // sparse pentatonic arp — scheduled ahead, seeded, never busy
    const beat = 60 / spec.bpm;
    const arpTimer = setInterval(() => {
      if (ctx.state !== 'running') return;
      // roughly one note per 2 beats, seeded pattern
      if (rand() > 0.44) return;
      const deg = spec.scale[Math.floor(rand() * spec.scale.length)];
      const oct = rand() > 0.75 ? 4 : 2;
      const f = spec.root * oct * Math.pow(2, deg / 12);
      const t0 = ctx.currentTime + 0.05;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0;
      g.gain.setValueAtTime(0, t0);
      g.gain.setTargetAtTime(0.16, t0, 0.06);
      g.gain.setTargetAtTime(0, t0 + 0.25, beat * 0.5);
      o.connect(g); g.connect(bedGain);
      o.start(t0); o.stop(t0 + beat * 3);
    }, beat * 2000);
    timers.push(arpTimer);

    this.bed = {
      gain: bedGain,
      stop() {
        timers.forEach(clearInterval);
        nodes.forEach((n) => { try { n.stop(); } catch (_) {} });
        try { bedGain.disconnect(); } catch (_) {}
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* ONE-SHOTS — sound design for FX beats, stunts and the countdown      */

  _now() { return this.ctx.currentTime; }

  /** filtered noise sweep — shake / pass-bys */
  whoosh(ms = 500) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t0 = this._now();
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.8;
    bp.frequency.setValueAtTime(300, t0);
    bp.frequency.exponentialRampToValueAtTime(3200, t0 + ms / 2000);
    bp.frequency.exponentialRampToValueAtTime(500, t0 + ms / 1000);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.7, t0 + ms / 2500);
    g.gain.linearRampToValueAtTime(0, t0 + ms / 1000);
    src.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    src.start(t0); src.stop(t0 + ms / 1000 + 0.05);
  }

  /** sine drop + noise burst — zoom punches, landings */
  impact() {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t0 = this._now();
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(180, t0);
    o.frequency.exponentialRampToValueAtTime(38, t0 + 0.28);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.9, t0);
    og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.42);
    o.connect(og); og.connect(this.sfxBus);
    o.start(t0); o.stop(t0 + 0.5);
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const nlp = ctx.createBiquadFilter(); nlp.type = 'lowpass'; nlp.frequency.value = 1400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, t0);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
    n.connect(nlp); nlp.connect(ng); ng.connect(this.sfxBus);
    n.start(t0); n.stop(t0 + 0.2);
  }

  /** rising tension sweep — flares, pulses */
  riser(ms = 900) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t0 = this._now(), dur = ms / 1000;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(90, t0);
    o.frequency.exponentialRampToValueAtTime(700, t0 + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t0);
    lp.frequency.exponentialRampToValueAtTime(4200, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t0);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + dur * 0.9);
    g.gain.linearRampToValueAtTime(0, t0 + dur + 0.08);
    o.connect(lp); lp.connect(g); g.connect(this.sfxBus);
    o.start(t0); o.stop(t0 + dur + 0.15);
  }

  /** short digital zap — glitch/static beats */
  glitchZap() {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t0 = this._now();
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(1800, t0);
    o.frequency.exponentialRampToValueAtTime(120, t0 + 0.11);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t0); o.stop(t0 + 0.18);
  }

  /** countdown tick — silent if the engine never came up */
  blip(final = false) {
    if (!this.ready) return;
    const ctx = this.ctx, t0 = this._now();
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.value = final ? 1320 : 880;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + (final ? 0.28 : 0.12));
    o.connect(g); g.connect(this.sfxBus);
    o.start(t0); o.stop(t0 + 0.32);
  }

  dispose() {
    if (this.bed) this.bed.stop();
    this.bed = null;
    if (this.ownCtx && this.ctx) { try { this.ctx.close(); } catch (_) {} }
    this.ready = false;
  }
}
