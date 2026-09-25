// The rules engine. For every hour in the forecast it answers one question:
// "if I start this job at this hour, will the weather hold up for the whole job,
// including the drying or curing time after it?"
//
// Everything in here is metric (°C, %, mm, km/h, kPa) and knows nothing about
// the page. Times are the place's own local clock ("2026-09-27T10:00"), one
// forecast entry per hour, so "24 hours after" is simply 24 entries later.

export const GO = 0, IFFY = 1, NO = 2, UNKNOWN = 3;

// How close to a limit still counts as "cutting it close" (amber instead of green).
export const MARGIN = { temp: 1.5, rh: 5, dew: 1, soil: 1, cloud: 10, wind: 0.15, vpd: 0.2, rain: 0.7 };

// When an hour counts as rainy. Chances follow the NWS wording:
// 30–50% is a "chance", 60%+ is "likely".
export const RAIN = { iffyPop: 30, wetPop: 60, wetHour: 0.3, wetTotal: 1, trace: 0.1 };

// Rules about when you can work rather than about the weather. A start that
// fails one of these is drawn as "off" (dark, or outside the hours) instead of "no".
export const TIMING = new Set(['daylight', 'clock']);

// Lawn water balance ("checkbook" method): a root zone that holds an inch of
// water, drawn down by grass using 80% of reference evapotranspiration.
export const LAWN = { cap: 25.4, kc: 0.8 };

const SOIL_KEYS = { 6: 'soil6', 18: 'soil18' };

// Build everything the rules need from a normalized forecast (see weather.js).
export function prepare(fc, nowMs = Date.now()) {
  const n = fc.time.length;
  const date = new Array(n), hour = new Array(n), wday = new Array(n), day = new Array(n);
  const dayOf = new Map(fc.days.map((d, i) => [d.date, i]));
  for (let i = 0; i < n; i++) {
    const t = fc.time[i];
    date[i] = t.slice(0, 10);
    hour[i] = +t.slice(11, 13);
    wday[i] = new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10))).getUTCDay();
    day[i] = dayOf.has(date[i]) ? dayOf.get(date[i]) : -1;
  }

  // An hour is light if all of it falls between sunrise and sunset, give or
  // take half an hour of twilight on either end.
  const mins = s => (s ? +s.slice(11, 13) * 60 + +s.slice(14, 16) : null);
  const sun = fc.days.map(d => ({ rise: mins(d.sunrise), set: mins(d.sunset) }));
  const light = new Array(n);
  for (let i = 0; i < n; i++) {
    const s = sun[day[i]];
    light[i] = !!s && s.rise != null && s.set != null &&
      hour[i] * 60 >= s.rise - 30 && (hour[i] + 1) * 60 <= s.set + 30;
  }

  // Daily mean soil temperature at each depth.
  const soil = {};
  for (const [depth, key] of Object.entries(SOIL_KEYS)) {
    const sums = fc.days.map(() => ({ sum: 0, count: 0, missing: false }));
    const arr = fc[key] || [];
    for (let i = 0; i < n; i++) {
      const d = sums[day[i]];
      if (!d) continue;
      if (arr[i] == null) d.missing = true;
      else { d.sum += arr[i]; d.count++; }
    }
    soil[depth] = sums.map(d => (d.count >= 12 ? d.sum / d.count : null));
  }

  // Running lawn water deficit (mm short of a full root zone) at the end of each hour.
  const deficit = new Array(n);
  let bucket = LAWN.cap;
  for (let i = 0; i < n; i++) {
    bucket = Math.min(LAWN.cap, bucket + (fc.precip[i] || 0)) - LAWN.kc * (fc.et0?.[i] || 0);
    if (bucket < 0) bucket = 0;
    deficit[i] = LAWN.cap - bucket;
  }

  const nowKey = localHourKey(nowMs, fc.tz, fc.utcOffset);
  let i0 = fc.time.findIndex(t => t.slice(0, 13) >= nowKey);
  if (i0 < 0) i0 = n;

  return { fc, n, i0, date, hour, wday, day, light, sun, soil, deficit, avail: null };
}

// "YYYY-MM-DDTHH" for an instant, on the clock of the forecast's place.
export function localHourKey(ms, tz, utcOffset = 0) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}`;
  } catch {
    return new Date(ms + utcOffset * 1000).toISOString().slice(0, 13);
  }
}

// Which hours a rule looks at, for a job started at hour s that takes W hours.
export function span(rule, s, W) {
  const h = rule.h || 0;
  switch (rule.when) {
    case 'before': return [s - h, s];
    case 'after': return [s + W, s + W + h];
    case 'during+after': return [s, s + W + h];
    default: return [s, s + W];
  }
}

function extreme(arr, a, b, dir) {
  let v = null, at = -1;
  for (let i = a; i < b; i++) {
    const x = arr?.[i];
    if (x == null) return { v: null, at: i };
    if (v === null || (dir < 0 ? x < v : x > v)) { v = x; at = i; }
  }
  return { v, at };
}

function mean(arr, a, b) {
  let sum = 0;
  for (let i = a; i < b; i++) {
    if (arr?.[i] == null) return null;
    sum += arr[i];
  }
  return b > a ? sum / (b - a) : null;
}

const below = (v, lim, m) => (v < lim ? NO : v < lim + m ? IFFY : GO);
const above = (v, lim, m) => (v > lim ? NO : v > lim - m ? IFFY : GO);

// Check one rule for a start hour. Returns { st, v, at, ... } where st is
// GO / IFFY / NO / UNKNOWN, v the telling value and at the hour it happens.
export function check(rule, ctx, s, W) {
  const { fc } = ctx;
  const [a, b] = span(rule, s, W);
  if (a < 0 || b > ctx.n) return { st: UNKNOWN, v: null, at: -1 };
  let e;
  switch (rule.t) {
    case 'daylight':
      for (let i = a; i < b; i++) if (!ctx.light[i]) return { st: NO, v: null, at: i };
      return { st: GO, v: null, at: a };

    case 'clock': {
      const { from, to } = rule;
      for (let i = a; i < b; i++) {
        const hr = ctx.hour[i];
        const ok = from <= to ? hr >= from && hr < to : hr >= from || hr < to;
        if (!ok) return { st: NO, v: hr, at: i };
      }
      return { st: GO, v: null, at: a };
    }

    case 'dry': {
      let total = 0, maxPop = 0, popAt = -1, wetAt = -1, traceAt = -1;
      for (let i = a; i < b; i++) {
        const p = fc.precip[i];
        if (p == null) return { st: UNKNOWN, v: null, at: i };
        total += p;
        // Hours that already happened: only what actually fell matters.
        const pp = i < ctx.i0 ? null : fc.pop?.[i];
        if (wetAt < 0 && (p >= RAIN.wetHour || (pp != null && pp >= RAIN.wetPop))) wetAt = i;
        if (traceAt < 0 && p >= RAIN.trace) traceAt = i;
        if (pp != null && pp > maxPop) { maxPop = pp; popAt = i; }
      }
      const st = wetAt >= 0 || total >= RAIN.wetTotal ? NO
        : traceAt >= 0 || maxPop >= RAIN.iffyPop ? IFFY : GO;
      const at = wetAt >= 0 ? wetAt : traceAt >= 0 ? traceAt : popAt;
      return { st, v: total, at, total, maxPop, popAt, wetAt, traceAt, past: b <= ctx.i0 };
    }

    case 'tempMin':
      e = extreme(fc.temp, a, b, -1);
      return e.v == null ? { st: UNKNOWN, ...e } : { st: below(e.v, rule.v, MARGIN.temp), ...e };
    case 'tempMax':
      e = extreme(fc.temp, a, b, 1);
      return e.v == null ? { st: UNKNOWN, ...e } : { st: above(e.v, rule.v, MARGIN.temp), ...e };
    case 'windMax':
      e = extreme(fc.wind, a, b, 1);
      return e.v == null ? { st: UNKNOWN, ...e } : { st: above(e.v, rule.v, rule.v * MARGIN.wind), ...e };
    case 'gustMax':
      e = extreme(fc.gust, a, b, 1);
      return e.v == null ? { st: UNKNOWN, ...e } : { st: above(e.v, rule.v, rule.v * MARGIN.wind), ...e };
    case 'windMin':
      e = extreme(fc.wind, a, b, -1);
      return e.v == null ? { st: UNKNOWN, ...e } : { st: below(e.v, rule.v, rule.v * MARGIN.wind), ...e };
    case 'rhMax':
      e = extreme(fc.rh, a, b, 1);
      return e.v == null ? { st: UNKNOWN, ...e } : { st: above(e.v, rule.v, MARGIN.rh), ...e };
    case 'dewMax':
      e = extreme(fc.dew, a, b, 1);
      return e.v == null ? { st: UNKNOWN, ...e } : { st: above(e.v, rule.v, MARGIN.dew), ...e };

    case 'dewGap': {
      let v = null, at = -1;
      for (let i = a; i < b; i++) {
        if (fc.temp[i] == null || fc.dew?.[i] == null) return { st: UNKNOWN, v: null, at: i };
        const g = fc.temp[i] - fc.dew[i];
        if (v === null || g < v) { v = g; at = i; }
      }
      return { st: below(v, rule.v, MARGIN.dew), v, at };
    }

    case 'cloudMin':
    case 'cloudMax': {
      const v = mean(fc.cloud, a, b);
      if (v == null) return { st: UNKNOWN, v, at: a };
      return { st: rule.t === 'cloudMin' ? below(v, rule.v, MARGIN.cloud) : above(v, rule.v, MARGIN.cloud), v, at: a };
    }

    case 'vpdMin': {
      const v = mean(fc.vpd, a, b);
      if (v == null) return { st: UNKNOWN, v, at: a };
      return { st: below(v, rule.v, rule.v * MARGIN.vpd), v, at: a };
    }

    case 'rainMax':
    case 'rainMin': {
      let v = 0, peak = -1, peakAt = -1;
      for (let i = a; i < b; i++) {
        const p = fc.precip[i];
        if (p == null) return { st: UNKNOWN, v: null, at: i };
        v += p;
        if (p > peak) { peak = p; peakAt = i; }
      }
      const st = rule.t === 'rainMax' ? above(v, rule.v, rule.v * (1 - MARGIN.rain)) : v >= rule.v ? GO : NO;
      return { st, v, at: peakAt };
    }

    case 'soil': {
      const v = ctx.soil[rule.depth || 6]?.[ctx.day[s]];
      if (v == null) return { st: UNKNOWN, v: null, at: s };
      let st = GO;
      if ((rule.min != null && v < rule.min) || (rule.max != null && v > rule.max)) st = NO;
      else if ((rule.min != null && v < rule.min + MARGIN.soil) || (rule.max != null && v > rule.max - MARGIN.soil)) st = IFFY;
      return { st, v, at: s };
    }

    case 'thirsty': {
      const v = s > 0 ? ctx.deficit[s - 1] : 0;
      return { st: v >= rule.v ? GO : NO, v, at: s };
    }

    default:
      return { st: UNKNOWN, v: null, at: -1 };
  }
}

// Is the whole job inside the hours you said you're free?
function free(ctx, s, W) {
  if (!ctx.avail) return true;
  for (let i = s; i < s + W; i++) {
    const r = ctx.avail[ctx.wday[i]];
    if (!r || ctx.hour[i] < r[0] || ctx.hour[i] >= r[1]) return false;
  }
  return true;
}

// Rate one start hour for a job.
//   st:     GO / IFFY / NO / UNKNOWN (weather and timing together)
//   cls:    how to paint it: go, iffy, no, off (dark / outside hours), busy, unknown
//   fails:  indexes of must-rules that failed
//   misses: indexes of ideal-rules that failed
//   bonus:  a bonus rule came true (say, rain to water it in)
export function rateStart(job, ctx, s) {
  const W = job.hours;
  if (s + W > ctx.n) return { st: UNKNOWN, cls: 'unknown', fails: [], misses: [], bonus: false };
  const fails = [], misses = [];
  let iffy = false, unknown = false, timing = false, bonus = false;
  job.rules.forEach((rule, k) => {
    const c = check(rule, ctx, s, W);
    const lvl = rule.lvl || 'must';
    if (c.st === UNKNOWN) { if (lvl === 'must') unknown = true; return; }
    if (lvl === 'must') {
      if (c.st === NO) { fails.push(k); if (TIMING.has(rule.t)) timing = true; }
      else if (c.st === IFFY) iffy = true;
    } else if (lvl === 'ideal') {
      if (c.st === NO) { misses.push(k); iffy = true; }
    } else if (lvl === 'bonus' && c.st !== NO) bonus = true;
  });
  const st = fails.length ? NO : unknown ? UNKNOWN : iffy ? IFFY : GO;
  let cls = ['go', 'iffy', 'no', 'unknown'][st];
  if (timing) cls = 'off';
  else if (!job.anytime && !free(ctx, s, W)) cls = 'busy';
  return { st, cls, fails, misses, bonus };
}

// Rate every start hour from now to the end of the forecast.
export function rateJob(job, ctx) {
  const res = new Array(ctx.n).fill(null);
  for (let s = ctx.i0; s < ctx.n; s++) res[s] = rateStart(job, ctx, s);
  return res;
}

// Every rule, checked in full for one start: for the "why?" panel.
export function explain(job, ctx, s) {
  return job.rules.map(rule => ({ rule, span: span(rule, s, job.hours), ...check(rule, ctx, s, job.hours) }));
}

// Runs of back-to-back usable start hours. A window is "go" if any start in
// it is fully green; goFrom/goTo bound the green starts.
export function findWindows(res, ctx) {
  const wins = [];
  let cur = null;
  for (let s = ctx.i0; s <= ctx.n; s++) {
    const r = res[s];
    if (r && (r.cls === 'go' || r.cls === 'iffy')) {
      if (!cur) cur = { from: s, to: s, goFrom: -1, goTo: -1, bonus: false };
      cur.to = s;
      if (r.cls === 'go') { if (cur.goFrom < 0) cur.goFrom = s; cur.goTo = s; }
      if (r.bonus) cur.bonus = true;
    } else if (cur) {
      wins.push(cur);
      cur = null;
    }
  }
  for (const w of wins) {
    w.quality = w.goFrom >= 0 ? 'go' : 'iffy';
    w.best = w.goFrom >= 0 ? w.goFrom : w.from;
  }
  return wins;
}

// What most often rules a job out between two hours, ignoring hours that are
// dark, outside the job's hours, or when you're busy.
export function blockers(job, res, ctx, from = ctx.i0, to = ctx.n) {
  const counts = new Map();
  let seen = 0;
  const first = new Map();
  for (let s = Math.max(from, ctx.i0); s < Math.min(to, ctx.n); s++) {
    const r = res[s];
    if (!r || r.cls === 'off' || r.cls === 'busy' || r.st === UNKNOWN) continue;
    seen++;
    for (const k of r.fails) {
      counts.set(k, (counts.get(k) || 0) + 1);
      if (!first.has(k)) first.set(k, s);
    }
  }
  return [...counts]
    .sort((x, y) => y[1] - x[1])
    .map(([k, c]) => ({ k, rule: job.rules[k], share: c / seen, at: first.get(k) }));
}

// Lawn water, looking back a week from hour i: how much the grass used, how
// much rain fell, and how far below a full root zone it is now.
export function waterBalance(ctx, i = ctx.i0) {
  const a = Math.max(0, i - 7 * 24);
  let used = 0, rain = 0;
  for (let k = a; k < i; k++) {
    used += LAWN.kc * (ctx.fc.et0?.[k] || 0);
    rain += ctx.fc.precip[k] || 0;
  }
  return { used, rain, deficit: i > 0 ? ctx.deficit[i - 1] : 0 };
}

// Weather worth a heads-up in the next week, one of each kind, soonest first.
export function alerts(ctx, days = 7) {
  const { fc } = ctx;
  const end = Math.min(ctx.n, ctx.i0 + days * 24);
  const byDate = new Map();
  for (let i = ctx.i0; i < end; i++) {
    let d = byDate.get(ctx.date[i]);
    if (!d) byDate.set(ctx.date[i], d = { date: ctx.date[i], lo: Infinity, loAt: -1, hi: -Infinity, hiAt: -1, rain: 0, snow: 0, gust: 0, gustAt: -1, ice: -1 });
    const t = fc.temp[i];
    if (t != null && t < d.lo) { d.lo = t; d.loAt = i; }
    if (t != null && t > d.hi) { d.hi = t; d.hiAt = i; }
    d.rain += fc.precip[i] || 0;
    d.snow += fc.snow?.[i] || 0;
    if ((fc.gust?.[i] || 0) > d.gust) { d.gust = fc.gust[i]; d.gustAt = i; }
    if (d.ice < 0 && [56, 57, 66, 67].includes(fc.code?.[i])) d.ice = i;
  }
  const out = [];
  const first = (kind, test, make) => {
    for (const d of byDate.values()) if (test(d)) { out.push({ kind, date: d.date, ...make(d) }); return; }
  };
  first('freeze', d => d.lo <= -2.2, d => ({ v: d.lo, at: d.loAt }));
  first('frost', d => d.lo <= 2 && d.lo > -2.2, d => ({ v: d.lo, at: d.loAt }));
  first('ice', d => d.ice >= 0, d => ({ v: null, at: d.ice }));
  first('snow', d => d.snow >= 2.5, d => ({ v: d.snow, at: -1 }));
  first('rain', d => d.rain >= 25, d => ({ v: d.rain, at: -1 }));
  first('wind', d => d.gust >= 64, d => ({ v: d.gust, at: d.gustAt }));
  first('heat', d => d.hi >= 35, d => ({ v: d.hi, at: d.hiAt }));
  // A frost that only follows a harder freeze adds nothing.
  const fz = out.find(a => a.kind === 'freeze'), fr = out.find(a => a.kind === 'frost');
  if (fz && fr && fr.date >= fz.date) out.splice(out.indexOf(fr), 1);
  return out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

// Start-hour ranges on one date: the "This week" view.
export function rangesOn(res, ctx, date) {
  const out = [];
  let cur = null;
  for (let s = ctx.i0; s < ctx.n; s++) {
    if (ctx.date[s] < date) continue;
    if (ctx.date[s] > date) break;
    const r = res[s];
    const ok = r && (r.cls === 'go' || r.cls === 'iffy');
    if (ok && cur && r.cls === cur.cls) cur.to = s;
    else {
      if (cur) out.push(cur);
      cur = ok ? { from: s, to: s, cls: r.cls } : null;
    }
  }
  if (cur) out.push(cur);
  return out;
}
