/* One-key recorder: canvas capture + processed voice -> vertical upload-ready take.

   ADAPTIVE by design: 1080x1920@60 into a 20 Mbps encoder is the right call on a
   healthy GPU, and a guaranteed crash on a constrained one (software WebGL, few
   cores, headless). So before rolling, the recorder reads what the machine can
   actually do — the stage's measured render fps, whether GL is software-rendered,
   core count, whether a LIVE MIC graph is running — and picks a tier:

     high    30fps native 1080x1920, 12 Mbps — real headroom machines only
     medium  30fps 810x1440 mirror,   6 Mbps — most laptops on battery
     low     24fps 720x1280 mirror, 3.5 Mbps — software GL / low-core machines

   THE FREEZE-KILLER: realtime H.264/VP8 at native 1080x1920 (~2.1MP vertical)
   is beyond most machines' realtime budget — when the encoder saturates,
   Chromium silently stalls the VIDEO track mid-take (frozen picture, audio
   continues). Medium/low tiers now capture through a downscaled 2D mirror
   canvas, cutting encode pixel load 1.8-2.25x. Export stays vertical and
   upload-ready.

   Codec ladder is HARDWARE-FIRST: honest MP4 (H.264/AAC — near-zero CPU on most
   machines when hardware encode is present), then video/webm;codecs=h264, then
   VP9/Opus, then VP8, then plain WebM. Construction itself degrades too: full
   options -> mime only -> bare recorder, stepping down the ladder, so a picky
   encoder yields a softer file, never a dead take. */

const MP4_FIRST = [
  { mime: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4' }, // H.264 High + AAC-LC (hardware on most machines)
  { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' }, // H.264 Baseline fallback
  { mime: 'video/mp4', ext: 'mp4' },
  { mime: 'video/webm;codecs=h264,opus', ext: 'webm' },           // hardware H.264 in a WebM box
  { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
];

/* constrained machines: VP8 software encode costs a fraction of H.264 High at
   this resolution — an honest webm beats a crashed mp4 every time */
const WEBM_FIRST = [
  { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
  { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4', ext: 'mp4' },
];

/* Bitrates/fps are deliberately conservative: a realtime encoder that falls
   behind does not degrade gracefully — it silently stalls the video track
   mid-take (frozen picture, audio keeps going). Medium is trimmed to 6 Mbps
   (generous at 810x1440), low to 3.5 Mbps: the downscale mirror removed the
   pixel load that justified the old numbers. `scale` is the mirror factor
   handed to stage.captureStream — 1 keeps the native canvas. */
const TIERS = {
  high: { captureFps: 30, scale: 1, videoBps: 12_000_000, audioBps: 192_000, ladder: MP4_FIRST },
  medium: { captureFps: 30, scale: 0.75, videoBps: 6_000_000, audioBps: 160_000, ladder: MP4_FIRST },       // 810x1440
  low: { captureFps: 24, scale: 2 / 3, videoBps: 3_500_000, audioBps: 128_000, ladder: WEBM_FIRST },        // 720x1280
};

const TIER_ORDER = ['high', 'medium', 'low'];
function stepDown(name) {
  const i = TIER_ORDER.indexOf(name);
  return TIER_ORDER[Math.min(TIER_ORDER.length - 1, i + 1)];
}

/** true when WebGL is running on a CPU rasterizer (SwiftShader / llvmpipe / ANGLE
    software) — the single strongest predictor that a 60fps capture will melt */
function isSoftwareGL(renderer) {
  try {
    const gl = renderer && renderer.getContext && renderer.getContext();
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(
      ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    ).toLowerCase();
    return /swiftshader|llvmpipe|software|mesa offscreen|angle \(google\)/.test(name);
  } catch (_) {
    return false;
  }
}

/** capability read: measured stage fps wins; GL backend and core count break
    ties. MIC-AWARE: a live getUserMedia graph + a parallel speech-recognition
    session add real load on top of the encoder — a machine that survives TTS
    takes tips over on mic takes, so micLive steps the tier down one level. */
export function pickTier(stage, { micLive = false } = {}) {
  const measured = stage && typeof stage.fps === 'number' ? stage.fps : 0;
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const soft = isSoftwareGL(stage && stage.renderer);
  let tier;
  if (soft || cores <= 2 || (measured > 0 && measured < 28)) tier = 'low';
  // 'high' now needs REAL headroom (many cores AND a proven 55+ fps stage):
  // a machine that only just holds 50fps stalls the encoder once REC adds load
  else if (cores <= 6 || (measured > 0 && measured < 55)) tier = 'medium';
  else tier = 'high';
  if (micLive) tier = stepDown(tier);
  return tier;
}

function supported(mime) {
  try { return MediaRecorder.isTypeSupported(mime); } catch (_) { return false; }
}

/** walk the ladder x options grid until a recorder actually constructs */
function buildRecorder(stream, tier, ladderOverride) {
  const source = ladderOverride || tier.ladder;
  const ladder = source.filter((c) => supported(c.mime));
  if (!ladder.length) ladder.push(source[source.length - 1]);
  for (const codec of ladder) {
    const attempts = [
      { mimeType: codec.mime, videoBitsPerSecond: tier.videoBps, audioBitsPerSecond: tier.audioBps },
      { mimeType: codec.mime },
    ];
    for (const opts of attempts) {
      try { return { rec: new MediaRecorder(stream, opts), codec }; } catch (_) { /* next */ }
    }
  }
  // last resort: let the browser pick everything
  try {
    const rec = new MediaRecorder(stream);
    const mime = rec.mimeType || 'video/webm';
    return { rec, codec: { mime, ext: mime.includes('mp4') ? 'mp4' : 'webm' } };
  } catch (_) {
    return null;
  }
}

export class Recorder {
  constructor() {
    this.recording = false;
    this.startTs = 0;
    this.tier = null;        // 'high' | 'medium' | 'low' — set on every start
    this.stalled = false;    // encoder health flag — the HUD reads this
    this._canvasTracks = []; // canvas video tracks we own — stopped on stop()
    this._watchdog = 0;      // frame heartbeat + encoder health interval
    this._lastChunkAt = 0;   // last dataavailable arrival (encoder health)
    this._wakeLock = null;   // screen wake lock held for the take's duration
    /* warmup self-test results — persist across takes; a machine that failed
       the countdown probe once will fail it again */
    this._forcedTier = null;
    this._preferWebm = false;
  }

  /* pause/resume were removed on purpose: MediaRecorder.pause()/resume() on a
     canvas-capture video track muxed with a WebAudio track is unreliable in
     Chromium — after a resume the video track frequently never gets a fresh
     keyframe / correct timestamps, which ships a file whose picture FREEZES at
     the first cut while the audio keeps playing, offset by the accumulated
     pause time. Recording continuously keeps A/V perfectly in sync. */
  get paused() { return false; }

  /** wall time since the roll started — exactly how long the export will be */
  get elapsed() {
    if (!this.recording) return 0;
    return (performance.now() - this.startTs) / 1000;
  }

  /* screen sleep/dimming freezes rAF -> frozen video; hold a wake lock for the
     take. Best-effort: unsupported browsers simply skip it. */
  _acquireWakeLock() {
    try {
      if (navigator.wakeLock && navigator.wakeLock.request) {
        navigator.wakeLock.request('screen')
          .then((lock) => { this._wakeLock = lock; })
          .catch(() => { this._wakeLock = null; });
      }
    } catch (_) { this._wakeLock = null; }
  }

  _releaseWakeLock() {
    try { if (this._wakeLock) this._wakeLock.release(); } catch (_) {}
    this._wakeLock = null;
  }

  /** resolve the tier for a roll, folding in the warmup self-test verdict */
  _resolveTier(stage, micLive) {
    let name = pickTier(stage, { micLive });
    if (this._forcedTier && TIER_ORDER.indexOf(this._forcedTier) > TIER_ORDER.indexOf(name)) {
      name = this._forcedTier;
    }
    return name;
  }

  /** COUNTDOWN WARMUP SELF-TEST — run a ~700ms throwaway MediaRecorder on the
      same stream/codec and confirm a chunk actually arrives. If it doesn't,
      drop one tier + fall back a codec BEFORE the real take starts — the
      performer never burns a take discovering the encoder can't keep up. */
  async warmup(stage, { micLive = false } = {}) {
    if (this.recording) return true;
    const tierName = this._resolveTier(stage, micLive);
    const tier = TIERS[tierName];
    let tracks = [];
    try {
      const s = stage.captureStream(tier.captureFps, tier.scale);
      tracks = s.getVideoTracks();
      const built = buildRecorder(new MediaStream(tracks), tier, this._preferWebm ? WEBM_FIRST : null);
      if (!built) {
        this._forcedTier = 'low';
        this._preferWebm = true;
        return false;
      }
      const ok = await new Promise((resolve) => {
        let got = false;
        let settled = false;
        const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
        built.rec.ondataavailable = (e) => { if (e.data && e.data.size) got = true; };
        built.rec.onerror = () => finish(false);
        try { built.rec.start(200); } catch (_) { finish(false); return; }
        setTimeout(() => {
          try { built.rec.stop(); } catch (_) {}
          setTimeout(() => finish(got), 250);
        }, 700);
      });
      if (!ok) {
        this._forcedTier = tierName === 'high' ? 'medium' : 'low';
        this._preferWebm = true;
        console.warn(`[recorder] warmup self-test failed at ${tierName} — forcing ${this._forcedTier} + webm-first ladder`);
      } else {
        console.log(`[recorder] warmup ok — ${tierName} / ${built.codec.mime}`);
      }
      return ok;
    } catch (err) {
      console.warn('[recorder] warmup self-test errored', err);
      return false;
    } finally {
      tracks.forEach((t) => { try { t.stop(); } catch (_) {} });
    }
  }

  start(stage, voiceStream, { micLive = false } = {}) {
    if (this.recording) return false;
    const tierName = this._resolveTier(stage, micLive);
    const tier = TIERS[tierName];

    let canvasStream;
    try { canvasStream = stage.captureStream(tier.captureFps, tier.scale); } catch (err) {
      console.error('[recorder] captureStream failed', err);
      return false;
    }
    const tracks = [...canvasStream.getVideoTracks()];
    if (voiceStream) tracks.push(...voiceStream.getAudioTracks());
    const stream = new MediaStream(tracks);

    const built = buildRecorder(stream, tier, this._preferWebm ? WEBM_FIRST : null);
    if (!built) {
      console.error('[recorder] MediaRecorder could not be constructed at any tier');
      canvasStream.getVideoTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
      return false;
    }
    console.log(`[recorder] rolling — tier ${tierName}, codec ${built.codec.mime}`);

    this.chunks = [];
    this.rec = built.rec;
    this.stalled = false;
    this._lastChunkAt = 0;
    this.rec.ondataavailable = (e) => {
      if (e.data.size) {
        this.chunks.push(e.data);
        this._lastChunkAt = performance.now();
        this.stalled = false;
      }
    };
    this.rec.onerror = (e) => { console.error('[recorder] MediaRecorder error', e.error || e); };
    try { this.rec.start(500); } catch (err) {
      console.error('[recorder] MediaRecorder.start failed', err);
      canvasStream.getVideoTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
      this.rec = null;
      return false;
    }
    this.recording = true;
    this.startTs = performance.now();
    this._lastChunkAt = this.startTs;
    this.mime = built.codec.mime;
    this.ext = built.codec.ext;
    this.tier = tierName;
    this._canvasTracks = canvasStream.getVideoTracks();
    this._acquireWakeLock();

    /* DECOUPLED FRAME HEARTBEAT + ENCODER HEALTH — the render loop's pushFrame
       stays primary, but a watchdog at the tier's frame period forces a frame
       through if the loop hasn't delivered within 1.5 frame periods (frame
       exception, rAF hiccup, hidden tab): the encoder is never starved by a
       render hiccup. The same tick tracks dataavailable arrivals: no chunk for
       >2s while recording means the encoder itself has stalled — log it and
       expose rec.stalled so the HUD can warn instead of silently shipping a
       frozen file. */
    const periodMs = 1000 / tier.captureFps;
    this._watchdog = setInterval(() => {
      if (!this.recording) return;
      try {
        const last = typeof stage.lastCaptureFrameAt === 'number' ? stage.lastCaptureFrameAt : 0;
        if (performance.now() - last > periodMs * 1.5 && typeof stage.forceCaptureFrame === 'function') {
          stage.forceCaptureFrame();
        }
      } catch (_) { /* heartbeat must never kill the take */ }
      if (this._lastChunkAt && performance.now() - this._lastChunkAt > 2000 && !this.stalled) {
        this.stalled = true;
        console.error('[recorder] encoder stalled — no data for >2s while recording');
      }
    }, Math.max(8, Math.floor(periodMs)));
    return true;
  }

  _stopWatchdog() {
    if (this._watchdog) { clearInterval(this._watchdog); this._watchdog = 0; }
  }

  /* kept for API compatibility (auto jump-cuts / breathers used to call these).
     They deliberately DO NOT touch the MediaRecorder — see the note on `paused`.
     Returning false tells callers the cut/breather did not happen. */
  pause() { return false; }
  resume() { return false; }

  /** RESTART path: kill the take and keep NOTHING. Stops the MediaRecorder,
      discards every chunk, stops the canvas tracks, never resolves a take
      object — zero download, zero POST, zero progress mark. Audio tracks are
      never touched: they belong to the voice engine's MediaStreamDestination. */
  cancel() {
    if (!this.recording) return false;
    this.recording = false;
    this._stopWatchdog();
    this._releaseWakeLock();
    const rec = this.rec;
    this.rec = null;
    this.chunks = [];
    this.stalled = false;
    if (rec) {
      rec.ondataavailable = null;
      rec.onstop = null;
      rec.onerror = null;
      try { rec.stop(); } catch (_) {}
    }
    this._canvasTracks.forEach((t) => { try { t.stop(); } catch (_) {} });
    this._canvasTracks = [];
    return true;
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.recording) { resolve(null); return; }
      const dur = this.elapsed;
      this._stopWatchdog();
      const cleanup = () => {
        // release the canvas capture; NEVER stop the audio tracks — they belong
        // to the voice engine's MediaStreamDestination and must survive the take
        this._canvasTracks.forEach((t) => { try { t.stop(); } catch (_) {} });
        this._canvasTracks = [];
        this._releaseWakeLock();
      };
      this.rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mime.split(';')[0] });
        this.recording = false;
        cleanup();
        resolve({
          blob,
          url: URL.createObjectURL(blob),
          duration: dur,
          size: blob.size,
          mime: this.mime,
          ext: this.ext,
          tier: this.tier,
          createdAt: new Date().toISOString(),
        });
      };
      /* FLUSH THE TAIL: with 500ms timeslices the final <=500ms of audio+video
         rides only on the browser's implicit stop-flush — which Chromium has
         historically dropped under encoder load. requestData() forces the
         encoder to emit everything it holds BEFORE stop(), and a short settle
         beat gives that flush time to land as a dataavailable chunk, so the
         last words of the take are guaranteed to be inside the file. */
      try { this.rec.requestData(); } catch (_) { /* inactive or unsupported — stop() still flushes */ }
      /* 400ms settle (was 250): under encoder load the forced flush can take a
         beat to land as a dataavailable chunk — the wider window costs nothing
         (the take keeps recording through it) and guarantees the final words
         are physically inside the file before stop() seals it. */
      setTimeout(() => {
        try { this.rec.stop(); } catch (_) { this.recording = false; cleanup(); resolve(null); }
      }, 400);
    });
  }
}
