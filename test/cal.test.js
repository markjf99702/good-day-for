import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonedToUtc, reminderFor, icsFor, googleLink } from '../js/cal.js';

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

test('the reminder goes off at 7 PM the evening before, where the job is', () => {
  const ics = (start, remind) => icsFor({ title: 'x', details: 'y', start, end: start + 36e5, remind });
  // Tue 3 PM in Columbus is 19:00Z; Monday 7 PM there is 23:00Z, 20 hours earlier (not 3 AM Tuesday).
  const start = Date.UTC(2026, 9, 13, 19);
  const remind = reminderFor(start, '2026-10-13T15:00', 'America/New_York', Date.UTC(2026, 9, 10));
  assert.equal(new Date(remind).toISOString(), '2026-10-12T23:00:00.000Z');
  assert.match(ics(start, remind), /TRIGGER:-PT20H\r\n/);
  // The clocks go back overnight: 7 PM Saturday (EDT) to 9 AM Sunday (EST) is 15 real hours.
  const sunday = zonedToUtc('2026-11-01T09:00', 'America/New_York');
  assert.match(ics(sunday, reminderFor(sunday, '2026-11-01T09:00', 'America/New_York', Date.UTC(2026, 9, 20))), /TRIGGER:-PT15H\r\n/);
  // South of the equator too: 7 PM Sydney time the night before a 9 AM start.
  const sydney = zonedToUtc('2026-07-02T09:00', 'Australia/Sydney');
  assert.equal(new Date(reminderFor(sydney, '2026-07-02T09:00', 'Australia/Sydney', Date.UTC(2026, 5, 1))).toISOString(), '2026-07-01T09:00:00.000Z');
  // Already past 7 PM the evening before: an hour before the start instead.
  const late = reminderFor(start, '2026-10-13T15:00', 'America/New_York', Date.UTC(2026, 9, 13, 2));
  assert.equal(late, start - 36e5);
  assert.match(ics(start, late), /TRIGGER:-PT1H\r\n/);
  assert.match(ics(start, start - 45 * 6e4), /TRIGGER:-PT45M\r\n/);
  assert.match(ics(start, start - 20.5 * 36e5), /TRIGGER:-PT20H30M\r\n/);
});
