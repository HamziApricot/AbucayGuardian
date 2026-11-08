import { NativeModules, Platform, Alert } from 'react-native';

const { EmergencyAudio } = NativeModules;

/**
 * Plays an emergency alarm sound routed directly to Android's hardware STREAM_ALARM.
 * Bypasses Silent mode, Vibrate mode, and Do Not Disturb (DND).
 * Automatically ducks any background media and ensures audio focus.
 *
 * @param sound 'alert' | 'notif'
 * @param loop boolean (default: false)
 */
export async function playEmergencyAlarmAudio(
  sound: 'alert' | 'notif' = 'alert',
  loop: boolean = false
): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (!EmergencyAudio || typeof EmergencyAudio.playAlarmSound !== 'function') {
    return false;
  }
  try {
    return await EmergencyAudio.playAlarmSound(sound, loop);
  } catch (err) {
    console.warn('[EmergencyAudio] Failed to play alarm audio:', err);
    return false;
  }
}

/**
 * Stops any currently playing emergency alarm audio, releases audio focus,
 * and restores the user's previous alarm volume level.
 */
export async function stopEmergencyAlarmAudio(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (!EmergencyAudio || typeof EmergencyAudio.stopAlarmSound !== 'function') {
    return false;
  }
  try {
    return await EmergencyAudio.stopAlarmSound();
  } catch (err) {
    console.warn('[EmergencyAudio] Failed to stop alarm audio:', err);
    return false;
  }
}

/**
 * Checks whether the app currently has Do Not Disturb (DND) policy access (ACCESS_NOTIFICATION_POLICY).
 */
export async function isDndAccessGranted(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (!EmergencyAudio || typeof EmergencyAudio.isDndAccessGranted !== 'function') {
    return true;
  }
  try {
    return await EmergencyAudio.isDndAccessGranted();
  } catch {
    return true;
  }
}

/**
 * Opens Android system settings directly to the "Do Not Disturb access" screen
 * so the user can grant permission to Abucay Guardian.
 */
export async function openDndSettings(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (!EmergencyAudio || typeof EmergencyAudio.openDndSettings !== 'function') {
    return false;
  }
  try {
    return await EmergencyAudio.openDndSettings();
  } catch (err) {
    console.warn('[EmergencyAudio] Failed to open DND settings:', err);
    return false;
  }
}

/**
 * Checks whether the app has SYSTEM_ALERT_WINDOW ("Display over other apps") permission.
 * This is the crucial permission that allows emergency popups over other apps when closed.
 */
export async function isOverlayPermissionGranted(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (!EmergencyAudio || typeof EmergencyAudio.isOverlayPermissionGranted !== 'function') {
    return true;
  }
  try {
    return await EmergencyAudio.isOverlayPermissionGranted();
  } catch {
    return true;
  }
}

/**
 * Opens Android settings directly to the "Display over other apps" screen for Abucay Guardian.
 */
export async function openOverlaySettings(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (!EmergencyAudio || typeof EmergencyAudio.openOverlaySettings !== 'function') {
    return false;
  }
  try {
    return await EmergencyAudio.openOverlaySettings();
  } catch (err) {
    console.warn('[EmergencyAudio] Failed to open overlay settings:', err);
    return false;
  }
}

/**
 * Checks whether battery optimization is ignored ("Unrestricted" battery usage).
 */
export async function isBatteryOptimizationIgnored(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (!EmergencyAudio || typeof EmergencyAudio.isBatteryOptimizationIgnored !== 'function') {
    return true;
  }
  try {
    return await EmergencyAudio.isBatteryOptimizationIgnored();
  } catch {
    return true;
  }
}

/**
 * Opens Android settings for Battery Optimization so user can choose "Unrestricted".
 */
export async function openBatteryOptimizationSettings(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (!EmergencyAudio || typeof EmergencyAudio.openBatteryOptimizationSettings !== 'function') {
    return false;
  }
  try {
    return await EmergencyAudio.openBatteryOptimizationSettings();
  } catch (err) {
    console.warn('[EmergencyAudio] Failed to open battery settings:', err);
    return false;
  }
}

/**
 * Prompts the user during onboarding or when active to grant:
 * 1. "Display over other apps" (SYSTEM_ALERT_WINDOW) - required for full-screen emergency popups when closed
 * 2. "Unrestricted Battery" - required so Android doesn't kill the 24/7 background listener
 */
export async function requestOverlayAndBatteryPermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;

  try {
    const isOverlayGranted = await isOverlayPermissionGranted();
    if (!isOverlayGranted) {
      Alert.alert(
        '🛡️ Enable Emergency Popups',
        'Abucay Guardian requires the "Display over other apps" (Appear on top) permission to pop up emergency sirens and safety alerts even when your phone is locked or another app is open.',
        [
          { text: 'Later', style: 'cancel' },
          {
            text: 'Enable Now',
            onPress: () => openOverlaySettings(),
          },
        ]
      );
      return;
    }

    const isBatteryIgnored = await isBatteryOptimizationIgnored();
    if (!isBatteryIgnored) {
      Alert.alert(
        '⚡ Unrestricted Battery Usage',
        'To guarantee that emergency loud pings and family safety checks wake your phone when the app is swiped closed, please select "Unrestricted" under Battery usage.',
        [
          { text: 'Later', style: 'cancel' },
          {
            text: 'Open Settings',
            onPress: () => openBatteryOptimizationSettings(),
          },
        ]
      );
    }
  } catch (err) {
    console.warn('[EmergencyAudio] Permission check error:', err);
  }
}


