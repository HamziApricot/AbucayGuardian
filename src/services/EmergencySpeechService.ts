import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export interface EmergencySpeechSettings {
  enabled: boolean;
  rate: number; // 0.8 to 1.2, default 0.95 for clear emergency diction
  pitch: number; // default 1.0
  language: string; // default 'en-US' or system default
}

export const DEFAULT_SPEECH_SETTINGS: EmergencySpeechSettings = {
  enabled: true,
  rate: Platform.OS === 'ios' ? 0.92 : 0.98,
  pitch: 1.0,
  language: 'en-US',
};

const STORAGE_KEY_SPEECH = '@abucay_emergency_speech_settings';

let cachedSettings: EmergencySpeechSettings | null = null;
let isCurrentlySpeaking = false;

/**
 * Loads emergency speech settings from persistent storage.
 */
export async function getEmergencySpeechSettings(): Promise<EmergencySpeechSettings> {
  if (cachedSettings) return cachedSettings;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_SPEECH);
    if (raw) {
      const resolved: EmergencySpeechSettings = { ...DEFAULT_SPEECH_SETTINGS, ...JSON.parse(raw) };
      cachedSettings = resolved;
      return resolved;
    }
  } catch (e) {
    console.warn('[EmergencySpeechService] Error loading speech settings:', e);
  }
  cachedSettings = DEFAULT_SPEECH_SETTINGS;
  return DEFAULT_SPEECH_SETTINGS;
}

/**
 * Saves emergency speech settings.
 */
export async function saveEmergencySpeechSettings(
  settings: Partial<EmergencySpeechSettings>
): Promise<EmergencySpeechSettings> {
  try {
    const current = await getEmergencySpeechSettings();
    const updated: EmergencySpeechSettings = { ...current, ...settings };
    cachedSettings = updated;
    await AsyncStorage.setItem(STORAGE_KEY_SPEECH, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.warn('[EmergencySpeechService] Error saving speech settings:', e);
    return cachedSettings || DEFAULT_SPEECH_SETTINGS;
  }
}

/**
 * Strips emoji characters, excessive symbols, and markdown markers
 * so the TTS engine speaks natural, fluid English rather than reading out Unicode emoji names.
 */
export function sanitizeTextForSpeech(raw: string): string {
  if (!raw) return '';
  return raw
    // Strip common emoji ranges
    .replace(
      /([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g,
      ''
    )
    // Replace bullet points and special dashes with commas/pauses
    .replace(/[•·—–]/g, ', ')
    // Replace multiple spaces or newlines with a single space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Stops any ongoing emergency voice speech immediately.
 */
export async function stopEmergencySpeech(): Promise<void> {
  try {
    isCurrentlySpeaking = false;
    await Speech.stop();
  } catch (e) {
    console.warn('[EmergencySpeechService] Error stopping speech:', e);
  }
}

/**
 * Checks if the speech engine is currently active.
 */
export async function isEmergencySpeechActive(): Promise<boolean> {
  try {
    const active = await Speech.isSpeakingAsync();
    isCurrentlySpeaking = active;
    return active;
  } catch {
    return isCurrentlySpeaking;
  }
}

export interface SpeakOptions {
  onStart?: () => void;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: (error: any) => void;
  rate?: number;
  pitch?: number;
  language?: string;
}

/**
 * Speaks a custom piece of text out loud with emergency settings.
 */
export async function speakDialogueText(
  text: string,
  options?: SpeakOptions
): Promise<boolean> {
  const settings = await getEmergencySpeechSettings();
  if (!settings.enabled) {
    return false;
  }

  const cleanText = sanitizeTextForSpeech(text);
  if (!cleanText) return false;

  try {
    // Stop any previous utterance first
    await Speech.stop();

    isCurrentlySpeaking = true;
    if (options?.onStart) options.onStart();

    Speech.speak(cleanText, {
      language: options?.language || settings.language || 'en-US',
      pitch: options?.pitch ?? settings.pitch ?? 1.0,
      rate: options?.rate ?? settings.rate ?? 0.95,
      onStart: () => {
        isCurrentlySpeaking = true;
        if (options?.onStart) options.onStart();
      },
      onDone: () => {
        isCurrentlySpeaking = false;
        if (options?.onDone) options.onDone();
      },
      onStopped: () => {
        isCurrentlySpeaking = false;
        if (options?.onStopped) options.onStopped();
      },
      onError: (err) => {
        isCurrentlySpeaking = false;
        console.warn('[EmergencySpeechService] TTS speak error:', err);
        if (options?.onError) options.onError(err);
      },
    });

    return true;
  } catch (err) {
    isCurrentlySpeaking = false;
    console.warn('[EmergencySpeechService] Failed to speak dialogue:', err);
    return false;
  }
}

/**
 * Specifically reads out the dialogue content for:
 * 1. SOS ("EMERGENCY SOS DISTRESS")
 * 2. Loud Ping ("LOUD EMERGENCY PING")
 * 3. Are You Safe? ("ARE YOU SAFE? / CHECK-IN")
 */
export async function speakEmergencyAlert(
  alertType: 'sos' | 'loud_ping' | 'checkin',
  fromName: string,
  details?: {
    battery?: number | null;
    customNotice?: string;
  },
  callbacks?: SpeakOptions
): Promise<boolean> {
  const safeName = fromName?.trim() || 'A family member';
  let spokenScript = '';

  if (alertType === 'sos') {
    spokenScript = `Emergency SOS Distress Alert! Distress signal received from ${safeName}. ${safeName} broadcasted an emergency SOS distress alert. Live coordinates and location have been transmitted. Please check on them immediately or call emergency dispatch.`;
    if (details?.battery !== undefined && details?.battery !== null) {
      spokenScript += ` Device battery is at ${Math.round(details.battery * 100)} percent.`;
    }
  } else if (alertType === 'loud_ping') {
    spokenScript = `Loud Emergency Ping! Urgent audible alert requested by ${safeName}. ${safeName} triggered an emergency alarm on your device. Please verify that you are safe immediately.`;
  } else if (alertType === 'checkin') {
    spokenScript = `Are you safe? Urgent safety check-in request from ${safeName}. ${safeName} is requesting your real-time safety status. Please tap below to confirm you are safe.`;
  }

  if (details?.customNotice && details.customNotice.trim()) {
    spokenScript = `${spokenScript} Notice: ${details.customNotice.trim()}`;
  }

  return await speakDialogueText(spokenScript, callbacks);
}
