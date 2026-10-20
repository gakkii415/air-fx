/**
 * Private, local Web Audio player.
 *
 * const audio = new AudioEngine();
 * await audio.init(); // Call from a user gesture to unlock browser audio.
 * const { duration, peaks } = await audio.load(arrayBufferOrURL);
 * audio.setEffect('crush', true); await audio.play();
 *
 * Transport: play() is async; pause(), stop(), and seek(seconds) are synchronous.
 * seek preserves the current playing/paused state. Effects can be combined.
 * Public state: currentTime, duration, isPlaying, context, analyser, onEnded.
 */
const EFFECTS = ['crush', 'air', 'filter', 'gate', 'repeat', 'echo'];
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

export class AudioEngine {
  constructor() {
    this.context = null;
    this.analyser = null;
    this.onEnded = null;
    this._buffer = null;
    this._source = null;
    this._offset = 0;
    this._startedAt = 0;
    this._playing = false;
    this._volume = 0.65;
    this._mix = 0.72;
    this._intensity = 0.5;
    this._bpm = 120;
    this._xy = { x: 0.5, y: 0.5 };
    this._effects = new Set();
    this._ready = null;
    this._transportVersion = 0;
    this._loadVersion = 0;
    this._workletError = null;
    this._ramps = new WeakMap();
  }

  async init() {
    if (!this.context) {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) throw new Error('このブラウザは Web Audio に対応していません。');
      this.context = new Context({ latencyHint: 'interactive' });
      // Request the unlock before awaiting module loading, while the gesture is active.
      this.context.resume().catch(() => {});
      this._ready = this._createGraph().catch((error) => {
        this._workletError = error.message || String(error);
        throw error;
      });
    } else if (this.context.state === 'suspended') {
      // Do not wait here: decoding a dropped file must also work before audio unlock.
      this.context.resume().catch(() => {});
    }
    await this._ready;
    return this;
  }

  async _createGraph() {
    const ctx = this.context;
    if (!ctx.audioWorklet) {
      throw new Error('音声エフェクトには HTTPS と AudioWorklet 対応ブラウザが必要です。');
    }
    await ctx.audioWorklet.addModule(new URL('./fx-processor.js', import.meta.url));

    this._input = ctx.createGain();
    this._dry = ctx.createGain();
    this._wet = ctx.createGain();
    this._sum = ctx.createGain();
    this._transport = ctx.createGain();
    this._master = ctx.createGain();
    this._transport.gain.value = 0;
    this._master.gain.value = this._volume;

    this._processor = new AudioWorkletNode(ctx, 'air-fx-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      processorOptions: { maxHistorySeconds: 2 },
    });
    this._processor.onprocessorerror = () => {
      this._workletError = 'AudioWorklet processor error';
      this.pause();
    };

    this._filter = ctx.createBiquadFilter();
    this._filter.type = 'lowpass';
    this._filterLFO = ctx.createOscillator();
    this._filterLFO.type = 'sine';
    this._filterDepth = ctx.createGain();
    this._filterLFO.connect(this._filterDepth).connect(this._filter.detune);

    // AIR: short modulated delay, filtered feedback, and an audible comb blend.
    this._airDelay = ctx.createDelay(0.08);
    this._airHighpass = ctx.createBiquadFilter();
    this._airHighpass.type = 'highpass';
    this._airHighpass.frequency.value = 480;
    this._airHighpass.Q.value = 0.6;
    this._airFeedback = ctx.createGain();
    this._airWet = ctx.createGain();
    this._airDirect = ctx.createGain();
    this._airSum = ctx.createGain();
    this._airLFO = ctx.createOscillator();
    this._airLFO.type = 'sine';
    this._airDepth = ctx.createGain();
    this._airLFO.connect(this._airDepth).connect(this._airDelay.delayTime);
    this._filter.connect(this._airDirect).connect(this._airSum);
    this._filter.connect(this._airDelay);
    this._airDelay.connect(this._airHighpass);
    this._airHighpass.connect(this._airWet).connect(this._airSum);
    this._airHighpass.connect(this._airFeedback).connect(this._airDelay);

    // ECHO: a tempo-synced eighth note delay with a darkening feedback path.
    this._echoDelay = ctx.createDelay(2.1);
    this._echoLowpass = ctx.createBiquadFilter();
    this._echoLowpass.type = 'lowpass';
    this._echoLowpass.frequency.value = 5200;
    this._echoLowpass.Q.value = 0.5;
    this._echoFeedback = ctx.createGain();
    this._echoWet = ctx.createGain();
    this._echoDirect = ctx.createGain();
    this._echoSum = ctx.createGain();
    this._airSum.connect(this._echoDirect).connect(this._echoSum);
    this._airSum.connect(this._echoDelay);
    this._echoDelay.connect(this._echoLowpass);
    this._echoLowpass.connect(this._echoWet).connect(this._echoSum);
    this._echoLowpass.connect(this._echoFeedback).connect(this._echoDelay);

    this._limiter = ctx.createDynamicsCompressor();
    this._limiter.threshold.value = -5;
    this._limiter.knee.value = 4;
    this._limiter.ratio.value = 20;
    this._limiter.attack.value = 0.002;
    this._limiter.release.value = 0.12;
    // Keep the output bounded, including the compressor's short attack transient.
    this._safety = ctx.createWaveShaper();
    const curve = new Float32Array(4097);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      const abs = Math.abs(x);
      curve[i] = abs <= 0.8 ? x : Math.sign(x) * (0.8 + 0.2 * Math.tanh((abs - 0.8) / 0.2));
    }
    this._safety.curve = curve;
    this._safety.oversample = '2x';
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.72;

    this._input.connect(this._dry).connect(this._sum);
    this._input.connect(this._processor).connect(this._filter);
    this._echoSum.connect(this._wet).connect(this._sum);
    this._sum.connect(this._transport).connect(this._master).connect(this._limiter);
    this._limiter.connect(this._safety).connect(this.analyser).connect(ctx.destination);
    this._filterLFO.start();
    this._airLFO.start();
    this._applySettings(true);
  }

  /** Decode locally. URL inputs are fetched; file bytes never leave the browser. */
  async load(input) {
    const version = ++this._loadVersion;
    await this.init();
    let bytes;
    if (typeof input === 'string' || input instanceof URL) {
      const response = await fetch(input);
      if (!response.ok) throw new Error(`音源を読み込めませんでした (${response.status})`);
      bytes = await response.arrayBuffer();
    } else if (input instanceof ArrayBuffer) {
      bytes = input.slice(0);
    } else if (ArrayBuffer.isView(input)) {
      bytes = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    } else if (input && typeof input.arrayBuffer === 'function') {
      bytes = await input.arrayBuffer();
    } else {
      throw new TypeError('音源の URL または ArrayBuffer を指定してください。');
    }
    let buffer;
    try {
      buffer = await this.context.decodeAudioData(bytes);
    } catch {
      throw new Error('この音源を読み込めませんでした。MP3・WAV・M4A・OGG をお試しください。');
    }
    if (!buffer.length || !Number.isFinite(buffer.duration)) {
      throw new Error('音源に再生できるデータがありません。');
    }
    const peaks = this._getPeaks(buffer);
    if (version !== this._loadVersion) return { duration: buffer.duration, peaks, stale: true };
    this.stop();
    this._buffer = buffer;
    return { duration: buffer.duration, peaks };
  }

  _getPeaks(buffer) {
    const peaks = new Float32Array(240);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    for (let i = 0; i < peaks.length; i++) {
      const start = Math.floor((i * buffer.length) / peaks.length);
      const end = Math.max(start + 1, Math.floor(((i + 1) * buffer.length) / peaks.length));
      let peak = 0;
      for (const data of channels) {
        for (let j = start; j < Math.min(end, data.length); j++) peak = Math.max(peak, Math.abs(data[j]));
      }
      peaks[i] = Math.min(1, peak);
    }
    return peaks;
  }

  async play() {
    const version = ++this._transportVersion;
    await this.init();
    if (this.context.state !== 'running') await this.context.resume();
    if (version !== this._transportVersion || this._playing) return;
    if (!this._buffer) throw new Error('先に音源を読み込んでください。');
    if (this._offset >= this.duration - 0.002) this._offset = 0;
    this._playing = true;
    this._startSource();
  }

  _startSource() {
    const ctx = this.context;
    const source = ctx.createBufferSource();
    const envelope = ctx.createGain();
    const record = { source, envelope };
    source.buffer = this._buffer;
    this._ramp(envelope.gain, 0, 0, true);
    this._ramp(envelope.gain, 1, 0.012);
    source.connect(envelope).connect(this._input);
    this._source = record;
    this._startedAt = ctx.currentTime;
    this._processor.port.postMessage({ type: 'reset' });
    this._applySettings();
    this._ramp(this._transport.gain, 1, 0.012);
    source.onended = () => {
      source.disconnect();
      envelope.disconnect();
      if (this._source !== record) return;
      this._source = null;
      if (!this._playing) return;
      this._playing = false;
      this._offset = this.duration;
      // Leave a short, bounded release for the final delay repeat.
      this._ramp(this._transport.gain, 0, 0.16);
      if (typeof this.onEnded === 'function') this.onEnded();
    };
    source.start(0, this._offset);
  }

  _releaseSource() {
    const record = this._source;
    this._source = null;
    if (!record) return;
    const now = this.context.currentTime;
    this._ramp(record.envelope.gain, 0, 0.012);
    try { record.source.stop(now + 0.015); } catch { /* already ended */ }
    // Its onended callback disconnects only this source, including rapid seeks.
  }

  pause() {
    ++this._transportVersion;
    if (!this._playing) return;
    this._offset = this.currentTime;
    this._playing = false;
    this._releaseSource();
    this._ramp(this._transport.gain, 0, 0.018);
  }

  stop() {
    ++this._transportVersion;
    this._playing = false;
    this._offset = 0;
    this._releaseSource();
    if (this._transport) this._ramp(this._transport.gain, 0, 0.018);
    this._processor?.port.postMessage({ type: 'reset' });
  }

  seek(seconds) {
    ++this._transportVersion;
    const wasPlaying = this._playing;
    this._offset = clamp(seconds, 0, this.duration);
    this._releaseSource();
    if (wasPlaying && this._offset < this.duration) {
      this._startSource();
    } else {
      this._playing = false;
      if (this._transport) this._ramp(this._transport.gain, 0, 0.015);
      this._processor?.port.postMessage({ type: 'reset' });
    }
    return this._offset;
  }

  get currentTime() {
    if (!this._playing || !this.context) return this._offset;
    return Math.min(this.duration, this._offset + Math.max(0, this.context.currentTime - this._startedAt));
  }
  get duration() { return this._buffer?.duration || 0; }
  get isPlaying() { return this._playing; }

  setVolume(value) {
    this._volume = clamp(value, 0, 1);
    if (this._master) this._ramp(this._master.gain, this._volume);
  }
  setMix(value) {
    this._mix = clamp(value, 0, 1);
    this._applySettings();
  }
  setIntensity(value) {
    this._intensity = clamp(value, 0, 1);
    this._applySettings();
  }
  setBpm(value) {
    this._bpm = clamp(value, 60, 220);
    this._applySettings();
  }
  setEffect(id, active) {
    if (!EFFECTS.includes(id)) throw new RangeError(`Unknown audio effect: ${id}`);
    if (active) this._effects.add(id);
    else this._effects.delete(id);
    this._applySettings();
  }
  setXY(x, y) {
    this._xy = { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
    this._applySettings();
  }

  _ramp(param, value, seconds = 0.025, immediate = false) {
    if (!param || !this.context || !Number.isFinite(value)) return;
    const now = this.context.currentTime;
    const previous = this._ramps.get(param);
    // Every effect change updates the graph. Leave unchanged automation alone.
    if (!immediate && previous?.to === value) return;
    if (immediate) {
      param.cancelScheduledValues(now);
      param.setValueAtTime(value, now);
      this._ramps.set(param, { from: value, to: value, start: now, end: now });
      return;
    }
    // Evaluate our own envelope: repeated cancelAndHoldAtTime calls in the same
    // render quantum can lose their start value in WebKit/Chromium automation.
    const progress = previous ? clamp((now - previous.start) / Math.max(0.000001, previous.end - previous.start), 0, 1) : 1;
    const held = previous ? previous.from + (previous.to - previous.from) * progress : param.value;
    const current = Number.isFinite(held) ? held : value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
    param.linearRampToValueAtTime(value, now + seconds);
    this._ramps.set(param, { from: current, to: value, start: now, end: now + seconds });
  }

  _applySettings(immediate = false) {
    if (!this._processor) return;
    const s = this._intensity;
    const active = (id) => this._effects.has(id);
    const ramp = (param, value, time = 0.03) => this._ramp(param, value, time, immediate);
    const hasEffects = this._effects.size > 0;
    // Linear blend remains at unity when the wet path is transparent.
    ramp(this._dry.gain, hasEffects ? 1 - this._mix : 1);
    ramp(this._wet.gain, hasEffects ? this._mix : 0);
    for (const id of ['crush', 'gate', 'repeat']) {
      ramp(this._processor.parameters.get(id), active(id) ? 1 : 0, 0.012);
    }
    ramp(this._processor.parameters.get('intensity'), s);
    ramp(this._processor.parameters.get('bpm'), this._bpm, 0.025);

    const nyquist = this.context.sampleRate * 0.46;
    const brightness = Math.pow(80, this._xy.x);
    const filterCutoff = Math.min(nyquist, 150 * brightness * (1.4 - s * 0.6));
    ramp(this._filter.frequency, active('filter') ? filterCutoff : nyquist);
    ramp(this._filter.Q, active('filter') ? 1.5 + s * 5.5 : 0.0001);
    ramp(this._filterDepth.gain, active('filter') ? 250 + this._xy.y * (450 + 750 * s) : 0);
    ramp(this._filterLFO.frequency, (this._bpm / 60) * (0.125 + this._xy.y * 0.125));

    ramp(this._airDelay.delayTime, 0.0045 + 0.004 * s, 0.06);
    ramp(this._airDepth.gain, active('air') ? 0.0014 + s * 0.0033 : 0, 0.06);
    ramp(this._airLFO.frequency, 0.12 + this._xy.y * 0.3 + s * 0.16);
    ramp(this._airWet.gain, active('air') ? 0.38 + s * 0.4 : 0);
    ramp(this._airFeedback.gain, active('air') ? 0.15 + s * 0.4 : 0);
    ramp(this._airDirect.gain, active('air') ? 0.86 : 1);

    ramp(this._echoDelay.delayTime, (60 / this._bpm) * 0.5, 0.09);
    ramp(this._echoFeedback.gain, active('echo') ? 0.15 + s * 0.45 : 0);
    ramp(this._echoWet.gain, active('echo') ? 0.28 + s * 0.4 : 0);
    ramp(this._echoDirect.gain, active('echo') ? 0.9 : 1);
    ramp(this._echoLowpass.frequency, 6200 - s * 3000);
  }

  getDiagnostics() {
    return {
      state: this.context?.state || 'uninitialized',
      sampleRate: this.context?.sampleRate || 0,
      duration: this.duration,
      currentTime: this.currentTime,
      isPlaying: this.isPlaying,
      effects: [...this._effects],
      volume: this._volume,
      mix: this._mix,
      intensity: this._intensity,
      bpm: this._bpm,
      workletReady: Boolean(this._processor),
      workletError: this._workletError,
      limiterReduction: this._limiter?.reduction || 0,
    };
  }

  /** Release the device when the application is removed. */
  async destroy() {
    this.stop();
    ++this._loadVersion;
    this._filterLFO?.stop();
    this._airLFO?.stop();
    this._processor?.port.close();
    if (this.context && this.context.state !== 'closed') await this.context.close();
  }
}

export default AudioEngine;
