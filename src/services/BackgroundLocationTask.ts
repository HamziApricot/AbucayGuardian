import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { getDeviceBatteryLevel } from './batteryService';

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
          const accuracy = Math.round(latest.coords.accuracy ?? 5);
          const speed = Math.max(0, latest.coords.speed ?? 0);
          const heading = latest.coords.heading ?? null;
          const nowIso = new Date().toISOString();

          try {
            const userId = await AsyncStorage.getItem(USER_ID_KEY);
            if (userId) {
              const battery = await getDeviceBatteryLevel().catch(() => null);

              // 1. Sync user's real-time position to Supabase tracker table
              await supabase.from('tracker').upsert({
                user_id: userId,
                lat: latitude,
                lng: longitude,
                accuracy,
                speed,
                battery,
                heading,
                updated_at: nowIso,
              }, { onConflict: 'user_id' });

              // 2. Update users table with latest coordinates
              await supabase.from('users').update({
                lat: latitude,
                lng: longitude,
                updated_at: nowIso,
              }).eq('id', userId);

              // 3. Record breadcrumb trail into location_history
              try {
                await supabase.from('location_history').insert({
                  user_id: userId,
                  lat: latitude,
                  lng: longitude,
                  accuracy,
                  speed,
                  battery,
                  captured_at: nowIso,
                });
              } catch {}

              // 4. Peer-to-peer real-time broadcast so active family devices update instantly
              await supabase.channel('family-broadcast').send({
                type: 'broadcast',
                event: 'location_update',
                payload: {
                  user_id: userId,
                  lat: latitude,
                  lng: longitude,
                  accuracy,
                  speed,
                  battery,
                  heading,
                  updated_at: nowIso,
                },
              }).catch(() => {});

              // 5. BACKGROUND FETCH: Fetch latest locations of all family members and cache locally!
              // This guarantees the device always knows where family members are, even while closed/minimized!
              try {
                const { data: familyMembers } = await supabase
                  .from('family_members')
                  .select('*, member:users!member_user_id(id, name, phone, avatar_url, lat, lng, updated_at)')
                  .eq('user_id', userId);

                let allMembers: any[] = (familyMembers as any[]) || [];
                try {
                  const { data: reverseMembers } = await supabase
                    .from('family_members')
                    .select('*, member:users!user_id(id, name, phone, avatar_url, lat, lng, updated_at)')
                    .eq('member_user_id', userId);
                  if (reverseMembers && reverseMembers.length > 0) {
                    reverseMembers.forEach((rm: any) => {
                      const exists = allMembers.some((m: any) => m.member_user_id === rm.user_id || m.user_id === rm.user_id);
                      if (!exists) {
                        allMembers.push({
                          ...rm,
                          member_user_id: rm.user_id,
                          name: rm.member?.name || rm.name,
                          phone: rm.member?.phone || rm.phone,
                          avatar_url: rm.member?.avatar_url || rm.avatar_url,
                        });
                      }
                    });
                  }
                } catch {}

                if (allMembers && allMembers.length > 0) {
                  const memberUserIds = allMembers.map((m: any) => m.member_user_id).filter(Boolean);
                  if (memberUserIds.length > 0) {
                    const { data: trackerRows } = await supabase
                      .from('tracker')
                      .select('*')
                      .in('user_id', memberUserIds);

                    const merged = allMembers.map((m: any) => {
                      const loc = trackerRows?.find((t: any) => t.user_id === m.member_user_id);
                      const userFallback = m.member;
                      const rawBattery = loc?.battery ?? m.battery ?? null;
                      const normalizedBattery = rawBattery != null && rawBattery >= 0 ? (rawBattery > 1 ? rawBattery / 100 : rawBattery) : null;

                      return {
                        ...m,
                        name: m.member?.name || m.name,
                        phone: m.member?.phone || m.phone,
                        lat: loc?.lat ?? userFallback?.lat ?? m.lat,
                        lng: loc?.lng ?? userFallback?.lng ?? m.lng,
                        accuracy: loc?.accuracy ?? 5,
                        speed: loc?.speed ?? 0,
                        battery: normalizedBattery,
                        heading: loc?.heading ?? null,
                        updated_at: loc?.updated_at || userFallback?.updated_at || m.updated_at,
                        avatar_url: m.member?.avatar_url || m.avatar_url,
                      };
                    });

                    await AsyncStorage.setItem('@abucay_cached_family_members', JSON.stringify(merged));
                    console.log(`[BackgroundLocationTask] Background-cached ${merged.length} family locations`);
                  }
                }
              } catch (fErr) {
                console.warn('[BackgroundLocationTask] Background fetch family error:', fErr);
              }

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

    // 4. Start continuous location updates with Foreground Service on Android & indicator on iOS
    // Ensures OS never throttles or terminates background tracking when minimized or closed
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 15000, // sample every 15s
      distanceInterval: 10, // or every 10 meters moved
      deferredUpdatesInterval: 15000,
      showsBackgroundLocationIndicator: true, // iOS active blue bar
      pausesUpdatesAutomatically: false,
      foregroundService: Platform.OS === 'android' ? {
        notificationTitle: '🛡️ Abucay Guardian • Live Protection Active',
        notificationBody: 'Sharing your real-time safety location with your family circle.',
        notificationColor: '#E63946',
      } : undefined,
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
