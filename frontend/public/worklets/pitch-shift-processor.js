/* Granular dual-tap crossfade pitch shifter. Click-free, low latency (~50ms window). */
class PitchShiftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'semitones', defaultValue: -3, minValue: -24, maxValue: 24, automationRate: 'k-rate' }];
  }
  constructor() {
    super();
    this.N = 16384;
    this.buf = new Float32Array(this.N);
    this.w = 0;
    this.win = 2400; // ~50ms @ 48k
    this.ph = 0;
  }
  read(idx) {
    const N = this.N;
    idx = ((idx % N) + N) % N;
    const i0 = Math.floor(idx), i1 = (i0 + 1) % N, fr = idx - i0;
    return this.buf[i0] * (1 - fr) + this.buf[i1] * fr;
  }
  process(inputs, outputs, params) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    const inp = inputs[0] && inputs[0][0];
    if (!inp) { out.fill(0); return true; }
    const ratio = Math.pow(2, params.semitones[0] / 12);
    const win = this.win;
    for (let i = 0; i < out.length; i++) {
      this.buf[this.w] = inp[i];
      this.ph += (1 - ratio);
      if (this.ph >= win) this.ph -= win;
      if (this.ph < 0) this.ph += win;
      const t1 = this.ph, t2 = (this.ph + win / 2) % win;
      const g1 = Math.sin(Math.PI * t1 / win); const gg1 = g1 * g1;
      const s = this.read(this.w - t1) * gg1 + this.read(this.w - t2) * (1 - gg1);
      out[i] = Number.isFinite(s) ? s : 0;
      this.w = (this.w + 1) % this.N;
    }
    return true;
  }
}
if (typeof registerProcessor === 'function') registerProcessor('pitch-shift', PitchShiftProcessor);
