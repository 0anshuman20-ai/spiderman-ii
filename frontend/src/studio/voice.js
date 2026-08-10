/* VEYL voice engine: mic -> gate -> [core pitch | sub octave | comms band] -> fx -> reverb -> comp -> limiter */

export const VOICE_PRESETS = {
  'veyl-core': { pitch: -3, sub: 0.3, reverb: 0.18, static: 0.015, drive: 0.2, label: 'VEYL CORE' },
  'deep-oracle': { pitch: -5, sub: 0.42, reverb: 0.3, static: 0.008, drive: 0.12, label: 'DEEP ORACLE' },
  'ghost-signal': { pitch: -3.5, sub: 0.2, reverb: 0.34, static: 0.06, drive: 0.5, label: 'GHOST SIGNAL' },
  'comms-only': { pitch: -2, sub: 0.1, reverb: 0.06, static: 0.03, drive: 0.35, label: 'COMMS ONLY' },
  // definitive creator voice: barely-shifted, zero grit, whisper of room + sub weight —
  // the polished "voiceover booth" sound for narration takes that must carry a channel
  'creator-broadcast': { pitch: -1, sub: 0.14, reverb: 0.07, static: 0, drive: 0.05, label: 'CREATOR BROADCAST' },
  clean: { pitch: 0, sub: 0, reverb: 0, static: 0, drive: 0, label: 'CLEAN MIC' },
};

function makeImpulse(ctx, seconds = 3.4, decay = 2.6) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const n = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      const a = 0.15 + 0.8 * t; // progressively darker tail
      lp += a * 0.4 * (n - lp);
      d[i] = lp * 2.2;
    }
    for (let k = 0; k < 5; k++) { // sparse early reflections
      const p = Math.floor(ctx.sampleRate * (0.008 + Math.random() * 0.035));
      if (p < len) d[p] += (Math.random() * 0.5 + 0.3) * (ch ? -1 : 1);
    }
  }
  return buf;
}

export class VoiceEngine {
  constructor({ onLevel, onStatus } = {}) {
    this.onLevel = onLevel; this.onStatus = onStatus;
    this.ready = false; this.params = { ...VOICE_PRESETS['veyl-core'] };
    this.preset = 'veyl-core';
    this.level = { rms: 0, gateOpen: false };
  }

  async init() {
    if (this.ready) return true;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000, latencyHint: 'interactive' });
      this.ctx = ctx;
      await ctx.audioWorklet.addModule('/worklets/pitch-shift-processor.js');
      await ctx.audioWorklet.addModule('/worklets/transmission-processor.js');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      this.micStream = stream;
      const src = ctx.createMediaStreamSource(stream);

      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 85; hp.Q.value = 0.7;
      this.gateNode = new AudioWorkletNode(ctx, 'transmission');
      this.gateNode.parameters.get('gateThreshold').value = -48;
      this.gateNode.port.onmessage = (e) => {
        if (e.data && e.data.type === 'level') {
          this.level = e.data;
          if (this.onLevel) this.onLevel(e.data);
        }
      };

      // core voice
      this.corePitch = new AudioWorkletNode(ctx, 'pitch-shift');
      const presence = ctx.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 2600; presence.Q.value = 1.1; presence.gain.value = 3;
      const weight = ctx.createBiquadFilter(); weight.type = 'lowshelf'; weight.frequency.value = 140; weight.gain.value = 2;
      const demud = ctx.createBiquadFilter(); demud.type = 'peaking'; demud.frequency.value = 400; demud.Q.value = 1; demud.gain.value = -3;
      // air shelf: pitching down dulls the top octave — restore broadcast sparkle.
      // applied on the core layer only so it never amplifies the static/noise bed.
      const air = ctx.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 10500; air.gain.value = 2.5;
      this.coreGain = ctx.createGain(); this.coreGain.gain.value = 1;

      // sub octave layer
      this.subPitch = new AudioWorkletNode(ctx, 'pitch-shift');
      const subLp = ctx.createBiquadFilter(); subLp.type = 'lowpass'; subLp.frequency.value = 900;
      this.subGain = ctx.createGain(); this.subGain.gain.value = 0.3;

      // comms band layer
      const bHp = ctx.createBiquadFilter(); bHp.type = 'highpass'; bHp.frequency.value = 300; bHp.Q.value = 0.7;
      const bLp = ctx.createBiquadFilter(); bLp.type = 'lowpass'; bLp.frequency.value = 3400; bLp.Q.value = 0.7;
      this.commsGain = ctx.createGain(); this.commsGain.gain.value = 0.16;

      this.fxNode = new AudioWorkletNode(ctx, 'transmission');
      this.fxNode.parameters.get('gateOn').value = 0;

      const sum = ctx.createGain();
      this.convolver = ctx.createConvolver(); this.convolver.buffer = makeImpulse(ctx);
      this.wet = ctx.createGain(); this.wet.gain.value = 0.18;
      this.dry = ctx.createGain(); this.dry.gain.value = 1;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.knee.value = 6; comp.ratio.value = 3; comp.attack.value = 0.006; comp.release.value = 0.18;
      // makeup gain: recover the level the compressor takes away so takes land at
      // competitive loudness for platform audio; the limiter still owns the ceiling.
      const makeup = ctx.createGain(); makeup.gain.value = 1.35; // +2.6 dB
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.06;
      this.outGain = ctx.createGain(); this.outGain.gain.value = 1;
      this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 1024;
      this.dest = ctx.createMediaStreamDestination();
      this.monitorGain = ctx.createGain(); this.monitorGain.gain.value = 0;

      src.connect(hp); hp.connect(this.gateNode);
      this.gateNode.connect(this.corePitch); this.corePitch.connect(presence); presence.connect(weight); weight.connect(demud); demud.connect(air); air.connect(this.coreGain); this.coreGain.connect(sum);
      this.gateNode.connect(this.subPitch); this.subPitch.connect(subLp); subLp.connect(this.subGain); this.subGain.connect(sum);
      this.gateNode.connect(bHp); bHp.connect(bLp); bLp.connect(this.commsGain); this.commsGain.connect(sum);
      sum.connect(this.fxNode);
      this.fxNode.connect(this.dry); this.dry.connect(comp);
      this.fxNode.connect(this.convolver); this.convolver.connect(this.wet); this.wet.connect(comp);
      comp.connect(makeup); makeup.connect(limiter); limiter.connect(this.outGain);
      this.outGain.connect(this.analyser); this.outGain.connect(this.dest); this.outGain.connect(this.monitorGain);
      this.monitorGain.connect(ctx.destination);

      this._levelBuf = new Uint8Array(this.analyser.fftSize);
      this.ready = true;
      this.setPreset(this.preset);
      if (this.onStatus) this.onStatus({ level: 'ok', message: 'voice engine online' });
      return true;
    } catch (err) {
      if (this.onStatus) this.onStatus({ level: 'error', message: `mic unavailable: ${err.message}` });
      this.ready = false;
      return false;
    }
  }

  outputLevel() {
    if (!this.ready) return 0;
    this.analyser.getByteTimeDomainData(this._levelBuf);
    let s = 0;
    for (let i = 0; i < this._levelBuf.length; i += 4) { const v = (this._levelBuf[i] - 128) / 128; s += v * v; }
    return Math.min(1, Math.sqrt(s / (this._levelBuf.length / 4)) * 3);
  }

  get stream() { return this.ready ? this.dest.stream : null; }

  _ramp(param, v) { try { param.setTargetAtTime(v, this.ctx.currentTime, 0.02); } catch (_) {} }

  setParam(name, value) {
    this.params[name] = value;
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'pitch': try { this.corePitch.parameters.get('semitones').setValueAtTime(value, t); this.subPitch.parameters.get('semitones').setValueAtTime(value - 12, t); } catch (_) {} break;
      case 'sub': this._ramp(this.subGain.gain, value); break;
      case 'reverb': this._ramp(this.wet.gain, value); this._ramp(this.dry.gain, 1 - value * 0.35); break;
      case 'static': try { this.fxNode.parameters.get('noiseLevel').setValueAtTime(value, t); this.fxNode.parameters.get('crackle').setValueAtTime(Math.min(1, value * 12), t); } catch (_) {} break;
      case 'drive': try { this.fxNode.parameters.get('drive').setValueAtTime(value, t); this.fxNode.parameters.get('crushBits').setValueAtTime(value > 0.4 ? 10 : 16, t); this.fxNode.parameters.get('downsample').setValueAtTime(value > 0.45 ? 2 : 1, t); } catch (_) {} break;
      case 'gate': try { this.gateNode.parameters.get('gateThreshold').setValueAtTime(value, t); } catch (_) {} break;
      default: break;
    }
  }

  setPreset(name) {
    const p = VOICE_PRESETS[name]; if (!p) return;
    this.preset = name;
    ['pitch', 'sub', 'reverb', 'static', 'drive'].forEach((k) => this.setParam(k, p[k]));
  }

  triggerGlitch(ms = 200) {
    if (this.ready) { try { this.fxNode.port.postMessage({ type: 'glitch', ms }); } catch (_) {} }
  }

  setMonitor(on) { if (this.ready) this._ramp(this.monitorGain.gain, on ? 0.9 : 0); }
  async resume() { if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume(); }
  dispose() {
    try { if (this.micStream) this.micStream.getTracks().forEach((tr) => tr.stop()); if (this.ctx) this.ctx.close(); } catch (_) {}
    this.ready = false;
  }
}
