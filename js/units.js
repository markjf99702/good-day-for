// Unit conversions. Everything is stored metric; US units are for show and input.

export const fromF = f => (f - 32) / 1.8;
export const fromDF = f => f / 1.8;
export const fromMph = m => m * 1.609344;
export const fromIn = i => i * 25.4;

// Per kind of value: metric → display number, display number → metric, and step for inputs.
const KINDS = {
  temp: { us: [c => c * 1.8 + 32, f => (f - 32) / 1.8, '°F', 1], metric: [c => c, c => c, '°C', 1] },
  tempDelta: { us: [c => c * 1.8, f => f / 1.8, '°F', 1], metric: [c => c, c => c, '°C', 1] },
  wind: { us: [k => k / 1.609344, m => m * 1.609344, 'mph', 1], metric: [k => k, k => k, 'km/h', 1] },
  rain: { us: [mm => mm / 25.4, i => i * 25.4, 'in', 0.05], metric: [mm => mm, mm => mm, 'mm', 1] },
  pct: { us: [x => x, x => x, '%', 5], metric: [x => x, x => x, '%', 5] },
  kpa: { us: [x => x, x => x, 'kPa', 0.1], metric: [x => x, x => x, 'kPa', 0.1] },
};

export function unitFor(kind, units) {
  const [to, from, label, step] = KINDS[kind][units === 'metric' ? 'metric' : 'us'];
  const round = step >= 1 ? v => Math.round(v) : v => Math.round(v * 100) / 100;
  return { to: v => round(to(v)), from, label, step };
}

export function guessUnits(lang = globalThis.navigator?.language || 'en-US') {
  return /-(US|LR|MM)$/i.test(lang) || lang === 'en' ? 'us' : 'metric';
}
