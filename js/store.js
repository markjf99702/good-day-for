// Everything is kept in this browser's localStorage. Nothing leaves the device
// except the coordinates sent to the weather service.

import { DEFAULT_PICKS } from './jobs.js';
import { guessUnits } from './units.js';

const KEY = 'gooddayfor:v1';
const FC_KEY = 'gooddayfor:forecast';

export const SCHEDULES = {
  any: { name: 'Any time', note: 'Daylight is still up to each job.' },
  evenings: { name: 'Evenings & weekends', note: 'Weekdays after 5 PM, all day Saturday and Sunday.' },
  weekends: { name: 'Weekends only', note: 'Saturday and Sunday.' },
  custom: { name: 'Pick my hours', note: 'Set the hours for each day.' },
};

// Sunday first, matching Date#getUTCDay.
const presetDays = {
  any: null,
  evenings: [[0, 24], [17, 24], [17, 24], [17, 24], [17, 24], [17, 24], [0, 24]],
  weekends: [[0, 24], null, null, null, null, null, [0, 24]],
};

export function availability(schedule) {
  if (!schedule || schedule.preset === 'any') return null;
  if (schedule.preset === 'custom') return schedule.days;
  return presetDays[schedule.preset] || null;
}

export function defaults() {
  return {
    units: guessUnits(),
    schedule: { preset: 'any', days: [[8, 20], [17, 21], [17, 21], [17, 21], [17, 21], [17, 21], [8, 20]] },
    place: null,
    recent: [],
    picks: [...DEFAULT_PICKS],
    edits: {},
    custom: {},
    seen: false,
  };
}

export function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    return saved ? { ...defaults(), ...saved } : defaults();
  } catch {
    return defaults();
  }
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode or full */ }
}

export function loadForecast(key) {
  try {
    const fc = JSON.parse(localStorage.getItem(FC_KEY) || 'null');
    return fc && fc.key === key ? fc : null;
  } catch {
    return null;
  }
}

export function saveForecast(fc) {
  try { localStorage.setItem(FC_KEY, JSON.stringify(fc)); } catch { /* fine */ }
}

export function clearAll() {
  try { localStorage.removeItem(KEY); localStorage.removeItem(FC_KEY); } catch { /* fine */ }
}
