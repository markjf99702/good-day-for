// Words and numbers: formatting values in the chosen units, and turning rules,
// checks and alerts into plain sentences.

import { unitFor, fromF, fromDF, fromMph, fromIn } from './units.js';
import { NO, IFFY, RAIN, LAWN } from './engine.js';

// ——— Formatting ———

// A place-local "YYYY-MM-DDTHH:MM" as a Date whose UTC fields hold those numbers,
// so Intl can print it with timeZone 'UTC' without shifting it.
const asDate = s => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13) || 0, +s.slice(14, 16) || 0));

export function makeFmt(units = 'us', locale = globalThis.navigator?.language || 'en-US') {
  const f = (o) => { try { return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...o }); } catch { return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...o }); } };
  const h12 = /h1[12]/.test(f({ hour: 'numeric' }).resolvedOptions().hourCycle || 'h12');
  const hourF = h12 ? f({ hour: 'numeric' }) : f({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const clockF = f({ hour: 'numeric', minute: '2-digit', ...(h12 ? {} : { hourCycle: 'h23' }) });
  const wdF = f({ weekday: 'short' }), weekdayF = f({ weekday: 'long' });
  const dateF = f({ weekday: 'short', month: 'short', day: 'numeric' });
  const monthDayF = f({ month: 'short', day: 'numeric' });
  const u = kind => unitFor(kind, units);
  const T = u('temp'), dT = u('tempDelta'), W = u('wind'), R = u('rain');

  const fmt = {
    units, h12,
    temp: c => (c == null ? '–' : `${T.to(c)}${T.label}`),
    tempDelta: c => `${dT.to(c)}${dT.label}`,
    wind: k => `${W.to(k)} ${W.label}`,
    rain: mm => {
      if (units === 'metric') return `${mm < 10 ? Math.round(mm * 10) / 10 : Math.round(mm)} mm`;
      const i = mm / 25.4;
      return `${i < 0.995 ? i.toFixed(2).replace(/0$/, '').replace(/\.0?$/, '') : i.toFixed(1).replace(/\.0$/, '')} in`;
    },
    snow: cm => (units === 'metric' ? `${Math.round(cm)} cm` : `${Math.max(1, Math.round(cm / 2.54))} in`),
    depth: cm => (units === 'metric' ? `${cm} cm` : `${Math.round(cm / 2.54)} in`),
    hour: t => hourF.format(asDate(t)).replace(':00 ', ' '),
    hourOf: h => hourF.format(new Date(Date.UTC(2000, 0, 1, h % 24))),
    clock: t => clockF.format(asDate(t)),
    wd: t => wdF.format(asDate(t)),
    weekday: t => weekdayF.format(asDate(t)),
    date: t => dateF.format(asDate(t)),
    monthDay: t => monthDayF.format(asDate(t)),
    dayHour: t => `${wdF.format(asDate(t))} ${hourF.format(asDate(t))}`,
    shortHour: h => (h12 ? `${h % 12 || 12}${h < 12 ? 'a' : 'p'}` : `${h}`),
  };
  return fmt;
}

// "today", "tomorrow", "Thursday", or "Thu, Oct 2" further out.
export function relDay(date, today, fmt, { cap = false } = {}) {
  const days = Math.round((Date.parse(date) - Date.parse(today)) / 864e5);
  let s = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days < 7 ? fmt.weekday(date) : fmt.date(date);
  return cap ? s[0].toUpperCase() + s.slice(1) : s;
}

export function hoursText(h) {
  if (h === 1) return '1 hour';
  if (h >= 48 && h % 24 === 0) return `${h / 24} days`;
  return `${h} hours`;
}

// ——— Rules ———

// What each kind of rule is, for the editor. `kind` is the unit of its value.
export const RULE_TYPES = {
  dry: { label: 'No rain', span: true },
  tempMin: { label: 'At least (temperature)', kind: 'temp', def: fromF(50), span: true },
  tempMax: { label: 'No hotter than', kind: 'temp', def: fromF(90), span: true },
  windMax: { label: 'Wind under', kind: 'wind', def: fromMph(15), span: true },
  gustMax: { label: 'Gusts under', kind: 'wind', def: fromMph(25), span: true },
  windMin: { label: 'Breeze of at least', kind: 'wind', def: fromMph(3), span: true },
  rhMax: { label: 'Humidity under', kind: 'pct', def: 85, span: true },
  dewGap: { label: 'Above the dew point by', kind: 'tempDelta', def: fromDF(5), span: true },
  dewMax: { label: 'Dew point under', kind: 'temp', def: fromF(60), span: true },
  cloudMin: { label: 'Cloud cover at least', kind: 'pct', def: 50, span: true },
  cloudMax: { label: 'Cloud cover under', kind: 'pct', def: 60, span: true },
  vpdMin: { label: 'Drying air at least', kind: 'kpa', def: 0.5, span: true },
  rainMax: { label: 'Less rain than', kind: 'rain', def: fromIn(0.5), span: true },
  rainMin: { label: 'At least this much rain', kind: 'rain', def: fromIn(0.1), span: true },
  soil: { label: 'Soil temperature', kind: 'temp' },
  thirsty: { label: 'Lawn short on water by', kind: 'rain', def: fromIn(0.5) },
  daylight: { label: 'Daylight' },
  clock: { label: 'Time of day' },
};

export const WHEN = [
  ['before', 'before you start'],
  ['during', 'while you work'],
  ['during+after', 'while you work and after'],
  ['after', 'after you finish'],
];

export function spanText(rule) {
  const h = hoursText(rule.h || 0);
  switch (rule.when) {
    case 'before': return `in the ${h} before you start`;
    case 'after': return `for ${h} after you finish`;
    case 'during+after': return `while you work and for ${h} after`;
    default: return 'while you work';
  }
}

const dryWord = v => (v < 0.3 ? 'Some' : v < 0.6 ? 'Decent' : v < 1 ? 'Good' : 'Great');
const dryLevel = v => (v < 0.3 ? 'poor' : v < 0.6 ? 'fair' : v < 1 ? 'good' : 'great');

export function ruleText(rule, fmt) {
  const s = spanText(rule);
  switch (rule.t) {
    case 'daylight': return 'In daylight';
    case 'clock': return `Between ${fmt.hourOf(rule.from)} and ${fmt.hourOf(rule.to)}`;
    case 'dry': return `No rain ${s}`;
    case 'tempMin': return `At least ${fmt.temp(rule.v)} ${s}`;
    case 'tempMax': return `No hotter than ${fmt.temp(rule.v)} ${s}`;
    case 'windMax': return `Wind under ${fmt.wind(rule.v)} ${s}`;
    case 'gustMax': return `Gusts under ${fmt.wind(rule.v)} ${s}`;
    case 'windMin': return `At least a ${fmt.wind(rule.v)} breeze ${s}`;
    case 'rhMax': return `Humidity under ${Math.round(rule.v)}% ${s}`;
    case 'dewGap': return `At least ${fmt.tempDelta(rule.v)} above the dew point ${s}`;
    case 'dewMax': return `Dew point under ${fmt.temp(rule.v)} ${s}`;
    case 'cloudMin': return `At least ${Math.round(rule.v)}% cloud cover ${s}`;
    case 'cloudMax': return `Under ${Math.round(rule.v)}% cloud cover ${s}`;
    case 'vpdMin': return `${dryWord(rule.v)} drying air or better ${s}`;
    case 'rainMax': return `Less than ${fmt.rain(rule.v)} of rain ${s}`;
    case 'rainMin': return `At least ${fmt.rain(rule.v)} of rain ${s}`;
    case 'soil': {
      const d = `Soil ${fmt.depth(rule.depth || 6)} down`;
      if (rule.min != null && rule.max != null) return `${d} between ${fmt.temp(rule.min)} and ${fmt.temp(rule.max)}`;
      if (rule.min != null) return `${d} at least ${fmt.temp(rule.min)}`;
      return `${d} below ${fmt.temp(rule.max)}`;
    }
    case 'thirsty': return `Lawn at least ${fmt.rain(rule.v)} short of water`;
    default: return rule.t;
  }
}

// A short name for what's in the way, like "Rain" or "Cold nights".
// `at` is a start hour where it got in the way (for the soil wording).
export function blockerText(rule, ctx, at = ctx?.i0) {
  switch (rule.t) {
    case 'dry': return rule.when === 'before' ? 'Recent rain' : 'Rain';
    case 'tempMin': return rule.when !== 'during' && rule.when && (rule.h || 0) >= 12 ? 'Cold nights' : 'Too cold';
    case 'tempMax': return 'Too hot';
    case 'windMax': return 'Too windy';
    case 'gustMax': return 'Gusty';
    case 'windMin': return 'Dead calm';
    case 'rhMax': return 'Too humid';
    case 'dewGap': return 'Dew';
    case 'dewMax': return 'Muggy';
    case 'cloudMin': return 'Too sunny';
    case 'cloudMax': return 'Too cloudy';
    case 'vpdMin': return 'Slow drying';
    case 'rainMax': return rule.when === 'before' ? 'Soggy ground' : 'Heavy rain';
    case 'rainMin': return 'Not enough rain';
    case 'soil': {
      const v = ctx?.soil[rule.depth || 6]?.[ctx.day[at]];
      if (v != null && rule.max != null && v > rule.max) return 'Soil too warm';
      if (v != null && rule.min != null && v < rule.min) return 'Soil too cold';
      return 'Soil temperature';
    }
    case 'thirsty': return 'Lawn has enough water';
    case 'daylight': return 'Dark';
    case 'clock': return 'Time of day';
    default: return rule.t;
  }
}

// What the forecast actually shows for a rule at one start, e.g. "Low of 44°F Fri 6 AM".
export function obsText(rule, c, ctx, fmt) {
  const t = i => ctx.fc.time[i];
  const at = i => (i >= 0 ? ` ${fmt.dayHour(t(i))}` : '');
  const v = c.v;
  switch (rule.t) {
    case 'daylight': {
      const d = ctx.fc.days[ctx.day[c.at >= 0 ? c.at : 0]];
      const sun = d?.sunrise ? `Sun up ${fmt.clock(d.sunrise)} to ${fmt.clock(d.sunset)}` : 'No sunrise data';
      return c.st === NO ? `Runs into the dark. ${sun}` : sun;
    }
    case 'clock': return c.st === NO ? `Runs past those hours` : 'Fits';
    case 'dry': {
      if (c.past) return c.total >= RAIN.trace ? `${fmt.rain(c.total)} fell, starting${at(c.traceAt)}` : 'Stayed dry';
      if (c.st === NO) {
        if (c.wetAt >= 0 && ctx.fc.precip[c.wetAt] >= RAIN.wetHour) return `Rain${at(c.wetAt)} (${fmt.rain(c.total)} in all)`;
        if (c.wetAt >= 0) return `Rain likely${at(c.wetAt)} (${ctx.fc.pop[c.wetAt]}% chance)`;
        return `${fmt.rain(c.total)} of drizzle, starting${at(c.traceAt)}`;
      }
      if (c.st === IFFY) {
        if (c.traceAt >= 0) return `A little rain possible${at(c.traceAt)}`;
        return `${c.maxPop}% chance of rain${at(c.popAt)}`;
      }
      return c.maxPop > 0 ? `Dry. Rain chances ${c.maxPop}% or less` : 'Dry';
    }
    case 'tempMin': return `Low of ${fmt.temp(v)}${at(c.at)}`;
    case 'tempMax': return `High of ${fmt.temp(v)}${at(c.at)}`;
    case 'windMax': return `Up to ${fmt.wind(v)}${at(c.at)}`;
    case 'gustMax': return `Gusts to ${fmt.wind(v)}${at(c.at)}`;
    case 'windMin': return `Down to ${fmt.wind(v)}${at(c.at)}`;
    case 'rhMax': return `Up to ${Math.round(v)}%${at(c.at)}`;
    case 'dewGap': return v <= 0 ? `At the dew point${at(c.at)}` : `As close as ${fmt.tempDelta(v)} above the dew point${at(c.at)}`;
    case 'dewMax': return `Dew point up to ${fmt.temp(v)}${at(c.at)}`;
    case 'cloudMin':
    case 'cloudMax': return `Averages ${Math.round(v)}% cloud cover`;
    case 'vpdMin': return `${dryLevel(v)[0].toUpperCase() + dryLevel(v).slice(1)} drying air (${v.toFixed(2)} kPa on average)`;
    case 'rainMax':
    case 'rainMin': return v < 0.1 ? 'None expected' : `About ${fmt.rain(v)} expected`;
    case 'soil': return `Averages ${fmt.temp(v)} that day`;
    case 'thirsty': return c.st === NO ? `Only ${fmt.rain(v)} short` : `${fmt.rain(v)} short of a full ${fmt.rain(LAWN.cap)}`;
    default: return '';
  }
}

// ——— Alerts ———

export function alertText(a, ctx, fmt, today) {
  const day = relDay(a.date, today, fmt);
  const part = () => {
    const hr = a.at >= 0 ? ctx.hour[a.at] : 12;
    if (day === 'today') return hr < 12 ? 'this morning' : 'tonight';
    return `${day} ${hr < 12 ? 'morning' : 'night'}`;
  };
  switch (a.kind) {
    case 'freeze': return { icon: '🥶', title: `Hard freeze ${part()}`, body: `Low of ${fmt.temp(a.v)}. Disconnect hoses, cover outdoor faucets, and bring in potted plants.` };
    case 'frost': return { icon: '❄️', title: `Frost possible ${part()}`, body: `Low of ${fmt.temp(a.v)}. Cover tender plants or bring them inside.` };
    case 'ice': return { icon: '🧊', title: `Freezing rain possible ${day}`, body: 'Salt or sand the steps and walks ahead of time.' };
    case 'snow': return { icon: '🌨️', title: `Snow ${day}`, body: `About ${fmt.snow(a.v)}. Get the shovel and ice melt out.` };
    case 'rain': return { icon: '🌧️', title: `Heavy rain ${day}`, body: `About ${fmt.rain(a.v)}. Clear gutters and downspouts, and check the sump pump.` };
    case 'wind': return { icon: '💨', title: `Strong gusts ${day}`, body: `Up to ${fmt.wind(a.v)}. Tie down patio furniture, trampolines and trash cans.` };
    case 'heat': return { icon: '🔥', title: `Heat ${day}`, body: `High of ${fmt.temp(a.v)}. Water early, skip mowing and fertilizing, and check on pets.` };
    default: return { icon: '⚠️', title: a.kind, body: '' };
  }
}
