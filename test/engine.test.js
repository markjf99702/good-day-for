import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeForecast, CLOCK_CHANGES } from './fixture.js';
import { normalize } from '../js/weather.js';
import { prepare, rateJob, rateStart, findWindows, blockers, check, explain, alerts, waterBalance, rangesOn, GO, IFFY, NO, UNKNOWN } from '../js/engine.js';
import { JOBS, byId } from '../js/jobs.js';
import { makeFmt, ruleText, obsText, blockerText, alertText, aheadText, hourText } from '../js/text.js';
import { fromF, fromIn } from '../js/units.js';

// Pin "now" to 9 AM today at the place so every run sees the same hours.
function setup(hour = 9) {
  const tz = 'America/New_York';
  const raw = makeForecast({ tz });
  const fc = normalize(raw);
  const today = fc.days[7].date;
  const i = fc.time.indexOf(`${today}T${String(hour).padStart(2, '0')}:00`);
  const guess = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10), hour) - raw.utc_offset_seconds * 1000;
  const ctx = prepare(fc, guess + 60_000);
  assert.equal(ctx.i0, i, 'now lands on the right hour');
  return { fc, ctx, today };
}
// The start hour at that hour of the day, on the place's own clock (which the labels
// stop matching once a clock change is in the forecast).
const at = (ctx, day, hour) => ctx.local.indexOf(`${ctx.fc.days[7 + day].date}T${String(hour).padStart(2, '0')}:00`);

test('daylight: hours between sunrise and sunset (with twilight) only', () => {
  const { ctx } = setup();
  assert.equal(ctx.light[at(ctx, 0, 6)], false);
  assert.equal(ctx.light[at(ctx, 0, 7)], true);
  assert.equal(ctx.light[at(ctx, 0, 18)], true);   // ends 19:00, sunset 19:14
  assert.equal(ctx.light[at(ctx, 0, 19)], false);  // ends 20:00, past 19:44
});

test('mowing is a go on a dry afternoon and a no in the rain', () => {
  const { ctx } = setup();
  const mow = byId('mow');
  assert.equal(rateStart(mow, ctx, at(ctx, 0, 13)).cls, 'go');
  const wet = rateStart(mow, ctx, at(ctx, 2, 15));
  assert.equal(wet.st, NO);
  assert.equal(mow.rules[wet.fails[0]].t, 'dry');
  // Night is "off", not "no".
  assert.equal(rateStart(mow, ctx, at(ctx, 0, 22)).cls, 'off');
});

test('dry-before looks back into rain that already fell', () => {
  const { ctx } = setup();
  const r = { t: 'dry', when: 'before', h: 3 };
  assert.equal(check(r, ctx, at(ctx, 2, 17), 1).st, NO);   // rained 2-5 PM
  assert.equal(check(r, ctx, at(ctx, 2, 20), 1).st, GO);   // 3 dry hours later
});

test('rain chance of 30–59% is iffy, 60%+ is no', () => {
  const { fc, ctx } = setup();
  const s = at(ctx, 1, 10);
  fc.pop[s] = 35;
  assert.equal(check({ t: 'dry' }, ctx, s, 1).st, IFFY);
  fc.pop[s] = 65;
  assert.equal(check({ t: 'dry' }, ctx, s, 1).st, NO);
});

test('temperatures near a limit are iffy, past it are no', () => {
  const { fc, ctx } = setup();
  const s = at(ctx, 1, 12);
  const rule = { t: 'tempMin', v: fromF(50) };
  fc.temp[s] = fromF(51);
  assert.equal(check(rule, ctx, s, 1).st, IFFY);
  fc.temp[s] = fromF(49);
  assert.equal(check(rule, ctx, s, 1).st, NO);
  fc.temp[s] = fromF(60);
  assert.equal(check(rule, ctx, s, 1).st, GO);
});

test('exterior paint is blocked by the cold night and says so', () => {
  const { ctx } = setup();
  const paint = byId('ext-paint');
  const res = rateJob(paint, ctx);
  // Day 3 afternoon: the 24 h after runs into the 35°F morning of day 4.
  const r = res[at(ctx, 3, 10)];
  assert.equal(r.st, NO);
  assert.ok(r.fails.some(k => paint.rules[k].t === 'tempMin'));
  const top = blockers(paint, res, ctx)[0];
  assert.ok(top, 'there is a top blocker');
});

test('windows are runs of usable starts, split by the night', () => {
  const { ctx } = setup();
  const res = rateJob(byId('mow'), ctx);
  const wins = findWindows(res, ctx);
  assert.ok(wins.length >= 5);
  for (const w of wins) {
    assert.ok(w.to >= w.from);
    assert.equal(ctx.date[w.from], ctx.date[w.to], 'a daylight job never spans midnight');
    assert.ok(['go', 'iffy'].includes(w.quality));
  }
  // The very first window starts now (a dry, mild morning).
  assert.equal(wins[0].from, ctx.i0);
});

test('deck stain needs a dry day before: the day after the rain is out in the morning', () => {
  const { ctx } = setup();
  const stain = byId('deck-stain');
  const r = rateStart(stain, ctx, at(ctx, 3, 9));
  assert.equal(r.st, NO);
  assert.ok(r.fails.some(k => stain.rules[k].t === 'dry' && stain.rules[k].when === 'before'));
});

test('ideal rules make a start iffy, bonus rules mark it', () => {
  const { ctx } = setup();
  const job = {
    hours: 1, rules: [
      { t: 'daylight' },
      { t: 'tempMax', v: fromF(60), lvl: 'ideal' },
      { t: 'rainMin', v: 1, when: 'after', h: 48, lvl: 'bonus' },
    ],
  };
  const warm = rateStart(job, ctx, at(ctx, 0, 14));
  assert.equal(warm.cls, 'iffy');
  assert.deepEqual(warm.misses, [1]);
  const beforeRain = rateStart(job, ctx, at(ctx, 1, 8));
  assert.equal(beforeRain.bonus, true);
  assert.equal(rateStart(job, ctx, at(ctx, 0, 10)).bonus, false);
});

test('schedule: busy hours are marked busy unless the job runs itself', () => {
  const { ctx } = setup();
  ctx.avail = [[0, 24], [17, 24], [17, 24], [17, 24], [17, 24], [17, 24], [0, 24]];
  const s = at(ctx, 0, 10);
  const weekday = ctx.wday[s] >= 1 && ctx.wday[s] <= 5;
  const r = rateStart(byId('mow'), ctx, s);
  assert.equal(r.cls, weekday ? 'busy' : 'go');
  const water = { ...byId('water') };
  assert.notEqual(rateStart(water, ctx, s).cls, 'busy');
});

test('schedule: free hours can run past midnight, into the next morning', () => {
  const { ctx } = setup();
  const job = { hours: 1, rules: [{ t: 'tempMin', v: -40 }] }; // any weather will do
  const night = Array(7).fill(null);
  night[ctx.wday[at(ctx, 1, 22)]] = [21, 5]; // tomorrow, 9 PM to 5 AM
  ctx.avail = night;
  const busy = (day, hour, hours = 1) => rateStart({ ...job, hours }, ctx, at(ctx, day, hour)).cls === 'busy';
  assert.equal(busy(1, 22), false, '10 PM is free');
  assert.equal(busy(2, 3), false, 'so is 3 AM the next morning');
  assert.equal(busy(2, 4, 2), true, 'but a job from 4 AM runs past 5');
  assert.equal(busy(1, 3), true, '3 AM tomorrow belongs to tonight, which isn’t free');
  assert.equal(busy(1, 12), true);
  assert.equal(busy(2, 22), true, 'the next evening isn’t free');
  // From and to the same hour is never free, as before.
  night[ctx.wday[at(ctx, 1, 22)]] = [9, 9];
  assert.equal(busy(1, 9), true);
});

test('lawn water balance: rain refills, sunny days draw down', () => {
  const { ctx } = setup();
  const now = waterBalance(ctx);
  assert.ok(now.used > 0 && now.rain > 0);
  assert.ok(now.deficit >= 0 && now.deficit <= 25.4);
  const afterBigRain = waterBalance(ctx, at(ctx, 7, 18));
  assert.ok(afterBigRain.deficit < 3, `deficit after an inch of rain is ${afterBigRain.deficit}`);
});

test('soil rule uses the daily average', () => {
  const { ctx } = setup();
  const s = at(ctx, 0, 10);
  const v = ctx.soil[6][ctx.day[s]];
  assert.ok(v > 10 && v < 25, `soil ${v}`);
  assert.equal(check({ t: 'soil', depth: 6, min: v - 5, max: v + 5 }, ctx, s, 1).st, GO);
  assert.equal(check({ t: 'soil', depth: 6, max: v - 3 }, ctx, s, 1).st, NO);
});

test('starts whose check runs off the end of the data are unknown', () => {
  const { ctx } = setup();
  // Noon on the last day: daylight is fine, but the 7-day frost check runs out of forecast.
  const r = rateStart(byId('transplant'), ctx, ctx.n - 12);
  assert.equal(r.st, UNKNOWN);
  assert.equal(r.cls, 'unknown');
});

test('alerts: frost on the cold morning, heavy rain on day 7', () => {
  const { ctx, today } = setup();
  const list = alerts(ctx, 8);
  const kinds = list.map(a => a.kind);
  assert.ok(kinds.includes('frost'), kinds.join());
  assert.ok(kinds.includes('rain'), kinds.join());
  const fmt = makeFmt('us', 'en-US');
  const frost = alertText(list.find(a => a.kind === 'frost'), ctx, fmt, today);
  assert.match(frost.title, /Frost possible .*morning/);
  assert.match(frost.body, /35°F/);
});

test('every catalog job rates without errors and has readable rules', () => {
  const { ctx } = setup();
  const fmt = makeFmt('us', 'en-US');
  const ids = new Set();
  for (const job of JOBS) {
    assert.ok(!ids.has(job.id), `duplicate id ${job.id}`);
    ids.add(job.id);
    assert.ok(Number.isInteger(job.hours) && job.hours >= 1);
    const res = rateJob(job, ctx);
    assert.equal(res.length, ctx.n);
    for (const rule of job.rules) {
      const text = ruleText(rule, fmt);
      assert.ok(text && !text.includes('undefined') && !text.includes('NaN'), `${job.id}: ${text}`);
      assert.ok(blockerText(rule, ctx));
    }
    const s = at(ctx, 1, 11);
    for (const e of explain(job, ctx, s)) {
      const o = obsText(e.rule, e, ctx, fmt);
      assert.ok(!/undefined|NaN/.test(o), `${job.id} ${e.rule.t}: ${o}`);
    }
  }
});

test('rule sentences read naturally in both unit systems', () => {
  const us = makeFmt('us', 'en-US'), si = makeFmt('metric', 'en-GB');
  const stain = byId('deck-stain');
  assert.equal(ruleText(stain.rules[1], us), 'No rain in the 24 hours before you start');
  assert.equal(ruleText(stain.rules[4], us), 'At least 50°F while you work');
  assert.equal(ruleText(stain.rules[4], si), 'At least 10°C while you work');
  const paint = byId('ext-paint');
  assert.equal(ruleText(paint.rules[6], us), 'At least 5°F above the dew point while you work and for 3 hours after');
  assert.equal(ruleText(byId('seed').rules[1], us), 'Soil 2 in down between 50°F and 65°F');
  assert.equal(ruleText(byId('water').rules[0], us), 'Lawn at least 0.5 in short of water');
  assert.equal(us.rain(fromIn(0.25)), '0.25 in');
  assert.equal(us.rain(fromIn(0.1)), '0.1 in');
  assert.equal(us.rain(0), '0 in');
  assert.equal(us.rain(fromIn(1.23)), '1.2 in');
  assert.equal(us.rain(fromIn(2)), '2 in');
  assert.equal(ruleText(byId('transplant').rules[1], us), 'At least 36°F while you work and for 7 days after');
});

test('time of day: a start outside the hours, or one that runs past them', () => {
  const { ctx } = setup();
  const fmt = makeFmt('us', 'en-US');
  const said = (job, s) => { const c = explain(job, ctx, s).find(e => e.rule.t === 'clock'); return obsText(c.rule, c, ctx, fmt); };
  const water = byId('water'); // 4 to 10 AM is ideal
  assert.equal(said(water, at(ctx, 1, 23)), 'Outside those hours');
  assert.equal(said(water, at(ctx, 1, 9)), 'Fits');
  assert.equal(said({ ...water, hours: 3 }, at(ctx, 1, 9)), 'Runs past those hours');
});

test('rain totals for a stretch that’s already over say what fell', () => {
  const { fc, ctx } = setup();
  const fmt = makeFmt('us', 'en-US');
  fc.precip[at(ctx, -1, 10)] = fromIn(0.7); // yesterday morning
  const said = (rule, s) => obsText(rule, check(rule, ctx, s, 2), ctx, fmt);
  const soggy = { t: 'rainMax', v: fromIn(1), when: 'before', h: 24 };
  const soft = { t: 'rainMin', v: fromIn(0.25), when: 'before', h: 72 };
  assert.equal(said(soggy, ctx.i0), 'About 0.7 in fell');
  assert.equal(said(soft, ctx.i0), 'About 0.7 in fell');
  assert.equal(said({ ...soggy, h: 3 }, ctx.i0), 'None fell');
  // Still to come, it's what's expected.
  assert.equal(said({ t: 'rainMax', v: fromIn(1), when: 'after', h: 30 }, at(ctx, 1, 10)), 'About 0.4 in expected');
  assert.equal(said({ t: 'rainMax', v: fromIn(1), when: 'after', h: 3 }, at(ctx, 1, 10)), 'None expected');
});

test('this-week ranges group by colour within a day', () => {
  const { ctx } = setup();
  const res = rateJob(byId('mow'), ctx);
  const date = ctx.date[at(ctx, 1, 12)];
  const ranges = rangesOn(res, ctx, date);
  assert.ok(ranges.length >= 1);
  for (const r of ranges) assert.ok(r.to >= r.from && ctx.date[r.from] === date);
});

test('how far ahead the forecast reaches, in words', () => {
  assert.equal(aheadText(16 * 24), '16 days');
  assert.equal(aheadText(47), '1 day');
  assert.equal(aheadText(24), '1 day');
  assert.equal(aheadText(23), '23 hours');
  assert.equal(aheadText(1), '1 hour');
  assert.equal(aheadText(0), '0 hours');
});

// ——— Clock changes ———
// Open-Meteo labels a whole forecast with the UTC offset in force when it was fetched.

// A forecast fetched at one of the fixture's moments, read then or at `readAt`.
function across(which, readAt) {
  const { now, tz } = CLOCK_CHANGES[which];
  const fc = { ...normalize(makeForecast({ now, tz })), fetchedAt: now };
  const ctx = prepare(fc, readAt ?? now);
  const count = d => ctx.date.filter(x => x === d).length;
  return { fc, ctx, count, label: t => fc.time.indexOf(t), real: t => ctx.local.indexOf(t) };
}

test('after the clocks go back, each hour is read on the place’s own clock', () => {
  const { ctx, count, label } = across('back');
  // Labelled with the summer offset, 10 AM on the Monday after is really 9 AM.
  const i = label('2026-11-02T10:00');
  assert.equal(ctx.local[i], '2026-11-02T09:00');
  assert.equal(new Date(ctx.ms[i]).toISOString(), '2026-11-02T14:00:00.000Z');
  assert.deepEqual([ctx.date[i], ctx.hour[i], ctx.wday[i]], ['2026-11-02', 9, 1]);
  assert.equal(ctx.local[label('2026-10-30T10:00')], '2026-10-30T10:00', 'before the change they agree');
  // That Sunday is 25 hours long, with 1 AM twice.
  assert.deepEqual([count('2026-10-31'), count('2026-11-01'), count('2026-11-02')], [24, 25, 24]);
  const twice = ctx.local.flatMap((t, k) => (ctx.twice[k] ? [k] : []));
  assert.deepEqual(twice.map(k => ctx.local[k]), ['2026-11-01T01:00', '2026-11-01T01:00']);
  const fmt = makeFmt('us', 'en-US');
  assert.deepEqual(twice.map(k => hourText(ctx, fmt, k, true)), ['Sun 1 AM EDT', 'Sun 1 AM EST']);
  assert.equal(hourText(ctx, fmt, i, true), 'Mon 9 AM');
});

test('after the clocks go back, daylight, the time of day and your schedule go by the real clock', () => {
  const { ctx, real } = across('back');
  const fmt = makeFmt('us', 'en-US');
  // The sun's up at 6:21 now (labelled 7:21), so 6 AM is light and 5 AM isn't.
  const sun = ctx.sun[ctx.day[real('2026-11-02T06:00')]];
  assert.deepEqual([sun.riseAt, sun.setAt], ['2026-11-02T06:21', '2026-11-02T18:14']);
  assert.equal(ctx.light[real('2026-11-02T06:00')], true);
  assert.equal(ctx.light[real('2026-11-02T05:00')], false);
  assert.equal(ctx.light[real('2026-10-30T06:00')], false, 'the week before, it was up at 7:21');
  const said = (job, t, kind) => { const e = explain(job, ctx, real(t)).find(x => x.rule.t === kind); return obsText(e.rule, e, ctx, fmt); };
  assert.equal(said(byId('mow'), '2026-11-02T10:00', 'daylight'), 'Sun up 6:21 AM to 6:14 PM');
  // The sprinkler's 4 to 10 AM.
  assert.equal(said(byId('water'), '2026-11-02T09:00', 'clock'), 'Fits');
  assert.equal(said(byId('water'), '2026-11-02T10:00', 'clock'), 'Outside those hours');
  // Free weekday evenings from 5 PM: 4 PM on Monday is busy, 5 PM isn't.
  ctx.avail = [[0, 24], [17, 24], [17, 24], [17, 24], [17, 24], [17, 24], [0, 24]];
  const any = { hours: 1, rules: [{ t: 'tempMin', v: -40 }] };
  assert.equal(rateStart(any, ctx, real('2026-11-02T16:00')).cls, 'busy');
  assert.equal(rateStart(any, ctx, real('2026-11-02T17:00')).cls, 'go');
  // What the forecast shows is put at the real hour.
  const low = { t: 'tempMin', v: -40 };
  assert.match(obsText(low, check(low, ctx, real('2026-11-02T09:00'), 1), ctx, fmt), / Mon 9 AM$/);
  // Days, their soil averages and the heads-ups go by the real date.
  assert.equal(ctx.day[real('2026-11-02T00:00')], ctx.fc.days.findIndex(d => d.date === '2026-11-02'));
  assert.ok(ctx.soil[6][ctx.day[real('2026-11-01T12:00')]] != null, 'the 25-hour day has a soil average');
  for (const a of alerts(ctx, 16)) assert.equal(a.date, a.at >= 0 ? ctx.date[a.at] : a.date);
});

test('a forecast fetched before the clocks went back still knows which hour it is', () => {
  // Fetched on the Wednesday, opened at 10:30 AM on the Monday after.
  const now = Date.UTC(2026, 10, 2, 15, 30);
  const { ctx } = across('back', now);
  assert.ok(ctx.ms[ctx.i0] <= now && now < ctx.ms[ctx.i0] + 36e5, 'the hour under way now');
  assert.equal(ctx.local[ctx.i0], '2026-11-02T10:00');
});

test('the night the clocks go forward has no 2 AM', () => {
  const { ctx, count, label } = across('forward');
  assert.deepEqual([count('2027-03-13'), count('2027-03-14'), count('2027-03-15')], [24, 23, 24]);
  assert.equal(ctx.local.indexOf('2027-03-14T02:00'), -1);
  assert.equal(ctx.local[label('2027-03-15T09:00')], '2027-03-15T10:00');
  assert.ok(!ctx.twice.some(Boolean));
});

test('Europe’s clock change reads the same way', () => {
  const { ctx, count, label } = across('europe');
  const fmt = makeFmt('metric', 'en-GB');
  assert.equal(count('2026-10-25'), 25);
  assert.deepEqual(ctx.local.flatMap((t, k) => (ctx.twice[k] ? [hourText(ctx, fmt, k)] : [])), ['02:00 CEST', '02:00 CET']);
  assert.equal(ctx.local[label('2026-10-26T08:00')], '2026-10-26T07:00');
});

test('with no clock change, or no time zone to go by, hours read as labelled', () => {
  const now = Date.UTC(2026, 6, 1, 13, 20);
  const plain = prepare(normalize(makeForecast({ now })), now);
  assert.deepEqual(plain.local, plain.fc.time);
  assert.ok(!plain.twice.some(Boolean));
  const { now: then, tz } = CLOCK_CHANGES.back;
  for (const odd of ['Nowhere/Special', undefined]) {
    const ctx = prepare({ ...normalize(makeForecast({ now: then, tz })), tz: odd }, then);
    assert.deepEqual(ctx.local, ctx.fc.time, String(odd));
  }
});

test('laundry wants a breeze: a dead-calm stretch is iffy, and says why', () => {
  const { fc, ctx } = setup();
  const laundry = byId('laundry');
  const s = at(ctx, 1, 11);
  assert.notEqual(rateStart(laundry, ctx, s).st, NO);
  for (let k = s; k < s + laundry.hours; k++) fc.wind[k] = 1; // km/h
  const calm = rateStart(laundry, ctx, s);
  assert.equal(calm.st, IFFY);
  const rule = laundry.rules[calm.misses.find(k => laundry.rules[k].t === 'windMin')];
  assert.ok(rule, 'the breeze rule is what it misses');
  assert.equal(rule.lvl, 'ideal');
  assert.equal(ruleText(rule, makeFmt('us', 'en-US')), 'At least a 3 mph breeze while you work');
  assert.equal(blockerText(rule, ctx), 'Dead calm');
});
