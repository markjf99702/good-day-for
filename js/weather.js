// Forecasts and place search from Open-Meteo (free, no key, CC BY 4.0).

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const REVERSE = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

export const HOURLY = [
  'temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'precipitation', 'precipitation_probability',
  'snowfall', 'weather_code', 'cloud_cover', 'wind_speed_10m', 'wind_gusts_10m',
  'soil_temperature_6cm', 'soil_temperature_18cm', 'vapour_pressure_deficit', 'et0_fao_evapotranspiration',
];

export const PAST_DAYS = 7;
export const FORECAST_DAYS = 16;

export function forecastUrl(lat, lon) {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lon.toFixed(4),
    hourly: HOURLY.join(','), daily: 'sunrise,sunset',
    past_days: PAST_DAYS, forecast_days: FORECAST_DAYS, timezone: 'auto',
  });
  return `${FORECAST}?${q}`;
}

// Open-Meteo's response → the flat shape the engine reads.
export function normalize(raw) {
  const h = raw.hourly, d = raw.daily;
  return {
    tz: raw.timezone,
    utcOffset: raw.utc_offset_seconds || 0,
    time: h.time,
    temp: h.temperature_2m,
    rh: h.relative_humidity_2m,
    dew: h.dew_point_2m,
    precip: h.precipitation,
    pop: h.precipitation_probability || [],
    snow: h.snowfall || [],
    code: h.weather_code || [],
    cloud: h.cloud_cover || [],
    wind: h.wind_speed_10m,
    gust: h.wind_gusts_10m || [],
    soil6: h.soil_temperature_6cm || [],
    soil18: h.soil_temperature_18cm || [],
    vpd: h.vapour_pressure_deficit || [],
    et0: h.et0_fao_evapotranspiration || [],
    days: d.time.map((date, i) => ({ date, sunrise: d.sunrise[i], sunset: d.sunset[i] })),
  };
}

export async function fetchForecast(place, { signal } = {}) {
  const res = await fetch(forecastUrl(place.lat, place.lon), { signal });
  if (!res.ok) {
    let reason = '';
    try { reason = (await res.json()).reason || ''; } catch { /* not JSON */ }
    throw new Error(`The weather service said no (${res.status}${reason ? `: ${reason}` : ''}).`);
  }
  const raw = await res.json();
  if (!raw.hourly?.time?.length) throw new Error('The weather service sent back an empty forecast.');
  return { ...normalize(raw), fetchedAt: Date.now(), key: placeKey(place) };
}

export const placeKey = p => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;

export function placeLabel(p) {
  const parts = [p.name];
  if (p.admin && p.admin !== p.name) parts.push(p.admin);
  else if (p.country && p.country !== p.name) parts.push(p.country);
  return parts.join(', ');
}

export async function searchPlaces(query, { signal } = {}) {
  const q = query.trim();
  if (q.length < 2) return [];
  const go = async extra => {
    const res = await fetch(`${GEOCODE}?${new URLSearchParams({ name: q, count: 8, language: 'en', format: 'json', ...extra })}`, { signal });
    if (!res.ok) throw new Error('Place search is not answering right now.');
    return (await res.json()).results || [];
  };
  let results = await go({});
  // A bare 5-digit number is most likely a US ZIP code.
  if (!results.length && /^\d{5}$/.test(q)) results = await go({ countryCode: 'US' });
  return results.map(r => ({
    name: r.name, admin: r.admin1 || '', country: r.country || '', cc: r.country_code || '',
    lat: r.latitude, lon: r.longitude,
  }));
}

export function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser can’t share its location.'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      e => reject(new Error(e.code === 1 ? 'Location permission was turned down.' : 'Couldn’t get a location fix.')),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 },
    );
  });
}

// Best-effort name for coordinates; falls back to "My location".
export async function nameFor(lat, lon) {
  try {
    const res = await fetch(`${REVERSE}?${new URLSearchParams({ latitude: lat, longitude: lon, localityLanguage: 'en' })}`);
    const j = await res.json();
    const name = j.city || j.locality;
    if (name) return { name, admin: j.principalSubdivision || '', country: j.countryName || '', cc: j.countryCode || '' };
  } catch { /* fine */ }
  return { name: 'My location', admin: '', country: '', cc: '' };
}
