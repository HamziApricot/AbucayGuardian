import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';
import './src/services/BackgroundLocationTask';
import { getBackgroundGeolocation } from './src/services/LocationTrackingService';
import App from './App';

// Headless background task for Silent SOS (works when app is minimized, locked, or killed)
AppRegistry.registerHeadlessTask('SilentSOSTask', () => async (taskData) => {
  try {
    const source = taskData?.source || 'manual';
    const { triggerSilentSOS } = require('./src/services/SilentSOSService');
    await triggerSilentSOS(source, { waitForRefinement: true });
  } catch (e) {
    console.warn('[SilentSOSTask] Headless execution error:', e);
  }
});

// Headless background handler for Android (Minimized / App-Kill scenario)
try {
  const notifee = require('@notifee/react-native').default;
  if (notifee && typeof notifee.onBackgroundEvent === 'function') {
    notifee.onBackgroundEvent(async ({ type, detail }) => {
      console.log('[Notifee HeadlessTask] Background event:', type, detail?.pressAction?.id);
      const data = detail?.notification?.data;

      // Type 3 = DELIVERED while minimized/background: play siren & open emergency popup/overlay
      if (type === 3 && data) {
        try {
          const {
            isEmergencyNotificationData,
            normalizeEmergencyAlertData,
            playEmergencyAlarmAudio,
            launchEmergencyPopupOverlay,
          } = require('./src/services/EmergencyNotificationService');

          if (isEmergencyNotificationData(data)) {
            const alertData = normalizeEmergencyAlertData(data);
            if (alertData) {
              const isLoud = alertData.alertType === 'sos' || alertData.alertType === 'loud_ping';
              playEmergencyAlarmAudio(isLoud ? 'alert' : 'notif', alertData.alertType === 'sos').catch(() => {});
              await launchEmergencyPopupOverlay(alertData);
            }
          }
        } catch (err) {
          console.warn('[Notifee HeadlessTask] Background popup launch error:', err);
        }
        return;
      }

      // Dismissed or action pressed: silence alarm, clear overlay & cancel non-persistent notification
      if (type === 0 || type === 2) {
        try {
          const {
            stopEmergencyAlarmAudio,
            dismissEmergencyPopupOverlay,
          } = require('./src/services/EmergencyAudioService');
          await dismissEmergencyPopupOverlay();
          await stopEmergencyAlarmAudio();
        } catch {}
        try {
          const notifId = detail?.notification?.id;
          if (notifId && notifId !== 'ABUCAY_GUARDIAN_PERSISTENT_CONTROL') {
            await notifee.cancelNotification(notifId);
          }
        } catch {}
      }
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

