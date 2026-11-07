import { requireOptionalNativeModule } from 'expo';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

export const BACKGROUND_LOCATION_TASK = 'ABUCAY_BACKGROUND_LOCATION_TASK';
const USER_ID_KEY = 'ABUCAY_BACKGROUND_USER_ID';

/**
 * Safely probes whether ExpoTaskManager native module is actually compiled and linked
 * into the current binary. Avoids any eager imports or calls to `expo-task-manager`
 * when running in standard Expo Go or un-rebuilt development clients.
 */
export function isTaskManagerAvailable(): boolean {
  try {
    if (typeof requireOptionalNativeModule === 'function') {
      const mod = requireOptionalNativeModule('ExpoTaskManager');
      return mod !== null && mod !== undefined;
    }
    return false;
  } catch {
    return false;
  }
}

// Register headless background task only if native ExpoTaskManager exists in the binary
try {
  if (isTaskManagerAvailable()) {
    const TaskManager = require('expo-task-manager');
    TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: any) => {
      if (error) {
        console.warn('[BackgroundLocationTask] Task error:', error);
        return;
      }

      if (data) {
        const { locations } = data as { locations: Location.LocationObject[] };
        if (locations && locations.length > 0) {
          const latest = locations[locations.length - 1];
          const { latitude, longitude } = latest.coords;

          try {
            const userId = await AsyncStorage.getItem(USER_ID_KEY);
            if (userId) {
              await supabase.from('tracker').upsert({
                user_id: userId,
                lat: latitude,
                lng: longitude,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'user_id' });

              await supabase.from('users').update({
                lat: latitude,
                lng: longitude,
                updated_at: new Date().toISOString(),
              }).eq('id', userId);
              console.log('[BackgroundLocationTask] Synced background GPS point:', latitude, longitude);
            }
          } catch (e) {
            console.warn('[BackgroundLocationTask] Sync to Supabase failed:', e);
          }
        }
      }
    });
    console.log('[BackgroundLocationTask] Native background task registered');
  } else {
    console.log('[BackgroundLocationTask] ExpoTaskManager native module not linked in current runtime. Falling back to active foreground geolocation.');
  }
} catch (e) {
  console.warn('[BackgroundLocationTask] Task registration failed:', e);
}

/**
 * Starts continuous background location tracking with an Android Foreground Service notification
 * and iOS background location indicator, keeping the app alive even when backgrounded or locked.
 * If the current binary does not have native TaskManager linked, safely degrades without crashing.
 */
export async function startBackgroundLocationTracking(userId: string): Promise<boolean> {
  try {
    if (!userId) return false;

    // Save userId for the headless background task executor
    await AsyncStorage.setItem(USER_ID_KEY, userId);

    if (!isTaskManagerAvailable()) {
      console.log('[BackgroundLocation] Native ExpoTaskManager not present in this client build. Background location requires a development build (npx expo run:android). Standard live tracking remains active.');
      return false;
    }

    // 1. Request foreground permission
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') {
      console.warn('[BackgroundLocation] Foreground permission denied');
      return false;
    }

    // 2. Request background permission
    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
    if (bgStatus !== 'granted') {
      console.warn('[BackgroundLocation] Background permission not granted');
    }

    // 3. Clean up any previous task instance so an orphan foreground notification never lingers
    const hasStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (hasStarted) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      console.log('[BackgroundLocation] Stopped previous task instance');
    }

    // 4. Start location updates without a redundant second notification.
    // The single persistent notification with interactive buttons is handled cleanly by EmergencyNotificationService.
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 15000, // sample every 15s
      distanceInterval: 10, // or every 10 meters moved
      deferredUpdatesInterval: 15000,
      showsBackgroundLocationIndicator: true, // iOS active blue bar
      pausesUpdatesAutomatically: false,
    });

    console.log('[BackgroundLocation] Background tracking active with Foreground Service');
    return true;
  } catch (error) {
    console.warn('[BackgroundLocation] Failed to start background location:', error);
    return false;
  }
}

/**
 * Stops the background location tracking task and dismisses any lingering Android foreground service notification.
 */
export async function stopBackgroundLocationTracking(): Promise<void> {
  try {
    const hasStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
    if (hasStarted) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
      console.log('[BackgroundLocation] Background tracking stopped');
    } else {
      // Force stop in case native service is lingering from a previous session
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
    }
  } catch (e) {
    // Non-blocking cleanup
  }
}
