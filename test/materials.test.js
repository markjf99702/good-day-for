import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rectArea, circleArea, areaOf, roomArea, houseArea, woodArea, volumeOf, postVolume, coatsNeed, withExtra, roundUp,
  bestPacks, packLabel, currencyFor, moneyFmt, CALCS, calcById, jobsOf, inputsFor, quote, summaryOf, applyRoute, GRASSES,
} from '../js/materials.js';
import { JOBS } from '../js/jobs.js';

const close = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, msg || `${a} ≈ ${b}`);
// Saved measurements are metric; these turn US numbers into what the page stores.
const ft = x => x * 0.3048, inch = x => x * 2.54, sqft = x => x * 0.09290304;

test('areas: rectangles, circles and "I know the area"', () => {
  assert.equal(rectArea(12, 16), 192);
  close(circleArea(2), Math.PI);
  assert.equal(areaOf({ shape: 'rect', l: 10, w: 5 }), 50);
  close(areaOf({ shape: 'circle', d: 6 }), 9 * Math.PI);
  assert.equal(areaOf({ shape: 'area', a: 1800 }), 1800);
  assert.equal(areaOf({ shape: 'rect', l: 10 }), 0, 'a missing width means no area yet');
});

test('a room: four walls, less doors and windows, plus the ceiling', () => {
  const sizes = { door: 21, window: 15 };
  const r = roomArea({ rl: 12, rw: 14, rh: 8, rooms: 1, doors: 1, windows: 2 }, sizes);
  assert.equal(r.walls, 416);
  assert.equal(r.openings, 51);
  assert.equal(r.net, 365);
  const withCeiling = roomArea({ rl: 12, rw: 14, rh: 8, rooms: 2, doors: 1, windows: 2, ceiling: true }, sizes);
  assert.equal(withCeiling.walls, 832);
  assert.equal(withCeiling.ceiling, 336);
  assert.equal(withCeiling.net, 832 - 51 + 336);
});

test('a house: walls plus gable triangles, less doors, windows and garage doors', () => {
  const sizes = { door: 21, window: 15, garage: 112 };
  const r = houseArea({ perim: 160, h: 10, gables: 2, gw: 30, gr: 8, xdoors: 2, xwindows: 10, garages: 1 }, sizes);
  assert.equal(r.walls, 1600);
  assert.equal(r.gables, 240);
  assert.equal(r.openings, 42 + 150 + 112);
  assert.equal(r.net, 1600 + 240 - 304);
  const known = houseArea({ mode: 'area', a: 1800, perim: 999, xwindows: 4 }, sizes);
  assert.equal(known.net, 1800 - 60, 'known area ignores the wall measurements');
  assert.equal(houseArea({ perim: 10, h: 2, garages: 1 }, sizes).net, 0, 'never below zero');
});

test('deck and fence: boards, railing, stairs, and one or both sides of the fence', () => {
  const figs = { railPer: 6, stepDepth: 1.5 };
  const r = woodArea({ dl: 12, dw: 16, rail: 40, steps: 4, sw: 4, fl: 60, fh: 6, sides: '2' }, figs);
  assert.equal(r.deck, 192);
  assert.equal(r.rails, 240);
  assert.equal(r.stairs, 24);
  assert.equal(r.fence, 720);
  assert.equal(r.total, 1176);
  assert.equal(woodArea({ fl: 60, fh: 6, sides: '1' }, figs).total, 360);
});

test('volumes: area × depth in cubic feet or litres, and post holes less the post', () => {
  assert.equal(volumeOf(100, 3, 'us'), 25);          // 100 sq ft, 3 in deep
  assert.equal(volumeOf(10, 5, 'metric'), 500);      // 10 m², 5 cm deep = 0.5 m³
  const each = (Math.PI * 25 - 3.5 ** 2) * 36;       // cubic inches
  close(postVolume({ holes: 8, hd: 10, hdep: 36, post: 3.5 }, 'us'), 8 * each / 1728);
  close(postVolume({ holes: 1, hd: 25, hdep: 90, post: 0 }, 'metric'), Math.PI * 12.5 ** 2 * 90 / 1000);
  assert.equal(postVolume({ holes: 2, hd: 4, hdep: 30, post: 5 }, 'us'), 0, 'a post wider than its hole adds nothing');
});

test('coats, coverage, extra and rounding up to a step', () => {
  close(coatsNeed(365, 2, 400), 1.825);
  assert.equal(coatsNeed(100, 1, 0), 0);
  close(withExtra(2, 10), 2.2);
  assert.equal(withExtra(2, 0), 2);
  assert.equal(roundUp(0.97, 0.5), 1);
  assert.equal(roundUp(1.0, 0.5), 1);
  assert.equal(roundUp(1.01, 0.25), 1.25);
  assert.equal(roundUp(0, 0.5), 0);
});

const PAINT = [{ id: 'qt', one: 'quart', many: 'quarts', size: 0.25, price: 22 }, { id: 'gal', one: 'gallon', many: 'gallons', size: 1, price: 52 }, { id: 'pail', one: 'five-gallon pail', many: 'five-gallon pails', size: 5, price: 235 }];
const count = (r, id) => r.items.find(x => x.pack.id === id)?.n || 0;

test('containers: the cheapest mix that covers it', () => {
  const a = bestPacks(2.09, PAINT);
  assert.deepEqual([count(a, 'gal'), count(a, 'qt'), count(a, 'pail')], [2, 1, 0]);
  assert.equal(a.cost, 126);
  close(a.left, 0.16, 1e-9);
  // 4.2 gallons: four gallons and a quart beat the pail; at 4.3 the pail wins.
  const b = bestPacks(4.2, PAINT);
  assert.deepEqual([count(b, 'gal'), count(b, 'qt'), count(b, 'pail')], [4, 1, 0]);
  const c = bestPacks(4.3, PAINT);
  assert.deepEqual([count(c, 'pail'), count(c, 'gal')], [1, 0]);
  // Three quarts cost more than a gallon.
  assert.deepEqual(bestPacks(0.6, PAINT).items.map(x => x.pack.id), ['gal']);
  // Exactly enough is enough.
  assert.deepEqual(bestPacks(2, PAINT).items.map(x => [x.pack.id, x.n]), [['gal', 2]]);
  assert.deepEqual(bestPacks(0, PAINT), { items: [], amount: 0, cost: 0, left: 0 });
});

test('containers: a size with no price is left out; with no prices at all, least left over wins', () => {
  const bagsOf = [{ id: 'b2', size: 2, price: null }, { id: 'b1', size: 1.5, price: null }, { id: 'b0', size: 0.5, price: 5 }];
  const r = bestPacks(3, bagsOf);
  assert.deepEqual(r.items.map(x => [x.pack.id, x.n]), [['b0', 6]]);
  const none = bestPacks(3.2, bagsOf.map(p => ({ ...p, price: null })));
  close(none.amount, 3.5);
  assert.equal(none.cost, null);
  assert.equal(none.items.reduce((s, x) => s + x.n, 0), 2, 'fewest containers for the same amount');
});

test('containers: odd metric sizes and very large orders', () => {
  const cans = [{ id: 'a', size: 0.946, price: 20 }, { id: 'b', size: 3.78, price: 60 }, { id: 'c', size: 18.9, price: 250 }];
  const r = bestPacks(10, cans);
  assert.ok(r.amount >= 10);
  // Brute force agrees.
  let best = Infinity;
  for (let x = 0; x <= 11; x++) for (let y = 0; y <= 3; y++) for (let z = 0; z <= 1; z++) {
    if (x * 0.946 + y * 3.78 + z * 18.9 >= 10) best = Math.min(best, x * 20 + y * 60 + z * 250);
  }
  assert.equal(r.cost, best);
  const t = Date.now();
  const big = bestPacks(5000, PAINT);
  assert.ok(big.amount >= 5000 && big.amount < 5005, `amount ${big.amount}`);
  assert.ok(Date.now() - t < 1500, 'fast enough');
});

test('concrete bags: mostly 80 lb, topped up with a smaller bag', () => {
  const bagsOf = [{ id: 'b40', w: 40, size: 0.3, price: 4.25 }, { id: 'b60', w: 60, size: 0.45, price: 5.25 }, { id: 'b80', w: 80, size: 0.6, price: 6.25 }];
  const r = bestPacks(11.05, bagsOf);
  assert.deepEqual(r.items.map(x => [x.pack.id, x.n]), [['b80', 18], ['b40', 1]]);
  assert.equal(r.cost, 116.75);
});

test('pack labels read naturally', () => {
  assert.equal(packLabel(PAINT[1], 2), '2 gallons');
  assert.equal(packLabel(PAINT[0], 1), '1 quart');
  assert.equal(packLabel(PAINT[2], 1), '1 five-gallon pail');
  assert.equal(packLabel({ w: 80, wUnit: 'lb', noun: 'bag', size: 0.6, unit: 'cu ft' }, 3), '3 × 80 lb bags');
  assert.equal(packLabel({ noun: 'can', size: 2.5, unit: 'L' }, 1), '1 × 2.5 L can');
  assert.equal(packLabel({ noun: 'bag', size: 15000, unit: 'sq ft' }, 2), '2 × 15,000 sq ft bags');
});

test('prices show in the local currency, or as a plain number when unsure', () => {
  assert.equal(currencyFor('en-US'), 'USD');
  assert.equal(currencyFor('en'), 'USD');
  assert.equal(currencyFor('en-GB'), 'GBP');
  assert.equal(currencyFor('de-DE'), 'EUR');
  assert.equal(currencyFor('fr'), null);
  assert.equal(moneyFmt('en-US')(126), '$126');
  assert.equal(moneyFmt('en-US')(4.25), '$4.25');
  assert.equal(moneyFmt('en-US')(4.2), '$4.20');
  assert.equal(moneyFmt('en-US').symbol, '$');
  assert.equal(moneyFmt('fr')(12.5).replace(/\s/g, ' '), '12,50');
  assert.equal(moneyFmt('fr')(12), '12');
});

// ——— Whole calculators, from saved (metric) measurements to what to buy ———

const answer = (id, saved, units = 'us') => {
  const calc = calcById(id);
  const inputs = inputsFor(calc, units, saved);
  return { inputs, q: quote(calc, inputs, 'en-US'), summary: summaryOf(calc, inputs, 'en-US') };
};

test('deck stain: 12×16 deck and 40 ft of railing', () => {
  const { inputs, q, summary } = answer('stain', { m: { dl: ft(12), dw: ft(16), rail: ft(40) } });
  close(inputs.m.dl, 12, 1e-9, 'metres come back as feet');
  assert.equal(inputs.f.coverage, 250, 'new wood by default');
  // 192 + 240 = 432 sq ft, one coat at 250 = 1.728 gal, +10% = 1.9 gal.
  close(q.parts[0].need, 432 / 250 * 1.1);
  assert.equal(q.parts[0].headline, '2 gallons');
  assert.equal(q.total, 90);
  assert.equal(summary, 'Deck: 12×16 plus 40 ft of railing');
  assert.ok(q.steps.some(([k, v]) => k === 'Railing' && v === '40 ft × 6 sq ft per ft = 240 sq ft'), JSON.stringify(q.steps));
  // Weathered wood soaks up more.
  const w = answer('stain', { m: { dl: ft(12), dw: ft(16), rail: ft(40) }, c: { '': { wood: 'weathered' } } });
  assert.equal(w.inputs.f.coverage, 175);
  close(w.q.parts[0].need, 432 / 175 * 1.1);
  assert.equal(w.q.parts[0].headline, '3 gallons', 'cheaper than 2 gallons and 3 quarts');
});

test('stain: nothing measured yet asks for the size', () => {
  const { q } = answer('stain', {});
  assert.match(q.missing, /size of the deck or fence/);
  assert.equal(q.total, null);
});

test('interior paint: a 12×14 room, one door, two windows, two coats', () => {
  const { q, summary } = answer('paint', { v: 'interior', m: { rl: ft(12), rw: ft(14), doors: 1, windows: 2 } });
  close(q.parts[0].need, 365 * 2 / 400 * 1.1);
  assert.equal(q.parts[0].headline, '2 gallons + 1 quart');
  assert.equal(q.total, 110);
  assert.equal(summary, 'Room: 12 × 14 ft, 8 ft ceiling');
});

test('exterior paint with primer, in metric tins', () => {
  const saved = { v: 'exterior', m: { perim: 40, h: 5, xdoors: 2, xwindows: 8 }, c: { exterior: { primer: true } } };
  const { inputs, q } = answer('paint', saved, 'metric');
  assert.equal(inputs.f.coverage, 10);
  const net = 200 - 2 * 1.9 - 8 * 1.4;
  close(q.parts[0].need, net * 2 / 10 * 1.1);
  close(q.parts[1].need, net / 7 * 1.1);
  assert.equal(q.parts.length, 2);
  assert.equal(q.total, q.parts[0].buy.cost + q.parts[1].buy.cost);
  assert.ok(q.parts.every(p => p.buy.amount >= p.need));
});

test('metric room: a single 10 L can beats a pile of small ones', () => {
  const { q } = answer('paint', { v: 'interior', m: { rl: 4, rw: 5, doors: 1 } }, 'metric');
  close(q.parts[0].need, (2 * 9 * 2.4 - 1.9) * 2 / 12 * 1.1);
  assert.equal(q.parts[0].headline, '1 × 10 L can');
});

test('your own label figures and prices override the typical ones', () => {
  const saved = { m: { dl: ft(10), dw: ft(10) }, f: { us: { '': { coverage: 200, coats: 2, waste: 0, 'stain.gal.price': 30, 'stain.qt.price': null } } } };
  const { q } = answer('stain', saved);
  close(q.parts[0].need, 1);
  assert.equal(q.parts[0].headline, '1 gallon');
  assert.equal(q.total, 30);
});

test('driveway sealer: pails for two coats', () => {
  const { q, summary } = answer('sealer', { m: { l: ft(60), w: ft(12) } });
  close(q.parts[0].need, 720 * 2 / 350 * 1.05);
  assert.equal(q.parts[0].headline, '5 pails');
  assert.equal(q.total, 175);
  assert.equal(summary, 'Driveway: 60 × 12 ft');
});

test('grass seed: rate by grass type and job, rounded to bag sizes', () => {
  const over = answer('seed', { m: { shape: 'area', a: sqft(5000) } });
  close(over.q.parts[0].need, 5000 * 3 / 1000 * 1.1, 1e-6);
  assert.equal(over.q.parts[0].headline, '1 × 20 lb bag');
  const fresh = answer('seed', { m: { shape: 'area', a: sqft(5000) }, c: { '': { job: 'new', grass: 'tall-fescue' } } });
  assert.equal(fresh.inputs.f.rate, 7);
  close(fresh.q.parts[0].need, 35 * 1.1);
  // Every grass has a rate both ways, and new lawns take more than overseeding.
  for (const [, , , us, si] of GRASSES) assert.ok(us[0] > us[1] && si[0] > si[1]);
  const metric = answer('seed', { m: { shape: 'area', a: 100 } }, 'metric');
  close(metric.q.parts[0].need, 100 * 15 / 1000 * 1.1);
  assert.match(metric.q.steps[1][1], /15 g per m² = 1.5 kg/);
});

test('from a job: warm-season seed switches the grass, the right variant opens', () => {
  const seed = calcById('seed');
  assert.deepEqual(applyRoute(seed, 'warm', {}), { choices: { grass: 'bermuda' } });
  assert.deepEqual(applyRoute(seed, 'warm', { c: { '': { grass: 'zoysia' } } }), {}, 'already a warm-season grass');
  assert.deepEqual(applyRoute(seed, 'cool', { c: { '': { grass: 'bermuda' } } }), { choices: { grass: 'mix' } });
  assert.deepEqual(applyRoute(calcById('fill'), 'compost'), { v: 'compost' });
  assert.deepEqual(applyRoute(calcById('fill'), 'nonsense'), {});
  // …and back the other way, the calculator links to the jobs it goes with.
  assert.deepEqual(jobsOf(calcById('paint'), 'interior'), []);
  assert.deepEqual(jobsOf(calcById('feed'), 'preventer'), ['preemergent']);
  assert.deepEqual(jobsOf(calcById('stain'), ''), ['deck-stain']);
  // Every job that links here points at a real calculator and variant.
  for (const job of JOBS.filter(j => j.buy)) {
    const [id, word] = job.buy.split('/');
    const calc = calcById(id);
    assert.ok(calc, `${job.id} → ${job.buy}`);
    if (word) assert.notDeepEqual(applyRoute(calc, word, {}), {}, `${job.id} → ${job.buy}`);
  }
});

test('fertilizer and crabgrass preventer: by bag coverage', () => {
  const { q } = answer('feed', { v: 'fertilizer', m: { shape: 'area', a: sqft(12000) } });
  close(q.parts[0].need, 12600, 1e-6);
  assert.equal(q.parts[0].headline, '1 × 15,000 sq ft bag');
  assert.equal(q.total, 60);
  const twice = answer('feed', { v: 'preventer', m: { shape: 'area', a: sqft(4000) }, f: { us: { preventer: { apps: 2 } } } });
  close(twice.q.parts[0].need, 8400, 1e-6);
  assert.equal(twice.q.parts[0].headline, '2 × 5,000 sq ft bags');
});

test('mulch: area × depth to cubic feet, bags and a loose load', () => {
  const { q, summary } = answer('fill', { v: 'mulch', m: { l: ft(20), w: ft(5) } });
  close(q.parts[0].need, 25 * 1.05);
  assert.equal(q.parts[0].headline, '13 × 2 cu ft bags + 1 × 0.5 cu ft bag');
  assert.equal(q.total, 60.5);
  assert.equal(q.bulk.amount, 1);
  assert.equal(q.bulk.cost, 38);
  assert.equal(summary, 'Mulch: 20 × 5 ft, 3 in deep');
  // A tree ring, and depth kept per material.
  const ring = answer('fill', { v: 'compost', m: { shape: 'circle', d: ft(6), 'depth-compost': inch(2) } });
  close(ring.q.parts[0].need, 9 * Math.PI * 2 / 12 * 1.05);
  const gravel = answer('fill', { v: 'gravel', m: { l: ft(30), w: ft(3) } });
  assert.match(gravel.q.parts[0].headline, /0.5 cu ft bags/);
  assert.ok(gravel.q.steps.some(([k]) => k === 'Weight'));
  assert.match(gravel.q.tips[0], /bags to haul/);
});

test('metric topsoil: litres, bags and cubic metres', () => {
  const { q } = answer('fill', { v: 'topsoil', m: { l: 4, w: 2 } }, 'metric');
  close(q.parts[0].need, 8 * 10 * 10 * 1.1);        // 8 m² × 10 cm = 800 L, +10%
  assert.equal(q.bulk.amount, 1);                     // 0.88 m³ → 1 m³ in quarter steps
  assert.ok(q.parts[0].buy.amount >= 880);
});

test('concrete: post holes and a slab', () => {
  const posts = answer('concrete', { v: 'posts', m: { holes: 8 } });
  const vol = 8 * (Math.PI * 25 - 3.5 ** 2) * 36 / 1728 * 1.1;
  close(posts.q.parts[0].need, vol);
  assert.ok(posts.q.parts[0].buy.amount >= vol);
  assert.equal(posts.q.total, 129.25);
  assert.ok(posts.q.tips.some(t => /1,640 lb of bags/.test(t)), posts.q.tips.join(' | '));
  assert.equal(posts.summary, '8 post holes, 10 in wide, 36 in deep');
  const slab = answer('concrete', { v: 'slab', m: { l: ft(10), w: ft(10) } });
  close(slab.q.parts[0].need, 100 * 4 / 12 * 1.1);
  assert.equal(slab.q.bulk.amount, 1.5);              // 1.36 cu yd → 1.5 in quarter-yard steps
  assert.match(slab.q.tips[0], /ready-mix/);
  const tooWide = answer('concrete', { v: 'posts', m: { holes: 2, hd: inch(4), post: inch(5) } });
  assert.match(tooWide.q.missing, /wider than the post/);
});

test('every calculator answers without NaN in either unit system', () => {
  const sample = { l: 5, w: 4, a: 50, d: 3, perim: 40, h: 5, gables: 2, gw: 8, gr: 3, rl: 4, rw: 3, rh: 2.4, dl: 4, dw: 5, rail: 12, steps: 3, sw: 1, fl: 20, fh: 1.8, holes: 4, hd: 25, hdep: 90, thick: 10 };
  for (const calc of CALCS) {
    for (const [v] of calc.variants || [['']]) {
      for (const units of ['us', 'metric']) {
        const m = { ...sample, [`depth-${v}`]: 7.5 };
        const inputs = inputsFor(calc, units, { v, m });
        const q = quote(calc, inputs, 'en-US');
        const text = JSON.stringify([q.steps, q.parts.map(p => p.headline), summaryOf(calc, inputs)]);
        assert.ok(!q.missing, `${calc.id}/${v}/${units}: ${q.missing}`);
        assert.ok(!/NaN|undefined|Infinity/.test(text), `${calc.id}/${v}/${units}: ${text}`);
        assert.ok(q.total > 0, `${calc.id}/${v}/${units} has a total`);
        for (const p of q.parts) assert.ok(p.buy.amount >= p.need - 1e-9);
      }
    }
  }
});
