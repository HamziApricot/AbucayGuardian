import { requireOptionalNativeModule } from 'expo';

export type BatteryHealthStatus = 'Charging' | 'Good' | 'Fair' | 'Low' | 'Critical';

export interface BatteryHealthInfo {
  level: number; // 0.0 to 1.0
  isCharging: boolean;
  lowPowerMode: boolean;
  healthLabel: BatteryHealthStatus;
}

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
 * Computes human-readable battery health classification.
 */
export function getBatteryHealthLabel(level: number, isCharging: boolean): BatteryHealthStatus {
  if (isCharging) return 'Charging';
  if (level <= 0.15) return 'Critical';
  if (level <= 0.25) return 'Low';
  if (level <= 0.5) return 'Fair';
  return 'Good';
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
 * Retrieves full battery health info: level, charging state, and low power mode.
 */
export async function getDevicePowerState(): Promise<BatteryHealthInfo | null> {
  const mod = getNativeBatteryModule();
  if (!mod) return null;

  try {
    if (typeof mod.getPowerStateAsync === 'function') {
      const power = await mod.getPowerStateAsync();
      const level = typeof power?.batteryLevel === 'number' && power.batteryLevel >= 0 ? power.batteryLevel : null;
      if (level === null) return null;
      // Expo BatteryState enum: 0=UNKNOWN, 1=UNPLUGGED, 2=CHARGING, 3=FULL
      const isCharging = power.batteryState === 2 || power.batteryState === 3;
      const lowPowerMode = Boolean(power.lowPowerMode);
      return {
        level,
        isCharging,
        lowPowerMode,
        healthLabel: getBatteryHealthLabel(level, isCharging),
      };
    }

    const level = await getDeviceBatteryLevel();
    if (level === null) return null;

    let isCharging = false;
    if (typeof mod.getBatteryStateAsync === 'function') {
      const st = await mod.getBatteryStateAsync();
      isCharging = st === 2 || st === 3;
    }
    return {
      level,
      isCharging,
      lowPowerMode: false,
      healthLabel: getBatteryHealthLabel(level, isCharging),
    };
  } catch {
    return null;
  }
}

/**
 * Subscribes to battery level changes safely.
 * Returns an unsubscribe cleanup function, or null if unsupported.
 */
export function subscribeToBatteryLevel(onChange: (level: number) => void): (() => void) | null {
  return subscribeToBatteryHealth((info) => onChange(info.level));
}

/**
 * Subscribes to real-time battery level, charging state, and power mode updates.
 * Note: On Android, Expo's native batteryLevelDidChange only fires at BATTERY_LOW (15%) or BATTERY_OKAY,
 * so we combine native event listeners (for instant charging plug/unplug detection) with a lightweight
 * 5-second power-state check to detect every single 1% drop in real time!
 */
export function subscribeToBatteryHealth(onChange: (info: BatteryHealthInfo) => void): (() => void) | null {
  const mod = getNativeBatteryModule();
  if (!mod) {
    return null;
  }

  let lastPct = -1;
  let lastCharging: boolean | null = null;
  let lastLowPower: boolean | null = null;
  let isDisposed = false;

  const checkAndEmit = async () => {
    if (isDisposed) return;
    const info = await getDevicePowerState();
    if (!info || isDisposed) return;

    const pct = Math.round(info.level * 100);
    if (pct !== lastPct || info.isCharging !== lastCharging || info.lowPowerMode !== lastLowPower) {
      lastPct = pct;
      lastCharging = info.isCharging;
      lastLowPower = info.lowPowerMode;
      onChange(info);
    }
  };

  // Immediate initial read
  checkAndEmit();

  const subscriptions: any[] = [];
  if (typeof mod.addListener === 'function') {
    try {
      subscriptions.push(
        mod.addListener('Expo.batteryLevelDidChange', () => checkAndEmit())
      );
      subscriptions.push(
        mod.addListener('Expo.batteryStateDidChange', () => checkAndEmit())
      );
      subscriptions.push(
        mod.addListener('Expo.powerModeDidChange', () => checkAndEmit())
      );
    } catch {}
  }

  // 5-second lightweight check ensures 1% drops are always caught immediately on Android
  const pollTimer = setInterval(checkAndEmit, 5000);

  return () => {
    isDisposed = true;
    clearInterval(pollTimer);
    for (const sub of subscriptions) {
      try {
        if (sub && typeof sub.remove === 'function') {
          sub.remove();
        }
      } catch {}
    }
  };
}
