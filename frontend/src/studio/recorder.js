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
   continues). Medium/low tiers now DOWNSCALE THE RENDER ITSELF (the stage
   renders + captures at 810x1440 / 720x1280 with MSAA off for the take),
   cutting BOTH render and encode load 1.8-2.25x with zero per-frame copies.
   Export stays vertical and upload-ready; full quality returns after the take.

   Codec ladder is HARDWARE-FIRST: honest MP4 (H.264/AAC — near-zero CPU on most
   machines when hardware encode is present), then video/webm;codecs=h264, then
   VP9/Opus, then VP8, then plain WebM. Construction itself degrades too: full
   options -> mime only -> bare recorder, stepping down the ladder, so a picky
   encoder yields a softer file, never a dead take. */

/* WEBCODECS PATH (primary when available): MediaRecorder rides Chromium's
   WebRTC encoder stack, whose rate control opens every session in a ramp —
   the first ~1s GOP is heavily quantized (soft/blurry), then sharpens. No
   MediaRecorder knob can fix that. Encoding ourselves via WebCodecs +
   mediabunny gives full-bitrate encode from FRAME ZERO: mediabunny wraps
   VideoEncoder (no WebRTC scaler, no ramp), muxes an upload-ready MP4
   (H.264/AAC) or WebM (VP9/Opus) client-side, and the countdown warmup
   trial-encodes real frames so an unsupported machine falls back to the
   battle-tested MediaRecorder ladder BEFORE a take is ever burned. */
import {
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  CanvasSource,
  MediaStreamAudioTrackSource,
  AudioSampleSource,
  AudioSample,
  getFirstEncodableVideoCodec,
  getFirstEncodableAudioCodec,
} from 'mediabunny';

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
   (generous at 810x1440), low to 3.5 Mbps. `scale` is the RENDER factor
   handed to stage.captureStream — the stage renders and captures at that
   resolution for the take; 1 keeps the native canvas. */
/* wcScale/wcBps are the WEBCODECS-PATH overrides. The render downscale exists
   to stop MediaRecorder's silent mid-take video stall — but the WebCodecs path
   can't stall that way: its backpressure DROPS a frame when the encoder is
   busy (state.pending), so overload costs fps, never a frozen track. That
   makes native 1080x1920 safe on medium machines via WebCodecs, which is the
   single biggest visual upgrade a take can get — and the live preview stays
   sharp during the roll instead of visibly dropping resolution. Low tier
   (software GL / 2 cores) still downscales: there the RENDER itself is the
   bottleneck, not just the encoder. */
const TIERS = {
  high: { captureFps: 30, scale: 1, videoBps: 12_000_000, wcScale: 1, wcBps: 12_000_000, audioBps: 192_000, ladder: MP4_FIRST },
  medium: { captureFps: 30, scale: 0.75, videoBps: 6_000_000, wcScale: 1, wcBps: 10_000_000, audioBps: 160_000, ladder: MP4_FIRST },  // MR: 810x1440, WC: native
  low: { captureFps: 24, scale: 2 / 3, videoBps: 3_500_000, wcScale: 0.75, wcBps: 5_000_000, audioBps: 128_000, ladder: WEBM_FIRST }, // MR: 720x1280, WC: 810x1440
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
    /* WebCodecs verdict from the countdown trial encode:
       undefined = not probed yet, null = unsupported (use MediaRecorder),
       { container, video, audio } = proven working — the real take uses it */
    this._wc = undefined;
    this._wcSession = null; // live WebCodecs take: { output, target, videoSource, state, stopAudio }
    /* dedicated 48k AudioContext + capture worklet for the WebCodecs audio path
       (see public/worklets/capture-processor.js for WHY):
       undefined = not preloaded, null = preload failed (fall back to
       MediaStreamAudioTrackSource), AudioContext = ready for lossless capture */
    this._capCtx = undefined;
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

  /** preload the lossless PCM capture context for the WebCodecs audio path.
      MUST be ready before the roll: _startWc is synchronous by contract, so
      the async addModule() has to happen here, during the countdown. Cached
      for the session; null means the worklet path is unavailable and the take
      falls back to MediaStreamAudioTrackSource. */
  async _preloadCapture() {
    if (this._capCtx !== undefined) return this._capCtx;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      /* 48k to match the voice engine's context — a cross-context
         MediaStreamSource resamples silently otherwise */
      const ctx = new Ctx({ sampleRate: 48000, latencyHint: 'playback' });
      await ctx.audioWorklet.addModule('/worklets/capture-processor.js');
      this._capCtx = ctx;
      console.log('[recorder] capture worklet ready — lossless PCM audio path armed');
    } catch (err) {
      console.warn('[recorder] capture worklet preload failed — falling back to track-source audio', err);
      this._capCtx = null;
    }
    return this._capCtx;
  }

  /** WEBCODECS TRIAL ENCODE — resolve which codec/container this machine can
      encode with WebCodecs at the tier's real resolution, then PROVE it by
      encoding two actual frames off the live canvas into a throwaway muxer.
      Support flags lie under pressure; produced bytes don't. The verdict is
      cached: a machine doesn't change mid-session. */
  async _probeWebCodecs(stage, tier) {
    if (this._wc !== undefined) return this._wc;
    try {
      if (typeof window === 'undefined' || typeof window.VideoEncoder !== 'function' ||
          typeof stage.captureFrames !== 'function') {
        this._wc = null;
        return null;
      }
      const wcScale = tier.wcScale ?? tier.scale;
      const wcBps = tier.wcBps ?? tier.videoBps;
      const w = Math.max(2, Math.round((1080 * wcScale) / 2) * 2);
      const h = Math.max(2, Math.round((1920 * wcScale) / 2) * 2);
      const [avc, aac, vpx, opus] = await Promise.all([
        getFirstEncodableVideoCodec(['avc'], { width: w, height: h }),
        getFirstEncodableAudioCodec(['aac'], { numberOfChannels: 2, sampleRate: 48000 }),
        getFirstEncodableVideoCodec(['vp9', 'vp8'], { width: w, height: h }),
        getFirstEncodableAudioCodec(['opus'], { numberOfChannels: 2, sampleRate: 48000 }),
      ]);
      let verdict = null;
      if (avc && aac) verdict = { container: 'mp4', video: 'avc', audio: 'aac' };
      else if (vpx && opus) verdict = { container: 'webm', video: vpx, audio: 'opus' };
      if (!verdict) { this._wc = null; return null; }

      /* trial encode: two real frames off the live canvas (already at the
         take's render scale), sealed into a real container. Time-boxed so a
         hung encoder can't eat the countdown. */
      const canvas = stage.captureFrames(tier.captureFps, wcScale, null);
      const target = new BufferTarget();
      const output = new Output({
        format: verdict.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
        target,
      });
      const src = new CanvasSource(canvas, { codec: verdict.video, bitrate: wcBps, keyFrameInterval: 2 });
      output.addVideoTrack(src, { frameRate: tier.captureFps });
      const trial = (async () => {
        await output.start();
        await src.add(0, 1 / tier.captureFps);
        await src.add(1 / tier.captureFps, 1 / tier.captureFps);
        await output.finalize();
        return !!(target.buffer && target.buffer.byteLength > 0);
      })();
      const ok = await Promise.race([
        trial.catch(() => false),
        new Promise((r) => setTimeout(() => r(false), 1800)),
      ]);
      if (!ok) { try { await output.cancel(); } catch (_) {} }
      this._wc = ok ? verdict : null;
      /* arm the lossless audio path while the countdown is still running —
         _startWc needs the worklet module already loaded */
      if (ok) await this._preloadCapture();
      if (ok) console.log(`[recorder] WebCodecs proven — ${verdict.container} (${verdict.video}/${verdict.audio}), sharp from frame zero`);
      else console.warn('[recorder] WebCodecs trial encode failed — MediaRecorder ladder stays primary');
      return this._wc;
    } catch (err) {
      console.warn('[recorder] WebCodecs probe errored — MediaRecorder ladder stays primary', err);
      this._wc = null;
      return null;
    }
  }

  /** COUNTDOWN WARMUP SELF-TEST — run a ~700ms throwaway MediaRecorder on the
      same stream/codec and confirm a chunk actually arrives. If it doesn't,
      drop one tier + fall back a codec BEFORE the real take starts — the
      performer never burns a take discovering the encoder can't keep up. */
  async warmup(stage, { micLive = false } = {}) {
    if (this.recording) return true;
    const tierName = this._resolveTier(stage, micLive);
    const tier = TIERS[tierName];
    /* WEBCODECS FIRST — if the trial encode proves the machine can encode at
       this tier via WebCodecs, the take will use that path (no WebRTC rate-
       control ramp, sharp from frame zero) and the MediaRecorder probe is
       unnecessary. The render scale is already applied by the probe's
       captureFrames call; keepScale holds it warm through the handoff to REC. */
    try {
      const wc = await this._probeWebCodecs(stage, tier);
      if (wc) {
        try { if (!this.recording && stage.releaseCapture) stage.releaseCapture({ keepScale: true }); } catch (_) {}
        return true;
      }
    } catch (_) { /* fall through to the MediaRecorder probe */ }
    let tracks = [];
    try {
      const s = stage.captureStream(tier.captureFps, tier.scale);
      tracks = s.getVideoTracks();
      /* same contentHint as the real roll — the warmup verdict must reflect
         the exact encoder configuration the take will use */
      tracks.forEach((t) => { try { t.contentHint = 'detail'; } catch (_) {} });
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
      /* the probe's captureStream installed its own pushFrame closures — release
         them; the real roll installs fresh ones. Guard: never touch a live take.
         keepScale: the take is seconds away at the SAME scale — restoring full
         resolution here just to re-downscale at REC disposed and reallocated
         every render target twice, and that churn janked (and visibly softened/
         froze) the first seconds of every recording. The pipeline now stays at
         the take's resolution through the handoff; quality restores at take end
         (or on countdown cancel, which releases without keepScale). */
      try { if (!this.recording && stage && stage.releaseCapture) stage.releaseCapture({ keepScale: true }); } catch (_) {}
    }
  }

  /** WEBCODECS ROLL — encode the canvas ourselves. Synchronous by contract
      (Studio expects an immediate boolean): the Output's async start() runs in
      the background; frames delivered before it resolves are dropped (a few
      ms of countdown tail, never take content — timestamps anchor at the
      FIRST ENCODED frame, so the file always starts at 0). Returns false on
      any construction failure so start() falls through to MediaRecorder. */
  _startWc(stage, voiceStream, tierName) {
    const wc = this._wc;
    const tier = TIERS[tierName];
    if (!wc || typeof stage.captureFrames !== 'function') return false;
    try {
      const target = new BufferTarget();
      const output = new Output({
        format: wc.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
        target,
      });
      const state = { ready: false, pending: false, t0: 0, failed: false, refresh: 0 };
      const session = { output, target, videoSource: null, state };

      /* EARLY KEYFRAME REFRESHES — kill the soft opening second. The encoder's
         rate control starts conservative (worst on software VP8/VP9), so the
         FIRST keyframe is blurry and the GOP built on it inherits the blur
         until the next keyframe at keyFrameInterval (2s). Rate control
         converges within a handful of frames, so forcing fresh keyframes at
         ~0.5s and ~1.2s replaces the blurry opening GOP with converged-quality
         ones — the visible blur window shrinks from ~2s to a few hundred ms. */
      const REFRESH_AT = [0.5, 1.2];

      /* the sink runs right after every composer.render(): timestamp off the
         wall clock anchored at the first encoded frame; backpressure by
         dropping (a live source can't be slowed down) */
      const wcScale = tier.wcScale ?? tier.scale;
      const wcBps = tier.wcBps ?? tier.videoBps;
      const canvas = stage.captureFrames(tier.captureFps, wcScale, () => {
        if (!this.recording || !state.ready || state.pending || state.failed) return;
        const now = performance.now();
        if (!state.t0) state.t0 = now;
        const ts = (now - state.t0) / 1000;
        let encodeOpts;
        if (state.refresh < REFRESH_AT.length && ts >= REFRESH_AT[state.refresh]) {
          encodeOpts = { keyFrame: true };
          state.refresh++;
        }
        state.pending = true;
        session.videoSource
          .add(ts, 1 / tier.captureFps, encodeOpts)
          .then(() => {
            this._lastChunkAt = performance.now(); // encoder health heartbeat
            this.stalled = false;
          })
          .catch((err) => {
            if (!state.failed) {
              state.failed = true;
              this.stalled = true;
              console.error('[recorder] WebCodecs encode failed mid-take', err);
            }
          })
          .finally(() => { state.pending = false; });
      });

      session.videoSource = new CanvasSource(canvas, {
        codec: wc.video,
        bitrate: wcBps,
        keyFrameInterval: 2,
        /* 'quality' explicitly — never let the encoder pick realtime mode,
           which trades opening sharpness for latency we don't need (frames are
           timestamped at capture, so encode latency is invisible) */
        latencyMode: 'quality',
        /* talking-head content: bias the encoder toward spatial detail over
           motion smoothness */
        contentHint: 'detail',
      });
      output.addVideoTrack(session.videoSource, { frameRate: tier.captureFps });

      /* AUDIO — WORKLET PCM CAPTURE (primary). MediaStreamAudioTrackSource
         rides MediaStreamTrackProcessor, which delivers AudioData on the MAIN
         thread through a tiny ReadableStream queue: with the render/capture
         loop jamming the main thread during a take, Chromium overflowed that
         queue and silently DROPPED ~97% of the audio (takes came out as ~3ms
         slivers every ~125ms — a machine-gun buzz). The capture worklet runs
         on the realtime audio thread and its MessagePort queue is unbounded:
         under main-thread jank the PCM batches arrive LATE, never dropped.
         Timestamps come from the cumulative sample count — not arrival time —
         so late delivery can't skew A/V sync. */
      const audioTrack = voiceStream && voiceStream.getAudioTracks()[0];
      if (audioTrack) {
        let wired = false;
        const capCtx = this._capCtx || null;
        if (capCtx) {
          try {
            const tap = capCtx.createMediaStreamSource(new MediaStream([audioTrack]));
            const node = new AudioWorkletNode(capCtx, 'capture');
            tap.connect(node);
            /* the worklet writes no output (silence) — this connection only
               guarantees the graph keeps pulling it every render quantum */
            node.connect(capCtx.destination);
            if (capCtx.state !== 'running') { try { capCtx.resume(); } catch (_) {} }
            const audioSource = new AudioSampleSource({ codec: wc.audio, bitrate: tier.audioBps });
            output.addAudioTrack(audioSource);
            let written = 0; // cumulative frames encoded — the timestamp clock
            let chain = Promise.resolve(); // serializes add() for encoder backpressure
            let stopped = false;
            node.port.onmessage = (e) => {
              /* batches before output.start() resolves are countdown tail, not
                 take content — dropping them anchors audio t=0 at roll start,
                 matching the video's first-encoded-frame anchor */
              if (stopped || !state.ready || state.failed) return;
              const planes = e.data;
              const frames = planes && planes[0] ? planes[0].length : 0;
              if (!frames) return;
              const nCh = planes.length;
              const data = new Float32Array(frames * nCh);
              for (let c = 0; c < nCh; c++) data.set(planes[c], c * frames);
              const sample = new AudioSample({
                data,
                format: 'f32-planar',
                numberOfChannels: nCh,
                sampleRate: capCtx.sampleRate,
                timestamp: written / capCtx.sampleRate,
              });
              written += frames;
              chain = chain.then(() => audioSource.add(sample)).catch((err) => {
                if (!state.failed) console.error('[recorder] WebCodecs audio encode failed', err);
              });
            };
            session.stopAudio = async () => {
              try { node.port.postMessage('stop'); } catch (_) {} // seal + flush the partial batch
              await new Promise((r) => setTimeout(r, 60));        // let the final flush cross the port
              stopped = true;
              try { tap.disconnect(); } catch (_) {}
              try { node.disconnect(); } catch (_) {}
              try { await chain; } catch (_) {}                   // drain every queued add()
              try { audioSource.close(); } catch (_) {}           // no more samples — lets finalize seal cleanly
            };
            wired = true;
          } catch (err) {
            console.warn('[recorder] worklet audio capture failed to wire — falling back to track source', err);
            session.stopAudio = null;
          }
        }
        if (!wired) {
          /* fallback: still drop-prone under main-thread jank, but a take with
             imperfect audio beats a take with none */
          const audioSource = new MediaStreamAudioTrackSource(audioTrack, { codec: wc.audio, bitrate: tier.audioBps });
          output.addAudioTrack(audioSource);
          /* errorPromise never resolves — only rejects on capture failure */
          try { audioSource.errorPromise.catch((err) => console.error('[recorder] WebCodecs audio capture error', err)); } catch (_) {}
        }
      }

      output.start().then(() => { state.ready = true; }).catch((err) => {
        state.failed = true;
        this.stalled = true;
        console.error('[recorder] WebCodecs output failed to start', err);
      });

      this._wcSession = session;
      this.mime = wc.container === 'mp4' ? 'video/mp4' : 'video/webm';
      this.ext = wc.container;
      console.log(`[recorder] rolling (WebCodecs) — tier ${tierName}, ${wc.container} ${wc.video}/${wc.audio}`);
      return true;
    } catch (err) {
      console.warn('[recorder] WebCodecs start failed — falling back to MediaRecorder', err);
      this._wc = null; // proven unreliable: don't try again this session
      this._wcSession = null;
      try { if (stage.releaseCapture) stage.releaseCapture({ keepScale: true }); } catch (_) {}
      return false;
    }
  }

  start(stage, voiceStream, { micLive = false } = {}) {
    if (this.recording) return false;
    const tierName = this._resolveTier(stage, micLive);
    const tier = TIERS[tierName];

    /* WEBCODECS PRIMARY — proven by the countdown trial encode. Full-bitrate
       H.264/VP9 from the very first frame: no WebRTC rate-control ramp, no
       soft opening second. Falls through to the MediaRecorder ladder if
       construction fails for any reason. */
    if (this._wc && this._startWc(stage, voiceStream, tierName)) {
      this.recording = true;
      this.startTs = performance.now();
      this._lastChunkAt = this.startTs;
      this.stalled = false;
      this.tier = tierName;
      this._stage = stage;
      this._canvasTracks = [];
      this._acquireWakeLock();
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

    let canvasStream;
    try { canvasStream = stage.captureStream(tier.captureFps, tier.scale); } catch (err) {
      console.error('[recorder] captureStream failed', err);
      return false;
    }
    const tracks = [...canvasStream.getVideoTracks()];
    /* 'detail' biases Chromium's WebRTC encoder toward spatial sharpness and
       maintain-resolution degradation — softens the rate-control ramp that
       blurs the opening second of MediaRecorder takes */
    tracks.forEach((t) => { try { t.contentHint = 'detail'; } catch (_) {} });
    if (voiceStream) tracks.push(...voiceStream.getAudioTracks());
    const stream = new MediaStream(tracks);

    const built = buildRecorder(stream, tier, this._preferWebm ? WEBM_FIRST : null);
    if (!built) {
      console.error('[recorder] MediaRecorder could not be constructed at any tier');
      canvasStream.getVideoTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
      try { if (stage.releaseCapture) stage.releaseCapture(); } catch (_) {} // never leave the preview downscaled
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
      try { if (stage.releaseCapture) stage.releaseCapture(); } catch (_) {} // never leave the preview downscaled
      this.rec = null;
      return false;
    }
    this.recording = true;
    this.startTs = performance.now();
    this._lastChunkAt = this.startTs;
    /* TRUTH IN LABELING: name the file by what the browser ACTUALLY encodes
       (rec.mimeType), not by what we asked for. When the two drift apart the
       download gets an extension that doesn't match its container — a file
       the OS can't identify or play ("downloading idk what"). */
    const actualMime = (this.rec.mimeType && this.rec.mimeType.length) ? this.rec.mimeType : built.codec.mime;
    this.mime = actualMime;
    this.ext = /mp4/i.test(actualMime) ? 'mp4' : 'webm';
    this.tier = tierName;
    this._stage = stage;
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
    /* WebCodecs take: cancel the muxer (releases encoders, drops all bytes) */
    if (this._wcSession) {
      const session = this._wcSession;
      this._wcSession = null;
      this.stalled = false;
      /* disconnect the worklet tap so the capture context stops pulling the
         voice stream; queued adds reject against the cancelled output — fine */
      if (session.stopAudio) { try { session.stopAudio().catch(() => {}); } catch (_) {} }
      try { session.output.cancel().catch(() => {}); } catch (_) {}
      try { if (this._stage && this._stage.releaseCapture) this._stage.releaseCapture(); } catch (_) {}
      return true;
    }
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
    // hand the render loop back its pre-take cost — see stage.releaseCapture
    try { if (this._stage && this._stage.releaseCapture) this._stage.releaseCapture(); } catch (_) {}
    return true;
  }

  /** seal a WebCodecs take: wait out the in-flight frame, finalize the muxer,
      hand back the same take object shape the MediaRecorder path produces */
  async _stopWc() {
    const session = this._wcSession;
    this._wcSession = null;
    const dur = this.elapsed;
    this._stopWatchdog();
    this.recording = false;
    const cleanup = () => {
      try { if (this._stage && this._stage.releaseCapture) this._stage.releaseCapture(); } catch (_) {}
      this._releaseWakeLock();
    };
    try {
      /* let the last in-flight add() land — the final frame belongs in the file */
      const t0 = performance.now();
      while (session.state.pending && performance.now() - t0 < 1500) {
        await new Promise((r) => setTimeout(r, 30));
      }
      /* worklet audio path: flush the sealed partial batch, drain every queued
         PCM add() (late-but-never-dropped batches land HERE), close the source */
      if (session.stopAudio) {
        try { await session.stopAudio(); } catch (_) { /* drain is best-effort */ }
      }
      /* finalize stops the audio capture, flushes both encoders and seals the
         container — everything spoken up to this moment is inside */
      await session.output.finalize();
    } catch (err) {
      console.error('[recorder] WebCodecs finalize failed', err);
      try { session.output.cancel().catch(() => {}); } catch (_) {}
      cleanup();
      this._wc = null; // don't trust this path again this session
      this._preferWebm = true;
      return null;
    }
    cleanup();
    const buffer = session.target.buffer;
    const size = buffer ? buffer.byteLength : 0;
    const minBytes = Math.min(50_000, Math.max(4_000, dur * 15_000));
    if (!size || size < minBytes) {
      console.error(`[recorder] take discarded — WebCodecs produced ${size} bytes for a ${dur.toFixed(1)}s take`);
      this._wc = null;
      this._forcedTier = 'low';
      this._preferWebm = true;
      return null;
    }
    const blob = new Blob([buffer], { type: this.mime });
    return {
      blob,
      url: URL.createObjectURL(blob),
      duration: dur,
      size: blob.size,
      mime: this.mime,
      ext: this.ext,
      tier: this.tier,
      createdAt: new Date().toISOString(),
    };
  }

  stop() {
    if (this.recording && this._wcSession) return this._stopWc();
    return new Promise((resolve) => {
      if (!this.recording) { resolve(null); return; }
      const dur = this.elapsed;
      this._stopWatchdog();
      const cleanup = () => {
        // release the canvas capture; NEVER stop the audio tracks — they belong
        // to the voice engine's MediaStreamDestination and must survive the take
        this._canvasTracks.forEach((t) => { try { t.stop(); } catch (_) {} });
        this._canvasTracks = [];
        try { if (this._stage && this._stage.releaseCapture) this._stage.releaseCapture(); } catch (_) {}
        this._releaseWakeLock();
      };
      this.rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mime.split(';')[0] });
        this.recording = false;
        cleanup();
        /* NEVER download garbage: a stalled/dead encoder can seal a near-empty
           blob — an unplayable file that looks like a broken download. Below
           ~50KB there is no take inside; report failure instead of shipping it,
           and prime the next roll to a safer tier + webm-first ladder. */
        const minBytes = Math.min(50_000, Math.max(4_000, dur * 15_000)); // duration-aware: never eats a legit micro-take
        if (!blob.size || blob.size < minBytes) {
          console.error(`[recorder] take discarded — encoder produced ${blob.size} bytes for a ${dur.toFixed(1)}s take`);
          this._forcedTier = 'low';
          this._preferWebm = true;
          resolve(null);
          return;
        }
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
