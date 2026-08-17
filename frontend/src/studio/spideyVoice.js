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

/* THE ONE VOICE — every line is synthesized by our own relay, which locks a
   single Edge neural voice (Andrew, prosody-tuned to "young hero") on the
   server. The client cannot pick a voice; consistency IS the identity.
   Two doors to the same voice, tried in order:
   1. `/tts` on the dev server — the craco relay, same-origin, zero config
   2. `${REACT_APP_BACKEND_URL}/api/tts` — the FastAPI relay in production */
const TTS_ENDPOINTS = [
  '/tts',
  ...(process.env.REACT_APP_BACKEND_URL
    ? [`${process.env.REACT_APP_BACKEND_URL}/api/tts`]
    : []),
];

/* split a script into speakable lines: hard breaks first, then sentences */
export function splitScript(text) {
  return splitScriptRows(text).map((r) => r.text);
}

/* row-aware split: each spoken line remembers which pasted ROW it came from,
   so per-beat metadata (emote → pacing + prosody) survives sentence splitting */
export function splitScriptRows(text) {
  const out = [];
  String(text || '')
    .split(/\n+/)
    .forEach((row, rowIdx) => {
      row
        .split(/(?<=[.!?…])\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((s) => out.push({ text: s, row: rowIdx }));
    });
  return out;
}

/* BEAT-AWARE DELIVERY — emote (from the script's beat sheet) shapes BOTH the
   inter-line gap and the synthesis prosody, while the voice identity stays
   locked server-side. Quips snap; heavy turns breathe. */
const EMOTE_GAP = {
  neutral: 0.65, scan: 0.65, smirk: 0.5,
  anger: 0.5, glitch: 0.5, surge: 0.55, sad: 1.0,
};
const EMOTE_MOOD = {
  neutral: 'hero', scan: 'hero', smirk: 'hero',
  anger: 'urgent', glitch: 'urgent', surge: 'urgent', sad: 'somber',
};

/* ---- UPLOADED VOICE helpers: slice one performance file into per-line takes ---- */

function sliceBuffer(buf, ctx, s0, s1) {
  const len = s1 - s0;
  const out = ctx.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    out.copyToChannel(buf.getChannelData(ch).subarray(s0, s1), ch);
  }
  return out;
}

function mergeBuffers(bufs, ctx) {
  if (bufs.length === 1) return bufs[0];
  const sr = bufs[0].sampleRate;
  const gap = Math.floor(sr * 0.12);
  const len = bufs.reduce((s, b) => s + b.length, 0) + gap * (bufs.length - 1);
  const out = ctx.createBuffer(1, len, sr);
  const d = out.getChannelData(0);
  let at = 0;
  for (const b of bufs) { d.set(b.getChannelData(0), at); at += b.length + gap; }
  return out;
}

/** split a decoded performance on silence gaps (>= minGap s) into line takes */
function splitOnSilence(buf, ctx, { minGap = 0.35, minSeg = 0.25 } = {}) {
  const data = buf.getChannelData(0);
  const sr = buf.sampleRate;
  const win = Math.floor(sr * 0.02); // 20 ms RMS windows
  const env = [];
  for (let i = 0; i < data.length; i += win) {
    let s = 0;
    const end = Math.min(data.length, i + win);
    for (let j = i; j < end; j++) s += data[j] * data[j];
    env.push(Math.sqrt(s / Math.max(1, end - i)));
  }
  const peak = env.reduce((m, v) => Math.max(m, v), 0);
  const thr = Math.max(0.005, peak * 0.05); // adaptive floor: survives quiet exports
  const gapWins = Math.ceil(minGap / 0.02);
  const spans = [];
  let start = -1, quiet = 0;
  for (let i = 0; i <= env.length; i++) {
    const loud = i < env.length && env[i] > thr;
    if (loud) { if (start < 0) start = i; quiet = 0; continue; }
    if (start < 0) continue;
    quiet += 1;
    if (quiet >= gapWins || i >= env.length) {
      const s0 = Math.max(0, (start - 3) * win);                       // keep the attack
      /* +10 windows (~200ms) of tail, up from ~80ms: soft trailing consonants
         ("...s", "...t", "...ing") sit BELOW the adaptive threshold, so the
         old tight tail physically chopped the end of words off every slice —
         which is exactly "it cut out my last voices". */
      const s1 = Math.min(data.length, (i - quiet + 1 + 10) * win);    // keep the tail
      if ((s1 - s0) / sr >= minSeg) spans.push([s0, s1]);
      start = -1; quiet = 0;
    }
  }
  /* THE LAST WORDS GUARANTEE — the final span has nothing after it, so there
     is zero cost to keeping extra tail. Soft closers ("...right?", trailing
     "s"/"ng" sounds, a breath into silence) sit below the adaptive threshold
     and were physically clipped by the shared 200ms tail — which is exactly
     "my voice gets cut out at the end". Extend the LAST slice by up to 450ms
     of whatever audio actually remains in the file. */
  if (spans.length) {
    const last = spans[spans.length - 1];
    last[1] = Math.min(data.length, last[1] + Math.floor(sr * 0.45));
  }
  return spans.map(([s0, s1]) => sliceBuffer(buf, ctx, s0, s1));
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
    this.synthState = 'empty'; // empty | working | ready | fallback | error
    this._quietT = 1;          // seconds of closed mouth accumulated
    this._cooldown = 0;
    /* DIRECTOR PACING — lips still fire a line INSTANTLY, but the director
       never lets dead air onto the tape: if the mouth hesitates, the next
       line auto-fires. First line lands within FIRST_LINE_MAX of the roll. */
    this.autoPace = true;
    this._sinceEnd = 0;        // seconds since the last line finished (rec only)
    this._src = null;
    this._utter = null;        // live speechSynthesis utterance (fallback mode)
    this.mood = 'hero';        // named delivery; prosody numbers live server-side only
    this.lineEmotes = null;    // per-ROW emotes from the picked transmission (or null)
    /* WALL-CLOCK TRUTH for the auto-cut: the exact performance.now() the final
       audio actually ended. The old cutter counted poll ticks (interval
       throttling made the counter run FASTER than reality under recording
       load), which cut the file before the outro had physically elapsed. */
    this.lastEndedAt = 0;
    /* wall-clock instant the CURRENT line's audio started — the caption layer
       reads it to back-date its karaoke clock, so caption pacing is anchored
       to when the audio physically began, not to when a poll noticed it. */
    this.lineStartedAt = 0;
  }

  /* measure the REAL speech inside a buffer: slices carry padded silence at
     head and tail (breath room + the last-words guarantee). Pacing captions
     across the raw buffer duration made the highlight run SLOWER than the
     voice — a drift that grows through every line. leadIn = silence before
     the first voiced sample; speechDur = first->last voiced sample. */
  _analyzeBuffer(buf) {
    try {
      const data = buf.getChannelData(0);
      const sr = buf.sampleRate;
      const th = 0.015;
      let first = -1;
      let last = -1;
      for (let i = 0; i < data.length; i += 16) { if (Math.abs(data[i]) > th) { first = i; break; } }
      for (let i = data.length - 1; i >= 0; i -= 16) { if (Math.abs(data[i]) > th) { last = i; break; } }
      if (first < 0 || last <= first) return { leadIn: 0, speechDur: buf.duration };
      return { leadIn: first / sr, speechDur: (last - first) / sr };
    } catch (_) {
      return { leadIn: 0, speechDur: buf.duration };
    }
  }

  /* per-row emotes for the currently loaded script — pacing + prosody hints.
     null clears them (e.g. the user hand-edited the script text). */
  setLineEmotes(emotes) {
    this.lineEmotes = Array.isArray(emotes) && emotes.length ? emotes : null;
  }

  /* emote for a given line index, resolved through its source row */
  _emoteFor(i) {
    const l = this.lines[i];
    if (!l || !this.lineEmotes) return null;
    const row = l.row != null ? l.row : i;
    return this.lineEmotes[row] || null;
  }

  /** real seconds since the final line's audio ended (Infinity if not done) */
  secondsSinceDone() {
    if (!this.done || !this.lastEndedAt) return this.done ? 0 : Infinity;
    return (performance.now() - this.lastEndedAt) / 1000;
  }

  /** audio still physically draining through the chain after the last sample:
      context output latency + the compressor/limiter release tail */
  tailSeconds() {
    let lat = 0;
    try { lat = (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0); } catch (_) {}
    return Math.min(0.6, lat) + 0.3;
  }

  /* pick the locked delivery for the NEXT synthesis — 'mystery' | 'hero' |
     'urgent' | 'somber'. The server ignores unknown names. */
  setMood(mood) {
    this.mood = String(mood || 'hero');
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
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 105; hp.Q.value = 0.72;
      // Earbud repair: remove rumble and hollow room tone, then restore a warm,
      // close-mic sound while keeping speech easy to understand on phone speakers.
      const body = ctx.createBiquadFilter(); body.type = 'lowshelf'; body.frequency.value = 180; body.gain.value = 2;
      const mudCut = ctx.createBiquadFilter(); mudCut.type = 'peaking'; mudCut.frequency.value = 320; mudCut.Q.value = 1.15; mudCut.gain.value = -3.5;
      const nasalCut = ctx.createBiquadFilter(); nasalCut.type = 'peaking'; nasalCut.frequency.value = 900; nasalCut.Q.value = 1.3; nasalCut.gain.value = -1.5;
      const presence = ctx.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 2600; presence.Q.value = 0.85; presence.gain.value = 3.5;
      const clarity = ctx.createBiquadFilter(); clarity.type = 'highshelf'; clarity.frequency.value = 4500; clarity.gain.value = 1.5;
      // A broad high-band cut safely softens sharp earbud S sounds.
      const deEss = ctx.createBiquadFilter(); deEss.type = 'peaking'; deEss.frequency.value = 6800; deEss.Q.value = 2.2; deEss.gain.value = -3.5;
      const hissCut = ctx.createBiquadFilter(); hissCut.type = 'lowpass'; hissCut.frequency.value = 12000; hissCut.Q.value = 0.5;
      const leveller = ctx.createDynamicsCompressor();
      leveller.threshold.value = -32; leveller.knee.value = 16; leveller.ratio.value = 2.2; leveller.attack.value = 0.025; leveller.release.value = 0.28;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.knee.value = 10; comp.ratio.value = 3.2; comp.attack.value = 0.006; comp.release.value = 0.14;
      const makeup = ctx.createGain(); makeup.gain.value = 1.55;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -1.5; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.0005; limiter.release.value = 0.06;

      this.outGain = ctx.createGain(); this.outGain.gain.value = 1;
      this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 1024;
      this.dest = ctx.createMediaStreamDestination();
      this.monitorGain = ctx.createGain(); this.monitorGain.gain.value = 0;

      this.voiceIn.connect(hp); hp.connect(body); body.connect(mudCut); mudCut.connect(nasalCut);
      nasalCut.connect(presence); presence.connect(clarity); clarity.connect(deEss);
      deEss.connect(hissCut); hissCut.connect(leveller); leveller.connect(comp);
      comp.connect(makeup); makeup.connect(limiter); limiter.connect(this.outGain);
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

  /* fetch one line as an AudioBuffer, walking the relay endpoints on failure.
     Same locked voice behind every door — only the transport differs. Every
     request is hard-capped so a dead network can never hang the sheet. */
  async _fetchLine(text, mood) {
    const useMood = mood || this.mood;
    for (const endpoint of TTS_ENDPOINTS) {
      const ctrl = new AbortController();
      const kill = setTimeout(() => ctrl.abort(), 20000);
      try {
        const url = `${endpoint}?text=${encodeURIComponent(text)}&mood=${encodeURIComponent(useMood)}`;
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(kill);
        if (!res.ok) continue;
        const arr = await res.arrayBuffer();
        if (!arr || arr.byteLength < 200) continue;
        return await this.ctx.decodeAudioData(arr.slice(0));
      } catch (_) { clearTimeout(kill); /* next endpoint */ }
    }
    return null;
  }

  /* pre-generate the whole script. onProgress(done, total). Resolves to
     true when at least one line synthesized. */
  async synthesize(text, onProgress) {
    if (!this.ready) return false;
    this.stopPlayback();
    const parts = splitScriptRows(text);
    this.lines = parts.map((p) => ({ text: p.text, row: p.row, buffer: null, ok: false }));
    this.idx = 0; this.currentLine = -1;
    if (!parts.length) { this.synthState = 'empty'; return false; }
    this.synthState = 'working';
    let okCount = 0;
    for (let i = 0; i < this.lines.length; i++) {
      /* PROSODY PER BEAT — the beat's emote picks a locked server-side mood
         (same voice, different rate/pitch), so emotion is baked into the audio */
      const emote = this._emoteFor(i);
      const mood = (emote && EMOTE_MOOD[emote]) || this.mood;
      const buf = await this._fetchLine(this.lines[i].text, mood);
      this.lines[i].buffer = buf;
      this.lines[i].ok = !!buf;
      if (buf) {
        const a = this._analyzeBuffer(buf);
        this.lines[i].leadIn = a.leadIn;
        this.lines[i].speechDur = a.speechDur;
      }
      if (buf) okCount++;
      if (onProgress) onProgress(i + 1, this.lines.length);
    }
    if (okCount > 0) {
      this.synthState = 'ready';
      if (this.onStatus) this.onStatus({ level: 'ok', message: `${okCount}/${this.lines.length} lines voiced` });
      return true;
    }
    /* free TTS unreachable — fall back to the browser's own voice so the
       take is never blocked. lines with no buffer speak via speechSynthesis.
       We only claim the fallback once a real installed voice answers: the API
       exists on browsers that ship zero voices, and trusting it there would
       unlock REC and hand back a silent take. */
    if (await this._hasSystemVoice()) {
      this.lines.forEach((l) => { l.ok = true; });
      this.synthState = 'fallback';
      if (this.onStatus) this.onStatus({ level: 'warn', message: 'web TTS offline — using built-in browser voice' });
      return true;
    }
    this.synthState = 'error';
    if (this.onStatus) this.onStatus({ level: 'error', message: 'TTS unreachable — check your connection' });
    return false;
  }

  /* UPLOADED VOICE — Tier 1 of the engagement plan: swap system TTS for a REAL
     performance (ElevenLabs export or your own recorded read). One audio file
     for the whole script, a clear pause (>= ~0.4s) between lines; the engine
     slices it on silence and maps slice -> line in order. Everything
     downstream — lip watcher, auto jump-cuts, karaoke captions — is unchanged,
     because each line simply gets a better buffer. */
  async loadUpload(arrayBuffer, scriptText) {
    if (!this.ready) return { ok: false, message: 'audio engine offline' };
    if (scriptText != null && String(scriptText).trim()) {
      const parts = splitScriptRows(scriptText);
      if (parts.length) {
        this.lines = parts.map((p) => ({ text: p.text, row: p.row, buffer: null, ok: false }));
        this.idx = 0; this.currentLine = -1;
      }
    }
    if (!this.lines.length) return { ok: false, message: 'paste or pick a script first' };
    let buf;
    try { buf = await this.ctx.decodeAudioData(arrayBuffer.slice(0)); }
    catch (_) { return { ok: false, message: 'could not decode that file — use mp3 / wav / m4a' }; }
    let segs = splitOnSilence(buf, this.ctx);
    if (!segs.length) return { ok: false, message: 'no speech found in that file' };
    const n = this.lines.length;
    /* ADAPTIVE SLICING — a natural read almost always runs LONGER than the
       script planned: mid-sentence breaths open gaps wider than 0.35s, so one
       spoken line shatters into several slices. Every later line then shifts
       one slot earlier and the real ending gets crammed into the final slot.
       When slices outnumber lines, re-slice with progressively wider gap
       requirements and keep the count that lands closest to the line count —
       your pauses set the pace, not a pre-decided timing. */
    if (segs.length > n) {
      for (const gap of [0.5, 0.7, 0.95]) {
        const retry = splitOnSilence(buf, this.ctx, { minGap: gap });
        if (retry.length >= n && retry.length < segs.length) segs = retry;
        if (segs.length <= n) break;
      }
    }
    // extra slices fold into the final line; fewer slices leave the rest on TTS
    const mapped = segs.length > n
      ? [...segs.slice(0, n - 1), mergeBuffers(segs.slice(n - 1), this.ctx)]
      : segs;
    this.stopPlayback();
    this.idx = 0; this.currentLine = -1;
    mapped.forEach((s, i) => {
      if (i < n) {
        this.lines[i].buffer = s;
        this.lines[i].ok = true;
        // your recorded read carries breaths + the padded tail inside each
        // slice — measure the real speech so captions pace against IT
        const a = this._analyzeBuffer(s);
        this.lines[i].leadIn = a.leadIn;
        this.lines[i].speechDur = a.speechDur;
      }
    });
    // lines the upload didn't cover stay speakable via TTS/fallback if they were
    this.synthState = 'ready';
    this.uploaded = true;
    const covered = Math.min(mapped.length, n);
    const message = covered === n
      ? `real voice loaded: ${n}/${n} lines`
      : `real voice on ${covered}/${n} lines — the rest keep synthesized audio`;
    if (this.onStatus) this.onStatus({ level: covered === n ? 'ok' : 'warn', message });
    return { ok: true, message, covered, total: n };
  }

  /** seconds the given line will speak for — drives the karaoke caption pacing */
  lineDuration(i) {
    const l = this.lines[i];
    if (l && l.buffer) return l.buffer.duration;
    const words = l ? l.text.split(/\s+/).filter(Boolean).length : 6;
    return Math.max(1, words * 0.36); // fallback estimate for browser-voice lines
  }

  /** REAL speech timing for a line — the caption layer paces against THIS.
      leadIn: silence inside the buffer before the first voiced sample (the
      caption must not appear until it elapses). speechDur: first->last voiced
      sample — pacing words across the raw buffer duration (breath room + the
      padded last-words tail included) made the highlight run slower than the
      voice, a drift that compounds line after line. */
  lineTiming(i) {
    const l = this.lines[i];
    if (l && l.buffer) {
      const speechDur = (l.speechDur != null && l.speechDur > 0.05) ? l.speechDur : l.buffer.duration;
      return { leadIn: Math.max(0, l.leadIn || 0), speechDur };
    }
    const words = l ? l.text.split(/\s+/).filter(Boolean).length : 6;
    return { leadIn: 0, speechDur: Math.max(1, words * 0.36) };
  }

  /* rewind for a fresh take */
  arm() {
    this.stopPlayback();
    this.idx = 0;
    this.currentLine = -1;
    this._quietT = 1;      // first mouth movement fires line 1 instantly
    this._cooldown = 0;
    this._sinceEnd = 0;    // director clock: line 1 auto-fires within FIRST_LINE_MAX
    this.lastEndedAt = 0;  // fresh take: the wall-clock end anchor resets
  }

  /** the whole script has been spoken and nothing is playing — the outro window */
  get done() {
    return this.lines.length > 0 && this.idx >= this.lines.length && !this.playing;
  }

  /* Does this browser actually have an installed voice we can speak with?
     getVoices() is populated asynchronously, so poll briefly before giving up. */
  async _hasSystemVoice() {
    if (typeof window === 'undefined' || !window.speechSynthesis) return false;
    for (let i = 0; i < 12; i++) {
      const list = window.speechSynthesis.getVoices() || [];
      if (list.length) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
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
      this._sinceEnd = 0;    // restart the director clock for the next line
      this.lastEndedAt = performance.now(); // wall-clock anchor for the auto-cut
    };
    u.onend = done;
    u.onerror = done;
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      this.lineStartedAt = performance.now(); // caption layer back-dates to THIS
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
      if (this._pickSystemVoice()) { this._speakLine(i); return; }
      while (i < this.lines.length && !this.lines[i].buffer) i++;
      if (i >= this.lines.length) { this.idx = this.lines.length; return; }
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.lines[i].buffer;
    // prosody (the quick, wired Spidey cadence) is baked into the audio by the
    // relay (+14% rate, +18Hz on the young Brian voice) — play at 1.0 so it
    // never stacks into chipmunk
    src.playbackRate.value = 1.0;
    src.connect(this.voiceIn);
    this.playing = true;
    this.currentLine = i;
    this.idx = i + 1;
    this._src = src;
    const line = this.lines[i];
    src.onended = () => {
      this.playing = false;
      this.currentLine = -1;
      this._src = null;
      this._cooldown = 0.18; // brief guard so one mouth move can't chain two lines
      this._quietT = 0;
      this._sinceEnd = 0;    // restart the director clock for the next line
      /* wall-clock anchor for the auto-cut — back-dated past the buffer's
         PADDED TAIL (breath room + the last-words guarantee, up to ~650ms of
         pure silence). Counting the outro from the raw buffer end made every
         take run visibly longer than the voice. */
      let trail = 0;
      if (line && line.buffer && line.speechDur != null && line.speechDur > 0.05) {
        trail = Math.max(0, line.buffer.duration - (line.leadIn || 0) - line.speechDur);
      }
      this.lastEndedAt = performance.now() - trail * 1000;
    };
    try {
      src.start();
      this.lineStartedAt = performance.now(); // caption layer back-dates to THIS
    } catch (_) { this.playing = false; this.currentLine = -1; }
  }

  /** the pacing window before line i auto-fires: emote-shaped, deterministic */
  _gapFor(i) {
    if (i === 0) return 0.45; // cold open: never let the take breathe before line 1
    const emote = this._emoteFor(i);
    let gap = (emote && EMOTE_GAP[emote] != null) ? EMOTE_GAP[emote] : 0.65;
    // punchline micro-pause: a "?" or "!" ending gets a beat before the follow-up
    const prev = this.lines[i - 1];
    if (prev && /[?!]…?$/.test(prev.text.trim())) gap += 0.15;
    return gap;
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

    if (!recording) { this._quietT = 1; this._sinceEnd = 0; return; }
    if (this.playing) return;
    this._sinceEnd += dt;
    if (this._cooldown > 0) { this._cooldown = Math.max(0, this._cooldown - dt); return; }
    if (this.idx >= this.lines.length) return;
    /* DIRECTOR PACING — dead air never reaches the tape. The performer's lips
       are still the fastest trigger, but past the pacing window the next line
       fires itself. The gap is BEAT-AWARE: the cold open lands in 0.45s, quips
       and escalations snap tight, somber turns get a real breath — and a line
       that ended on "?" or "!" holds an extra 150ms so the punchline lands. */
    if (this.autoPace && this._sinceEnd >= this._gapFor(this.idx)) {
      this._quietT = 0;
      this._playLine(this.idx);
      return;
    }
    // 0.06: catch the very FIRST millimeter of lip movement — the old 0.09
    // threshold let the mouth visibly open a beat before the audio landed
    if (jaw < 0.06) { this._quietT += dt; return; }
    // lips just started moving after a quiet gap — fire NOW, zero added latency
    if (this._quietT > 0.07) {
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

  /* seconds of closed-mouth silence accumulated since the last line ended
     (0 while a line plays or during the post-line cooldown). The auto
     jump-cut reads this to decide when dead air has started. */
  get gapSeconds() { return this.playing ? 0 : this._quietT; }

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
