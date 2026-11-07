import { Platform, Vibration, Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';
import { navigateToNotificationTarget } from './NavigationService';

export const GUARDIAN_QUICK_ACTIONS_CATEGORY = 'GUARDIAN_QUICK_ACTIONS_V2';
export const SAFETY_CHECK_CATEGORY = 'SAFETY_CHECK_CATEGORY_V2';
export const NDRRMC_ALERT_CATEGORY = 'NDRRMC_ALERT_CATEGORY_V3';
export const GUARDIAN_PERSISTENT_NOTIFICATION_ID = 'ABUCAY_GUARDIAN_PERSISTENT_CONTROL';
export const NDRRMC_EMERGENCY_CHANNEL_ID = 'ndrrmc_emergency_v5';
export const NOTIFEE_EMERGENCY_CHANNEL_ID = 'emergency_alert_v3';
export const EMERGENCY_ALERT_SOUND = 'alert.mp3';

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
    // 0. Dismiss any orphan/stale notifications from previous app sessions
    try {
      await Notifications.dismissAllNotificationsAsync();
    } catch {}

    const { status } = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });

    if (status !== 'granted') {
      console.warn('[NotificationService] Notification permission not granted');
    }

    // Ensure Notifee channel is registered with Android OS immediately on app startup
    const notifee = getNotifee();
    if (notifee) {
      try {
        await notifee.requestPermission({ criticalAlert: true });
        await notifee.createChannel({
          id: NOTIFEE_EMERGENCY_CHANNEL_ID,
          name: '🚨 Emergency Alerts',
          importance: notifee.AndroidImportance?.HIGH ?? 4,
          visibility: notifee.AndroidVisibility?.PUBLIC ?? 1,
          bypassDnd: true,
          sound: 'alert',
          lights: true,
          vibration: true,
          vibrationPattern: [300, 500],
        });
        console.log('[NotificationService] Notifee emergency channel registered on startup');
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

      // High-Priority Channel for SOS Alerts (Maximum Importance, uses alert.mp3)
      await Notifications.setNotificationChannelAsync('emergency_sos', {
        name: '🚨 Emergency SOS Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 600, 200, 600, 200, 1000, 300, 1000],
        enableVibrate: true,
        enableLights: true,
        lightColor: '#DC2626',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
        sound: EMERGENCY_ALERT_SOUND,
      });

      // Clean up legacy cached channels that may lack heads-up popdown priority
      try {
        await Notifications.deleteNotificationChannelAsync('checkin_requests');
        await Notifications.deleteNotificationChannelAsync('loud_ping');
        await Notifications.deleteNotificationChannelAsync('ndrrmc_emergency_v3');
        await Notifications.deleteNotificationChannelAsync('ndrrmc_emergency_v4');
      } catch {}

      const notifee = getNotifee();
      if (notifee) {
        try {
          await notifee.deleteChannel('emergency_alert_channel');
          await notifee.deleteChannel('emergency_alert_v2');
          await notifee.deleteChannel('emergency-check');
        } catch {}
      }

      // Fresh Maximum-Priority Heads-Up Channel for NDRRMC Alerts (Force custom alert.mp3)
      await Notifications.setNotificationChannelAsync(NDRRMC_EMERGENCY_CHANNEL_ID, {
        name: '🚨 NDRRMC Emergency Warning Channel',
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
    }

    // 3. Handle button clicks & notification interaction (both foreground and background actions)
    Notifications.addNotificationResponseReceivedListener(async (response) => {
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
        data.type === 'checkin'
      ) {
        const alertData = {
          alertType: data.alertType || (data.type === 'loud_ping' ? 'loud_ping' : 'checkin'),
          fromName: data.fromName || data.memberName || 'Family Member',
          fromAvatar: data.avatarUrl || null,
          fromLat: data.lat,
          fromLng: data.lng,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        if (onOpenNDRRMCEmergencyModal) {
          onOpenNDRRMCEmergencyModal(alertData);
        } else {
          pendingNDRRMCAlert = alertData;
        }
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
        if (data.type !== 'ndrrmc_alert' && data.type !== 'loud_ping' && data.type !== 'checkin') {
          navigateToNotificationTarget('Tracker');
        }
      }
    });

    // Check if app was cold-launched from an NDRRMC emergency notification
    Notifications.getLastNotificationResponseAsync().then((lastResponse) => {
      if (lastResponse) {
        const data = lastResponse.notification.request.content.data || {};
        if (data.type === 'ndrrmc_alert' || data.type === 'loud_ping' || data.type === 'checkin') {
          const alertData = {
            alertType: data.alertType || (data.type === 'loud_ping' ? 'loud_ping' : 'checkin'),
            fromName: data.fromName || data.memberName || 'Family Member',
            fromAvatar: data.avatarUrl || null,
            fromLat: data.lat,
            fromLng: data.lng,
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
    console.log('[NotificationService] Quick actions notification displayed');
  } catch (e) {
    console.warn('[NotificationService] Quick actions notification error:', e);
  }
}

/**
 * Dismisses the persistent quick actions notification when logging out.
 */
export async function dismissGuardianQuickActionsNotification(): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(GUARDIAN_PERSISTENT_NOTIFICATION_ID);
  } catch (e) {
    console.warn('[NotificationService] Dismiss error:', e);
  }
}

/**
 * Triggers a heads-up system notification for an SOS event with quick actions.
 */
export async function triggerSOSNotification(
  senderName: string,
  lat?: number,
  lng?: number,
  battery?: number
): Promise<void> {
  try {
    Vibration.vibrate([0, 600, 200, 600, 200, 1000, 300, 1000]);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🚨 EMERGENCY SOS ALERT!',
        body: `${senderName} broadcasted an emergency SOS! Live coordinates and battery (${battery ? `${Math.round(battery * 100)}%` : 'Active'}) reported.`,
        sound: EMERGENCY_ALERT_SOUND,
        categoryIdentifier: GUARDIAN_QUICK_ACTIONS_CATEGORY,
        priority: Notifications.AndroidNotificationPriority.MAX,
        data: { type: 'sos', senderName, lat, lng },
        ...(Platform.OS === 'android' ? { channelId: 'emergency_sos' } : {}),
      },
      trigger: null, // immediate
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
  const notifee = getNotifee();
  if (notifee) {
    try {
      await notifee.requestPermission({ criticalAlert: true });
      const channelId = await notifee.createChannel({
        id: NOTIFEE_EMERGENCY_CHANNEL_ID,
        name: 'Emergency Alerts V3',
        importance: notifee.AndroidImportance?.HIGH ?? 4,
        visibility: notifee.AndroidVisibility?.PUBLIC ?? 1,
        bypassDnd: true,
        sound: 'alert', // Android resolves R.raw.alert
        lights: true,
        vibration: true,
        vibrationPattern: [300, 500],
      });

      await notifee.displayNotification({
        title: '🚨 EMERGENCY ALERT (LOUD PING)',
        body: `${fromName} triggered an emergency loud alarm on your phone!`,
        data: { type: 'ndrrmc_alert', alertType: 'loud_ping', fromName, emergencyId: 'loud_ping' },
        android: {
          channelId,
          smallIcon: 'notification_icon',
          color: '#DC2626',
          importance: notifee.AndroidImportance?.HIGH ?? 4,
          category: notifee.AndroidCategory?.ALARM ?? 'alarm', // ALARM category wakes the device and triggers Full-Screen Intent!
          visibility: notifee.AndroidVisibility?.PUBLIC ?? 1,
          ongoing: true, // Prevents swiping away accidentally
          autoCancel: false,
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
          critical: true,
          criticalVolume: 1.0,
          sound: EMERGENCY_ALERT_SOUND,
          interruptionLevel: 'critical',
        },
      });
      console.log('[NotificationService] Loud ping displayed via Notifee Full-Screen Intent');
      return;
    } catch (e) {
      console.warn('[NotificationService] Notifee loud ping fallback:', e);
    }
  }

  // Universal Fallback via expo-notifications
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🚨 EMERGENCY ALERT (LOUD PING)',
        subtitle: '⚠️ NDRRMC PROTOCOL',
        body: `${fromName} triggered an emergency loud alarm on your phone! Tap to open alert box.`,
        sound: EMERGENCY_ALERT_SOUND,
        categoryIdentifier: NDRRMC_ALERT_CATEGORY,
        priority: Notifications.AndroidNotificationPriority.MAX,
        data: { type: 'ndrrmc_alert', alertType: 'loud_ping', fromName },
        ...(Platform.OS === 'android' ? { channelId: NDRRMC_EMERGENCY_CHANNEL_ID } : {}),
      },
      trigger: null,
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
  const resolvedMapUrl =
    mapSnapshotUrl ||
    (lat && lng
      ? `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=15&size=600x300&markers=${lat},${lng},ol-marker`
      : undefined);

  // 1. If @notifee/react-native native module is present in the build, use its full native power
  const notifee = getNotifee();
  if (notifee) {
    try {
      const channelId = await notifee.createChannel({
        id: NOTIFEE_EMERGENCY_CHANNEL_ID,
        name: 'Emergency Alerts V3',
        importance: notifee.AndroidImportance?.HIGH ?? 4,
        visibility: notifee.AndroidVisibility?.PUBLIC ?? 1,
        bypassDnd: true,
        sound: 'alert',
        lights: true,
        vibration: true,
        vibrationPattern: [300, 500],
      });

      await notifee.displayNotification({
        title: `⚠️ ARE YOU SAFE? • ${memberName}`,
        body: `${memberName} sent a priority safety check-in request. Tap to confirm.`,
        data: {
          type: 'ndrrmc_alert',
          alertType: 'checkin',
          memberName,
          fromName: memberName,
          emergencyId: 'checkin',
        },
        android: {
          channelId,
          smallIcon: 'notification_icon',
          color: '#DC2626',
          importance: notifee.AndroidImportance?.HIGH ?? 4,
          category: notifee.AndroidCategory?.ALARM ?? 'alarm', // Wakes the screen and triggers Full-Screen Intent
          visibility: notifee.AndroidVisibility?.PUBLIC ?? 1,
          ongoing: true,
          autoCancel: false,
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
          categoryId: 'safety-check',
          attachments: resolvedMapUrl ? [{ identifier: 'map-snapshot', url: resolvedMapUrl, type: 'image' }] : [],
          critical: true,
          criticalVolume: 1.0,
          sound: EMERGENCY_ALERT_SOUND,
        },
      });
      console.log('[RichNotification] Displayed via Notifee native engine');
      return;
    } catch (e) {
      console.warn('[RichNotification] Notifee display fallback:', e);
    }
  }

  // 2. Seamless Universal Fallback via expo-notifications
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '⚠️ EMERGENCY ALERT: ARE YOU SAFE?',
        subtitle: '🚨 NDRRMC-STYLE SAFETY CHECK',
        body: `${memberName} asked: Are you safe? Tap immediately to confirm your status.`,
        sound: EMERGENCY_ALERT_SOUND,
        categoryIdentifier: SAFETY_CHECK_CATEGORY,
        priority: Notifications.AndroidNotificationPriority.MAX,
        data: {
          type: 'ndrrmc_alert',
          alertType: 'checkin',
          memberName,
          avatarUrl,
          mapSnapshotUrl: resolvedMapUrl,
          lat,
          lng,
        },
        ...(Platform.OS === 'android' ? { channelId: NDRRMC_EMERGENCY_CHANNEL_ID } : {}),
      },
      trigger: null,
    });
    console.log('[RichNotification] Displayed via Expo rich categories engine');
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

export interface EmergencyAlertCallbacks {
  onLoudPing?: (fromName: string) => void;
  onCheckInRequest?: (fromName: string, fromAvatar?: string, lat?: number, lng?: number) => void;
  onCheckInReply?: (fromName: string, isSafe: boolean) => void;
}

/**
 * Listens for incoming emergency alerts across the whole app (even in background).
 */
export function listenForEmergencyAlerts(
  currentUserId: string,
  callbacks?: EmergencyAlertCallbacks
): () => void {
  if (!currentUserId) return () => {};

  // 1. Listen for new SOS events in Supabase database
  const sosChannel = supabase
    .channel('global-sos-listener')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'sos_events' },
      async (payload) => {
        const newEvent = payload.new as any;
        if (newEvent && newEvent.user_id !== currentUserId && newEvent.status === 'active') {
          // Fetch sender name
          const { data: userData } = await supabase
            .from('users')
            .select('name')
            .eq('id', newEvent.user_id)
            .single();

          const name = userData?.name || 'A family member';
          triggerSOSNotification(name, newEvent.lat, newEvent.lng);
        }
      }
    )
    .subscribe();

  // 2. Listen for Realtime Broadcast events (Loud Ping, Check-in, SOS Broadcast)
  const broadcastChannel = supabase
    .channel('family-broadcast')
    .on('broadcast', { event: 'loud_ping' }, (event) => {
      const payload = event.payload;
      if (!payload || payload.from_user_id === currentUserId) return;

      const isTarget =
        payload.to_member_id === currentUserId ||
        payload.to_user_id === currentUserId ||
        payload.to_row_id === currentUserId ||
        !payload.to_member_id;

      if (isTarget) {
        const sender = payload.from_name || 'Family Circle';
        triggerLoudPingNotification(sender);
        callbacks?.onLoudPing?.(sender);
        try {
          const deepUrl = `abucayguardian://emergency-alert?type=loud_ping&from=${encodeURIComponent(sender)}`;
          Linking.openURL(deepUrl).catch(() => {});
        } catch {}
      }
    })
    .on('broadcast', { event: 'checkin_request' }, (event) => {
      const payload = event.payload;
      if (!payload || payload.from_user_id === currentUserId) return;

      const isTarget =
        payload.to_member_id === currentUserId ||
        payload.to_user_id === currentUserId ||
        payload.to_row_id === currentUserId ||
        !payload.to_member_id;

      if (isTarget) {
        const sender = payload.from_name || 'Family Circle';
        sendSafetyCheckNotification(
          sender,
          payload.from_avatar,
          undefined,
          payload.from_lat,
          payload.from_lng
        );
        callbacks?.onCheckInRequest?.(
          sender,
          payload.from_avatar,
          payload.from_lat,
          payload.from_lng
        );
        try {
          const deepUrl = `abucayguardian://emergency-alert?type=checkin&from=${encodeURIComponent(sender)}`;
          Linking.openURL(deepUrl).catch(() => {});
        } catch {}
      }
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
        callbacks?.onCheckInReply?.(sender, true);
      }
    })
    .subscribe();

  return () => {
    supabase.removeChannel(sosChannel);
  };
}

/**
 * Single-device test helper: Triggers an NDRRMC emergency alert locally
 * either immediately (in-app test) or after a countdown (minimized/lockscreen test).
 */
export async function triggerTestNDRRMCAlert(
  alertType: 'loud_ping' | 'checkin',
  delaySeconds: number = 0,
  senderName: string = 'NDRRMC / Family Member'
): Promise<void> {
  const alertData = {
    alertType,
    fromName: senderName,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };

  if (delaySeconds <= 0) {
    if (onOpenNDRRMCEmergencyModal) {
      onOpenNDRRMCEmergencyModal(alertData);
    }
    if (alertType === 'loud_ping') {
      await triggerLoudPingNotification(senderName);
    } else {
      await sendSafetyCheckNotification(senderName);
    }
    return;
  }

  // NATIVE ALARM SCHEDULING (Never paused by Android OS sleep or Doze mode!)
  const notifee = getNotifee();
  if (notifee) {
    try {
      const channelId = NOTIFEE_EMERGENCY_CHANNEL_ID;
      await notifee.createChannel({
        id: channelId,
        name: '🚨 Emergency Alerts',
        importance: notifee.AndroidImportance?.HIGH ?? 4,
        visibility: notifee.AndroidVisibility?.PUBLIC ?? 1,
        bypassDnd: true,
        sound: 'alert',
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

      await notifee.createTriggerNotification(
        {
          title: alertType === 'loud_ping' ? '🚨 EMERGENCY ALERT (LOUD PING)' : '⚠️ ARE YOU SAFE? • NDRRMC',
          body: `${senderName} triggered an emergency alarm on your phone!`,
          data: {
            type: 'ndrrmc_alert',
            alertType,
            fromName: senderName,
            emergencyId: alertType,
          },
          android: {
            channelId,
            smallIcon: 'notification_icon',
            color: '#DC2626',
            importance: notifee.AndroidImportance?.HIGH ?? 4,
            category: notifee.AndroidCategory?.ALARM ?? 'alarm', // Wakes the device and triggers Full-Screen Intent
            visibility: notifee.AndroidVisibility?.PUBLIC ?? 1,
            ongoing: true,
            autoCancel: false,
            fullScreenAction: {
              id: 'default',
              launchActivity: 'default',
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
            critical: true,
            criticalVolume: 1.0,
            sound: EMERGENCY_ALERT_SOUND,
            interruptionLevel: 'critical',
          },
        },
        trigger as any
      );
      console.log(`[NotificationService] Native hardware trigger scheduled for ${delaySeconds}s from now`);
      return;
    } catch (e) {
      console.warn('[NotificationService] Notifee native trigger error, falling back:', e);
    }
  }

  // Universal Fallback via expo-notifications native interval trigger
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: alertType === 'loud_ping' ? '🚨 EMERGENCY ALERT (LOUD PING)' : '⚠️ ARE YOU SAFE?',
        subtitle: '⚠️ NDRRMC PROTOCOL',
        body: `${senderName} triggered an emergency loud alarm!`,
        sound: EMERGENCY_ALERT_SOUND,
        categoryIdentifier: NDRRMC_ALERT_CATEGORY,
        priority: Notifications.AndroidNotificationPriority.MAX,
        data: { type: 'ndrrmc_alert', alertType, fromName: senderName },
        ...(Platform.OS === 'android' ? { channelId: NDRRMC_EMERGENCY_CHANNEL_ID } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: delaySeconds,
        channelId: NDRRMC_EMERGENCY_CHANNEL_ID,
      },
    });
    console.log(`[NotificationService] Expo native interval trigger scheduled for ${delaySeconds}s`);
  } catch (e) {
    console.warn('[NotificationService] Fallback schedule error:', e);
  }
}
