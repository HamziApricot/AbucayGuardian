import { TurboModuleRegistry, NativeModules } from 'react-native';

/**
 * Checks whether MapLibre's native modules (e.g. MLRNCameraModule) are linked in the binary.
 * In Expo Go, third-party native C++ / Java modules are NOT included, and importing MapLibre
 * directly triggers TurboModuleRegistry.getEnforcing() which crashes the runtime.
 */
export function isMapLibreNativeAvailable(): boolean {
  try {
    if (TurboModuleRegistry && typeof (TurboModuleRegistry as any).get === 'function') {
      const camera = (TurboModuleRegistry as any).get('MLRNCameraModule');
      if (camera) return true;
    }
  } catch (e) {}

  try {
    if (NativeModules && (NativeModules as any).MLRNCameraModule) {
      return true;
    }
  } catch (e) {}

  return false;
}

