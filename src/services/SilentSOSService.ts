import { NativeModules, Platform, DeviceEventEmitter } from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { getDeviceBatteryLevel } from './batteryService';
import { sendEmergencyPushNotification } from './EmergencyNotificationService';
import { sendEmergencySMSToFamily } from './EmergencySMSService';
import { queueSOSEvent, getLastKnownLocation, saveLastKnownLocation } from '../utils/cache';

export type CovertTriggerSource = 'calculator' | 'weather' | 'volume' | 'shake' | 'manual';

export interface CovertSettings {
  secretPin: string;
  shakeEnabled: boolean;
  volumePatternEnabled: boolean;
  weatherTapEnabled: boolean;
}

export interface ActiveSilentSOSStatus {
  active: boolean;
  source: CovertTriggerSource;
  triggeredAt: string;
  lat: number;
  lng: number;
}

export interface TriggerSilentSOSOptions {
  waitForRefinement?: boolean;
}

export const DEFAULT_COVERT_SETTINGS: CovertSettings = {
  secretPin: '911911',
  shakeEnabled: true,
  volumePatternEnabled: true,
  weatherTapEnabled: true,
};

const STORAGE_KEY_SETTINGS = '@abucay_covert_sos_settings';
const STORAGE_KEY_ACTIVE_SOS = '@abucay_active_silent_sos_status';
const CACHED_PROFILE_KEY = '@abucay_cached_user_profile';
const CACHED_FAMILY_KEY = '@abucay_cached_family_members';
const BACKGROUND_USER_ID_KEY = 'ABUCAY_BACKGROUND_USER_ID';
const COOLDOWN_MS = 10_000; // 10-second cooldown lock to prevent accidental double-firing

let isDispatching = false;
let lastTriggerTime = 0;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

/**
 * Mirrors covert SOS settings and auth state into Android SharedPreferences
 * and starts/updates the 24/7 CovertSOSService foreground monitor.
 */
export async function syncNativeCovertSOSState(
  userId?: string | null,
  overrideSettings?: CovertSettings
): Promise<boolean> {
  if (Platform.OS !== 'android' || !NativeModules?.CovertSOS?.syncSettings) {
    return false;
  }

  try {
    let resolvedUserId = userId;
    if (resolvedUserId === undefined) {
      const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
      resolvedUserId = data?.session?.user?.id ?? null;
      if (!resolvedUserId) {
        resolvedUserId = await AsyncStorage.getItem(BACKGROUND_USER_ID_KEY).catch(() => null);
      }
    }

    const settings = overrideSettings ?? (await getCovertSettings());
    await NativeModules.CovertSOS.syncSettings(
      Boolean(resolvedUserId),
      resolvedUserId || null,
      Boolean(settings.shakeEnabled),
      Boolean(settings.volumePatternEnabled),
      Boolean(settings.weatherTapEnabled)
    );
    return true;
  } catch (e) {
    console.warn('[SilentSOSService] Failed to sync native covert state:', e);
    return false;
  }
}

export async function isNativeCovertServiceRunning(): Promise<boolean> {
  if (Platform.OS !== 'android' || !NativeModules?.CovertSOS?.isServiceRunning) {
    return false;
  }
  try {
    return await NativeModules.CovertSOS.isServiceRunning();
  } catch {
    return false;
  }
}

export async function isCovertAccessibilityEnabled(): Promise<boolean> {
  if (Platform.OS !== 'android' || !NativeModules?.CovertSOS?.isAccessibilityServiceEnabled) {
    return false;
  }
  try {
    return await NativeModules.CovertSOS.isAccessibilityServiceEnabled();
  } catch {
    return false;
  }
}

export async function openCovertAccessibilitySettings(): Promise<boolean> {
  if (Platform.OS !== 'android' || !NativeModules?.CovertSOS?.openAccessibilitySettings) {
    return false;
  }
  try {
    return await NativeModules.CovertSOS.openAccessibilitySettings();
  } catch {
    return false;
  }
}

/**
 * Retrieves the user's covert SOS settings from persistent storage.
 */
export async function getCovertSettings(): Promise<CovertSettings> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_SETTINGS);
    if (raw) {
      return { ...DEFAULT_COVERT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.warn('[SilentSOSService] Failed to load covert settings:', e);
  }
  return DEFAULT_COVERT_SETTINGS;
}

/**
 * Saves updated covert SOS settings and updates the Android background service.
 */
export async function saveCovertSettings(settings: Partial<CovertSettings>): Promise<CovertSettings> {
  try {
    const current = await getCovertSettings();
    const updated = { ...current, ...settings };
    await AsyncStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(updated));
    await syncNativeCovertSOSState(undefined, updated);
    return updated;
  } catch (e) {
    console.warn('[SilentSOSService] Failed to save covert settings:', e);
    return DEFAULT_COVERT_SETTINGS;
  }
}

/**
 * Returns whether a silent SOS was dispatched and is currently active.
 */
export async function getActiveSilentSOSStatus(): Promise<ActiveSilentSOSStatus | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_ACTIVE_SOS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.active) return parsed;
    }
  } catch {}
  return null;
}

/**
 * Helper to fetch all paired family user IDs (both direct and reciprocal links),
 * falling back to locally cached family members when offline.
 */
async function getPairedFamilyUserIds(userId: string): Promise<string[]> {
  const idSet = new Set<string>();

  // 1. Seed from local cache instantly (works offline & in locked background)
  try {
    const cachedRaw = await AsyncStorage.getItem(CACHED_FAMILY_KEY);
    if (cachedRaw) {
      const parsed = JSON.parse(cachedRaw);
      if (Array.isArray(parsed)) {
        for (const row of parsed) {
          const candidate = row?.member_user_id && row.member_user_id !== userId
            ? row.member_user_id
            : row?.user_id && row.user_id !== userId
            ? row.user_id
            : null;
          if (candidate) idSet.add(candidate);
        }
      }
    }
  } catch {}

  // 2. Refresh from Supabase in parallel with a short timeout
  const [directRes, reverseRes] = await Promise.all([
    withTimeout(
      Promise.resolve(
        supabase
          .from('family_members')
          .select('member_user_id')
          .eq('user_id', userId)
          .not('member_user_id', 'is', null)
      ),
      2500,
      { data: null } as any
    ),
    withTimeout(
      Promise.resolve(
        supabase
          .from('family_members')
          .select('user_id')
          .eq('member_user_id', userId)
      ),
      2500,
      { data: null } as any
    ),
  ]);

  if (Array.isArray(directRes?.data)) {
    directRes.data.forEach((row: any) => {
      if (row.member_user_id && row.member_user_id !== userId) {
        idSet.add(row.member_user_id);
      }
    });
  }
  if (Array.isArray(reverseRes?.data)) {
    reverseRes.data.forEach((row: any) => {
      if (row.user_id && row.user_id !== userId) {
        idSet.add(row.user_id);
      }
    });
  }

  return Array.from(idSet);
}

/**
 * Triggers a completely silent, stealth emergency SOS:
 * 1. ZERO audio playback, ZERO vibration (never calls Vibration.vibrate).
 * 2. ZERO confirmation modals, snackbars, or toasts on the sender's device.
 * 3. Instant GPS fallback (cached location + timed lastKnown/live lock so background never hangs).
 * 4. Concurrently inserts active SOS event in Supabase sos_events, updates tracker/users, broadcasts over Realtime, and sends Push/SMS.
 * 5. Fails completely silently without showing any error dialog if offline or restricted.
 */
export async function triggerSilentSOS(
  triggerSource: CovertTriggerSource = 'manual',
  options?: TriggerSilentSOSOptions
): Promise<boolean> {
  const now = Date.now();
  if (isDispatching || now - lastTriggerTime < COOLDOWN_MS) {
    console.log(`[SilentSOSService] Skipped (${triggerSource}) - cooldown or already dispatching`);
    return false;
  }

  isDispatching = true;

  try {
    // Check if the specific trigger is disabled in user settings BEFORE consuming cooldown
    const settings = await getCovertSettings();
    if (triggerSource === 'shake' && !settings.shakeEnabled) return false;
    if (triggerSource === 'volume' && !settings.volumePatternEnabled) return false;
    if (triggerSource === 'weather' && !settings.weatherTapEnabled) return false;

    // 1. Get current authenticated user (fast local session first, then cached profile fallback for offline)
    let user: any = null;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      user = sessionData?.session?.user ?? null;
    } catch {}

    if (!user) {
      const userRes = await withTimeout(
        supabase.auth.getUser(),
        2000,
        { data: { user: null } } as any
      );
      user = userRes?.data?.user ?? null;
    }

    let cachedProfile: { id?: string; name?: string; phone?: string; avatar_url?: string } | null = null;
    try {
      const rawProfile = await AsyncStorage.getItem(CACHED_PROFILE_KEY);
      if (rawProfile) {
        cachedProfile = JSON.parse(rawProfile);
      }
    } catch {}

    if (!user) {
      const fallbackUserId =
        cachedProfile?.id ||
        (await AsyncStorage.getItem(BACKGROUND_USER_ID_KEY).catch(() => null));
      if (fallbackUserId) {
        user = {
          id: fallbackUserId,
          phone: cachedProfile?.phone,
          user_metadata: { name: cachedProfile?.name },
        };
      }
    }

    if (!user) {
      console.warn('[SilentSOSService] Cannot dispatch: no authenticated user');
      return false;
    }

    // Passed validation checks -> record cooldown timestamp
    lastTriggerTime = now;
    console.log(`[SilentSOSService] Dispatching covert SOS via ${triggerSource} for user ${user.id}`);

    // 2. Fetch sender's profile (use cached profile immediately, race live DB query with 2s timeout)
    const liveProfilePromise = withTimeout(
      Promise.resolve(
        supabase
          .from('users')
          .select('name, phone, avatar_url')
          .eq('id', user.id)
          .single()
      ),
      2000,
      { data: null } as any
    );

    // 3. Fast bounded GPS acquisition (never blocks dispatch when minimized/locked/indoors)
    const gpsPromise = (async () => {
      let resolvedCoords: { latitude: number; longitude: number } = {
        latitude: 14.7275,
        longitude: 120.5378,
      };
      try {
        const cached = await getLastKnownLocation();
        if (cached?.lat && cached?.lng) {
          resolvedCoords = { latitude: cached.lat, longitude: cached.lng };
        }

        const lastKnown = await withTimeout(
          Location.getLastKnownPositionAsync(),
          1500,
          null as Location.LocationObject | null
        );
        if (lastKnown?.coords) {
          resolvedCoords = {
            latitude: lastKnown.coords.latitude,
            longitude: lastKnown.coords.longitude,
          };
          saveLastKnownLocation({ lat: resolvedCoords.latitude, lng: resolvedCoords.longitude }).catch(() => {});
        } else {
          const currentLoc = await withTimeout(
            Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            }),
            2500,
            null as Location.LocationObject | null
          );
          if (currentLoc?.coords) {
            resolvedCoords = {
              latitude: currentLoc.coords.latitude,
              longitude: currentLoc.coords.longitude,
            };
            saveLastKnownLocation({ lat: resolvedCoords.latitude, lng: resolvedCoords.longitude }).catch(() => {});
          }
        }
      } catch {}
      return resolvedCoords;
    })();

    // 4. Device battery level + paired family IDs in parallel
    const batteryPromise = withTimeout(getDeviceBatteryLevel(), 1000, null as number | null);
    const familyPromise = getPairedFamilyUserIds(user.id);

    const [profileRes, coords, bat, targetFamilyUserIds] = await Promise.all([
      liveProfilePromise,
      gpsPromise,
      batteryPromise,
      familyPromise,
    ]);

    const userProfile = profileRes?.data || cachedProfile;
    const senderName = userProfile?.name || user.user_metadata?.name || 'Family Member';
    const senderPhone = userProfile?.phone || user.phone || undefined;
    const senderAvatar = userProfile?.avatar_url || null;
    const batteryLevel: number | null = bat !== null && bat !== undefined && bat >= 0 ? bat : 0.8;
    const timestamp = new Date().toISOString();

    // Persist local active status for discreet verification inside hidden settings
    const activeStatus: ActiveSilentSOSStatus = {
      active: true,
      source: triggerSource,
      triggeredAt: timestamp,
      lat: coords.latitude,
      lng: coords.longitude,
    };
    await AsyncStorage.setItem(STORAGE_KEY_ACTIVE_SOS, JSON.stringify(activeStatus)).catch(() => {});
    DeviceEventEmitter.emit('onSilentSOSDispatched', activeStatus);

    // 5. Record active SOS event, update live coords, broadcast Realtime, send Push & send Silent SMS in parallel
    const sosRow = {
      user_id: user.id,
      lat: coords.latitude,
      lng: coords.longitude,
      triggered_at: timestamp,
      status: 'active',
    };

    const insertSOSTask = async () => {
      try {
        const { error: sosError } = await supabase.from('sos_events').insert(sosRow);
        if (sosError) {
          console.warn('[SilentSOSService] sos_events insert failed, queuing offline:', sosError.message);
          await queueSOSEvent(sosRow);
        }
      } catch {
        await queueSOSEvent(sosRow).catch(() => {});
      }
    };

    const syncLocationTask = async () => {
      try {
        await Promise.allSettled([
          supabase.from('tracker').upsert(
            {
              user_id: user.id,
              lat: coords.latitude,
              lng: coords.longitude,
              battery: batteryLevel,
              updated_at: timestamp,
            },
            { onConflict: 'user_id' }
          ),
          supabase
            .from('users')
            .update({
              lat: coords.latitude,
              lng: coords.longitude,
              updated_at: timestamp,
            })
            .eq('id', user.id),
        ]);
      } catch {}
    };

    const broadcastTask = async () => {
      try {
        await supabase.channel('family-broadcast').send({
          type: 'broadcast',
          event: 'sos_alert',
          payload: {
            from_user_id: user.id,
            from_name: senderName,
            from_avatar: senderAvatar,
            from_phone: senderPhone || null,
            lat: coords.latitude,
            lng: coords.longitude,
            battery: batteryLevel,
            silent: true,
            source: triggerSource,
            target_family_user_ids: targetFamilyUserIds,
            triggered_at: timestamp,
          },
        });
      } catch {}
    };

    const pushTask = async () => {
      if (targetFamilyUserIds.length === 0) return;
      try {
        await sendEmergencyPushNotification(
          targetFamilyUserIds,
          '🚨 SILENT SOS DISTRESS ALERT!',
          `URGENT: ${senderName} triggered a covert emergency SOS! Tap to open live distress tracking map.`,
          'sos',
          senderName,
          coords.latitude,
          coords.longitude,
          batteryLevel
        );
      } catch {}
    };

    const smsTask = async () => {
      try {
        await sendEmergencySMSToFamily({
          senderName,
          senderPhone,
          senderId: user.id,
          lat: coords.latitude,
          lng: coords.longitude,
          battery: batteryLevel,
          alertType: 'sos',
          silent: true,
        });
      } catch {}
    };

    await Promise.allSettled([
      insertSOSTask(),
      syncLocationTask(),
      broadcastTask(),
      pushTask(),
      smsTask(),
    ]);

    // 6. Refine GPS coordinates 3 seconds later if initially low accuracy
    const runRefinement = async () => {
      try {
        const refined = await withTimeout(
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          }),
          4000,
          null as Location.LocationObject | null
        );
        if (refined?.coords) {
          saveLastKnownLocation({
            lat: refined.coords.latitude,
            lng: refined.coords.longitude,
          }).catch(() => {});

          await Promise.allSettled([
            supabase
              .from('sos_events')
              .update({
                lat: refined.coords.latitude,
                lng: refined.coords.longitude,
              })
              .eq('user_id', user.id)
              .eq('status', 'active'),
            supabase
              .from('tracker')
              .upsert(
                {
                  user_id: user.id,
                  lat: refined.coords.latitude,
                  lng: refined.coords.longitude,
                  updated_at: new Date().toISOString(),
                },
                { onConflict: 'user_id' }
              ),
          ]);
        }
      } catch {}
    };

    if (options?.waitForRefinement) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await runRefinement();
    } else {
      setTimeout(() => {
        runRefinement();
      }, 3000);
    }

    return true;
  } catch (err) {
    // Fail silently: Never throw, show an alert, or pop up any toast
    console.warn('[SilentSOSService] Unexpected error (suppressed for stealth):', err);
    return false;
  } finally {
    isDispatching = false;
  }
}

/**
 * Resolves active silent SOS and sends an All-Clear notification to family members.
 */
export async function resolveSilentSOS(): Promise<boolean> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY_ACTIVE_SOS).catch(() => {});

    let user: any = null;
    const { data: sessionData } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
    user = sessionData?.session?.user ?? null;
    if (!user) {
      const { data: userData } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      user = userData?.user ?? null;
    }
    if (!user) return false;

    const { data: userProfile } = await supabase
      .from('users')
      .select('name')
      .eq('id', user.id)
      .single();

    const senderName = userProfile?.name || user.user_metadata?.name || 'Family Member';

    // 1. Mark active database records resolved
    await supabase
      .from('sos_events')
      .update({ status: 'resolved' })
      .eq('user_id', user.id)
      .eq('status', 'active');

    // 2. Broadcast resolution to family devices
    await supabase.channel('family-broadcast').send({
      type: 'broadcast',
      event: 'sos_resolved',
      payload: { user_id: user.id },
    });

    // 3. Notify family circle that danger is resolved
    const targetFamilyUserIds = await getPairedFamilyUserIds(user.id);
    if (targetFamilyUserIds.length > 0) {
      await sendEmergencyPushNotification(
        targetFamilyUserIds,
        '✅ All-Clear: Emergency Resolved',
        `${senderName} is safe. The emergency alarm has been cleared.`,
        'sos',
        senderName
      );
    }

    return true;
  } catch (e) {
    console.warn('[SilentSOSService] Failed to resolve silent SOS:', e);
    return false;
  }
}
