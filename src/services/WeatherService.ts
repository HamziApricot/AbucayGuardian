/**
 * WeatherService.ts
 *
 * Full-featured free weather data service for AbucayGuardian 3D Map:
 * 1. RainViewer Weather Maps API - Live radar and nowcast XYZ raster tiles (0 API key required).
 * 2. Open-Meteo API - Hourly forecasts, rain probability, wind vectors (U, V) (0 API key required).
 * 3. In-memory caching and 1-decimal coordinate rounding (~11 km resolution) for low latency and zero unnecessary network traffic.
 */

export interface RadarFrame {
  time: number; // Unix timestamp in seconds
  path: string; // e.g. "/v2/radar/..."
}

export interface RainViewerData {
  host: string;
  past: RadarFrame[];
  nowcast: RadarFrame[];
  frames: RadarFrame[];
  fetchedAt: number;
}

export interface HourlyForecast {
  time: string[];
  temperature_2m: number[];
  precipitation_probability: number[];
  rain: number[];
  wind_speed_10m: number[];
  wind_direction_10m: number[];
  weather_code: number[];
}

export interface PointForecast {
  latitude: number;
  longitude: number;
  hourly: HourlyForecast;
  fetchedAt: number;
}

export interface WeatherConditionInfo {
  label: string;
  icon: string; // Ionicons glyph name
  severity: 'normal' | 'caution' | 'alert';
  advisory?: string;
  color: string;
}

// Memory caches
let cachedRainViewer: RainViewerData | null = null;
const forecastCache = new Map<string, PointForecast>();

const RAINVIEWER_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes
const FORECAST_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Converts meteorological wind speed & direction (degrees clockwise from North)
 * into mathematical (U, V) vector components.
 * U = East-West component (positive eastward)
 * V = North-South component (positive northward)
 */
export function windToUV(speedMs: number, directionDeg: number): { u: number; v: number } {
  const rad = (directionDeg * Math.PI) / 180;
  const u = -speedMs * Math.sin(rad); // East-West component
  const v = -speedMs * Math.cos(rad); // North-South component
  return { u, v };
}

/**
 * Fetches RainViewer public radar manifest containing timestamps for
 * past 2 hours of radar frames plus short-term nowcast forecast frames.
 */
export async function fetchRainViewerFrames(): Promise<RainViewerData> {
  const now = Date.now();
  if (cachedRainViewer && now - cachedRainViewer.fetchedAt < RAINVIEWER_CACHE_TTL_MS) {
    return cachedRainViewer;
  }

  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    if (!res.ok) {
      throw new Error(`RainViewer request failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    const host: string = data.host || 'https://tilecache.rainviewer.com';
    const past: RadarFrame[] = data.radar?.past ?? [];
    const nowcast: RadarFrame[] = data.radar?.nowcast ?? [];
    const frames: RadarFrame[] = [...past, ...nowcast];

    const result: RainViewerData = {
      host,
      past,
      nowcast,
      frames,
      fetchedAt: now,
    };

    cachedRainViewer = result;
    return result;
  } catch (err) {
    console.warn('[WeatherService] fetchRainViewerFrames failed, using fallback:', err);
    if (cachedRainViewer) {
      return cachedRainViewer;
    }
    return {
      host: 'https://tilecache.rainviewer.com',
      past: [],
      nowcast: [],
      frames: [],
      fetchedAt: 0,
    };
  }
}

/**
 * Builds the XYZ tile URL template for RainViewer raster layers.
 * Pattern: {host}{path}/{tileSize}/{z}/{x}/{y}/{colorScheme}/{smooth}_{snow}.png
 * colorScheme 2 is the universal radar color palette (green -> yellow -> red -> purple).
 */
export function getRainViewerTileUrl(
  host: string,
  path: string,
  tileSize: 256 | 512 = 512,
  colorScheme: number = 2,
  smooth: 0 | 1 = 1,
  snow: 0 | 1 = 1
): string {
  // Return URL with {z}/{x}/{y} literal parameters for MapLibre / MapView tile engines
  return `${host}${path}/${tileSize}/{z}/{x}/{y}/${colorScheme}/${smooth}_${snow}.png`;
}

/**
 * Fetches point forecast for a coordinate from Open-Meteo.
 * Coordinates are rounded to 1 decimal place (~11 km resolution) to maximize cache hits
 * and prevent redundant API queries while tracked markers move.
 */
export async function fetchPointForecast(lat: number, lon: number): Promise<PointForecast | null> {
  const roundedLat = Number(lat.toFixed(1));
  const roundedLon = Number(lon.toFixed(1));
  const cacheKey = `${roundedLat}_${roundedLon}`;
  const now = Date.now();

  const cached = forecastCache.get(cacheKey);
  if (cached && now - cached.fetchedAt < FORECAST_CACHE_TTL_MS) {
    return cached;
  }

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${roundedLat}&longitude=${roundedLon}` +
      `&hourly=temperature_2m,precipitation_probability,rain,wind_speed_10m,wind_direction_10m,weather_code` +
      `&forecast_days=2&timezone=auto`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Open-Meteo request failed: HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data.hourly) {
      throw new Error('Invalid Open-Meteo payload');
    }

    const forecast: PointForecast = {
      latitude: roundedLat,
      longitude: roundedLon,
      hourly: data.hourly,
      fetchedAt: now,
    };

    forecastCache.set(cacheKey, forecast);
    return forecast;
  } catch (err) {
    console.warn('[WeatherService] fetchPointForecast failed:', err);
    return cached || null;
  }
}

/**
 * Maps WMO Weather Interpretation Codes (0-99) to clean labels, icons, and safety advisories.
 */
export function getWeatherCondition(weatherCode: number): WeatherConditionInfo {
  switch (weatherCode) {
    case 0:
      return {
        label: 'Clear Sky',
        icon: 'sunny',
        severity: 'normal',
        color: '#F59E0B',
      };
    case 1:
      return {
        label: 'Mainly Clear',
        icon: 'partly-sunny',
        severity: 'normal',
        color: '#F59E0B',
      };
    case 2:
      return {
        label: 'Partly Cloudy',
        icon: 'partly-sunny',
        severity: 'normal',
        color: '#60A5FA',
      };
    case 3:
      return {
        label: 'Overcast',
        icon: 'cloudy',
        severity: 'normal',
        color: '#94A3B8',
      };
    case 45:
    case 48:
      return {
        label: 'Foggy / Low Visibility',
        icon: 'cloud',
        severity: 'caution',
        advisory: 'Reduced visibility. Exercise caution when traveling.',
        color: '#94A3B8',
      };
    case 51:
    case 53:
    case 55:
      return {
        label: 'Light Drizzle',
        icon: 'rainy',
        severity: 'normal',
        color: '#38BDF8',
      };
    case 61:
      return {
        label: 'Slight Rain',
        icon: 'rainy',
        severity: 'normal',
        color: '#38BDF8',
      };
    case 63:
      return {
        label: 'Moderate Rain',
        icon: 'rainy',
        severity: 'caution',
        advisory: 'Slippery roads and localized water puddles.',
        color: '#2563EB',
      };
    case 65:
      return {
        label: 'Heavy Rain',
        icon: 'thunderstorm',
        severity: 'alert',
        advisory: 'Severe downpour. Monitor local flood-prone barangays.',
        color: '#DC2626',
      };
    case 80:
      return {
        label: 'Rain Showers',
        icon: 'rainy',
        severity: 'normal',
        color: '#38BDF8',
      };
    case 81:
    case 82:
      return {
        label: 'Violent Rain Showers',
        icon: 'thunderstorm',
        severity: 'alert',
        advisory: 'Intense precipitation. Stay sheltered in sturdy structures.',
        color: '#DC2626',
      };
    case 95:
      return {
        label: 'Thunderstorm',
        icon: 'thunderstorm',
        severity: 'alert',
        advisory: 'Lightning & gusty winds. Avoid open spaces and tall trees.',
        color: '#EF4444',
      };
    case 96:
    case 99:
      return {
        label: 'Severe Thunderstorm & Hail',
        icon: 'thunderstorm',
        severity: 'alert',
        advisory: 'Dangerous storm conditions. Seek indoor shelter immediately.',
        color: '#991B1B',
      };
    default:
      return {
        label: 'Variable Weather',
        icon: 'cloud',
        severity: 'normal',
        color: '#64748B',
      };
  }
}

/**
 * Finds the closest hourly forecast index matching the current time.
 */
export function getCurrentHourIndex(hourly: HourlyForecast): number {
  if (!hourly.time || hourly.time.length === 0) return 0;
  const now = new Date();
  const currentIsoPrefix = now.toISOString().slice(0, 13); // "YYYY-MM-DDTHH"

  const exactIdx = hourly.time.findIndex((t) => t.startsWith(currentIsoPrefix));
  if (exactIdx >= 0) return exactIdx;

  // Fallback: find nearest timestamp
  const nowEpoch = now.getTime();
  let closestIdx = 0;
  let minDiff = Infinity;
  for (let i = 0; i < hourly.time.length; i++) {
    const diff = Math.abs(new Date(hourly.time[i]).getTime() - nowEpoch);
    if (diff < minDiff) {
      minDiff = diff;
      closestIdx = i;
    }
  }
  return closestIdx;
}

/**
 * Formats a Unix timestamp into readable time and relative badge (e.g. "2:30 PM", "-15m", "Now")
 */
export function formatRadarFrameLabel(timestampSec: number, isNowcast: boolean): { timeStr: string; tag: string } {
  const date = new Date(timestampSec * 1000);
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const diffMinutes = Math.round((timestampSec * 1000 - Date.now()) / 60000);

  let tag = 'PAST';
  if (isNowcast) {
    tag = `+${Math.max(5, diffMinutes)}m FORECAST`;
  } else if (Math.abs(diffMinutes) <= 8) {
    tag = 'LIVE';
  } else {
    tag = `${diffMinutes}m`;
  }

  return { timeStr, tag };
}

/**
 * Formats hourly ISO timestamp (e.g., "2026-11-22T14:00") into friendly display text.
 */
export function formatHourlyTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return isoStr;
  }
}

/**
 * Converts degrees clockwise from North into a 16-point cardinal direction string.
 */
export function degreesToCardinal(deg: number): string {
  const directions = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
  ];
  const normalized = ((deg % 360) + 360) % 360;
  const index = Math.round(normalized / 22.5) % 16;
  return directions[index];
}
