// Good Day For: the page.

import { JOBS, GROUPS, byId } from './jobs.js';
import { prepare, rateJob, findWindows, blockers, explain, alerts, waterBalance, rangesOn, localHourKey, GO, IFFY, NO, UNKNOWN } from './engine.js';
import { makeFmt, relDay, ruleText, obsText, blockerText, alertText, RULE_TYPES, WHEN } from './text.js';
import { unitFor } from './units.js';
import { fetchForecast, searchPlaces, locate, nameFor, placeKey, placeLabel } from './weather.js';
import * as store from './store.js';
import { zonedToUtc, downloadIcs, googleLink } from './cal.js';

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
function s(tag, attrs, ...kids) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const kid of kids.flat(Infinity)) if (kid != null) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const lower = t => (t ? t[0].toLowerCase() + t.slice(1) : t);
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
  const { view, args } = parseRoute();
  renderHeader();
  let node;
  if (view === 'settings') node = settingsView();
  else if (view === 'place') node = placeView();
  else if (!state.place) node = welcomeView();
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
  const key = `${view}/${args[0] || ''}`;
  if (key !== lastView) {
    window.scrollTo(0, 0);
    lastView = key;
  }
}

// Background updates (a fresh forecast, the clock ticking over) shouldn't wipe
// out a form someone is typing in.
function softRender() {
  const { view } = parseRoute();
  if (['edit', 'new', 'place'].includes(view) || (view !== 'settings' && !state.place)) renderHeader();
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

function miniGrid(res) {
  const first = firstIndexByDate();
  const dates = [...first.keys()].filter(d => d >= today()).slice(0, 7);
  const cw = 10, ch = 10, lw = 26;
  const svg = s('svg', { class: 'mini', viewBox: `0 0 ${lw + 24 * cw} ${dates.length * ch}`, 'aria-hidden': 'true', preserveAspectRatio: 'xMinYMin meet' });
  dates.forEach((d, row) => {
    svg.append(s('text', { x: 0, y: row * ch + ch - 2.5, class: 'lbl' }, fmt.wd(d).slice(0, 2)));
    for (let i = first.get(d); i < ctx.n && ctx.date[i] === d; i++) {
      svg.append(s('rect', { x: lw + ctx.hour[i] * cw, y: row * ch, width: cw - 1.5, height: ch - 1.5, rx: 1.5, class: cellClass(res, i) }));
    }
  });
  // A faint line at noon helps the eye.
  svg.append(s('line', { x1: lw + 12 * cw - 0.75, x2: lw + 12 * cw - 0.75, y1: 0, y2: dates.length * ch, class: 'noon' }));
  return svg;
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
  const al = alerts(ctx);
  return h('div', { class: 'home' },
    h('div', { class: 'topline' }, nowLine(), statusLine()),
    al.length > 0 && h('section', { class: 'alerts', 'aria-label': 'Heads up' },
      al.map(a => {
        const t = alertText(a, ctx, fmt, today());
        return h('div', { class: `alert ${a.kind}` }, h('span', { class: 'a-ico', 'aria-hidden': 'true' }, t.icon), h('div', {}, h('b', {}, t.title), h('span', {}, ' ', t.body)));
      })),
    h('nav', { class: 'tabs', 'aria-label': 'Views' },
      h('a', { href: '#/', 'aria-current': tab === 'jobs' ? 'page' : null }, 'By job'),
      h('a', { href: '#/week', 'aria-current': tab === 'week' ? 'page' : null }, 'This week'),
    ),
    tab === 'jobs' ? jobsTab(list) : weekTab(list),
  );
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
      ),
      h('div', { class: 'd-actions' },
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
    grid,
    inspector,
  );
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
  const grid = h('div', { class: 'grid', role: 'group', 'aria-label': 'Start times by day and hour. Use the arrow keys to move.' });
  grid.append(h('div', { class: 'g-row g-hours', 'aria-hidden': 'true' },
    h('span', { class: 'g-day' }),
    Array.from({ length: 24 }, (_, hr) => h('span', { class: 'g-h' }, hr % 6 === 0 ? fmt.shortHour(hr) : '')),
  ));
  dates.forEach((d, row) => {
    if (row === 7) grid.append(h('p', { class: 'g-far' }, 'Further out, the forecast is only a rough guide'));
    const cells = new Array(24).fill(null);
    for (let i = first.get(d); i < ctx.n && ctx.date[i] === d; i++) cells[ctx.hour[i]] = i;
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
        if (!confirm('Clear your place, list, schedule and edited rules?')) return;
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
