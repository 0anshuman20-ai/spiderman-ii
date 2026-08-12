/* SPIDER VOICE — script-first, MIC-FREE voice engine.

   The old pipeline processed your live microphone. This one never touches it:
   1. You hand over the script BEFORE recording.
   2. Every line is pre-synthesized into a young, energetic "friendly
      neighborhood" TTS voice (free StreamElements/Polly voices — Justin is the
      closest free thing to Peter Parker) and decoded into AudioBuffers.
   3. While recording, the tracker watches YOUR lips. The instant your mouth
      starts moving after a quiet gap, the next line fires — so the voice lands
      exactly when you speak, and because the engine already knows the script,
      what plays is exactly what you are mouthing.
   4. Playback runs through a "voice inside the mask" chain (presence EQ, soft
      muffle, compression, limiter) into a MediaStreamDestination the recorder
      consumes. getUserMedia(audio) is never called.

   The class keeps the VoiceEngine surface the MusicEngine + Studio expect:
   ready / ctx / dest / stream / level / outputLevel() / setMonitor() /
   resume() / triggerGlitch() / dispose(). */

const TTS_ENDPOINT = 'https://api.streamelements.com/kappa/v2/speech';
// ordered by how "Peter Parker" they sound: Justin is a bright young US male
const TTS_VOICES = ['Justin', 'Matthew', 'Joey'];

/* split a script into speakable lines: hard breaks first, then sentences */
export function splitScript(text) {
  const out = [];
  String(text || '')
    .split(/\n+/)
    .forEach((row) => {
      row
        .split(/(?<=[.!?…])\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((s) => out.push(s));
    });
  return out;
}

export class SpideyVoice {
  constructor({ onStatus } = {}) {
    this.onStatus = onStatus;
    this.ready = false;
    this.level = { rms: 0, gateOpen: false };
    this.lines = [];          // [{ text, buffer|null, ok }]
    this.idx = 0;             // next line to fire
    this.currentLine = -1;    // line playing right now (-1 idle)
    this.playing = false;
    this.synthState = 'empty'; // empty | working | ready | error
    this._quietT = 1;          // seconds of closed mouth accumulated
    this._cooldown = 0;
    this._src = null;
    this._utter = null;        // live speechSynthesis utterance (fallback mode)
  }

  /* the take may roll once every line is voiced — either as decoded buffers or
     via the browser's own speech engine when the free TTS is unreachable */
  canRoll() {
    return this.synthState === 'ready' || this.synthState === 'fallback';
  }

  async init() {
    if (this.ready) return true;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000, latencyHint: 'interactive' });
      this.ctx = ctx;

      /* "voice inside the mask" chain — shared by every line */
      this.voiceIn = ctx.createGain(); this.voiceIn.gain.value = 1;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90; hp.Q.value = 0.7;
      // youthful presence: the band that makes the quips cut through
      const presence = ctx.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 2600; presence.Q.value = 1.0; presence.gain.value = 3.5;
      // a whisper of chest so it never sounds like a phone speaker
      const body = ctx.createBiquadFilter(); body.type = 'lowshelf'; body.frequency.value = 170; body.gain.value = 2;
      // the mask itself: fabric over the mouth shaves the very top octave
      const muffle = ctx.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = 8600; muffle.Q.value = 0.6;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -22; comp.knee.value = 10; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.14;
      const makeup = ctx.createGain(); makeup.gain.value = 1.9;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -1.2; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.0005; limiter.release.value = 0.05;

      this.outGain = ctx.createGain(); this.outGain.gain.value = 1;
      this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 1024;
      this.dest = ctx.createMediaStreamDestination();
      this.monitorGain = ctx.createGain(); this.monitorGain.gain.value = 0;

      this.voiceIn.connect(hp); hp.connect(presence); presence.connect(body); body.connect(muffle);
      muffle.connect(comp); comp.connect(makeup); makeup.connect(limiter); limiter.connect(this.outGain);
      this.outGain.connect(this.analyser);
      this.outGain.connect(this.dest);
      this.outGain.connect(this.monitorGain);
      this.monitorGain.connect(ctx.destination);

      this._levelBuf = new Uint8Array(this.analyser.fftSize);
      // warm the browser voice list so the offline fallback has one ready
      if (window.speechSynthesis) {
        try {
          window.speechSynthesis.getVoices();
          window.speechSynthesis.addEventListener('voiceschanged', () => { this._sysVoice = null; }, { once: true });
        } catch (_) {}
      }
      this.ready = true;
      if (this.onStatus) this.onStatus({ level: 'ok', message: 'spider voice online — mic never used' });
      return true;
    } catch (err) {
      this.ready = false;
      if (this.onStatus) this.onStatus({ level: 'error', message: `voice engine failed: ${err.message}` });
      return false;
    }
  }

  /* fetch one line as an AudioBuffer, walking the voice ladder on failure.
     every request is hard-capped so a dead network can never hang the sheet. */
  async _fetchLine(text) {
    for (const voice of TTS_VOICES) {
      const ctrl = new AbortController();
      const kill = setTimeout(() => ctrl.abort(), 8000);
      try {
        const url = `${TTS_ENDPOINT}?voice=${voice}&text=${encodeURIComponent(text)}`;
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(kill);
        if (!res.ok) continue;
        const arr = await res.arrayBuffer();
        if (!arr || arr.byteLength < 200) continue;
        return await this.ctx.decodeAudioData(arr.slice(0));
      } catch (_) { clearTimeout(kill); /* next voice */ }
    }
    return null;
  }

  /* pre-generate the whole script. onProgress(done, total). Resolves to
     true when at least one line synthesized. */
  async synthesize(text, onProgress) {
    if (!this.ready) return false;
    this.stopPlayback();
    const parts = splitScript(text);
    this.lines = parts.map((t) => ({ text: t, buffer: null, ok: false }));
    this.idx = 0; this.currentLine = -1;
    if (!parts.length) { this.synthState = 'empty'; return false; }
    this.synthState = 'working';
    let okCount = 0;
    for (let i = 0; i < this.lines.length; i++) {
      const buf = await this._fetchLine(this.lines[i].text);
      this.lines[i].buffer = buf;
      this.lines[i].ok = !!buf;
      if (buf) okCount++;
      if (onProgress) onProgress(i + 1, this.lines.length);
    }
    if (okCount > 0) {
      this.synthState = 'ready';
      if (this.onStatus) this.onStatus({ level: 'ok', message: `${okCount}/${this.lines.length} lines voiced` });
      return true;
    }
    /* free TTS unreachable — fall back to the browser's own voice so the
       take is never blocked. lines with no buffer speak via speechSynthesis. */
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      this.lines.forEach((l) => { l.ok = true; });
      this.synthState = 'fallback';
      if (this.onStatus) this.onStatus({ level: 'warn', message: 'web TTS offline — using built-in browser voice' });
      return true;
    }
    this.synthState = 'error';
    if (this.onStatus) this.onStatus({ level: 'error', message: 'TTS unreachable — check your connection' });
    return false;
  }

  /* rewind for a fresh take */
  arm() {
    this.stopPlayback();
    this.idx = 0;
    this.currentLine = -1;
    this._quietT = 1;      // first mouth movement fires line 1 instantly
    this._cooldown = 0;
  }

  /* pick the most "young US male" voice the browser itself offers */
  _pickSystemVoice() {
    if (this._sysVoice) return this._sysVoice;
    // getVoices() is async-populated in some browsers, so re-query until it fills
    const all = window.speechSynthesis.getVoices() || [];
    const en = all.filter((v) => /^en(-|_|$)/i.test(v.lang || ''));
    const pool = en.length ? en : all;
    const liked = pool.find((v) => /(justin|alex|daniel|google us english|male)/i.test(v.name));
    this._sysVoice = liked || pool[0] || null;
    return this._sysVoice;
  }

  /* FALLBACK LINE — the browser speaks it live. Audible in the room and to the
     performer; it is NOT inside the recorder's audio stream, which is why the
     panel says so out loud. */
  _speakLine(i) {
    const line = this.lines[i];
    const u = new window.SpeechSynthesisUtterance(line.text);
    const v = this._pickSystemVoice();
    if (v) u.voice = v;
    u.lang = (v && v.lang) || 'en-US';
    u.rate = 1.08; u.pitch = 1.18; u.volume = 1;
    this.playing = true;
    this.currentLine = i;
    this.idx = i + 1;
    this._utter = u;
    const done = () => {
      if (this._utter !== u) return;
      this._utter = null;
      this.playing = false;
      this.currentLine = -1;
      this._cooldown = 0.18;
      this._quietT = 0;
    };
    u.onend = done;
    u.onerror = done;
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (_) { done(); }
  }

  _playLine(i) {
    if (this.synthState === 'fallback') {
      if (i >= this.lines.length) { this.idx = this.lines.length; return; }
      this._speakLine(i);
      return;
    }
    if (i >= this.lines.length) { this.idx = this.lines.length; return; }
    // a single line the TTS refused still gets spoken — by the browser voice —
    // so the queue never silently swallows one of your beats
    if (!this.lines[i].buffer) {
      if (typeof window !== 'undefined' && window.speechSynthesis) { this._speakLine(i); return; }
      while (i < this.lines.length && !this.lines[i].buffer) i++;
      if (i >= this.lines.length) { this.idx = this.lines.length; return; }
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.lines[i].buffer;
    // a touch faster + brighter: the quick, wired Spidey cadence
    src.playbackRate.value = 1.05;
    src.connect(this.voiceIn);
    this.playing = true;
    this.currentLine = i;
    this.idx = i + 1;
    this._src = src;
    src.onended = () => {
      this.playing = false;
      this.currentLine = -1;
      this._src = null;
      this._cooldown = 0.18; // brief guard so one mouth move can't chain two lines
      this._quietT = 0;
    };
    try { src.start(); } catch (_) { this.playing = false; this.currentLine = -1; }
  }

  /* per-frame lip watcher. jaw comes from the face tracker (0..1). While
     recording, a mouth-open onset after a quiet gap fires the next line —
     the "it already knows the script" sync. */
  update(dt, jaw, recording) {
    if (!this.ready) return;
    // live output level for meters / music ducking
    this.analyser.getByteTimeDomainData(this._levelBuf);
    let s = 0;
    for (let i = 0; i < this._levelBuf.length; i += 4) { const v = (this._levelBuf[i] - 128) / 128; s += v * v; }
    const rms = Math.min(1, Math.sqrt(s / (this._levelBuf.length / 4)) * 3);
    this.level = { rms, gateOpen: this.playing };

    if (!recording) { this._quietT = 1; return; }
    if (this.playing) return;
    if (this._cooldown > 0) { this._cooldown = Math.max(0, this._cooldown - dt); return; }
    if (this.idx >= this.lines.length) return;
    if (jaw < 0.09) { this._quietT += dt; return; }
    // lips just started moving after a quiet gap — fire NOW, zero added latency
    if (this._quietT > 0.10) {
      this._quietT = 0;
      this._playLine(this.idx);
    }
  }

  stopPlayback() {
    if (this._src) { try { this._src.onended = null; this._src.stop(); } catch (_) {} }
    this._src = null;
    if (this._utter) {
      this._utter.onend = null; this._utter.onerror = null; this._utter = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
    }
    this.playing = false;
    this.currentLine = -1;
  }

  outputLevel() {
    return this.ready ? this.level.rms : 0;
  }

  get stream() { return this.ready ? this.dest.stream : null; }

  /* VoiceEngine-surface compatibility (FX map + panels call these) */
  triggerGlitch() {}
  setParam() {}
  setPreset() {}
  setMonitor(on) {
    if (this.ready) { try { this.monitorGain.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.02); } catch (_) {} }
  }

  async resume() { if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume(); }

  dispose() {
    this.stopPlayback();
    try { if (this.ctx) this.ctx.close(); } catch (_) {}
    this.ready = false;
  }
}
