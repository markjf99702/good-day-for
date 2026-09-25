import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeForecast } from './fixture.js';
import { normalize } from '../js/weather.js';
import { prepare, rateJob, rateStart, findWindows, blockers, check, explain, alerts, waterBalance, rangesOn, GO, IFFY, NO, UNKNOWN } from '../js/engine.js';
import { JOBS, byId } from '../js/jobs.js';
import { makeFmt, ruleText, obsText, blockerText, alertText } from '../js/text.js';
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
const at = (ctx, day, hour) => ctx.fc.time.indexOf(`${ctx.fc.days[7 + day].date}T${String(hour).padStart(2, '0')}:00`);

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

test('this-week ranges group by colour within a day', () => {
  const { ctx } = setup();
  const res = rateJob(byId('mow'), ctx);
  const date = ctx.date[at(ctx, 1, 12)];
  const ranges = rangesOn(res, ctx, date);
  assert.ok(ranges.length >= 1);
  for (const r of ranges) assert.ok(r.to >= r.from && ctx.date[r.from] === date);
});
