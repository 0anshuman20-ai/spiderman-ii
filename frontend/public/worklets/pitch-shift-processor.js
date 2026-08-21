/* Granular dual-tap crossfade pitch shifter. Click-free, low latency (~50ms window).

   CPU NOTE: this runs on the audio render thread 375x/second while a 12 Mbps
   video encode and a WebGL stage render compete for the CPU. A missed deadline
   here does not degrade gracefully — it emits partial/repeated blocks, which is
   audible as a periodic "jt-jt-jt" buzz baked into the recording. So the hot
   loop is kept allocation-free, Math.sin/Math.pow are hoisted out of it, and
   the unity-ratio case short-circuits to a real passthrough. */
const WIN = 2400;                       // ~50ms @ 48k
/* sin^2 crossfade window, precomputed once per processor: the old code called
   Math.sin() twice per sample (2 x 48000 x 2 nodes = 192k calls/sec). */
const WIN_LUT = new Float32Array(WIN);
for (let i = 0; i < WIN; i++) { const s = Math.sin((Math.PI * i) / WIN); WIN_LUT[i] = s * s; }

class PitchShiftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'semitones', defaultValue: -3, minValue: -24, maxValue: 24, automationRate: 'k-rate' }];
  }
  constructor() {
    super();
    this.N = 16384;
    this.buf = new Float32Array(this.N);
    this.w = 0;
    this.ph = 0;
  }
  process(inputs, outputs, params) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    const inp = inputs[0] && inputs[0][0];
    const n = out.length;
    if (!inp) { out.fill(0); return true; }

    const semis = params.semitones[0];
    /* UNITY = TRUE PASSTHROUGH. At ratio 1 the granular math degenerates to a
       pure WIN/2 delay line: it costs a full shifter's CPU and adds 25ms of
       latency to produce a copy of the input. The default 'earbud-pro' preset
       is pitch 0, so this is the common case, not an edge case. Copy and go. */
    if (semis === 0) {
      out.set(inp);
      /* keep the ring buffer coherent so toggling pitch mid-take can't pop */
      const N = this.N;
      let w = this.w;
      for (let i = 0; i < n; i++) { this.buf[w] = inp[i]; w = (w + 1) % N; }
      this.w = w;
      this.ph = 0;
      return true;
    }

    const ratio = Math.pow(2, semis / 12);
    const step = 1 - ratio;
    const N = this.N;
    const buf = this.buf;
    let w = this.w;
    let ph = this.ph;
    const half = WIN >> 1;
    for (let i = 0; i < n; i++) {
      buf[w] = inp[i];
      ph += step;
      if (ph >= WIN) ph -= WIN;
      else if (ph < 0) ph += WIN;
      const t1 = ph;
      const t2 = ph < half ? ph + half : ph - half;
      const gg1 = WIN_LUT[t1 | 0];

      /* inlined dual interpolated reads — the old read() helper did two
         modulos per call, four calls per sample */
      let a = w - t1;
      a %= N; if (a < 0) a += N;
      const a0 = a | 0, af = a - a0;
      const s1 = buf[a0] * (1 - af) + buf[a0 + 1 === N ? 0 : a0 + 1] * af;

      let b = w - t2;
      b %= N; if (b < 0) b += N;
      const b0 = b | 0, bf = b - b0;
      const s2 = buf[b0] * (1 - bf) + buf[b0 + 1 === N ? 0 : b0 + 1] * bf;

      const s = s1 * gg1 + s2 * (1 - gg1);
      out[i] = s === s ? s : 0; // NaN guard without a function call
      w = w + 1 === N ? 0 : w + 1;
    }
    this.w = w;
    this.ph = ph;
    return true;
  }
}
if (typeof registerProcessor === 'function') registerProcessor('pitch-shift', PitchShiftProcessor);
