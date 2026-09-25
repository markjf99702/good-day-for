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
import { makeForecast } from './fixture.js';

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
const places = JSON.stringify({ results: [
  { name: 'Columbus', admin1: 'Ohio', country: 'United States', country_code: 'US', latitude: 39.96, longitude: -83.0 },
  { name: 'Columbus', admin1: 'Georgia', country: 'United States', country_code: 'US', latitude: 32.46, longitude: -84.99 },
] });

const browser = await pw.chromium.launch();
const problems = [];

async function newPage(opts = {}) {
  const context = await browser.newContext({ locale: 'en-US', timezoneId: 'America/New_York', viewport: { width: 1180, height: 900 }, ...opts });
  await context.route('https://api.open-meteo.com/**', r => r.fulfill({ contentType: 'application/json', body: forecast, headers: { 'access-control-allow-origin': '*' } }));
  await context.route('https://geocoding-api.open-meteo.com/**', r => r.fulfill({ contentType: 'application/json', body: places, headers: { 'access-control-allow-origin': '*' } }));
  const page = await context.newPage();
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  return { context, page };
}
const snap = async (page, name, full = true) => { if (shots) await page.screenshot({ path: join(shots, `${name}.png`), fullPage: full }); };

try {
  // ——— First visit: pick a place ———
  const { context, page } = await newPage();
  await page.goto(base);
  await page.getByRole('heading', { name: 'Is it a good day for it?' }).waitFor();
  await snap(page, '01-welcome');
  await page.getByRole('searchbox', { name: 'City or ZIP code' }).fill('Columbus');
  await page.getByRole('button', { name: /Columbus Ohio/ }).click();
  await page.locator('.cards .card').first().waitFor();
  assert.equal(await page.locator('#placeBtn span').textContent(), 'Columbus, Ohio');

  // ——— Jobs ———
  const cards = page.locator('.cards .card:not(.add)');
  assert.equal(await cards.count(), 9, 'nine starter jobs');
  const firstNext = await cards.first().locator('.next').textContent();
  assert.match(firstNext, /start/i, `first card headline: ${firstNext}`);
  assert.ok(await page.locator('.alert.frost').count(), 'frost heads-up shows');
  assert.ok(await page.locator('.mini rect.go').count() > 50, 'mini grids have green');
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

  // ——— Settings: metric and a schedule ———
  await page.goto(base + '#/settings');
  await page.getByRole('radio', { name: /Metric/ }).check();
  await page.getByRole('radio', { name: /Evenings & weekends/ }).check();
  await snap(page, '08-settings');
  await page.goto(base + '#/');
  assert.match(await page.locator('.now').textContent(), /°C/);
  assert.ok(await page.locator('.mini rect.busy').count() > 0, 'busy hours show up');
  await page.goto(base + '#/job/ext-paint');
  assert.match(await page.locator('.checks').textContent(), /10°C/);
  await context.close();

  // ——— Phone, light and dark ———
  for (const scheme of ['light', 'dark']) {
    const { context: c2, page: p2 } = await newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true });
    await p2.goto(base);
    await p2.evaluate(() => localStorage.setItem('gooddayfor:v1', JSON.stringify({ place: { name: 'Columbus', admin: 'Ohio', country: 'United States', lat: 39.96, lon: -83 }, units: 'us' })));
    await p2.reload();
    await p2.locator('.cards .card').first().waitFor();
    const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `no sideways scroll on a phone (${overflow}px)`);
    await snap(p2, `10-phone-${scheme}`);
    await p2.goto(base + '#/job/laundry');
    await p2.locator('.inspect').waitFor();
    const overflow2 = await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow2 <= 0, `detail fits a phone (${overflow2}px)`);
    await snap(p2, `11-phone-detail-${scheme}`, false);
    await p2.goto(base + '#/week');
    await p2.locator('.day').first().waitFor();
    await snap(p2, `12-phone-week-${scheme}`, false);
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
