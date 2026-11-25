import { useEffect } from 'react';
import { DeviceEventEmitter, Platform } from 'react-native';
import { triggerSilentSOS } from '../services/SilentSOSService';

/**
 * Listens for the hardware volume button pattern (UP -> UP -> DOWN -> UP)
 * intercepted natively in MainActivity.kt on Android.
 * When matched within 2.5 seconds, triggers covert silent SOS with zero sound/screen-wake.
 */
export function useCovertVolume() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const subscription = DeviceEventEmitter.addListener('onCovertVolumeSOS', () => {
      console.log('[CovertVolume] Hardware volume sequence intercepted -> triggering Silent SOS');
      triggerSilentSOS('volume');
    });

    return () => {
      subscription.remove();
    };
  }, []);
}
