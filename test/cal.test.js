import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonedToUtc, icsFor, googleLink } from '../js/cal.js';

test('place-local times turn into the right instants, either side of a DST change', () => {
  assert.equal(new Date(zonedToUtc('2026-09-27T10:00', 'America/New_York')).toISOString(), '2026-09-27T14:00:00.000Z');
  assert.equal(new Date(zonedToUtc('2026-11-02T10:00', 'America/New_York')).toISOString(), '2026-11-02T15:00:00.000Z');
  assert.equal(new Date(zonedToUtc('2026-07-01T09:00', 'Europe/London')).toISOString(), '2026-07-01T08:00:00.000Z');
  assert.equal(new Date(zonedToUtc('2026-07-01T09:00', 'Australia/Sydney')).toISOString(), '2026-06-30T23:00:00.000Z');
});

test('the .ics file is well formed', () => {
  const start = Date.UTC(2026, 8, 27, 14);
  const ics = icsFor({ title: '🪵 Stain the deck, finally\; really', details: 'Line one\nLine two', start, end: start + 4 * 36e5 });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20260927T140000Z\r\n/);
  assert.match(ics, /DTEND:20260927T180000Z\r\n/);
  assert.ok(ics.includes('SUMMARY:🪵 Stain the deck\\, finally\\; really\r\n'));
  assert.match(ics, /DESCRIPTION:Line one\\nLine two/);
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, `folded: ${line}`);
  assert.match(googleLink({ title: 'x', details: 'y', start, end: start + 36e5 }), /dates=20260927T140000Z%2F20260927T150000Z/);
});
