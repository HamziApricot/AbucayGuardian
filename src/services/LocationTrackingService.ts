import { NativeModules, TurboModuleRegistry } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../lib/supabase';

// Safely probe if native module "RNBackgroundGeolocation" is linked in current runtime (e.g., custom dev build vs Expo Go)
export function getBackgroundGeolocation(): any | null {
  try {
    let hasNativeModule = false;

    if (TurboModuleRegistry && typeof (TurboModuleRegistry as any).get === 'function') {
      try {
        const turbo = (TurboModuleRegistry as any).get('RNBackgroundGeolocation');
        if (turbo) hasNativeModule = true;
      } catch (e) {}
    }

    if (!hasNativeModule && NativeModules && NativeModules.RNBackgroundGeolocation) {
      hasNativeModule = true;
    }

    if (hasNativeModule) {
      const mod = require('react-native-background-geolocation');
      return mod?.default || mod;
    }
  } catch (e) {
    // Native module not linked or require failed
  }

  return null;
}

export class LocationTrackingService {
  private static isInitialized = false;

  public static async init(userId: string, familyId?: string, authToken?: string, batchUrl?: string) {
    if (this.isInitialized) return;

    const bgGeo = getBackgroundGeolocation();
    if (!bgGeo) {
      console.log('[LocationTrackingService] RNBackgroundGeolocation native module not present. Running in Expo Location mode.');
      return;
    }

    // 1. Listen to location events for live in-app UI updates & Supabase live sync
    bgGeo.onLocation(
      async (location: any) => {
        console.log('[Location Engine] New Point:', location.coords.latitude, location.coords.longitude);
        if (userId) {
          try {
            await supabase.from('tracker').upsert({
              user_id: userId,
              lat: location.coords.latitude,
              lng: location.coords.longitude,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'user_id' });

            await supabase.from('users').update({
              lat: location.coords.latitude,
              lng: location.coords.longitude,
              updated_at: new Date().toISOString(),
            }).eq('id', userId);
          } catch (e) {
            console.warn('[Location Engine] Live sync error:', e);
          }
        }
      },
      (error: any) => {
        console.warn('[Location Engine] Location error:', error);
      }
    );

    // 2. Motion state changes (Stationary vs Moving)
    bgGeo.onMotionChange((event: any) => {
      console.log('[Location Engine] Motion state changed. Is Moving:', event.isMoving);
    });

    // 3. HTTP Sync Events
    bgGeo.onHttp((response: any) => {
      console.log('[Sync Engine] Synced batch successfully. Status:', response.status);
    });

    // 4. Configure the tracking engine
    const config = {
      geolocation: {
        desiredAccuracy: 0, // High
        distanceFilter: 15, // Minimum meters moved before sampling when moving
        stationaryRadius: 25, // Meters within which device is marked stationary
        stopTimeout: 5, // Minutes to wait after stopping before turning off high-power GPS
        activityType: 2, // OtherNavigation
      },
      activity: {
        disableMotionActivityUpdates: false,
      },
      app: {
        stopOnTerminate: false, // Continue tracking if user kills app
        startOnBoot: true,      // Resuscitate after phone restarts
        enableHeadless: true,   // Execute background task when JS is not running
        notification: {
          title: 'Family Sharing Active',
          text: 'Sharing live location with your family circle.',
          color: '#2563EB',
          priority: -2, // Min
        },
      },
      persistence: {
        maxRecordsToPersist: 5000, // Store up to 5000 offline coordinates in native SQLite
      },
      http: {
        autoSync: true,             // Native code handles upload automatically
        autoSyncThreshold: 5,       // Send after accumulating 5 points when online
        batchSync: true,            // Group points into an array
        maxBatchSize: 50,           // Up to 50 points per HTTP POST request
        ...(batchUrl ? { url: batchUrl, method: 'POST' } : {}),
        ...(authToken ? {
          headers: { Authorization: `Bearer ${authToken}` },
          params: { userId, ...(familyId ? { familyId } : {}) },
        } : {}),
      },
    };

    try {
      const state = await bgGeo.ready(config);
      this.isInitialized = true;

      // Automatically trigger manual queue sync when returning online
      NetInfo.addEventListener((networkState) => {
        if (networkState.isConnected && networkState.isInternetReachable) {
          bgGeo.sync().catch((err: any) =>
            console.warn('[Sync Engine] Manual sync error:', err)
          );
        }
      });

      if (!state.enabled) {
        await bgGeo.start();
      }
    } catch (e) {
      console.warn('[LocationTrackingService] Init error:', e);
    }
  }

  public static async stop() {
    const bgGeo = getBackgroundGeolocation();
    if (bgGeo) {
      await bgGeo.stop();
    }
    this.isInitialized = false;
  }

  public static async getCount() {
    const bgGeo = getBackgroundGeolocation();
    return bgGeo ? bgGeo.getCount() : 0;
  }

  public static async sync() {
    const bgGeo = getBackgroundGeolocation();
    if (bgGeo) {
      return bgGeo.sync();
    }
  }
}
