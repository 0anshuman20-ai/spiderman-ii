/* One-key recorder: canvas capture + processed voice -> vertical upload-ready take.

   ADAPTIVE by design: 1080x1920@60 into a 20 Mbps encoder is the right call on a
   healthy GPU, and a guaranteed crash on a constrained one (software WebGL, few
   cores, headless). So before rolling, the recorder reads what the machine can
   actually do — the stage's measured render fps, whether GL is software-rendered,
   core count — and picks a tier:

     high    60fps capture, 20 Mbps  — real headroom for fine grain + starfields
     medium  30fps capture, 12 Mbps  — most laptops on battery
     low     24fps capture,  6 Mbps  — software GL / low-core machines; also
              prefers WebM/VP8, the cheapest encode by far when there is no
              hardware H.264 around

   Codec ladder: honest MP4 (H.264/AAC — accepted everywhere, no transcode) when
   the browser can mux it, else VP9/Opus WebM, else VP8, else plain WebM.
   Construction itself degrades too: full options -> mime only -> bare recorder,
   stepping down the ladder, so a picky encoder yields a softer file, never a
   dead take. */

const MP4_FIRST = [
  { mime: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4' }, // H.264 High + AAC-LC
  { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' }, // H.264 Baseline fallback
  { mime: 'video/mp4', ext: 'mp4' },
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

const TIERS = {
  high: { captureFps: 60, videoBps: 20_000_000, audioBps: 256_000, ladder: MP4_FIRST },
  medium: { captureFps: 30, videoBps: 12_000_000, audioBps: 192_000, ladder: MP4_FIRST },
  low: { captureFps: 24, videoBps: 6_000_000, audioBps: 128_000, ladder: WEBM_FIRST },
};

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

/** capability read: measured stage fps wins; GL backend and core count break ties */
export function pickTier(stage) {
  const measured = stage && typeof stage.fps === 'number' ? stage.fps : 0;
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const soft = isSoftwareGL(stage && stage.renderer);
  if (soft || cores <= 2 || (measured > 0 && measured < 28)) return 'low';
  if (cores <= 4 || (measured > 0 && measured < 50)) return 'medium';
  return 'high';
}

function supported(mime) {
  try { return MediaRecorder.isTypeSupported(mime); } catch (_) { return false; }
}

/** walk the ladder x options grid until a recorder actually constructs */
function buildRecorder(stream, tier) {
  const ladder = tier.ladder.filter((c) => supported(c.mime));
  if (!ladder.length) ladder.push(tier.ladder[tier.ladder.length - 1]);
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
    this.tier = null;       // 'high' | 'medium' | 'low' — set on every start
  }

  get elapsed() { return this.recording ? (performance.now() - this.startTs) / 1000 : 0; }

  start(stage, voiceStream) {
    if (this.recording) return false;
    const tierName = pickTier(stage);
    const tier = TIERS[tierName];

    let canvasStream;
    try { canvasStream = stage.captureStream(tier.captureFps); } catch (err) {
      console.error('[recorder] captureStream failed', err);
      return false;
    }
    const tracks = [...canvasStream.getVideoTracks()];
    if (voiceStream) tracks.push(...voiceStream.getAudioTracks());
    const stream = new MediaStream(tracks);

    const built = buildRecorder(stream, tier);
    if (!built) {
      console.error('[recorder] MediaRecorder could not be constructed at any tier');
      tracks.forEach((t) => { try { t.stop(); } catch (_) {} });
      return false;
    }

    this.chunks = [];
    this.rec = built.rec;
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.onerror = (e) => { console.error('[recorder] MediaRecorder error', e.error || e); };
    try { this.rec.start(500); } catch (err) {
      console.error('[recorder] MediaRecorder.start failed', err);
      tracks.forEach((t) => { try { t.stop(); } catch (_) {} });
      this.rec = null;
      return false;
    }
    this.recording = true;
    this.startTs = performance.now();
    this.mime = built.codec.mime;
    this.ext = built.codec.ext;
    this.tier = tierName;
    return true;
  }

  /* breathers (Ω.0): the conductor pauses the file through the cool-down so the
     export has no dead air. Both are no-ops if the recorder isn't rolling. */
  pause() {
    if (!this.recording || !this.rec || this.rec.state !== 'recording') return false;
    try { this.rec.pause(); return true; } catch (_) { return false; }
  }

  resume() {
    if (!this.recording || !this.rec || this.rec.state !== 'paused') return false;
    try { this.rec.resume(); return true; } catch (_) { return false; }
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.recording) { resolve(null); return; }
      const dur = this.elapsed;
      this.rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mime.split(';')[0] });
        this.recording = false;
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
      try { this.rec.stop(); } catch (_) { this.recording = false; resolve(null); }
    });
  }
}
