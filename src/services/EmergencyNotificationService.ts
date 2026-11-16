import { Platform, Vibration, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';
import { navigateToNotificationTarget } from './NavigationService';
import {
  playEmergencyAlarmAudio,
  stopEmergencyAlarmAudio,
  isDndAccessGranted,
  openDndSettings,
  isOverlayPermissionGranted,
  openOverlaySettings,
  isBatteryOptimizationIgnored,
  openBatteryOptimizationSettings,
  requestOverlayAndBatteryPermissions,
  moveToBackground,
  startKioskMode,
  stopKioskMode,
  isKioskModeActive,
} from './EmergencyAudioService';

export {
  playEmergencyAlarmAudio,
  stopEmergencyAlarmAudio,
  isDndAccessGranted,
  openDndSettings,
  isOverlayPermissionGranted,
  openOverlaySettings,
  isBatteryOptimizationIgnored,
  openBatteryOptimizationSettings,
  requestOverlayAndBatteryPermissions,
  moveToBackground,
  startKioskMode,
  stopKioskMode,
  isKioskModeActive,
};

export const GUARDIAN_QUICK_ACTIONS_CATEGORY = 'GUARDIAN_QUICK_ACTIONS_V2';
export const SAFETY_CHECK_CATEGORY = 'SAFETY_CHECK_CATEGORY_V2';
export const NDRRMC_ALERT_CATEGORY = 'NDRRMC_ALERT_CATEGORY_V3';
export const GUARDIAN_PERSISTENT_NOTIFICATION_ID = 'ABUCAY_GUARDIAN_PERSISTENT_CONTROL';
export const EMERGENCY_ALERT_NOTIFICATION_ID = 'ABUCAY_GUARDIAN_EMERGENCY_ALERT';

// Dedicated Channels & Sounds (Bumped to v3 to break any previous locked-sound caches)
export const NOTIFEE_SIREN_CHANNEL_ID = 'guardian_siren_channel_v3';
export const EXPO_SIREN_CHANNEL_ID = 'guardian_siren_channel_v3';
export const EMERGENCY_ALERT_SOUND = 'alert.mp3';

export const NOTIFEE_CHECKIN_CHANNEL_ID = 'guardian_checkin_channel_v3';
export const EXPO_CHECKIN_CHANNEL_ID = 'guardian_checkin_channel_v3';
export const SAFETY_CHECK_SOUND = 'notif.mp3';

// Backward compatibility aliases
export const NDRRMC_EMERGENCY_CHANNEL_ID = EXPO_SIREN_CHANNEL_ID;
export const NOTIFEE_EMERGENCY_CHANNEL_ID = NOTIFEE_SIREN_CHANNEL_ID;
export const SOS_EMERGENCY_CHANNEL_ID = EXPO_SIREN_CHANNEL_ID;

/**
 * Safely probes whether @notifee/react-native native module is available
 * in the current runtime without throwing when running in un-rebuilt development builds.
 */
function getNotifee(): any {
  try {
    const notifee = require('@notifee/react-native').default;
    if (notifee && typeof notifee.displayNotification === 'function') {
      return notifee;
    }
  } catch {
    // Notifee native module not compiled into binary yet
  }
  return null;
}

// Configure notification behavior when notification arrives (both foreground & background)
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch (e) {
  console.warn('[NotificationService] setNotificationHandler error:', e);
}

let onOpenNDRRMCEmergencyModal: ((data: any) => void) | null = null;
let pendingNDRRMCAlert: any = null;

export function registerNDRRMCModalHandler(handler: ((data: any) => void) | null) {
  onOpenNDRRMCEmergencyModal = handler;
  if (handler && pendingNDRRMCAlert) {
    handler(pendingNDRRMCAlert);
    pendingNDRRMCAlert = null;
  }
}

/**
 * Initializes notification channels and registers quick action categories:
 * 1. Persistent Guardian Controls ("Tracker", RED "🚨 SOS", "Hotlines")
 * 2. Rich Interactive Safety Check-Ins ("✅ I Am Safe", "🚨 Send Help (SOS)", "📍 View Map")
 */
export async function initEmergencyNotifications(): Promise<void> {
  try {
    // 0. Dismiss any orphan/stale notifications from previous app sessions (keeps persistent service intact)
    try {
      await dismissEmergencyAlertNotifications();
    } catch {}

    const { status } = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
        allowDisplayInCarPlay: true,
        provideAppNotificationSettings: true,
      },
    });

    if (status !== 'granted') {
      console.warn('[NotificationService] Notification permission not granted');
    }

    // Ensure Notifee channels are registered with Android OS immediately on app startup
    const notifee = getNotifee();
    if (notifee) {
      try {
        await notifee.requestPermission({ criticalAlert: true });

        // Siren & Loud Ping Channel (alert.mp3)
        await notifee.createChannel({
          id: NOTIFEE_SIREN_CHANNEL_ID,
          name: '🚨 Emergency Siren & Loud Ping',
          importance: notifee.AndroidImportance?.HIGH ?? 4,
          visibility: notifee.AndroidVisibility?.PUBLIC ?? 1,
          bypassDnd: true,
          sound: 'alert',
          lights: true,
          vibration: true,
          vibrationPattern: [300, 500],
        });

        // Safety Check-In Channel (notif.mp3)
        await notifee.createChannel({
          id: NOTIFEE_CHECKIN_CHANNEL_ID,
          name: '⚠️ Safety Check-In Alerts',
          importance: notifee.AndroidImportance?.HIGH ?? 4,
          visibility: notifee.AndroidVisibility?.PUBLIC ?? 1,
          bypassDnd: true,
          sound: 'notif',
          lights: true,
          vibration: true,
          vibrationPattern: [300, 500],
        });

        console.log('[NotificationService] Notifee siren & checkin channels registered on startup');
      } catch (err) {
        console.warn('[NotificationService] Notifee startup channel error:', err);
      }
    }

    // 1. Register Quick Action Buttons category (Persistent Control)
    await Notifications.setNotificationCategoryAsync(GUARDIAN_QUICK_ACTIONS_CATEGORY, [
      {
        identifier: 'ACTION_TRACKER',
        buttonTitle: '📍 Live Tracker',
        options: {
          opensAppToForeground: true,
        },
      },
      {
        identifier: 'ACTION_SOS',
        buttonTitle: '🚨 Emergency SOS',
        options: {
          isDestructive: true, // Red SOS Button on iOS; highlighted emergency action on Android
          opensAppToForeground: true,
        },
      },
      {
        identifier: 'ACTION_HOTLINES',
        buttonTitle: '📞 Hotlines',
        options: {
          opensAppToForeground: true,
        },
      },
    ]);

    // 2. Register Rich Safety Check-In Category (Zero App Open Required!)
    await Notifications.setNotificationCategoryAsync(SAFETY_CHECK_CATEGORY, [
      {
        identifier: 'ACTION_MARK_SAFE',
        buttonTitle: '✅ I Am Safe',
        options: {
          opensAppToForeground: false, // Runs silently in background without opening app UI!
        },
      },
      {
        identifier: 'ACTION_TRIGGER_SOS',
        buttonTitle: '🚨 Send Help (SOS)',
        options: {
          isDestructive: true,
          opensAppToForeground: true,
        },
      },
      {
        identifier: 'ACTION_TRACKER',
        buttonTitle: '📍 View Map',
        options: {
          opensAppToForeground: true,
        },
      },
    ]);

    // 3. Register NDRRMC Emergency Alert Category (Direct Heads-Up Action Buttons)
    await Notifications.setNotificationCategoryAsync(NDRRMC_ALERT_CATEGORY, [
      {
        identifier: 'ACTION_OPEN_ALERT',
        buttonTitle: '⚠️ View Alert Box',
        options: {
          opensAppToForeground: true,
        },
      },
      {
        identifier: 'ACTION_MARK_SAFE',
        buttonTitle: '✅ I Am Safe',
        options: {
          opensAppToForeground: false, // Runs silently in background
        },
      },
      {
        identifier: 'ACTION_TRIGGER_SOS',
        buttonTitle: '🚨 Need Help (SOS)',
        options: {
          isDestructive: true,
          opensAppToForeground: true,
        },
      },
    ]);

    if (Platform.OS === 'android') {
      // Channel for ongoing Quick Safety Controls (100% SILENT - never plays alert sound)
      await Notifications.setNotificationChannelAsync('guardian_controls', {
        name: '🛡️ Guardian Quick Controls',
        importance: Notifications.AndroidImportance.LOW,
        enableVibrate: false,
        enableLights: false,
        sound: null,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });

      // Always ensure Expo emergency channels exist in Android NotificationManager
      // so fallback Notifications.scheduleNotificationAsync never fails with missing channel errors!
      await Notifications.setNotificationChannelAsync(EXPO_SIREN_CHANNEL_ID, {
        name: '🚨 Emergency Siren & Loud Ping',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 800, 200, 800, 200, 1000, 300, 1000],
        enableVibrate: true,
        enableLights: true,
        lightColor: '#DC2626',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
        sound: EMERGENCY_ALERT_SOUND,
        showBadge: true,
      });

      await Notifications.setNotificationChannelAsync(EXPO_CHECKIN_CHANNEL_ID, {
        name: '⚠️ Safety Check-In Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 200, 500],
        enableVibrate: true,
        enableLights: true,
        lightColor: '#2563EB',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
        sound: SAFETY_CHECK_SOUND,
        showBadge: true,
      });

      // Clean up legacy cached channels from previous builds so Android clears any locked system default sound
      const legacyExpoChannels = [
        'guardian_siren_channel_v2',
        'guardian_checkin_channel_v2',
        'guardian_siren_channel_v1',
        'guardian_checkin_channel_v1',
        'checkin_requests',
        'loud_ping',
        'emergency_sos',
        'emergency_sos_v2',
        'ndrrmc_emergency_v3',
        'ndrrmc_emergency_v4',
        'ndrrmc_emergency_v5',
        'ndrrmc_emergency_v6',
      ];
      for (const ch of legacyExpoChannels) {
        try {
          await Notifications.deleteNotificationChannelAsync(ch);
        } catch {}
      }

      if (notifee) {
        const legacyNotifeeChannels = [
          'guardian_siren_channel_v2',
          'guardian_checkin_channel_v2',
          'guardian_siren_channel_v1',
          'guardian_checkin_channel_v1',
          'emergency_alert_channel',
          'emergency_alert_v2',
          'emergency_alert_v3',
          'emergency_alert_v4',
          'emergency-check',
        ];
        for (const ch of legacyNotifeeChannels) {
          try {
            await notifee.deleteChannel(ch);
          } catch {}
        }
      }
    }

    // 3. Handle button clicks & notification interaction (both foreground and background actions)
    Notifications.addNotificationResponseReceivedListener(async (response) => {
      // Silence alarm audio whenever user interacts with an alert notification
      stopEmergencyAlarmAudio().catch(() => {});

      // Dismiss the notification that was interacted with if not persistent control
      const notifId = response.notification?.request?.identifier;
      if (notifId && notifId !== GUARDIAN_PERSISTENT_NOTIFICATION_ID) {
        Notifications.dismissNotificationAsync(notifId).catch(() => {});
      }
      dismissEmergencyAlertNotifications().catch(() => {});

      const actionId = response.actionIdentifier;
      const data = response.notification.request.content.data || {};
      console.log('[NotificationService] Action clicked:', actionId, data);

      // A. ZERO APP OPEN REQUIRED: "I'm Safe" tapped directly in notification
      if (actionId === 'ACTION_MARK_SAFE' || actionId === 'mark_safe') {
        console.log('[NotificationService] Zero-App-Open: User marked themselves safe from notification');
        try {
          const { data: authData } = await supabase.auth.getUser();
          const userId = authData?.user?.id;
          if (userId) {
            // Update Supabase tracker table
            await supabase.from('tracker').upsert({
              user_id: userId,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'user_id' });

            // Broadcast confirmation to entire family circle
            await supabase.channel('family-broadcast').send({
              type: 'broadcast',
              event: 'checkin_reply',
              payload: {
                from_user_id: userId,
                from_name: authData?.user?.user_metadata?.name || 'Family Member',
                is_safe: true,
                replied_at: new Date().toISOString(),
              },
            });

            // Confirmation heads-up banner
            await Notifications.scheduleNotificationAsync({
              content: {
                title: '✅ Status Updated: Safe',
                body: 'Your family circle has been notified that you are safe.',
                sound: true,
                priority: Notifications.AndroidNotificationPriority.DEFAULT,
              },
              trigger: null,
            });
          }
        } catch (e) {
          console.warn('[NotificationService] Background mark safe failed:', e);
        }
        return;
      }

      // B. Immediate Emergency SOS trigger
      if (actionId === 'ACTION_TRIGGER_SOS' || actionId === 'trigger_sos') {
        navigateToNotificationTarget('SOS');
        return;
      }

      // C. NDRRMC Emergency Alert Popup Trigger
      if (
        actionId === 'ACTION_OPEN_ALERT' ||
        data.type === 'ndrrmc_alert' ||
        data.type === 'loud_ping' ||
        data.type === 'checkin' ||
        data.type === 'sos'
      ) {
        const alertData = {
          alertType: data.alertType || (data.type === 'sos' ? 'sos' : data.type === 'loud_ping' ? 'loud_ping' : 'checkin'),
          fromName: data.fromName || data.senderName || data.memberName || 'Family Member',
          fromAvatar: data.avatarUrl || null,
          fromLat: data.lat,
          fromLng: data.lng,
          battery: data.battery,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        if (onOpenNDRRMCEmergencyModal) {
          onOpenNDRRMCEmergencyModal(alertData);
        } else {
          pendingNDRRMCAlert = alertData;
        }
      }

      if (actionId === 'call_911') {
        Linking.openURL('tel:911').catch(() => {});
        return;
      }

      // D. Navigation Actions
      if (actionId === 'ACTION_TRACKER' || actionId === 'view_tracker') {
        navigateToNotificationTarget('Tracker');
      } else if (actionId === 'ACTION_SOS') {
        navigateToNotificationTarget('SOS');
      } else if (actionId === 'ACTION_HOTLINES') {
        navigateToNotificationTarget('Hotlines');
      } else if (actionId === Notifications.DEFAULT_ACTION_IDENTIFIER) {
        // Only navigate to Tracker if not an emergency alert (which opens the NDRRMC modal)
        if (data.type !== 'ndrrmc_alert' && data.type !== 'loud_ping' && data.type !== 'checkin' && data.type !== 'sos') {
          navigateToNotificationTarget('Tracker');
        }
      }
    });

    // Check if app was cold-launched from an NDRRMC emergency notification
    Notifications.getLastNotificationResponseAsync().then((lastResponse) => {
      if (lastResponse) {
        const data = lastResponse.notification.request.content.data || {};
        if (data.type === 'ndrrmc_alert' || data.type === 'loud_ping' || data.type === 'checkin' || data.type === 'sos') {
          const alertData = {
            alertType: data.alertType || (data.type === 'sos' ? 'sos' : data.type === 'loud_ping' ? 'loud_ping' : 'checkin'),
            fromName: data.fromName || data.senderName || data.memberName || 'Family Member',
            fromAvatar: data.avatarUrl || null,
            fromLat: data.lat,
            fromLng: data.lng,
            battery: data.battery,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          };
          if (onOpenNDRRMCEmergencyModal) {
            onOpenNDRRMCEmergencyModal(alertData);
          } else {
            pendingNDRRMCAlert = alertData;
          }
        }
      }
    }).catch(() => {});

    console.log('[NotificationService] Emergency notification channels and quick actions initialized');
  } catch (error) {
    console.warn('[NotificationService] Init failed:', error);
  }
}

/**
 * Shows or updates the ongoing Quick Actions notification:
 * Displays: "📍 Live Tracker", "🚨 Emergency SOS", "📞 Hotlines".
 */
export async function showGuardianQuickActionsNotification(): Promise<void> {
  // 1. Android Notifee Foreground Service (Prevents OS from killing app process when swiped closed)
  const notifee = getNotifee();
  if (notifee && Platform.OS === 'android') {
    try {
      const channelId = await notifee.createChannel({
        id: 'guardian_controls',
        name: '🛡️ Guardian Quick Controls',
        importance: notifee.AndroidImportance?.LOW ?? 2,
        visibility: notifee.AndroidVisibility?.PUBLIC ?? 1,
      });

      await notifee.displayNotification({
        id: GUARDIAN_PERSISTENT_NOTIFICATION_ID,
        title: '🛡️ Abucay Guardian • Live Protection',
        subtitle: '🟢 24/7 Monitor Active',
        body: '24/7 Emergency Protection Active • Tap quick controls below:',
        android: {
          channelId,
          ongoing: true,
          autoCancel: false,
          smallIcon: 'notification_icon',
          color: '#E63946',
          importance: notifee.AndroidImportance?.LOW ?? 2,
          pressAction: {
            id: 'default',
            launchActivity: 'default',
          },
          actions: [
            {
              title: '📍 Live Tracker',
              pressAction: { id: 'ACTION_TRACKER', launchActivity: 'default' },
            },
            {
              title: '🚨 Emergency SOS',
              pressAction: { id: 'ACTION_SOS', launchActivity: 'default' },
            },
            {
              title: '📞 Hotlines',
              pressAction: { id: 'ACTION_HOTLINES', launchActivity: 'default' },
            },
          ],
        },
      });
      console.log('[NotificationService] Notifee Foreground Service active (24/7 background listener protected)');
      return;
    } catch (e) {
      console.warn('[NotificationService] Notifee foreground service fallback:', e);
    }
  }

  // 2. Fallback via Expo Notifications
  try {
    try {
      await Notifications.dismissNotificationAsync(GUARDIAN_PERSISTENT_NOTIFICATION_ID);
    } catch {}

    await Notifications.scheduleNotificationAsync({
      identifier: GUARDIAN_PERSISTENT_NOTIFICATION_ID,
      content: {
        title: '🛡️ Abucay Guardian • Live Protection',
        subtitle: '🟢 Live Shield Active',
        body: '24/7 Safety Active • Tap quick controls below:',
        categoryIdentifier: GUARDIAN_QUICK_ACTIONS_CATEGORY,
        sticky: true,
        autoDismiss: false,
        color: '#E63946',
        priority: Notifications.AndroidNotificationPriority.LOW,
        sound: false, // SILENT - never plays sound
        data: { type: 'quick_actions' },
        ...(Platform.OS === 'android' ? { channelId: 'guardian_controls' } : {}),
      },
      trigger: null,
    });
    console.log('[NotificationService] Quick actions notification displayed via Expo fallback');
  } catch (e) {
    console.warn('[NotificationService] Quick actions notification error:', e);
  }
}

/**
 * Dismisses the persistent quick actions notification / stops Foreground Service when logging out.
 */
export async function dismissGuardianQuickActionsNotification(): Promise<void> {
  const notifee = getNotifee();
  if (notifee && Platform.OS === 'android') {
    try {
      await notifee.cancelNotification(GUARDIAN_PERSISTENT_NOTIFICATION_ID);
    } catch {}
  }
  try {
    await Notifications.dismissNotificationAsync(GUARDIAN_PERSISTENT_NOTIFICATION_ID);
  } catch (e) {
    console.warn('[NotificationService] Dismiss error:', e);
  }
}

/**
 * Dismisses and cancels all active emergency alert notifications (Notifee & Expo),
 * clears any displayed non-persistent notifications, and stops emergency audio/vibration.
 * Keeps the persistent 24/7 background control notification intact.
 */
export async function dismissEmergencyAlertNotifications(): Promise<void> {
  // 1. Stop hardware alarm audio & vibration immediately
  try {
    await stopEmergencyAlarmAudio();
  } catch {}
  try {
    Vibration.cancel();
  } catch {}

  // 2. Dismiss from Notifee
  const notifee = getNotifee();
  if (notifee) {
    try {
      // Cancel standard emergency notification ID
      await notifee.cancelNotification(EMERGENCY_ALERT_NOTIFICATION_ID);

      // Cancel any legacy/category trigger IDs or notifications
      await notifee.cancelNotification('loud_ping');
      await notifee.cancelNotification('checkin');
      await notifee.cancelNotification('sos');

      // Purge all displayed notifications except the persistent background service control
      const displayed = await notifee.getDisplayedNotifications();
      if (Array.isArray(displayed)) {
        for (const notif of displayed) {
          const id = notif.id || notif.notification?.id;
          if (id && id !== GUARDIAN_PERSISTENT_NOTIFICATION_ID) {
            await notifee.cancelNotification(id);
          }
        }
      }

      // Cancel any scheduled trigger notifications for emergency alerts
      const triggerIds = await notifee.getTriggerNotificationIds();
      if (Array.isArray(triggerIds)) {
        for (const trigId of triggerIds) {
          if (trigId !== GUARDIAN_PERSISTENT_NOTIFICATION_ID) {
            await notifee.cancelTriggerNotification(trigId);
          }
        }
      }
    } catch (e) {
      console.warn('[NotificationService] Notifee dismiss emergency error:', e);
    }
  }

  // 3. Dismiss from Expo Notifications
  try {
    await Notifications.dismissNotificationAsync(EMERGENCY_ALERT_NOTIFICATION_ID);
    await Notifications.dismissNotificationAsync('loud_ping');
    await Notifications.dismissNotificationAsync('checkin');
    await Notifications.dismissNotificationAsync('sos');

    // Dismiss all presented notifications except the persistent background control
    const presented = await Notifications.getPresentedNotificationsAsync();
    if (Array.isArray(presented)) {
      for (const p of presented) {
        const id = p.request?.identifier;
        if (id && id !== GUARDIAN_PERSISTENT_NOTIFICATION_ID) {
          await Notifications.dismissNotificationAsync(id);
        }
      }
    }
  } catch (e) {
    console.warn('[NotificationService] Expo dismiss emergency error:', e);
  }
}

/**
 * Triggers a heads-up system notification for an SOS event with quick actions.
 */
export async function triggerSOSNotification(
  senderName: string,
  lat?: number,
  lng?: number,
  battery?: number | null
): Promise<void> {
  // Clear any existing stale emergency notifications first
  await dismissEmergencyAlertNotifications().catch(() => {});

  Vibration.vibrate([0, 600, 200, 600, 200, 1000, 300, 1000]);

  // Bulletproof fallback: trigger hardware STREAM_ALARM (bypasses Silent, Vibrate & DND)
  playEmergencyAlarmAudio('alert', true).catch(() => {});

  const notifee = getNotifee();
  if (notifee) {
    try {
      await notifee.requestPermission({ criticalAlert: true });
      const channelId = await notifee.createChannel({
        id: NOTIFEE_SIREN_CHANNEL_ID,
        name: '🚨 Emergency Siren & Loud Ping',
        importance: notifee.AndroidImportance?.HIGH ?? 4,
        visibility: notifee.AndroidVisibility?.PUBLIC ?? 1,
        bypassDnd: true,
        sound: 'alert',
        lights: true,
        vibration: true,
        vibrationPattern: [300, 500],
      });

      await notifee.displayNotification({
        id: EMERGENCY_ALERT_NOTIFICATION_ID,
        title: '🚨 EMERGENCY SOS ALERT!',
        body: `${senderName} broadcasted an emergency SOS! Live coordinates and battery (${battery ? `${Math.round(battery * 100)}%` : 'Active'}) reported.`,
        data: {
          type: 'sos',
          alertType: 'sos',
          fromName: senderName,
          senderName,
          lat,
          lng,
          battery,
          emergencyId: 'sos',
        },
        android: {
          channelId,
          sound: 'alert',
          smallIcon: 'notification_icon',
          color: '#DC2626',
          importance: notifee.AndroidImportance?.HIGH ?? 4,
          category: notifee.AndroidCategory?.ALARM ?? 'alarm', // ALARM category wakes screen & triggers Full-Screen Intent!
          visibility: notifee.AndroidVisibility?.PUBLIC ?? 1,
          ongoing: false,
          autoCancel: true,
          fullScreenAction: {
            id: 'default',
            launchActivity: 'default',
          },
          pressAction: { id: 'default', launchActivity: 'default' },
          actions: [
            {
              title: '📍 View on Map',
              pressAction: { id: 'view_tracker', launchActivity: 'default' },
            },
            {
              title: '📞 Call 911',
              pressAction: { id: 'call_911' },
            },
            {
              title: '⚠️ View Alert Box',
              pressAction: { id: 'default', launchActivity: 'default' },
            },
          ],
        },
        ios: {
          sound: EMERGENCY_ALERT_SOUND,
          interruptionLevel: 'timeSensitive',
        },
      });
      return;
    } catch (e) {
      console.warn('[NotificationService] Notifee SOS fallback:', e);
    }
  }

  // Universal Fallback via expo-notifications
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: EMERGENCY_ALERT_NOTIFICATION_ID,
      content: {
        title: '🚨 EMERGENCY SOS ALERT!',
        body: `${senderName} broadcasted an emergency SOS! Live coordinates and battery (${battery ? `${Math.round(battery * 100)}%` : 'Active'}) reported.`,
        sound: EMERGENCY_ALERT_SOUND,
        categoryIdentifier: GUARDIAN_QUICK_ACTIONS_CATEGORY,
        priority: Notifications.AndroidNotificationPriority.MAX,
        interruptionLevel: 'timeSensitive',
        data: {
          type: 'sos',
          alertType: 'sos',
          fromName: senderName,
          senderName,
          lat,
          lng,
          battery,
        },
      },
      trigger: (Platform.OS === 'android' ? { channelId: EXPO_SIREN_CHANNEL_ID } : null) as any,
    });
  } catch (e) {
    console.warn('[NotificationService] SOS notification error:', e);
  }
}

/**
 * Triggers a heads-up system notification for a Loud Ping with quick actions.
 * On Android, uses Notifee Full-Screen Action with ALARM category to wake the device
 * and pop up directly over the lock screen and minimized screen.
 */
export async function triggerLoudPingNotification(fromName: string): Promise<void> {
  // Clear any existing stale emergency notifications first
  await dismissEmergencyAlertNotifications().catch(() => {});

  // 1. Hardware vibration
  Vibration.vibrate([0, 800, 200, 800, 200, 1000]);

  // 2. Bulletproof fallback: trigger hardware STREAM_ALARM (bypasses Silent, Vibrate & DND)
  playEmergencyAlarmAudio('alert', false).catch(() => {});

  const notifee = getNotifee();
  if (notifee) {
    try {
      await notifee.requestPermission({ criticalAlert: true });
      const channelId = await notifee.createChannel({
        id: NOTIFEE_SIREN_CHANNEL_ID,
        name: '🚨 Emergency Siren & Loud Ping',
        importance: notifee.AndroidImportance?.HIGH ?? 4,
        visibility: notifee.AndroidVisibility?.PUBLIC ?? 1,
        bypassDnd: true,
        sound: 'alert',
        lights: true,
        vibration: true,
        vibrationPattern: [300, 500],
      });

      await notifee.displayNotification({
        id: EMERGENCY_ALERT_NOTIFICATION_ID,
        title: '🚨 EMERGENCY ALERT (LOUD PING)',
        body: `${fromName} triggered an emergency loud alarm on your phone!`,
        data: { type: 'ndrrmc_alert', alertType: 'loud_ping', fromName, emergencyId: 'loud_ping' },
        android: {
          channelId,
          sound: 'alert',
          smallIcon: 'notification_icon',
          color: '#DC2626',
          importance: notifee.AndroidImportance?.HIGH ?? 4,
          category: notifee.AndroidCategory?.ALARM ?? 'alarm', // ALARM category wakes the device and triggers Full-Screen Intent!
          visibility: notifee.AndroidVisibility?.PUBLIC ?? 1,
          ongoing: false,
          autoCancel: true,
          fullScreenAction: {
            id: 'default',
            launchActivity: 'default', // Launches MainActivity over lock screen & launcher!
          },
          pressAction: {
            id: 'default',
            launchActivity: 'default',
          },
          actions: [
            {
              title: '⚠️ View Alert Box',
              pressAction: { id: 'default', launchActivity: 'default' },
            },
            {
              title: '✅ I Am Safe',
              pressAction: { id: 'mark_safe' },
            },
            {
              title: '🚨 SOS',
              pressAction: { id: 'trigger_sos', launchActivity: 'default' },
            },
          ],
        },
        ios: {
          sound: EMERGENCY_ALERT_SOUND,
          interruptionLevel: 'timeSensitive',
        },
      });
      console.log('[NotificationService] Loud ping displayed via Notifee Full-Screen Intent (sound: alert)');
      return;
    } catch (e) {
      console.warn('[NotificationService] Notifee loud ping fallback:', e);
    }
  }

  // Universal Fallback via expo-notifications
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: EMERGENCY_ALERT_NOTIFICATION_ID,
      content: {
        title: '🚨 EMERGENCY ALERT (LOUD PING)',
        subtitle: '⚠️ NDRRMC PROTOCOL',
        body: `${fromName} triggered an emergency loud alarm on your phone! Tap to open alert box.`,
        sound: EMERGENCY_ALERT_SOUND,
        categoryIdentifier: NDRRMC_ALERT_CATEGORY,
        priority: Notifications.AndroidNotificationPriority.MAX,
        interruptionLevel: 'timeSensitive',
        data: { type: 'ndrrmc_alert', alertType: 'loud_ping', fromName },
        ...(Platform.OS === 'android' ? { channelId: EXPO_SIREN_CHANNEL_ID } : {}),
      },
      trigger: (Platform.OS === 'android' ? { channelId: EXPO_SIREN_CHANNEL_ID } : null) as any,
    });
  } catch (e) {
    console.warn('[NotificationService] Loud ping notification error:', e);
  }
}

/**
 * Triggers a Rich Interactive "Are You Safe?" notification featuring:
 * 1. Circular Avatar: round profile picture of the requester
 * 2. Static Map Preview / Snapshot: exact pin location snapshot
 * 3. One-Tap Action Buttons (Zero App Open Required):
 *    - "✅ I Am Safe" (background execution without opening app UI)
 *    - "🚨 Send Help (SOS)" (destructive emergency action)
 *    - "📍 View Map"
 * 4. Critical Alert bypass support
 */
export async function sendSafetyCheckNotification(
  memberName: string,
  avatarUrl?: string,
  mapSnapshotUrl?: string,
  lat?: number,
  lng?: number
): Promise<void> {
  // Clear any existing stale emergency notifications first
  await dismissEmergencyAlertNotifications().catch(() => {});

  const resolvedMapUrl =
    mapSnapshotUrl ||
    (lat && lng
      ? `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=15&size=600x300&markers=${lat},${lng},ol-marker`
      : undefined);

  // 1. Hardware vibration
  Vibration.vibrate([0, 500, 200, 500]);

  // 2. Bulletproof fallback: trigger hardware STREAM_ALARM (bypasses Silent, Vibrate & DND)
  playEmergencyAlarmAudio('notif', false).catch(() => {});

  // 3. If @notifee/react-native native module is present in the build, use its full native power
  const notifee = getNotifee();
  if (notifee) {
    try {
      await notifee.requestPermission({ criticalAlert: true });
      const channelId = await notifee.createChannel({
        id: NOTIFEE_CHECKIN_CHANNEL_ID,
        name: '⚠️ Safety Check-In Alerts',
        importance: notifee.AndroidImportance?.HIGH ?? 4,
        visibility: notifee.AndroidVisibility?.PUBLIC ?? 1,
        bypassDnd: true,
        sound: 'notif',
        lights: true,
        vibration: true,
        vibrationPattern: [300, 500],
      });

      const notifConfig = {
        id: EMERGENCY_ALERT_NOTIFICATION_ID,
        title: `⚠️ ARE YOU SAFE? • ${memberName}`,
        body: `${memberName} sent a priority safety check-in request. Tap to confirm.`,
        data: {
          type: 'ndrrmc_alert',
          alertType: 'checkin',
          memberName,
          fromName: memberName,
          emergencyId: 'checkin',
          lat,
          lng,
        },
        android: {
          channelId,
          sound: 'notif',
          smallIcon: 'notification_icon',
          color: '#2563EB',
          importance: notifee.AndroidImportance?.HIGH ?? 4,
          category: notifee.AndroidCategory?.ALARM ?? 'alarm', // Wakes the screen and triggers Full-Screen Intent
          visibility: notifee.AndroidVisibility?.PUBLIC ?? 1,
          ongoing: false,
          autoCancel: true,
          largeIcon: avatarUrl || undefined,
          circularLargeIcon: true, // Renders member avatar as a round circle
          fullScreenAction: {
            id: 'default',
            launchActivity: 'default', // Launches MainActivity over lock screen & launcher!
          },
          pressAction: { id: 'default', launchActivity: 'default' },
          style: resolvedMapUrl
            ? {
                type: notifee.AndroidStyle?.BIGPICTURE ?? 0,
                picture: resolvedMapUrl, // Static map snapshot pin
              }
            : undefined,
          actions: [
            {
              title: '✅ I Am Safe',
              pressAction: { id: 'mark_safe' }, // Runs in background without opening UI
            },
            {
              title: '🚨 Send Help (SOS)',
              pressAction: { id: 'trigger_sos', launchActivity: 'default' },
            },
            {
              title: '📍 View Map',
              pressAction: { id: 'view_tracker', launchActivity: 'default' },
            },
          ],
        },
        ios: {
          categoryId: SAFETY_CHECK_CATEGORY,
          attachments: resolvedMapUrl ? [{ identifier: 'map-snapshot', url: resolvedMapUrl, type: 'image' }] : [],
          sound: SAFETY_CHECK_SOUND,
          interruptionLevel: 'timeSensitive',
        },
      };

      try {
        await notifee.displayNotification(notifConfig);
        console.log('[RichNotification] Displayed via Notifee native engine (sound: notif)');
        return;
      } catch (styleErr) {
        if (resolvedMapUrl) {
          try {
            const fallbackConfig = { ...notifConfig, android: { ...notifConfig.android, style: undefined } };
            await notifee.displayNotification(fallbackConfig);
            console.log('[RichNotification] Displayed via Notifee without static map image');
            return;
          } catch (retryErr) {
            console.warn('[RichNotification] Notifee retry without image failed:', retryErr);
          }
        }
      }
    } catch (e) {
      console.warn('[RichNotification] Notifee display fallback:', e);
    }
  }

  // 4. Seamless Universal Fallback via expo-notifications
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: EMERGENCY_ALERT_NOTIFICATION_ID,
      content: {
        title: '⚠️ EMERGENCY ALERT: ARE YOU SAFE?',
        subtitle: '🚨 NDRRMC-STYLE SAFETY CHECK',
        body: `${memberName} asked: Are you safe? Tap immediately to confirm your status.`,
        sound: SAFETY_CHECK_SOUND,
        categoryIdentifier: SAFETY_CHECK_CATEGORY,
        priority: Notifications.AndroidNotificationPriority.MAX,
        interruptionLevel: 'timeSensitive',
        data: {
          type: 'ndrrmc_alert',
          alertType: 'checkin',
          memberName,
          avatarUrl,
          mapSnapshotUrl: resolvedMapUrl,
          lat,
          lng,
        },
        ...(Platform.OS === 'android' ? { channelId: EXPO_CHECKIN_CHANNEL_ID } : {}),
      },
      trigger: (Platform.OS === 'android' ? { channelId: EXPO_CHECKIN_CHANNEL_ID } : null) as any,
    });
    console.log('[RichNotification] Displayed via Expo rich categories engine (sound: notif)');
  } catch (e) {
    console.warn('[RichNotification] Safety check notification error:', e);
  }
}

/**
 * Triggers a heads-up system notification for a Safety Check-in with quick actions.
 */
export async function triggerCheckInNotification(
  fromName: string,
  avatarUrl?: string,
  lat?: number,
  lng?: number
): Promise<void> {
  await sendSafetyCheckNotification(fromName, avatarUrl, undefined, lat, lng);
}

/**
 * Registers the device's push token with Supabase so emergency alerts can reach
 * iOS and Android devices via APNs / FCM even when the app is completely closed or screen is off.
 */
export async function registerPushToken(userId: string): Promise<string | null> {
  if (!userId) return null;
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync().catch(() => null);
    const pushToken = tokenData?.data;
    if (pushToken) {
      // 1. Update Supabase users table (ignoring error if column not yet added)
      try {
        await supabase.from('users').update({ push_token: pushToken }).eq('id', userId);
      } catch {}

      // 2. Also save into auth user_metadata so it is permanently accessible
      try {
        await supabase.auth.updateUser({ data: { push_token: pushToken } });
      } catch {}

      console.log('[NotificationService] Push token registered for closed-app delivery:', pushToken);
      return pushToken;
    }
  } catch (e) {
    console.warn('[NotificationService] Failed to obtain push token:', e);
  }
  return null;
}

/**
 * Sends a high-priority Time-Sensitive push notification directly to family members' devices.
 * Uses Apple Push Notification service (APNs) and FCM via Expo Push API to:
 * 1. Wake the iPhone / Android device even when screen is locked or app is closed.
 * 2. Break through Do Not Disturb (DND) and Focus modes on iOS (interruptionLevel: timeSensitive).
 * 3. Play the siren alert sound (alert.mp3 / notif.mp3).
 * 4. Display action buttons (I'm Safe, Send Help SOS, View Alert Box) on the lock screen.
 */
export async function sendEmergencyPushNotification(
  targetUserIds: string[],
  title: string,
  body: string,
  alertType: 'sos' | 'loud_ping' | 'checkin',
  senderName: string,
  lat?: number,
  lng?: number,
  battery?: number | null
): Promise<void> {
  if (!targetUserIds || targetUserIds.length === 0) return;

  try {
    const { data: usersWithTokens, error } = await supabase
      .from('users')
      .select('id, push_token')
      .in('id', targetUserIds);

    if (error || !usersWithTokens) {
      console.warn('[NotificationService] Could not fetch target push tokens:', error);
      return;
    }

    const tokens = usersWithTokens
      .map((u: any) => u.push_token)
      .filter((t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken'));

    if (tokens.length === 0) {
      console.log('[NotificationService] No push tokens found for targeted family members');
      return;
    }

    const isLoud = alertType === 'sos' || alertType === 'loud_ping';
    const soundFile = isLoud ? EMERGENCY_ALERT_SOUND : SAFETY_CHECK_SOUND;
    const categoryId = alertType === 'checkin' ? SAFETY_CHECK_CATEGORY : NDRRMC_ALERT_CATEGORY;

    const messages = tokens.map((toToken: string) => ({
      to: toToken,
      sound: soundFile,
      title,
      body,
      priority: 'high',
      channelId: isLoud ? EXPO_SIREN_CHANNEL_ID : EXPO_CHECKIN_CHANNEL_ID,
      categoryId,
      _displayInForeground: true,
      interruptionLevel: 'timeSensitive', // iOS 15+ Time-Sensitive (bypasses DND without Apple Critical Alerts waiver)
      data: {
        type: alertType === 'sos' ? 'sos' : 'ndrrmc_alert',
        alertType,
        fromName: senderName,
        lat,
        lng,
        battery,
      },
    }));

    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    console.log(`[NotificationService] Dispatched Time-Sensitive push notification to ${tokens.length} family devices`);
  } catch (err) {
    console.warn('[NotificationService] Failed to dispatch emergency push notification:', err);
  }
}

export interface EmergencyAlertCallbacks {
  onLoudPing?: (fromName: string) => void;
  onCheckInRequest?: (fromName: string, fromAvatar?: string, lat?: number, lng?: number) => void;
  onCheckInReply?: (fromName: string, isSafe: boolean) => void;
  onSOSAlert?: (fromName: string, lat?: number, lng?: number, battery?: number | null) => void;
}

// Persistent singleton listeners: Keeps WebSocket alive inside Android Foreground Service
let activeListeningUserId: string | null = null;
let currentAlertCallbacks: EmergencyAlertCallbacks | null = null;
let activeSosChannel: any = null;
let activeBroadcastChannel: any = null;

// In-memory set of verified family member user IDs for the active user
// Used for high-performance 0ms family membership checks to prevent stranger SOS alarms
const knownFamilyMemberUserIds = new Set<string>();
let lastFamilyFetchTime = 0;

/**
 * Refreshes the in-memory cache of verified family member IDs for the current user.
 */
export async function refreshKnownFamilyMembers(currentUserId: string): Promise<Set<string>> {
  if (!currentUserId) return knownFamilyMemberUserIds;
  try {
    const { data, error } = await supabase
      .from('family_members')
      .select('member_user_id')
      .eq('user_id', currentUserId);

    if (!error && data) {
      knownFamilyMemberUserIds.clear();
      data.forEach((row: any) => {
        if (row.member_user_id) {
          knownFamilyMemberUserIds.add(row.member_user_id);
        }
      });
      lastFamilyFetchTime = Date.now();
    }
  } catch (e) {
    console.warn('[NotificationService] Failed to refresh known family members:', e);
  }
  return knownFamilyMemberUserIds;
}

/**
 * Authoritative check to determine if senderId is in currentUserId's family circle.
 * Prevents strangers / non-family members from triggering emergency SOS alarms.
 */
export async function isUserInFamily(currentUserId: string, senderId?: string | null): Promise<boolean> {
  if (!currentUserId || !senderId) return false;
  if (currentUserId === senderId) return true; // Self

  // 1. Fast in-memory check (0ms)
  if (knownFamilyMemberUserIds.has(senderId)) {
    return true;
  }

  // 2. If memory cache is empty or older than 60s, refresh it
  if (knownFamilyMemberUserIds.size === 0 || Date.now() - lastFamilyFetchTime > 60000) {
    await refreshKnownFamilyMembers(currentUserId);
    if (knownFamilyMemberUserIds.has(senderId)) {
      return true;
    }
  }

  // 3. Check AsyncStorage cache
  try {
    const cached = await AsyncStorage.getItem('@abucay_cached_family_members');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        for (const m of parsed) {
          if (m.member_user_id === senderId || m.user_id === senderId) {
            knownFamilyMemberUserIds.add(senderId);
            return true;
          }
        }
      }
    }
  } catch {}

  // 4. Authoritative query directly in Supabase (checks both directions of pairing)
  try {
    const { data: forwardCheck } = await supabase
      .from('family_members')
      .select('id')
      .eq('user_id', currentUserId)
      .eq('member_user_id', senderId)
      .limit(1);

    if (forwardCheck && forwardCheck.length > 0) {
      knownFamilyMemberUserIds.add(senderId);
      return true;
    }

    const { data: reverseCheck } = await supabase
      .from('family_members')
      .select('id')
      .eq('user_id', senderId)
      .eq('member_user_id', currentUserId)
      .limit(1);

    if (reverseCheck && reverseCheck.length > 0) {
      knownFamilyMemberUserIds.add(senderId);
      return true;
    }
  } catch (e) {
    console.warn('[NotificationService] Authoritative family check error:', e);
  }

  return false;
}

/**
 * Tears down Supabase real-time channels when the user explicitly logs out.
 */
export function stopEmergencyAlertMonitoring(): void {
  if (activeSosChannel) {
    try { supabase.removeChannel(activeSosChannel); } catch {}
    activeSosChannel = null;
  }
  if (activeBroadcastChannel) {
    try { supabase.removeChannel(activeBroadcastChannel); } catch {}
    activeBroadcastChannel = null;
  }
  knownFamilyMemberUserIds.clear();
  lastFamilyFetchTime = 0;
  activeListeningUserId = null;
  currentAlertCallbacks = null;
}

/**
 * Listens for incoming emergency alerts across the whole app.
 * In conjunction with the Android Foreground Service, this listener stays connected
 * and active 24/7 even when the app is swiped away from recent apps!
 */
export function listenForEmergencyAlerts(
  currentUserId: string,
  callbacks?: EmergencyAlertCallbacks
): () => void {
  if (!currentUserId) return () => {};

  currentAlertCallbacks = callbacks || null;

  // Eagerly pre-populate verified family members for instant 0ms checks
  refreshKnownFamilyMembers(currentUserId);

  // If already subscribed for this user, keep the live WebSocket channel running!
  if (activeListeningUserId === currentUserId && activeSosChannel && activeBroadcastChannel) {
    return () => {
      currentAlertCallbacks = null;
    };
  }

  // If switched user, clean up old channels
  if (activeListeningUserId && activeListeningUserId !== currentUserId) {
    stopEmergencyAlertMonitoring();
  }

  activeListeningUserId = currentUserId;

  // 1. Listen for new SOS events in Supabase database
  activeSosChannel = supabase
    .channel(`global-sos-${currentUserId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'sos_events' },
      async (payload) => {
        const newEvent = payload.new as any;
        if (!newEvent || newEvent.status !== 'active') return;
        if (newEvent.user_id === currentUserId) return; // Do not alert self from DB insert

        // Security check: ONLY alert if the sender belongs to current user's family circle!
        const isFamily = await isUserInFamily(currentUserId, newEvent.user_id);
        if (!isFamily) {
          console.log(`[SOS] Dropped SOS database event: ${newEvent.user_id} is not in family`);
          return;
        }

        // Fetch sender name & avatar
        const { data: userData } = await supabase
          .from('users')
          .select('name, avatar_url')
          .eq('id', newEvent.user_id)
          .single();

        const name = userData?.name || 'A family member';
        triggerSOSNotification(name, newEvent.lat, newEvent.lng);

        const alertData = {
          alertType: 'sos' as const,
          fromName: name,
          fromAvatar: userData?.avatar_url || null,
          fromLat: newEvent.lat,
          fromLng: newEvent.lng,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };

        if (onOpenNDRRMCEmergencyModal) {
          onOpenNDRRMCEmergencyModal(alertData);
        } else {
          pendingNDRRMCAlert = alertData;
        }
        currentAlertCallbacks?.onSOSAlert?.(name, newEvent.lat, newEvent.lng);
      }
    )
    .subscribe();

  // 2. Listen for Realtime Broadcast events (Loud Ping, Check-in, SOS Broadcast)
  activeBroadcastChannel = supabase
    .channel('family-broadcast')
    .on('broadcast', { event: 'sos_alert' }, async (event) => {
      const payload = event.payload;
      if (!payload) return;
      if (payload.from_user_id === currentUserId && !payload.is_test) return;

      // Check 1: If sender specified target_family_user_ids, check membership instantly
      if (
        Array.isArray(payload.target_family_user_ids) &&
        !payload.target_family_user_ids.includes(currentUserId) &&
        !payload.is_test
      ) {
        console.log(`[SOS] Ignored broadcast SOS: current user is not in target_family_user_ids`);
        return;
      }

      // Check 2: Authoritative family verification (prevents non-family members from triggering sirens)
      if (!payload.is_test) {
        const isFamily = await isUserInFamily(currentUserId, payload.from_user_id);
        if (!isFamily) {
          console.log(`[SOS] Ignored broadcast SOS: sender ${payload.from_user_id} is not in family circle`);
          return;
        }
      }

      const sender = payload.from_name || 'Family Circle';
      triggerSOSNotification(sender, payload.lat, payload.lng, payload.battery);

      const alertData = {
        alertType: 'sos' as const,
        fromName: sender,
        fromAvatar: payload.from_avatar || null,
        fromLat: payload.lat,
        fromLng: payload.lng,
        battery: payload.battery,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      if (onOpenNDRRMCEmergencyModal) {
        onOpenNDRRMCEmergencyModal(alertData);
      } else {
        pendingNDRRMCAlert = alertData;
      }
      currentAlertCallbacks?.onSOSAlert?.(sender, payload.lat, payload.lng, payload.battery);

      try {
        const deepUrl = `abucayguardian://emergency-alert?type=sos&from=${encodeURIComponent(sender)}`;
        Linking.openURL(deepUrl).catch(() => {});
      } catch {}
    })
    .on('broadcast', { event: 'loud_ping' }, async (event) => {
      const payload = event.payload;
      if (!payload) return;
      if (payload.from_user_id === currentUserId && !payload.is_test) return;

      // Must explicitly target current user or be a local test
      const isTarget =
        payload.to_member_id === currentUserId ||
        payload.to_user_id === currentUserId ||
        payload.to_row_id === currentUserId ||
        Boolean(payload.is_test);

      if (!isTarget) return;

      // Verify sender is in family
      if (!payload.is_test) {
        const isFamily = await isUserInFamily(currentUserId, payload.from_user_id);
        if (!isFamily) {
          console.log(`[LoudPing] Ignored ping from non-family sender: ${payload.from_user_id}`);
          return;
        }
      }

      const sender = payload.from_name || 'Family Circle';
      triggerLoudPingNotification(sender);

      const alertData = {
        alertType: 'loud_ping' as const,
        fromName: sender,
        fromAvatar: payload.from_avatar || null,
        fromLat: payload.from_lat,
        fromLng: payload.from_lng,
        battery: payload.battery,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      if (onOpenNDRRMCEmergencyModal) {
        onOpenNDRRMCEmergencyModal(alertData);
      } else {
        pendingNDRRMCAlert = alertData;
      }

      currentAlertCallbacks?.onLoudPing?.(sender);

      try {
        const deepUrl = `abucayguardian://emergency-alert?type=loud_ping&from=${encodeURIComponent(sender)}`;
        Linking.openURL(deepUrl).catch(() => {});
      } catch {}
    })
    .on('broadcast', { event: 'checkin_request' }, async (event) => {
      const payload = event.payload;
      if (!payload) return;
      if (payload.from_user_id === currentUserId && !payload.is_test) return;

      // Must explicitly target current user or be a local test
      const isTarget =
        payload.to_member_id === currentUserId ||
        payload.to_user_id === currentUserId ||
        payload.to_row_id === currentUserId ||
        Boolean(payload.is_test);

      if (!isTarget) return;

      // Verify sender is in family
      if (!payload.is_test) {
        const isFamily = await isUserInFamily(currentUserId, payload.from_user_id);
        if (!isFamily) {
          console.log(`[CheckIn] Ignored checkin from non-family sender: ${payload.from_user_id}`);
          return;
        }
      }

      const sender = payload.from_name || 'Family Circle';
      sendSafetyCheckNotification(
        sender,
        payload.from_avatar,
        undefined,
        payload.from_lat,
        payload.from_lng
      );

      const alertData = {
        alertType: 'checkin' as const,
        fromName: sender,
        fromAvatar: payload.from_avatar || null,
        fromLat: payload.from_lat,
        fromLng: payload.from_lng,
        battery: payload.battery,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      if (onOpenNDRRMCEmergencyModal) {
        onOpenNDRRMCEmergencyModal(alertData);
      } else {
        pendingNDRRMCAlert = alertData;
      }

      currentAlertCallbacks?.onCheckInRequest?.(
        sender,
        payload.from_avatar,
        payload.from_lat,
        payload.from_lng
      );

      try {
        const deepUrl = `abucayguardian://emergency-alert?type=checkin&from=${encodeURIComponent(sender)}`;
        Linking.openURL(deepUrl).catch(() => {});
      } catch {}
    })
    .on('broadcast', { event: 'checkin_reply' }, (event) => {
      const payload = event.payload;
      if (!payload || payload.from_user_id === currentUserId) return;

      if (payload.is_safe) {
        const sender = payload.from_name || 'Family Member';
        Notifications.scheduleNotificationAsync({
          content: {
            title: `✅ ${sender} is Safe!`,
            body: 'Their status on the family map has been updated to Safe.',
            sound: true,
            priority: Notifications.AndroidNotificationPriority.DEFAULT,
          },
          trigger: null,
        }).catch(() => {});
        currentAlertCallbacks?.onCheckInReply?.(sender, true);
      }
    })
    .subscribe();

  return () => {
    // Only detach if currentAlertCallbacks has not been replaced by another component
    if (currentAlertCallbacks === callbacks) {
      currentAlertCallbacks = null;
    }
  };
}

/**
 * Single-device test helper: Triggers an NDRRMC emergency alert locally
 * either immediately (in-app test) or after a countdown (minimized/lockscreen test).
 */
export async function triggerTestNDRRMCAlert(
  alertType: 'loud_ping' | 'checkin' | 'sos',
  delaySeconds: number = 0,
  senderName: string = 'NDRRMC / Family Member'
): Promise<void> {
  const isSOS = alertType === 'sos';
  const alertData = {
    alertType,
    fromName: senderName,
    fromLat: 14.7352,
    fromLng: 120.5312,
    battery: 0.88,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };

  if (delaySeconds <= 0) {
    if (onOpenNDRRMCEmergencyModal) {
      onOpenNDRRMCEmergencyModal(alertData);
    } else {
      pendingNDRRMCAlert = alertData;
    }
    if (isSOS) {
      await triggerSOSNotification(senderName, 14.7352, 120.5312, 0.88);
    } else if (alertType === 'loud_ping') {
      await triggerLoudPingNotification(senderName);
    } else {
      await sendSafetyCheckNotification(senderName);
    }
    return;
  }

  // Clear any existing stale emergency notifications first
  await dismissEmergencyAlertNotifications().catch(() => {});

  // NATIVE ALARM SCHEDULING (Never paused by Android OS sleep or Doze mode!)
  const notifee = getNotifee();
  if (notifee) {
    try {
      const isLoud = alertType === 'loud_ping' || alertType === 'sos';
      const channelId = isLoud ? NOTIFEE_SIREN_CHANNEL_ID : NOTIFEE_CHECKIN_CHANNEL_ID;
      const soundName = isLoud ? 'alert' : 'notif';
      const channelName = isSOS
        ? '🚨 Emergency SOS Distress'
        : isLoud
        ? '🚨 Emergency Siren & Loud Ping'
        : '⚠️ Safety Check-In Alerts';

      await notifee.createChannel({
        id: channelId,
        name: channelName,
        importance: notifee.AndroidImportance?.HIGH ?? 4,
        visibility: notifee.AndroidVisibility?.PUBLIC ?? 1,
        bypassDnd: true,
        sound: soundName,
        lights: true,
        vibration: true,
        vibrationPattern: [300, 500],
      });

      const trigger = {
        type: notifee.TriggerType?.TIMESTAMP ?? 0,
        timestamp: Date.now() + (delaySeconds * 1000),
        alarmManager: {
          allowWhileIdle: true,
        },
      };

      const notifTitle = isSOS
        ? '🚨 EMERGENCY SOS ALERT (TEST)'
        : alertType === 'loud_ping'
        ? '🚨 EMERGENCY ALERT (LOUD PING)'
        : '⚠️ ARE YOU SAFE? • NDRRMC';

      const notifBody = isSOS
        ? `${senderName} broadcasted an emergency SOS! Tap to view live distress map.`
        : alertType === 'loud_ping'
        ? `${senderName} triggered an emergency alarm on your phone!`
        : `${senderName} requested an urgent safety check-in!`;

      await notifee.createTriggerNotification(
        {
          id: EMERGENCY_ALERT_NOTIFICATION_ID,
          title: notifTitle,
          body: notifBody,
          data: {
            type: isSOS ? 'sos' : 'ndrrmc_alert',
            alertType,
            fromName: senderName,
            emergencyId: alertType,
            lat: 14.7352,
            lng: 120.5312,
            battery: 0.88,
          },
          android: {
            channelId,
            sound: soundName,
            smallIcon: 'notification_icon',
            color: isSOS ? '#B91C1C' : isLoud ? '#DC2626' : '#2563EB',
            importance: notifee.AndroidImportance?.HIGH ?? 4,
            category: notifee.AndroidCategory?.ALARM ?? 'alarm', // Wakes the device and triggers Full-Screen Intent
            visibility: notifee.AndroidVisibility?.PUBLIC ?? 1,
            ongoing: false,
            autoCancel: true,
            fullScreenAction: {
              id: 'default',
              launchActivity: 'default',
            },
            pressAction: {
              id: 'default',
              launchActivity: 'default',
            },
            actions: isSOS
              ? [
                  {
                    title: '📍 View on Map',
                    pressAction: { id: 'view_tracker', launchActivity: 'default' },
                  },
                  {
                    title: '📞 Call 911',
                    pressAction: { id: 'call_911' },
                  },
                  {
                    title: '⚠️ View Alert Box',
                    pressAction: { id: 'default', launchActivity: 'default' },
                  },
                ]
              : [
                  {
                    title: '⚠️ View Alert Box',
                    pressAction: { id: 'default', launchActivity: 'default' },
                  },
                  {
                    title: '✅ I Am Safe',
                    pressAction: { id: 'mark_safe' },
                  },
                  {
                    title: '🚨 SOS',
                    pressAction: { id: 'trigger_sos', launchActivity: 'default' },
                  },
                ],
          },
          ios: {
            critical: true,
            criticalVolume: 1.0,
            sound: isLoud ? EMERGENCY_ALERT_SOUND : SAFETY_CHECK_SOUND,
            interruptionLevel: 'critical',
          },
        },
        trigger as any
      );
      console.log(`[NotificationService] Native hardware trigger scheduled for ${delaySeconds}s from now (sound: ${soundName})`);
      return;
    } catch (e) {
      console.warn('[NotificationService] Notifee native trigger error, falling back:', e);
    }
  }

  // Universal Fallback via expo-notifications native interval trigger
  try {
    const isLoud = alertType === 'loud_ping' || alertType === 'sos';
    const expoChannel = isLoud ? EXPO_SIREN_CHANNEL_ID : EXPO_CHECKIN_CHANNEL_ID;
    const soundFile = isLoud ? EMERGENCY_ALERT_SOUND : SAFETY_CHECK_SOUND;

    await Notifications.scheduleNotificationAsync({
      identifier: EMERGENCY_ALERT_NOTIFICATION_ID,
      content: {
        title: isSOS
          ? '🚨 EMERGENCY SOS ALERT (TEST)'
          : isLoud
          ? '🚨 EMERGENCY ALERT (LOUD PING)'
          : '⚠️ ARE YOU SAFE?',
        subtitle: isSOS ? '🚨 LIFE DISTRESS BEACON' : '⚠️ NDRRMC PROTOCOL',
        body: isSOS
          ? `${senderName} broadcasted an emergency SOS! Tap to view live distress map.`
          : isLoud
          ? `${senderName} triggered an emergency alarm!`
          : `${senderName} asked: Are you safe?`,
        sound: soundFile,
        categoryIdentifier: NDRRMC_ALERT_CATEGORY,
        priority: Notifications.AndroidNotificationPriority.MAX,
        data: { type: isSOS ? 'sos' : 'ndrrmc_alert', alertType, fromName: senderName, lat: 14.7352, lng: 120.5312, battery: 0.88 },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: delaySeconds,
        channelId: expoChannel,
      },
    });
    console.log(`[NotificationService] Expo native interval trigger scheduled for ${delaySeconds}s (sound: ${soundFile})`);
  } catch (e) {
    console.warn('[NotificationService] Fallback schedule error:', e);
  }
}
