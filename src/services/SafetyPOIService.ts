import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'OFFLINE_SAFETY_POIS_GEOJSON';
const STORAGE_TIME_KEY = 'OFFLINE_SAFETY_POIS_TIMESTAMP';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Primary + Fallback Overpass API servers
const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export type SafetyCategory = 'school' | 'hospital' | 'police' | 'fire_station' | 'evacuation';

export interface SafetyPOIProperties {
  id: string;
  name: string;
  category: SafetyCategory;
  phone?: string | null;
}

export async function fetchAndCacheSafetyPOIs(
  bbox: [number, number, number, number],
  forceRefresh = false
): Promise<GeoJSON.FeatureCollection> {
  // 1. Check local cache first so hot-reloads don't trigger Overpass rate limits
  if (!forceRefresh) {
    const [cachedData, cachedTime] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(STORAGE_TIME_KEY),
    ]);

    if (cachedData && cachedTime) {
      const age = Date.now() - Number(cachedTime);
      if (age < CACHE_TTL_MS) {
        return JSON.parse(cachedData);
      }
    }
  }

  const [south, west, north, east] = bbox;
  const query = `[out:json][timeout:25];(nwr["amenity"~"^(school|college|university|hospital|clinic|police|fire_station)$"](${south},${west},${north},${east});nwr["social_facility"="shelter"](${south},${west},${north},${east});nwr["emergency:social_facility"="shelter"](${south},${west},${north},${east});nwr["emergency"="assembly_point"](${south},${west},${north},${east}););out center;`;

  // 2. Try Overpass servers with required User-Agent & Accept headers
  for (const serverUrl of OVERPASS_SERVERS) {
    try {
      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Accept': 'application/json',
          // REQUIRED by Overpass API to prevent HTTP 406 Not Acceptable:
          'User-Agent': 'FamilySafetyTrackerApp/1.0 (https://yourdomain.com; support@yourdomain.com)',
        },
        body: `data=${encodeURIComponent(query)}`,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${serverUrl}`);
      }

      const data = await response.json();

      const features: GeoJSON.Feature[] = (data.elements || [])
        .map((el: any) => {
          const lat = el.lat ?? el.center?.lat;
          const lon = el.lon ?? el.center?.lon;
          if (!lat || !lon) return null;

          const tags = el.tags || {};
          let category: SafetyCategory = 'school';

          if (
            tags['social_facility'] === 'shelter' ||
            tags['emergency:social_facility'] === 'shelter' ||
            tags['emergency'] === 'assembly_point'
          ) {
            category = 'evacuation';
          } else if (tags.amenity === 'hospital' || tags.amenity === 'clinic') {
            category = 'hospital';
          } else if (tags.amenity === 'police') {
            category = 'police';
          } else if (tags.amenity === 'fire_station') {
            category = 'fire_station';
          }

          return {
            type: 'Feature',
            id: `${el.type}-${el.id}`,
            properties: {
              id: `${el.type}-${el.id}`,
              name: tags.name || formatDefaultName(category),
              category,
              phone: tags['emergency:phone'] || tags['phone'] || tags['contact:phone'] || null,
            },
            geometry: {
              type: 'Point',
              coordinates: [lon, lat],
            },
          };
        })
        .filter((f: any): f is GeoJSON.Feature => f !== null);

      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features,
      };

      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(geojson)),
        AsyncStorage.setItem(STORAGE_TIME_KEY, String(Date.now())),
      ]);

      return geojson;
    } catch (error) {
      console.warn(`[SafetyPOI] Mirror failed (${serverUrl}):`, error);
    }
  }

  // 3. Fallback to cached POIs if completely offline
  const cached = await AsyncStorage.getItem(STORAGE_KEY);
  return cached
    ? JSON.parse(cached)
    : { type: 'FeatureCollection', features: [] };
}

function formatDefaultName(category: SafetyCategory): string {
  switch (category) {
    case 'evacuation':
      return 'Evacuation Center';
    case 'hospital':
      return 'Medical Facility';
    case 'police':
      return 'Police Station';
    case 'fire_station':
      return 'Fire Station';
    default:
      return 'School';
  }
}
