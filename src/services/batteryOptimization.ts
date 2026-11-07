import { Platform, Alert } from 'react-native';
import { getBackgroundGeolocation } from './LocationTrackingService';

export async function checkBatteryOptimizations() {
  if (Platform.OS !== 'android') return;

  const bgGeo = getBackgroundGeolocation();
  if (!bgGeo || !bgGeo.deviceSettings) return;

  try {
    const isIgnoring = await bgGeo.deviceSettings.isIgnoringBatteryOptimizations();
    if (!isIgnoring) {
      Alert.alert(
        'Background Tracking Required',
        'To keep your family updated during emergencies, please allow the app to run unrestricted in the background.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Settings',
            onPress: () => {
              bgGeo.deviceSettings.showIgnoreBatteryOptimizations();
            },
          },
        ]
      );
    }
  } catch (error) {
    console.warn('[Battery Optimization] Check failed:', error);
  }
}
