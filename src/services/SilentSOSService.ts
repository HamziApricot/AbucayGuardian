import * as Location from 'expo-location';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { getDeviceBatteryLevel } from './batteryService';
import { sendEmergencyPushNotification } from './EmergencyNotificationService';
import { sendEmergencySMSToFamily } from './EmergencySMSService';

export type CovertTriggerSource = 'calculator' | 'weather' | 'volume' | 'shake' | 'manual';

export interface CovertSettings {
  secretPin: string;
  shakeEnabled: boolean;
  volumePatternEnabled: boolean;
  weatherTapEnabled: boolean;
}

export const DEFAULT_COVERT_SETTINGS: CovertSettings = {
  secretPin: '911911',
  shakeEnabled: true,
  volumePatternEnabled: true,
  weatherTapEnabled: true,
};

const STORAGE_KEY_SETTINGS = '@abucay_covert_sos_settings';
const COOLDOWN_MS = 30_000; // 30-second cooldown lock to prevent spam / duplicate triggers

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
 * Triggers a completely silent, stealth emergency SOS:
 * 1. ZERO audio playback, ZERO vibration (never calls Vibration.vibrate).
 * 2. ZERO confirmation modals, snackbars, or toasts on the sender's device.
 * 3. Instant GPS fallback (getLastKnownPositionAsync first, followed by balanced lock).
 * 4. Inserts active SOS event in Supabase, broadcasts over Realtime, and sends Push/SMS.
 * 5. Fails completely silently if network or permission error occurs.
 */
export async function triggerSilentSOS(triggerSource: CovertTriggerSource = 'manual'): Promise<boolean> {
  const now = Date.now();
  if (isDispatching || now - lastTriggerTime < COOLDOWN_MS) {
    return false;
  }

  isDispatching = true;
  lastTriggerTime = now;

  try {
    // Check if the specific trigger is disabled in user settings
    const settings = await getCovertSettings();
    if (triggerSource === 'shake' && !settings.shakeEnabled) return false;
    if (triggerSource === 'volume' && !settings.volumePatternEnabled) return false;
    if (triggerSource === 'weather' && !settings.weatherTapEnabled) return false;

    // 1. Get current authenticated user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    // 2. Fetch sender's profile
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('name, phone, avatar_url')
      .eq('id', user.id)
      .single();

    // 3. Fast GPS acquisition: check last known position first for sub-second dispatch
    let coords: { latitude: number; longitude: number; accuracy?: number } = {
      latitude: 14.7275,
      longitude: 120.5378,
    };

    try {
      const lastKnown = await Location.getLastKnownPositionAsync();
      if (lastKnown?.coords) {
        coords = {
          latitude: lastKnown.coords.latitude,
          longitude: lastKnown.coords.longitude,
          accuracy: lastKnown.coords.accuracy ?? 10,
        };
      } else {
        const currentLoc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        coords = {
          latitude: currentLoc.coords.latitude,
          longitude: currentLoc.coords.longitude,
          accuracy: currentLoc.coords.accuracy ?? 10,
        };
      }
    } catch {
      // Keep fallback coords if location service is restricted
    }

    // 4. Device battery level
    let batteryLevel = 0.8;
    try {
      const bat = await getDeviceBatteryLevel();
      if (bat !== null && bat !== undefined) {
        batteryLevel = bat;
      }
    } catch {}

    // 5. Query paired family members to receive the alert
    let targetFamilyUserIds: string[] = [];
    try {
      const { data: familyData } = await supabase
        .from('family_members')
        .select('member_user_id')
        .eq('user_id', user.id)
        .not('member_user_id', 'is', null);

      if (familyData) {
        targetFamilyUserIds = familyData
          .map((m: any) => m.member_user_id)
          .filter(Boolean);
      }
    } catch {}

    const timestamp = new Date().toISOString();

    // 6. Record active SOS event in database
    try {
      await supabase.from('sos_events').insert({
        user_id: user.id,
        lat: coords.latitude,
        lng: coords.longitude,
        accuracy: coords.accuracy,
        battery: batteryLevel,
        status: 'active',
        triggered_at: timestamp,
      });
    } catch {}

    // 7. Broadcast over Supabase Realtime channel to active family screens
    try {
      await supabase.channel('family-broadcast').send({
        type: 'broadcast',
        event: 'sos_alert',
        payload: {
          from_user_id: user.id,
          from_name: userProfile?.name || 'Family Member',
          from_avatar: userProfile?.avatar_url || null,
          from_phone: userProfile?.phone || null,
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
          `URGENT: ${userProfile?.name || 'A family member'} triggered a covert emergency SOS! Tap to open live distress tracking map.`,
          'sos',
          userProfile?.name || 'Family Member',
          coords.latitude,
          coords.longitude,
          batteryLevel
        );
      } catch {}
    }

    // 9. Dispatch Background Emergency SMS (Never opens default Messages composer)
    try {
      await sendEmergencySMSToFamily({
        senderName: userProfile?.name || 'Family Member',
        senderPhone: userProfile?.phone,
        senderId: user.id,
        lat: coords.latitude,
        lng: coords.longitude,
        battery: batteryLevel,
        alertType: 'sos',
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
              accuracy: refined.coords.accuracy,
            })
            .eq('user_id', user.id)
            .eq('status', 'active');
        }
      } catch {}
    }, 3000);

    return true;
  } catch {
    // Fail silently: Never throw, show an alert, or pop up any toast
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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { data: userProfile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', user.id)
      .single();

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
    let targetFamilyUserIds: string[] = [];
    const { data: familyData } = await supabase
      .from('family_members')
      .select('member_user_id')
      .eq('user_id', user.id)
      .not('member_user_id', 'is', null);

    if (familyData) {
      targetFamilyUserIds = familyData.map((m: any) => m.member_user_id).filter(Boolean);
      if (targetFamilyUserIds.length > 0) {
        await sendEmergencyPushNotification(
          targetFamilyUserIds,
          '✅ All-Clear: Emergency Resolved',
          `${userProfile?.name || 'Family Member'} is safe. The emergency alarm has been cleared.`,
          'sos',
          userProfile?.name || 'Family Member'
        );
      }
    }

    return true;
  } catch (e) {
    console.warn('[SilentSOSService] Failed to resolve silent SOS:', e);
    return false;
  }
}
