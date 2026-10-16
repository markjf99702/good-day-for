import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchForecast, fetchHistory, searchPlaces, nameFor } from '../js/weather.js';

const place = { name: 'Columbus', lat: 39.96, lon: -83 };

// Stands in for the browser's fetch while fn runs.
async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try { await fn(); } finally { globalThis.fetch = real; }
}

test('a connection that never gets through says which service, not the browser’s words', async () => {
  await withFetch(async () => { throw new TypeError('Failed to fetch'); }, async () => {
    await assert.rejects(fetchForecast(place), { message: 'Couldn’t reach the weather service.' });
    await assert.rejects(fetchHistory(place, { start: '1996-01-01', end: '2025-12-31' }), { message: 'Couldn’t reach the weather history service.' });
    await assert.rejects(searchPlaces('Columbus'), { message: 'Couldn’t reach place search.' });
  });
  // Safari words it differently; it reads the same here.
  await withFetch(async () => { throw new TypeError('Load failed'); }, () => assert.rejects(fetchForecast(place), { message: 'Couldn’t reach the weather service.' }));
});

test('a search that was called off stays quiet, and a refusal keeps its reason', async () => {
  await withFetch(async () => { throw new DOMException('The operation was aborted.', 'AbortError'); }, () => assert.rejects(searchPlaces('Columbus'), { name: 'AbortError' }));
  await withFetch(async () => new Response(JSON.stringify({ error: true, reason: 'Too many requests' }), { status: 429 }),
    () => assert.rejects(fetchForecast(place), { message: 'The weather service said no (429: Too many requests).' }));
});

test('naming the spot after Use my location sends only rough coordinates', async () => {
  const asked = [];
  await withFetch(async url => { asked.push(String(url)); return new Response(JSON.stringify({ city: 'Columbus', principalSubdivision: 'Ohio', countryName: 'United States', countryCode: 'US' })); }, async () => {
    assert.deepEqual(await nameFor(39.961178, -82.998795), { name: 'Columbus', admin: 'Ohio', country: 'United States', cc: 'US' });
  });
  const q = new URL(asked[0]).searchParams;
  assert.deepEqual([q.get('latitude'), q.get('longitude')], ['39.96', '-83.00'], 'about a kilometre: enough to name the town');
});
