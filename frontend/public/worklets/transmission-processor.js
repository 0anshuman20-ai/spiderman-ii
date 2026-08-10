/* Deep-space signal engine: noise gate, pink noise bed, crackle, bitcrush, drive, glitch bursts.
   Posts { type:'level', rms, gateOpen } every ~50ms. */
class TransmissionProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'gateThreshold', defaultValue: -50, minValue: -100, maxValue: -10, automationRate: 'k-rate' },
      { name: 'noiseLevel', defaultValue: 0, minValue: 0, maxValue: 0.3, automationRate: 'k-rate' },
      { name: 'crackle', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'drive', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'crushBits', defaultValue: 16, minValue: 3, maxValue: 16, automationRate: 'k-rate' },
      { name: 'downsample', defaultValue: 1, minValue: 1, maxValue: 8, automationRate: 'k-rate' },
      { name: 'gateOn', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.env = 0; this.gate = 0; this.held = 0; this.holdIdx = 0;
    this.pink = [0, 0, 0, 0, 0, 0, 0];
    this.lvlAcc = 0; this.lvlN = 0; this.lastPost = 0;
    this.glitchLeft = 0; this.glitchMode = 0; this.glitchGrain = new Float32Array(2048);
    this.glitchGLen = 0; this.glitchGPos = 0; this.gEnv = 0;
    this.crackleT = 0;
    this.port.onmessage = (e) => {
      try {
        const d = e.data;
        if (d && d.type === 'glitch') {
          const ms = Math.min(600, Math.max(40, Number(d.ms) || 180));
          this.glitchLeft = Math.round(ms * sampleRate / 1000);
          this.glitchMode = Math.floor(Math.random() * 3);
          this.glitchGLen = Math.min(2048, Math.round((10 + Math.random() * 40) * sampleRate / 1000));
          this.glitchGPos = 0; this.glitchGFill = 0;
        }
      } catch (_) { /* never kill audio thread */ }
    };
  }
  pinkNoise() {
    const w = Math.random() * 2 - 1; const p = this.pink;
    p[0] = 0.99886 * p[0] + w * 0.0555179; p[1] = 0.99332 * p[1] + w * 0.0750759;
    p[2] = 0.969 * p[2] + w * 0.153852; p[3] = 0.8665 * p[3] + w * 0.3104856;
    p[4] = 0.55 * p[4] + w * 0.5329522; p[5] = -0.7616 * p[5] - w * 0.016898;
    const out = p[0] + p[1] + p[2] + p[3] + p[4] + p[5] + p[6] + w * 0.5362;
    p[6] = w * 0.115926;
    return out * 0.11;
  }
  process(inputs, outputs, params) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    const inp = inputs[0] && inputs[0][0];
    const thr = Math.pow(10, params.gateThreshold[0] / 20);
    const gateOn = params.gateOn[0] > 0.5;
    const noise = params.noiseLevel[0], crackle = params.crackle[0], drive = params.drive[0];
    const bits = Math.round(params.crushBits[0]), ds = Math.max(1, Math.round(params.downsample[0]));
    const q = Math.pow(2, bits - 1);
    const atk = 1 - Math.exp(-1 / (0.005 * sampleRate));
    const rel = 1 - Math.exp(-1 / (0.12 * sampleRate));
    for (let i = 0; i < out.length; i++) {
      let x = inp ? inp[i] : 0;
      if (!Number.isFinite(x)) x = 0;
      const ax = Math.abs(x);
      this.env += (ax > this.env ? 0.02 : 0.0008) * (ax - this.env);
      const want = (!gateOn || this.env > thr) ? 1 : 0;
      this.gate += (want > this.gate ? atk : rel) * (want - this.gate);
      x *= this.gate;
      // glitch engine
      if (this.glitchLeft > 0) {
        this.gEnv = Math.min(1, this.gEnv + 0.01);
        if (this.glitchMode === 0) { // dropout
          x *= (1 - this.gEnv);
        } else if (this.glitchMode === 1) { // grain repeat
          if (this.glitchGFill < this.glitchGLen) { this.glitchGrain[this.glitchGFill++] = x; }
          else { x = x * (1 - this.gEnv) + this.gEnv * this.glitchGrain[this.glitchGPos]; this.glitchGPos = (this.glitchGPos + 1) % this.glitchGLen; }
        } else { // hard crush
          const qq = 4; x = x * (1 - this.gEnv) + this.gEnv * (Math.round(x * qq) / qq);
        }
        this.glitchLeft--;
      } else if (this.gEnv > 0) { this.gEnv = Math.max(0, this.gEnv - 0.01); }
      // bitcrush / downsample
      if (ds > 1) { if (this.holdIdx++ % ds === 0) this.held = x; x = this.held; }
      if (bits < 16) x = Math.round(x * q) / q;
      // drive
      if (drive > 0.001) { const g = 1 + drive * 6; x = Math.tanh(x * g) / Math.tanh(g) * (1 + drive * 0.4); }
      // noise bed + crackle
      if (noise > 0.0001) x += this.pinkNoise() * noise;
      if (crackle > 0.001) {
        if (this.crackleT <= 0 && Math.random() < 0.00012 * crackle * 10) this.crackleT = 30 + Math.random() * 200;
        if (this.crackleT > 0) { x += (Math.random() * 2 - 1) * 0.06 * crackle * Math.min(1, this.crackleT / 40); this.crackleT--; }
      }
      if (!Number.isFinite(x)) x = 0;
      out[i] = Math.max(-1.4, Math.min(1.4, x));
      this.lvlAcc += x * x; this.lvlN++;
    }
    const now = currentTime;
    if (now - this.lastPost > 0.05 && this.lvlN > 0) {
      this.port.postMessage({ type: 'level', rms: Math.sqrt(this.lvlAcc / this.lvlN), gateOpen: this.gate > 0.5 });
      this.lvlAcc = 0; this.lvlN = 0; this.lastPost = now;
    }
    return true;
  }
}
if (typeof registerProcessor === 'function') registerProcessor('transmission', TransmissionProcessor);
