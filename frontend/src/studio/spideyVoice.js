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

/* SAVE-TIME ENHANCEMENT stage 1: peak-normalize the whole performance before
   slicing. Quiet phone/earbud recordings otherwise hit the broadcast chain far
   below its designed operating level — the compressors barely engage and the
   take ships thin and inconsistent. DC offset is removed in the same pass. */
function normalizeBuffer(buf) {
  try {
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      let mean = 0;
      for (let i = 0; i < d.length; i++) mean += d[i];
      mean /= Math.max(1, d.length);
      let peak = 0;
      for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i] - mean); if (v > peak) peak = v; }
      if (peak < 0.0005) continue; // silence — nothing to normalize
      const g = 0.891 / peak;      // ~-1 dBFS target
      if (Math.abs(mean) > 1e-4 || g < 0.99 || g > 1.01) {
        for (let i = 0; i < d.length; i++) d[i] = (d[i] - mean) * g;
      }
    }
  } catch (_) { /* normalization is an enhancement, never a blocker */ }
  return buf;
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
    this._openT = 0;           // seconds the mouth has been continuously open (line-idle only)
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
  /* Matching anchors for the CURRENT line. lineStartedAt is the fallback for
     browser speech; lineStartedCtx is authoritative for buffered audio because
     it shares the recorder's AudioContext timeline. */
  this.lineStartedAt = 0;
  this.lineStartedCtx = 0;
    /* ---- LIVE MIC MODE ----
       Your REAL voice, live, during the camera take: mic -> repair EQ ->
       the same broadcast chain (presence, de-ess, two-stage compression,
       limiter) -> straight into the recorder. Lines are fired by your VOICE
       (mic energy), never by lip tracking — so the caption can only ever
       follow what you are actually saying. */
    this.micMode = false;
    this.micStream = null;
    this._micNodes = null;
    this._noiseFloor = 0.01;   // adaptive room-noise estimate (VAD floor)
    this._voicedT = 0;         // seconds of continuous voice (onset detector)
    this._silT = 0;            // seconds of continuous silence inside a line
    this._lineDurT = 0;        // seconds of real voice inside the current line
    this._spw = 0.36;          // YOUR measured seconds-per-word (adapts every line)
    this._lastLiveElapsed = 0; // monotonic guard for the live caption clock
    /* live speech recognition: counts the words you have ACTUALLY spoken so
       the karaoke highlight rides your real words, not a timing estimate */
    this._recog = null;
    this._recogOn = false;
    this._recogWords = 0;
    /* words confirmed by PREVIOUS recognizer sessions: Chrome silently kills a
       continuous session (~60s / network hiccup) and onend restarts it with an
       EMPTY results list. Without this base the fresh session counted from 0
       while the monotonic guard held the old total — the caption froze until
       you out-spoke the whole take so far ("I say a line fast and it can't
       catch"). Every restart folds the confirmed total into this base. */
    this._wordsBase = 0;
    this._wordsAtLineStart = 0;
    /* recognizer word count at the moment the PREVIOUS line ended — any words
       past this while idle belong to the NEXT line, and their arrival fires it
       (the recognition half of the dual trigger) */
    this._wordsAtIdle = 0;
    this._recogStartedForTake = false;
  }

  /** seconds of the CURRENT line present on the recorder's AudioContext
      timeline. The recording consumes MediaStreamDestination directly, BEFORE
      the speaker output path, so baseLatency/outputLatency must NOT be subtracted
      here — those values describe speaker monitoring, not the exported track.
      null when no buffered line is playing; captions then freewheel their tail. */
  lineElapsed() {
    /* LIVE MIC: the caption clock is your ACTUAL SPEECH. Primary source is the
       live recognizer's word count (the highlight can never run ahead of words
       you haven't said, nor lag words you have); when recognition is silent or
       unsupported it falls back to real elapsed time at YOUR measured pace. */
    if (this.micMode) {
      if (!this.playing || !this.lineStartedCtx) return null;
      let t = 0;
      try { t = this.ctx.currentTime - this.lineStartedCtx; } catch (_) { return null; }
      if (t < 0) return null;
      const l = this.lines[this.currentLine];
      if (l) {
        const total = l.text.split(/\s+/).filter(Boolean).length || 1;
        const est = Math.max(0.5, total * this._spw);
        const heard = Math.max(0, this._recogWords - this._wordsAtLineStart);
        if (this._recogOn && heard > 0) {
          /* the highlight may run at most ~1.5 words ahead of what the
             recognizer confirmed, and never behind what it confirmed */
          const cap = Math.min(1, (heard + 1.5) / total) * est;
          const floor = Math.min(1, heard / total) * est * 0.96;
          t = Math.max(Math.min(t, cap), floor);
        }
      }
      // monotonic: a late recognition result must never rewind the karaoke
      t = Math.max(t, this._lastLiveElapsed);
      this._lastLiveElapsed = t;
      return t;
    }
    if (!this.playing || !this._src || !this.lineStartedCtx) return null;
    let t = 0;
    try { t = this.ctx.currentTime - this.lineStartedCtx; } catch (_) { return null; }
    return t >= 0 ? t : null;
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
      /* ADAPTIVE threshold — the old fixed 0.015 floor was deaf to soft line
         endings (trailing "s"/"ng", a quiet "...right?"), so speechDur ended
         EARLY: the karaoke finished + cleared while the voice was still on its
         final words — exactly "some words cut out at last". Scale the floor to
         the buffer's own peak so quiet tails are counted as speech. */
      let peak = 0;
      for (let i = 0; i < data.length; i += 8) { const v = Math.abs(data[i]); if (v > peak) peak = v; }
      const th = Math.max(0.004, peak * 0.04);
      let first = -1;
      let last = -1;
      for (let i = 0; i < data.length; i += 8) { if (Math.abs(data[i]) > th) { first = i; break; } }
      for (let i = data.length - 1; i >= 0; i -= 8) { if (Math.abs(data[i]) > th) { last = i; break; } }
      if (first < 0 || last <= first) return { leadIn: 0, speechDur: buf.duration };
      /* keep up to 120ms of real die-off after the last sample above threshold:
         the quietest tail of a final consonant sits below ANY floor */
      const end = Math.min(data.length, last + Math.floor(sr * 0.12));
      return { leadIn: first / sr, speechDur: (end - first) / sr };
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

  /** conservative recorder-side release after the final source sample. Speaker
      output latency is intentionally excluded: MediaStreamDestination receives
      the mix before the hardware output path. */
  tailSeconds() {
    return 0.3;
  }

  /* pick the locked delivery for the NEXT synthesis — 'mystery' | 'hero' |
     'urgent' | 'somber'. The server ignores unknown names. */
  setMood(mood) {
    this.mood = String(mood || 'hero');
  }

  /* the take may roll once every line is voiced — either as decoded buffers or
     via the browser's own speech engine when the free TTS is unreachable */
  canRoll() {
    return this.synthState === 'ready' || this.synthState === 'fallback'
      || (this.synthState === 'live' && this.micMode);
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
      /* kept as refs: LIVE MIC takes run the final stage hotter (makeup 2.0,
         limiter -1.0 dB) and restore these exact values when the mic drops —
         the TTS/upload paths must never hear the mic-take loudness. */
      this._makeup = makeup;
      this._limiter = limiter;

    this.outGain = ctx.createGain(); this.outGain.gain.value = 1;
    /* 256 samples is ~5ms at 48kHz. The old 1024-sample (~21ms) analysis
       window blurred consonant onsets before two more visual smoothing stages,
       making the mask trail syllables by several frames. */
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0;
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
    this.disableLiveMic(); // TTS take: the live mic must not bleed into the mix
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
    this.disableLiveMic(); // sliced-take mode replaces the live mic path
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
    /* SAVE-TIME ENHANCEMENT: normalize + de-DC the recording first so the
       slicer's adaptive thresholds and the playback broadcast chain (presence,
       de-ess, two-stage compression, limiter) all operate at design level */
    buf = normalizeBuffer(buf);
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
    /* live-mic lines have no buffer: pace at YOUR measured seconds-per-word
       (updated after every spoken line), not a fixed guess */
    return { leadIn: 0, speechDur: Math.max(0.5, words * this._spw) };
  }

  /* rewind for a fresh take */
  arm() {
    this.stopPlayback();
    this.idx = 0;
    this.currentLine = -1;
    this._quietT = 1;      // first mouth movement fires line 1 instantly
    this._openT = 0;
    this._cooldown = 0;
    this._sinceEnd = 0;    // director clock: line 1 auto-fires within FIRST_LINE_MAX
    this.lastEndedAt = 0;  // fresh take: the wall-clock end anchor resets
    this.lineStartedAt = 0;
    this.lineStartedCtx = 0; // and the audio-clock caption anchor
    // live-mic take: fresh VAD + recognition anchors for line 1
    this._voicedT = 0;
    this._silT = 0;
    this._lineDurT = 0;
    this._lastLiveElapsed = 0;
    this._recogWords = 0;
    this._wordsBase = 0;
    this._wordsAtLineStart = 0;
    this._wordsAtIdle = 0;
    /* FULL RECOGNITION RESET — an aborted/restarted take used to leave
       _recogStartedForTake latched true, so the recognizer never re-armed on
       the next roll and the karaoke fell back to pure time estimates. Kill any
       stale session too: _updateLiveMic starts a fresh one on the new take. */
    this._recogStartedForTake = false;
    if (this._recogOn || this._recog) this._stopRecognition();
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
      /* BOTH clocks are stamped at the same instant: lineStartedAt for anything
         wall-clock, lineStartedCtx as the authoritative audio-clock anchor the
         karaoke re-syncs against every frame. */
      this.lineStartedAt = performance.now();
      this.lineStartedCtx = this.ctx.currentTime;
    } catch (_) { this.playing = false; this.currentLine = -1; this.lineStartedCtx = 0; }
  }

  /** SAFETY NET ONLY — the window before line i auto-fires when the tracker
      has clearly lost the mouth. The old emote-paced 0.45–1.0s windows fired
      lines BEFORE the performer's lips moved, which is exactly "it displays
      words before I'm speaking" and "captions don't match my pace": a slow
      reader was constantly overtaken by the director. YOUR MOUTH is now the
      only clock; auto-fire exists purely to rescue a take from a dead tracker. */
  _gapFor(i) {
    return i === 0 ? 2.5 : 4.0;
  }

  /* per-frame lip watcher. jaw comes from the face tracker (0..1). While
     recording, a mouth-open onset after a quiet gap fires the next line —
     the "it already knows the script" sync. */
  update(dt, jaw, recording) {
    if (!this.ready) return;
    /* LIVE MIC MODE — your voice is the audio AND the clock; jaw is ignored */
    if (this.micMode) { this._updateLiveMic(dt, recording); return; }
    // live output level for meters / music ducking
    this.analyser.getByteTimeDomainData(this._levelBuf);
    let s = 0;
    for (let i = 0; i < this._levelBuf.length; i += 4) { const v = (this._levelBuf[i] - 128) / 128; s += v * v; }
    const rms = Math.min(1, Math.sqrt(s / (this._levelBuf.length / 4)) * 3);
    this.level = { rms, gateOpen: this.playing };

    if (!recording) { this._quietT = 1; this._sinceEnd = 0; this._openT = 0; return; }
    if (this.playing) { this._openT = 0; return; }
    this._sinceEnd += dt;
    if (this._cooldown > 0) { this._cooldown = Math.max(0, this._cooldown - dt); return; }
    if (this.idx >= this.lines.length) return;
    /* YOUR MOUTH IS THE CLOCK. Speak fast: the onset fires the line with zero
       added latency. Speak slow: the engine WAITS — nothing fires until your
       lips do. The tracker being imperfect is covered two ways:
       1. onset after a quiet gap (the classic trigger, 0.06 jaw / 70ms quiet);
       2. a CONTINUOUS reader who never fully closes their mouth between lines
          still fires once the mouth has been open 0.3s past the previous line
          — no more waiting on a closed-mouth gap that never comes. */
    const open = jaw >= 0.06;
    if (open) this._openT += dt; else { this._openT = 0; this._quietT += dt; }
    if (open && this._quietT > 0.07) {
      this._quietT = 0; this._openT = 0;
      this._playLine(this.idx);
      return;
    }
    if (open && this._openT > 0.3 && this._sinceEnd > 0.25) {
      this._quietT = 0; this._openT = 0;
      this._playLine(this.idx);
      return;
    }
    /* SAFETY NET, not a director: only when the mouth never registers at all
       (tracking lost, camera blocked) does the take rescue itself. */
    if (this.autoPace && this._sinceEnd >= this._gapFor(this.idx)) {
      this._quietT = 0; this._openT = 0;
      this._playLine(this.idx);
    }
  }

  /* ---- LIVE MIC MODE — record your real voice WITH the camera, live ----
     mic (browser noiseSuppression + echoCancellation + voiceIsolation)
       -> repair EQ (rumble cut, body shelf, boxiness cut, harshness cut, trim)
       -> the existing broadcast chain (presence, clarity, de-ess, two-stage
          compression, makeup, limiter)
       -> the recorder's MediaStreamDestination.
     Every stage of "extreme enhancement" runs in real time DURING the take. */
  async enableLiveMic(scriptText) {
    if (!this.ready) return { ok: false, message: 'audio engine offline' };
    const parts = splitScriptRows(scriptText || '');
    if (!parts.length) return { ok: false, message: 'paste or pick a script first' };
    const bindScript = () => {
      this.stopPlayback();
      this.lines = parts.map((p) => ({ text: p.text, row: p.row, buffer: null, ok: true }));
      this.idx = 0; this.currentLine = -1;
      this.synthState = 'live';
    };
    if (this.micMode && this.micStream) { bindScript(); return { ok: true, message: `live mic armed — ${parts.length} lines` }; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return { ok: false, message: 'this browser cannot capture a microphone' };
    }
    let stream;
    try {
      /* the OS-level cleanup does what no WebAudio graph can: noiseSuppression
         kills fans/room hiss at the source, echoCancellation stops speaker
         bleed, voiceIsolation (where supported) is a full ML voice extractor.
         AGC stays OFF — the chain's own leveller/comp owns the dynamics. */
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: false },
          voiceIsolation: { ideal: true },
          channelCount: { ideal: 1 },
          sampleRate: { ideal: 48000 },
        },
      });
    } catch (err) {
      const message = err && err.name === 'NotAllowedError'
        ? 'mic permission blocked — allow it in the browser, then try again'
        : `mic failed: ${err && err.message ? err.message : 'unknown error'}`;
      return { ok: false, message };
    }
    const ctx = this.ctx;
    this.micStream = stream;
    const src = ctx.createMediaStreamSource(stream);
    /* MIC PRE-STAGE — earbud/laptop capsules arrive QUIET, thin, boxy and
       noisy. Fix level and tone BEFORE the broadcast chain so the compressors
       downstream work with a voice, not a problem:
         boost (+6 dB) -> gate (downward expander) -> auto-leveler -> repair EQ
       The boost recovers the ~6-10 dB these capsules sit under; the gate mutes
       room hiss between phrases without clipping word onsets; the leveler
       (driven per-frame from the VAD analyser) rides your distance/energy
       swings +-9 dB so every take lands at the same loudness. */
    const boost = ctx.createGain(); boost.gain.value = 2.0; // +6 dB input recovery
    const gate = ctx.createGain(); gate.gain.value = 1;     // VAD-driven downward expander
    const leveler = ctx.createGain(); leveler.gain.value = 1; // slow AGC, +-9 dB
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 82; hp.Q.value = 0.71;
    const body = ctx.createBiquadFilter(); body.type = 'lowshelf'; body.frequency.value = 160; body.gain.value = 3;
    const box = ctx.createBiquadFilter(); box.type = 'peaking'; box.frequency.value = 300; box.Q.value = 1.1; box.gain.value = -2;
    const harsh = ctx.createBiquadFilter(); harsh.type = 'peaking'; harsh.frequency.value = 4200; harsh.Q.value = 1.4; harsh.gain.value = -2.5;
    /* STRONGER intelligibility for tiny capsules: presence peak +5 dB @2.8kHz
       and a +2.5 dB shelf from 3.4kHz — consonants cut through phone speakers */
    const presence = ctx.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 2800; presence.Q.value = 0.9; presence.gain.value = 5;
    const shelf = ctx.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 3400; shelf.gain.value = 2.5;
    const trim = ctx.createGain(); trim.gain.value = 1.9; // make-up into the chain (~+5.6 dB)
    src.connect(boost); boost.connect(gate); gate.connect(leveler);
    leveler.connect(hp); hp.connect(body); body.connect(box); box.connect(harsh);
    harsh.connect(presence); presence.connect(shelf); shelf.connect(trim);
    trim.connect(this.voiceIn); // -> presence/clarity/de-ess/leveller/comp/limiter -> recorder
    /* dedicated VAD analyser on the BOOSTED-but-ungated signal: the gate and
       the broadcast chain's compression would flatten (or chicken-and-egg) the
       on/off contrast the voice detector needs */
    this.micAnalyser = ctx.createAnalyser();
    this.micAnalyser.fftSize = 512;
    this.micAnalyser.smoothingTimeConstant = 0;
    boost.connect(this.micAnalyser);
    this._micBuf = new Uint8Array(this.micAnalyser.fftSize);
    this._micNodes = [src, boost, gate, leveler, hp, body, box, harsh, presence, shelf, trim];
    this._micGate = gate;
    this._micLeveler = leveler;
    this._agcRms = 0; // speech-RMS EMA driving the leveler
    /* HOTTER FINAL LOUDNESS on mic takes only: the synthesized voice is already
       normalized at the source; your real voice needs the extra push to land at
       the same perceived level phone-speaker-loud. Restored in disableLiveMic. */
    try {
      this._makeup.gain.setTargetAtTime(2.0, ctx.currentTime, 0.05);
      this._limiter.threshold.setTargetAtTime(-1.0, ctx.currentTime, 0.05);
    } catch (_) {}
    this.micMode = true;
    this.uploaded = false;
    this._noiseFloor = 0.01;
    this._spw = 0.36;
    bindScript();
    if (this.onStatus) this.onStatus({ level: 'ok', message: 'live mic + enhancer online' });
    return { ok: true, message: `live mic on — speak each line during the take (${parts.length} lines)` };
  }

  disableLiveMic() {
    this._stopRecognition();
    if (this.micStream) {
      try { this.micStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      this.micStream = null;
    }
    if (this._micNodes) {
      this._micNodes.forEach((n) => { try { n.disconnect(); } catch (_) {} });
      this._micNodes = null;
    }
    this._micGate = null;
    this._micLeveler = null;
    this.micAnalyser = null;
    /* restore the shared chain's stock loudness — TTS/upload takes must never
       inherit the hotter mic-take makeup/limiter settings */
    if (this.ready && this._makeup && this._limiter) {
      try {
        this._makeup.gain.setTargetAtTime(1.55, this.ctx.currentTime, 0.05);
        this._limiter.threshold.setTargetAtTime(-1.5, this.ctx.currentTime, 0.05);
      } catch (_) {}
    }
    if (this.micMode) {
      this.micMode = false;
      this.playing = false; this.currentLine = -1;
      // whatever buffers survive decide the state; otherwise back to empty
      this.synthState = this.lines.some((l) => l.buffer) ? 'ready' : 'empty';
    }
  }

  /* live word counter — webkitSpeechRecognition where available. It listens to
     the same mic in parallel and reports the words you have ACTUALLY said;
     the karaoke highlight is slaved to that count. Unsupported browsers fall
     back to the adaptive-pace clock automatically. */
  _startRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this._recogWords = 0;
    this._wordsAtLineStart = 0;
    if (!SR) { this._recogOn = false; return; }
    try {
      const r = new SR();
      r.continuous = true;
      r.interimResults = true;
      r.lang = 'en-US';
      r.onresult = (e) => {
        /* count FINAL segments fully, but only the LAST interim segment.
           Chrome regularly leaves a stale interim segment that duplicates
           words already present in a final one — counting every segment
           inflated the total, so the karaoke lapped ahead and the next-line
           trigger fired early: the same words got written twice. Slightly
           lagging an uncounted interim is invisible; overcounting is not. */
        let finals = 0;
        let interim = 0;
        for (let i = 0; i < e.results.length; i++) {
          const res = e.results[i];
          const alt = res && res[0];
          if (!alt || !alt.transcript) continue;
          const n = alt.transcript.trim().split(/\s+/).filter(Boolean).length;
          if (res.isFinal) finals += n;
          else interim = n; // later interims supersede earlier (stale) ones
        }
        const words = this._wordsBase + finals + interim;
        // monotonic: interim retractions must never rewind the caption
        if (words > this._recogWords) this._recogWords = words;
      };
      r.onerror = () => {};
      r.onend = () => {
        if (this._recogOn) {
          /* the restarted session counts from an EMPTY results list — fold
             everything confirmed so far into the base so the caption clock
             keeps advancing instead of freezing at the old total */
          this._wordsBase = this._recogWords;
          try { r.start(); } catch (_) { this._recogOn = false; }
        }
      };
      r.start();
      this._recog = r;
      this._recogOn = true;
    } catch (_) { this._recogOn = false; }
  }

  _stopRecognition() {
    this._recogOn = false;
    if (this._recog) {
      try { this._recog.onend = null; this._recog.stop(); } catch (_) {}
      this._recog = null;
    }
  }

  /** WORD-INDEX KARAOKE — the confirmed word of the CURRENT live-mic line, or
      null when recognition hasn't reported for it yet. The stage slaves the
      highlight to this exact index: no estimate, no lapping your real words. */
  recogWordIndex() {
    if (!this.micMode || !this._recogOn || this.currentLine < 0) return null;
    const l = this.lines[this.currentLine];
    if (!l) return null;
    const total = l.text.split(/\s+/).filter(Boolean).length || 1;
    const heard = this._recogWords - this._wordsAtLineStart;
    if (heard <= 0) return null;
    return Math.min(total - 1, heard - 1);
  }

  _startLiveLine() {
    const i = this.idx;
    this.playing = true;
    this.currentLine = i;
    this.idx = i + 1;
    this._quietT = 0;
    this._silT = 0;
    this._lineDurT = this._voicedT;
    this._lastLiveElapsed = 0;
    /* back-date both anchors by the onset detector's confirmation window, so
       the caption clock starts at the true first voiced instant */
    this.lineStartedAt = performance.now() - this._voicedT * 1000;
    this.lineStartedCtx = this.ctx.currentTime - this._voicedT;
    /* the line's word baseline is where the PREVIOUS line ended, not "now":
       when recognition itself fired this line, the words that fired it must
       count toward it — snapshotting _recogWords here would swallow them */
    this._wordsAtLineStart = Math.min(this._recogWords, this._wordsAtIdle);
    this._voicedT = 0;
  }

  _endLiveLine(sil) {
    const l = this.lines[this.currentLine];
    if (l) {
      /* learn YOUR pace: real voiced seconds / words in the line, folded into
         an EMA so the next line's caption paces at how you actually read */
      const words = l.text.split(/\s+/).filter(Boolean).length || 1;
      const spw = Math.max(0.3, this._lineDurT) / words;
      if (spw > 0.12 && spw < 1.2) this._spw = this._spw * 0.6 + spw * 0.4;
    }
    this.playing = false;
    this.currentLine = -1;
    this._cooldown = 0.15;
    this._quietT = 0.2;
    this._voicedT = 0;
    this._sinceEnd = 0;
    // words confirmed so far belong to the finished line; anything past this
    // count while idle is the NEXT line speaking — the recognition trigger
    this._wordsAtIdle = this._recogWords;
    // the line really ended when the silence STARTED, not when we confirmed it
    this.lastEndedAt = performance.now() - (sil || 0) * 1000;
  }

  _updateLiveMic(dt, recording) {
    // mic RMS from the repaired signal
    let rms = 0;
    if (this.micAnalyser) {
      this.micAnalyser.getByteTimeDomainData(this._micBuf);
      let s = 0;
      for (let i = 0; i < this._micBuf.length; i += 2) { const v = (this._micBuf[i] - 128) / 128; s += v * v; }
      rms = Math.min(1, Math.sqrt(s / (this._micBuf.length / 2)) * 4);
    }
    /* adaptive noise floor: drops fast toward silence, climbs very slowly, so
       speech can never teach the detector that talking is "background" */
    if (rms < this._noiseFloor) this._noiseFloor += (rms - this._noiseFloor) * Math.min(1, dt * 5);
    else this._noiseFloor += (rms - this._noiseFloor) * Math.min(1, dt * 0.04);
    this._noiseFloor = Math.min(this._noiseFloor, 0.25);
    /* lowered floor (0.015 / x2.6): browser noiseSuppression leaves a quiet
       earbud hovering under the old max(0.02, floor*3+0.012) — the onset never
       confirmed and NO caption ever fired. Recognition below is the backstop. */
    const voiced = rms > Math.max(0.015, this._noiseFloor * 2.6 + 0.009);
    this.level = { rms, gateOpen: voiced };

    // the recognizer rides the take: on when rolling, off when cut
    if (recording && !this._recogOn && !this._recogStartedForTake) {
      this._recogStartedForTake = true;
      this._startRecognition();
    }
    if (!recording && (this._recogOn || this._recogStartedForTake)) {
      this._recogStartedForTake = false;
      this._stopRecognition();
    }

    if (!recording) {
      if (this.playing) this._endLiveLine(0);
      this._quietT = 1; this._voicedT = 0; this._sinceEnd = 0;
      return;
    }
    this._sinceEnd += dt;
    if (this.playing) {
      if (voiced) { this._silT = 0; this._lineDurT += dt; }
      else {
        this._silT += dt;
        /* a clear pause (0.55s) closes the line — long enough that breaths and
           commas inside a sentence never split it, short enough that the next
           line arms before you resume. FAST DELIVERY: once the recognizer has
           confirmed every word of the line, only a token 0.18s pause is needed
           — a quick reader no longer waits out the full gap, so back-to-back
           lines can't pile up on one caption ("I say a line fast and it can't
           catch"). */
        const l = this.lines[this.currentLine];
        const total = l ? (l.text.split(/\s+/).filter(Boolean).length || 1) : 1;
        const heard = this._recogOn ? this._recogWords - this._wordsAtLineStart : 0;
        const closeAt = heard >= total ? 0.18 : 0.55;
        if (this._silT >= closeAt) this._endLiveLine(this._silT);
      }
      return;
    }
    if (this._cooldown > 0) {
      this._cooldown = Math.max(0, this._cooldown - dt);
      if (!voiced) this._quietT += dt;
      return;
    }
    if (this.idx >= this.lines.length) return;
    if (voiced) this._voicedT += dt; else { this._voicedT = 0; this._quietT += dt; }
    /* DUAL TRIGGER — whichever detector hears you first fires the line:
       1. VAD onset: ~70ms of sustained voice (back-dated anchors, zero lag);
       2. RECOGNITION: new words past the previous line's count. A too-quiet
          mic that never clears the VAD floor still fires the line the moment
          the recognizer confirms you are speaking — captions can no longer
          go missing on a soft capsule. */
    const recogHeard = this._recogOn && this._recogWords > this._wordsAtIdle;
    if (this._voicedT >= 0.07 || recogHeard) this._startLiveLine();
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
    this.disableLiveMic();
    this.stopPlayback();
    try { if (this.ctx) this.ctx.close(); } catch (_) {}
    this.ready = false;
  }
}
