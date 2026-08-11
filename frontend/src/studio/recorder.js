/* One-key recorder: canvas 60fps + processed voice -> vertical upload-ready take.
   Codec ladder: honest MP4 (H.264/AAC — accepted everywhere, no transcode) when the
   browser can mux it, else VP9/Opus WebM, else VP8, else plain WebM. */

const CODEC_LADDER = [
  { mime: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4' }, // H.264 High + AAC-LC
  { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' }, // H.264 Baseline fallback
  { mime: 'video/mp4', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
];

export class Recorder {
  constructor() {
    this.recording = false;
    this.startTs = 0;
  }

  get elapsed() { return this.recording ? (performance.now() - this.startTs) / 1000 : 0; }

  start(stage, voiceStream, { fps = 60, videoBitsPerSecond = 20_000_000 } = {}) {
    if (this.recording) return false;
    const canvasStream = stage.captureStream(fps);
    const tracks = [...canvasStream.getVideoTracks()];
    if (voiceStream) tracks.push(...voiceStream.getAudioTracks());
    const stream = new MediaStream(tracks);
    const pick = CODEC_LADDER.find((c) => {
      try { return MediaRecorder.isTypeSupported(c.mime); } catch (_) { return false; }
    }) || CODEC_LADDER[CODEC_LADDER.length - 1];
    this.chunks = [];
    // 20 Mbps video: real headroom for 1080x1920@60 fine grain + starfields
    // (bitrate-starved noise/particles is the #1 way canvas recordings fall apart).
    // On weaker machines the conductor hands us lower fps/bitrate so the realtime
    // encoder can't drown the main thread. 256 kbps audio: transparent for Opus and AAC.
    // Bitrate ladder: full ask -> half -> browser default. A MediaRecorder that the
    // engine refuses to build should degrade, never throw the take away.
    const attempts = [
      { mimeType: pick.mime, videoBitsPerSecond, audioBitsPerSecond: 256_000 },
      { mimeType: pick.mime, videoBitsPerSecond: Math.round(videoBitsPerSecond / 2), audioBitsPerSecond: 192_000 },
      { mimeType: pick.mime },
    ];
    this.rec = null;
    for (const opts of attempts) {
      try { this.rec = new MediaRecorder(stream, opts); break; } catch (_) { /* next rung */ }
    }
    if (!this.rec) {
      try { this.rec = new MediaRecorder(stream); } catch (err) {
        console.error('[recorder] MediaRecorder unavailable', err);
        return false;
      }
    }
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.onerror = (e) => { console.error('[recorder] MediaRecorder error', e.error || e); };
    this.rec.start(500);
    this.recording = true;
    this.startTs = performance.now();
    this.mime = pick.mime;
    this.ext = pick.ext;
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
          createdAt: new Date().toISOString(),
        });
      };
      try { this.rec.stop(); } catch (_) { this.recording = false; resolve(null); }
    });
  }
}
