export interface ApiExecutor {
  /** Simple single-URL APIs: build URL from params, then formatResponse parses the JSON. */
  buildUrl?: (params: Record<string, string>) => string;
  formatResponse?: (data: unknown) => string;
  /** Multi-step APIs: full async execute replaces buildUrl+formatResponse. */
  execute?: (params: Record<string, string>) => Promise<string>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Common timezone names/abbreviations → IANA timezone identifiers */
export const TIMEZONE_ALIASES: Record<string, string> = {
  // US zones
  'eastern': 'America/New_York', 'est': 'America/New_York', 'et': 'America/New_York',
  'eastern time': 'America/New_York', 'eastern standard': 'America/New_York',
  'central': 'America/Chicago', 'cst': 'America/Chicago', 'ct': 'America/Chicago',
  'central time': 'America/Chicago', 'central standard': 'America/Chicago',
  'mountain': 'America/Denver', 'mst': 'America/Denver', 'mt': 'America/Denver',
  'mountain time': 'America/Denver', 'mountain standard': 'America/Denver',
  'pacific': 'America/Los_Angeles', 'pst': 'America/Los_Angeles', 'pt': 'America/Los_Angeles',
  'pacific time': 'America/Los_Angeles', 'pacific standard': 'America/Los_Angeles',
  'alaska': 'America/Anchorage', 'akst': 'America/Anchorage',
  'hawaii': 'Pacific/Honolulu', 'hst': 'Pacific/Honolulu',
  // Common international
  'utc': 'UTC', 'gmt': 'Europe/London',
  'london': 'Europe/London', 'uk': 'Europe/London', 'bst': 'Europe/London',
  'paris': 'Europe/Paris', 'cet': 'Europe/Paris', 'berlin': 'Europe/Berlin',
  'tokyo': 'Asia/Tokyo', 'jst': 'Asia/Tokyo', 'japan': 'Asia/Tokyo',
  'beijing': 'Asia/Shanghai', 'shanghai': 'Asia/Shanghai', 'china': 'Asia/Shanghai',
  'sydney': 'Australia/Sydney', 'aest': 'Australia/Sydney',
  'mumbai': 'Asia/Kolkata', 'india': 'Asia/Kolkata', 'ist': 'Asia/Kolkata',
  'dubai': 'Asia/Dubai', 'singapore': 'Asia/Singapore', 'sgt': 'Asia/Singapore',
  'hong kong': 'Asia/Hong_Kong', 'seoul': 'Asia/Seoul', 'kst': 'Asia/Seoul',
  'moscow': 'Europe/Moscow', 'msk': 'Europe/Moscow',
  'sao paulo': 'America/Sao_Paulo', 'brazil': 'America/Sao_Paulo',
  'toronto': 'America/Toronto', 'mexico city': 'America/Mexico_City',
};

export const API_EXECUTORS: Record<string, ApiExecutor> = {
  weather: {
    // Open-Meteo: geocode city name → fetch current weather by lat/lon
    // Supports "City, State" and "City, ST" formats for US cities
    execute: async (p) => {
      const raw = (p.city || 'New York').trim();

      // Parse "City, State" or "City State" — extract qualifier (state/country)
      let cityName = raw;
      let qualifier = '';
      const commaMatch = raw.match(/^(.+?),\s*(.+)$/);
      if (commaMatch) {
        cityName = commaMatch[1].trim();
        qualifier = commaMatch[2].trim();
      } else {
        // No comma — check if the last word(s) are a US state name or abbreviation
        const words = raw.split(/\s+/);
        if (words.length >= 2) {
          const lastWord = words[words.length - 1];
          const lastTwo = words.length >= 3 ? words.slice(-2).join(' ') : '';
          // Check last two words first (e.g. "New York", "North Carolina")
          if (lastTwo && US_STATE_NAMES.has(lastTwo.toLowerCase())) {
            cityName = words.slice(0, -2).join(' ');
            qualifier = lastTwo;
          // Check last word as abbreviation (e.g. "OH") or single-word state (e.g. "Ohio")
          } else if (US_STATE_ABBREVS[lastWord.toUpperCase()] || US_STATE_NAMES.has(lastWord.toLowerCase())) {
            cityName = words.slice(0, -1).join(' ');
            qualifier = lastWord;
          }
        }
      }

      // Resolve US state abbreviations to full names (Open-Meteo admin1 uses full names)
      const resolvedQualifier = US_STATE_ABBREVS[qualifier.toUpperCase()] || qualifier;

      // Step 1: geocode city → lat/lon (fetch multiple results to filter)
      const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=10&language=en&format=json`,
      );
      if (!geoRes.ok) throw new Error(`Geocoding failed: HTTP ${geoRes.status}`);
      const geoData = await geoRes.json();
      const results = geoData?.results;
      if (!results || results.length === 0) return `Location not found: ${raw}`;

      // Step 1b: if a qualifier was given, try to match by state/region/country
      let loc = results[0]; // default to top result
      if (resolvedQualifier) {
        const q = resolvedQualifier.toLowerCase();
        const match = results.find((r: any) =>
          (r.admin1 && r.admin1.toLowerCase() === q) ||
          (r.admin2 && r.admin2.toLowerCase() === q) ||
          (r.country && r.country.toLowerCase() === q) ||
          (r.country_code && r.country_code.toLowerCase() === q),
        );
        if (match) loc = match;
      }

      const { latitude, longitude, name, admin1, country_code } = loc;
      const locationLabel = admin1 ? `${name}, ${admin1} (${country_code})` : `${name} (${country_code})`;

      // Step 2: fetch current weather
      const wxRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`,
      );
      if (!wxRes.ok) throw new Error(`Weather API failed: HTTP ${wxRes.status}`);
      const wx = await wxRes.json();
      const c = wx?.current;
      if (!c) return 'No weather data returned.';

      const wmo = WMO_CODES[c.weather_code] ?? `code ${c.weather_code}`;
      return `${locationLabel}: ${c.temperature_2m}F, feels like ${c.apparent_temperature}F, ${wmo}, humidity ${c.relative_humidity_2m}%, wind ${c.wind_speed_10m}mph ${degToCompass(c.wind_direction_10m)}, pressure ${c.surface_pressure}hPa`;
    },
  },

  crypto: {
    // Search by name/symbol first, then fetch ticker data
    execute: async (p) => {
      const query = (p.coin || 'bitcoin').trim().toLowerCase();
      // Step 1: search for the coin to get the slug
      const searchRes = await fetch(
        `https://api.coinpaprika.com/v1/search?q=${encodeURIComponent(query)}&c=currencies&limit=1`,
      );
      if (!searchRes.ok) throw new Error(`Crypto search failed: HTTP ${searchRes.status}`);
      const searchData = await searchRes.json();
      const coin = searchData?.currencies?.[0];
      if (!coin) return `Coin not found: ${query}`;

      // Step 2: fetch ticker by resolved id
      const tickerRes = await fetch(
        `https://api.coinpaprika.com/v1/tickers/${coin.id}`,
      );
      if (!tickerRes.ok) throw new Error(`Crypto ticker failed: HTTP ${tickerRes.status}`);
      const data = await tickerRes.json();
      const q = data.quotes?.USD;
      if (!q) return `No price data for ${data.name}`;
      const price = q.price != null ? formatCryptoPrice(q.price) : '?';
      return `${data.name} (${data.symbol}): $${price}, 24h: ${q.percent_change_24h?.toFixed(2) ?? '?'}%, vol: $${q.volume_24h ? (q.volume_24h / 1e6).toFixed(1) + 'M' : '?'}, mcap: $${q.market_cap ? (q.market_cap / 1e9).toFixed(1) + 'B' : '?'}`;
    },
  },

  exchange: {
    execute: async (p) => {
      const from = (p.from || 'USD').trim().toUpperCase();
      const to = (p.to || 'EUR').trim().toUpperCase();
      const amount = parseFloat(p.amount) || 1;
      const res = await fetch(
        `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}&amount=${amount}`,
      );
      if (!res.ok) throw new Error(`Exchange API failed: HTTP ${res.status}`);
      const data = await res.json();
      if (!data?.rates) return `Could not fetch rate for ${from} → ${to}`;
      const entries = Object.entries(data.rates);
      if (entries.length === 0) return 'No rate found.';
      const [symbol, converted] = entries[0];
      const rate = (converted as number) / amount;
      if (amount === 1) {
        return `1 ${data.base} = ${converted} ${symbol} (${data.date})`;
      }
      return `${amount} ${data.base} = ${converted} ${symbol} (rate: ${rate.toFixed(4)}, ${data.date})`;
    },
  },

  time: {
    execute: async (p) => {
      const raw = (p.timezone || 'America/New_York').trim();
      const tz = TIMEZONE_ALIASES[raw.toLowerCase()] ?? raw;
      try {
        const now = new Date();
        const date = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });
        const time = now.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const offset = now.toLocaleString('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).split(' ').pop();
        return `${tz}: ${date}, ${time} (${offset})`;
      } catch {
        return `Invalid timezone: "${raw}". Try: Eastern, Pacific, America/New_York, Europe/London, Asia/Tokyo, etc.`;
      }
    },
  },

  dictionary: {
    buildUrl: (p) =>
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(p.word || 'hello')}`,
    formatResponse: (data: any) => {
      if (!Array.isArray(data) || data.length === 0) return 'Word not found.';
      const entry = data[0];
      const meaning = entry.meanings?.[0];
      const def = meaning?.definitions?.[0]?.definition ?? 'No definition.';
      const pos = meaning?.partOfSpeech ?? '';
      const phonetic = entry.phonetic ?? '';
      return `${entry.word} ${phonetic} (${pos}): ${def}`;
    },
  },

  wikipedia: {
    buildUrl: (p) =>
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(p.topic || 'Wikipedia')}`,
    formatResponse: (data: any) => {
      if (!data?.extract) return 'No article found.';
      const extract = data.extract.length > 300
        ? data.extract.slice(0, 297) + '...'
        : data.extract;
      return `${data.title}: ${extract}`;
    },
  },

  country: {
    buildUrl: (p) =>
      `https://restcountries.com/v3.1/name/${encodeURIComponent(p.country || 'Japan')}?fields=name,capital,population,currencies,region,area,timezones,languages`,
    formatResponse: (data: any) => {
      if (!Array.isArray(data) || data.length === 0) return 'Country not found.';
      const c = data[0];
      const curr = c.currencies
        ? Object.values(c.currencies).map((v: any) => v.name).join(', ')
        : '?';
      const langs = c.languages
        ? Object.values(c.languages).join(', ')
        : '?';
      const area = c.area ? `${c.area.toLocaleString()} km²` : '?';
      return `${c.name?.common ?? '?'}: Capital: ${c.capital?.[0] ?? '?'}, Pop: ${(c.population ?? 0).toLocaleString()}, Area: ${area}, Region: ${c.region ?? '?'}, Currency: ${curr}, Languages: ${langs}`;
    },
  },

  ip: {
    execute: async (p) => {
      const ip = (p.ip || '').trim();
      if (!ip) return 'No IP address provided. Wire an IP address to the input.';
      const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
      if (!res.ok) throw new Error(`IP lookup failed: HTTP ${res.status}`);
      const data = await res.json();
      if (data?.error) return `IP lookup failed: ${data.reason ?? 'unknown'}`;
      return `${data.ip}: ${data.city}, ${data.region} ${data.country_name} (${data.latitude}, ${data.longitude}), ISP: ${data.org ?? '?'}, timezone: ${data.timezone ?? '?'}`;
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** US state abbreviations → full names for geocoding match */
export const US_STATE_ABBREVS: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
};

/** Set of all US state full names (lowercase) for space-separated parsing */
export const US_STATE_NAMES = new Set(Object.values(US_STATE_ABBREVS).map((n) => n.toLowerCase()));

/** WMO weather interpretation codes → human labels */
export const WMO_CODES: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  66: 'Light freezing rain', 67: 'Heavy freezing rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
  77: 'Snow grains', 80: 'Slight rain showers', 81: 'Moderate rain showers',
  82: 'Violent rain showers', 85: 'Slight snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm w/ slight hail', 99: 'Thunderstorm w/ heavy hail',
};

/** Format crypto price with appropriate decimal places for the magnitude */
export function formatCryptoPrice(price: number): string {
  if (price >= 1) return price.toFixed(2);
  if (price === 0) return '0';
  // Count leading zeros after decimal point, then show 2 significant digits
  const s = price.toFixed(20);
  const match = s.match(/^0\.(0*)/);
  const leadingZeros = match ? match[1].length : 0;
  return price.toFixed(leadingZeros + 2);
}

export function degToCompass(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}
