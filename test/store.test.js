import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeForecast } from './fixture.js';
import { normalize, placeKey } from '../js/weather.js';
import { DEFAULT_PICKS } from '../js/jobs.js';

// The browser's localStorage, kept in memory.
const mem = new Map();
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
const store = await import('../js/store.js');

const put = (key, value) => mem.set(key, JSON.stringify(value));
const COLUMBUS = { name: 'Columbus', admin: 'Ohio', country: 'United States', cc: 'US', lat: 39.96, lon: -83 };
const MINE = { id: 'my-1', group: 'mine', icon: '🐕', name: 'Walk the dog', hours: 1, rules: [{ t: 'dry', lvl: 'must' }] };
beforeEach(() => mem.clear());

test('saves the page wrote come back exactly as they were', () => {
  const state = {
    ...store.defaults(), units: 'metric', place: COLUMBUS, recent: [COLUMBUS], picks: ['mow', 'my-1'],
    schedule: { preset: 'custom', days: [[8, 20], null, [17, 21], [21, 5], null, [17, 21], [0, 24]] },
    edits: { mow: { ...MINE, id: 'mow', name: 'Mow the lawn' } }, custom: { 'my-1': MINE },
    calc: { stain: { m: { dl: 3.6 }, c: { '': { wood: 'new' } }, f: { us: { '': { coverage: 200 } } } } },
    saved: [{ calc: 'stain', name: 'Deck', v: undefined, m: { dl: 3.6 }, c: {}, f: {}, at: 1 }],
    seen: true, later: 'a field from a newer version',
  };
  store.save(state);
  assert.deepEqual(store.load(), JSON.parse(JSON.stringify(state)));
});

test('a browser without something the checks use still gets every save back', () => {
  const state = {
    ...store.defaults(), place: COLUMBUS, picks: ['mow', 'my-1'], custom: { 'my-1': MINE },
    schedule: { preset: 'evenings', days: [[8, 20], [21, 5], [17, 21], [17, 21], [17, 21], [17, 21], [8, 20]] },
    saved: [{ calc: 'stain', name: 'Deck', m: { dl: 3.6 }, c: {}, f: {}, at: 1 }],
  };
  store.save(state);
  const kept = ['hasOwn', 'fromEntries'].map(k => [k, Object.getOwnPropertyDescriptor(Object, k)]);
  try {
    delete Object.hasOwn; // Safari before 15.4
    assert.deepEqual(store.load(), JSON.parse(JSON.stringify(state)));
    delete Object.fromEntries; // older still: the checks can't run, so the saves come back unchecked
    assert.deepEqual(store.load(), JSON.parse(JSON.stringify(state)));
  } finally {
    for (const [k, d] of kept) Object.defineProperty(Object, k, d);
  }
});

test('a wrong-typed field goes back to its default, and the rest survives', () => {
  put('gooddayfor:v1', {
    place: COLUMBUS, units: 'metric', schedule: null, picks: null, recent: null, saved: null, calc: null, custom: null,
    edits: { mow: { name: 'No rules' }, laundry: { ...MINE, id: 'laundry', rules: [null, { t: 'dry' }] } },
  });
  const s = store.load();
  assert.deepEqual(s.place, COLUMBUS);
  assert.equal(s.units, 'metric');
  assert.equal(s.schedule.preset, 'any');
  assert.equal(s.schedule.days.length, 7);
  assert.deepEqual(s.picks, DEFAULT_PICKS);
  assert.deepEqual([s.recent, s.saved, s.calc, s.custom], [[], [], {}, {}]);
  assert.equal(s.edits.mow, undefined, 'an edited job with no rules falls back to the built-in one');
  assert.deepEqual(s.edits.laundry.rules, [{ t: 'dry' }]);
});

test('a schedule, a place and saved measurements are checked inside too', () => {
  put('gooddayfor:v1', {
    schedule: { preset: 'custom' }, place: { name: 'Nowhere', lat: 'x' },
    recent: [COLUMBUS, null, { name: 'Bad' }, { lat: '40.1', lon: '-82.9' }],
    calc: { stain: { m: 5, c: { '': 'new', v: { wood: 'new' } }, f: { us: 3, metric: { '': 4, x: { coverage: 6 } } } }, paint: null },
    saved: [{ calc: 'stain', name: 'Deck', m: { dl: 3 } }, { calc: 'stain' }, 'x'],
  });
  const s = store.load();
  assert.equal(s.schedule.preset, 'custom');
  assert.equal(s.schedule.days.length, 7, 'custom hours with no days get the starting ones');
  put('gooddayfor:v1', { schedule: { preset: 'nonsense', days: [[8, 20], 'x', null, [3, 99], [17, 21], [17, 21], [8, 20]] } });
  const t = store.load();
  assert.equal(t.schedule.preset, 'any');
  assert.deepEqual(t.schedule.days, [[8, 20], [17, 21], null, [17, 21], [17, 21], [17, 21], [8, 20]]);
  assert.equal(s.place, null, 'a place with no coordinates has to be picked again');
  assert.deepEqual(s.recent.map(p => [p.name, p.lat, p.lon]), [['Columbus', 39.96, -83], ['My location', 40.1, -82.9]]);
  assert.deepEqual(s.calc, { stain: { m: {}, c: { v: { wood: 'new' } }, f: { metric: { x: { coverage: 6 } } } } });
  assert.deepEqual(s.saved.map(x => x.name), ['Deck']);
});

test('not JSON, or not an object, starts over', () => {
  mem.set('gooddayfor:v1', '{nope');
  assert.deepEqual(store.load().picks, DEFAULT_PICKS);
  put('gooddayfor:v1', [1, 2]);
  assert.equal(store.load().place, null);
});

test('a kept forecast is used only if it has the shape the page writes', () => {
  const key = placeKey(COLUMBUS);
  const fc = { ...normalize(makeForecast()), fetchedAt: Date.now(), key };
  store.saveForecast(fc);
  assert.deepEqual(store.loadForecast(key), JSON.parse(JSON.stringify(fc)));
  assert.equal(store.loadForecast('0.000,0.000'), null, 'another place');
  for (const broken of [{ days: undefined }, { days: [null] }, { time: 'x' }, { time: [] }, { temp: null }, { fetchedAt: 'yesterday' }]) {
    put('gooddayfor:forecast', { ...fc, ...broken });
    assert.equal(store.loadForecast(key), null, JSON.stringify(Object.keys(broken)));
  }
  put('gooddayfor:forecast', 'x');
  assert.equal(store.loadForecast(key), null);
});
