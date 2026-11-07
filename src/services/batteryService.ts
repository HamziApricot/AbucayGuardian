import { requireOptionalNativeModule } from 'expo';

/**
 * Safely retrieves the native ExpoBattery module if and only if
 * it is truly compiled and linked into the current application binary.
 *
 * CRITICAL: We NEVER import or require('expo-battery') directly, because
 * 'expo-battery/build/ExpoBattery' calls requireNativeModule('ExpoBattery') at top-level,
 * which crashes the app with "[runtime not ready]: Error: Cannot find native module 'ExpoBattery'"
 * whenever running in an un-rebuilt client.
 */
function getNativeBatteryModule(): any {
  try {
    if (typeof requireOptionalNativeModule === 'function') {
      const mod = requireOptionalNativeModule('ExpoBattery');
      if (mod && typeof mod.getBatteryLevelAsync === 'function') {
        return mod;
      }
    }
  } catch {
    // Native module not linked in binary
  }
  return null;
}

/**
 * Safely probes whether the ExpoBattery native module is compiled into the current binary.
 */
export function isExpoBatteryAvailable(): boolean {
  return getNativeBatteryModule() !== null;
}

/**
 * Gets the current device battery level safely.
 * Returns a float between 0.0 and 1.0 (e.g. 0.85 for 85%), or null if unsupported.
 */
export async function getDeviceBatteryLevel(): Promise<number | null> {
  const mod = getNativeBatteryModule();
  if (!mod) {
    return null;
  }

  try {
    const level = await mod.getBatteryLevelAsync();
    if (typeof level === 'number' && level >= 0) {
      return level;
    }
  } catch (e) {
    console.log('[BatteryService] Failed to read battery level:', e);
  }

  return null;
}

/**
 * Subscribes to battery level changes safely.
 * Returns an unsubscribe cleanup function, or null if unsupported.
 */
export function subscribeToBatteryLevel(onChange: (level: number) => void): (() => void) | null {
  const mod = getNativeBatteryModule();
  if (!mod || typeof mod.addListener !== 'function') {
    return null;
  }

  try {
    const sub = mod.addListener('Expo.batteryLevelDidChange', ({ batteryLevel }: { batteryLevel: number }) => {
      if (typeof batteryLevel === 'number' && batteryLevel >= 0) {
        onChange(batteryLevel);
      }
    });

    return () => {
      try {
        if (sub && typeof sub.remove === 'function') {
          sub.remove();
        }
      } catch {}
    };
  } catch (e) {
    console.log('[BatteryService] Failed to subscribe to battery level:', e);
    return null;
  }
}
