import { isMapLibreNativeAvailable } from '../utils/nativeCheck';

export type LngLatBounds = [number, number, number, number];

/**
 * Pre-downloads OpenFreeMap Liberty vector tiles & 3D building geometry
 * bounds format: [westLng, southLat, eastLng, northLat]
 */
export async function cacheFamilyZoneOffline(
  zoneName: string,
  bounds: LngLatBounds,
  onProgress?: (percentage: number) => void
) {
  if (!isMapLibreNativeAvailable()) {
    console.log('[OfflineMap] MapLibre native module not linked; offline tile caching requires a custom native build.');
    return;
  }

  try {
    const { OfflineManager } = require('@maplibre/maplibre-react-native');
    // Allow sufficient tile count for zoom levels 12–16 (includes 3D buildings at zoom 15+)
    await OfflineManager.setTileCountLimit(15000);

    await OfflineManager.createPack(
      {
        mapStyle: 'https://tiles.openfreemap.org/styles/liberty',
        minZoom: 12,
        maxZoom: 16,
        bounds,
        metadata: { name: zoneName, createdAt: Date.now() },
      },
      (_offlineRegion: any, status: any) => {
        if (onProgress && status.percentage != null) {
          onProgress(Math.round(status.percentage));
        }
      },
      (_offlineRegion: any, error: any) => {
        console.warn('[OfflineMap] Tile pack error:', error);
      }
    );
  } catch (err) {
    console.error('[OfflineMap] Failed to create offline pack:', err);
  }
}

