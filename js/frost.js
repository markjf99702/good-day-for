// Frost dates from decades of weather history.
//
// For each year it finds the last night in spring and the first night in fall
// when the air got down to 32°F (0°C, a frost) and 28°F (−2.2°C, a hard
// freeze). Then it sums the years up the way gardeners use them: the typical
// (median) date, and the date that only 1 year in 10 goes past.
//
// Pure functions: ISO dates ("2025-04-20") and °C in, nothing about the page.
//
// A "season" runs midwinter to midwinter so a winter's frosts are never cut in
// two: January 1 to December 31 in the north, July 1 to June 30 in the south.
// Spring is the part before August 1 (in the south, before February 1), the
// same split the US weather service uses for its freeze dates.

import { fromF } from './units.js';

export const FROST = 0;          // 32°F
export const HARD = fromF(28);   // −2.2°C
export const YEARS = 30;
export const VERSION = 1;        // bump when the sums change, so cached results get redone

const DAY = 864e5;
const ms = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const iso = t => new Date(t).toISOString().slice(0, 10);
export const addDays = (d, n) => iso(ms(d) + n * DAY);
export const daysBetween = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
const leap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// The season a date belongs to (named for the year it starts in), and which half.
export function seasonOf(date, south) {
  const y = +date.slice(0, 4), m = +date.slice(5, 7);
  if (!south) return { y, spring: m < 8 };
  if (m >= 7) return { y, spring: true };
  return { y: y - 1, spring: m < 2 };
}
export const seasonStart = (y, south) => (south ? `${y}-07-01` : `${y}-01-01`);
export const seasonEnd = (y, south) => (south ? `${y + 1}-06-30` : `${y}-12-31`);
export const seasonName = (y, south) => (south ? `${y}–${String(y + 1).slice(2)}` : String(y));

// The most recent complete seasons. The archive runs about five days behind,
// so a season counts once it has been over for a week.
export function historyRange(today, lat, years = YEARS) {
  const south = lat < 0;
  const ready = addDays(today, -7);
  let y = +ready.slice(0, 4);
  while (seasonEnd(y, south) > ready) y--;
  return { start: seasonStart(y - years + 1, south), end: seasonEnd(y, south), south, first: y - years + 1, last: y };
}

// ——— Positions within a season ———
// Days since the season started, on a fixed leap-year calendar so April 20 is
// the same number every year (and February 29 has a place).

export const SEASON_DAYS = 366;
const refStart = south => (south ? Date.UTC(2003, 6, 1) : Date.UTC(2000, 0, 1));

export function dayOfSeason(date, south) {
  const m = +date.slice(5, 7), d = +date.slice(8, 10);
  const y = south ? (m >= 7 ? 2003 : 2004) : 2000;
  return Math.round((Date.UTC(y, m - 1, d) - refStart(south)) / DAY);
}

// Back again: day of season → "MM-DD".
export function monthDayOf(idx, south) {
  const k = ((Math.round(idx) % SEASON_DAYS) + SEASON_DAYS) % SEASON_DAYS;
  return iso(refStart(south) + k * DAY).slice(5);
}

// The real date for a day of the season in a given season year.
export function dateIn(y, idx, south) {
  const md = monthDayOf(idx, south);
  const year = south && +md.slice(0, 2) < 7 ? y + 1 : y;
  return `${year}-${md === '02-29' && !leap(year) ? '02-28' : md}`;
}

// Month starts for drawing a season: [{ idx, month (1–12) }].
export function monthTicks(south) {
  return Array.from({ length: 12 }, (_, k) => {
    const month = ((south ? 6 : 0) + k) % 12 + 1;
    return { idx: dayOfSeason(`2000-${String(month).padStart(2, '0')}-01`, south), month };
  });
}

// ——— From the archive to per-season dates ———

// One entry per season: the last spring and first fall dates at or below each
// threshold (null when it never got that cold), the coldest night, which months
// had a frost, and whether the season is complete enough to count.
export function seasonsFrom(daily, south) {
  const t = daily?.time || [], v = daily?.temperature_2m_min || [];
  const map = new Map();
  for (let i = 0; i < t.length; i++) {
    const d = t[i];
    const { y, spring } = seasonOf(d, south);
    let s = map.get(y);
    if (!s) map.set(y, s = { y, days: 0, missing: 0, lf: null, lh: null, ff: null, fh: null, low: null, lowOn: null, months: 0 });
    s.days++;
    const x = v[i];
    if (x == null) { s.missing++; continue; }
    if (s.low == null || x < s.low) { s.low = x; s.lowOn = d; }
    if (x <= FROST) s.months |= 1 << (+d.slice(5, 7) - 1);
    if (spring) {
      if (x <= FROST) s.lf = d;
      if (x <= HARD) s.lh = d;
    } else {
      if (x <= FROST && !s.ff) s.ff = d;
      if (x <= HARD && !s.fh) s.fh = d;
    }
  }
  return [...map.values()].map(s => {
    const want = daysBetween(seasonStart(s.y, south), seasonEnd(s.y, south)) + 1;
    // Count a season only if it's all there, give or take a few missing days.
    return { ...s, ok: s.days === want && s.missing <= want * 0.05 };
  }).sort((a, b) => a.y - b.y);
}

// Average daily low for each month (index 0 = January), for places with no frost.
export function monthlyLows(daily) {
  const sum = new Array(12).fill(0), n = new Array(12).fill(0);
  (daily?.time || []).forEach((d, i) => {
    const x = daily.temperature_2m_min[i];
    if (x == null) return;
    const m = +d.slice(5, 7) - 1;
    sum[m] += x;
    n[m]++;
  });
  return sum.map((s, m) => (n[m] ? Math.round(s / n[m] * 10) / 10 : null));
}

// What gets cached per place: small, and enough to redo the sums.
export function frostEntry(raw, key, range, now = Date.now()) {
  const seasons = seasonsFrom(raw.daily, range.south);
  return {
    v: VERSION, key, start: range.start, end: range.end, south: range.south, fetchedAt: now,
    tz: raw.timezone || null, elevation: raw.elevation ?? null, grid: [raw.latitude ?? null, raw.longitude ?? null],
    seasons: seasons.map(({ y, ok, lf, ff, lh, fh, low, lowOn, months, missing }) => ({ y, ok, lf, ff, lh, fh, low, lowOn, months, missing })),
    monthly: monthlyLows(raw.daily),
  };
}

// ——— Summing the years up ———

// Quantile of sorted numbers, straight-line between neighbours. ±Infinity
// stands for "no frost that year" and is never averaged with a real date.
export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  const a = sorted[lo], b = sorted[hi];
  if (a === b) return a;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return pos - lo < 0.5 ? a : b;
  return a + (b - a) * (pos - lo);
}

const finite = x => (Number.isFinite(x) ? Math.round(x) : null);

function threshold(ok, south, lastKey, firstKey) {
  const at = d => dayOfSeason(d, south);
  const last = ok.map(s => (s[lastKey] ? at(s[lastKey]) : -Infinity)).sort((a, b) => a - b);
  const first = ok.map(s => (s[firstKey] ? at(s[firstKey]) : Infinity)).sort((a, b) => a - b);
  const lastSeen = ok.filter(s => s[lastKey]).sort((a, b) => at(a[lastKey]) - at(b[lastKey]));
  const firstSeen = ok.filter(s => s[firstKey]).sort((a, b) => at(a[firstKey]) - at(b[firstKey]));
  // Frost-free days: after the last spring frost, before the first fall one.
  // A season with no spring frost counts from its start; no fall frost, to its end.
  const lens = ok.map(s => {
    const from = s[lastKey] || addDays(seasonStart(s.y, south), -1);
    const to = s[firstKey] || addDays(seasonEnd(s.y, south), 1);
    return daysBetween(from, to) - 1;
  }).sort((a, b) => a - b);
  const among = list => finite(quantile(list.filter(Number.isFinite), 0.5));
  return {
    seasons: ok.length,
    withAny: ok.filter(s => s[lastKey] || s[firstKey]).length,
    last: {
      count: lastSeen.length,
      median: finite(quantile(last, 0.5)),     // half of years are later than this
      p90: finite(quantile(last, 0.9)),        // 1 year in 10 is later than this
      among: among(last),                      // typical, counting only years that had one
      earliest: lastSeen[0]?.[lastKey] || null,
      latest: lastSeen.at(-1)?.[lastKey] || null,
    },
    first: {
      count: firstSeen.length,
      median: finite(quantile(first, 0.5)),
      p10: finite(quantile(first, 0.1)),       // 1 year in 10 is earlier than this
      among: among(first),
      earliest: firstSeen[0]?.[firstKey] || null,
      latest: firstSeen.at(-1)?.[firstKey] || null,
    },
    days: { median: finite(quantile(lens, 0.5)), p10: finite(quantile(lens, 0.1)), shortest: lens[0] ?? null, longest: lens.at(-1) ?? null },
  };
}

// Everything the page shows, from a cached entry.
//   regime: normal  frost most years: typical dates exist
//           mild    frost in some years only, so "typical" is no frost at all
//           none    no frost in all those years
//           thin    not enough complete years to say
export function summarize(entry) {
  const south = !!entry.south;
  const ok = (entry.seasons || []).filter(s => s.ok);
  const frost = threshold(ok, south, 'lf', 'ff');
  const hard = threshold(ok, south, 'lh', 'fh');
  let coldest = null;
  for (const s of ok) if (s.low != null && (!coldest || s.low < coldest.v)) coldest = { v: s.low, on: s.lowOn };
  const months = ok.reduce((m, s) => m | s.months, 0);
  let regime = 'normal';
  if (ok.length < 10) regime = 'thin';
  else if (!frost.withAny) regime = 'none';
  else if (frost.last.median == null || frost.first.median == null) regime = 'mild';
  return {
    south, regime, n: ok.length, first: ok[0]?.y ?? null, last: ok.at(-1)?.y ?? null,
    frost, hard, coldest,
    anyMonth: months === 0xfff,            // frost has come in every month of the year
    frostMonths: months,
    monthly: entry.monthly || [],
    skipped: (entry.seasons || []).length - ok.length,
  };
}

// The two dates the planting calendar hangs on, as days of the season, or
// null when frost is too rare to plan around.
export function anchors(sum) {
  if (sum.regime === 'normal') return { L: sum.frost.last.median, F: sum.frost.first.median };
  if (sum.regime !== 'mild') return null;
  const L = sum.frost.last.median ?? (sum.frost.last.count >= 3 ? sum.frost.last.among : null);
  const F = sum.frost.first.median ?? (sum.frost.first.count >= 3 ? sum.frost.first.among : null);
  return L != null && F != null ? { L, F } : null;
}

// The cooler months, for a place without frost: those whose average low is
// below the year's average low, as a run of month numbers (1–12) that may wrap.
export function coolMonths(monthly) {
  if (!monthly?.length || monthly.some(x => x == null)) return [];
  const avg = monthly.reduce((s, x) => s + x, 0) / 12;
  const cool = monthly.map((x, i) => x < avg);
  // Start the run just after a warm month so it reads in order across the new year.
  const start = cool.findIndex((c, i) => c && !cool[(i + 11) % 12]);
  if (start < 0) return [];
  const out = [];
  for (let k = 0; k < 12 && cool[(start + k) % 12]; k++) out.push((start + k) % 12 + 1);
  return out;
}
