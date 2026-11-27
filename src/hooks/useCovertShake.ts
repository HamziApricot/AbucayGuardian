import { useEffect, useRef } from 'react';
import { NativeModules, Platform } from 'react-native';
import { Accelerometer } from 'expo-sensors';
import { triggerSilentSOS } from '../services/SilentSOSService';

/**
 * Covert Shake Gesture Hook:
 * On Android builds with CovertSOS native service, 24/7 shake detection runs natively
 * in CovertSOSService (works in foreground, minimized, and screen-locked states).
 * On iOS or Expo Go without the native CovertSOS module, falls back to JS Accelerometer polling at 20 Hz.
 */
export function useCovertShake() {
  const peakTimestamps = useRef<number[]>([]);
  const lastPeakTime = useRef<number>(0);

  useEffect(() => {
    if (Platform.OS === 'android' && NativeModules?.CovertSOS?.syncSettings) {
      // Native CovertSOSService handles accelerometer shake detection 24/7
      return;
    }

    Accelerometer.setUpdateInterval(50); // 20 Hz polling rate

    const subscription = Accelerometer.addListener(({ x, y, z }) => {
      // Normal resting gravity is approx 1.0 G
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      const now = Date.now();

      if (magnitude > 2.7 && now - lastPeakTime.current >= 180) {
        lastPeakTime.current = now;

        // Retain peaks that occurred within the last 1500ms
        const recent = [...peakTimestamps.current, now].filter((t) => now - t <= 1500);
        peakTimestamps.current = recent;

        if (recent.length >= 3) {
          peakTimestamps.current = [];
          console.log('[CovertShake] 3 distinct acceleration peaks detected -> triggering Silent SOS');
          triggerSilentSOS('shake');
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);
}
