// Everything is kept in this browser's localStorage. Nothing leaves the device
// except the coordinates sent to the weather service.

import { DEFAULT_PICKS } from './jobs.js';
import { guessUnits } from './units.js';

const KEY = 'gooddayfor:v1';
const FC_KEY = 'gooddayfor:forecast';
const FROST_KEY = 'gooddayfor:frost';

export const SCHEDULES = {
  any: { name: 'Any time', note: 'Daylight is still up to each job.' },
  evenings: { name: 'Evenings & weekends', note: 'Weekdays after 5 PM, all day Saturday and Sunday.' },
  weekends: { name: 'Weekends only', note: 'Saturday and Sunday.' },
  custom: { name: 'Pick my hours', note: 'Set the hours for each day.' },
};

// Sunday first, matching Date#getUTCDay.
const presetDays = {
  any: null,
  evenings: [[0, 24], [17, 24], [17, 24], [17, 24], [17, 24], [17, 24], [0, 24]],
  weekends: [[0, 24], null, null, null, null, null, [0, 24]],
};

export function availability(schedule) {
  if (!schedule || schedule.preset === 'any') return null;
  if (schedule.preset === 'custom') return schedule.days;
  return presetDays[schedule.preset] || null;
}

export function defaults() {
  return {
    units: guessUnits(),
    schedule: { preset: 'any', days: [[8, 20], [17, 21], [17, 21], [17, 21], [17, 21], [17, 21], [8, 20]] },
    place: null,
    recent: [],
    picks: [...DEFAULT_PICKS],
    edits: {},
    custom: {},
    calc: {},     // "How much to buy": what's typed into each calculator
    saved: [],    // …and measurements saved by name
    seen: false,
  };
}

export function load() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return defaults();
  }
  if (!isObj(saved)) return defaults();
  // If the checks themselves can't run (a browser missing something they use), take the
  // saves as they are: starting over here would write the defaults over them on the next change.
  try {
    return checked(saved);
  } catch {
    return { ...defaults(), ...saved };
  }
}

// What's kept is checked field by field on the way in. A field that isn't the shape
// the page writes (hand-edited, or damaged) goes back to its default on its own, so
// one bad value can't stop the page or take the rest of the saves with it. Nothing is
// written back until you change something.
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const num = x => (typeof x === 'number' ? x : typeof x === 'string' ? parseFloat(x) : NaN);
const objects = (x, fix = y => y) => (isObj(x) ? Object.fromEntries(Object.entries(x).filter(([, y]) => isObj(y)).map(([k, y]) => [k, fix(y)])) : {});

function asPlace(p) {
  if (!isObj(p)) return null;
  const lat = num(p.lat), lon = num(p.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { ...p, name: typeof p.name === 'string' && p.name ? p.name : 'My location', lat, lon };
}

const isHours = r => Array.isArray(r) && r.length === 2 && r.every(x => Number.isFinite(x) && x >= 0 && x <= 24);

function asSchedule(x, def) {
  if (!isObj(x)) return def;
  const preset = Object.keys(SCHEDULES).includes(x.preset) ? x.preset : def.preset;
  // A day with no hours (null) is a day you're not free.
  const days = Array.isArray(x.days) && x.days.length === 7 ? x.days.map((r, k) => (r === null || isHours(r) ? r : def.days[k])) : def.days;
  return { ...x, preset, days };
}

// Your own jobs and edited ones: kept as long as there are rules to check.
const asJobs = x => Object.fromEntries(Object.entries(objects(x))
  .filter(([, job]) => Array.isArray(job.rules))
  .map(([id, job]) => [id, { ...job, id: typeof job.id === 'string' ? job.id : id, rules: job.rules.filter(isObj) }]));

// A calculator's inputs: { v, m: {…}, c: { [variant]: {…} }, f: { us|metric: { [variant]: {…} } } }.
const asInputs = c => ({ ...c, m: isObj(c.m) ? c.m : {}, c: objects(c.c), f: objects(c.f, objects) });

function checked(saved) {
  const def = defaults();
  return {
    ...def,
    ...saved,
    units: saved.units === 'us' || saved.units === 'metric' ? saved.units : def.units,
    schedule: asSchedule(saved.schedule, def.schedule),
    place: asPlace(saved.place),
    recent: Array.isArray(saved.recent) ? saved.recent.map(asPlace).filter(Boolean) : def.recent,
    picks: Array.isArray(saved.picks) ? saved.picks.filter(id => typeof id === 'string') : def.picks,
    edits: asJobs(saved.edits),
    custom: asJobs(saved.custom),
    calc: objects(saved.calc, asInputs),
    saved: Array.isArray(saved.saved) ? saved.saved.filter(x => isObj(x) && typeof x.calc === 'string' && typeof x.name === 'string').map(asInputs) : def.saved,
  };
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode or full */ }
}

// Every series weather.js's normalize() keeps, hour by hour.
const SERIES = ['time', 'temp', 'rh', 'dew', 'precip', 'pop', 'snow', 'code', 'cloud', 'wind', 'gust', 'soil6', 'soil18', 'vpd', 'et0'];

export function loadForecast(key) {
  try {
    const fc = JSON.parse(localStorage.getItem(FC_KEY) || 'null');
    // Only a copy of what the weather service sent, so anything not shaped the way
    // the page writes it is simply fetched again.
    const ok = isObj(fc) && fc.key === key && Number.isFinite(fc.fetchedAt)
      && SERIES.every(k => Array.isArray(fc[k])) && fc.time.length > 0 && fc.time.every(t => typeof t === 'string')
      && Array.isArray(fc.days) && fc.days.every(d => isObj(d) && typeof d.date === 'string');
    return ok ? fc : null;
  } catch {
    return null;
  }
}

export function saveForecast(fc) {
  try { localStorage.setItem(FC_KEY, JSON.stringify(fc)); } catch { /* fine */ }
}

// Frost dates, per place. They only change once a year, so a few places are
// kept (the sums, not the 30 years of data behind them).
export function loadFrost(key) {
  try {
    const all = JSON.parse(localStorage.getItem(FROST_KEY) || '[]');
    return (Array.isArray(all) ? all : []).find(e => e && e.key === key) || null;
  } catch {
    return null;
  }
}

export function saveFrost(entry) {
  try {
    let all = JSON.parse(localStorage.getItem(FROST_KEY) || '[]');
    if (!Array.isArray(all)) all = [];
    all = [entry, ...all.filter(e => e && e.key !== entry.key)].slice(0, 5);
    localStorage.setItem(FROST_KEY, JSON.stringify(all));
  } catch { /* fine */ }
}

export function clearAll() {
  try { [KEY, FC_KEY, FROST_KEY].forEach(k => localStorage.removeItem(k)); } catch { /* fine */ }
}
