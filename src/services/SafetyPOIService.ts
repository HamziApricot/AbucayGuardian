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
  type?: string;
  address?: string;
}

/**
 * Designated Abucay Municipal Safety Locations & Evacuation Centers
 * Configured with exact verified GPS coordinates:
 * - Wawa Elementary School: 14.7215087495467, 120.54105847276169 (School/Evacuation)
 * - Tomas Pinpin Memorial Elementary School: 14.71863259956645, 120.53556411274283 (School/Evacuation)
 * - Mabatang Elementary School: 14.742627638669035, 120.53646217059547 (School/Evacuation)
 * - Pelagio Rubiano Elementary School: 14.746785, 120.5283621 (School/Evacuation)
 * Plus municipal police, fire, and medical command centers.
 */
export const DESIGNATED_ABUCAY_POIS: GeoJSON.Feature[] = [
  {
    type: 'Feature',
    id: 'abucay-evac-wawa',
    properties: {
      id: 'abucay-evac-wawa',
      name: 'Wawa Elementary School',
      category: 'evacuation',
      type: 'School / Evacuation Center',
      address: 'Brgy. Wawa, Abucay, Bataan',
      phone: '(047) 237-0808',
    },
    geometry: {
      type: 'Point',
      coordinates: [120.54105847276169, 14.7215087495467],
    },
  },
  {
    type: 'Feature',
    id: 'abucay-evac-tomas-pinpin',
    properties: {
      id: 'abucay-evac-tomas-pinpin',
      name: 'Tomas Pinpin Memorial Elementary School',
      category: 'evacuation',
      type: 'School / Evacuation Center',
      address: 'Poblacion, Abucay, Bataan',
      phone: '(047) 237-0808',
    },
    geometry: {
      type: 'Point',
      coordinates: [120.53556411274283, 14.71863259956645],
    },
  },
  {
    type: 'Feature',
    id: 'abucay-evac-mabatang',
    properties: {
      id: 'abucay-evac-mabatang',
      name: 'Mabatang Elementary School',
      category: 'evacuation',
      type: 'School / Evacuation Center',
      address: 'Brgy. Mabatang, Abucay, Bataan',
      phone: '(047) 237-0808',
    },
    geometry: {
      type: 'Point',
      coordinates: [120.53646217059547, 14.742627638669035],
    },
  },
  {
    type: 'Feature',
    id: 'abucay-evac-pelagio-rubiano',
    properties: {
      id: 'abucay-evac-pelagio-rubiano',
      name: 'Pelagio Rubiano Elementary School',
      category: 'evacuation',
      type: 'School / Evacuation Center',
      address: 'Brgy. Salian / Bangkal, Abucay, Bataan',
      phone: '(047) 237-0808',
    },
    geometry: {
      type: 'Point',
      coordinates: [120.5283621, 14.746785],
    },
  },
  {
    type: 'Feature',
    id: 'abucay-municipal-police',
    properties: {
      id: 'abucay-municipal-police',
      name: 'Abucay Municipal Police Station',
      category: 'police',
      type: 'Police Headquarters',
      address: 'Roman Superhighway / Centro, Abucay, Bataan',
      phone: '0998-598-5182',
    },
    geometry: {
      type: 'Point',
      coordinates: [120.5330, 14.7210],
    },
  },
  {
    type: 'Feature',
    id: 'abucay-fire-station',
    properties: {
      id: 'abucay-fire-station',
      name: 'Abucay Bureau of Fire Protection',
      category: 'fire_station',
      type: 'Fire & Rescue Station',
      address: 'Poblacion, Abucay, Bataan',
      phone: '0933-820-2210',
    },
    geometry: {
      type: 'Point',
      coordinates: [120.5338, 14.7212],
    },
  },
  {
    type: 'Feature',
    id: 'abucay-rural-health-unit',
    properties: {
      id: 'abucay-rural-health-unit',
      name: 'Abucay Rural Health Unit (RHU)',
      category: 'hospital',
      type: 'Primary Emergency Medical Facility',
      address: 'Poblacion, Abucay, Bataan',
      phone: '(047) 237-1011',
    },
    geometry: {
      type: 'Point',
      coordinates: [120.5332, 14.7214],
    },
  },
];

export const INITIAL_SAFETY_GEOJSON: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: DESIGNATED_ABUCAY_POIS,
};

/**
 * Merges dynamic OpenStreetMap features with verified designated Abucay emergency locations,
 * ensuring designated evacuation centers are always present and never duplicated.
 */
export function mergeWithDesignatedPOIs(features: GeoJSON.Feature[]): GeoJSON.Feature[] {
  const merged: GeoJSON.Feature[] = [...DESIGNATED_ABUCAY_POIS];
  const existingIds = new Set(DESIGNATED_ABUCAY_POIS.map((p) => p.id));
  const designatedNames = new Set(
    DESIGNATED_ABUCAY_POIS.map((p: any) =>
      p.properties?.name?.toLowerCase().replace(/\s+/g, ' ').trim()
    )
  );

  for (const f of features) {
    const fProps = (f as any).properties;
    const fName = fProps?.name?.toLowerCase().replace(/\s+/g, ' ').trim();
    if (existingIds.has(f.id) || (fName && designatedNames.has(fName))) {
      continue;
    }
    merged.push(f);
  }
  return merged;
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
        const parsed = JSON.parse(cachedData);
        return {
          type: 'FeatureCollection',
          features: mergeWithDesignatedPOIs(parsed.features || []),
        };
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
          'User-Agent': 'FamilySafetyTrackerApp/1.0 (https://yourdomain.com; support@yourdomain.com)',
        },
        body: `data=${encodeURIComponent(query)}`,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${serverUrl}`);
      }

      const data = await response.json();

      const rawFeatures: GeoJSON.Feature[] = (data.elements || [])
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

      const mergedFeatures = mergeWithDesignatedPOIs(rawFeatures);
      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: mergedFeatures,
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

  // 3. Fallback to cached POIs or designated Abucay points if completely offline
  const cached = await AsyncStorage.getItem(STORAGE_KEY);
  if (cached) {
    const parsed = JSON.parse(cached);
    return {
      type: 'FeatureCollection',
      features: mergeWithDesignatedPOIs(parsed.features || []),
    };
  }

  return INITIAL_SAFETY_GEOJSON;
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
