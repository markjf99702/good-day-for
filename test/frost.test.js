import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeArchive, NORTH_FROST, SOUTH_FROST, NO_FROST } from './fixture.js';
import {
  historyRange, seasonOf, dayOfSeason, monthDayOf, dateIn, monthTicks, seasonsFrom, frostEntry, summarize, anchors,
  quantile, coolMonths, addDays, daysBetween, HARD, SEASON_DAYS,
} from '../js/frost.js';
import { CROPS, calendar, segments, stepSpan, windowsNear, weekPlan, seasonFor, say } from '../js/planting.js';
import { byId } from '../js/jobs.js';
import { historyUrl } from '../js/weather.js';

const md = (d, n) => addDays(`2001-${d}`, n).slice(5);

// 30 northern seasons with known dates: last frosts Apr 1…Apr 30 and first
// frosts Oct 1…Oct 30, handed out to the years in a scrambled order.
const order = y => (y * 7) % 30;
const north30 = y => {
  const k = order(y - 1996);
  return { lf: md('04-01', k), lh: md('04-01', k - 10), ff: md('10-01', k), fh: md('10-01', k + 10) };
};
const summaryOf = (opts, range) => {
  const raw = makeArchive({ start: range.start, end: range.end, ...opts });
  return summarize(frostEntry(raw, 'here', range));
};
const NORTH = historyRange('2026-09-27', 40);
const SOUTH = historyRange('2026-09-27', -35);

test('history covers the 30 latest complete seasons, once the archive has caught up', () => {
  assert.deepEqual(historyRange('2026-09-27', 40), { start: '1996-01-01', end: '2025-12-31', south: false, first: 1996, last: 2025 });
  // Early January: last year isn't in the archive yet.
  assert.equal(historyRange('2026-01-05', 40).end, '2024-12-31');
  assert.equal(historyRange('2026-01-08', 40).end, '2025-12-31');
  // The south runs July to June.
  assert.deepEqual(historyRange('2026-09-27', -35), { start: '1996-07-01', end: '2026-06-30', south: true, first: 1996, last: 2025 });
  assert.equal(historyRange('2026-07-03', -35).end, '2025-06-30');
  const url = new URL(historyUrl(39.96, -83, '1996-01-01', '2025-12-31'));
  assert.equal(url.origin + url.pathname, 'https://archive-api.open-meteo.com/v1/archive');
  assert.equal(url.searchParams.get('daily'), 'temperature_2m_min');
  assert.equal(url.searchParams.get('start_date'), '1996-01-01');
});

test('days of the season: a fixed calendar, wrapping in the south', () => {
  assert.equal(dayOfSeason('2023-01-01', false), 0);
  assert.equal(dayOfSeason('2023-03-01', false), dayOfSeason('2024-03-01', false), 'leap years line up');
  assert.equal(dayOfSeason('2023-12-31', false), 365);
  assert.equal(dayOfSeason('2023-07-01', true), 0);
  assert.equal(dayOfSeason('2024-06-30', true), 365);
  assert.equal(monthDayOf(dayOfSeason('2020-04-20', false), false), '04-20');
  assert.equal(monthDayOf(dayOfSeason('2021-01-05', true), true), '01-05');
  assert.equal(monthDayOf(-1, false), '12-31', 'wraps');
  assert.equal(dateIn(2025, dayOfSeason('2000-02-29', false), false), '2025-02-28', 'no Feb 29 in 2025');
  assert.equal(dateIn(2025, dayOfSeason('2000-10-02', true), true), '2025-10-02');
  assert.equal(dateIn(2025, dayOfSeason('2000-04-20', true), true), '2026-04-20', 'southern fall is next calendar year');
  assert.deepEqual(seasonOf('2026-01-15', true), { y: 2025, spring: true });
  assert.deepEqual(seasonOf('2026-02-01', true), { y: 2025, spring: false });
  assert.deepEqual(seasonOf('2026-08-01', false), { y: 2026, spring: false });
  assert.deepEqual(monthTicks(true).map(t => t.month), [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6]);
  assert.equal(monthTicks(false)[3].idx, dayOfSeason('2000-04-01', false));
});

test('quantiles treat "no frost that year" as beyond every date', () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9.1);
  assert.equal(quantile([-Infinity, -Infinity, 5, 6], 0.5), -Infinity === quantile([-Infinity, -Infinity, 5, 6], 0.5) ? -Infinity : 5);
  assert.equal(quantile([-Infinity, 3, 5], 0.5), 3);
  assert.equal(quantile([], 0.5), null);
});

test('northern frost dates: median, 1 year in 10, earliest and latest, hard freeze, season length', () => {
  const s = summaryOf({ dates: north30 }, NORTH);
  assert.equal(s.regime, 'normal');
  assert.equal(s.n, 30);
  assert.equal([s.first, s.last].join(), '1996,2025');
  const d = i => monthDayOf(i, false);
  // Apr 1…Apr 30: the median falls between the 15th and 16th, 1 in 10 later than the 27th.
  assert.equal(d(s.frost.last.median), '04-16');
  assert.equal(d(s.frost.last.p90), '04-27');
  assert.equal(s.frost.last.earliest.slice(5), '04-01');
  assert.equal(s.frost.last.latest.slice(5), '04-30');
  // Oct 1…Oct 30: 1 in 10 earlier than the 4th.
  assert.equal(d(s.frost.first.median), '10-16');
  assert.equal(d(s.frost.first.p10), '10-04');
  // Each year's frost-free stretch is Apr 1+k to Oct 1+k: 182 days between.
  assert.deepEqual(s.frost.days, { median: 182, p10: 182, shortest: 182, longest: 182 });
  assert.equal(d(s.hard.last.median), '04-06');
  assert.equal(d(s.hard.first.median), '10-26');
  assert.ok(s.hard.days.median > s.frost.days.median);
  assert.deepEqual(anchors(s), { L: s.frost.last.median, F: s.frost.first.median });
  assert.equal(s.anyMonth, false);
});

test('each year: last spring and first fall dates at each threshold', () => {
  const raw = makeArchive({ start: '2020-01-01', end: '2021-12-31', dates: y => (y === 2020 ? { lf: '05-02', lh: '04-11', ff: '10-09', fh: '11-01' } : { lf: '04-20', lh: '04-20', ff: null, fh: null }) });
  const [a, b] = seasonsFrom(raw.daily, false);
  assert.deepEqual([a.lf, a.lh, a.ff, a.fh, a.ok], ['2020-05-02', '2020-04-11', '2020-10-09', '2020-11-01', true]);
  assert.deepEqual([b.lf, b.lh, b.ff, b.fh], ['2021-04-20', '2021-04-20', null, null]);
  assert.ok(a.low <= HARD);
  // A night at exactly 0.0°C counts as a frost; −2.2°C isn't quite 28°F.
  const edge = { time: ['2022-05-01', '2022-05-02', '2022-05-03'], temperature_2m_min: [0, -2.2, 5] };
  const [e] = seasonsFrom(edge, false);
  assert.equal(e.lf, '2022-05-02');
  assert.equal(e.lh, null);
  assert.equal(e.ok, false, 'three days is not a season');
});

test('southern hemisphere: seasons wrap the new year, spring frosts can land in January', () => {
  const dates = y => {
    if (y === 2010) return { lf: '01-05', lh: '09-01', ff: '04-10', fh: '05-01' };   // a freak frost on Jan 5, 2011
    return { lf: md('09-15', y % 20), lh: md('09-01', y % 20), ff: md('04-20', y % 15), fh: md('05-10', y % 15) };
  };
  const raw = makeArchive({ start: SOUTH.start, end: SOUTH.end, lat: -35.3, lon: 149.1, tz: 'Australia/Sydney', dates });
  const seasons = seasonsFrom(raw.daily, true);
  assert.equal(seasons.length, 30);
  const odd = seasons.find(s => s.y === 2010);
  assert.equal(odd.lf, '2011-01-05', 'January still counts as spring');
  assert.equal(odd.ff, '2011-04-10');
  const s = summarize(frostEntry(raw, 'canberra', SOUTH));
  assert.equal(s.south, true);
  assert.equal(s.regime, 'normal');
  assert.equal(s.frost.last.latest, '2011-01-05');
  const last = monthDayOf(s.frost.last.median, true), first = monthDayOf(s.frost.first.median, true);
  assert.match(last, /^(09|10)-/);
  assert.match(first, /^(04|05)-/);
  // A frost-free season runs from spring into the next calendar year.
  const plain = seasons.find(x => x.y === 2001);
  const len = daysBetween(plain.lf, plain.ff) - 1;
  assert.ok(len > 150 && len < 260, `${plain.lf} → ${plain.ff}: ${len}`);
  assert.equal(daysBetween('2011-01-05', '2011-04-10') - 1, 94);
  assert.equal(s.frost.days.shortest, 94);
});

test('no frost at all: says so, with the coldest night and the cool months', () => {
  const raw = makeArchive({ start: '1996-07-01', end: '2026-06-30', lat: -33.87, lon: 151.2, dates: NO_FROST, mean: 14, amp: 5 });
  const s = summarize(frostEntry(raw, 'sydney', { ...SOUTH }));
  assert.equal(s.regime, 'none');
  assert.equal(s.frost.withAny, 0);
  assert.equal(s.frost.last.median, null);
  assert.equal(anchors(s), null);
  assert.ok(s.coldest.v > 0);
  assert.deepEqual(s.frost.days.median, 365);
  const cool = coolMonths(s.monthly);
  assert.ok(cool.includes(7) && !cool.includes(1), cool.join());
  assert.deepEqual(coolMonths([1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2]), [11, 12, 1, 2, 3], 'the run wraps the new year');
});

test('frost in only some winters: typical is "no frost", the calendar uses the years that had one', () => {
  const dates = y => (y % 3 === 0 ? { lf: md('01-20', y % 10), lh: null, ff: md('12-15', y % 10), fh: null } : NO_FROST());
  const s = summaryOf({ dates, mean: 12, amp: 6 }, NORTH);
  assert.equal(s.regime, 'mild');
  assert.equal(s.frost.withAny, 10);
  assert.equal(s.frost.last.median, null);
  assert.equal(s.frost.last.count, 10);
  const a = anchors(s);
  assert.ok(a, 'enough frost years to plan around');
  assert.match(monthDayOf(a.L, false), /^01-/);
  assert.match(monthDayOf(a.F, false), /^12-/);
  // 1 year in 10 still goes past a date when a third of years have frost.
  assert.notEqual(s.frost.last.p90, null);
  assert.equal(s.hard.withAny, 0);
});

test('missing data: gappy and partial seasons are left out, not guessed at', () => {
  const gaps = d => (d.startsWith('2003-') && d.slice(5, 7) <= '02') || (d.startsWith('2010-06') && d.slice(8) <= '05');
  const raw = makeArchive({ start: '1996-01-01', end: '2026-03-31', dates: NORTH_FROST, missing: gaps });
  const e = frostEntry(raw, 'here', NORTH);
  const bad = e.seasons.filter(s => !s.ok).map(s => s.y);
  assert.deepEqual(bad, [2003, 2026], '59 missing days sinks 2003; 2026 isn’t finished');
  assert.equal(e.seasons.find(s => s.y === 2010).ok, true, 'five missing days is fine');
  const s = summarize(e);
  assert.equal(s.n, 29);
  assert.equal(s.skipped, 2);
  // Hardly anything: too thin to say.
  const thin = summarize(frostEntry(makeArchive({ start: '2019-01-01', end: '2025-12-31' }), 'x', NORTH));
  assert.equal(thin.regime, 'thin');
  assert.equal(summarize({ seasons: [] }).regime, 'thin');
  assert.equal(summarize(frostEntry({ daily: {} }, 'x', NORTH)).n, 0, 'an empty response');
});

test('the cached entry is small', () => {
  const raw = makeArchive({ start: NORTH.start, end: NORTH.end });
  const e = frostEntry(raw, '39.960,-83.000', NORTH, 123);
  assert.equal(e.key, '39.960,-83.000');
  assert.equal(e.fetchedAt, 123);
  assert.equal(e.tz, 'America/New_York');
  assert.ok(JSON.stringify(e).length < 8000, `${JSON.stringify(e).length} bytes`);
});

// ——— The planting calendar ———

const L = dayOfSeason('2000-04-16', false), F = dayOfSeason('2000-10-30', false);

test('calendar rows: weeks either side of the frost dates', () => {
  const rows = calendar({ L, F });
  const tomatoes = rows.find(r => r.crop.id === 'tomatoes');
  assert.deepEqual(tomatoes.bars.map(b => [b.step.k, monthDayOf(b.a, false), monthDayOf(b.b, false)]), [
    ['indoors', '02-20', '03-05'],
    ['plant', '04-23', '05-07'],
  ]);
  const garlic = rows.find(r => r.crop.id === 'garlic');
  assert.deepEqual(garlic.bars.map(b => [monthDayOf(b.a, false), monthDayOf(b.b, false)]), [['10-16', '11-20']]);
  // Beans run from after the last frost to 10 weeks before the first; no room in a short season.
  assert.ok(stepSpan(CROPS.find(c => c.id === 'beans').steps[0], { L, F }));
  assert.equal(stepSpan(CROPS.find(c => c.id === 'beans').steps[0], { L: 150, F: 200 }), null);
  for (const crop of CROPS) for (const step of crop.steps) assert.ok(say(step), `${crop.id} has words`);
  for (const crop of CROPS.filter(c => c.job)) assert.ok(byId(crop.job), `${crop.id} → ${crop.job}`);
});

test('bars fold into one season and split where they wrap', () => {
  assert.deepEqual(segments(10, 20), [[10, 20]]);
  assert.deepEqual(segments(-14, 5), [[352, 365], [0, 5]]);
  assert.deepEqual(segments(360, 370), [[360, 365], [0, 4]]);
  assert.deepEqual(segments(0, 400), [[0, 365]]);
  assert.equal(SEASON_DAYS, 366);
});

test('this week: what’s in season now, and what’s coming', () => {
  const plan = weekPlan({ L, F }, false, '2026-09-27');
  const now = plan.now.map(x => `${x.crop.id}:${say(x.step)}`);
  assert.ok(now.includes('overseed:Overseed'), now.join());
  assert.ok(now.includes('greens:Sow for fall'), now.join());
  assert.ok(!now.some(x => x.startsWith('tomatoes')), 'no tomatoes in September');
  assert.ok(now.includes('bulbs:Plant bulbs'), 'bulbs start on Friday');
  const soon = plan.soon.map(x => x.crop.id);
  assert.deepEqual(soon, ['garlic']);
  // Closing soonest comes first.
  assert.deepEqual(plan.now.map(x => x.end), [...plan.now.map(x => x.end)].sort());
  assert.equal(plan.weekEnd, '2026-10-03');
  for (const x of plan.now) assert.ok(x.start <= plan.weekEnd && x.end >= '2026-09-27');
});

test('year wrap: an early last frost puts seed-starting in the December before', () => {
  const anc = { L: dayOfSeason('2000-02-10', false), F: dayOfSeason('2000-12-05', false) };
  const tomato = CROPS.find(c => c.id === 'tomatoes').steps[0];
  const w = windowsNear(tomato, anc, false, '2026-12-20');
  assert.ok(w.some(x => x.start === '2026-12-16' && x.end === '2026-12-30'), JSON.stringify(w));
  const plan = weekPlan(anc, false, '2026-12-20');
  assert.ok(plan.now.some(x => x.crop.id === 'tomatoes' && x.step.k === 'indoors'));
});

test('southern hemisphere planting: spring in September, garlic in autumn', () => {
  const anc = { L: dayOfSeason('2000-09-28', true), F: dayOfSeason('2000-05-02', true) };
  const plan = weekPlan(anc, true, '2026-10-01');
  assert.ok(plan.now.some(x => x.crop.id === 'tomatoes' && x.step.k === 'plant') || plan.soon.some(x => x.crop.id === 'tomatoes'), 'tomatoes go out in October');
  const garlic = windowsNear(CROPS.find(c => c.id === 'garlic').steps[0], anc, true, '2026-10-01');
  assert.ok(garlic.some(x => x.start.startsWith('2027-04')), JSON.stringify(garlic));
  // Overseeding is late summer: February–March.
  const over = windowsNear(CROPS.find(c => c.id === 'overseed').steps[0], anc, true, '2026-10-01');
  assert.ok(over.some(x => /^2027-0[23]/.test(x.start)), JSON.stringify(over));
});

test('a job’s season: the window we’re in, else the next', () => {
  const anc = { L, F };
  const seed = seasonFor('seed', anc, false, '2026-09-01');
  assert.equal(say(seed.step), 'Overseed');
  assert.ok(seed.start <= '2026-09-01' && seed.end >= '2026-09-01');
  const next = seasonFor('preemergent', anc, false, '2026-09-27');
  assert.ok(next.start.startsWith('2027-03'), JSON.stringify(next));
  assert.equal(seasonFor('transplant', anc, false, '2026-05-01').step.k, 'plant', 'not the seed-starting step');
  assert.equal(seasonFor('mow', anc, false, '2026-05-01'), null);
});
