import { NativeModules, Platform, DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

const STORAGE_KEY_CRASH_ENABLED = '@abucay_crash_detection_enabled';

export interface CrashDetectionEvent {
  crashId: string;
  lat?: number;
  lng?: number;
  preImpactSpeedKmh: number;
  peakGForce: number;
  peakGyroRadSec: number;
  detectedAtMs: number;
  expiresAtMs: number;
  countdownSeconds: number;
  isSimulated?: boolean;
}

export interface CrashReadinessStatus {
  enabled: boolean;
  serviceRunning: boolean;
  hasFineLocation: boolean;
  hasAlwaysLocation: boolean;
  hasActivityRecognition: boolean;
  batteryPct: number;
  batteryAbove10: boolean;
  powerSaveMode: boolean;
  ignoringBatteryOptimization: boolean;
  hasAccelerometer: boolean;
  hasGyroscope: boolean;
  hasNetwork: boolean;
}

export async function getCrashDetectionEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_CRASH_ENABLED);
    if (raw === null) return true;
    return raw === 'true';
  } catch {
    return true;
  }
}

export async function setCrashDetectionEnabled(enabled: boolean): Promise<boolean> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_CRASH_ENABLED, String(enabled));
    if (Platform.OS === 'android' && NativeModules?.CrashDetection?.syncCrashDetection) {
      await NativeModules.CrashDetection.syncCrashDetection(enabled);
    }
    return enabled;
  } catch {
    return enabled;
  }
}

export async function syncNativeCrashDetection(): Promise<void> {
  if (Platform.OS !== 'android' || !NativeModules?.CrashDetection?.syncCrashDetection) {
    return;
  }
  try {
    const enabled = await getCrashDetectionEnabled();
    await NativeModules.CrashDetection.syncCrashDetection(enabled);
  } catch {}
}

export async function consumePendingCrashCheckIn(): Promise<CrashDetectionEvent | null> {
  if (Platform.OS !== 'android' || !NativeModules?.CrashDetection?.consumePendingCrashCheckIn) {
    return null;
  }
  try {
    const raw = await NativeModules.CrashDetection.consumePendingCrashCheckIn();
    if (!raw || typeof raw !== 'string') return null;
    const parsed = JSON.parse(raw);
    return parsed?.crashId ? (parsed as CrashDetectionEvent) : null;
  } catch {
    return null;
  }
}

export async function confirmUserSafeFromCrash(): Promise<void> {
  if (Platform.OS === 'android' && NativeModules?.CrashDetection?.confirmUserSafe) {
    await NativeModules.CrashDetection.confirmUserSafe().catch(() => {});
  }
}

export async function escalateCrashNow(): Promise<void> {
  if (Platform.OS === 'android' && NativeModules?.CrashDetection?.escalateCrashNow) {
    await NativeModules.CrashDetection.escalateCrashNow().catch(() => {});
  }
}

export function reportLocationToCrashDetector(
  lat: number,
  lng: number,
  speedMps: number = -1,
  activityType?: string | null
): void {
  if (Platform.OS !== 'android' || !NativeModules?.CrashDetection?.reportLocationSample) {
    return;
  }
  try {
    NativeModules.CrashDetection.reportLocationSample(
      lat,
      lng,
      Number.isFinite(speedMps) ? speedMps : -1,
      activityType || null
    ).catch(() => {});
  } catch {}
}

export async function simulateCrashDetection(lat?: number, lng?: number): Promise<boolean> {
  if (Platform.OS !== 'android' || !NativeModules?.CrashDetection?.simulateCrashAlert) {
    return false;
  }
  try {
    return Boolean(
      await NativeModules.CrashDetection.simulateCrashAlert(lat ?? 0, lng ?? 0)
    );
  } catch {
    return false;
  }
}

export async function getCrashReadinessStatus(): Promise<CrashReadinessStatus> {
  const savedEnabled = await getCrashDetectionEnabled();
  let hasNetwork = true;
  try {
    const net = await NetInfo.fetch();
    hasNetwork = Boolean(net.isConnected);
  } catch {}

  if (Platform.OS === 'android' && NativeModules?.CrashDetection?.getReadinessStatus) {
    try {
      const nativeStatus = await NativeModules.CrashDetection.getReadinessStatus();
      return {
        enabled: savedEnabled,
        serviceRunning: Boolean(nativeStatus?.serviceRunning),
        hasFineLocation: Boolean(nativeStatus?.hasFineLocation),
        hasAlwaysLocation: Boolean(nativeStatus?.hasAlwaysLocation),
        hasActivityRecognition: Boolean(nativeStatus?.hasActivityRecognition),
        batteryPct: Number(nativeStatus?.batteryPct ?? 100),
        batteryAbove10: Boolean(nativeStatus?.batteryAbove10 ?? true),
        powerSaveMode: Boolean(nativeStatus?.powerSaveMode ?? false),
        ignoringBatteryOptimization: Boolean(nativeStatus?.ignoringBatteryOptimization ?? false),
        hasAccelerometer: Boolean(nativeStatus?.hasAccelerometer ?? true),
        hasGyroscope: Boolean(nativeStatus?.hasGyroscope ?? false),
        hasNetwork,
      };
    } catch {}
  }

  return {
    enabled: savedEnabled,
    serviceRunning: false,
    hasFineLocation: false,
    hasAlwaysLocation: false,
    hasActivityRecognition: false,
    batteryPct: 100,
    batteryAbove10: true,
    powerSaveMode: false,
    ignoringBatteryOptimization: false,
    hasAccelerometer: true,
    hasGyroscope: false,
    hasNetwork,
  };
}

export function subscribeToCrashEvents(
  onDetected: (event: CrashDetectionEvent) => void,
  onResolved?: (outcome: 'safe' | 'escalated') => void
): () => void {
  const subDetected = DeviceEventEmitter.addListener('onCrashDetected', (raw: string) => {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed?.crashId) {
        onDetected(parsed as CrashDetectionEvent);
      }
    } catch {}
  });

  const subResolved = DeviceEventEmitter.addListener('onCrashCheckInResolved', (outcome: string) => {
    if (onResolved && (outcome === 'safe' || outcome === 'escalated')) {
      onResolved(outcome);
    }
  });

  return () => {
    subDetected.remove();
    subResolved.remove();
  };
}
