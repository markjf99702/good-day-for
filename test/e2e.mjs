// Drives the real page in Chromium against the made-up forecast in fixture.js.
//   node test/e2e.mjs [screenshot-dir]
// Needs Playwright (npm i -g playwright, or a local install) and a Chromium it can find.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { makeForecast, makeArchive, NO_FROST } from './fixture.js';
import { historyRange, frostEntry, summarize, monthDayOf } from '../js/frost.js';
import { calendar } from '../js/planting.js';
import { normalize, placeKey } from '../js/weather.js';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    const body = await readFile(join(root, path.endsWith('/') ? path + 'index.html' : path));
    res.writeHead(200, { 'content-type': TYPES[extname(path) || '.html'] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;

const forecast = JSON.stringify(makeForecast({ tz: 'America/New_York' }));
// A wet start: rain all day today and tomorrow, a 40% chance the day after, then the usual.
const allDay = (inches, pop) => Object.fromEntries(Array.from({ length: 24 }, (_, hr) => [hr, [inches, pop]]));
const wet = JSON.stringify(makeForecast({ tz: 'America/New_York', scenario: {
  0: { hi: 60, lo: 52, dew: 50, wind: 8, cloud: 100, rain: allDay(0.05, 90) },
  1: { hi: 61, lo: 52, dew: 50, wind: 8, cloud: 100, rain: allDay(0.05, 90) },
  2: { hi: 64, lo: 50, dew: 48, wind: 6, cloud: 70, pop: 40 },
} }));
const places = JSON.stringify({ results: [
  { name: 'Columbus', admin1: 'Ohio', country: 'United States', country_code: 'US', latitude: 39.96, longitude: -83.0 },
  { name: 'Columbus', admin1: 'Georgia', country: 'United States', country_code: 'US', latitude: 32.46, longitude: -84.99 },
] });

const browser = await pw.chromium.launch();
const problems = [];
const cors = { 'access-control-allow-origin': '*' };

// Weather history: a made-up archive for whatever years the page asks for.
// `archive` tweaks the fixture; `fail` answers like Open-Meteo does when it's had enough.
// `down` lists the services that can't be reached ('forecast', 'search', 'history'), and
// `weather` gives the forecast to answer with.
let historyAsks = 0;
async function newPage(opts = {}, { archive = {}, fail = false, down = [], weather = () => forecast } = {}) {
  const context = await browser.newContext({ locale: 'en-US', timezoneId: 'America/New_York', viewport: { width: 1180, height: 900 }, ...opts });
  const route = (url, name, answer) => context.route(url, r => (down.includes(name) ? r.abort('internetdisconnected') : answer(r)));
  await route('https://api.open-meteo.com/**', 'forecast', r => r.fulfill({ contentType: 'application/json', body: weather(), headers: cors }));
  await route('https://geocoding-api.open-meteo.com/**', 'search', r => r.fulfill({ contentType: 'application/json', body: places, headers: cors }));
  await route('https://archive-api.open-meteo.com/**', 'history', r => {
    historyAsks++;
    if (fail) return r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: true, reason: 'Daily API request limit exceeded. Please try again tomorrow.' }), headers: cors });
    const q = new URL(r.request().url()).searchParams;
    const lat = +q.get('latitude');
    const body = makeArchive({ start: q.get('start_date'), end: q.get('end_date'), lat, lon: +q.get('longitude'), tz: lat < 0 ? 'Australia/Sydney' : 'America/New_York', ...archive });
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(body), headers: cors });
  });
  const page = await context.newPage();
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  // The refusal test's 429 and the services a test takes away are on purpose; the browser logs them anyway.
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if ((fail && / 429 /.test(m.text())) || (down.length && /ERR_INTERNET_DISCONNECTED/.test(m.text()))) return;
    problems.push(`console: ${m.text()}`);
  });
  return { context, page };
}
// Hour labels that are showing, per grid: how many, and how many run into the next one.
const labels = (page, sel) => page.evaluate(sel => {
  const rows = new Map();
  for (const lab of document.querySelectorAll(sel)) {
    if (getComputedStyle(lab).visibility === 'hidden') continue;
    const text = [...lab.children].find(c => getComputedStyle(c).display !== 'none');
    const r = text.getBoundingClientRect();
    if (!r.width) continue;
    if (!rows.has(lab.parentElement)) rows.set(lab.parentElement, []);
    rows.get(lab.parentElement).push({ left: r.left, right: r.right, text: text.textContent });
  }
  let shown = 0, overlaps = 0, min = Infinity;
  for (const list of rows.values()) {
    list.sort((a, b) => a.left - b.left);
    shown += list.length;
    min = Math.min(min, list.length);
    for (let i = 1; i < list.length; i++) if (list[i].left < list[i - 1].right + 1) overlaps++;
  }
  return { grids: rows.size, shown, overlaps, min, sample: [...rows.values()][0]?.map(x => x.text) };
}, sel);

const snap = async (page, name, full = true) => { if (shots) await page.screenshot({ path: join(shots, `${name}.png`), fullPage: full }); };
const sideways = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const setPlace = async (page, place, units = 'us') => {
  await page.evaluate(([p, u]) => localStorage.setItem('gooddayfor:v1', JSON.stringify({ place: p, units: u })), [place, units]);
  await page.reload();
};
const COLUMBUS = { name: 'Columbus', admin: 'Ohio', country: 'United States', lat: 39.96, lon: -83 };
const CANBERRA = { name: 'Canberra', admin: 'Australian Capital Territory', country: 'Australia', lat: -35.28, lon: 149.13 };
// The forecast the page keeps in storage, as if it had been fetched `days` ago.
const savedForecast = days => {
  const at = Date.now() - days * 864e5;
  return { ...normalize(makeForecast({ tz: 'America/New_York', now: at })), fetchedAt: at, key: placeKey(COLUMBUS) };
};
const withSaved = (page, fc, settings = {}) => page.evaluate(([s, f]) => {
  localStorage.setItem('gooddayfor:v1', JSON.stringify(s));
  localStorage.setItem('gooddayfor:forecast', JSON.stringify(f));
}, [{ place: COLUMBUS, units: 'us', ...settings }, fc]);

// What the frost page should say, worked out here from the same fixture.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
function expectedFrost(lat, archive = {}) {
  const range = historyRange(today, lat);
  const raw = makeArchive({ start: range.start, end: range.end, lat, ...archive });
  const sum = summarize(frostEntry(raw, 'x', range));
  const md = i => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`2000-${monthDayOf(i, sum.south)}T00:00Z`));
  return { range, sum, last: md(sum.frost.last.median), p90: md(sum.frost.last.p90), first: md(sum.frost.first.median) };
}

try {
  // ——— First visit: pick a place ———
  const { context, page } = await newPage();
  await page.goto(base);
  await page.getByRole('heading', { name: 'Is it a good day for it?' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Pick a place', exact: true }).count(), 1);
  await snap(page, '01-welcome');
  await page.getByRole('searchbox', { name: 'City or ZIP code' }).fill('Columbus');
  await page.getByRole('button', { name: /Columbus Ohio/ }).click();
  await page.locator('.cards .card').first().waitFor();
  assert.equal(await page.locator('#placeBtn span').textContent(), 'Columbus, Ohio');
  // Its name starts with the place it shows (for screen readers and voice control).
  assert.equal(await page.getByRole('button', { name: 'Columbus, Ohio, change place', exact: true }).count(), 1);

  // ——— Jobs ———
  const cards = page.locator('.cards .card:not(.add)');
  assert.equal(await cards.count(), 9, 'nine starter jobs');
  const firstNext = await cards.first().locator('.next').textContent();
  assert.match(firstNext, /start/i, `first card headline: ${firstNext}`);
  assert.ok(await page.locator('.alert.frost').count(), 'frost heads-up shows');
  assert.ok(await page.locator('.mini i.go').count() > 50, 'mini grids have green');
  const miniLabels = await labels(page, '.mini .m-h');
  assert.equal(miniLabels.grids, 9, 'every card has an hour row');
  assert.ok(miniLabels.min >= 4, `each card labels at least 4 hours: ${JSON.stringify(miniLabels)}`);
  assert.equal(miniLabels.overlaps, 0, `card hour labels don't collide: ${JSON.stringify(miniLabels)}`);
  await snap(page, '02-jobs');

  // ——— This week ———
  await page.getByRole('link', { name: 'This week' }).click();
  await page.locator('.day').first().waitFor();
  assert.equal(await page.locator('.day').count(), 7);
  assert.ok(await page.locator('.d-jobs li').count() > 5);
  await snap(page, '03-week');

  // ——— A job, hour by hour ———
  await page.goto(base + '#/job/deck-stain');
  await page.getByRole('heading', { name: 'Stain or seal the deck or fence' }).waitFor();
  assert.ok(await page.locator('.win').count() >= 1, 'deck stain has a window');
  // A daylight job leaves out the night and labels every remaining hour.
  const bigLabels = await labels(page, '.g-hours .g-h');
  assert.equal(bigLabels.overlaps, 0, JSON.stringify(bigLabels));
  assert.equal(bigLabels.shown, await page.locator('.g-hours .g-h').count(), `every hour labelled: ${JSON.stringify(bigLabels)}`);
  assert.match(bigLabels.sample.join(' '), /AM .* PM/);
  assert.ok(await page.locator('.g-hours .g-h').count() < 24, 'night hours left out');
  await page.locator('.trimmed').waitFor();
  await snap(page, '04-detail');
  // A rainy hour on day 2 explains itself.
  const rainy = page.locator('.cell.no').nth(40);
  await rainy.click();
  await page.locator('.verdict.no').waitFor();
  assert.ok(await page.locator('.checks li.bad').count() >= 1);
  await snap(page, '05-detail-no', false);
  // Pick a green hour and add it to the calendar.
  await page.locator('.cell.go').first().click();
  await page.locator('.verdict.go').waitFor();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Add to calendar' }).click()]);
  const ics = await readFile(await dl.path(), 'utf8');
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /SUMMARY:🪵 Stain or seal the deck or fence/);
  assert.match(ics, /DTSTART:\d{8}T\d{6}Z/);
  // Its reminder goes off at 7 PM the evening before, Columbus time, or an hour ahead once that's gone by.
  const [, st] = ics.match(/DTSTART:(\d{8}T\d{4})/);
  const startMs = Date.UTC(+st.slice(0, 4), +st.slice(4, 6) - 1, +st.slice(6, 8), +st.slice(9, 11), +st.slice(11, 13));
  const [, hrs = 0, mins = 0] = ics.match(/TRIGGER:-PT(?:(\d+)H)?(?:(\d+)M)?\r\n/);
  const remindAt = startMs - (hrs * 60 + +mins) * 6e4;
  const ohio = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  const eveBefore = `${new Date(Date.parse(`${ohio(startMs).slice(0, 10)}T00:00Z`) - 864e5).toISOString().slice(0, 10)}, 19:00`;
  assert.ok(ohio(remindAt) === eveBefore || remindAt === startMs - 36e5, `reminder at ${ohio(remindAt)} for a start at ${ohio(startMs)}`);
  // Arrow keys move the selection.
  const before = await page.locator('.inspect h3').textContent();
  await page.locator('.cell.sel').focus();
  await page.keyboard.press('ArrowRight');
  assert.notEqual(await page.locator('.inspect h3').textContent(), before);

  // ——— Edit a rule ———
  await page.goto(base + '#/edit/ext-paint');
  await page.getByRole('heading', { name: /Edit: Paint/ }).waitFor();
  await snap(page, '06-editor');
  const tempRow = page.locator('.rule-row').nth(4);
  assert.match(await tempRow.locator('.preview').textContent(), /At least 50°F while you work and for 24 hours after/);
  await tempRow.locator('input[type=number]').first().fill('35');
  assert.match(await tempRow.locator('.preview').textContent(), /At least 35°F/);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Your edited rules').waitFor();
  await page.getByRole('link', { name: 'Edit rules' }).click();
  await page.getByRole('button', { name: 'Back to the original rules' }).click();
  await page.getByRole('heading', { name: 'Paint the outside of the house' }).waitFor();
  assert.equal(await page.getByText('Your edited rules').count(), 0);

  // ——— Make your own job ———
  await page.goto(base + '#/new');
  await page.getByPlaceholder('Stain the fence').fill('Walk the dog');
  await page.getByRole('combobox', { name: 'Add a rule' }).selectOption('tempMax');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('heading', { name: 'Walk the dog' }).waitFor();
  await page.goto(base + '#/');
  assert.equal(await page.locator('.cards .card:not(.add)').count(), 10);

  // ——— Catalog ———
  await page.goto(base + '#/jobs');
  await page.getByRole('heading', { name: 'What’s on your list?' }).waitFor();
  await page.getByRole('checkbox', { name: /Seal the driveway/ }).check();
  await snap(page, '07-catalog');
  await page.goto(base + '#/');
  assert.equal(await page.locator('.cards .card:not(.add)').count(), 11);

  // ——— How much to buy: from a job's page ———
  await page.goto(base + '#/job/deck-stain');
  await page.getByRole('link', { name: 'How much to buy' }).click();
  await page.getByRole('heading', { name: 'Deck & fence stain' }).waitFor();
  assert.match(page.url(), /#\/buy\/stain$/);
  assert.match(await page.locator('.calc-out').textContent(), /Put in the size of the deck or fence/);
  await page.getByLabel('Deck length').fill('12');
  await page.getByLabel('Deck width').fill('16');
  await page.getByLabel('Railing, total length').fill('40');
  // 192 + 240 sq ft, one coat at 250 sq ft a gallon, +10%: 1.9 gallons.
  await page.locator('.buy-list').getByText('2 gallons').waitFor();
  assert.match(await page.locator('.calc-out .total').textContent(), /\$90\b/);
  assert.match(await page.locator('.steps').textContent(), /40 ft × 6 sq ft per ft = 240 sq ft/);
  // Thirstier wood: coverage drops to 175, and three gallons beat two and three quarts.
  await page.getByLabel('The wood').selectOption('weathered');
  assert.equal(await page.getByLabel('Stain covers').inputValue(), '175');
  await page.locator('.buy-list').getByText('3 gallons').waitFor();
  // Your own label figure wins, and can go back to the typical one.
  await page.getByLabel('Stain covers').fill('100');
  await page.locator('.buy-list').getByText('five-gallon pail').waitFor();
  await page.getByLabel('The wood').selectOption('new');
  assert.equal(await page.getByLabel('Stain covers').inputValue(), '250');
  // A coverage of 0 asks for a real one instead of buying nothing, and there's always at least one coat.
  await page.getByLabel('Stain covers').fill('0');
  await page.locator('.calc-out').getByText('Put in how much the stain covers to see how much to buy.').waitFor();
  assert.equal(await page.getByLabel('Coats').getAttribute('min'), '1');
  await page.getByLabel('Stain covers').fill('250');
  // A size the store doesn't sell is left out.
  await page.getByLabel('Gallon: price').fill('');
  await page.locator('.buy-list').getByText('8 quarts').waitFor();
  await page.getByLabel('Gallon: price').fill('45');
  await snap(page, '14-calc-stain', false);
  // Save it by name, and it's listed on the How much to buy page.
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Saved as “Deck: 12×16 plus 40 ft of railing”').waitFor();
  await page.goto(base + '#/buy');
  await page.getByRole('heading', { name: 'How much to buy' }).waitFor();
  assert.equal(await page.locator('nav.tabs a[aria-current="page"]').textContent(), 'How much');
  const savedRow = page.locator('.saved-list li').first();
  assert.match(await savedRow.textContent(), /Deck: 12×16 plus 40 ft of railing.*2 gallons.*\$90/);
  assert.equal(await page.locator('.calcs .card').count(), 7);
  await snap(page, '15-buy');
  // Measurements survive a reload.
  await page.reload();
  await page.goto(base + '#/buy/stain');
  assert.equal(await page.getByLabel('Deck length').inputValue(), '12');
  // Warm-season seed opens the seed calculator on a warm-season grass.
  await page.goto(base + '#/job/seed-warm');
  await page.getByRole('link', { name: 'How much to buy' }).click();
  await page.getByRole('heading', { name: 'Grass seed' }).waitFor();
  assert.equal(await page.getByLabel('Grass').inputValue(), 'bermuda');
  // Mulch: area × depth to bags, and a loose load as the other option.
  await page.goto(base + '#/buy/fill/mulch');
  await page.getByLabel('Bed length').fill('20');
  await page.getByLabel('Bed width').fill('5');
  await page.locator('.buy-list').getByText('13 × 2 cu ft bags').waitFor();
  assert.match(await page.locator('.bulk').textContent(), /1 cu yd, about \$38/);
  // Variants are tabs; compost keeps the bed but has its own depth.
  await page.getByRole('link', { name: 'Compost', exact: true }).click();
  await page.locator('nav.seg a[aria-current="page"]', { hasText: 'Compost' }).waitFor();
  assert.equal(await page.getByLabel('Depth').inputValue(), '2');
  assert.equal(await page.getByLabel('Bed length').inputValue(), '20');
  // Concrete for eight fence posts.
  await page.goto(base + '#/buy/concrete/posts');
  await page.getByLabel('Holes').fill('8');
  await page.locator('.calc-out .total').getByText('$129.25').waitFor();
  assert.match(await page.locator('.tips').textContent(), /1,640 lb of bags/);

  // ——— Frost dates and the planting calendar ———
  const north = expectedFrost(39.96);
  historyAsks = 0;
  await page.goto(base + '#/frost');
  await page.locator('.fstats').waitFor();
  assert.equal(historyAsks, 1, 'the history is fetched when the page opens');
  const cardsText = await page.locator('.fs').allTextContents();
  assert.match(cardsText[0], new RegExp(`Last spring frost${north.last}`));
  assert.match(cardsText[0], new RegExp(`1 year in 10 it’s later than ${north.p90}\\.`));
  assert.match(cardsText[1], new RegExp(`First fall frost${north.first}`));
  assert.match(cardsText[2], new RegExp(`${north.sum.frost.days.median} days`));
  assert.match(await page.locator('.b-intro').textContent(), new RegExp(`30 years .*${north.range.first}–${north.range.last}`));
  assert.match(await page.locator('.hard').textContent(), /Hard freeze \(28°F/);
  assert.equal(await page.locator('button.tl-row').count(), calendar({ L: north.sum.frost.last.median, F: north.sum.frost.first.median }).length);
  assert.equal(await page.locator('.tl-now').textContent(), 'This week');
  assert.match(await page.locator('.plan h3').first().textContent(), /What to do this week/);
  assert.ok(await page.locator('.plan-list li').count() >= 1, 'something to do in the week or coming up');
  const tomatoes = page.locator('button.tl-row', { hasText: 'Tomatoes' });
  await tomatoes.click();
  assert.equal(await tomatoes.getAttribute('aria-expanded'), 'true');
  assert.match(await page.locator('#tl-tomatoes').textContent(), /Start seeds indoors.*Plant out/);
  assert.match(await page.locator('.method').textContent(), /not a thermometer in your yard.*low spots and valleys.*not the ground/s);
  await snap(page, '16-frost');
  // Kept per place: no second download, even after a reload.
  await page.reload();
  await page.locator('.fstats').waitFor();
  assert.equal(historyAsks, 1, 'cached, not fetched again');
  const cached = await page.evaluate(() => JSON.parse(localStorage.getItem('gooddayfor:frost')));
  assert.equal(cached.length, 1);
  assert.equal(cached[0].key, '39.960,-83.000');
  assert.ok(JSON.stringify(cached).length < 10000, 'the sums, not the raw history');
  // The soil jobs know their season.
  await page.goto(base + '#/job/seed');
  assert.match(await page.locator('.season').textContent(), /In season here/);

  // ——— Settings: metric and a schedule ———
  await page.goto(base + '#/settings');
  await page.getByRole('radio', { name: /Metric/ }).check();
  await page.getByRole('radio', { name: /Evenings & weekends/ }).check();
  await snap(page, '08-settings');
  await page.goto(base + '#/');
  assert.match(await page.locator('.now').textContent(), /°C/);
  assert.ok(await page.locator('.mini i.busy').count() > 0, 'busy hours show up');
  await page.goto(base + '#/job/ext-paint');
  assert.match(await page.locator('.checks').textContent(), /10°C/);
  // Metric: the saved deck comes back in metres, and tins are in litres.
  await page.goto(base + '#/buy/stain');
  assert.equal(await page.getByLabel('Deck length').inputValue(), '3.66');
  assert.match(await page.locator('.buy-list').textContent(), / L can/);
  await page.goto(base + '#/frost');
  await page.locator('.fstats').waitFor();
  assert.match(await page.locator('.fs').first().textContent(), /Last spring frost/);
  assert.match(await page.locator('.method').textContent(), /down to 0°C/);
  // A double tap on Make a copy makes one copy, not two.
  await page.goto(base + '#/job/mow');
  await page.getByRole('button', { name: 'Make a copy' }).dblclick();
  await page.getByRole('heading', { name: 'Edit: Mow the lawn (my version)' }).waitFor();
  const copies = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('gooddayfor:v1')).custom).filter(j => j.name === 'Mow the lawn (my version)').length);
  assert.equal(copies, 1, 'one copy');
  await context.close();

  // ——— Frost: the southern hemisphere, no frost at all, and a refusal ———
  const south = expectedFrost(-35.28);
  const { context: cs, page: ps } = await newPage();
  await ps.goto(base);
  await setPlace(ps, CANBERRA, 'metric');
  await ps.goto(base + '#/frost');
  await ps.locator('.fstats').waitFor();
  assert.match(south.last, /^(Sep|Oct) /);
  assert.match(await ps.locator('.fs').first().textContent(), new RegExp(`Last spring frost${south.last}`));
  assert.match(await ps.locator('.fs').nth(1).textContent(), /First fall frost(Apr|May) /);
  assert.match(await ps.locator('.b-intro').textContent(), new RegExp(`${south.range.first}–${String(south.range.first + 1).slice(2)} to`));
  assert.ok(await ps.locator('.tl-frost').count() >= 2, 'the frost season wraps across the axis');
  await cs.close();

  const { context: cn, page: pn } = await newPage({}, { archive: { dates: NO_FROST, mean: 14, amp: 5 } });
  await pn.goto(base);
  await setPlace(pn, { name: 'Sydney', admin: 'New South Wales', country: 'Australia', lat: -33.87, lon: 151.21 }, 'metric');
  await pn.goto(base + '#/frost');
  await pn.getByText('None in 30 years').waitFor();
  assert.match(await pn.locator('.plan').textContent(), /cooler months, about/);
  assert.equal(await pn.locator('button.tl-row').count(), 0);
  await cn.close();

  const { context: cf, page: pf } = await newPage({}, { fail: true });
  await pf.goto(base);
  await setPlace(pf, COLUMBUS);
  await pf.goto(base + '#/frost');
  await pf.getByRole('alert').filter({ hasText: 'Daily API request limit exceeded' }).waitFor();
  await pf.getByRole('button', { name: 'Try again' }).waitFor();
  await cf.close();

  // ——— An old saved forecast ———
  // A month old with the weather service out of reach: none of it is ahead of now, so it says so,
  // even opened straight at a job (a bookmark, or the link in a calendar event).
  const { context: co, page: po } = await newPage({}, { down: ['forecast'] });
  await po.goto(base);
  await withSaved(po, savedForecast(30));
  await po.goto(base + '#/job/mow');
  await po.reload();
  await po.getByRole('alert').filter({ hasText: /^The last forecast is too old to use\. / }).waitFor();
  await po.getByRole('button', { name: 'Try again' }).waitFor();
  await po.goto(base + '#/week');
  assert.equal(await po.locator('.day').count(), 0, 'no days drawn from a month-old forecast');
  // Planting still goes by today's date, not the forecast's first day.
  await po.goto(base + '#/frost');
  const thisWeek = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${today}T00:00Z`));
  assert.match(await po.locator('.plan h3').first().textContent(), new RegExp(`this week · ${thisWeek} –`));
  assert.match(await po.locator('.status').textContent(), /Updated 30 days ago/);
  // Two weeks old: a day or so left, and it counts it in words that fit.
  await withSaved(po, savedForecast(14));
  await po.goto(base + '#/');
  await po.reload();
  await po.locator('.cards .card').first().waitFor();
  assert.match(await po.locator('.status').textContent(), /Updated 14 days ago/);
  const oldHeads = (await po.locator('.cards .next').allTextContents()).join(' | ');
  assert.ok(!/\b[01] days\b/.test(oldHeads), `days left, in words: ${oldHeads}`);
  await co.close();

  // ——— A wet start to the week ———
  const { context: cw, page: pwet } = await newPage({}, { weather: () => wet });
  await pwet.goto(base);
  await pwet.evaluate(p => localStorage.setItem('gooddayfor:v1', JSON.stringify({ place: p, units: 'us', picks: ['mow', 'laundry', 'car'] })), COLUMBUS);
  await pwet.goto(base + '#/week');
  await pwet.reload();
  const wetDays = pwet.locator('.day');
  await wetDays.first().waitFor();
  // Nothing works today or tomorrow, and each day says which day it means.
  assert.equal(await wetDays.nth(0).locator('.d-none').textContent(), 'Nothing on your list works today.');
  assert.match(await wetDays.nth(0).locator('.d-no').textContent(), /^Not today: /);
  assert.equal(await wetDays.nth(1).locator('.d-none').textContent(), 'Nothing on your list works that day.');
  assert.match(await wetDays.nth(1).locator('.d-no').textContent(), /^Not that day: 🌱 Mow/);
  for (let k = 1; k < 7; k++) assert.ok(!/today/i.test(await wetDays.nth(k).textContent()), `day ${k} doesn't say today`);
  // Mowing is iffy the day after tomorrow and fine the day after that; the weekday keeps its capital.
  await pwet.goto(base + '#/');
  const sooner = await pwet.locator('.card', { hasText: 'Mow the lawn' }).getByText(/^Iffy sooner:/).textContent();
  assert.match(sooner, /^Iffy sooner: (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), start /);
  await cw.close();

  // ——— When the services can't be reached ———
  const { context: cd, page: pd } = await newPage({}, { down: ['forecast', 'search'] });
  await pd.goto(base);
  // Place search says which service didn't answer, not the browser's "Failed to fetch".
  await pd.getByRole('searchbox', { name: 'City or ZIP code' }).fill('Columbus');
  await pd.locator('.picker').getByText('Couldn’t reach place search.').waitFor();
  // No forecast yet: the same plain words, with Try again.
  await setPlace(pd, COLUMBUS);
  await pd.getByRole('alert').filter({ hasText: /^Couldn’t reach the weather service\.$/ }).waitFor();
  await pd.getByRole('button', { name: 'Try again' }).waitFor();
  // A forecast from a few days ago still shows, and the line about it reads as sentences.
  await withSaved(pd, savedForecast(3));
  await pd.reload();
  await pd.locator('.cards .card').first().waitFor();
  await pd.locator('.status .err').filter({ hasText: /^Couldn’t reach the weather service\. Showing the last forecast\.$/ }).waitFor();
  // Properly offline, search says that instead.
  await cd.setOffline(true);
  await pd.evaluate(() => { location.hash = '#/place'; });
  await pd.getByRole('searchbox', { name: 'City or ZIP code' }).fill('Dayton');
  await pd.locator('.picker').getByText('You’re offline.').waitFor();
  await cd.close();

  // ——— Saves that aren't the shape the page writes ———
  // Hand-edited or damaged: each bad field falls back on its own, and the page and Settings still open.
  const { context: cj, page: pj } = await newPage();
  await pj.goto(base);
  const junk = [
    { schedule: null }, { schedule: { preset: 'custom' } }, { picks: null }, { saved: null, recent: null, calc: null, custom: null },
    { edits: { mow: { name: 'No rules' } } }, { place: { name: 'Nowhere', lat: 'x', lon: null } },
  ];
  for (const bad of junk) {
    await pj.evaluate(s => { localStorage.clear(); localStorage.setItem('gooddayfor:v1', JSON.stringify(s)); }, { place: COLUMBUS, units: 'us', ...bad });
    await pj.goto(base + '#/');
    await pj.reload();
    await pj.locator('.cards .card, .welcome').first().waitFor();
    await pj.goto(base + '#/settings');
    await pj.getByRole('button', { name: 'Clear everything' }).waitFor();
  }
  // A kept forecast with no days in it is fetched again instead.
  await withSaved(pj, { ...savedForecast(0), days: undefined });
  await pj.goto(base + '#/');
  await pj.reload();
  await pj.locator('.cards .card').first().waitFor();
  await cj.close();

  // Online, a forecast that old is simply replaced, even when the page opens at a job.
  let asked = 0;
  const { context: cr, page: pr } = await newPage({}, { weather: () => { asked++; return forecast; } });
  await pr.goto(base);
  await withSaved(pr, savedForecast(20));
  await pr.goto(base + '#/job/mow');
  await pr.reload();
  await pr.locator('.inspect').waitFor();
  assert.ok(asked >= 1, 'it fetched a new forecast');
  await cr.close();

  // ——— Phone, light and dark ———
  for (const scheme of ['light', 'dark']) {
    const { context: c2, page: p2 } = await newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true });
    await p2.goto(base);
    await p2.evaluate(() => localStorage.setItem('gooddayfor:v1', JSON.stringify({ place: { name: 'Columbus', admin: 'Ohio', country: 'United States', lat: 39.96, lon: -83 }, units: 'us' })));
    await p2.reload();
    await p2.locator('.cards .card').first().waitFor();
    const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `no sideways scroll on a phone (${overflow}px)`);
    const phoneMini = await labels(p2, '.mini .m-h');
    assert.equal(phoneMini.overlaps, 0, `phone card labels: ${JSON.stringify(phoneMini)}`);
    assert.ok(phoneMini.min >= 3, `phone card labels: ${JSON.stringify(phoneMini)}`);
    await snap(p2, `10-phone-${scheme}`);
    await p2.goto(base + '#/job/laundry');
    await p2.locator('.inspect').waitFor();
    const overflow2 = await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow2 <= 0, `detail fits a phone (${overflow2}px)`);
    const phoneBig = await labels(p2, '.g-hours .g-h');
    assert.equal(phoneBig.overlaps, 0, `phone grid labels: ${JSON.stringify(phoneBig)}`);
    assert.equal(phoneBig.shown, await p2.locator('.g-hours .g-h').count(), `every hour labelled on a phone: ${JSON.stringify(phoneBig)}`);
    // An any-time job keeps all 24 hours, still readable.
    await p2.goto(base + '#/job/water');
    await p2.locator('.inspect').waitFor();
    assert.equal(await p2.locator('.g-hours .g-h').count(), 24);
    const phone24 = await labels(p2, '.g-hours .g-h');
    assert.equal(phone24.overlaps, 0, `24-hour phone labels: ${JSON.stringify(phone24)}`);
    await p2.goto(base + '#/job/laundry');
    await p2.locator('.inspect').waitFor();
    await snap(p2, `11-phone-detail-${scheme}`, false);
    // Scrolled down, the hour row stays in view under the top bar.
    await p2.locator('.g-row.far').last().scrollIntoViewIfNeeded();
    const stuck = await p2.locator('.g-hours').boundingBox();
    assert.ok(stuck.y >= 40 && stuck.y < 80, `hour row sticks under the bar (y=${stuck.y})`);
    await snap(p2, `13-phone-detail-scrolled-${scheme}`, false);
    await p2.goto(base + '#/week');
    await p2.locator('.day').first().waitFor();
    await snap(p2, `12-phone-week-${scheme}`, false);
    // The two new pages fit a phone too.
    await p2.goto(base + '#/frost');
    await p2.locator('.fstats').waitFor();
    assert.ok(await sideways(p2) <= 0, `frost page fits a phone (${await sideways(p2)}px)`);
    const tabs = await p2.locator('nav.tabs').boundingBox();
    assert.ok(tabs.x + tabs.width <= 390, 'four tabs fit');
    await snap(p2, `17-phone-frost-${scheme}`, false);
    await p2.goto(base + '#/buy/paint/interior');
    await p2.getByLabel('Room length').fill('12');
    await p2.getByLabel('Room width').fill('14');
    await p2.locator('.calc-bar').getByText('2 gallons').waitFor();
    assert.ok(await sideways(p2) <= 0, `calculator fits a phone (${await sideways(p2)}px)`);
    await snap(p2, `18-phone-calc-${scheme}`, false);
    for (const route of ['#/buy', '#/buy/concrete/posts', '#/buy/fill/gravel', '#/buy/seed', '#/buy/feed/preventer', '#/buy/sealer', '#/buy/paint/exterior']) {
      await p2.goto(base + route);
      await p2.locator('.calc-out, .calcs').first().waitFor();
      assert.ok(await sideways(p2) <= 0, `${route} fits a phone (${await sideways(p2)}px)`);
    }
    await c2.close();
  }

  assert.deepEqual(problems, [], 'no errors in the page');
  console.log('e2e: all good');
} catch (e) {
  console.error(e);
  if (problems.length) console.error(problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
