/* AudioWorklet DSP: sample-and-hold bitcrush, rhythmic gate, captured-loop stutter. */
class AirFXProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'crush', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'gate', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'repeat', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'intensity', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'bpm', defaultValue: 120, minValue: 60, maxValue: 220, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super();
    const seconds = options?.processorOptions?.maxHistorySeconds || 2;
    this.historyLength = Math.ceil(sampleRate * Math.max(1, seconds));
    this.history = [new Float32Array(this.historyLength), new Float32Array(this.historyLength)];
    this.loop = [new Float32Array(this.historyLength), new Float32Array(this.historyLength)];
    this.held = new Float32Array(2);
    this.writeIndex = 0;
    this.historyCount = 0;
    this.loopLength = 0;
    this.loopPosition = 0;
    this.holdCounter = 0;
    this.phase = 0;
    this.crushBlend = 0;
    this.gateBlend = 0;
    this.repeatBlend = 0;
    this.repeatWasOn = false;
    this.capturePending = false;
    this.lastTargetLength = 0;
    this.stableTargetCount = 0;
    this.smoothing = 1 - Math.exp(-1 / (sampleRate * 0.005));
    this.port.onmessage = (event) => {
      if (event.data?.type !== 'reset') return;
      // No large buffer clearing on the real-time thread: counts guard old data.
      this.writeIndex = 0;
      this.historyCount = 0;
      this.loopLength = 0;
      this.loopPosition = 0;
      this.holdCounter = 0;
      this.phase = 0;
      this.repeatBlend = 0;
      this.repeatWasOn = false;
      this.capturePending = false;
      this.lastTargetLength = 0;
      this.stableTargetCount = 0;
      this.held.fill(0);
    };
  }

  capture(length) {
    if (this.historyCount < length) return false;
    const start = (this.writeIndex - length + this.historyLength) % this.historyLength;
    for (let channel = 0; channel < 2; channel++) {
      const history = this.history[channel];
      const loop = this.loop[channel];
      for (let i = 0; i < length; i++) loop[i] = history[(start + i) % this.historyLength];
    }
    this.loopLength = length;
    this.loopPosition = 0;
    this.capturePending = false;
    return true;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.length) return true;
    const frameCount = output[0].length;
    const strength = parameters.intensity[0];
    const bpm = parameters.bpm[0];
    const crushTarget = parameters.crush[0];
    const gateTarget = parameters.gate[0];
    const repeatOn = parameters.repeat[0] > 0.5;
    const bits = 12 - Math.floor(strength * 9);
    const quantization = Math.pow(2, bits - 1);
    const holdSamples = Math.max(1, Math.round(1 + strength * strength * 26));
    // At 120 BPM the middle setting captures a sixteenth note (125 ms).
    const subdivision = strength < 0.33 ? 0.5 : strength < 0.76 ? 0.25 : 0.125;
    const targetLength = Math.min(this.historyLength, Math.max(64, Math.round((60 / bpm) * subdivision * sampleRate)));
    this.stableTargetCount = targetLength === this.lastTargetLength ? this.stableTargetCount + 1 : 0;
    const lengthDifference = Math.abs(targetLength - this.loopLength);
    if (repeatOn && (!this.repeatWasOn || (this.loopLength && (lengthDifference > 32 || (this.stableTargetCount >= 3 && lengthDifference > 0))))) {
      this.capturePending = true;
    }
    if (!repeatOn) this.capturePending = false;
    this.repeatWasOn = repeatOn;
    this.lastTargetLength = targetLength;
    const gatePeriod = sampleRate * (60 / bpm) * 0.5;
    const gateDuty = 0.64 - strength * 0.3;
    const edge = Math.min(0.045, (sampleRate * 0.0035) / gatePeriod);
    const smooth = this.smoothing;

    for (let frame = 0; frame < frameCount; frame++) {
      this.crushBlend += (crushTarget - this.crushBlend) * smooth;
      this.gateBlend += (gateTarget - this.gateBlend) * smooth;
      // Fade to live before replacing a loop; BPM changes must not jump the waveform.
      if (this.capturePending && this.historyCount >= targetLength && this.repeatBlend < 0.003) this.capture(targetLength);
      const repeatTarget = repeatOn && this.loopLength && !this.capturePending ? parameters.repeat[0] : 0;
      this.repeatBlend += (repeatTarget - this.repeatBlend) * smooth;

      const gatePhase = this.phase / gatePeriod;
      let gate = 0.012;
      if (gatePhase < gateDuty) {
        const attack = Math.min(1, gatePhase / edge);
        const release = Math.min(1, (gateDuty - gatePhase) / edge);
        const envelope = Math.min(attack, release);
        gate = 0.012 + 0.988 * (0.5 - 0.5 * Math.cos(Math.PI * envelope));
      }
      const gateGain = 1 + (gate - 1) * this.gateBlend;

      let loopWindow = 1;
      if (this.loopLength) {
        const fadeSamples = Math.min(Math.floor(this.loopLength / 12), Math.round(sampleRate * 0.0025));
        const distance = Math.min(this.loopPosition, this.loopLength - 1 - this.loopPosition);
        if (distance < fadeSamples) loopWindow = 0.5 - 0.5 * Math.cos(Math.PI * distance / fadeSamples);
      }

      const updateHold = this.holdCounter <= 0;
      for (let channel = 0; channel < output.length; channel++) {
        const slot = Math.min(channel, 1);
        const source = input[channel] || input[0];
        const original = source ? source[frame] : 0;
        // Capture unprocessed input so other effects remain live during a frozen repeat.
        this.history[slot][this.writeIndex] = original;
        const captured = this.loopLength ? this.loop[slot][this.loopPosition] * loopWindow : original;
        const selected = original + (captured - original) * this.repeatBlend;
        if (updateHold) this.held[slot] = Math.round(selected * quantization) / quantization;
        const crushed = selected + (this.held[slot] - selected) * this.crushBlend;
        output[channel][frame] = crushed * gateGain;
      }
      // A mono output still keeps a valid right channel history for later stereo use.
      if (output.length === 1) this.history[1][this.writeIndex] = this.history[0][this.writeIndex];
      if (updateHold) this.holdCounter = holdSamples;
      --this.holdCounter;
      this.writeIndex = (this.writeIndex + 1) % this.historyLength;
      this.historyCount = Math.min(this.historyLength, this.historyCount + 1);
      if (this.loopLength) this.loopPosition = (this.loopPosition + 1) % this.loopLength;
      this.phase = (this.phase + 1) % gatePeriod;
    }
    return true;
  }
}

registerProcessor('air-fx-processor', AirFXProcessor);
