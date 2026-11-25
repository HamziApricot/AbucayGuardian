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

export const DEFAULT_COVERT_SETTINGS: CovertSettings = {
  secretPin: '911911',
  shakeEnabled: true,
  volumePatternEnabled: true,
  weatherTapEnabled: true,
};

const STORAGE_KEY_SETTINGS = '@abucay_covert_sos_settings';
const STORAGE_KEY_ACTIVE_SOS = '@abucay_active_silent_sos_status';
const COOLDOWN_MS = 10_000; // 10-second cooldown lock to prevent accidental double-firing

let isDispatching = false;
let lastTriggerTime = 0;

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
 * Saves updated covert SOS settings.
 */
export async function saveCovertSettings(settings: Partial<CovertSettings>): Promise<CovertSettings> {
  try {
    const current = await getCovertSettings();
    const updated = { ...current, ...settings };
    await AsyncStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(updated));
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
 * Helper to fetch all paired family user IDs (both direct and reciprocal links).
 */
async function getPairedFamilyUserIds(userId: string): Promise<string[]> {
  const idSet = new Set<string>();
  try {
    const { data: direct } = await supabase
      .from('family_members')
      .select('member_user_id')
      .eq('user_id', userId)
      .not('member_user_id', 'is', null);

    if (direct) {
      direct.forEach((row: any) => {
        if (row.member_user_id && row.member_user_id !== userId) {
          idSet.add(row.member_user_id);
        }
      });
    }
  } catch {}

  try {
    const { data: reverse } = await supabase
      .from('family_members')
      .select('user_id')
      .eq('member_user_id', userId);

    if (reverse) {
      reverse.forEach((row: any) => {
        if (row.user_id && row.user_id !== userId) {
          idSet.add(row.user_id);
        }
      });
    }
  } catch {}

  return Array.from(idSet);
}

/**
 * Triggers a completely silent, stealth emergency SOS:
 * 1. ZERO audio playback, ZERO vibration (never calls Vibration.vibrate).
 * 2. ZERO confirmation modals, snackbars, or toasts on the sender's device.
 * 3. Instant GPS fallback (getLastKnownPositionAsync / cached location first, then live balanced lock).
 * 4. Inserts active SOS event in Supabase sos_events, updates tracker/users, broadcasts over Realtime, and sends Push/SMS.
 * 5. Fails completely silently without showing any error dialog if offline or restricted.
 */
export async function triggerSilentSOS(triggerSource: CovertTriggerSource = 'manual'): Promise<boolean> {
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

    // 1. Get current authenticated user (fast local session first so offline works instantly)
    let user: any = null;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      user = sessionData?.session?.user ?? null;
    } catch {}

    if (!user) {
      const { data: userData } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      user = userData?.user ?? null;
    }

    if (!user) {
      console.warn('[SilentSOSService] Cannot dispatch: no authenticated user');
      return false;
    }

    // Passed validation checks -> record cooldown timestamp
    lastTriggerTime = now;
    console.log(`[SilentSOSService] Dispatching covert SOS via ${triggerSource} for user ${user.id}`);

    // 2. Fetch sender's profile from the 'users' table (NOT 'profiles')
    let userProfile: { name?: string; phone?: string; avatar_url?: string } | null = null;
    try {
      const { data } = await supabase
        .from('users')
        .select('name, phone, avatar_url')
        .eq('id', user.id)
        .single();
      userProfile = data;
    } catch {}

    const senderName = userProfile?.name || user.user_metadata?.name || 'Family Member';
    const senderPhone = userProfile?.phone || user.phone || undefined;
    const senderAvatar = userProfile?.avatar_url || null;

    // 3. Fast GPS acquisition: check last known position & local cache first for sub-second dispatch
    let coords: { latitude: number; longitude: number } = {
      latitude: 14.7275,
      longitude: 120.5378,
    };

    try {
      const cached = await getLastKnownLocation();
      if (cached?.lat && cached?.lng) {
        coords = { latitude: cached.lat, longitude: cached.lng };
      }

      const lastKnown = await Location.getLastKnownPositionAsync();
      if (lastKnown?.coords) {
        coords = {
          latitude: lastKnown.coords.latitude,
          longitude: lastKnown.coords.longitude,
        };
        saveLastKnownLocation({ lat: coords.latitude, lng: coords.longitude }).catch(() => {});
      } else {
        const currentLoc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        coords = {
          latitude: currentLoc.coords.latitude,
          longitude: currentLoc.coords.longitude,
        };
        saveLastKnownLocation({ lat: coords.latitude, lng: coords.longitude }).catch(() => {});
      }
    } catch {
      // Keep cached/fallback coords if location service is restricted
    }

    // 4. Device battery level
    let batteryLevel: number | null = 0.8;
    try {
      const bat = await getDeviceBatteryLevel();
      if (bat !== null && bat !== undefined && bat >= 0) {
        batteryLevel = bat;
      }
    } catch {}

    // 5. Query all paired family members (both direct and reverse links)
    const targetFamilyUserIds = await getPairedFamilyUserIds(user.id);
    const timestamp = new Date().toISOString();

    // Persist local active status for discreet verification inside hidden settings
    AsyncStorage.setItem(
      STORAGE_KEY_ACTIVE_SOS,
      JSON.stringify({
        active: true,
        source: triggerSource,
        triggeredAt: timestamp,
        lat: coords.latitude,
        lng: coords.longitude,
      })
    ).catch(() => {});

    // 6. Record active SOS event in database using exact schema columns (user_id, lat, lng, triggered_at, status)
    const sosRow = {
      user_id: user.id,
      lat: coords.latitude,
      lng: coords.longitude,
      triggered_at: timestamp,
      status: 'active',
    };

    try {
      const { error: sosError } = await supabase.from('sos_events').insert(sosRow);
      if (sosError) {
        console.warn('[SilentSOSService] sos_events insert failed, queuing offline:', sosError.message);
        await queueSOSEvent(sosRow);
      }
    } catch {
      await queueSOSEvent(sosRow).catch(() => {});
    }

    // Sync tracker & users table so live map coordinates update right away
    try {
      await supabase
        .from('tracker')
        .upsert(
          {
            user_id: user.id,
            lat: coords.latitude,
            lng: coords.longitude,
            battery: batteryLevel,
            updated_at: timestamp,
          },
          { onConflict: 'user_id' }
        );
      await supabase
        .from('users')
        .update({
          lat: coords.latitude,
          lng: coords.longitude,
          updated_at: timestamp,
        })
        .eq('id', user.id);
    } catch {}

    // 7. Broadcast over Supabase Realtime channel to active family screens
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

    // 8. Dispatch Push Notifications to wake family phones and locked screens
    if (targetFamilyUserIds.length > 0) {
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
    }

    // 9. Dispatch Background Emergency SMS (silent: true guarantees Messages composer UI NEVER opens)
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

    // 10. Refine GPS coordinates in background 3 seconds later if initially low accuracy
    setTimeout(async () => {
      try {
        const refined = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        if (refined?.coords) {
          await supabase
            .from('sos_events')
            .update({
              lat: refined.coords.latitude,
              lng: refined.coords.longitude,
            })
            .eq('user_id', user.id)
            .eq('status', 'active');

          await supabase
            .from('tracker')
            .upsert(
              {
                user_id: user.id,
                lat: refined.coords.latitude,
                lng: refined.coords.longitude,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'user_id' }
            );
        }
      } catch {}
    }, 3000);

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
