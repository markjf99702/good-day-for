// The job catalog. Each job is how long the work takes plus the weather it
// needs, written as rules the engine checks hour by hour.
//
// Rule fields:
//   t     what to check (see RULE_TYPES in text.js)
//   when  'before' | 'during' | 'after' | 'during+after'   (default 'during')
//   h     hours for before / after
//   v     the limit, in metric (°C, km/h, mm, %, kPa)
//   lvl   'must'  – break it and the hour is a no
//         'ideal' – break it and the hour is iffy
//         'bonus' – nice when it happens (say, rain to water it in)
//   why   a short reason, shown under the rule
//
// Limits follow typical label and extension guidance. They're a starting
// point: the product you're using wins, and every number can be edited.

import { fromF as F, fromDF as dF, fromMph as mph, fromIn as inch } from './units.js';

export const GROUPS = [
  { id: 'lawn', name: 'Lawn' },
  { id: 'garden', name: 'Garden' },
  { id: 'finish', name: 'Paint & stain' },
  { id: 'hard', name: 'Driveway, concrete & floors' },
  { id: 'house', name: 'Roof, gutters & windows' },
  { id: 'home', name: 'Laundry, car & house' },
];

const daylight = { t: 'daylight', lvl: 'must' };

export const JOBS = [
  // ——— Lawn ———
  {
    id: 'mow', group: 'lawn', icon: '🌱', name: 'Mow the lawn', hours: 1,
    about: 'Dry grass cuts clean. Wet grass clumps, tears and clogs the deck.',
    rules: [
      daylight,
      { t: 'dry', when: 'before', h: 3, why: 'Grass needs a few hours to dry after rain.' },
      { t: 'dry', when: 'during' },
      { t: 'rhMax', v: 85, lvl: 'ideal', why: 'Morning dew has burned off.' },
      { t: 'tempMax', v: F(90), lvl: 'ideal', why: 'Hard on the grass, and on you.' },
    ],
  },
  {
    id: 'water', group: 'lawn', icon: '💧', name: 'Water the lawn', hours: 1, anytime: true,
    about: 'Tracks how much water your grass has used against how much rain it got, so you only water when it’s actually short and no rain is on the way.',
    rules: [
      { t: 'thirsty', v: inch(0.5), why: 'Grass uses about 80% of what the air pulls from the ground each day.' },
      { t: 'rainMax', v: inch(0.25), when: 'after', h: 24, why: 'No point watering right before a good rain.' },
      { t: 'clock', from: 4, to: 10, lvl: 'ideal', why: 'Early morning loses less to evaporation, and the grass dries by night.' },
      { t: 'windMax', v: mph(10), lvl: 'ideal', why: 'Wind blows sprinklers off target.' },
    ],
  },
  {
    id: 'fertilize', group: 'lawn', icon: '🌾', name: 'Fertilize the lawn', hours: 1,
    about: 'Granular fertilizer wants a light rain to water it in, not a downpour that washes it into the street.',
    rules: [
      daylight,
      { t: 'rainMax', v: inch(0.75), when: 'after', h: 24, why: 'Heavy rain washes it off before it soaks in.' },
      { t: 'dry', when: 'during', lvl: 'ideal' },
      { t: 'tempMax', v: F(85), lvl: 'ideal', why: 'Feeding in the heat can burn stressed grass.' },
      { t: 'windMax', v: mph(15), lvl: 'ideal' },
      { t: 'rainMin', v: inch(0.1), when: 'after', h: 48, lvl: 'bonus', why: 'Rain will water it in for you.' },
    ],
  },
  {
    id: 'weed-spray', group: 'lawn', icon: '🧪', name: 'Spray weeds', hours: 1,
    about: 'Liquid weed killer needs calm air so it lands where you aim, warmth so weeds take it up, and a dry spell so it isn’t rinsed off.',
    rules: [
      daylight,
      { t: 'dry', when: 'during+after', h: 6, why: 'Most weed killers need 4–6 hours on the leaf before rain.' },
      { t: 'dry', when: 'after', h: 24, lvl: 'ideal', why: 'A full dry day works better, especially in cool weather.' },
      { t: 'windMax', v: mph(10), why: 'Stronger wind drifts spray onto plants you want to keep.' },
      { t: 'windMin', v: mph(2), lvl: 'ideal', why: 'Dead-calm air can carry fine mist a long way.' },
      { t: 'tempMin', v: F(50), why: 'Weeds need to be growing to absorb it.' },
      { t: 'tempMin', v: F(60), lvl: 'ideal' },
      { t: 'tempMax', v: F(85), why: 'Some products turn to vapor and drift in the heat.' },
    ],
  },
  {
    id: 'seed', group: 'lawn', icon: '🌿', name: 'Seed the lawn (cool-season grass)', hours: 2,
    about: 'Fescue, bluegrass and rye sprout best in soil between 50°F and 65°F. Early fall is prime time in most places.',
    rules: [
      daylight,
      { t: 'soil', depth: 6, min: F(50), max: F(65), why: 'Daily average, about 2 inches down.' },
      { t: 'rainMax', v: inch(1), when: 'during+after', h: 48, why: 'A downpour washes seed away.' },
      { t: 'tempMax', v: F(80), lvl: 'ideal' },
      { t: 'windMax', v: mph(15), lvl: 'ideal', why: 'Wind scatters seed from the spreader.' },
      { t: 'rainMin', v: inch(0.1), when: 'after', h: 48, lvl: 'bonus', why: 'Rain will water it in for you.' },
    ],
  },
  {
    id: 'seed-warm', group: 'lawn', icon: '☀️', name: 'Seed the lawn (warm-season grass)', hours: 2,
    about: 'Bermuda, zoysia, centipede and bahia need warm soil, 65°F and up, to sprout. Late spring into early summer.',
    rules: [
      daylight,
      { t: 'soil', depth: 6, min: F(65), max: F(90), why: 'Daily average, about 2 inches down.' },
      { t: 'rainMax', v: inch(1), when: 'during+after', h: 48, why: 'A downpour washes seed away.' },
      { t: 'windMax', v: mph(15), lvl: 'ideal' },
      { t: 'rainMin', v: inch(0.1), when: 'after', h: 48, lvl: 'bonus', why: 'Rain will water it in for you.' },
    ],
  },
  {
    id: 'preemergent', group: 'lawn', icon: '🛡️', name: 'Put down crabgrass preventer (spring)', hours: 1,
    about: 'Pre-emergent has to go down after the soil reaches about 50°F and before a steady 55–60°F, when crabgrass sprouts.',
    rules: [
      daylight,
      { t: 'soil', depth: 6, min: F(50), max: F(60), why: 'Daily average, about 2 inches down.' },
      { t: 'rainMax', v: inch(1), when: 'after', h: 24, why: 'Heavy rain moves it before it settles in.' },
      { t: 'windMax', v: mph(15), lvl: 'ideal' },
      { t: 'rainMin', v: inch(0.25), when: 'after', h: 72, lvl: 'bonus', why: 'Rain will water it in, which it needs within a few days.' },
    ],
  },
  {
    id: 'leaves', group: 'lawn', icon: '🍁', name: 'Rake or blow leaves', hours: 2,
    about: 'Dry leaves are light and blow easily. Wet ones mat down and weigh a ton.',
    rules: [
      daylight,
      { t: 'dry', when: 'during' },
      { t: 'dry', when: 'before', h: 12, lvl: 'ideal', why: 'Dry leaves are lighter and blow easier.' },
      { t: 'windMax', v: mph(20), why: 'Beyond this the wind rearranges your piles.' },
      { t: 'windMax', v: mph(10), lvl: 'ideal' },
    ],
  },
  {
    id: 'aerate', group: 'lawn', icon: '🕳️', name: 'Core-aerate the lawn', hours: 2,
    about: 'Tines pull deep plugs from soil softened by recent rain. Soggy ground just smears.',
    rules: [
      daylight,
      { t: 'dry', when: 'during' },
      { t: 'rainMax', v: inch(1), when: 'before', h: 24, why: 'Not soggy.' },
      { t: 'rainMin', v: inch(0.25), when: 'before', h: 72, lvl: 'ideal', why: 'Soil softened by recent rain lets the tines go deep.' },
      { t: 'tempMax', v: F(85), lvl: 'ideal' },
    ],
  },

  // ——— Garden ———
  {
    id: 'transplant', group: 'garden', icon: '🍅', name: 'Plant tomatoes, peppers & annuals', hours: 2,
    about: 'Tender plants go out once the frost is done. Warm-season crops also sulk through nights below 50°F.',
    rules: [
      daylight,
      { t: 'tempMin', v: F(36), when: 'during+after', h: 168, why: 'No frost for the week after planting.' },
      { t: 'tempMin', v: F(50), when: 'after', h: 72, lvl: 'ideal', why: 'Tomatoes and peppers stall below 50°F at night.' },
      { t: 'soil', depth: 6, min: F(60), lvl: 'ideal', why: 'Warm soil gets roots going.' },
      { t: 'tempMax', v: F(85), lvl: 'ideal', why: 'Less transplant shock on a mild day.' },
    ],
  },
  {
    id: 'plant-trees', group: 'garden', icon: '🌳', name: 'Plant trees & shrubs', hours: 3,
    about: 'Plant into workable ground on a mild stretch, ideally with rain on the way.',
    rules: [
      daylight,
      { t: 'soil', depth: 6, min: F(34), why: 'Ground not frozen.' },
      { t: 'tempMax', v: F(85), when: 'during+after', h: 72, lvl: 'ideal', why: 'Heat right after planting stresses roots.' },
      { t: 'rainMin', v: inch(0.25), when: 'after', h: 72, lvl: 'bonus', why: 'Rain will soak it in for you.' },
    ],
  },
  {
    id: 'bulbs', group: 'garden', icon: '🌷', name: 'Plant spring bulbs', hours: 2,
    about: 'Tulips, daffodils and crocus go in once the soil at planting depth is below 60°F, before it freezes.',
    rules: [
      daylight,
      { t: 'soil', depth: 18, max: F(60), why: 'Daily average, about 7 inches down.' },
      { t: 'soil', depth: 6, min: F(34), why: 'Ground not frozen.' },
      { t: 'dry', when: 'during', lvl: 'ideal' },
    ],
  },
  {
    id: 'dormant-oil', group: 'garden', icon: '🍎', name: 'Dormant-oil spray on fruit trees', hours: 1,
    about: 'Late-winter spray that smothers overwintering pests. It needs a mild, dry, still day with no freeze on either side.',
    rules: [
      daylight,
      { t: 'tempMin', v: F(33), when: 'before', h: 24, why: 'Oil on frozen buds damages them.' },
      { t: 'tempMin', v: F(40), when: 'during+after', h: 24 },
      { t: 'dry', when: 'during+after', h: 24 },
      { t: 'windMax', v: mph(10), why: 'Spray drifts in more wind.' },
    ],
  },

  // ——— Paint & stain ———
  {
    id: 'ext-paint', group: 'finish', icon: '🖌️', name: 'Paint the outside of the house', hours: 5,
    about: 'Latex paint needs dry surfaces, mild temperatures while it cures overnight, and no dew settling on it before it sets.',
    rules: [
      daylight,
      { t: 'dry', when: 'before', h: 12, why: 'Siding and trim need to be dry.' },
      { t: 'dry', when: 'during+after', h: 6, why: 'Most latex needs 4–6 hours before rain.' },
      { t: 'dry', when: 'after', h: 24, lvl: 'ideal' },
      { t: 'tempMin', v: F(50), when: 'during+after', h: 24, why: 'Typical label: 50°F and up while it cures. Low-temperature paints go to 35°F.' },
      { t: 'tempMax', v: F(90), why: 'Too hot and it dries before it levels out.' },
      { t: 'dewGap', v: dF(5), when: 'during+after', h: 3, why: 'Keeps dew from forming on wet paint.' },
      { t: 'rhMax', v: 85 },
      { t: 'windMax', v: mph(15), lvl: 'ideal', why: 'Wind dries it too fast and blows grit into it.' },
    ],
  },
  {
    id: 'deck-stain', group: 'finish', icon: '🪵', name: 'Stain or seal the deck or fence', hours: 4,
    about: 'The wood has to be dry going in, and the stain needs a mild, dry stretch to soak in and cure.',
    rules: [
      daylight,
      { t: 'dry', when: 'before', h: 24, why: 'Wet wood won’t take stain.' },
      { t: 'dry', when: 'during+after', h: 12, why: 'Most stains need 12 hours before rain.' },
      { t: 'dry', when: 'after', h: 24, lvl: 'ideal' },
      { t: 'tempMin', v: F(50) },
      { t: 'tempMin', v: F(45), when: 'after', h: 12, why: 'Warm enough overnight to cure.' },
      { t: 'tempMax', v: F(90), why: 'Too hot and it dries before it soaks in.' },
      { t: 'rhMax', v: 85, lvl: 'ideal' },
      { t: 'windMax', v: mph(15), lvl: 'ideal', why: 'Wind blows debris into wet stain.' },
    ],
  },
  {
    id: 'spray-paint', group: 'finish', icon: '🎨', name: 'Spray-paint a project outside', hours: 1,
    about: 'Aerosol paint wants mild, dry, calm air. Humid air turns the finish cloudy.',
    rules: [
      daylight,
      { t: 'dry', when: 'during+after', h: 2 },
      { t: 'tempMin', v: F(50) },
      { t: 'tempMax', v: F(90) },
      { t: 'rhMax', v: 85 },
      { t: 'rhMax', v: 65, lvl: 'ideal', why: 'Lower humidity avoids a cloudy finish.' },
      { t: 'windMax', v: mph(10), why: 'Overspray and dust.' },
    ],
  },
  {
    id: 'caulk', group: 'finish', icon: '🧴', name: 'Caulk windows & trim outside', hours: 2,
    about: 'Caulk needs dry joints and a few rain-free hours to skin over.',
    rules: [
      daylight,
      { t: 'dry', when: 'before', h: 6, why: 'Joints must be dry.' },
      { t: 'dry', when: 'during+after', h: 3, why: 'Latex caulk needs a few hours before rain.' },
      { t: 'dry', when: 'after', h: 24, lvl: 'ideal' },
      { t: 'tempMin', v: F(40), why: 'Typical label minimum for latex caulk.' },
      { t: 'tempMax', v: F(90), lvl: 'ideal' },
    ],
  },

  // ——— Driveway, concrete & floors ———
  {
    id: 'sealcoat', group: 'hard', icon: '🛣️', name: 'Seal the driveway', hours: 3,
    about: 'Asphalt sealer needs dry pavement, 50°F and up for a full day, and a dry day to cure.',
    rules: [
      daylight,
      { t: 'dry', when: 'before', h: 24, why: 'Pavement must be dry.' },
      { t: 'dry', when: 'during+after', h: 24 },
      { t: 'dry', when: 'after', h: 48, lvl: 'ideal' },
      { t: 'tempMin', v: F(50), when: 'during+after', h: 24, why: 'Typical label: 50°F and rising, and staying above it for 24 hours.' },
      { t: 'tempMin', v: F(55), lvl: 'ideal' },
      { t: 'cloudMax', v: 60, lvl: 'ideal', why: 'Sun cures it faster.' },
    ],
  },
  {
    id: 'concrete', group: 'hard', icon: '🧱', name: 'Pour concrete', hours: 4,
    about: 'For footings, pads and post holes. Fresh concrete can’t freeze, bakes and cracks in heat, and gets pitted by rain.',
    rules: [
      daylight,
      { t: 'dry', when: 'during+after', h: 6, why: 'Rain ruins the surface of fresh concrete.' },
      { t: 'tempMin', v: F(40), when: 'during+after', h: 48, why: 'Protect from freezing for the first two days.' },
      { t: 'tempMax', v: F(90), why: 'Sets too fast and cracks.' },
      { t: 'windMax', v: mph(20), lvl: 'ideal', why: 'Wind dries the surface and causes cracking.' },
    ],
  },
  {
    id: 'pressure-wash', group: 'hard', icon: '💦', name: 'Pressure-wash the house, deck or patio', hours: 3,
    about: 'Mostly about not freezing. Plan it two dry days ahead of any staining or sealing.',
    rules: [
      daylight,
      { t: 'tempMin', v: F(40) },
      { t: 'tempMin', v: F(33), when: 'after', h: 12, why: 'Water left in the wood and cracks shouldn’t freeze.' },
      { t: 'windMax', v: mph(15), lvl: 'ideal', why: 'Wind blows spray back at you.' },
    ],
  },
  {
    id: 'epoxy', group: 'hard', icon: '🏁', name: 'Coat the garage floor (epoxy)', hours: 4,
    about: 'Epoxy is fussy about cold and moisture. A garage often runs a little warmer than outside, so check it with a thermometer.',
    rules: [
      { t: 'tempMin', v: F(50), when: 'during+after', h: 24, why: 'Typical label minimum while it cures.' },
      { t: 'tempMax', v: F(90) },
      { t: 'rhMax', v: 85, when: 'during+after', h: 12 },
      { t: 'dewGap', v: dF(5), when: 'during+after', h: 12, why: 'Moisture condensing on the slab ruins the bond.' },
      { t: 'dry', when: 'during', lvl: 'ideal', why: 'So you can leave the door open for the fumes.' },
    ],
  },

  // ——— Roof, gutters & windows ———
  {
    id: 'gutters', group: 'house', icon: '🍂', name: 'Clean the gutters', hours: 2,
    about: 'Ladder work: dry rungs, calm air, no ice.',
    rules: [
      daylight,
      { t: 'dry', when: 'during' },
      { t: 'dry', when: 'before', h: 12, lvl: 'ideal', why: 'Dry gunk is lighter and less slippery.' },
      { t: 'windMax', v: mph(15), why: 'Ladder safety.' },
      { t: 'gustMax', v: mph(25), why: 'Ladder safety.' },
      { t: 'tempMin', v: F(35), why: 'No ice.' },
    ],
  },
  {
    id: 'roof', group: 'house', icon: '🏠', name: 'Roof or shingle repair', hours: 4,
    about: 'A dry roof, calm air, and shingles warm enough to bend without cracking.',
    rules: [
      daylight,
      { t: 'dry', when: 'before', h: 6, why: 'The roof has to be dry to be safe.' },
      { t: 'dry', when: 'during' },
      { t: 'windMax', v: mph(15) },
      { t: 'gustMax', v: mph(25) },
      { t: 'tempMin', v: F(40), why: 'Cold shingles crack, and their sealant strips won’t bond.' },
      { t: 'tempMax', v: F(90), lvl: 'ideal', why: 'Hot shingles scuff, and so do you.' },
    ],
  },
  {
    id: 'windows', group: 'house', icon: '🪟', name: 'Wash the outside windows', hours: 2,
    about: 'Cloudy, mild days are best. Sun dries the glass before you can squeegee it, and that leaves streaks.',
    rules: [
      daylight,
      { t: 'dry', when: 'during+after', h: 12, why: 'Rain spots undo the work.' },
      { t: 'tempMin', v: F(40) },
      { t: 'cloudMin', v: 50, lvl: 'ideal', why: 'Direct sun streaks glass.' },
      { t: 'tempMax', v: F(85), lvl: 'ideal' },
      { t: 'windMax', v: mph(15), lvl: 'ideal' },
    ],
  },
  {
    id: 'lights', group: 'house', icon: '🎄', name: 'Hang or take down holiday lights', hours: 2,
    about: 'Ladder work again, so you want calm and dry. It’s also nicer when you can feel your fingers.',
    rules: [
      daylight,
      { t: 'dry', when: 'during' },
      { t: 'windMax', v: mph(15) },
      { t: 'gustMax', v: mph(25) },
      { t: 'tempMin', v: F(32), why: 'No ice on the ladder or roof.' },
      { t: 'tempMin', v: F(40), lvl: 'ideal' },
    ],
  },

  // ——— Laundry, car & house ———
  {
    id: 'laundry', group: 'home', icon: '👕', name: 'Hang laundry outside', hours: 3,
    about: 'What dries clothes is dry air plus a breeze, not just sunshine. This checks both.',
    rules: [
      daylight,
      { t: 'dry', when: 'during' },
      { t: 'vpdMin', v: 0.4, why: 'How thirsty the air is. Damp, cool air barely dries anything.' },
      { t: 'vpdMin', v: 0.8, lvl: 'ideal' },
      { t: 'windMax', v: mph(25), lvl: 'ideal', why: 'Keeps the sheets on the line.' },
    ],
  },
  {
    id: 'car', group: 'home', icon: '🚗', name: 'Wash the car', hours: 1,
    about: 'No point washing it right before rain. Hot sun bakes soap spots onto the paint.',
    rules: [
      daylight,
      { t: 'dry', when: 'during+after', h: 6 },
      { t: 'dry', when: 'after', h: 24, lvl: 'ideal', why: 'Stays clean for at least a day.' },
      { t: 'tempMin', v: F(35), when: 'during+after', h: 2, why: 'Water freezes on doors, locks and glass.' },
      { t: 'tempMax', v: F(90), lvl: 'ideal', why: 'Soap dries before you can rinse it.' },
    ],
  },
  {
    id: 'air-out', group: 'home', icon: '🌬️', name: 'Open the windows (free cooling)', hours: 3, anytime: true,
    about: 'Hours when outside air is cool and dry enough to replace the AC. Handy on spring and fall nights.',
    rules: [
      { t: 'tempMin', v: F(55) },
      { t: 'tempMax', v: F(78) },
      { t: 'dewMax', v: F(60), why: 'Muggy air makes the house feel clammy.' },
      { t: 'dry', when: 'during', why: 'Rain blows in.' },
      { t: 'windMax', v: mph(20), lvl: 'ideal' },
    ],
  },
];

// Short names for tight spots like the week view.
const SHORT = {
  mow: 'Mow', water: 'Water lawn', fertilize: 'Fertilize', 'weed-spray': 'Spray weeds', seed: 'Seed lawn',
  'seed-warm': 'Seed lawn', preemergent: 'Crabgrass preventer', leaves: 'Leaves', aerate: 'Aerate',
  transplant: 'Plant out', 'plant-trees': 'Plant trees', bulbs: 'Bulbs', 'dormant-oil': 'Dormant oil',
  'ext-paint': 'Paint house', 'deck-stain': 'Stain deck', 'spray-paint': 'Spray paint', caulk: 'Caulk',
  sealcoat: 'Seal driveway', concrete: 'Concrete', 'pressure-wash': 'Pressure-wash', epoxy: 'Epoxy floor',
  gutters: 'Gutters', roof: 'Roof', windows: 'Windows', lights: 'Holiday lights', laundry: 'Laundry',
  car: 'Wash car', 'air-out': 'Open windows',
};
for (const j of JOBS) j.short = SHORT[j.id] || j.name;

export const DEFAULT_PICKS = ['mow', 'water', 'laundry', 'car', 'deck-stain', 'ext-paint', 'gutters', 'weed-spray', 'seed'];

export const byId = id => JOBS.find(j => j.id === id);
