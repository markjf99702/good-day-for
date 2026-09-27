// Good Day For: the page.

import { JOBS, GROUPS, byId } from './jobs.js';
import { prepare, rateJob, findWindows, blockers, explain, alerts, waterBalance, rangesOn, localHourKey, GO, IFFY, NO, UNKNOWN } from './engine.js';
import { makeFmt, relDay, ruleText, obsText, blockerText, alertText, RULE_TYPES, WHEN } from './text.js';
import { unitFor, measureFor } from './units.js';
import { fetchForecast, fetchHistory, searchPlaces, locate, nameFor, placeKey, placeLabel } from './weather.js';
import * as store from './store.js';
import { zonedToUtc, downloadIcs, googleLink } from './cal.js';
import { CALCS, calcById, jobsOf, inputsFor, quote, summaryOf, applyRoute, packName, packLabel, moneyFmt, numFmt } from './materials.js';
import { historyRange, frostEntry, summarize, anchors, monthDayOf, dayOfSeason, monthTicks, seasonName, coolMonths, addDays, SEASON_DAYS, HARD, VERSION as FROST_VERSION } from './frost.js';
import { CROPS, KINDS, GROUPS as PLANT_GROUPS, calendar, segments, windowsNear, weekPlan, seasonFor, say } from './planting.js';

const STATES = ['go', 'iffy', 'no', 'unknown'];
const STATE_NAMES = { go: 'Go', iffy: 'Iffy', no: 'No', unknown: 'No data yet', off: 'Dark / off-hours', busy: 'You’re busy', past: 'Already past' };
const ICONS = ['✅', '🧹', '🪴', '🌻', '🥕', '🏡', '🔨', '🪚', '🧰', '🪣', '🌲', '🐝', '🏊', '⛺', '🚲', '🪜', '🧺', '🔥', '🌼', '🐕', '🎪', '🛶', '🪟', '🧽'];

const state = store.load();
let fmt = makeFmt(state.units);
let fc = null, ctx = null, ctxHour = '';
let results = new Map();
let loading = false, loadError = '', fetchToken = 0;
let lastView = '';
let selected = null; // { id, s } start hour picked in the detail view
let frost = null, frostKey = '', frostBusy = false, frostErr = '', frostToken = 0; // frost dates for the current place
const locale = globalThis.navigator?.language || 'en-US';

// ——— Little DOM helpers ———

const $ = sel => document.querySelector(sel);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const lower = t => (t ? t[0].toLowerCase() + t.slice(1) : t);
// replaceChildren, but skipping empties and flattening lists the way h() does.
const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false).map(k => (k instanceof Node ? k : String(k))));
const persist = () => store.save(state);

// ——— Jobs and results ———

const jobFor = id => state.custom[id] || state.edits[id] || byId(id);
const pickedJobs = () => state.picks.map(jobFor).filter(Boolean);

function ensureCtx() {
  if (!fc) return null;
  const key = localHourKey(Date.now(), fc.tz, fc.utcOffset);
  if (!ctx || key !== ctxHour) {
    ctx = prepare(fc);
    ctxHour = key;
    results.clear();
  }
  ctx.avail = store.availability(state.schedule);
  return ctx;
}

function resultFor(job) {
  let r = results.get(job.id);
  if (!r) {
    const res = rateJob(job, ctx);
    r = { res, wins: findWindows(res, ctx) };
    results.set(job.id, r);
  }
  return r;
}

const today = () => ctx.date[ctx.i0] || fc.days[0].date;
const daysLeft = () => Math.floor((ctx.n - ctx.i0) / 24);
const isFar = i => i - ctx.i0 >= 7 * 24;

function firstIndexByDate() {
  const m = new Map();
  ctx.date.forEach((d, i) => { if (!m.has(d)) m.set(d, i); });
  return m;
}

// ——— Forecast loading ———

async function refresh(force = false) {
  if (!state.place) return render();
  const key = placeKey(state.place);
  if (!fc || fc.key !== key) {
    fc = store.loadForecast(key);
    ctx = null;
    results.clear();
  }
  const stale = !fc || Date.now() - fc.fetchedAt > 30 * 60e3;
  if (!force && !stale) return softRender();
  const token = ++fetchToken;
  loading = true;
  loadError = '';
  softRender();
  try {
    const next = await fetchForecast(state.place);
    if (token !== fetchToken) return;
    fc = next;
    store.saveForecast(next);
    ctx = null;
    results.clear();
  } catch (e) {
    if (token !== fetchToken) return;
    loadError = navigator.onLine === false ? 'You’re offline.' : e.message || 'Couldn’t reach the weather service.';
  }
  loading = false;
  softRender();
}

function setPlace(p) {
  state.place = { name: p.name, admin: p.admin || '', country: p.country || '', cc: p.cc || '', lat: +p.lat, lon: +p.lon };
  state.recent = [state.place, ...state.recent.filter(r => placeKey(r) !== placeKey(state.place))].slice(0, 5);
  persist();
  fc = null;
  frost = null;
  frostKey = '';
  frostErr = '';
  frostBusy = false;
  frostToken++;
  location.hash = '#/';
  refresh(true);
}

// ——— Routing ———

function parseRoute() {
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean).map(decodeURIComponent);
  return { view: parts[0] || 'home', args: parts.slice(1) };
}

function render() {
  fmt = makeFmt(state.units);
  fitLabels.disconnect();
  barWatch?.disconnect();
  const { view, args } = parseRoute();
  renderHeader();
  const key = `${view}/${args[0] || ''}`;
  const arriving = key !== lastView;
  if (fc) ensureCtx();
  let node;
  if (view === 'settings') node = settingsView();
  else if (view === 'place') node = placeView();
  else if (view === 'buy') node = calcById(args[0]) ? calcView(calcById(args[0]), args[1], arriving) : buyView();
  else if (!state.place) node = welcomeView();
  else if (view === 'frost') node = frostView();
  else if (view === 'jobs') node = catalogView();
  else if (view === 'new') node = editorView(null);
  else if (view === 'edit' && jobFor(args[0])) node = editorView(jobFor(args[0]));
  else if (!fc) node = loadingView();
  else {
    ensureCtx();
    if (view === 'job' && jobFor(args[0])) node = detailView(jobFor(args[0]), args[1]);
    else node = homeView(view === 'week' ? 'week' : 'jobs');
  }
  const app = $('#app');
  app.replaceChildren(node);
  if (arriving) {
    window.scrollTo(0, 0);
    lastView = key;
  }
}

// Background updates (a fresh forecast, the clock ticking over) shouldn't wipe
// out a form someone is typing in.
function softRender() {
  const { view, args } = parseRoute();
  const typing = ['edit', 'new', 'place'].includes(view) || (view === 'buy' && calcById(args[0]));
  if (typing || (view !== 'settings' && view !== 'buy' && !state.place)) renderHeader();
  else render();
}

function renderHeader() {
  const btn = $('#placeBtn');
  btn.querySelector('span').textContent = state.place ? placeLabel(state.place) : 'Pick a place';
}

// ——— Shared pieces ———

function statusLine() {
  const bits = [];
  if (loading) bits.push(h('span', { class: 'spin', 'aria-hidden': 'true' }), 'Updating…');
  else if (fc) {
    const mins = Math.round((Date.now() - fc.fetchedAt) / 6e4);
    bits.push(mins < 1 ? 'Updated just now' : mins < 60 ? `Updated ${mins} min ago` : `Updated ${Math.round(mins / 60)} h ago`);
  }
  return h('div', { class: 'status' },
    h('span', {}, ...bits),
    !loading && h('button', { class: 'link', onclick: () => refresh(true) }, 'Refresh'),
    loadError && h('span', { class: 'err', role: 'alert' }, fc ? `Couldn’t update: ${loadError} Showing the last forecast.` : loadError),
  );
}

function nowLine() {
  const i = ctx.i0;
  if (i >= ctx.n) return null;
  const endOfDay = ctx.date.lastIndexOf(ctx.date[i]);
  let pop = 0;
  for (let k = i; k <= endOfDay; k++) pop = Math.max(pop, fc.pop[k] || 0);
  const soil = ctx.soil[6][ctx.day[i]];
  return h('p', { class: 'now' },
    h('b', {}, fmt.temp(fc.temp[i])),
    ` · Humidity ${Math.round(fc.rh[i])}% · Wind ${fmt.wind(fc.wind[i])}`,
    ` · Rain chance today ${pop}%`,
    soil != null && ` · Soil ${fmt.temp(soil)}`,
  );
}

function legend() {
  return h('div', { class: 'legend', 'aria-label': 'Legend' },
    ...['go', 'iffy', 'no', 'off'].map(k => h('span', {}, h('i', { class: `sw ${k}` }), STATE_NAMES[k])),
    state.schedule.preset !== 'any' && h('span', {}, h('i', { class: 'sw go busy' }), 'Busy'),
    h('span', { class: 'hint' }, 'Each square is an hour you could start.'),
  );
}

function rangeOf(w) {
  return w.quality === 'go' ? [w.goFrom, w.goTo] : [w.from, w.to];
}

function rangeText(a, b) {
  const ta = fc.time[a], tb = fc.time[b];
  if (a === ctx.i0) return a === b ? 'start now (this hour only)' : `start now, or by ${ctx.date[a] === ctx.date[b] ? fmt.hour(tb) : fmt.dayHour(tb)}`;
  if (a === b) return `start at ${fmt.hour(ta)}`;
  if (ctx.date[a] !== ctx.date[b]) return `start ${fmt.hour(ta)} – ${fmt.dayHour(tb)}`;
  return `start ${fmt.hour(ta)} – ${fmt.hour(tb)}`;
}

const dayName = i => relDay(ctx.date[i], today(), fmt, { cap: true });

// Why a start isn't fully green, in a few words.
function iffyReason(job, s) {
  const checks = explain(job, ctx, s);
  const close = checks.find(c => (c.rule.lvl || 'must') === 'must' && c.st === IFFY);
  if (close) return `Cutting it close: ${lower(obsText(close.rule, close, ctx, fmt))}`;
  const miss = checks.find(c => c.rule.lvl === 'ideal' && c.st === NO);
  if (miss) return miss.rule.t === 'dry' ? obsText(miss.rule, miss, ctx, fmt) : `${blockerText(miss.rule, ctx)}: ${lower(obsText(miss.rule, miss, ctx, fmt))}`;
  return '';
}

function blockerList(job, res, from, to) {
  const seen = new Set();
  return blockers(job, res, ctx, from, to).map(b => blockerText(b.rule, ctx, b.at)).filter(t => !seen.has(t) && seen.add(t));
}

function extraLines(job) {
  const out = [];
  if (job.rules.some(r => r.t === 'thirsty')) {
    const wb = waterBalance(ctx);
    out.push(`Lawn is ${fmt.rain(wb.deficit)} short. Past week: grass used ${fmt.rain(wb.used)}, rain gave ${fmt.rain(wb.rain)}.`);
  }
  const soil = job.rules.find(r => r.t === 'soil' && (r.lvl || 'must') === 'must');
  if (soil) {
    const v = ctx.soil[soil.depth || 6][ctx.day[ctx.i0]];
    if (v != null) out.push(`Soil ${fmt.depth(soil.depth || 6)} down is averaging ${fmt.temp(v)} today.`);
  }
  return out;
}

// The hours worth drawing for a job: every hour it could ever start, plus
// one either side. A daylight job skips the night; an any-time job gets all 24.
function hourSpan(res) {
  let lo = 24, hi = -1;
  for (let i = ctx.i0; i < ctx.n; i++) {
    const r = res[i];
    if (r && r.cls !== 'off' && r.cls !== 'unknown') { lo = Math.min(lo, ctx.hour[i]); hi = Math.max(hi, ctx.hour[i]); }
  }
  if (hi < 0 || hi - lo >= 20) return [0, 23];
  return [Math.max(0, lo - 1), Math.min(23, hi + 1)];
}

// One label per hour column. Which ones show (and long or short) depends on
// how wide the columns turn out, which fitLabels works out after layout.
function hourLabels(lo, hi, cls) {
  const out = [];
  for (let hr = lo; hr <= hi; hr++) {
    const d = [2, 3, 6].filter(k => hr % k === 0).map(k => `d${k}`).join(' ');
    // Compact: bare numbers, with a/p only on the first hour and at noon and midnight.
    const num = hr === lo || hr % 12 === 0 ? fmt.shortHour(hr) : fmt.h12 ? String(hr % 12) : String(hr);
    out.push(h('span', { class: `${cls} ${d}` },
      h('span', { class: 'hl-long' }, fmt.hourOf(hr)),
      h('span', { class: 'hl-short' }, fmt.shortHour(hr)),
      h('span', { class: 'hl-num' }, num)));
  }
  return out;
}

// Measures the column pitch and the label text, then picks the densest
// labelling that doesn't collide: every hour spelled out ("7 AM"), every hour
// short ("7a"), every hour compact ("6a 7 8 … 12p 1"), or short every 2, 3 or 6.
const measure = document.createElement('canvas').getContext('2d');
const fitLabels = new ResizeObserver(entries => {
  for (const { target: el } of entries) {
    const heads = [...el.querySelectorAll('.g-h, .m-h')];
    if (heads.length < 2) { el.dataset.fit = '1'; continue; }
    const pitch = heads[1].getBoundingClientRect().left - heads[0].getBoundingClientRect().left;
    if (!pitch) continue;
    const cs = getComputedStyle(heads[0]);
    measure.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    // Labels sit centred over their squares, so two neighbours fit when half of
    // each, plus a little air, fits between their centres.
    const fits = (sel, k = 1) => {
      const shown = heads.filter(hd => k === 1 || hd.classList.contains(`d${k}`));
      const w = hd => measure.measureText(hd.querySelector(sel).textContent).width;
      for (let i = 1; i < shown.length; i++) if ((w(shown[i - 1]) + w(shown[i])) / 2 + 3 > pitch * k) return false;
      return true;
    };
    if (!el.classList.contains('mini') && fits('.hl-long')) el.dataset.fit = 'long';
    else if (fits('.hl-short')) el.dataset.fit = '1';
    else if (fits('.hl-num')) el.dataset.fit = 'num';
    else el.dataset.fit = String([2, 3, 6].find(k => fits('.hl-short', k)) || 6);
  }
});

function miniGrid(res) {
  const first = firstIndexByDate();
  const dates = [...first.keys()].filter(d => d >= today()).slice(0, 7);
  const [lo, hi] = hourSpan(res);
  const grid = h('div', { class: 'mini', 'aria-hidden': 'true', 'data-cols': hi - lo + 1, style: `--cols: ${hi - lo + 1}` },
    h('span', { class: 'm-d' }),
    hourLabels(lo, hi, 'm-h'),
    dates.map(d => {
      const cells = new Array(hi - lo + 1).fill(null);
      for (let i = first.get(d); i < ctx.n && ctx.date[i] === d; i++) {
        if (ctx.hour[i] >= lo && ctx.hour[i] <= hi) cells[ctx.hour[i] - lo] = i;
      }
      return [h('span', { class: 'm-d' }, fmt.wd(d).slice(0, 2)), cells.map(i => h('i', { class: i == null ? 'none' : cellClass(res, i) }))];
    }),
  );
  fitLabels.observe(grid);
  return grid;
}

function cellClass(res, i) {
  if (i < ctx.i0) return 'past';
  const r = res[i];
  if (!r) return 'unknown';
  if (r.cls === 'busy') return `${STATES[r.st]} busy`;
  return r.cls;
}

// ——— Home ———

function homeView(tab) {
  const list = pickedJobs();
  return h('div', { class: 'home' },
    headBlock(tab),
    tab === 'jobs' ? jobsTab(list) : weekTab(list),
  );
}

// The top of every main view: the weather right now, any heads-up, and the tabs.
function headBlock(tab) {
  const al = fc && ctx ? alerts(ctx) : [];
  return [
    fc && ctx && h('div', { class: 'topline' }, nowLine(), statusLine()),
    al.length > 0 && h('section', { class: 'alerts', 'aria-label': 'Heads up' },
      al.map(a => {
        const t = alertText(a, ctx, fmt, today());
        return h('div', { class: `alert ${a.kind}` }, h('span', { class: 'a-ico', 'aria-hidden': 'true' }, t.icon), h('div', {}, h('b', {}, t.title), h('span', {}, ' ', t.body)));
      })),
    h('nav', { class: 'tabs', 'aria-label': 'Views' },
      [['jobs', '#/', 'By job'], ['week', '#/week', 'This week'], ['frost', '#/frost', 'Planting'], ['buy', '#/buy', 'How much']].map(([k, href, label]) =>
        h('a', { href, 'aria-current': tab === k ? 'page' : null }, label)),
    ),
  ];
}

function jobsTab(list) {
  const rows = list.map((job, order) => {
    const { res, wins } = resultFor(job);
    const go = wins.find(w => w.quality === 'go');
    const rank = go ? go.best : wins[0] ? 1e6 + wins[0].best : 2e6;
    return { job, res, wins, rank, order };
  }).sort((a, b) => a.rank - b.rank || a.order - b.order);
  return h('div', {},
    legend(),
    h('div', { class: 'cards' },
      rows.map(jobCard),
      h('a', { class: 'card add', href: '#/jobs' }, h('span', { class: 'plus', 'aria-hidden': 'true' }, '+'), h('span', {}, 'Add or remove jobs')),
    ),
  );
}

function jobCard({ job, res, wins }) {
  const go = wins.find(w => w.quality === 'go');
  const first = wins[0];
  const now = res[ctx.i0];
  const pill = now?.cls === 'go' ? ['go', 'Go now'] : now?.cls === 'iffy' ? ['iffy', 'Iffy now'] : null;
  let head, sub = [];
  if (go) {
    const [a, b] = rangeOf(go);
    head = [h('b', {}, dayName(a)), ' · ', rangeText(a, b)];
    if (isFar(a)) sub.push('That’s a long way out, so check again closer to the day.');
    if (first !== go) {
      const [c, d] = rangeOf(first);
      sub.push(`Iffy sooner: ${lower(dayName(c))}, ${rangeText(c, d)}.`);
    }
    if (go.bonus) sub.push(h('span', { class: 'bonus' }, '★ ', lower(job.rules.find(r => r.lvl === 'bonus')?.why || 'Bonus')));
  } else if (first) {
    const [a, b] = rangeOf(first);
    head = [h('b', { class: 'iffy-t' }, 'Iffy'), ' · ', h('b', {}, dayName(a)), ' · ', rangeText(a, b)];
    const why = iffyReason(job, first.best);
    if (why) sub.push(why + '.');
  } else {
    head = [h('b', {}, `No window in the next ${daysLeft()} days`)];
    const bl = blockerList(job, res).slice(0, 3);
    if (bl.length) sub.push(`In the way: ${bl.join(' · ')}`);
    const busyGo = res.findIndex((r, i) => i >= ctx.i0 && r?.cls === 'busy' && r.st === GO);
    if (busyGo >= 0) sub.push(`Good while you’re busy: ${fmt.dayHour(fc.time[busyGo])}.`);
  }
  return h('a', { class: 'card', href: `#/job/${encodeURIComponent(job.id)}` },
    h('div', { class: 'c-head' },
      h('span', { class: 'ico', 'aria-hidden': 'true' }, job.icon),
      h('h3', {}, job.name),
      pill && h('span', { class: `pill ${pill[0]}` }, pill[1]),
    ),
    h('p', { class: 'next' }, head),
    sub.map(t => h('p', { class: 'sub' }, t)),
    extraLines(job).map(t => h('p', { class: 'sub extra' }, t)),
    miniGrid(res),
  );
}

function weekTab(list) {
  const first = firstIndexByDate();
  const dates = [...first.keys()].filter(d => d >= today()).slice(0, 7);
  const al = alerts(ctx);
  return h('div', { class: 'week' }, dates.map(date => {
    const a = Math.max(first.get(date), ctx.i0);
    let b = a;
    while (b < ctx.n && ctx.date[b] === date) b++;
    const dayAll = first.get(date);
    const yes = [], no = [];
    for (const job of list) {
      const { res } = resultFor(job);
      const ranges = rangesOn(res, ctx, date);
      const go = ranges.filter(r => r.cls === 'go');
      const use = go.length ? go : ranges;
      if (use.length) yes.push({ job, cls: use[0].cls, ranges: use.slice(0, 2), start: use[0].from });
      else {
        const why = blockerList(job, res, a, b)[0];
        no.push({ job, why });
      }
    }
    yes.sort((x, y) => (x.cls === y.cls ? x.start - y.start : x.cls === 'go' ? -1 : 1));
    const dayAlerts = al.filter(x => x.date === date);
    return h('section', { class: 'day' },
      h('header', {},
        h('h3', {}, relDay(date, today(), fmt, { cap: true })),
        h('span', { class: 'date' }, fmt.date(date)),
        dayWeather(dayAll, date),
      ),
      dayAlerts.map(x => { const t = alertText(x, ctx, fmt, today()); return h('p', { class: 'd-alert' }, t.icon, ' ', t.title); }),
      yes.length
        ? h('ul', { class: 'd-jobs' }, yes.map(y => h('li', { class: y.cls },
          h('a', { href: `#/job/${encodeURIComponent(y.job.id)}/${fc.time[y.start]}` },
            h('i', { class: `dot ${y.cls}`, 'aria-hidden': 'true' }),
            h('span', { class: 'ico', 'aria-hidden': 'true' }, y.job.icon),
            h('span', { class: 'nm' }, y.job.name),
            h('span', { class: 't' }, y.cls === 'iffy' ? 'Iffy, ' : '', y.ranges.map(r => (r.from === r.to ? fmt.hour(fc.time[r.from]) : `${fmt.hour(fc.time[r.from])} – ${fmt.hour(fc.time[r.to])}`)).join(', ')),
          ))))
        : h('p', { class: 'd-none' }, a >= b ? 'The day’s done.' : 'Nothing on your list works today.'),
      no.length > 0 && a < b && h('p', { class: 'd-no' }, h('span', {}, 'Not today: '),
        no.map((n, k) => [k ? ' · ' : '', h('span', { title: n.job.name }, n.job.icon, ' ', n.job.short || n.job.name, n.why ? ` (${lower(n.why)})` : '')])),
    );
  }));
}

function dayWeather(from, date) {
  let hi = -Infinity, lo = Infinity, rain = 0, pop = 0, cloud = 0, snow = 0, count = 0;
  for (let i = from; i < ctx.n && ctx.date[i] === date; i++) {
    hi = Math.max(hi, fc.temp[i]);
    lo = Math.min(lo, fc.temp[i]);
    rain += fc.precip[i] || 0;
    snow += fc.snow[i] || 0;
    if (i >= ctx.i0) pop = Math.max(pop, fc.pop[i] || 0);
    cloud += fc.cloud[i] || 0;
    count++;
  }
  cloud /= count || 1;
  const icon = snow > 0.5 ? '🌨️' : rain >= 1 ? '🌧️' : pop >= 50 ? '🌦️' : cloud >= 70 ? '☁️' : cloud >= 35 ? '⛅' : '☀️';
  return h('span', { class: 'wx' },
    h('span', { 'aria-hidden': 'true' }, icon, ' '),
    `${fmt.temp(hi)} / ${fmt.temp(lo)}`,
    rain >= 0.25 ? ` · ${fmt.rain(rain)} rain` : pop >= 20 ? ` · ${pop}% rain` : ' · dry',
  );
}

// ——— One job ———

function detailView(job, startArg) {
  const { res, wins } = resultFor(job);
  if (startArg) {
    const i = fc.time.indexOf(startArg);
    if (i >= ctx.i0) selected = { id: job.id, s: i };
  }
  if (!selected || selected.id !== job.id || selected.s < ctx.i0 || selected.s >= ctx.n) {
    const pick = wins.find(w => w.quality === 'go') || wins[0];
    selected = { id: job.id, s: pick ? pick.best : ctx.i0 };
  }
  const inspector = h('section', { class: 'inspect', 'aria-live': 'polite', id: 'inspect' });
  const grid = bigGrid(job, res, s => {
    selected = { id: job.id, s };
    grid.querySelectorAll('.cell.sel').forEach(c => { c.classList.remove('sel'); c.tabIndex = -1; });
    const cell = grid.querySelector(`[data-i="${s}"]`);
    if (cell) { cell.classList.add('sel'); cell.tabIndex = 0; }
    fillInspector(inspector, job, res, s);
  });
  fillInspector(inspector, job, res, selected.s);
  const isCustom = !!state.custom[job.id];
  const edited = !!state.edits[job.id];
  const schedNote = job.anytime ? 'Runs any time (ignores your schedule)' : state.schedule.preset !== 'any' ? `Fits your schedule: ${store.SCHEDULES[state.schedule.preset].name.toLowerCase()}` : null;
  return h('div', { class: 'detail' },
    h('a', { class: 'back', href: '#/' }, '← All jobs'),
    h('div', { class: 'd-head' },
      h('span', { class: 'ico big', 'aria-hidden': 'true' }, job.icon),
      h('div', {},
        h('h2', {}, job.name),
        job.about && h('p', { class: 'about' }, job.about),
        h('p', { class: 'chips' },
          h('span', { class: 'chip' }, job.hours === 1 ? 'About 1 hour of work' : `About ${job.hours} hours of work`),
          schedNote && h('span', { class: 'chip' }, schedNote),
          edited && h('span', { class: 'chip warn' }, 'Your edited rules'),
          isCustom && h('span', { class: 'chip' }, 'Your own job'),
        ),
        seasonLine(job),
      ),
      h('div', { class: 'd-actions' },
        buyLink(job) && h('a', { class: 'btn ghost buy-link', href: `#/buy/${buyLink(job)}` }, h('span', { 'aria-hidden': 'true' }, '🧮'), 'How much to buy'),
        h('a', { class: 'btn ghost', href: `#/edit/${encodeURIComponent(job.id)}` }, 'Edit rules'),
        h('button', { class: 'btn ghost', onclick: () => copyJob(job) }, 'Make a copy'),
      ),
    ),
    windowsList(job, wins, s => {
      grid.querySelector(`[data-i="${s}"]`)?.click();
      inspector.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }),
    h('h3', { class: 'sec' }, 'Hour by hour'),
    legend(),
    trimmedNote(res),
    grid,
    inspector,
  );
}

function trimmedNote(res) {
  const [lo, hi] = hourSpan(res);
  if (lo === 0 && hi === 23) return null;
  return h('p', { class: 'trimmed muted small' }, `Showing ${fmt.hourOf(lo)} to ${fmt.hourOf(hi)}. This job can’t start outside those hours.`);
}

function windowsList(job, wins, onPick) {
  const list = wins.slice(0, 6);
  if (!list.length) {
    const bl = blockerList(job, resultFor(job).res).slice(0, 3);
    return h('div', { class: 'wins empty' },
      h('p', {}, h('b', {}, `No window in the next ${daysLeft()} days.`), bl.length ? ` Mostly: ${bl.join(', ').toLowerCase()}.` : ''),
      h('p', { class: 'sub' }, 'Tap any square below to see exactly which rule rules it out. If your product allows it, you can loosen a rule with “Edit rules”.'),
    );
  }
  return h('div', { class: 'wins' },
    h('h3', { class: 'sec' }, 'Best times to start'),
    h('ul', {}, list.map(w => {
      const [a, b] = rangeOf(w);
      const why = w.quality === 'iffy' ? iffyReason(job, w.best) : '';
      return h('li', {},
        h('button', { class: `win ${w.quality}`, onclick: () => onPick(w.best) },
          h('i', { class: `dot ${w.quality}`, 'aria-hidden': 'true' }),
          h('span', { class: 'w-day' }, a - ctx.i0 < 6 * 24 ? dayName(a) : fmt.weekday(fc.time[a]), h('small', {}, fmt.monthDay(ctx.date[a]))),
          h('span', { class: 'w-t' }, rangeText(a, b), isFar(a) && h('small', { class: 'far' }, ' · long range')),
          h('span', { class: 'w-why' }, w.quality === 'go' ? (w.bonus ? '★ All clear, with a bonus' : 'All clear') : why || 'Iffy'),
        ));
    })),
  );
}

function bigGrid(job, res, onSelect) {
  const first = firstIndexByDate();
  const dates = [...first.keys()].filter(d => d >= today());
  const [lo, hi] = hourSpan(res);
  const cols = hi - lo + 1;
  const grid = h('div', { class: 'grid', role: 'group', 'aria-label': 'Start times by day and hour. Use the arrow keys to move.', 'data-cols': cols, style: `--cols: ${cols}` });
  grid.append(h('div', { class: 'g-row g-hours', 'aria-hidden': 'true' },
    h('span', { class: 'g-day' }),
    hourLabels(lo, hi, 'g-h'),
  ));
  dates.forEach((d, row) => {
    if (row === 7) grid.append(h('p', { class: 'g-far' }, 'Further out, the forecast is only a rough guide'));
    const cells = new Array(cols).fill(null);
    for (let i = first.get(d); i < ctx.n && ctx.date[i] === d; i++) {
      if (ctx.hour[i] >= lo && ctx.hour[i] <= hi) cells[ctx.hour[i] - lo] = i;
    }
    grid.append(h('div', { class: `g-row${row >= 7 ? ' far' : ''}` },
      h('span', { class: 'g-day' }, row === 0 ? 'Today' : `${fmt.wd(d)} ${+d.slice(8, 10)}`),
      cells.map(i => {
        if (i == null) return h('span', { class: 'cell none' });
        const cls = cellClass(res, i);
        if (i < ctx.i0) return h('span', { class: `cell ${cls}` });
        const label = `${fmt.dayHour(fc.time[i])}: ${cls.split(' ').map(c => STATE_NAMES[c] || '').filter(Boolean).join(', ')}`;
        return h('button', {
          class: `cell ${cls}${selected?.s === i ? ' sel' : ''}`, 'data-i': i, 'aria-label': label, title: label,
          tabindex: selected?.s === i ? '0' : '-1', onclick: () => onSelect(i),
        });
      }),
    ));
  });
  grid.addEventListener('keydown', e => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -24, ArrowDown: 24 };
    if (!(e.key in moves) || !selected) return;
    e.preventDefault();
    const target = grid.querySelector(`[data-i="${selected.s + moves[e.key]}"]`);
    if (target) { target.click(); target.focus(); }
  });
  fitLabels.observe(grid);
  return grid;
}

function fillInspector(box, job, res, s) {
  const r = res[s];
  const checks = explain(job, ctx, s);
  const end = s + job.hours;
  const cls = r ? (r.cls === 'busy' ? STATES[r.st] : r.cls) : 'unknown';
  const verdict = {
    go: 'Go. Everything checks out.',
    iffy: 'Iffy. It meets the minimums, but it’s cutting it close or missing an ideal.',
    no: 'No. At least one must-have fails.',
    off: 'Off. Outside the hours this job can happen.',
    unknown: 'Not enough forecast yet to say.',
  }[cls];
  const step = d => {
    const t = s + d;
    if (t >= ctx.i0 && t < ctx.n) { $(`[data-i="${t}"]`)?.click(); }
  };
  const lastCheck = Math.max(end, ...checks.map(c => c.span[1]));
  box.replaceChildren(...[
    h('div', { class: 'i-head' },
      h('button', { class: 'btn ghost sm', onclick: () => step(-1), disabled: s <= ctx.i0, 'aria-label': 'One hour earlier' }, '◀'),
      h('div', {},
        h('h3', {}, `Start ${fmt.dayHour(fc.time[s])}`),
        h('p', { class: 'muted' }, end < ctx.n ? `Done around ${fmt.hour(fc.time[end])}` : '', lastCheck > end && lastCheck <= ctx.n ? ` · checked through ${fmt.dayHour(fc.time[lastCheck - 1])}` : ''),
      ),
      h('button', { class: 'btn ghost sm', onclick: () => step(1), disabled: s >= ctx.n - 1, 'aria-label': 'One hour later' }, '▶'),
    ),
    h('p', { class: `verdict ${cls}` }, h('i', { class: `dot ${cls}`, 'aria-hidden': 'true' }), verdict),
    r?.cls === 'busy' && h('p', { class: 'muted' }, 'This is outside the hours you said you’re free. Change them in Settings.'),
    h('ul', { class: 'checks' }, checks.map(c => {
      const lvl = c.rule.lvl || 'must';
      let mark, k;
      if (c.st === UNKNOWN) [mark, k] = ['?', 'unk'];
      else if (lvl === 'bonus') [mark, k] = c.st === NO ? ['–', 'nb'] : ['★', 'bonus'];
      else if (c.st === GO) [mark, k] = ['✓', 'ok'];
      else if (c.st === IFFY) [mark, k] = lvl === 'must' ? ['!', 'close'] : ['✓', 'ok'];
      else [mark, k] = lvl === 'must' ? ['✗', 'bad'] : ['~', 'miss'];
      const obs = c.st === UNKNOWN ? 'Not in the forecast yet' : obsText(c.rule, c, ctx, fmt);
      return h('li', { class: k },
        h('span', { class: 'mark', 'aria-label': { ok: 'Passes', close: 'Close', bad: 'Fails', miss: 'Misses', bonus: 'Bonus', nb: 'No bonus', unk: 'Unknown' }[k] }, mark),
        h('div', {},
          h('span', { class: 'rt' }, ruleText(c.rule, fmt)), ' ',
          lvl !== 'must' && h('span', { class: `lvl ${lvl}` }, lvl === 'ideal' ? 'Ideal' : 'Bonus'),
          h('span', { class: 'obs' }, obs),
          c.rule.why && h('small', { class: 'why' }, c.rule.why),
        ));
    })),
    (cls === 'go' || cls === 'iffy') && calendarButtons(job, s),
  ].filter(Boolean));
}

function calendarButtons(job, s) {
  const start = zonedToUtc(fc.time[s], fc.tz);
  const end = start + job.hours * 36e5;
  const title = `${job.icon} ${job.name}`;
  const details = `${fmt.date(fc.time[s])} at ${fmt.hour(fc.time[s])}, from Good Day For (${placeLabel(state.place)}).\nForecasts change: check again the day before.\n${location.href.split('#')[0]}#/job/${encodeURIComponent(job.id)}`;
  const ev = { title, details, start, end };
  return h('div', { class: 'i-actions' },
    h('button', { class: 'btn', onclick: () => downloadIcs(ev, `${job.id}-${fc.time[s].slice(0, 10)}.ics`) }, 'Add to calendar'),
    h('a', { class: 'btn ghost', href: googleLink(ev), target: '_blank', rel: 'noopener' }, 'Google Calendar'),
  );
}

function copyJob(job) {
  const id = `my-${Date.now().toString(36)}`;
  state.custom[id] = { ...structuredClone(job), id, name: `${job.name} (my version)`, short: job.short, group: 'mine' };
  state.picks.push(id);
  persist();
  location.hash = `#/edit/${id}`;
}

// ——— How much to buy ———

// The calculator that goes with a job, as a route like 'stain' or 'seed/warm'.
// Jobs edited before this existed don't carry it, so fall back to the catalog.
const buyLink = job => job.buy || byId(job.id)?.buy || null;

const cash = () => moneyFmt(locale);
const shown = x => (x == null ? '' : String(Math.round(x * 100) / 100));
let barWatch = null, flash = '';

function buyView() {
  return h('div', { class: 'buy' },
    headBlock('buy'),
    h('div', { class: 'b-intro' },
      h('h2', {}, 'How much to buy'),
      h('p', { class: 'muted' }, 'Put in the size of the job and get the cans and bags to pick up, with a little extra and a price. The coverage figures are typical ones: change any of them to match your product, because the label wins.'),
    ),
    savedList(),
    h('div', { class: 'cards calcs' }, CALCS.map(c => h('a', { class: 'card', href: `#/buy/${c.id}` },
      h('div', { class: 'c-head' }, h('span', { class: 'ico', 'aria-hidden': 'true' }, c.icon), h('h3', {}, c.name)),
      h('p', { class: 'sub' }, c.about),
      lastTime(c),
    ))),
  );
}

// What's typed into a calculator right now, as a line for its card.
function lastTime(calc) {
  const saved = state.calc[calc.id];
  if (!saved) return null;
  const inputs = inputsFor(calc, state.units, saved);
  const q = quote(calc, inputs, locale);
  if (q.missing) return null;
  return h('p', { class: 'sub extra' }, `${summaryOf(calc, inputs, locale)}: ${q.parts.map(p => p.headline).join(' and ')}`);
}

function savedList() {
  const list = state.saved.filter(s => calcById(s.calc));
  if (!list.length) return null;
  return h('section', { class: 'saved' },
    h('h3', { class: 'sec' }, 'Your saved measurements'),
    h('ul', { class: 'saved-list' }, list.map(s => {
      const calc = calcById(s.calc);
      const q = quote(calc, inputsFor(calc, state.units, s), locale);
      const what = q.missing ? '' : [q.parts.map(p => p.headline).join(' and '), q.total != null && cash()(q.total)].filter(Boolean).join(' · ');
      return h('li', {},
        h('button', { class: 'saved-open', type: 'button', onclick: () => openSaved(s) },
          h('span', { class: 'ico', 'aria-hidden': 'true' }, calc.icon),
          h('span', {}, h('b', {}, s.name), what && h('small', {}, what))),
        h('button', { class: 'x', type: 'button', 'aria-label': `Forget “${s.name}”`, onclick: () => {
          state.saved = state.saved.filter(x => x !== s);
          persist();
          render();
        } }, '×'));
    })));
}

const snapshot = s => structuredClone({ v: s.v, m: s.m || {}, c: s.c || {}, f: s.f || {} });

function openSaved(s) {
  state.calc[s.calc] = snapshot(s);
  persist();
  location.hash = `#/buy/${s.calc}${s.v ? `/${s.v}` : ''}`;
}

function calcView(calc, word, arriving) {
  const saved = state.calc[calc.id] || (state.calc[calc.id] = {});
  const route = applyRoute(calc, word, saved);
  if (route.v && saved.v !== route.v) { saved.v = route.v; persist(); }
  // A job's link can pick the grass; only on the way in, so it doesn't undo your own choice.
  if (route.choices && arriving) {
    saved.c = saved.c || {};
    saved.c[''] = { ...(saved.c[''] || {}), ...route.choices };
    persist();
  }
  const box = h('div', { class: 'calc' });
  const draw = () => {
    const focus = document.activeElement?.id;
    put(box, calcBody(calc, saved, draw));
    if (focus) document.getElementById(focus)?.focus({ preventScroll: true });
  };
  draw();
  return box;
}

function calcBody(calc, saved, draw) {
  const units = state.units;
  const inp = inputsFor(calc, units, saved);
  const v = inp.v;
  saved.m = saved.m || {};
  saved.c = saved.c || {};
  saved.f = saved.f || {};
  const figs = () => {
    const byUnits = saved.f[inp.units] || (saved.f[inp.units] = {});
    return byUnits[v] || (byUnits[v] = {});
  };
  const choices = () => saved.c[v] || (saved.c[v] = {});
  const idOf = k => `c-${calc.id}-${k}`.replace(/[^\w-]/g, '_');

  const out = h('aside', { class: 'calc-out', 'aria-live': 'polite', 'aria-label': 'What to buy', tabindex: '-1' });
  const bar = h('button', { class: 'calc-bar', type: 'button', onclick: () => out.scrollIntoView({ behavior: 'smooth', block: 'start' }) });
  const update = () => fillAnswer(calc, saved, out, bar, draw);

  const measureRows = calc.measure(v, units).map(fd => {
    if (fd.type === 'head') return h('h4', { class: 'fld-head' }, fd.label);
    if (fd.when && !fd.when(inp.m)) return null;
    const id = idOf(fd.key);
    if (fd.type === 'choice') return choiceRow(id, fd.label, inp.m[fd.key], fd.options, x => { saved.m[fd.key] = x; persist(); draw(); });
    if (fd.type === 'check') return checkRow(id, fd.label, !!inp.m[fd.key], x => { saved.m[fd.key] = x; persist(); update(); });
    const u = measureFor(fd.kind, units);
    return numRow({ id, label: fd.label, value: inp.m[fd.key], unit: u.label, hint: fd.hint, count: fd.kind === 'count',
      onInput: x => { saved.m[fd.key] = x == null ? null : u.from(x); persist(); update(); } });
  });

  const figureRows = inp.figures.map(fd => {
    if (fd.when && !fd.when(inp.f)) return null;
    const id = idOf(`f-${fd.key}`);
    if (fd.type === 'choice') {
      return choiceRow(id, fd.label, inp.f[fd.key], fd.options, x => {
        choices()[fd.key] = x;
        for (const k of fd.resets || []) delete figs()[k];
        persist();
        draw();
      });
    }
    if (fd.type === 'check') return checkRow(id, fd.label, !!inp.f[fd.key], x => { choices()[fd.key] = x; persist(); draw(); });
    const typical = typeof fd.def === 'function' ? fd.def(inp.f) : fd.def;
    const mine = figs()[fd.key];
    return numRow({ id, label: fd.label, value: inp.f[fd.key], unit: fd.unit, hint: fd.hint, count: fd.step === 1,
      onInput: x => { if (x == null || !(x >= 0)) delete figs()[fd.key]; else figs()[fd.key] = x; persist(); update(); },
      extra: typeof mine === 'number' && mine !== typical && h('button', { class: 'link small', type: 'button', onclick: () => { delete figs()[fd.key]; persist(); draw(); } }, `Back to the typical ${shown(typical)}`) });
  });

  const money = cash();
  const partNames = Object.keys(inp.packs);
  const packRows = partNames.flatMap(part => [
    partNames.length > 1 && h('h4', { class: 'fld-head' }, part === 'primer' ? 'Primer' : 'Paint'),
    ...inp.packs[part].map(p => h('div', { class: 'fld pack' },
      h('span', { class: 'pk-name' }, packName(p)),
      p.editSize
        ? h('span', { class: 'num pk-size' },
          p.sizeLabel && h('span', { class: 'unit' }, p.sizeLabel),
          h('input', { id: idOf(`${part}-${p.id}-size`), type: 'number', inputmode: 'decimal', min: 0, step: 'any', value: shown(p.size), 'aria-label': `${packName(p)}: ${p.sizeLabel || 'size'} (${p.unit})`,
            oninput: e => { const x = +e.target.value; if (e.target.value === '' || !(x > 0)) delete figs()[`${part}.${p.id}.size`]; else figs()[`${part}.${p.id}.size`] = x; persist(); update(); } }),
          h('span', { class: 'unit' }, p.unit))
        : h('span', { class: 'pk-size' }),
      priceInput(idOf(`${part}-${p.id}-price`), p.price, money.symbol, `${packName(p)}: price`, x => { figs()[`${part}.${p.id}.price`] = x; persist(); update(); }),
    )),
  ]);
  if (inp.bulk) {
    packRows.push(h('div', { class: 'fld pack' },
      h('span', { class: 'pk-name' }, inp.bulk.name),
      h('span', { class: 'pk-size unit' }, `per ${inp.bulk.unit}`),
      priceInput(idOf('bulk-price'), inp.bulk.price, money.symbol, `${inp.bulk.name}: price per ${inp.bulk.unit}`, x => { figs()['bulk.price'] = x; persist(); update(); }),
    ));
  }

  const jobs = jobsOf(calc, v).map(jobFor).filter(Boolean);
  const form = h('div', { class: 'calc-form' },
    h('section', {}, h('h3', { class: 'sec' }, 'Measure'), h('div', { class: 'flds' }, measureRows)),
    h('section', {},
      h('h3', { class: 'sec' }, 'From the label'),
      h('div', { class: 'flds' }, figureRows),
      h('p', { class: 'muted small' }, 'Typical figures. If your product’s label says something different, go with the label.')),
    h('section', {},
      h('h3', { class: 'sec' }, 'What the store sells'),
      h('div', { class: 'flds' }, packRows),
      h('p', { class: 'muted small' }, 'Prices are rough guesses, so put in your store’s. Leave one blank for a size it doesn’t carry.')),
  );

  barWatch?.disconnect();
  if ('IntersectionObserver' in window) {
    barWatch = new IntersectionObserver(([e]) => bar.classList.toggle('away', e.isIntersecting), { threshold: 0.02 });
    queueMicrotask(() => barWatch?.observe(out));
  }
  update();

  const mine = state.saved.filter(s => s.calc === calc.id);
  return [
    h('a', { class: 'back', href: '#/buy' }, '← How much to buy'),
    h('div', { class: 'd-head' },
      h('span', { class: 'ico big', 'aria-hidden': 'true' }, calc.icon),
      h('div', {},
        h('h2', {}, calc.name),
        h('p', { class: 'about' }, calc.about),
        jobs.length > 0 && state.place && h('p', { class: 'when-link' }, 'Good day for it? ', jobs.map((j, k) => [k ? ' · ' : '', h('a', { href: `#/job/${encodeURIComponent(j.id)}` }, j.name)])),
      ),
    ),
    calc.variants && h('nav', { class: 'tabs seg', 'aria-label': 'Which one' },
      calc.variants.map(([k, l]) => h('a', { href: `#/buy/${calc.id}/${k}`, 'aria-current': k === v ? 'page' : null }, l))),
    mine.length > 0 && h('div', { class: 'recent saved-chips' }, h('span', { class: 'muted small' }, 'Saved: '),
      mine.map(s => h('button', { class: 'chip-btn', type: 'button', onclick: () => {
        Object.assign(saved, snapshot(s));
        persist();
        if (calc.variants && s.v && parseRoute().args[1] !== s.v) location.hash = `#/buy/${calc.id}/${s.v}`;
        else draw();
      } }, s.name))),
    h('div', { class: 'calc-cols' }, form, out),
    bar,
  ];
}

function numRow({ id, label, value, unit, hint, count, onInput, extra }) {
  return h('div', { class: 'fld' },
    h('label', { for: id }, label),
    h('span', { class: 'num' },
      h('input', { id, type: 'number', inputmode: count ? 'numeric' : 'decimal', min: 0, step: count ? 1 : 'any', value: shown(value),
        oninput: e => onInput(e.target.value === '' ? null : +e.target.value) }),
      h('span', { class: 'unit' }, unit || '')),
    (hint || extra) && h('small', { class: 'hint' }, hint, hint && extra ? ' ' : '', extra),
  );
}

function choiceRow(id, label, value, options, onChange) {
  return h('div', { class: 'fld choice' },
    h('label', { for: id }, label),
    h('select', { id, onchange: e => onChange(e.target.value) }, options.map(([k, l]) => h('option', { value: k, selected: k === value }, l))));
}

function checkRow(id, label, checked, onChange) {
  return h('div', { class: 'fld check' },
    h('label', { class: 'check' }, h('input', { id, type: 'checkbox', checked, onchange: e => onChange(e.target.checked) }), label));
}

function priceInput(id, price, symbol, label, onChange) {
  return h('span', { class: 'num pk-price' },
    symbol && h('span', { class: 'unit' }, symbol),
    h('input', { id, type: 'number', inputmode: 'decimal', min: 0, step: 'any', value: price == null ? '' : shown(price), placeholder: 'none', 'aria-label': label,
      oninput: e => onChange(e.target.value === '' ? null : Math.max(0, +e.target.value)) }));
}

function fillAnswer(calc, saved, out, bar, draw) {
  const inputs = inputsFor(calc, state.units, saved);
  const q = quote(calc, inputs, locale);
  const n = numFmt(locale), money = cash();
  if (q.missing) {
    put(out,
      h('h3', {}, 'What to buy'),
      h('p', { class: 'muted' }, `Put in ${q.missing} to see how much to buy.`),
      q.steps.length > 0 && stepsList(q.steps));
    put(bar, h('span', { class: 'bar-what muted' }, `Put in ${q.missing}.`));
    return;
  }
  const note = flash;
  flash = '';
  put(out,
    h('h3', {}, 'What to buy'),
    q.parts.map(p => h('div', { class: 'part' },
      q.parts.length > 1 && h('h4', {}, p.label),
      h('ul', { class: 'buy-list' }, p.buy.items.map(x => h('li', {},
        h('b', {}, packLabel(x.pack, x.n, n)),
        typeof x.pack.price === 'number' && h('span', { class: 'cost' }, x.n > 1 ? `${x.n} × ${money(x.pack.price)}` : money(x.pack.price))))),
      h('p', { class: 'muted small' }, `That’s ${n(p.buy.amount)} ${p.unit} for the ${n(p.need)} ${p.unit} you need.`),
    )),
    h('p', { class: 'total' }, q.total != null ? [h('span', {}, 'Total'), h('b', {}, money(q.total))] : h('span', {}, 'Add prices to see a total.')),
    q.bulk && h('p', { class: 'bulk' }, `Or ${lower(q.bulk.name)}: ${n(q.bulk.amount)} ${q.bulk.unit}${q.bulk.cost != null ? `, about ${money(q.bulk.cost)}` : ''}, ${q.bulk.plus}.`),
    q.tips.length > 0 && h('ul', { class: 'tips' }, q.tips.map(t => h('li', {}, t))),
    h('h4', { class: 'how' }, 'How it adds up'),
    stepsList(q.steps),
    saveForm(calc, saved, inputs, draw, note),
  );
  put(bar,
    h('span', { class: 'bar-what' }, h('small', {}, 'Buy '), q.parts.map(p => p.headline).join(' + ')),
    q.total != null && h('b', {}, money(q.total)));
}

function stepsList(steps) {
  return h('dl', { class: 'steps' }, steps.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
}

function saveForm(calc, saved, inputs, draw, note) {
  const auto = summaryOf(calc, inputs, locale);
  const input = h('input', { type: 'text', id: `c-${calc.id}-name`, maxlength: 80, placeholder: auto, autocomplete: 'off' });
  return h('form', { class: 'save-row', onsubmit: e => {
    e.preventDefault();
    const name = input.value.trim() || auto;
    state.saved = [{ calc: calc.id, name, ...snapshot(saved), at: Date.now() }, ...state.saved.filter(s => !(s.calc === calc.id && s.name === name))];
    persist();
    flash = `Saved as “${name}”. It’s on the How much to buy page too.`;
    draw();
  } },
  h('label', { for: input.id }, 'Save these measurements as'),
  h('div', { class: 'p-row' }, input, h('button', { class: 'btn', type: 'submit' }, 'Save')),
  note && h('p', { class: 'small ok-note', role: 'status' }, note));
}

// ——— Frost dates & planting ———

// Today's date where the place is.
function placeToday() {
  if (fc && ctx) return today();
  return localHourKey(Date.now(), frost?.tz || undefined).slice(0, 10);
}

// The cached frost dates for a place (never fetches).
function frostFor(place) {
  const key = placeKey(place);
  if (frostKey !== key) {
    frostKey = key;
    frost = store.loadFrost(key);
    frostErr = '';
  }
  return frost && frost.v === FROST_VERSION ? frost : null;
}

function frostView() {
  const entry = frostFor(state.place);
  const range = historyRange(placeToday(), state.place.lat);
  const current = !!entry && entry.start === range.start && entry.end === range.end;
  // Fetched only here, and only when there's nothing for this year yet.
  if (!current && !frostBusy && !frostErr) loadFrost(range);
  let body;
  if (entry) body = frostBody(entry, current);
  else if (frostErr) {
    body = h('div', { class: 'loading' },
      h('p', { class: 'err', role: 'alert' }, frostErr),
      h('button', { class: 'btn', onclick: () => { frostErr = ''; render(); } }, 'Try again'));
  } else {
    body = h('div', { class: 'loading' },
      h('span', { class: 'spin', 'aria-hidden': 'true' }),
      h('p', {}, `Looking up 30 years of weather for ${placeLabel(state.place)}…`),
      h('p', { class: 'muted small' }, 'Once a year per place. After that it’s kept in this browser.'));
  }
  return h('div', { class: 'frost' }, headBlock('frost'), body);
}

async function loadFrost(range) {
  const place = state.place, key = placeKey(place), token = ++frostToken;
  frostBusy = true;
  frostErr = '';
  try {
    const raw = await fetchHistory(place, range);
    if (token !== frostToken) return;
    frost = frostEntry(raw, key, range);
    store.saveFrost(frost);
  } catch (e) {
    if (token !== frostToken) return;
    frostErr = navigator.onLine === false ? 'You’re offline. The frost dates need a one-time download.' : e.message || 'Couldn’t reach the weather history service.';
  }
  frostBusy = false;
  if (parseRoute().view === 'frost') render();
}

function frostBody(entry, current) {
  const sum = summarize(entry);
  const south = sum.south;
  const md = idx => fmt.monthDay(`2000-${monthDayOf(idx, south)}`);
  const todayD = placeToday();
  const years = sum.n ? (south ? `${seasonName(sum.first, true)} to ${seasonName(sum.last, true)}` : `${sum.first}–${sum.last}`) : '';
  const anc = anchors(sum);
  return h('div', { class: 'frost-body' },
    h('div', { class: 'b-intro' },
      h('h2', {}, 'Frost dates'),
      h('p', { class: 'muted' },
        sum.n ? `From ${sum.n} years of weather history for this spot, ${years}.` : 'From the weather history for this spot.',
        !current && (frostBusy ? ' Adding last year…' : frostErr ? ` Couldn’t add last year: ${frostErr}` : ''))),
    frostStats(sum, md),
    anc && thisWeekPlan(anc, south, todayD),
    anc && plantingCalendar(anc, south, todayD, md),
    !anc && sum.regime !== 'thin' && noFrostPlanting(sum),
    sum.n > 0 && sum.regime !== 'none' && everyYear(entry, sum, md),
    frostMethod(entry, sum),
  );
}

function stat(key, value, sub, ...lines) {
  return h('div', { class: 'fs' },
    h('span', { class: 'fs-k' }, key),
    h('b', { class: 'fs-v' }, value),
    h('span', { class: 'fs-sub' }, sub),
    lines.filter(Boolean).map(l => h('p', {}, l)));
}

function frostStats(sum, md) {
  const f = sum.frost, T = fmt.temp(0);
  const day = d => (d ? fmt.fullDate(d) : '–');
  if (sum.regime === 'thin') {
    return h('div', { class: 'wins empty' }, h('p', {}, h('b', {}, 'Not enough history to work out frost dates here.'), ` Only ${sum.n} complete years came back for this spot.`));
  }
  if (sum.regime === 'none') {
    return h('div', { class: 'fstats one' },
      stat('Frost', `None in ${sum.n} years`, `The air never got down to ${T} here.`,
        sum.coldest && `The coldest night was ${fmt.temp(sum.coldest.v)}, on ${day(sum.coldest.on)}.`));
  }
  const cards = sum.regime === 'mild'
    ? [
      stat('Frost', `${f.withAny} of ${sum.n} winters`, `In most years it never gets down to ${T}.`,
        f.last.p90 != null && ['1 year in 10 there’s still a frost after ', h('b', {}, md(f.last.p90)), '.']),
      f.last.count > 0 && stat('Last frost, when there is one', md(f.last.among ?? dayOfSeason(f.last.latest, sum.south)), 'Typical, in the years it came.', `Latest: ${day(f.last.latest)}.`),
      f.first.count > 0 && stat('First frost, when there is one', md(f.first.among ?? dayOfSeason(f.first.earliest, sum.south)), 'Typical, in the years it came.', `Earliest: ${day(f.first.earliest)}.`),
    ]
    : [
      stat('Last spring frost', md(f.last.median), 'Typical: half of years are later.',
        ['1 year in 10 it’s later than ', h('b', {}, md(f.last.p90)), '.'],
        `Latest: ${day(f.last.latest)}. Earliest: ${day(f.last.earliest)}.`),
      stat('First fall frost', md(f.first.median), 'Typical: half of years are earlier.',
        ['1 year in 10 it’s earlier than ', h('b', {}, md(f.first.p10)), '.'],
        `Earliest: ${day(f.first.earliest)}. Latest: ${day(f.first.latest)}.`),
      stat('Frost-free season', `${f.days.median} days`, 'Typical, from the last frost to the first.',
        ['1 year in 10 it’s shorter than ', h('b', {}, `${f.days.p10} days`), '.'],
        `Shortest: ${f.days.shortest} days. Longest: ${f.days.longest}.`),
    ];
  const hd = sum.hard, TH = fmt.temp(HARD);
  let hard;
  if (!hd.withAny) hard = `No hard freeze (${TH} or colder) in ${sum.n} years.`;
  else if (hd.last.median == null || hd.first.median == null) hard = `A hard freeze (${TH} or colder) came in ${hd.withAny} of ${sum.n} winters.`;
  else hard = ['Hard freeze (', TH, ' or colder, enough to kill tender plants and nip hardy ones): typically over by ', h('b', {}, md(hd.last.median)), ' and back by ', h('b', {}, md(hd.first.median)), '.'];
  return [
    h('div', { class: 'fstats' }, cards.filter(Boolean)),
    h('p', { class: 'hard' }, h('span', { 'aria-hidden': 'true' }, '🥶 '), hard),
    sum.anyMonth && h('p', { class: 'd-alert' }, 'Frost has come in every month of the year here, so no date is completely safe.'),
  ];
}

// For a calendar row that matches a job: what the forecast says about it.
function jobNote(job) {
  const href = `#/job/${encodeURIComponent(job.id)}`;
  if (!fc || !ctx) return h('a', { class: 'pl-job', href }, `${job.icon} ${job.name}: see which days work`);
  const { res, wins } = resultFor(job);
  const w = wins.find(x => x.quality === 'go') || wins[0];
  let text;
  if (w) {
    const [a, b] = rangeOf(w);
    text = `${w.quality === 'go' ? '' : 'iffy '}${relDay(ctx.date[a], today(), fmt)}, ${rangeText(a, b)}`;
  } else {
    const bl = blockerList(job, res).slice(0, 2);
    text = `no window in the next ${daysLeft()} days${bl.length ? ` (${bl.join(', ').toLowerCase()})` : ''}`;
  }
  const soil = extraLines(job).find(t => t.startsWith('Soil'));
  return h('a', { class: 'pl-job', href }, h('span', { 'aria-hidden': 'true' }, job.icon, ' '), `${job.short}: ${text}.`, soil ? ` ${soil}` : '');
}

function thisWeekPlan(anc, south, todayD) {
  const plan = weekPlan(anc, south, todayD);
  const item = (x, soon) => {
    const job = x.crop.job && x.step.k !== 'indoors' ? jobFor(x.crop.job) : null;
    const when = soon || x.start > todayD ? `from ${fmt.monthDay(x.start)}` : `until ${fmt.monthDay(x.end)}`;
    return h('li', {},
      h('i', { class: `dot k-${x.step.k}`, 'aria-hidden': 'true' }),
      h('span', { class: 'ico', 'aria-hidden': 'true' }, x.crop.icon),
      h('span', { class: 'nm' }, h('b', {}, x.crop.name), ' ', h('span', { class: 'do' }, say(x.step))),
      h('span', { class: 't' }, when),
      !soon && job && jobNote(job));
  };
  return h('section', { class: 'plan' },
    h('h3', { class: 'sec' }, `What to do this week · ${fmt.monthDay(todayD)} – ${fmt.monthDay(plan.weekEnd)}`),
    h('div', { class: 'day' },
      plan.now.length
        ? h('ul', { class: 'plan-list' }, plan.now.map(x => item(x, false)))
        : h('p', { class: 'd-none' }, 'Nothing on the calendar this week.'),
      plan.soon.length > 0 && h('div', { class: 'soon' },
        h('p', { class: 'd-no' }, 'Coming up'),
        h('ul', { class: 'plan-list' }, plan.soon.slice(0, 6).map(x => item(x, true))))),
  );
}

const pct = x => `${(x / SEASON_DAYS * 100).toFixed(3)}%`;

// Month names along the top of a season-long chart, plus an optional "today" label.
function seasonAxis(south, now) {
  const ticks = monthTicks(south);
  const edge = now == null ? '' : now < SEASON_DAYS * 0.08 ? ' at-start' : now > SEASON_DAYS * 0.92 ? ' at-end' : '';
  return h('div', { class: 'tl-row tl-head', 'aria-hidden': 'true' },
    h('span', { class: 'tl-name' }),
    h('span', { class: 'tl-track' },
      ticks.map((t, k) => h('span', { class: 'tl-m', style: `left:${pct(t.idx)};width:${pct((ticks[k + 1]?.idx ?? SEASON_DAYS) - t.idx)}` },
        h('span', { class: 'm-long' }, fmt.month(t.month)), h('span', { class: 'm-short' }, fmt.monthNarrow(t.month)))),
      now != null && h('span', { class: `tl-now${edge}`, style: `left:${pct(now)}` }, 'This week')));
}

// Gridlines, the frost season and the typical dates, behind a chart's bars.
function seasonLayer(south, anc, now) {
  return [
    h('div', { class: 'tl-layer', 'aria-hidden': 'true' },
      monthTicks(south).map(t => h('i', { class: 'tl-grid', style: `left:${pct(t.idx)}` })),
      anc && segments(anc.F, anc.L + SEASON_DAYS).map(([a, b]) => h('i', { class: 'tl-frost', style: `left:${pct(a)};width:${pct(b - a + 1)}` })),
      anc && [anc.L, anc.F].map(x => h('i', { class: 'tl-line', style: `left:${pct(x)}` }))),
    now != null && h('div', { class: 'tl-layer over', 'aria-hidden': 'true' }, h('i', { class: 'tl-today', style: `left:${pct(now)}` })),
  ];
}

function plantingCalendar(anc, south, todayD, md) {
  const rows = calendar(anc);
  const now = dayOfSeason(todayD, south);
  const tl = h('div', { class: 'tl' }, seasonAxis(south, now), seasonLayer(south, anc, now));
  for (const [g, name] of PLANT_GROUPS) {
    const list = rows.filter(r => r.crop.group === g);
    if (!list.length) continue;
    tl.append(h('div', { class: 'tl-group' }, name));
    for (const r of list) {
      const id = `tl-${r.crop.id}`;
      const job = r.crop.job && jobFor(r.crop.job);
      const lines = r.bars.map(b => {
        const w = windowsNear(b.step, anc, south, todayD).find(x => x.end >= todayD);
        return { b, text: w ? `${fmt.monthDay(w.start)} – ${fmt.monthDay(w.end)}` : `${md(b.a)} – ${md(b.b)}` };
      });
      const info = h('div', { class: 'tl-info', id, hidden: true },
        h('ul', {}, lines.map(({ b, text }) => h('li', {}, h('i', { class: `dot k-${b.step.k}`, 'aria-hidden': 'true' }), h('b', {}, say(b.step)), ` ${text}`))),
        h('p', { class: 'muted' }, r.crop.note),
        job && h('a', { href: `#/job/${encodeURIComponent(job.id)}` }, `${job.icon} ${job.name}: see which hours work`));
      const row = h('button', { class: 'tl-row', type: 'button', 'aria-expanded': 'false', 'aria-controls': id, onclick: () => {
        const open = info.hidden;
        info.hidden = !open;
        row.setAttribute('aria-expanded', String(open));
      } },
      h('span', { class: 'tl-name' }, h('span', { class: 'ico', 'aria-hidden': 'true' }, r.crop.icon), h('span', { class: 'tl-nm' }, r.crop.name)),
      h('span', { class: 'tl-track' },
        r.bars.flatMap(b => segments(b.a, b.b).map(([x0, x1]) => h('i', { class: `tl-bar k-${b.step.k}`, style: `left:${pct(x0)};width:${pct(x1 - x0 + 1)}`, title: `${say(b.step)}: ${md(b.a)} – ${md(b.b)}` }))),
        h('span', { class: 'sr' }, lines.map(({ b, text }) => `${say(b.step)} ${text}.`).join(' '))));
      tl.append(row, info);
    }
  }
  return h('section', { class: 'calendar' },
    h('h3', { class: 'sec' }, 'Planting calendar'),
    h('div', { class: 'legend' },
      KINDS.map(([k, l]) => h('span', {}, h('i', { class: `sw k-${k}` }), l)),
      h('span', {}, h('i', { class: 'sw frost-sw' }), 'Frost season'),
      h('span', {}, h('i', { class: 'ln' }), `Typical last and first frost, ${md(anc.L)} and ${md(anc.F)}`),
      h('span', { class: 'hint' }, 'Tap a row for this year’s dates.')),
    tl,
    h('p', { class: 'muted small' }, 'Counted in weeks from the typical frost dates. Where a row matches one of your jobs, like seeding the lawn, the job’s own rules pick the actual day.'),
  );
}

function everyYear(entry, sum, md) {
  const south = sum.south;
  const list = [...entry.seasons].sort((a, b) => b.y - a.y);
  const anc = sum.frost.last.median != null && sum.frost.first.median != null ? { L: sum.frost.last.median, F: sum.frost.first.median } : null;
  const rows = list.map(s => {
    const name = seasonName(s.y, south);
    if (!s.ok) return h('div', { class: 'tl-row' }, h('span', { class: 'tl-name' }, name), h('span', { class: 'tl-track gap' }, 'Missing data'));
    const a = s.lf ? dayOfSeason(s.lf, south) + 1 : 0, b = s.ff ? dayOfSeason(s.ff, south) - 1 : SEASON_DAYS - 1;
    const text = `${s.lf ? `last frost ${fmt.monthDay(s.lf)}` : 'no spring frost'}, ${s.ff ? `first frost ${fmt.monthDay(s.ff)}` : 'no fall frost'}`;
    return h('div', { class: 'tl-row', title: `${name}: ${text}` },
      h('span', { class: 'tl-name' }, name),
      h('span', { class: 'tl-track' },
        b >= a && h('i', { class: 'tl-bar k-free', style: `left:${pct(a)};width:${pct(b - a + 1)}` }),
        h('span', { class: 'sr' }, `${text}.`)));
  });
  return h('details', { class: 'years' },
    h('summary', {}, `Every year since ${seasonName(list.at(-1).y, south)}`),
    h('p', { class: 'muted small' }, 'Green is each year’s frost-free stretch; the lines are the typical dates.'),
    h('div', { class: 'tl yrs' }, seasonAxis(south, null), seasonLayer(south, anc, null), rows),
  );
}

function noFrostPlanting(sum) {
  const cool = coolMonths(sum.monthly);
  const link = id => { const j = jobFor(id); return j ? h('a', { href: `#/job/${id}` }, j.name) : ''; };
  return h('section', { class: 'plan' },
    h('h3', { class: 'sec' }, 'Planting without frost dates'),
    h('div', { class: 'day' },
      h('p', {}, sum.regime === 'none' ? 'With no frost to wait for, heat is the limit here, not cold. ' : 'Frost is too rare here to hang a calendar on. ',
        'Tender plants like tomatoes, peppers and basil can go out whenever the nights are mild, and they struggle through the hottest weeks.'),
      cool.length > 0 && h('p', {}, 'Cool-season crops (lettuce, peas, broccoli, carrots, cilantro) do best in the cooler months, about ',
        h('b', {}, `${fmt.month(cool[0])} to ${fmt.month(cool.at(-1))}`), ' here.'),
      h('p', {}, 'For the lawn, crabgrass preventer and seeding go by soil temperature, which ', link('preemergent'), ' and ', link('seed-warm'), ' keep an eye on.')),
  );
}

function frostMethod(entry, sum) {
  const T = fmt.temp(0), TH = fmt.temp(HARD);
  const elev = entry.elevation == null ? null : state.units === 'metric' ? `${Math.round(entry.elevation)} m` : `${Math.round(entry.elevation / 0.3048).toLocaleString(locale)} ft`;
  const tenth = Math.max(1, Math.round(sum.n / 10));
  return h('section', { class: 'method' },
    h('h3', { class: 'sec' }, 'How these dates are worked out'),
    h('p', {}, `Good Day For downloads the daily low for every day from ${fmt.fullDate(entry.start)} to ${fmt.fullDate(entry.end)} from `,
      h('a', { href: 'https://open-meteo.com/en/docs/historical-weather-api', target: '_blank', rel: 'noopener' }, 'Open-Meteo’s weather archive'),
      `. For each year it finds the last night in spring and the first night in fall that got down to ${T}, and the same for a hard freeze at ${TH}. “Typical” is the middle year: half were earlier and half later. “1 year in 10” is a date only about ${tenth} of the ${sum.n} years went past.`),
    h('p', {}, 'The history is a weather model re-run over the past (reanalysis) on a grid roughly 10 to 25 km (6 to 15 miles) across, not a thermometer in your yard. Cold air sinks and pools on still nights, so low spots and valleys frost later in spring and earlier in fall than this says, while slopes, towns and gardens near big water stay a little warmer.',
      elev ? ` The grid point sits ${elev} above sea level; if you’re much higher, expect frost more often.` : ''),
    h('p', {}, `It’s also the air about 2 m (6 ft) up, not the ground. On a clear, calm night the grass can frost while the air is still a few degrees above freezing, so cover tender plants when the forecast low is around ${fmt.temp(2)}. Good Day For warns you about frost in the week ahead.`),
    h('p', { class: 'muted small' }, 'The planting times are common extension-service advice, counted from the typical dates; your seed packet knows its own variety. The history is worked out once a year and kept in this browser.'),
  );
}

// On a job's page: when the planting calendar says it's in season here.
function seasonLine(job) {
  if (!state.place || !CROPS.some(c => c.job === job.id)) return null;
  const entry = frostFor(state.place);
  const anc = entry && anchors(summarize(entry));
  if (!anc) return null;
  const todayD = placeToday();
  const w = seasonFor(job.id, anc, entry.south, todayD);
  if (!w) return null;
  const text = w.start <= todayD ? `In season here now, through ${fmt.monthDay(w.end)}` : `In season here ${fmt.monthDay(w.start)} – ${fmt.monthDay(w.end)}`;
  return h('p', { class: 'season' }, h('span', { 'aria-hidden': 'true' }, '📅 '), `${text}, going by your typical frost dates. The hours below say which days actually work. `, h('a', { href: '#/frost' }, 'Planting calendar'));
}

// ——— Rule editor ———

function editorView(job) {
  const isNew = !job;
  const builtIn = job && !state.custom[job.id] && byId(job.id);
  const draft = isNew
    ? { id: `my-${Date.now().toString(36)}`, group: 'mine', icon: '✅', name: '', hours: 2, rules: [{ t: 'daylight' }, { t: 'dry', when: 'during+after', h: 2 }] }
    : structuredClone(job);
  draft.rules.forEach(r => { r.lvl = r.lvl || 'must'; });
  const rulesBox = h('ol', { class: 'rules' });
  const renderRules = () => rulesBox.replaceChildren(...draft.rules.map((r, k) => ruleRow(draft, r, k, renderRules)));
  renderRules();
  const addSel = h('select', { 'aria-label': 'Add a rule', onchange: e => {
    const t = e.target.value;
    if (!t) return;
    const def = RULE_TYPES[t];
    const r = { t, lvl: 'must' };
    if (def.span) Object.assign(r, { when: 'during' });
    if (def.def != null) r.v = def.def;
    if (t === 'clock') Object.assign(r, { from: 8, to: 18 });
    if (t === 'soil') Object.assign(r, { depth: 6, min: 10, max: 18 });
    draft.rules.push(r);
    e.target.value = '';
    renderRules();
  } }, h('option', { value: '' }, '+ Add a rule…'), Object.entries(RULE_TYPES).map(([t, d]) => h('option', { value: t }, d.label)));

  const save = e => {
    e.preventDefault();
    draft.name = draft.name.trim() || 'My job';
    draft.short = draft.short && !isNew && builtIn ? draft.short : draft.name;
    if (builtIn) state.edits[draft.id] = draft;
    else state.custom[draft.id] = draft;
    if (!state.picks.includes(draft.id)) state.picks.push(draft.id);
    persist();
    results.delete(draft.id);
    selected = null;
    location.hash = `#/job/${encodeURIComponent(draft.id)}`;
  };

  return h('form', { class: 'editor', onsubmit: save },
    h('a', { class: 'back', href: isNew ? '#/jobs' : `#/job/${encodeURIComponent(draft.id)}` }, '← Back'),
    h('h2', {}, isNew ? 'Make your own job' : `Edit: ${draft.name}`),
    h('p', { class: 'muted' }, 'Rules marked ', h('b', {}, 'Must'), ' rule an hour out. ', h('b', {}, 'Ideal'), ' ones only make it iffy. ', h('b', {}, 'Bonus'), ' ones earn a star when they come true. If your product’s label says something different, go with the label.'),
    h('div', { class: 'fields' },
      h('label', { class: 'f-name' }, 'Name', h('input', { value: draft.name, required: true, maxlength: 60, placeholder: 'Stain the fence', oninput: e => { draft.name = e.target.value; } })),
      h('label', {}, 'Icon', h('select', { onchange: e => { draft.icon = e.target.value; } },
        [...new Set([draft.icon, ...ICONS])].map(i => h('option', { value: i, selected: i === draft.icon }, i)))),
      h('label', {}, 'Hours of work', h('input', { type: 'number', min: 1, max: 12, step: 1, value: draft.hours, oninput: e => { draft.hours = Math.max(1, Math.min(12, Math.round(+e.target.value || 1))); } })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !draft.anytime, onchange: e => { draft.anytime = !e.target.checked; } }), 'I have to be there (use my schedule)'),
    ),
    h('h3', { class: 'sec' }, 'Rules'),
    rulesBox,
    addSel,
    h('div', { class: 'e-actions' },
      h('button', { class: 'btn', type: 'submit' }, 'Save'),
      h('a', { class: 'btn ghost', href: isNew ? '#/jobs' : `#/job/${encodeURIComponent(draft.id)}` }, 'Cancel'),
      builtIn && state.edits[draft.id] && h('button', { class: 'btn ghost', type: 'button', onclick: () => {
        delete state.edits[draft.id];
        persist();
        results.delete(draft.id);
        location.hash = `#/job/${encodeURIComponent(draft.id)}`;
      } }, 'Back to the original rules'),
      !isNew && !builtIn && h('button', { class: 'btn ghost danger', type: 'button', onclick: () => {
        if (!confirm(`Delete “${draft.name}”?`)) return;
        delete state.custom[draft.id];
        state.picks = state.picks.filter(p => p !== draft.id);
        persist();
        location.hash = '#/';
      } }, 'Delete this job'),
    ),
  );
}

function numInput(kind, metric, onChange, label) {
  const u = unitFor(kind, state.units);
  return h('span', { class: 'num' },
    h('input', { type: 'number', step: u.step, value: metric == null ? '' : u.to(metric), 'aria-label': label, oninput: e => {
      const v = e.target.value === '' ? null : u.from(+e.target.value);
      onChange(v);
    } }),
    h('span', { class: 'unit' }, u.label));
}

function hourSelect(value, onChange, label) {
  return h('select', { 'aria-label': label, onchange: e => onChange(+e.target.value) },
    Array.from({ length: 25 }, (_, hr) => h('option', { value: hr, selected: hr === value }, hr === 24 ? 'midnight' : fmt.hourOf(hr))));
}

function ruleRow(draft, r, k, rerender) {
  const def = RULE_TYPES[r.t] || { label: r.t };
  const preview = h('span', { class: 'preview' }, ruleText(r, fmt));
  const upd = () => { preview.textContent = ruleText(r, fmt); };
  const controls = [];
  if (r.t === 'clock') {
    controls.push('from ', hourSelect(r.from, v => { r.from = v; upd(); }, 'From'), ' to ', hourSelect(r.to, v => { r.to = v; upd(); }, 'To'));
  } else if (r.t === 'soil') {
    controls.push(
      h('select', { 'aria-label': 'Depth', onchange: e => { r.depth = +e.target.value; upd(); } },
        [6, 18].map(d => h('option', { value: d, selected: (r.depth || 6) === d }, `${fmt.depth(d)} down`))),
      ' at least ', numInput('temp', r.min, v => { r.min = v; upd(); }, 'Lowest'),
      ' and at most ', numInput('temp', r.max, v => { r.max = v; upd(); }, 'Highest'),
    );
  } else if (def.kind) {
    controls.push(numInput(def.kind, r.v, v => { r.v = v ?? 0; upd(); }, def.label));
  }
  if (def.span) {
    const hours = numHours(r, upd);
    hours.hidden = (r.when || 'during') === 'during';
    controls.push(
      h('select', { 'aria-label': 'When', onchange: e => {
        r.when = e.target.value;
        if (r.when !== 'during' && !r.h) r.h = 12;
        hours.hidden = r.when === 'during';
        hours.querySelector('input').value = r.h || '';
        upd();
      } }, WHEN.map(([v, l]) => h('option', { value: v, selected: (r.when || 'during') === v }, l))),
      hours,
    );
  }
  return h('li', { class: 'rule-row' },
    h('div', { class: 'r-top' },
      h('select', { class: `lvl-sel ${r.lvl}`, 'aria-label': 'How strict', onchange: e => { r.lvl = e.target.value; e.target.className = `lvl-sel ${r.lvl}`; } },
        [['must', 'Must'], ['ideal', 'Ideal'], ['bonus', 'Bonus']].map(([v, l]) => h('option', { value: v, selected: r.lvl === v }, l))),
      h('b', { class: 'r-type' }, def.label),
      h('button', { class: 'x', type: 'button', 'aria-label': `Remove rule: ${ruleText(r, fmt)}`, onclick: () => { draft.rules.splice(k, 1); rerender(); } }, '×'),
    ),
    controls.length > 0 && h('div', { class: 'r-ctl' }, controls),
    preview,
    r.why && h('small', { class: 'why' }, r.why),
  );
}

function numHours(r, upd) {
  return h('span', { class: 'num' },
    h('input', { type: 'number', min: 1, max: 168, step: 1, value: r.h || '', 'aria-label': 'Hours', oninput: e => { r.h = Math.max(1, Math.min(168, Math.round(+e.target.value || 1))); upd(); } }),
    h('span', { class: 'unit' }, 'hours'));
}

// ——— Catalog ———

function catalogView() {
  const toggle = (id, on) => {
    state.picks = on ? [...state.picks.filter(p => p !== id), id] : state.picks.filter(p => p !== id);
    persist();
  };
  const row = job => h('li', {},
    h('label', { class: 'pick' },
      h('input', { type: 'checkbox', checked: state.picks.includes(job.id), onchange: e => toggle(job.id, e.target.checked) }),
      h('span', { class: 'ico', 'aria-hidden': 'true' }, jobFor(job.id).icon),
      h('span', {}, h('b', {}, jobFor(job.id).name), h('small', {}, job.about || '')),
    ));
  const mine = Object.values(state.custom);
  return h('div', { class: 'catalog' },
    h('a', { class: 'back', href: '#/' }, '← Done'),
    h('h2', {}, 'What’s on your list?'),
    h('p', { class: 'muted' }, 'Tick the jobs you want to keep an eye on. Every job’s rules can be edited, and you can make your own.'),
    h('a', { class: 'btn', href: '#/new' }, '+ Make your own job'),
    mine.length > 0 && h('section', {}, h('h3', { class: 'sec' }, 'Your own'), h('ul', { class: 'picks' }, mine.map(row))),
    GROUPS.map(g => h('section', {},
      h('h3', { class: 'sec' }, g.name),
      h('ul', { class: 'picks' }, JOBS.filter(j => j.group === g.id).map(row)),
    )),
    h('a', { class: 'btn', href: '#/' }, 'Done'),
  );
}

// ——— Settings ———

function settingsView() {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const changed = () => { persist(); results.clear(); render(); };
  const custom = state.schedule.preset === 'custom';
  return h('div', { class: 'settings' },
    h('a', { class: 'back', href: '#/' }, '← Back'),
    h('h2', {}, 'Settings'),
    h('section', {},
      h('h3', { class: 'sec' }, 'Units'),
      h('div', { class: 'radios' }, [['us', 'US (°F, mph, inches)'], ['metric', 'Metric (°C, km/h, mm)']].map(([v, l]) =>
        h('label', {}, h('input', { type: 'radio', name: 'units', checked: state.units === v, onchange: () => { state.units = v; changed(); } }), l))),
    ),
    h('section', {},
      h('h3', { class: 'sec' }, 'When are you free?'),
      h('p', { class: 'muted' }, 'Windows only count hours when you can actually get out there. Jobs that run themselves, like the sprinkler, ignore this.'),
      h('div', { class: 'radios' }, Object.entries(store.SCHEDULES).map(([v, d]) =>
        h('label', {}, h('input', { type: 'radio', name: 'sched', checked: state.schedule.preset === v, onchange: () => { state.schedule.preset = v; changed(); } }), h('span', {}, d.name, h('small', {}, d.note))))),
      custom && h('table', { class: 'days' }, h('tbody', {}, days.map((d, k) => {
        const r = state.schedule.days[k];
        return h('tr', {},
          h('th', {}, d),
          h('td', {}, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!r, onchange: e => { state.schedule.days[k] = e.target.checked ? [8, 20] : null; changed(); } }), 'Free')),
          h('td', {}, r && [hourSelect(r[0], v => { r[0] = v; changed(); }, `${d} from`), ' to ', hourSelect(r[1], v => { r[1] = v; changed(); }, `${d} to`)]),
        );
      }))),
    ),
    h('section', {},
      h('h3', { class: 'sec' }, 'Place'),
      h('p', {}, state.place ? placeLabel(state.place) : 'None yet', ' ', h('a', { href: '#/place' }, 'Change')),
    ),
    h('section', {},
      h('h3', { class: 'sec' }, 'How it works'),
      h('p', {}, 'Every job is a list of rules: how long the work takes, plus what the weather has to do before, during and after. That might be no rain for 24 hours after, staying above 50°F overnight, or wind under 10 mph. For each hour in the next 16 days, Good Day For checks whether starting then would keep every rule. Green means yes. Amber means yes, but close to a limit (or a 30–50% chance of rain). Grey-pink means a must-have fails.'),
      h('p', {}, 'The forecast is from ', h('a', { href: 'https://open-meteo.com/', target: '_blank', rel: 'noopener' }, 'Open-Meteo'), ', which blends national weather models. It includes soil temperature, drying power and evaporation, which is how the lawn and laundry rules work. Your list, rules and place stay in this browser.'),
      h('p', { class: 'muted' }, 'Forecasts change, especially past a few days. The limits here are typical label and extension guidance, not a guarantee. When your product’s label disagrees, the label wins.'),
    ),
    h('section', {},
      h('h3', { class: 'sec' }, 'Start over'),
      h('button', { class: 'btn ghost danger', onclick: () => {
        if (!confirm('Clear your place, list, schedule, edited rules, saved measurements and frost dates?')) return;
        store.clearAll();
        location.hash = '#/';
        location.reload();
      } }, 'Clear everything'),
    ),
  );
}

// ——— Place picker and welcome ———

function placePicker() {
  const out = h('ul', { class: 'results', 'aria-live': 'polite' });
  const msg = h('p', { class: 'muted small' });
  let timer, ctl;
  const run = async q => {
    ctl?.abort();
    ctl = new AbortController();
    if (q.trim().length < 2) { out.replaceChildren(); msg.textContent = ''; return; }
    msg.textContent = 'Searching…';
    try {
      const list = await searchPlaces(q, { signal: ctl.signal });
      msg.textContent = list.length ? '' : 'No places by that name. Try a city or ZIP code.';
      out.replaceChildren(...list.map(p => h('li', {}, h('button', { class: 'result', type: 'button', onclick: () => setPlace(p) },
        h('b', {}, p.name), ' ', h('span', { class: 'muted' }, [p.admin, p.country].filter(Boolean).join(', '))))));
    } catch (e) {
      if (e.name !== 'AbortError') msg.textContent = e.message;
    }
  };
  const input = h('input', { type: 'search', placeholder: 'City or ZIP code', autocomplete: 'off', 'aria-label': 'City or ZIP code',
    oninput: e => { clearTimeout(timer); timer = setTimeout(() => run(e.target.value), 300); },
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); run(e.target.value); } } });
  const locBtn = h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
    locBtn.disabled = true;
    msg.textContent = 'Finding you…';
    try {
      const { lat, lon } = await locate();
      setPlace({ lat, lon, ...(await nameFor(lat, lon)) });
    } catch (e) {
      msg.textContent = e.message;
      locBtn.disabled = false;
    }
  } }, '📍 Use my location');
  const recent = state.recent.filter(p => !state.place || placeKey(p) !== placeKey(state.place));
  // Jump into the search box, but don't throw a phone keyboard up unasked.
  if (matchMedia('(pointer: fine)').matches) queueMicrotask(() => input.focus({ preventScroll: true }));
  return h('div', { class: 'picker' },
    h('div', { class: 'p-row' }, input, locBtn),
    msg, out,
    recent.length > 0 && h('div', { class: 'recent' }, h('span', { class: 'muted small' }, 'Recent: '),
      recent.map(p => h('button', { class: 'chip-btn', type: 'button', onclick: () => setPlace(p) }, placeLabel(p)))),
  );
}

function placeView() {
  return h('div', { class: 'place' },
    state.place && h('a', { class: 'back', href: '#/' }, '← Back'),
    h('h2', {}, 'Where are the chores?'),
    placePicker(),
  );
}

function welcomeView() {
  return h('div', { class: 'welcome' },
    h('h1', {}, 'Is it a good day for it?'),
    h('p', { class: 'lede' }, 'Staining the deck, painting, sealing the driveway, spraying weeds, seeding the lawn, hanging laundry. Every outdoor job has its own weather rules, and most of them reach past today: ', h('i', {}, 'no rain for 24 hours after, above 50°F overnight, wind under 10 mph'), '.'),
    h('p', { class: 'lede' }, 'Good Day For reads the hour-by-hour forecast against each job’s rules and shows you when to start.'),
    h('div', { class: 'pitch' },
      h('div', {}, h('b', {}, '28 jobs, ready to go'), h('span', {}, 'With typical label limits you can adjust, or make your own.')),
      h('div', {}, h('b', {}, 'Shows why'), h('span', {}, 'Tap any hour to see which rule passes or fails.')),
      h('div', {}, h('b', {}, 'Fits your week'), h('span', {}, 'Say when you’re free and it only counts those hours.')),
    ),
    h('h2', {}, 'First, where’s the yard?'),
    placePicker(),
    h('p', { class: 'muted small' }, 'No account. Everything stays in this browser.'),
  );
}

function loadingView() {
  return h('div', { class: 'loading' },
    loadError
      ? [h('p', { class: 'err', role: 'alert' }, loadError), h('button', { class: 'btn', onclick: () => refresh(true) }, 'Try again')]
      : [h('span', { class: 'spin', 'aria-hidden': 'true' }), h('p', {}, `Getting the forecast for ${placeLabel(state.place)}…`)],
  );
}

// ——— Start ———

$('#placeBtn').addEventListener('click', () => { location.hash = '#/place'; });
window.addEventListener('hashchange', render);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh(false);
});
setInterval(() => {
  if (!fc) return;
  if (localHourKey(Date.now(), fc.tz, fc.utcOffset) !== ctxHour) softRender();
  if (Date.now() - fc.fetchedAt > 60 * 60e3 && document.visibilityState === 'visible') refresh(false);
}, 60e3);

render();
refresh(false);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
