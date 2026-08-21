/* CAPTURE PROCESSOR — lossless PCM tap for the WebCodecs recording path.

   WHY THIS EXISTS: MediaStreamTrackProcessor (what mediabunny's
   MediaStreamAudioTrackSource uses) delivers AudioData on the MAIN thread
   through a ReadableStream with a tiny internal queue. During a take the main
   thread is saturated by the render/capture loop, the queue overflows, and
   Chromium silently DROPS the audio — recorded takes came out as ~3ms slivers
   of voice every ~125ms with digital silence in between (the measured service
   interval of the jammed main thread).

   An AudioWorklet runs on the realtime audio thread and its MessagePort queue
   is UNBOUNDED: when the main thread jams, PCM batches pile up in the port and
   drain later — delayed, never dropped. The recorder stamps each batch by
   cumulative sample count, so late delivery cannot skew A/V sync.

   Batching: 8 render quanta (1024 frames ≈ 21ms at 48k) per message keeps the
   port traffic at ~47 messages/s instead of 375. */

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._stopped = false;
    this._chans = 0;
    this._buf = null;
    this._fill = 0;
    this._batch = 128 * 8;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') { this._flush(); this._stopped = true; }
    };
  }

  _flush() {
    if (!this._buf || !this._fill) return;
    const out = this._buf.map((b) => b.slice(0, this._fill));
    this.port.postMessage(out, out.map((a) => a.buffer));
    this._fill = 0;
  }

  process(inputs) {
    if (this._stopped) return false;
    const input = inputs[0];
    const nCh = (input && input.length) || this._chans || 1;
    if (!this._buf || this._chans !== nCh) {
      this._flush(); // channel-count change mid-take: seal the partial batch first
      this._chans = nCh;
      this._buf = [];
      for (let c = 0; c < nCh; c++) this._buf.push(new Float32Array(this._batch));
      this._fill = 0;
    }
    const n = (input && input[0] && input[0].length) || 128;
    const room = this._batch - this._fill;
    const take = Math.min(n, room);
    for (let c = 0; c < nCh; c++) {
      const src = input && (input[c] || input[0]);
      if (src) {
        this._buf[c].set(src.subarray(0, take), this._fill);
      } else {
        this._buf[c].fill(0, this._fill, this._fill + take); // muted track: real silence, not stale data
      }
    }
    this._fill += take;
    if (this._fill >= this._batch) this._flush();
    return true;
  }
}

registerProcessor('capture', CaptureProcessor);
