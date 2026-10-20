// Original mappings informed by the public KSM effect specification and USC.
// Full references and the deliberate LPF/flanger adaptations are in project docs.
export const EFFECT_DEFAULTS = Object.freeze({ crush: 0.5, air: 0.5, filter: 0.5, gate: 0.5, repeat: 0.5, echo: 0.5 });
const WAVE_DENOMINATORS = [4, 8, 12, 16, 24, 32];
const clamp = (value, low, high) => Math.min(high, Math.max(low, Number(value) || 0));

export function getEffectConfig(id, value, { bpm = 120, sampleRate = 44100 } = {}) {
  const p = clamp(value, 0, 1);
  const tempo = clamp(bpm, 60, 220);
  const rate = Number.isFinite(Number(sampleRate)) ? Math.max(8000, Number(sampleRate) || 44100) : 44100;
  const waveDenominator = WAVE_DENOMINATORS[Math.min(5, Math.floor(p * 6))];
  switch (id) {
    case 'crush': {
      const reductionSamples = Math.round(p * 30);
      return { reductionSamples, holdSeconds: reductionSamples / 44100, effectiveRate: reductionSamples ? 44100 / reductionSamples : rate };
    }
    case 'air': {
      const minimum = 30 / 44100;
      const maximum = 75 / 44100;
      const delaySeconds = minimum + (maximum - minimum) * p;
      return { delaySeconds, depthSeconds: Math.max(0, Math.min(delaySeconds - minimum, maximum - delaySeconds)), lfoHz: tempo / 480, feedback: 0.6 };
    }
    case 'filter':
      return { frequencyHz: Math.min(rate * 0.4, 700 + 9300 * p * p * p), resonanceDb: 12 - 4 * p, outputGain: 0.72 };
    case 'gate':
      return { waveDenominator, periodBeats: 4 / waveDenominator, periodSeconds: 240 / (tempo * waveDenominator), duty: 0.5 };
    case 'repeat':
      return { waveDenominator, periodBeats: 4 / waveDenominator, periodSeconds: 240 / (tempo * waveDenominator), updateBeats: 2, duty: 0.7 };
    case 'echo':
      return { waveDenominator, periodBeats: 4 / waveDenominator, periodSeconds: 240 / (tempo * waveDenominator), feedback: 0.6 };
    default:
      throw new RangeError(`Unknown audio effect: ${id}`);
  }
}

export function formatEffectParameter(id, value, bpm = 120) {
  const config = getEffectConfig(id, value, { bpm });
  if (id === 'crush') return { value: String(config.reductionSamples), unit: 'smp', label: `サンプルホールド ${config.reductionSamples} サンプル（44.1kHz基準）` };
  if (id === 'air') return { value: (config.delaySeconds * 1000).toFixed(2), unit: 'ms', label: `フランジャーの遅延 ${(config.delaySeconds * 1000).toFixed(2)} ミリ秒` };
  if (id === 'filter') {
    const frequency = config.frequencyHz;
    return frequency >= 1000
      ? { value: (frequency / 1000).toFixed(1), unit: 'kHz', label: `ローパスのカットオフ ${Math.round(frequency)} ヘルツ` }
      : { value: String(Math.round(frequency)), unit: 'Hz', label: `ローパスのカットオフ ${Math.round(frequency)} ヘルツ` };
  }
  const note = config.waveDenominator === 12 ? '8分音符の3連符' : config.waveDenominator === 24 ? '16分音符の3連符' : `${config.waveDenominator}分音符`;
  return { value: `1/${config.waveDenominator}`, unit: 'NOTE', label: `${note}、${Math.round(config.periodSeconds * 1000)} ミリ秒` };
}
