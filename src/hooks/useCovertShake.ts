import { useEffect, useRef } from 'react';
import { Accelerometer } from 'expo-sensors';
import { triggerSilentSOS } from '../services/SilentSOSService';

/**
 * Covert Shake Gesture Hook:
 * Samples the device accelerometer at 20 Hz (50ms interval).
 * Detects deliberate multi-shake motion:
 * - Magnitude sqrt(x^2 + y^2 + z^2) > 2.7 G
 * - Minimum spacing of >= 180ms between peaks (to avoid counting a single swing multiple times)
 * - 3 spikes within a 1.5s sliding window triggers triggerSilentSOS('shake')
 */
export function useCovertShake() {
  const peakTimestamps = useRef<number[]>([]);
  const lastPeakTime = useRef<number>(0);

  useEffect(() => {
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
