// How much to buy. For the materials behind the jobs: what to measure, the
// typical figures off the label (every one editable), and the arithmetic from
// measurements to the cans and bags a store actually sells.
//
// Pure functions; nothing here knows about the page. Numbers come in the
// chosen unit system:
//   us      feet, inches, square feet, gallons, cubic feet, pounds
//   metric  metres, centimetres, square metres, litres, kilograms
// The page stores measurements metric (like everything else in the app) and
// converts them on the way in. Figures, container sizes and prices are kept
// per unit system instead, because a gallon can and a 2.5 L tin are different
// things on the shelf. A price of null means "not usually sold": the size is
// listed, but left out until you give it a price.

import { measureFor } from './units.js';

export const SYS = {
  us: { len: 'ft', small: 'in', area: 'sq ft', vol: 'cu ft', bulk: 'cu yd', liq: 'gal', liqName: 'gallon', wt: 'lb', perBulk: 27 },
  metric: { len: 'm', small: 'cm', area: 'm²', vol: 'L', bulk: 'm³', liq: 'L', liqName: 'L', wt: 'kg', perBulk: 1000 },
};
const sysOf = units => (units === 'metric' ? 'metric' : 'us');
const byUnits = (units, us, metric) => (sysOf(units) === 'metric' ? metric : us);

// ——— Geometry and arithmetic (all exported for the tests) ———

export const rectArea = (l, w) => (l || 0) * (w || 0);
export const circleArea = d => Math.PI * ((d || 0) / 2) ** 2;

export function areaOf(m) {
  if (m.shape === 'circle') return circleArea(m.d);
  if (m.shape === 'area') return m.a || 0;
  return rectArea(m.l, m.w);
}

// Four walls of a room (times how many rooms that size), less doors and
// windows, plus the ceiling if it's getting the same paint.
export function roomArea({ rl, rw, rh, rooms = 1, doors = 0, windows = 0, ceiling = false }, { door, window }) {
  const n = rooms || 0;
  const walls = 2 * ((rl || 0) + (rw || 0)) * (rh || 0) * n;
  const openings = (doors || 0) * door + (windows || 0) * window;
  const top = ceiling ? rectArea(rl, rw) * n : 0;
  return { walls, openings, ceiling: top, net: Math.max(0, walls - openings) + top };
}

// The outside of a house: the distance around times the wall height, plus a
// triangle for each gable end, less doors, windows and garage doors.
export function houseArea({ mode = 'walls', perim, h, gables = 0, gw, gr, a, xdoors = 0, xwindows = 0, garages = 0 }, { door, window, garage }) {
  const walls = mode === 'area' ? a || 0 : (perim || 0) * (h || 0);
  const gable = mode === 'area' ? 0 : (gables || 0) * (gw || 0) * (gr || 0) / 2;
  const openings = (xdoors || 0) * door + (xwindows || 0) * window + (garages || 0) * garage;
  return { walls, gables: gable, openings, net: Math.max(0, walls + gable - openings) };
}

// Everything that takes deck or fence stain.
export function woodArea({ dl, dw, rail, steps, sw, fl, fh, sides = '2' }, { railPer, stepDepth }) {
  const deck = rectArea(dl, dw);
  const rails = (rail || 0) * railPer;
  const stairs = (steps || 0) * (sw || 0) * stepDepth;
  const fence = (fl || 0) * (fh || 0) * (+sides || 1);
  return { deck, rails, stairs, fence, total: deck + rails + stairs + fence };
}

// Area × depth, in the unit bags are sold in: cubic feet (depth in inches) or
// litres (depth in centimetres).
export function volumeOf(area, depth, units) {
  return byUnits(units, area * (depth || 0) / 12, area * (depth || 0) * 10);
}

// Concrete for round post holes: the hole less the post standing in it.
// Hole width, depth and post width in inches (cu ft out) or cm (litres out).
export function postVolume({ holes = 0, hd, hdep, post = 0 }, units) {
  const each = (Math.PI * ((hd || 0) / 2) ** 2 - (post || 0) ** 2) * (hdep || 0);
  return (holes || 0) * Math.max(0, each) / byUnits(units, 1728, 1000);
}

export const coatsNeed = (area, coats, coverage) => (coverage > 0 ? area * coats / coverage : 0);
export const withExtra = (x, pct) => x * (1 + (pct || 0) / 100);

// Loose material and ready-mix are sold in steps (half a yard, say).
export const roundUp = (x, step) => (x > 0 ? Math.ceil(x / step - 1e-9) * step : 0);

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// The cheapest mix of containers that holds at least `need`. Ties go to the
// one with less left over, then to fewer containers. A size with no price
// isn't for sale here; if nothing has a price, it just keeps the leftover small.
//   packs: [{ id, size, price }]  →  { items: [{ pack, n }], amount, cost, left }
export function bestPacks(need, packs) {
  const forSale = packs.filter(p => p.size > 0 && typeof p.price === 'number' && p.price >= 0);
  const noPrices = !forSale.length;
  const use = noPrices ? packs.filter(p => p.size > 0) : forSale;
  if (!(need > 0) || !use.length) return { items: [], amount: 0, cost: noPrices ? null : 0, left: 0 };

  // Work in whole units: thousandths of the smallest step every size is a multiple of.
  let units = use.map(p => Math.max(1, Math.round(p.size * 1000)));
  const g = units.reduce(gcd);
  units = units.map(u => u / g);
  const cents = use.map(p => (noPrices ? 0 : Math.round(p.price * 100)));
  let N = Math.ceil(need * 1000 / g - 1e-6);
  const fixed = new Array(use.length).fill(0);
  // A huge order: fill most of it with the best-value size, then solve the rest exactly.
  const LIMIT = 100000;
  if (N > LIMIT) {
    let best = 0;
    use.forEach((p, i) => {
      const a = cents[i] / units[i], b = cents[best] / units[best];
      if (a < b || (a === b && units[i] > units[best])) best = i;
    });
    const k = Math.floor((N - LIMIT / 2) / units[best]);
    fixed[best] = k;
    N -= k * units[best];
  }
  const top = N + Math.max(...units);
  const cost = new Float64Array(top + 1).fill(Infinity);
  const count = new Int32Array(top + 1);
  const from = new Int8Array(top + 1).fill(-1);
  cost[0] = 0;
  for (let v = 1; v <= top; v++) {
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u > v || cost[v - u] === Infinity) continue;
      const c = cost[v - u] + cents[i], k = count[v - u] + 1;
      if (c < cost[v] || (c === cost[v] && k < count[v])) { cost[v] = c; count[v] = k; from[v] = i; }
    }
  }
  let at = -1;
  for (let v = N; v <= top; v++) {
    if (cost[v] === Infinity) continue;
    if (at < 0 || cost[v] < cost[at]) at = v; // on a tie, the smaller amount (less left over) wins
  }
  const n = [...fixed];
  for (let v = at; v > 0; v -= units[from[v]]) n[from[v]]++;
  const items = use.map((pack, i) => ({ pack, n: n[i] })).filter(x => x.n > 0).sort((a, b) => b.pack.size - a.pack.size);
  const amount = items.reduce((s, x) => s + x.n * x.pack.size, 0);
  const total = items.reduce((s, x) => s + x.n * (noPrices ? 0 : x.pack.price), 0);
  return { items, amount, cost: noPrices ? null : Math.round(total * 100) / 100, left: Math.max(0, amount - need) };
}

// ——— Words and numbers ———

export function numFmt(locale = 'en-US') {
  const cache = new Map();
  return (x, digits = 2) => {
    if (!cache.has(digits)) {
      try { cache.set(digits, new Intl.NumberFormat(locale, { maximumFractionDigits: digits })); } catch { cache.set(digits, new Intl.NumberFormat('en-US', { maximumFractionDigits: digits })); }
    }
    return cache.get(digits).format(x);
  };
}

// The currency for a locale's region, for showing prices. Unknown regions get
// a plain number rather than a guess.
const CURRENCY = {
  US: 'USD', CA: 'CAD', GB: 'GBP', AU: 'AUD', NZ: 'NZD', IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR',
  BE: 'EUR', AT: 'EUR', PT: 'EUR', FI: 'EUR', GR: 'EUR', LU: 'EUR', SK: 'EUR', SI: 'EUR', EE: 'EUR', LV: 'EUR', LT: 'EUR',
  CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', ZA: 'ZAR', IN: 'INR', JP: 'JPY', MX: 'MXN', BR: 'BRL', SG: 'SGD',
};
export function currencyFor(locale = 'en-US') {
  const region = (locale.split('-').find((x, i) => i > 0 && /^[A-Z]{2}$/i.test(x)) || (locale === 'en' ? 'US' : '')).toUpperCase();
  return CURRENCY[region] || null;
}

export function moneyFmt(locale = 'en-US') {
  const cur = currencyFor(locale);
  // Cents only when there are some: "$110" but "$4.25".
  const make = digits => {
    try {
      return cur ? new Intl.NumberFormat(locale, { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol', minimumFractionDigits: digits, maximumFractionDigits: digits })
        : new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    } catch {
      return new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
  };
  const whole = make(0), cents = make(2);
  const symbol = cur ? (cents.formatToParts(0).find(p => p.type === 'currency')?.value || '') : '';
  const money = x => (Math.abs(Math.round(x * 100) % 100) === 0 ? whole : cents).format(x);
  money.symbol = symbol;
  return money;
}

// "2 gallons", "1 quart", "3 × 80 lb bags", "2 × 2.5 L cans".
export function packLabel(pack, count, n = numFmt()) {
  if (pack.one) return count === 1 ? `1 ${pack.one}` : `${n(count, 0)} ${pack.many}`;
  const size = pack.w ? `${n(pack.w)} ${pack.wUnit}` : `${n(pack.size)} ${pack.unit}`;
  return `${n(count, 0)} × ${size} ${pack.noun}${count === 1 ? '' : 's'}`;
}

// What a pack is called in the "what the store sells" list.
export function packName(pack) {
  if (pack.row) return pack.row;
  if (pack.one) return pack.one[0].toUpperCase() + pack.one.slice(1);
  if (pack.w) return `${pack.w} ${pack.wUnit} ${pack.noun}`;
  return pack.noun[0].toUpperCase() + pack.noun.slice(1);
}

// ——— The calculators ———
//
// Each one says what to measure, which figures it assumes, what the store
// sells, and how the sums go. Field specs:
//   measure: { key, label, kind: len|small|area|count, def: [us, metric], hint, when }
//            { key, label, type: 'choice', options: [[value, label]], def }   (also 'check')
//            { type: 'head', label }
//   figures: { key, label, unit, def (number or f => number), step, hint, when }
//            { key, label, type: 'choice' | 'check', options, def, resets: [keys] }
// `when` hides a field unless its choice matches; values are in display units.

const SHAPES = { rect: ['rect', 'Length × width'], circle: ['circle', 'Circle'], area: ['area', 'I know the area'] };

function areaFields(shapes, noun) {
  return [
    { key: 'shape', type: 'choice', label: 'Shape', options: shapes.map(s => SHAPES[s]), def: shapes[0] },
    { key: 'l', kind: 'len', label: `${noun} length`, when: m => m.shape === 'rect' },
    { key: 'w', kind: 'len', label: `${noun} width`, when: m => m.shape === 'rect' },
    { key: 'd', kind: 'len', label: 'Across (diameter)', when: m => m.shape === 'circle' },
    { key: 'a', kind: 'area', label: `${noun} area`, when: m => m.shape === 'area' },
  ];
}

function areaStep(m, U, n, label) {
  const a = areaOf(m);
  if (m.shape === 'circle') return [label, `${n(m.d)} ${U.len} across = ${n(a, 1)} ${U.area}`];
  if (m.shape === 'area') return [label, `${n(a, 1)} ${U.area}`];
  return [label, `${n(m.l)} × ${n(m.w)} ${U.len} = ${n(a, 1)} ${U.area}`];
}

const areaMissing = m => (m.shape === 'circle' ? !(m.d > 0) : m.shape === 'area' ? !(m.a > 0) : !(m.l > 0 && m.w > 0));
const areaAsk = m => (m.shape === 'circle' ? 'how far across it is' : m.shape === 'area' ? 'the area' : 'the length and width');

function areaSummary(m, U, n) {
  if (m.shape === 'circle') return `${n(m.d)} ${U.len} circle`;
  if (m.shape === 'area') return `${n(m.a, 0)} ${U.area}`;
  return `${n(m.l)} × ${n(m.w)} ${U.len}`;
}

const extraFig = (def, hint) => ({ key: 'waste', label: 'Extra', unit: '%', def, step: 5, hint });
const coatsFig = (def, hint) => ({ key: 'coats', label: 'Coats', unit: '', def, step: 1, min: 1, hint });

// Paint and stain containers. US sizes are fixed; metric tins vary by country, so their sizes are editable.
function liquid(units, usPrices, metricSizes, metricPrices) {
  if (sysOf(units) === 'us') {
    return [
      { id: 'qt', one: 'quart', many: 'quarts', size: 0.25, unit: 'gal', price: usPrices[0] },
      { id: 'gal', one: 'gallon', many: 'gallons', size: 1, unit: 'gal', price: usPrices[1] },
      { id: 'pail', one: 'five-gallon pail', many: 'five-gallon pails', size: 5, unit: 'gal', price: usPrices[2] },
    ];
  }
  return metricSizes.map((size, i) => ({ id: `c${i}`, noun: 'can', size, unit: 'L', editSize: true, price: metricPrices[i] }));
}

function bags(units, unit, list) {
  return list.map(([size, price], i) => ({ id: `b${i}`, noun: 'bag', size, unit, editSize: true, price }));
}

const PAINT = {
  id: 'paint', icon: '🖌️', name: 'Paint & primer', jobs: v => (v === 'interior' ? [] : ['ext-paint']),
  about: 'Outside walls or a room, less doors and windows, for as many coats as the label says.',
  variants: [['exterior', 'Outside'], ['interior', 'Inside']],
  measure(v, units) {
    if (v === 'interior') {
      return [
        { key: 'rl', kind: 'len', label: 'Room length' },
        { key: 'rw', kind: 'len', label: 'Room width' },
        { key: 'rh', kind: 'len', label: 'Ceiling height', def: [8, 2.4] },
        { key: 'rooms', kind: 'count', label: 'Rooms this size', def: [1, 1] },
        { key: 'doors', kind: 'count', label: 'Doors' },
        { key: 'windows', kind: 'count', label: 'Windows' },
        { key: 'ceiling', type: 'check', label: 'Paint the ceiling too, with the same paint', def: false },
      ];
    }
    const walls = m => m.mode !== 'area';
    return [
      { key: 'mode', type: 'choice', label: 'Go by', options: [['walls', 'Walls and gables'], ['area', 'An area I already know']], def: 'walls' },
      { key: 'perim', kind: 'len', label: 'Distance around the house', hint: 'Pace it off, or add up the wall lengths.', when: walls },
      { key: 'h', kind: 'len', label: 'Wall height, ground to eaves', when: walls },
      { key: 'gables', kind: 'count', label: 'Gable ends', hint: 'The triangles of wall under a pitched roof.', when: walls },
      { key: 'gw', kind: 'len', label: 'Gable width', when: walls },
      { key: 'gr', kind: 'len', label: 'Gable height, eaves to peak', when: walls },
      { key: 'a', kind: 'area', label: 'Wall area', when: m => m.mode === 'area' },
      { key: 'xdoors', kind: 'count', label: 'Doors' },
      { key: 'xwindows', kind: 'count', label: 'Windows' },
      { key: 'garages', kind: 'count', label: 'Garage doors' },
    ];
  },
  figures(v, units) {
    const us = sysOf(units) === 'us';
    const surfaces = v === 'interior'
      ? [['smooth', 'Smooth walls', us ? 400 : 12], ['textured', 'Textured walls', us ? 300 : 9]]
      : [['smooth', 'Smooth siding, trim or wood', us ? 350 : 10], ['rough', 'Rough wood, shingles or shakes', us ? 250 : 7], ['masonry', 'Stucco, brick or block', us ? 175 : 5]];
    const per = us ? 'sq ft per gallon' : 'm² per L';
    return [
      { key: 'surface', type: 'choice', label: 'Surface', options: surfaces.map(s => [s[0], s[1]]), def: 'smooth', resets: ['coverage'] },
      { key: 'coverage', label: 'Paint covers', unit: per, def: f => (surfaces.find(s => s[0] === f.surface) || surfaces[0])[2], step: us ? 25 : 0.5 },
      coatsFig(2),
      { key: 'primer', type: 'check', label: 'Prime first (one coat)', def: false },
      { key: 'primerCoverage', label: 'Primer covers', unit: per, def: v === 'interior' ? (us ? 300 : 8) : (us ? 250 : 7), step: us ? 25 : 0.5, when: f => f.primer },
      extraFig(10, 'For rollers, trays and touch-ups.'),
      { key: 'door', label: 'A door counts as', unit: us ? 'sq ft' : 'm²', def: us ? 21 : 1.9, step: us ? 1 : 0.1 },
      { key: 'window', label: 'A window counts as', unit: us ? 'sq ft' : 'm²', def: us ? 15 : 1.4, step: us ? 1 : 0.1 },
      v === 'exterior' && { key: 'garage', label: 'A garage door counts as', unit: us ? 'sq ft' : 'm²', def: us ? 112 : 10, step: us ? 1 : 0.5 },
    ].filter(Boolean);
  },
  parts: (v, f) => (f.primer ? ['paint', 'primer'] : ['paint']),
  packs(v, units, part) {
    if (part === 'primer') return liquid(units, [16, 35, 150], [1, 2.5, 5, 10], [12, 25, 42, 75]);
    return v === 'interior'
      ? liquid(units, [20, 45, 200], [1, 2.5, 5, 10], [15, 30, 50, 90])
      : liquid(units, [25, 55, 250], [1, 2.5, 5, 10], [18, 38, 65, 110]);
  },
  work(m, f, v, units, n) {
    const U = SYS[sysOf(units)];
    const steps = [];
    let net;
    if (v === 'interior') {
      if (!(m.rl > 0 && m.rw > 0 && m.rh > 0)) return { missing: 'the room’s length, width and ceiling height' };
      const r = roomArea(m, f);
      const rooms = m.rooms > 1 ? ` × ${n(m.rooms, 0)} rooms` : '';
      steps.push(['Walls', `2 × (${n(m.rl)} + ${n(m.rw)}) × ${n(m.rh)} ${U.len}${rooms} = ${n(r.walls, 1)} ${U.area}`]);
      if (r.openings) steps.push(['Less doors and windows', `−${n(r.openings, 1)} ${U.area}`]);
      if (r.ceiling) steps.push(['Ceiling', `+${n(r.ceiling, 1)} ${U.area}`]);
      net = r.net;
    } else {
      if (m.mode === 'area' ? !(m.a > 0) : !(m.perim > 0 && m.h > 0)) return { missing: m.mode === 'area' ? 'the wall area' : 'the distance around the house and the wall height' };
      const r = houseArea(m, f);
      if (m.mode === 'area') steps.push(['Walls', `${n(r.walls, 1)} ${U.area}`]);
      else steps.push(['Walls', `${n(m.perim)} × ${n(m.h)} ${U.len} = ${n(r.walls, 1)} ${U.area}`]);
      if (r.gables) steps.push(['Gables', `${n(m.gables, 0)} × ${n(m.gw)} × ${n(m.gr)} ${U.len} ÷ 2 = ${n(r.gables, 1)} ${U.area}`]);
      if (r.openings) steps.push(['Less doors and windows', `−${n(r.openings, 1)} ${U.area}`]);
      net = r.net;
    }
    if (!(net > 0)) return { missing: 'walls bigger than the doors and windows in them', steps };
    steps.push(['To paint', `${n(net, 1)} ${U.area}`]);
    const parts = [];
    const coat = f.coats === 1 ? 'coat' : 'coats';
    const paint = coatsNeed(net, f.coats, f.coverage);
    steps.push(['Paint', `${n(f.coats, 0)} ${coat} at ${n(f.coverage)} ${U.area} per ${U.liqName} = ${n(paint)} ${U.liq}`]);
    parts.push({ id: 'paint', label: 'Paint', need: withExtra(paint, f.waste) });
    if (f.primer) {
      const primer = coatsNeed(net, 1, f.primerCoverage);
      steps.push(['Primer', `1 coat at ${n(f.primerCoverage)} ${U.area} per ${U.liqName} = ${n(primer)} ${U.liq}`]);
      parts.push({ id: 'primer', label: 'Primer', need: withExtra(primer, f.waste) });
    }
    steps.push([`+${n(f.waste, 0)}% extra`, parts.map(p => `${n(p.need)} ${U.liq}${parts.length > 1 ? ` of ${p.label.toLowerCase()}` : ''}`).join(', ')]);
    return { steps, parts, unit: U.liq, tips: ['Buy it all at once, or pour the cans together, so the color matches from wall to wall.'] };
  },
  summary(m, v, units, n) {
    const U = SYS[sysOf(units)];
    if (v === 'interior') return `Room: ${n(m.rl)} × ${n(m.rw)} ${U.len}, ${n(m.rh)} ${U.len} ceiling${m.rooms > 1 ? `, ${n(m.rooms, 0)} rooms` : ''}`;
    if (m.mode === 'area') return `House: ${n(m.a, 0)} ${U.area} of wall`;
    return `House: ${n(m.perim)} ${U.len} around, ${n(m.h)} ${U.len} high${m.gables > 0 ? `, ${n(m.gables, 0)} gable${m.gables > 1 ? 's' : ''}` : ''}`;
  },
};

const STAIN = {
  id: 'stain', icon: '🪵', name: 'Deck & fence stain', jobs: ['deck-stain'],
  about: 'Deck boards, railings, stairs and fences. How far a gallon goes depends on how thirsty the wood is.',
  measure(v, units) {
    return [
      { type: 'head', label: 'Deck' },
      { key: 'dl', kind: 'len', label: 'Deck length' },
      { key: 'dw', kind: 'len', label: 'Deck width' },
      { key: 'rail', kind: 'len', label: 'Railing, total length', hint: 'Rails and spindles are worked out from this.' },
      { key: 'steps', kind: 'count', label: 'Stair steps' },
      { key: 'sw', kind: 'len', label: 'Stair width' },
      { type: 'head', label: 'Fence' },
      { key: 'fl', kind: 'len', label: 'Fence length' },
      { key: 'fh', kind: 'len', label: 'Fence height' },
      { key: 'sides', type: 'choice', label: 'Fence sides to stain', options: [['2', 'Both'], ['1', 'One']], def: '2' },
    ];
  },
  figures(v, units) {
    const us = sysOf(units) === 'us';
    const woods = [['new', 'New, smooth wood', us ? 250 : 6], ['weathered', 'Weathered, grey wood', us ? 175 : 4.3], ['rough', 'Rough-sawn wood', us ? 125 : 3]];
    return [
      { key: 'wood', type: 'choice', label: 'The wood', options: woods.map(w => [w[0], w[1]]), def: 'new', resets: ['coverage'] },
      { key: 'coverage', label: 'Stain covers', unit: us ? 'sq ft per gallon' : 'm² per L', def: f => (woods.find(w => w[0] === f.wood) || woods[0])[2], step: us ? 25 : 0.5 },
      coatsFig(1, 'Solid stain, and very dry wood, usually take two.'),
      extraFig(10, 'Thirsty boards drink more than the label says.'),
      { key: 'railPer', label: 'Railing surface', unit: us ? 'sq ft per ft' : 'm² per m', def: us ? 6 : 1.8, step: us ? 0.5 : 0.1, hint: 'Top and bottom rails and the spindles, all sides.' },
      { key: 'stepDepth', label: 'Each step, tread plus riser', unit: us ? 'ft' : 'm', def: us ? 1.5 : 0.45, step: us ? 0.1 : 0.05 },
    ];
  },
  parts: () => ['stain'],
  packs: (v, units) => liquid(units, [20, 45, 200], [1, 2.5, 5], [15, 32, 55]),
  work(m, f, v, units, n) {
    const U = SYS[sysOf(units)];
    const r = woodArea(m, f);
    if (!(r.total > 0)) return { missing: 'the size of the deck or fence' };
    const steps = [];
    if (r.deck) steps.push(['Deck boards', `${n(m.dl)} × ${n(m.dw)} ${U.len} = ${n(r.deck, 1)} ${U.area}`]);
    if (r.rails) steps.push(['Railing', `${n(m.rail)} ${U.len} × ${n(f.railPer)} ${U.area} per ${U.len} = ${n(r.rails, 1)} ${U.area}`]);
    if (r.stairs) steps.push(['Stairs', `${n(m.steps, 0)} steps × ${n(m.sw)} ${U.len} wide × ${n(f.stepDepth)} ${U.len} = ${n(r.stairs, 1)} ${U.area}`]);
    if (r.fence) steps.push(['Fence', `${n(m.fl)} × ${n(m.fh)} ${U.len} × ${m.sides === '1' ? '1 side' : '2 sides'} = ${n(r.fence, 1)} ${U.area}`]);
    if (steps.length > 1) steps.push(['To stain', `${n(r.total, 1)} ${U.area}`]);
    const need = coatsNeed(r.total, f.coats, f.coverage);
    steps.push(['Stain', `${n(f.coats, 0)} ${f.coats === 1 ? 'coat' : 'coats'} at ${n(f.coverage)} ${U.area} per ${U.liqName} = ${n(need)} ${U.liq}`]);
    steps.push([`+${n(f.waste, 0)}% extra`, `${n(withExtra(need, f.waste))} ${U.liq}`]);
    return {
      steps, unit: U.liq,
      parts: [{ id: 'stain', label: 'Stain', need: withExtra(need, f.waste) }],
      tips: ['Try it on one board first: new and weathered wood can take the same stain very differently.'],
    };
  },
  summary(m, v, units, n) {
    const U = SYS[sysOf(units)];
    const bits = [];
    if (m.dl > 0 && m.dw > 0) {
      const extra = [m.rail > 0 && `${n(m.rail)} ${U.len} of railing`, m.steps > 0 && `${n(m.steps, 0)} steps`].filter(Boolean);
      bits.push(`Deck: ${n(m.dl)}×${n(m.dw)}${extra.length ? ` plus ${extra.join(' and ')}` : ''}`);
    } else if (m.rail > 0) bits.push(`Railing: ${n(m.rail)} ${U.len}`);
    if (m.fl > 0) bits.push(`${bits.length ? 'fence' : 'Fence'}: ${n(m.fl)} ${U.len}${m.fh > 0 ? `, ${n(m.fh)} ${U.len} high` : ''}`);
    return bits.join('; ');
  },
};

const SEALER = {
  id: 'sealer', icon: '🛣️', name: 'Driveway sealer', jobs: ['sealcoat'],
  about: 'Pails of asphalt sealer for the driveway, for one coat or two.',
  measure: () => areaFields(['rect', 'area'], 'Driveway'),
  figures(v, units) {
    const us = sysOf(units) === 'us';
    const s = [['smooth', 'Newer, smooth asphalt', us ? 350 : 1.8], ['porous', 'Older, rough or porous asphalt', us ? 250 : 1.3]];
    return [
      { key: 'surface', type: 'choice', label: 'The driveway', options: s.map(x => [x[0], x[1]]), def: 'smooth', resets: ['coverage'] },
      { key: 'coverage', label: 'Sealer covers', unit: us ? 'sq ft per pail' : 'm² per L', def: f => (s.find(x => x[0] === f.surface) || s[0])[2], step: us ? 25 : 0.1, hint: us ? 'A pail is about 4.75 gallons.' : '' },
      coatsFig(2, 'Two thin coats wear better than one thick one.'),
      extraFig(5, 'For edges and patches that soak it up.'),
    ];
  },
  parts: () => ['sealer'],
  packs(v, units) {
    return sysOf(units) === 'us'
      ? [{ id: 'pail', one: 'pail', many: 'pails', row: 'Pail', size: 1, unit: 'pail', price: 35 }]
      : [{ id: 't5', noun: 'tub', size: 5, unit: 'L', editSize: true, price: 25 }, { id: 't20', noun: 'tub', size: 20, unit: 'L', editSize: true, price: 70 }];
  },
  work(m, f, v, units, n) {
    const U = SYS[sysOf(units)];
    if (areaMissing(m)) return { missing: areaAsk(m) };
    const area = areaOf(m);
    const us = sysOf(units) === 'us';
    const need = coatsNeed(area, f.coats, f.coverage);
    const unit = us ? 'pails' : 'L';
    return {
      unit,
      steps: [
        areaStep(m, U, n, 'Driveway'),
        ['Sealer', `${n(f.coats, 0)} ${f.coats === 1 ? 'coat' : 'coats'} at ${n(f.coverage)} ${U.area} per ${us ? 'pail' : 'L'} = ${n(need)} ${unit}`],
        [`+${n(f.waste, 0)}% extra`, `${n(withExtra(need, f.waste))} ${unit}`],
      ],
      parts: [{ id: 'sealer', label: 'Sealer', need: withExtra(need, f.waste) }],
      tips: ['Fill cracks first, with crack filler: sealer won’t bridge them.'],
    };
  },
  summary: (m, v, units, n) => `Driveway: ${areaSummary(m, SYS[sysOf(units)], n)}`,
};

// Seeding rates: pounds per 1,000 sq ft and grams per m², new lawn then overseeding.
export const GRASSES = [
  ['mix', 'Sun & shade mix', 'cool', [6, 3], [30, 15]],
  ['tall-fescue', 'Tall fescue', 'cool', [7, 4], [35, 20]],
  ['bluegrass', 'Kentucky bluegrass', 'cool', [2.5, 1.5], [12, 8]],
  ['rye', 'Perennial ryegrass', 'cool', [8, 4], [40, 20]],
  ['fine-fescue', 'Fine fescue', 'cool', [4, 2], [20, 10]],
  ['bermuda', 'Bermuda (hulled)', 'warm', [1.5, 1], [8, 5]],
  ['zoysia', 'Zoysia', 'warm', [1.5, 1], [8, 5]],
  ['centipede', 'Centipede', 'warm', [0.5, 0.25], [2.5, 1.5]],
  ['bahia', 'Bahia', 'warm', [8, 5], [40, 25]],
];

const SEED = {
  id: 'seed', icon: '🌿', name: 'Grass seed', jobs: ['seed', 'seed-warm'],
  about: 'A new lawn or overseeding a thin one, at the rate for your kind of grass.',
  measure: () => areaFields(['rect', 'area'], 'Lawn'),
  figures(v, units) {
    const us = sysOf(units) === 'us';
    const grass = f => GRASSES.find(g => g[0] === f.grass) || GRASSES[0];
    return [
      { key: 'job', type: 'choice', label: 'The job', options: [['over', 'Overseeding a thin lawn'], ['new', 'A new lawn or bare ground']], def: 'over', resets: ['rate'] },
      { key: 'grass', type: 'choice', label: 'Grass', options: GRASSES.map(g => [g[0], `${g[1]} (${g[2]}-season)`]), def: 'mix', resets: ['rate'] },
      { key: 'rate', label: 'Seed at', unit: us ? 'lb per 1,000 sq ft' : 'g per m²', def: f => grass(f)[us ? 3 : 4][f.job === 'new' ? 0 : 1], step: us ? 0.25 : 1 },
      extraFig(10, 'For edges and thin spots.'),
    ];
  },
  parts: () => ['seed'],
  packs: (v, units) => (sysOf(units) === 'us'
    ? bags(units, 'lb', [[3, 18], [7, 35], [20, 80], [50, 150]])
    : bags(units, 'kg', [[1, 10], [5, 40], [10, 70], [20, 120]])),
  work(m, f, v, units, n) {
    const U = SYS[sysOf(units)];
    if (areaMissing(m)) return { missing: areaAsk(m) };
    const area = areaOf(m);
    const us = sysOf(units) === 'us';
    // lb per 1,000 sq ft × sq ft ÷ 1,000 = lb; g per m² × m² ÷ 1,000 = kg.
    const need = area * f.rate / 1000;
    return {
      unit: U.wt,
      steps: [
        areaStep(m, U, n, 'Lawn'),
        ['Seed', us ? `${n(f.rate)} lb per 1,000 sq ft = ${n(need)} lb` : `${n(f.rate)} g per m² = ${n(need)} kg`],
        [`+${n(f.waste, 0)}% extra`, `${n(withExtra(need, f.waste))} ${U.wt}`],
      ],
      parts: [{ id: 'seed', label: 'Seed', need: withExtra(need, f.waste) }],
      tips: ['Most crabgrass preventers stop grass seed sprouting too, so don’t put both down the same spring.'],
    };
  },
  summary: (m, v, units, n) => `Lawn: ${areaSummary(m, SYS[sysOf(units)], n)}`,
};

const FEED = {
  id: 'feed', icon: '🌾', name: 'Fertilizer & crabgrass preventer', jobs: v => [v === 'preventer' ? 'preemergent' : 'fertilize'],
  about: 'Bags are sold by how much lawn they cover at the spreader setting on the label.',
  variants: [['fertilizer', 'Fertilizer'], ['preventer', 'Crabgrass preventer']],
  measure: () => areaFields(['rect', 'area'], 'Lawn'),
  figures(v) {
    return [
      { key: 'apps', label: 'Times this year', unit: v === 'fertilizer' ? 'feedings' : 'applications', def: 1, step: 1, min: 1, hint: v === 'fertilizer' ? 'Most lawns get two to four feedings a year.' : 'Usually once, in spring. Some labels allow a second round 6 to 8 weeks later.' },
      extraFig(5, 'For spreader overlap at the edges.'),
    ];
  },
  parts: () => ['feed'],
  packs(v, units) {
    const us = sysOf(units) === 'us';
    const [a, b] = v === 'preventer' ? (us ? [28, 65] : [12, 35]) : (us ? [25, 60] : [10, 30]);
    const unit = us ? 'sq ft' : 'm²';
    return [
      { id: 'small', noun: 'bag', size: us ? 5000 : 100, unit, editSize: true, price: a },
      { id: 'big', noun: 'bag', size: us ? 15000 : 400, unit, editSize: true, price: b },
    ];
  },
  work(m, f, v, units, n) {
    const U = SYS[sysOf(units)];
    if (areaMissing(m)) return { missing: areaAsk(m) };
    const area = areaOf(m);
    const need = area * f.apps;
    const steps = [areaStep(m, U, n, 'Lawn')];
    if (f.apps > 1) steps.push([`${n(f.apps, 0)} times`, `${n(need, 0)} ${U.area}`]);
    steps.push([`+${n(f.waste, 0)}% extra`, `${n(withExtra(need, f.waste), 0)} ${U.area} of coverage`]);
    return {
      unit: U.area, steps,
      parts: [{ id: 'feed', label: v === 'preventer' ? 'Crabgrass preventer' : 'Fertilizer', need: withExtra(need, f.waste) }],
      tips: v === 'preventer'
        ? ['It needs about half an inch of rain or watering within a few days to work. It also stops grass seed, so skip it where you’re seeding.']
        : ['Sweep any that lands on the driveway back onto the grass.'],
    };
  },
  summary: (m, v, units, n) => `Lawn: ${areaSummary(m, SYS[sysOf(units)], n)}`,
};

const FILLS = {
  mulch: { name: 'Mulch', depth: [3, 7.5], extra: [5, 'It settles a little.'], hint: ['2 to 3 inches keeps weeds down without smothering roots.', '5 to 8 cm keeps weeds down without smothering roots.'], us: [[2, 4.5], [1.5, 3.75], [0.5, 2]], metric: [[25, 3], [50, 5], [70, 7]], bulk: [38, 50] },
  topsoil: { name: 'Topsoil', depth: [4, 10], extra: [10, 'Loose soil settles.'], hint: ['About 4 inches for a new bed or to fill a low spot.', 'About 10 cm for a new bed or to fill a low spot.'], us: [[2, 5.5], [1.5, 4.25], [0.5, 2.25]], metric: [[25, 3], [50, 5]], bulk: [35, 45] },
  compost: { name: 'Compost', depth: [2, 5], extra: [5, 'It settles a little.'], hint: ['2 inches to dig into a bed, ¼ inch to top-dress a lawn.', '5 cm to dig into a bed, 1 cm to top-dress a lawn.'], us: [[2, 9], [1.5, 7], [0.5, 3.5]], metric: [[25, 4], [50, 7], [70, 9]], bulk: [45, 60] },
  gravel: { name: 'Gravel', depth: [3, 7.5], extra: [5, 'For a base that packs down.'], hint: ['2 to 3 inches for a path, 4 or more for a driveway.', '5 to 8 cm for a path, 10 or more for a driveway.'], us: [[2, null], [1.5, null], [0.5, 5.5]], metric: [[15, 5], [25, null]], bulk: [55, 70] },
};

const FILL = {
  id: 'fill', icon: '🪴', name: 'Mulch, soil, compost & gravel', jobs: v => ({ mulch: ['plant-trees'], compost: ['transplant'] })[v] || [],
  about: 'Area times depth, turned into bags or a loose load.',
  variants: Object.entries(FILLS).map(([k, x]) => [k, x.name]),
  measure(v, units) {
    const F = FILLS[v] || FILLS.mulch;
    return [
      ...areaFields(['rect', 'circle', 'area'], 'Bed'),
      { key: `depth-${v}`, kind: 'small', label: 'Depth', def: F.depth, hint: F.hint[sysOf(units) === 'us' ? 0 : 1] },
    ];
  },
  figures(v, units) {
    const F = FILLS[v] || FILLS.mulch;
    const us = sysOf(units) === 'us';
    return [
      extraFig(F.extra[0], F.extra[1]),
      v === 'gravel' && { key: 'density', label: 'Stone weighs about', unit: us ? 'tons per cu yd' : 'tonnes per m³', def: us ? 1.4 : 1.6, step: 0.1 },
    ].filter(Boolean);
  },
  parts: () => ['bags'],
  packs(v, units) {
    const F = FILLS[v] || FILLS.mulch;
    return sysOf(units) === 'us' ? bags(units, 'cu ft', F.us) : bags(units, 'L', F.metric);
  },
  bulk(v, units) {
    const F = FILLS[v] || FILLS.mulch;
    return sysOf(units) === 'us'
      ? { unit: 'cu yd', step: 0.5, price: F.bulk[0], name: 'Loose, by the cubic yard', plus: 'plus delivery' }
      : { unit: 'm³', step: 0.25, price: F.bulk[1], name: 'Loose, by the cubic metre', plus: 'plus delivery' };
  },
  work(m, f, v, units, n) {
    const U = SYS[sysOf(units)];
    const us = sysOf(units) === 'us';
    const depth = m[`depth-${v}`];
    if (areaMissing(m) || !(depth > 0)) return { missing: areaMissing(m) ? areaAsk(m) : 'the depth' };
    const vol = volumeOf(areaOf(m), depth, units);
    const big = x => `${n(x / U.perBulk)} ${U.bulk}`;
    const need = withExtra(vol, f.waste);
    const steps = [
      areaStep(m, U, n, 'Area'),
      ['Depth', `${n(depth)} ${U.small} = ${us ? `${n(vol, 1)} ${U.vol} (${big(vol)})` : `${n(vol / 1000)} m³ (${n(vol, 0)} L)`}`],
      [`+${n(f.waste, 0)}% extra`, us ? `${n(need, 1)} ${U.vol} (${big(need)})` : `${n(need / 1000)} m³ (${n(need, 0)} L)`],
    ];
    if (v === 'gravel') steps.push(['Weight', `about ${n(need / U.perBulk * f.density, 1)} ${us ? 'tons' : 'tonnes'}`]);
    return { unit: U.vol, steps, parts: [{ id: 'bags', label: (FILLS[v] || FILLS.mulch).name, need }] };
  },
  summary(m, v, units, n) {
    const U = SYS[sysOf(units)];
    return `${(FILLS[v] || FILLS.mulch).name}: ${areaSummary(m, U, n)}, ${n(m[`depth-${v}`])} ${U.small} deep`;
  },
};

const CONCRETE = {
  id: 'concrete', icon: '🧱', name: 'Concrete', jobs: ['concrete'],
  about: 'A slab or pad, or the post holes for a fence or deck, in bags or ready-mix.',
  variants: [['slab', 'Slab or pad'], ['posts', 'Post holes']],
  measure(v, units) {
    if (v === 'posts') {
      return [
        { key: 'holes', kind: 'count', label: 'Holes' },
        { key: 'hd', kind: 'small', label: 'Hole width', def: [10, 25], hint: 'About three times the post’s width.' },
        { key: 'hdep', kind: 'small', label: 'Hole depth', def: [36, 90], hint: 'Below the frost line, which building codes set by area.' },
        { key: 'post', kind: 'small', label: 'Post width', def: [3.5, 9], hint: sysOf(units) === 'us' ? 'A 4×4 is 3½ inches across. Put 0 for a footing with no post.' : 'Put 0 for a footing with no post.' },
      ];
    }
    return [
      ...areaFields(['rect', 'circle'], 'Slab'),
      { key: 'thick', kind: 'small', label: 'Thickness', def: [4, 10], hint: sysOf(units) === 'us' ? '4 inches for a patio, walk or shed pad.' : '10 cm for a patio, path or shed base.' },
    ];
  },
  figures(v) {
    return [extraFig(10, v === 'posts' ? 'Holes always come out bigger than planned.' : 'For uneven ground and spills.')];
  },
  parts: () => ['bags'],
  packs(v, units) {
    return sysOf(units) === 'us'
      ? [[40, 0.3, 4.25], [60, 0.45, 5.25], [80, 0.6, 6.25]].map(([w, size, price]) => ({ id: `b${w}`, w, wUnit: 'lb', noun: 'bag', size, unit: 'cu ft', editSize: true, sizeLabel: 'makes', price }))
      : [[20, 9.5, 7], [25, 12, 8]].map(([w, size, price]) => ({ id: `b${w}`, w, wUnit: 'kg', noun: 'bag', size, unit: 'L', editSize: true, sizeLabel: 'makes', price }));
  },
  bulk(v, units) {
    return sysOf(units) === 'us'
      ? { unit: 'cu yd', step: 0.25, price: 170, name: 'Ready-mix, by the cubic yard', plus: 'plus delivery; many trucks have a minimum' }
      : { unit: 'm³', step: 0.2, price: 160, name: 'Ready-mix, by the cubic metre', plus: 'plus delivery; many trucks have a minimum' };
  },
  work(m, f, v, units, n) {
    const U = SYS[sysOf(units)];
    const us = sysOf(units) === 'us';
    const steps = [];
    let vol;
    if (v === 'posts') {
      if (!(m.holes > 0 && m.hd > 0 && m.hdep > 0)) return { missing: 'how many holes, and how wide and deep' };
      if (m.post >= m.hd) return { missing: 'a hole wider than the post' };
      vol = postVolume(m, units);
      steps.push(['Holes', `${n(m.holes, 0)} × ${n(m.hd)} ${U.small} wide × ${n(m.hdep)} ${U.small} deep${m.post > 0 ? `, less the post` : ''} = ${us ? `${n(vol)} ${U.vol}` : `${n(vol, 0)} L`}`]);
    } else {
      if (areaMissing(m) || !(m.thick > 0)) return { missing: areaMissing(m) ? areaAsk(m) : 'the thickness' };
      vol = volumeOf(areaOf(m), m.thick, units);
      steps.push(areaStep(m, U, n, 'Slab'));
      steps.push(['Thickness', `${n(m.thick)} ${U.small} = ${us ? `${n(vol, 1)} ${U.vol}` : `${n(vol / 1000)} m³`}`]);
    }
    const need = withExtra(vol, f.waste);
    steps.push([`+${n(f.waste, 0)}% extra`, us ? `${n(need, 1)} ${U.vol} (${n(need / 27)} ${U.bulk})` : `${n(need / 1000)} m³ (${n(need, 0)} L)`]);
    return { unit: U.vol, steps, parts: [{ id: 'bags', label: 'Concrete mix', need }] };
  },
  summary(m, v, units, n) {
    const U = SYS[sysOf(units)];
    if (v === 'posts') return `${n(m.holes, 0)} post holes, ${n(m.hd)} ${U.small} wide, ${n(m.hdep)} ${U.small} deep`;
    return `Slab: ${areaSummary(m, U, n)}, ${n(m.thick)} ${U.small} thick`;
  },
};

export const CALCS = [PAINT, STAIN, SEALER, SEED, FEED, FILL, CONCRETE];
export const calcById = id => CALCS.find(c => c.id === id);
// The jobs a calculator (and variant) goes with, for "Good day for it?" links.
export const jobsOf = (calc, v) => (typeof calc.jobs === 'function' ? calc.jobs(v) : calc.jobs || []);
export const firstVariant = calc => (calc.variants ? calc.variants[0][0] : '');

// What a route's extra word means for a calculator, e.g. #/buy/seed/warm or
// #/buy/fill/compost. Returns the variant and any choices to set.
export function applyRoute(calc, word, saved = {}) {
  if (!word) return {};
  if (calc.variants?.some(([k]) => k === word)) return { v: word };
  if (calc.id === 'seed' && (word === 'cool' || word === 'warm')) {
    const now = GRASSES.find(g => g[0] === saved.c?.['']?.grass);
    if (now && now[2] === word) return {};
    return { choices: { grass: word === 'warm' ? 'bermuda' : 'mix' } };
  }
  return {};
}

// ——— From saved inputs to an answer ———
//
// Saved inputs for one calculator look like
//   { v: variant, m: { key: metric value or choice }, c: { [variant]: { choice: value } },
//     f: { us|metric: { [variant]: { figure: number, 'part.pack.price': number, … } } } }
// and `inputsFor` fills in the defaults and converts measurements to display units.

export function inputsFor(calc, units, saved = {}) {
  const sys = sysOf(units);
  const v = saved.v && calc.variants?.some(([k]) => k === saved.v) ? saved.v : firstVariant(calc);
  const i = sys === 'us' ? 0 : 1;
  const m = {};
  const measure = calc.measure(v, sys).filter(fd => fd.type !== 'head');
  for (const fd of measure) {
    const raw = saved.m?.[fd.key];
    if (fd.type === 'choice' || fd.type === 'check') m[fd.key] = raw ?? fd.def;
    // Never typed: the default. Typed and then cleared: nothing.
    else if (raw === undefined) m[fd.key] = fd.def ? fd.def[i] : null;
    else m[fd.key] = raw === null || raw === '' ? null : measureFor(fd.kind, sys).to(raw);
  }
  const choices = { ...(saved.c?.[''] || {}), ...(saved.c?.[v] || {}) };
  const stored = saved.f?.[sys]?.[v] || {};
  const f = {};
  for (const fd of calc.figures(v, sys)) {
    if (fd.type === 'choice' || fd.type === 'check') f[fd.key] = choices[fd.key] ?? fd.def;
    else f[fd.key] = typeof stored[fd.key] === 'number' ? stored[fd.key] : typeof fd.def === 'function' ? fd.def(f) : fd.def;
  }
  const packs = {};
  for (const part of calc.parts(v, f)) {
    packs[part] = calc.packs(v, sys, part).map(p => {
      const price = stored[`${part}.${p.id}.price`];
      const size = stored[`${part}.${p.id}.size`];
      return { ...p, price: price === null ? null : typeof price === 'number' ? price : p.price, size: p.editSize && size > 0 ? size : p.size };
    });
  }
  let bulk = calc.bulk?.(v, sys) || null;
  if (bulk) {
    const price = stored['bulk.price'];
    bulk = { ...bulk, price: price === null ? null : typeof price === 'number' ? price : bulk.price };
  }
  return { v, units: sys, m, f, packs, bulk, measure, figures: calc.figures(v, sys) };
}

// The whole answer: the working, what to buy for each part, the loose/bulk
// alternative where there is one, and the total.
export function quote(calc, inputs, locale = 'en-US') {
  const n = numFmt(locale);
  const { v, units, m, f } = inputs;
  const w = calc.work(m, f, v, units, n);
  if (w.missing) return { missing: w.missing, steps: w.steps || [], parts: [], total: null };
  const parts = w.parts.map(p => {
    const buy = bestPacks(p.need, inputs.packs[p.id] || []);
    const headline = buy.items.map(x => packLabel(x.pack, x.n, n)).join(' + ');
    return { ...p, buy, headline, unit: w.unit };
  });
  const total = parts.some(p => p.buy.cost == null) ? null : Math.round(parts.reduce((s, p) => s + p.buy.cost, 0) * 100) / 100;
  let bulk = null;
  if (inputs.bulk) {
    const perBulk = SYS[units].perBulk;
    const amount = roundUp(parts[0].need / perBulk, inputs.bulk.step);
    bulk = { ...inputs.bulk, amount, cost: inputs.bulk.price == null ? null : Math.round(amount * inputs.bulk.price * 100) / 100 };
  }
  const tips = [...(w.tips || [])];
  const bagCount = parts[0]?.buy.items.reduce((s, x) => s + x.n, 0) || 0;
  if (bulk && bagCount > 40) tips.unshift(`That’s ${n(bagCount, 0)} bags to haul. At this size, ${calc.id === 'concrete' ? 'ready-mix' : 'a loose load'} is usually easier.`);
  const weight = parts[0]?.buy.items.reduce((s, x) => s + x.n * (x.pack.w || 0), 0) || 0;
  if (weight) tips.push(`That’s about ${n(weight, 0)} ${SYS[units].wt} of bags.`);
  return { steps: w.steps, parts, total, bulk, tips };
}

export function summaryOf(calc, inputs, locale = 'en-US') {
  try { return calc.summary(inputs.m, inputs.v, inputs.units, numFmt(locale)); } catch { return calc.name; }
}
