// A made-up but realistic Open-Meteo response, built around today's date, so
// tests and screenshots don't depend on the live service.
//
// Day 0 is today at the place. Highs/lows in °F, rain as { hour: [inches, chance%] }.

const F = f => (f - 32) / 1.8;
const IN = i => i * 25.4;

export const SCENARIO = {
  '-7': { hi: 74, lo: 55, dew: 52, wind: 6, cloud: 30 },
  '-6': { hi: 76, lo: 56, dew: 54, wind: 5, cloud: 20 },
  '-5': { hi: 72, lo: 57, dew: 58, wind: 8, cloud: 70 },
  '-4': { hi: 68, lo: 55, dew: 58, wind: 10, cloud: 90, rain: { 13: [0.2, 80], 14: [0.25, 85], 15: [0.15, 70] } },
  '-3': { hi: 70, lo: 52, dew: 50, wind: 7, cloud: 40 },
  '-2': { hi: 73, lo: 51, dew: 49, wind: 5, cloud: 15 },
  '-1': { hi: 75, lo: 53, dew: 50, wind: 4, cloud: 10 },
  0: { hi: 74, lo: 54, dew: 51, wind: 5, cloud: 20 },
  1: { hi: 77, lo: 56, dew: 55, wind: 6, cloud: 35 },
  2: { hi: 71, lo: 60, dew: 62, wind: 9, cloud: 85, rain: { 14: [0.12, 70], 15: [0.2, 75], 16: [0.08, 60] } },
  3: { hi: 62, lo: 50, dew: 42, wind: 15, gust: 1.9, cloud: 50 },
  4: { hi: 63, lo: 35, dew: 33, wind: 5, cloud: 5 },
  5: { hi: 69, lo: 46, dew: 44, wind: 4, cloud: 10 },
  6: { hi: 72, lo: 51, dew: 50, wind: 5, cloud: 30 },
  7: { hi: 66, lo: 57, dew: 60, wind: 12, cloud: 100, rain: { 9: [0.2, 90], 10: [0.35, 90], 11: [0.4, 95], 12: [0.3, 90], 13: [0.15, 80] } },
  8: { hi: 64, lo: 52, dew: 50, wind: 10, cloud: 60, pop: 25 },
  9: { hi: 67, lo: 50, dew: 48, wind: 6, cloud: 40, pop: 20 },
  10: { hi: 70, lo: 52, dew: 50, wind: 6, cloud: 40, pop: 15 },
  11: { hi: 71, lo: 55, dew: 53, wind: 7, cloud: 50, pop: 35 },
  12: { hi: 66, lo: 53, dew: 52, wind: 8, cloud: 60, pop: 40 },
  13: { hi: 63, lo: 48, dew: 45, wind: 6, cloud: 40, pop: 20 },
  14: { hi: 65, lo: 47, dew: 44, wind: 5, cloud: 30, pop: 15 },
  15: { hi: 67, lo: 49, dew: 46, wind: 5, cloud: 30, pop: 15 },
};

const es = t => 0.6108 * Math.exp((17.27 * t) / (t + 237.3)); // kPa

function localParts(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return p;
}

export function makeForecast({ now = Date.now(), tz = 'America/New_York', scenario = SCENARIO, pastDays = 7, days = 16 } = {}) {
  const p = localParts(now, tz);
  const today = Date.UTC(+p.year, +p.month - 1, +p.day);
  const offset = Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour) - Math.floor(now / 36e5) * 36e5) / 1000);
  const dayList = [];
  for (let d = -pastDays; d < days; d++) dayList.push(d);
  const iso = ms => new Date(ms).toISOString().slice(0, 16);

  const H = {
    time: [], temperature_2m: [], relative_humidity_2m: [], dew_point_2m: [], precipitation: [],
    precipitation_probability: [], snowfall: [], weather_code: [], cloud_cover: [], wind_speed_10m: [],
    wind_gusts_10m: [], soil_temperature_6cm: [], soil_temperature_18cm: [], vapour_pressure_deficit: [],
    et0_fao_evapotranspiration: [],
  };
  const daily = { time: [], sunrise: [], sunset: [] };
  const get = d => scenario[d] || scenario[String(d)] || { hi: 68, lo: 50, dew: 48, wind: 6, cloud: 40 };
  let soil6 = F(66), soil18 = F(67);

  for (const d of dayList) {
    const S = get(d), N = get(d + 1), P = get(d - 1);
    const dayMs = today + d * 864e5;
    daily.time.push(iso(dayMs).slice(0, 10));
    daily.sunrise.push(iso(dayMs + (7 * 60 + 21) * 6e4));
    daily.sunset.push(iso(dayMs + (19 * 60 + 14) * 6e4));
    for (let h = 0; h < 24; h++) {
      // Low at 6 AM, high at 3 PM; evenings slide toward tomorrow's low.
      let tf;
      if (h < 6) tf = P.hi + (S.lo - P.hi) * (0.5 - 0.5 * Math.cos(Math.PI * (h + 9) / 15));
      else if (h <= 15) tf = S.lo + (S.hi - S.lo) * (0.5 - 0.5 * Math.cos(Math.PI * (h - 6) / 9));
      else tf = S.hi + (N.lo - S.hi) * (0.5 - 0.5 * Math.cos(Math.PI * (h - 15) / 15));
      const t = F(tf);
      const dew = Math.min(t, F(S.dew));
      const rh = Math.round(100 * es(dew) / es(t));
      const vpd = Math.max(0, es(t) - es(dew));
      const light = h >= 7 && h < 19;
      const rain = S.rain?.[h];
      const mm = rain ? IN(rain[0]) : 0;
      const pop = rain ? rain[1] : (S.pop ?? (S.cloud > 60 ? 15 : 5));
      const wind = (S.wind + (light ? 4 * Math.sin(Math.PI * (h - 7) / 12) : 0)) * 1.609344;
      H.time.push(iso(dayMs + h * 36e5));
      H.temperature_2m.push(+t.toFixed(1));
      H.dew_point_2m.push(+dew.toFixed(1));
      H.relative_humidity_2m.push(rh);
      H.vapour_pressure_deficit.push(+vpd.toFixed(2));
      H.precipitation.push(+mm.toFixed(1));
      H.precipitation_probability.push(d < 0 ? null : pop);
      H.snowfall.push(0);
      H.weather_code.push(mm > 2 ? 63 : mm > 0 ? 61 : S.cloud > 70 ? 3 : S.cloud > 30 ? 2 : 0);
      H.cloud_cover.push(rain ? 100 : S.cloud);
      H.wind_speed_10m.push(+wind.toFixed(1));
      H.wind_gusts_10m.push(+(wind * (S.gust || 1.6)).toFixed(1));
      soil6 += (t - soil6) * 0.03;
      soil18 += (t - soil18) * 0.008;
      H.soil_temperature_6cm.push(+soil6.toFixed(1));
      H.soil_temperature_18cm.push(+soil18.toFixed(1));
      H.et0_fao_evapotranspiration.push(light ? +(0.05 + 0.18 * vpd * Math.sin(Math.PI * (h - 7) / 12)).toFixed(2) : 0);
    }
  }
  return {
    latitude: 39.96, longitude: -83.0, generationtime_ms: 1.2, utc_offset_seconds: offset,
    timezone: tz, timezone_abbreviation: 'EDT', elevation: 240,
    hourly_units: {}, hourly: H, daily_units: {}, daily,
  };
}
