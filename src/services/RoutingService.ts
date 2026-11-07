import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

export interface TurnByTurnStep {
  id: string;
  instruction: string;
  modifier?: string; // 'left' | 'right' | 'slight right' | 'slight left' | 'straight' | 'uturn' | 'arrive' | 'depart';
  type: string; // 'turn' | 'depart' | 'arrive' | 'new name' | 'roundabout' | etc.
  distance: number; // meters
  duration: number; // seconds
  streetName: string;
  location: { latitude: number; longitude: number };
}

export interface NavigationRoute {
  from: { latitude: number; longitude: number };
  to: { latitude: number; longitude: number };
  label: string;
  coordinates: { latitude: number; longitude: number }[];
  distance: number; // meters
  duration: number; // seconds
  steps: TurnByTurnStep[];
  isOffline: boolean;
  cachedAt?: string;
  targetMemberId?: string;
}

const ROUTE_CACHE_PREFIX = 'GUARDIAN_ROUTE_CACHE_';

/**
 * Calculates distance in meters between two lat/lng coordinates (Haversine Formula).
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

/**
 * Calculates initial bearing in degrees (0 - 360) from coord 1 to coord 2.
 */
export function calculateBearingDegrees(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = Math.atan2(y, x);

  return Math.round(((theta * 180) / Math.PI + 360) % 360);
}

/**
 * Converts bearing degrees into 8-point compass cardinal direction.
 */
export function getCompassDirection(bearing: number): string {
  const directions = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West'];
  const index = Math.round(bearing / 45) % 8;
  return directions[index];
}

/**
 * Formats distance into clean human-readable text (e.g. "350 m", "2.4 km").
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Formats duration in seconds into human-readable text (e.g. "4 min", "1 hr 15 min").
 */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${Math.max(1, minutes)} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return `${hours} hr${hours > 1 ? 's' : ''} ${remMin} min`;
}

/**
 * Converts OSRM step maneuver into human-friendly speech/instruction text.
 */
function formatStepInstruction(
  type: string,
  modifier: string | undefined,
  streetName: string,
  destinationName: string
): string {
  const road = streetName && streetName.trim().length > 0 ? `onto ${streetName}` : '';

  switch (type) {
    case 'depart':
      return streetName ? `Head out on ${streetName}` : `Start route toward ${destinationName}`;
    case 'arrive':
      return `Arriving at ${destinationName}`;
    case 'turn':
      if (modifier === 'left') return `Turn left ${road}`;
      if (modifier === 'right') return `Turn right ${road}`;
      if (modifier === 'slight left') return `Slight left ${road}`;
      if (modifier === 'slight right') return `Slight right ${road}`;
      if (modifier === 'sharp left') return `Sharp left ${road}`;
      if (modifier === 'sharp right') return `Sharp right ${road}`;
      if (modifier === 'uturn') return `Make a U-turn ${road}`;
      return `Turn ${road}`;
    case 'new name':
      return `Continue straight ${road}`;
    case 'continue':
      return `Continue straight ${road}`;
    case 'roundabout':
      return `Enter roundabout and continue ${road}`;
    case 'fork':
      return modifier === 'left' ? `Keep left at fork` : `Keep right at fork`;
    default:
      return streetName ? `Proceed on ${streetName}` : `Continue straight toward ${destinationName}`;
  }
}

/**
 * Generates an Offline Compass and Vector route when internet or OSRM is unavailable.
 */
export function generateOfflineRoute(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
  label: string,
  targetMemberId?: string
): NavigationRoute {
  const totalDistance = calculateDistanceMeters(from.latitude, from.longitude, to.latitude, to.longitude);
  const bearing = calculateBearingDegrees(from.latitude, from.longitude, to.latitude, to.longitude);
  const compassDir = getCompassDirection(bearing);

  // Estimate walking duration at 4.5 km/h (~1.25 m/s)
  const durationSeconds = Math.round(totalDistance / 1.25);

  // Interpolate 10 waypoints along the direct vector
  const coordinates: { latitude: number; longitude: number }[] = [];
  const segments = Math.max(5, Math.min(25, Math.round(totalDistance / 100)));
  for (let i = 0; i <= segments; i++) {
    const ratio = i / segments;
    coordinates.push({
      latitude: from.latitude + (to.latitude - from.latitude) * ratio,
      longitude: from.longitude + (to.longitude - from.longitude) * ratio,
    });
  }

  const steps: TurnByTurnStep[] = [
    {
      id: 'step-offline-1',
      instruction: `Depart: Head ${compassDir} directly toward ${label}`,
      type: 'depart',
      modifier: 'straight',
      distance: Math.round(totalDistance * 0.4),
      duration: Math.round(durationSeconds * 0.4),
      streetName: `${compassDir} Direct Path`,
      location: from,
    },
    {
      id: 'step-offline-2',
      instruction: `Continue ${compassDir} on direct compass route (${formatDistance(totalDistance)})`,
      type: 'continue',
      modifier: 'straight',
      distance: Math.round(totalDistance * 0.5),
      duration: Math.round(durationSeconds * 0.5),
      streetName: 'Direct Line of Sight',
      location: coordinates[Math.floor(coordinates.length / 2)],
    },
    {
      id: 'step-offline-3',
      instruction: `Arrive at destination: ${label}`,
      type: 'arrive',
      modifier: 'arrive',
      distance: Math.round(totalDistance * 0.1),
      duration: Math.round(durationSeconds * 0.1),
      streetName: label,
      location: to,
    },
  ];

  return {
    from,
    to,
    label,
    coordinates,
    distance: totalDistance,
    duration: durationSeconds,
    steps,
    isOffline: true,
    targetMemberId,
  };
}

/**
 * Main Turn-by-Turn Route Calculator:
 * 1. Checks internet connection.
 * 2. Fetches exact road geometry and maneuvers from OSRM driving engine.
 * 3. Caches to AsyncStorage.
 * 4. Falls back seamlessly to offline cache or offline compass vector route.
 */
export async function getTurnByTurnRoute(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
  destinationLabel: string,
  targetMemberId?: string
): Promise<NavigationRoute> {
  const cacheKey = `${ROUTE_CACHE_PREFIX}${from.latitude.toFixed(3)}_${from.longitude.toFixed(3)}_${to.latitude.toFixed(3)}_${to.longitude.toFixed(3)}`;

  // 1. Check offline status
  const netState = await NetInfo.fetch();
  const isOnline = Boolean(netState.isConnected && netState.isInternetReachable !== false);

  if (isOnline) {
    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson&steps=true`;
      
      const response = await fetch(osrmUrl, {
        headers: {
          'User-Agent': 'AbucayGuardianSafetyTracker/1.0',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
          const routeData = data.routes[0];
          const rawCoords = routeData.geometry?.coordinates || [];

          const coordinates: { latitude: number; longitude: number }[] = rawCoords.map(
            ([lng, lat]: [number, number]) => ({
              latitude: lat,
              longitude: lng,
            })
          );

          // Parse turn-by-turn steps
          const rawSteps = routeData.legs?.[0]?.steps || [];
          const steps: TurnByTurnStep[] = rawSteps.map((s: any, idx: number) => {
            const maneuver = s.maneuver || {};
            const [lng, lat] = maneuver.location || [to.longitude, to.latitude];
            const streetName = s.name || '';
            const instruction = formatStepInstruction(
              maneuver.type,
              maneuver.modifier,
              streetName,
              destinationLabel
            );

            return {
              id: `step-${idx}`,
              instruction,
              type: maneuver.type || 'turn',
              modifier: maneuver.modifier || 'straight',
              distance: Math.round(s.distance || 0),
              duration: Math.round(s.duration || 0),
              streetName,
              location: { latitude: lat, longitude: lng },
            };
          });

          // Ensure at least arrival step is present
          if (steps.length === 0) {
            steps.push({
              id: 'step-arrive',
              instruction: `Arrive at ${destinationLabel}`,
              type: 'arrive',
              modifier: 'arrive',
              distance: routeData.distance || 0,
              duration: routeData.duration || 0,
              streetName: destinationLabel,
              location: to,
            });
          }

          const route: NavigationRoute = {
            from,
            to,
            label: destinationLabel,
            coordinates,
            distance: Math.round(routeData.distance || 0),
            duration: Math.round(routeData.duration || 0),
            steps,
            isOffline: false,
            cachedAt: new Date().toISOString(),
            targetMemberId,
          };

          // Save to local cache for emergency offline use
          try {
            await AsyncStorage.setItem(cacheKey, JSON.stringify(route));
          } catch (e) {
            console.warn('[RoutingService] Failed to cache route:', e);
          }

          return route;
        }
      }
    } catch (err) {
      console.warn('[RoutingService] OSRM live routing failed, trying offline fallback:', err);
    }
  }

  // 2. Offline Fallback: Check if cached previously
  try {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const parsedRoute = JSON.parse(cached) as NavigationRoute;
      parsedRoute.isOffline = true;
      parsedRoute.targetMemberId = targetMemberId;
      console.log('[RoutingService] Using cached offline route');
      return parsedRoute;
    }
  } catch (e) {
    console.warn('[RoutingService] Cache lookup error:', e);
  }

  // 3. Complete Offline Direct Compass Route
  console.log('[RoutingService] Generating intelligent offline compass vector route');
  return generateOfflineRoute(from, to, destinationLabel, targetMemberId);
}

