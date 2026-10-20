/* Original DSP informed by the public KSM effect definitions; no third-party code. */
class AirFXProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      ...['crush', 'air', 'gate', 'repeat', 'echo'].map((name) => ({ name, defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' })),
      { name: 'intensity', defaultValue: 1, minValue: 1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'crushReduction', defaultValue: 15, minValue: 0, maxValue: 30, automationRate: 'k-rate' },
      { name: 'airDelaySeconds', defaultValue: 52.5 / 44100, minValue: 0.0001, maxValue: 0.01, automationRate: 'k-rate' },
      { name: 'airDepthSeconds', defaultValue: 22.5 / 44100, minValue: 0, maxValue: 0.01, automationRate: 'k-rate' },
      { name: 'airLfoHz', defaultValue: 0.25, minValue: 0.01, maxValue: 2, automationRate: 'k-rate' },
      { name: 'airFeedback', defaultValue: 0.6, minValue: 0, maxValue: 0.8, automationRate: 'k-rate' },
      ...['gateWavelength', 'repeatWavelength', 'echoWavelength'].map((name) => ({ name, defaultValue: 16, minValue: 4, maxValue: 32, automationRate: 'k-rate' })),
      { name: 'bpm', defaultValue: 120, minValue: 60, maxValue: 220, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.capacity = Math.ceil(sampleRate * 2);
    this.retrigger = this.makeSlice();
    this.echo = this.makeSlice();
    this.held = new Float32Array(2);
    this.holdCounter = 0;
    this.crushBlend = 0;
    this.airBlend = 0;
    this.airCapacity = Math.ceil(sampleRate * 0.025) + 2;
    this.airBuffer = [new Float32Array(this.airCapacity), new Float32Array(this.airCapacity)];
    this.airWrite = 0;
    this.gateBlend = 0;
    this.gateEnvelope = 1;
    this.anchorFrame = 0;
    this.offsetSamples = 0;
    this.renderedFrames = 0;
    this.smoothing = 1 - Math.exp(-1 / (sampleRate * 0.005));
    this.gateSmoothing = 1 - Math.exp(-1 / (sampleRate * 0.0006));
    this.port.onmessage = ({ data }) => {
      if (data?.type !== 'reset') return;
      this.anchorFrame = Math.round((Number(data.contextTime) || 0) * sampleRate);
      this.offsetSamples = Math.max(0, Math.round((Number(data.offsetSeconds) || 0) * sampleRate));
      this.resetSlice(this.retrigger);
      this.resetSlice(this.echo);
      this.holdCounter = 0;
      this.held.fill(0);
      this.gateEnvelope = 1;
      this.airWrite = 0;
      this.airBuffer[0].fill(0);
      this.airBuffer[1].fill(0);
    };
  }

  makeSlice() {
    return {
      buffer: [new Float32Array(this.capacity), new Float32Array(this.capacity)],
      last: new Float32Array(2), from: new Float32Array(2),
      active: false, pending: false, blend: 0, length: 0, requestedLength: 0,
      position: 0, captured: 0, age: 0, iteration: 0, transition: 0,
    };
  }

  resetSlice(state) {
    state.active = false;
    state.pending = false;
    state.blend = 0;
    state.length = 0;
    state.requestedLength = 0;
    state.position = 0;
    state.captured = 0;
    state.age = 0;
    state.iteration = 0;
    state.transition = 0;
    state.last.fill(0);
  }

  beginSlice(state, length) {
    // Capture the new audio forwards, one sample at a time; never copy history.
    state.from.set(state.last);
    state.transition = Math.max(16, Math.round(sampleRate * 0.0015));
    state.length = length;
    state.position = 0;
    state.captured = 0;
    state.age = 0;
    state.iteration = 0;
    state.pending = false;
  }

  prepareSlice(state, active, length) {
    if (active && (!state.active || state.length !== length)) {
      state.requestedLength = length;
      state.pending = true;
    }
    if (!active) state.pending = false;
    state.active = active;
    if (!active && state.blend < 0.00001) {
      state.length = 0;
      state.captured = 0;
      state.transition = 0;
      state.last.fill(0);
      state.from.fill(0);
    }
  }

  blendSlice(state) {
    if (state.pending && state.blend < 0.003) this.beginSlice(state, state.requestedLength);
    const target = state.active && !state.pending ? 1 : 0;
    state.blend += (target - state.blend) * this.smoothing;
  }

  sliceWindow(position, length, duty) {
    const end = length * duty;
    if (position >= end) return 0;
    const edge = Math.min(length * 0.04, sampleRate * 0.0015);
    const distance = Math.min(position, end - position);
    return distance >= edge ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, distance) / edge);
  }

  sliceSample(state, input, channel, duty, fading) {
    if (!state.length) return input;
    if (state.active && state.captured < state.length) state.buffer[channel][state.position] = input;
    const captured = state.position < state.captured || state.captured >= state.length
      ? state.buffer[channel][state.position]
      : state.active ? input : 0;
    const gain = fading ? Math.pow(0.6, state.iteration) : 1;
    let value = captured * gain * this.sliceWindow(state.position, state.length, duty);
    if (state.transition > 0) {
      const total = Math.max(16, Math.round(sampleRate * 0.0015));
      const blend = 1 - state.transition / total;
      value = state.from[channel] + (value - state.from[channel]) * blend;
    }
    state.last[channel] = value;
    return input + (value - input) * state.blend;
  }

  advanceSlice(state, updateSamples) {
    if (!state.length) return;
    if (state.active && state.captured < state.length) ++state.captured;
    ++state.position;
    ++state.age;
    if (state.position >= state.length) { state.position = 0; ++state.iteration; }
    if (state.transition > 0) --state.transition;
    if (state.active && !state.pending && updateSamples && state.age >= updateSamples) this.beginSlice(state, state.length);
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.length) return true;
    const read = (name, fallback, low, high) => {
      const value = parameters[name]?.[0];
      return Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;
    };
    const bpm = read('bpm', 120, 60, 220);
    const samplesPerBeat = sampleRate * 60 / bpm;
    const crushTarget = read('crush', 0, 0, 1);
    const airTarget = read('air', 0, 0, 1);
    const airDelay = read('airDelaySeconds', 52.5 / 44100, 0.0001, 0.01);
    const airDepth = read('airDepthSeconds', 22.5 / 44100, 0, 0.01);
    const airLfo = read('airLfoHz', bpm / 480, 0.01, 2);
    const airFeedback = read('airFeedback', 0.6, 0, 0.8);
    const gateTarget = read('gate', 0, 0, 1);
    const holdSamples = Math.max(1, read('crushReduction', 15, 0, 30) * sampleRate / 44100);
    const gateWavelength = read('gateWavelength', 16, 4, 32);
    const gatePeriod = samplesPerBeat * 4 / gateWavelength;
    const repeatLength = Math.min(this.capacity, Math.max(64, Math.round(samplesPerBeat * 4 / read('repeatWavelength', 16, 4, 32))));
    const echoLength = Math.min(this.capacity, Math.max(64, Math.round(samplesPerBeat * 4 / read('echoWavelength', 16, 4, 32))));
    this.prepareSlice(this.retrigger, read('repeat', 0, 0, 1) > 0.5, repeatLength);
    this.prepareSlice(this.echo, read('echo', 0, 0, 1) > 0.5, echoLength);
    const repeatUpdate = Math.round(samplesPerBeat * 2);
    const blockFrame = typeof currentFrame === 'number' ? currentFrame : this.renderedFrames;
    const frameCount = output[0].length;

    for (let frame = 0; frame < frameCount; frame++) {
      this.crushBlend += (crushTarget - this.crushBlend) * this.smoothing;
      this.airBlend += (airTarget - this.airBlend) * this.smoothing;
      this.gateBlend += (gateTarget - this.gateBlend) * this.smoothing;
      this.blendSlice(this.retrigger);
      this.blendSlice(this.echo);
      const songSample = Math.max(0, this.offsetSamples + blockFrame + frame - this.anchorFrame);
      const airDelaySamples = Math.min(this.airCapacity - 2, Math.max(1, (airDelay + airDepth * Math.sin(2 * Math.PI * songSample / sampleRate * airLfo)) * sampleRate));
      const airRead = (this.airWrite - airDelaySamples + this.airCapacity) % this.airCapacity;
      const airIndex = Math.floor(airRead);
      const airFraction = airRead - airIndex;
      // Derive phase from the song position, including fractional seeks. The
      // permitted 4/8/12/16/24/32 divisions all meet again at a measure boundary.
      const gatePhase = (songSample % gatePeriod) / gatePeriod;
      const edge = Math.min(0.04, sampleRate * 0.0015 / gatePeriod);
      let gate = 0;
      if (gatePhase < 0.5) {
        const distance = Math.min(gatePhase, 0.5 - gatePhase);
        gate = distance >= edge ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, distance) / edge);
      }
      this.gateEnvelope += (gate - this.gateEnvelope) * this.gateSmoothing;
      const gateGain = 1 + (this.gateEnvelope - 1) * this.gateBlend;
      const updateHold = this.holdCounter <= 0;
      for (let channel = 0; channel < output.length; channel++) {
        const slot = Math.min(channel, 1);
        const source = input[channel] || input[0];
        const incoming = source ? source[frame] : 0;
        const original = Number.isFinite(incoming) ? incoming : 0;
        const retriggered = this.sliceSample(this.retrigger, original, slot, 0.7, false);
        const echoed = this.sliceSample(this.echo, retriggered, slot, 1, true);
        if (updateHold) this.held[slot] = echoed;
        const crushed = echoed + (this.held[slot] - echoed) * this.crushBlend;
        const gated = crushed * gateGain;
        const delay = this.airBuffer[slot];
        const delayed = delay[airIndex] + (delay[(airIndex + 1) % this.airCapacity] - delay[airIndex]) * airFraction;
        delay[this.airWrite] = gated + delayed * airFeedback * this.airBlend;
        const flanged = gated * 0.5 + delayed * 0.5;
        output[channel][frame] = gated + (flanged - gated) * this.airBlend;
      }
      if (updateHold) this.holdCounter += holdSamples;
      --this.holdCounter;
      this.airWrite = (this.airWrite + 1) % this.airCapacity;
      this.advanceSlice(this.retrigger, repeatUpdate);
      this.advanceSlice(this.echo, 0);
    }
    this.renderedFrames += frameCount;
    return true;
  }
}
registerProcessor('air-fx-processor', AirFXProcessor);
