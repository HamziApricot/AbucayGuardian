import { registerRootComponent } from 'expo';
import './src/services/BackgroundLocationTask';
import { getBackgroundGeolocation } from './src/services/LocationTrackingService';
import App from './App';

// Headless background handler for Android (App-Kill scenario)
try {
  const notifee = require('@notifee/react-native').default;
  if (notifee && typeof notifee.onBackgroundEvent === 'function') {
    notifee.onBackgroundEvent(async ({ type, detail }) => {
      console.log('[Notifee HeadlessTask] Background event:', type, detail?.pressAction?.id);
    });
  }
} catch (e) {
  // Notifee background event registration skipped in non-native environments
}

try {
  const bgGeo = getBackgroundGeolocation();
  if (bgGeo && typeof bgGeo.registerHeadlessTask === 'function') {
    const BackgroundGeolocationHeadlessTask = async (event) => {
      const { name, params } = event;
      console.log('[BackgroundGeolocation HeadlessTask]', name, params);

      if (name === 'location') {
        const location = params;
        // Native SQLite queue and HTTP sync already handled this point.
        // Use this block solely for emergency triggers or SOS geofences.
      }
    };

    bgGeo.registerHeadlessTask(BackgroundGeolocationHeadlessTask);
  }
} catch (e) {
  console.log('[BackgroundGeolocation] Headless task registration skipped:', e);
}

// Register the main app component
registerRootComponent(App);

