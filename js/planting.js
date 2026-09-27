// The planting calendar. Each row is a crop (or a lawn job) and the steps that
// go with it, timed in weeks either side of the typical last spring frost (L)
// or first fall frost (F), following common extension-service advice.
//
// Where a row matches one of the app's jobs, like seeding the lawn or putting
// down crabgrass preventer, the calendar only says which weeks are in season.
// The job's soil-temperature rule decides the actual day.
//
// Pure functions; days of the season and dates come from frost.js.

import { SEASON_DAYS, seasonOf, dateIn, addDays } from './frost.js';

export const KINDS = [
  ['indoors', 'Start indoors'],
  ['sow', 'Sow outside'],
  ['plant', 'Plant out'],
  ['other', 'Lawn care & other'],
];

export const GROUPS = [['veg', 'Vegetables'], ['herb', 'Herbs'], ['flower', 'Flowers & bulbs'], ['lawn', 'Lawn']];

const SAY = { indoors: 'Start seeds indoors', sow: 'Sow outside', plant: 'Plant out', other: 'Do it' };

//   k      indoors | sow | plant | other
//   from   'L-8' = eight weeks before the last spring frost, 'F+2' = two weeks after the first fall frost
//   to     the end of the window, the same way
//   say    what to do, if not the kind's usual words
export const CROPS = [
  // ——— Vegetables ———
  { id: 'tomatoes', group: 'veg', icon: '🍅', name: 'Tomatoes', job: 'transplant',
    steps: [{ k: 'indoors', from: 'L-8', to: 'L-6' }, { k: 'plant', from: 'L+1', to: 'L+3' }],
    note: 'They stall in cold nights, so there’s no prize for planting early.' },
  { id: 'peppers', group: 'veg', icon: '🫑', name: 'Peppers & eggplant', job: 'transplant',
    steps: [{ k: 'indoors', from: 'L-10', to: 'L-8' }, { k: 'plant', from: 'L+2', to: 'L+4' }],
    note: 'Slow to sprout, and fussier about cold than tomatoes.' },
  { id: 'brassicas', group: 'veg', icon: '🥦', name: 'Broccoli, cabbage & kale',
    steps: [{ k: 'indoors', from: 'L-10', to: 'L-7' }, { k: 'plant', from: 'L-3', to: 'L+0' }, { k: 'plant', from: 'F-12', to: 'F-9', say: 'Plant out for a fall crop' }],
    note: 'They shrug off a light frost, and fall crops taste sweeter after one.' },
  { id: 'greens', group: 'veg', icon: '🥬', name: 'Lettuce, spinach & greens',
    steps: [{ k: 'sow', from: 'L-6', to: 'L+1' }, { k: 'sow', from: 'F-8', to: 'F-4', say: 'Sow for fall' }],
    note: 'Sow a short row every couple of weeks for a steady supply.' },
  { id: 'peas', group: 'veg', icon: '🫛', name: 'Peas',
    steps: [{ k: 'sow', from: 'L-6', to: 'L-3' }],
    note: 'In as soon as the soil can be worked. They quit when summer heat arrives.' },
  { id: 'roots', group: 'veg', icon: '🥕', name: 'Carrots, beets & radishes',
    steps: [{ k: 'sow', from: 'L-4', to: 'L+3' }, { k: 'sow', from: 'F-12', to: 'F-8', say: 'Sow for fall' }],
    note: 'Radishes are ready in a month; carrots take two or three.' },
  { id: 'potatoes', group: 'veg', icon: '🥔', name: 'Potatoes',
    steps: [{ k: 'plant', from: 'L-3', to: 'L+1', say: 'Plant seed potatoes' }],
    note: 'Shoots can take a light frost. Hill soil over them if a hard one is coming.' },
  { id: 'onions', group: 'veg', icon: '🧅', name: 'Onions',
    steps: [{ k: 'plant', from: 'L-5', to: 'L-2', say: 'Plant sets or transplants' }],
    note: 'Cold-hardy, and the bulbs size up as the days get long.' },
  { id: 'beans', group: 'veg', icon: '🫘', name: 'Beans',
    steps: [{ k: 'sow', from: 'L+1', to: 'F-10' }],
    note: 'Sow a new batch every few weeks until midsummer.' },
  { id: 'squash', group: 'veg', icon: '🥒', name: 'Cucumbers, squash & melons',
    steps: [{ k: 'sow', from: 'L+1', to: 'L+4' }],
    note: 'Seeds rot in cold, wet ground, so wait for it to warm up.' },
  { id: 'corn', group: 'veg', icon: '🌽', name: 'Sweet corn',
    steps: [{ k: 'sow', from: 'L+2', to: 'L+6' }],
    note: 'Plant a block rather than one long row, so it pollinates.' },
  { id: 'pumpkins', group: 'veg', icon: '🎃', name: 'Pumpkins',
    steps: [{ k: 'sow', from: 'L+3', to: 'L+6' }],
    note: 'Most need three to four months to ripen.' },
  { id: 'garlic', group: 'veg', icon: '🧄', name: 'Garlic',
    steps: [{ k: 'plant', from: 'F-2', to: 'F+3', say: 'Plant cloves' }],
    note: 'It roots before the ground freezes and is ready next summer.' },

  // ——— Herbs ———
  { id: 'basil', group: 'herb', icon: '🌿', name: 'Basil', job: 'transplant',
    steps: [{ k: 'indoors', from: 'L-6', to: 'L-4' }, { k: 'plant', from: 'L+1', to: 'L+3' }],
    note: 'The most cold-tender herb. Wait for warm nights.' },
  { id: 'parsley', group: 'herb', icon: '🌱', name: 'Parsley & chives',
    steps: [{ k: 'indoors', from: 'L-10', to: 'L-8' }, { k: 'plant', from: 'L-2', to: 'L+1' }],
    note: 'Parsley is slow to sprout; soak the seed overnight.' },
  { id: 'cilantro', group: 'herb', icon: '🍃', name: 'Cilantro & dill',
    steps: [{ k: 'sow', from: 'L-1', to: 'L+2' }, { k: 'sow', from: 'F-8', to: 'F-5', say: 'Sow for fall' }],
    note: 'Both go to seed in summer heat. Sow a little, often.' },

  // ——— Flowers & bulbs ———
  { id: 'annuals', group: 'flower', icon: '🏵️', name: 'Marigolds & zinnias',
    steps: [{ k: 'indoors', from: 'L-6', to: 'L-4' }, { k: 'plant', from: 'L+1', to: 'L+3', say: 'Plant out or sow' }],
    note: 'Zinnias grow fast enough to sow straight into the garden.' },
  { id: 'sunflowers', group: 'flower', icon: '🌻', name: 'Sunflowers',
    steps: [{ k: 'sow', from: 'L+0', to: 'L+5' }],
    note: 'Straight into the ground; they don’t like being moved.' },
  { id: 'sweetpeas', group: 'flower', icon: '🌸', name: 'Sweet peas',
    steps: [{ k: 'sow', from: 'L-6', to: 'L-4' }],
    note: 'They like it cool, so get them in early.' },
  { id: 'dahlias', group: 'flower', icon: '🌺', name: 'Dahlias & gladiolus',
    steps: [{ k: 'plant', from: 'L+1', to: 'L+3', say: 'Plant tubers and corms' }, { k: 'other', from: 'F+0', to: 'F+2', say: 'Dig up and store' }],
    note: 'Where the ground freezes, dig them once frost blackens the leaves.' },
  { id: 'bulbs', group: 'flower', icon: '🌷', name: 'Tulips & daffodils', job: 'bulbs',
    steps: [{ k: 'plant', from: 'F-4', to: 'F+4', say: 'Plant bulbs' }],
    note: 'Once the soil has cooled, and before it freezes.' },

  // ——— Lawn ———
  { id: 'preventer', group: 'lawn', icon: '🛡️', name: 'Crabgrass preventer', job: 'preemergent',
    steps: [{ k: 'other', from: 'L-4', to: 'L+1', say: 'Put it down' }],
    note: 'It has to go down before crabgrass sprouts, and the soil temperature decides when that is. It stops grass seed too.' },
  { id: 'overseed', group: 'lawn', icon: '🌾', name: 'Overseed a cool-season lawn', job: 'seed',
    steps: [{ k: 'sow', from: 'F-10', to: 'F-4', say: 'Overseed' }, { k: 'sow', from: 'L+0', to: 'L+4', say: 'Overseed (second best)' }],
    note: 'Late summer into fall is best: warm soil, cool air and fewer weeds. Seedlings need about six weeks before a hard freeze.' },
  { id: 'warmseed', group: 'lawn', icon: '☀️', name: 'Seed a warm-season lawn', job: 'seed-warm',
    steps: [{ k: 'sow', from: 'L+4', to: 'L+10', say: 'Seed' }],
    note: 'Bermuda, zoysia, centipede and bahia, in places warm enough to grow them.' },
];

export const say = step => step.say || SAY[step.k];

export function parseAt(s) {
  const m = /^([LF])([+-]\d+)$/.exec(s);
  if (!m) throw new Error(`Bad step time: ${s}`);
  return { anchor: m[1], weeks: +m[2] };
}

// A step's window as days of the season: [start, end]. It can run below 0 or
// past the season's end; draw it wrapped. Null if it doesn't fit (beans that
// can't be sown between "after the last frost" and "10 weeks before the first").
export function stepSpan(step, anc) {
  const at = s => { const p = parseAt(s); return anc[p.anchor] + p.weeks * 7; };
  const a = at(step.from), b = at(step.to);
  return b >= a ? [a, b] : null;
}

// Every row with its bars, for drawing.
export function calendar(anc) {
  return CROPS.map(crop => ({
    crop,
    bars: crop.steps.map(step => { const s = stepSpan(step, anc); return s && { step, a: s[0], b: s[1] }; }).filter(Boolean),
  })).filter(r => r.bars.length);
}

// A window of days folded into one season, split where it wraps: [[from, to], …], inclusive.
export function segments(a, b, len = SEASON_DAYS) {
  if (b - a >= len - 1) return [[0, len - 1]];
  const s = ((a % len) + len) % len, e = s + (b - a);
  return e < len ? [[s, e]] : [[s, len - 1], [0, e - len]];
}

// A step's real dates in the seasons either side of `today`.
export function windowsNear(step, anc, south, today) {
  const Y = seasonOf(today, south).y;
  const when = (y, s) => { const p = parseAt(s); return addDays(dateIn(y, anc[p.anchor], south), p.weeks * 7); };
  const out = [];
  for (const y of [Y - 1, Y, Y + 1]) {
    const start = when(y, step.from), end = when(y, step.to);
    if (end >= start) out.push({ start, end });
  }
  return out;
}

// What's in season this week, and what starts in the next few weeks.
export function weekPlan(anc, south, today, { days = 7, ahead = 28 } = {}) {
  const weekEnd = addDays(today, days - 1), soonEnd = addDays(today, ahead);
  const now = [], soon = [];
  for (const crop of CROPS) {
    for (const step of crop.steps) {
      for (const w of windowsNear(step, anc, south, today)) {
        if (w.start <= weekEnd && w.end >= today) now.push({ crop, step, ...w });
        else if (w.start > weekEnd && w.start <= soonEnd) soon.push({ crop, step, ...w });
      }
    }
  }
  now.sort((x, y) => (x.end < y.end ? -1 : x.end > y.end ? 1 : 0));
  soon.sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0));
  return { today, weekEnd, now, soon };
}

// When a job is in season (for the job's own page): the window we're in, or
// else the next one, from the outdoor steps of the first row that uses it.
export function seasonFor(jobId, anc, south, today) {
  const row = CROPS.find(c => c.job === jobId);
  if (!row) return null;
  const list = row.steps.filter(s => s.k !== 'indoors')
    .flatMap(step => windowsNear(step, anc, south, today).map(w => ({ step, ...w })))
    .filter(w => w.end >= today)
    .sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0));
  return list.find(w => w.start <= today) || list[0] || null;
}
