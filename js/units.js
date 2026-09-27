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

// Measurements for "How much to buy", also stored metric: lengths in metres,
// short lengths (depths, hole sizes) in centimetres, areas in square metres.
const MEASURES = {
  len: { us: [m => m / 0.3048, ft => ft * 0.3048, 'ft'], metric: [m => m, m => m, 'm'] },
  small: { us: [cm => cm / 2.54, i => i * 2.54, 'in'], metric: [cm => cm, cm => cm, 'cm'] },
  area: { us: [m2 => m2 / 0.09290304, f => f * 0.09290304, 'sq ft'], metric: [m2 => m2, m2 => m2, 'm²'] },
  count: { us: [x => x, x => x, ''], metric: [x => x, x => x, ''] },
};

export function measureFor(kind, units) {
  const [to, from, label] = MEASURES[kind][units === 'metric' ? 'metric' : 'us'];
  return { to, from, label };
}

export function guessUnits(lang = globalThis.navigator?.language || 'en-US') {
  return /-(US|LR|MM)$/i.test(lang) || lang === 'en' ? 'us' : 'metric';
}
