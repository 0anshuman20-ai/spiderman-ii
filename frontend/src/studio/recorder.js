/* One-key recorder: canvas 60fps + processed voice -> vertical WebM take. */
export class Recorder {
  constructor() {
    this.recording = false;
    this.startTs = 0;
  }

  get elapsed() { return this.recording ? (performance.now() - this.startTs) / 1000 : 0; }

  start(stage, voiceStream) {
    if (this.recording) return false;
    const canvasStream = stage.captureStream(60);
    const tracks = [...canvasStream.getVideoTracks()];
    if (voiceStream) tracks.push(...voiceStream.getAudioTracks());
    const stream = new MediaStream(tracks);
    let mime = 'video/webm;codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm;codecs=vp8,opus';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';
    this.chunks = [];
    this.rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000, audioBitsPerSecond: 192_000 });
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.start(500);
    this.recording = true;
    this.startTs = performance.now();
    this.mime = mime;
    return true;
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.recording) { resolve(null); return; }
      const dur = this.elapsed;
      this.rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: 'video/webm' });
        this.recording = false;
        resolve({
          blob,
          url: URL.createObjectURL(blob),
          duration: dur,
          size: blob.size,
          mime: this.mime,
          createdAt: new Date().toISOString(),
        });
      };
      this.rec.stop();
    });
  }
}
