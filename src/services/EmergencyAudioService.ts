import { NativeModules, Platform } from 'react-native';

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

