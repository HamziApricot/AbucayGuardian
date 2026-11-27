import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, Animated, Image, Vibration, Linking, BackHandler, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import { AlertProvider, useAlert } from './src/context/AlertContext';
import { AlertManager } from './src/components/AlertManager';
import { NDRRMCEmergencyModal, type NDRRMCEmergencyAlertData } from './src/components/NDRRMCEmergencyModal';
import {
    initEmergencyNotifications,
    listenForEmergencyAlerts,
    stopEmergencyAlertMonitoring,
    showGuardianQuickActionsNotification,
    dismissGuardianQuickActionsNotification,
    dismissEmergencyAlertNotifications,
    registerNDRRMCModalHandler,
    requestOverlayAndBatteryPermissions,
    registerPushToken,
    moveToBackground,
} from './src/services/EmergencyNotificationService';
import { startBackgroundLocationTracking, stopBackgroundLocationTracking } from './src/services/BackgroundLocationTask';
import { LocationTrackingService } from './src/services/LocationTrackingService';
import { getDeviceBatteryLevel, getDevicePowerState, subscribeToBatteryHealth } from './src/services/batteryService';
import { navigationRef, navigateToNotificationTarget } from './src/services/NavigationService';
import { supabase } from './src/lib/supabase';
import './src/services/BackgroundLocationTask';
import { useCovertShake } from './src/hooks/useCovertShake';
import { useCovertVolume } from './src/hooks/useCovertVolume';
import { syncNativeCovertSOSState } from './src/services/SilentSOSService';

function FullscreenSplash({ onFinish }: { onFinish: () => void }) {
    const fadeAnim = useRef(new Animated.Value(1)).current;
    const [hidden, setHidden] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => {
            Animated.timing(fadeAnim, {
                toValue: 0,
                duration: 450,
                useNativeDriver: true,
            }).start(() => {
                setHidden(true);
                onFinish();
            });
        }, 1200);

        return () => clearTimeout(timer);
    }, [fadeAnim, onFinish]);

    if (hidden) return null;

    return (
        <Animated.View
            style={[
                StyleSheet.absoluteFill,
                { opacity: fadeAnim, zIndex: 999999, backgroundColor: '#0D1F4E' },
            ]}
            pointerEvents="none"
        >
            <Image
                source={require('./assets/splash.png')}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
            />
        </Animated.View>
    );
}

function GlobalEmergencyWatcher({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const { showToast } = useAlert();
    const [activeNDRRMCAlert, setActiveNDRRMCAlert] = useState<NDRRMCEmergencyAlertData | null>(null);

    // Active Covert SOS Listeners: Hardware volume pattern & shake gesture
    useCovertShake();
    useCovertVolume();

    useEffect(() => {
        initEmergencyNotifications();

        // Register NDRRMC Modal handler for heads-up / background notification taps
        registerNDRRMCModalHandler((alertData) => {
            if (alertData) {
                setActiveNDRRMCAlert(alertData);
            }
        });

        // Deep Link listener for incoming emergency broadcasts & full-screen intents
        const handleIncomingUrl = (url?: string | null) => {
            if (!url) return;
            console.log('[App] Received deep link:', url);
            if (url.includes('emergency-alert') || url.includes('loud_ping') || url.includes('checkin') || url.includes('sos')) {
                const isCheckIn = url.includes('type=checkin');
                const isSOS = url.includes('type=sos');
                const matchSender = url.match(/[?&]from=([^&]+)/);
                const sender = matchSender ? decodeURIComponent(matchSender[1]) : 'Family Circle';
                setActiveNDRRMCAlert({
                    alertType: isSOS ? 'sos' : isCheckIn ? 'checkin' : 'loud_ping',
                    fromName: sender,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                });
            }
        };

        Linking.getInitialURL().then(handleIncomingUrl).catch(() => {});
        const sub = Linking.addEventListener('url', ({ url }) => handleIncomingUrl(url));

        // Detect Notifee Full-Screen Intent launch over lock screen
        let unsubNotifee: (() => void) | null = null;
        try {
            const notifee = require('@notifee/react-native').default;
            if (notifee && typeof notifee.getInitialNotification === 'function') {
                notifee.getInitialNotification().then((initial: any) => {
                    if (initial?.notification?.data) {
                        const data = initial.notification.data;
                        if (data.type === 'ndrrmc_alert' || data.type === 'loud_ping' || data.type === 'checkin' || data.type === 'sos' || data.emergencyId) {
                            setActiveNDRRMCAlert({
                                alertType: data.alertType || (data.type === 'sos' ? 'sos' : data.type === 'checkin' ? 'checkin' : 'loud_ping'),
                                fromName: data.fromName || data.senderName || data.memberName || 'Emergency Alert',
                                fromLat: data.lat,
                                fromLng: data.lng,
                                battery: data.battery,
                                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                            });
                        }
                    }
                }).catch(() => {});

                unsubNotifee = notifee.onForegroundEvent(async ({ type, detail }: any) => {
                    // Type 0 = DISMISSED: User explicitly swiped away or dismissed notification banner
                    if (type === 0) {
                        dismissEmergencyAlertNotifications().catch(() => {});
                        setActiveNDRRMCAlert(null);
                        return;
                    }

                    const data = detail?.notification?.data;
                    const isEmergency = data && (data.type === 'ndrrmc_alert' || data.type === 'loud_ping' || data.type === 'checkin' || data.type === 'sos' || data.emergencyId);

                    // Type 2 = ACTION_PRESS: User pressed one of the notification action buttons
                    if (type === 2) {
                        const actionId = detail?.pressAction?.id;
                        dismissEmergencyAlertNotifications().catch(() => {});

                        if (actionId === 'mark_safe') {
                            setActiveNDRRMCAlert(null);
                            const nowIso = new Date().toISOString();
                            if (user?.id) {
                                try {
                                    await supabase.from('tracker').upsert({ user_id: user.id, updated_at: nowIso }, { onConflict: 'user_id' });
                                    await supabase.from('users').update({ updated_at: nowIso }).eq('id', user.id);
                                } catch {}
                                await supabase.channel('family-broadcast').send({
                                    type: 'broadcast',
                                    event: 'checkin_reply',
                                    payload: {
                                        from_user_id: user.id,
                                        from_name: user.user_metadata?.name || 'Family Member',
                                        is_safe: true,
                                        replied_at: nowIso,
                                    },
                                });
                            }
                            showToast({ message: '✅ Marked as safe on the family map!', type: 'success' });
                            return;
                        }

                        if (actionId === 'trigger_sos') {
                            setActiveNDRRMCAlert(null);
                            navigateToNotificationTarget('SOS');
                            return;
                        }

                        if (actionId === 'view_tracker') {
                            setActiveNDRRMCAlert(null);
                            navigateToNotificationTarget('Tracker');
                            return;
                        }

                        if (actionId === 'call_911') {
                            setActiveNDRRMCAlert(null);
                            Linking.openURL('tel:911').catch(() => {});
                            return;
                        }

                        // Default action ("View Alert Box")
                        if (isEmergency) {
                            setActiveNDRRMCAlert({
                                alertType: data.alertType || (data.type === 'sos' ? 'sos' : data.type === 'checkin' ? 'checkin' : 'loud_ping'),
                                fromName: data.fromName || data.senderName || data.memberName || 'Emergency Alert',
                                fromLat: data.lat,
                                fromLng: data.lng,
                                battery: data.battery,
                                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                            });
                        }
                        return;
                    }

                    // Type 1 = PRESS: User tapped the notification itself
                    if (type === 1) {
                        dismissEmergencyAlertNotifications().catch(() => {});
                        if (isEmergency) {
                            setActiveNDRRMCAlert({
                                alertType: data.alertType || (data.type === 'sos' ? 'sos' : data.type === 'checkin' ? 'checkin' : 'loud_ping'),
                                fromName: data.fromName || data.senderName || data.memberName || 'Emergency Alert',
                                fromLat: data.lat,
                                fromLng: data.lng,
                                battery: data.battery,
                                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                            });
                        }
                        return;
                    }

                    // Type 3 = DELIVERED: Incoming emergency alert in foreground
                    if (type === 3 && isEmergency) {
                        setActiveNDRRMCAlert({
                            alertType: data.alertType || (data.type === 'sos' ? 'sos' : data.type === 'checkin' ? 'checkin' : 'loud_ping'),
                            fromName: data.fromName || data.senderName || data.memberName || 'Emergency Alert',
                            fromLat: data.lat,
                            fromLng: data.lng,
                            battery: data.battery,
                            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        });
                    }
                });
            }
        } catch {}

        // Expo foreground notification listener (ensures popup screen triggers for Expo-delivered notifications)
        const expoSub = Notifications.addNotificationReceivedListener((notification) => {
            const data = (notification.request.content.data || {}) as any;
            if (data && (data.type === 'ndrrmc_alert' || data.type === 'loud_ping' || data.type === 'checkin' || data.type === 'sos' || data.emergencyId)) {
                setActiveNDRRMCAlert({
                    alertType: (data.alertType || (data.type === 'sos' ? 'sos' : data.type === 'checkin' ? 'checkin' : 'loud_ping')) as 'sos' | 'checkin' | 'loud_ping',
                    fromName: String(data.fromName || data.senderName || data.memberName || 'Emergency Alert'),
                    fromLat: typeof data.lat === 'number' ? data.lat : undefined,
                    fromLng: typeof data.lng === 'number' ? data.lng : undefined,
                    battery: typeof data.battery === 'number' ? data.battery : null,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                });
            }
        });

        return () => {
            registerNDRRMCModalHandler(null);
            sub.remove();
            expoSub.remove();
            if (unsubNotifee) unsubNotifee();
        };
    }, []);

    // Prevent hardware back button from closing / killing the app
    useEffect(() => {
        const handleBackPress = () => {
            if (navigationRef.isReady() && navigationRef.canGoBack()) {
                navigationRef.goBack();
                return true;
            }

            // On root screens: Prevent app destruction. Minimize to background cleanly.
            if (Platform.OS === 'android') {
                moveToBackground().catch(() => {});
                return true; // Blocks default OS exit
            }

            return false;
        };

        const backSub = BackHandler.addEventListener('hardwareBackPress', handleBackPress);
        return () => backSub.remove();
    }, []);

    useEffect(() => {
        if (!user?.id) {
            syncNativeCovertSOSState(null);
            dismissGuardianQuickActionsNotification();
            stopEmergencyAlertMonitoring();
            stopBackgroundLocationTracking();
            LocationTrackingService.stop();
            return;
        }
        syncNativeCovertSOSState(user.id);
        showGuardianQuickActionsNotification();
        requestOverlayAndBatteryPermissions();
        registerPushToken(user.id);
        startBackgroundLocationTracking(user.id);
        LocationTrackingService.init(user.id);

        const unsubscribe = listenForEmergencyAlerts(user.id, {
            onSOSAlert: (fromName, lat, lng, battery) => {
                setActiveNDRRMCAlert({
                    alertType: 'sos',
                    fromName,
                    fromLat: lat,
                    fromLng: lng,
                    battery,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                });
            },
            onLoudPing: (fromName) => {
                setActiveNDRRMCAlert({
                    alertType: 'loud_ping',
                    fromName,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                });
            },
            onCheckInRequest: (fromName, fromAvatar, lat, lng) => {
                setActiveNDRRMCAlert({
                    alertType: 'checkin',
                    fromName,
                    fromAvatar: fromAvatar || null,
                    fromLat: lat,
                    fromLng: lng,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                });
            },
            onCheckInReply: (fromName) => {
                showToast({
                    message: `✅ ${fromName} confirmed they are safe!`,
                    type: 'success',
                });
            },
        });

        // Global Online Presence: Marks member as Active & syncs battery + location in real time
        let lastBroadcastCoords: { lat: number; lng: number; accuracy: number; speed: number } | null = null;
        const syncAppPresence = async (overridePower?: { level: number; isCharging: boolean; lowPowerMode: boolean }) => {
            try {
                const nowIso = new Date().toISOString();
                const powerInfo = overridePower ?? (await getDevicePowerState().catch(() => null));
                const rawBattery = powerInfo?.level ?? (await getDeviceBatteryLevel().catch(() => null));
                const battery = rawBattery != null && rawBattery >= 0 ? (rawBattery > 1 ? rawBattery / 100 : rawBattery) : null;
                const isCharging = powerInfo?.isCharging ?? false;
                const lowPowerMode = powerInfo?.lowPowerMode ?? false;

                // If location permission is already granted, keep tracker updated
                const { status } = await Location.getForegroundPermissionsAsync();
                if (status === 'granted') {
                    let locCoords = lastBroadcastCoords;
                    if (!overridePower || !locCoords) {
                        const loc = await Location.getCurrentPositionAsync({
                            accuracy: Location.Accuracy.Balanced,
                        });
                        locCoords = {
                            lat: loc.coords.latitude,
                            lng: loc.coords.longitude,
                            accuracy: Math.round(loc.coords.accuracy ?? 5),
                            speed: Math.max(0, loc.coords.speed ?? 0),
                        };
                        lastBroadcastCoords = locCoords;
                    }

                    const basePayload: any = {
                        user_id: user.id,
                        lat: locCoords.lat,
                        lng: locCoords.lng,
                        accuracy: locCoords.accuracy,
                        speed: locCoords.speed,
                        updated_at: nowIso,
                    };
                    if (battery != null) {
                        basePayload.battery = battery;
                    }

                    const res = await supabase.from('tracker').upsert(basePayload, { onConflict: 'user_id' });
                    if (res.error) {
                        await supabase.from('tracker').upsert({
                            user_id: user.id,
                            lat: locCoords.lat,
                            lng: locCoords.lng,
                            updated_at: nowIso,
                        }, { onConflict: 'user_id' });
                    }

                    await supabase.from('users').update({
                        updated_at: nowIso,
                        lat: locCoords.lat,
                        lng: locCoords.lng,
                    }).eq('id', user.id);

                    // Broadcast live presence + battery health + location to family circle
                    supabase.channel('family-broadcast').send({
                        type: 'broadcast',
                        event: 'location_update',
                        payload: {
                            user_id: user.id,
                            lat: locCoords.lat,
                            lng: locCoords.lng,
                            accuracy: locCoords.accuracy,
                            speed: locCoords.speed,
                            battery,
                            is_charging: isCharging,
                            low_power_mode: lowPowerMode,
                            updated_at: nowIso,
                        },
                    }).catch(() => {});
                } else {
                    await supabase.from('users').update({ updated_at: nowIso }).eq('id', user.id);
                }
            } catch (e) {
                // Non-blocking
            }
        };

        syncAppPresence();
        const presenceTimer = setInterval(() => syncAppPresence(), 10000);
        const unsubBattery = subscribeToBatteryHealth((info) => {
            syncAppPresence(info);
        });

        return () => {
            unsubscribe();
            clearInterval(presenceTimer);
            if (unsubBattery) unsubBattery();
        };
    }, [user?.id]);

    return (
        <>
            {children}
            <NDRRMCEmergencyModal
                visible={Boolean(activeNDRRMCAlert)}
                alertData={activeNDRRMCAlert}
                onConfirmSafe={async () => {
                    const nowIso = new Date().toISOString();
                    if (user?.id) {
                        try {
                            await supabase.from('tracker').upsert({ user_id: user.id, updated_at: nowIso }, { onConflict: 'user_id' });
                            await supabase.from('users').update({ updated_at: nowIso }).eq('id', user.id);
                        } catch {}
                        await supabase.channel('family-broadcast').send({
                            type: 'broadcast',
                            event: 'checkin_reply',
                            payload: {
                                from_user_id: user.id,
                                from_name: user.user_metadata?.name || 'Family Member',
                                is_safe: true,
                                replied_at: nowIso,
                            },
                        });
                    }
                    setActiveNDRRMCAlert(null);
                    dismissEmergencyAlertNotifications().catch(() => {});
                    showToast({ message: '✅ Marked as safe on the family map!', type: 'success' });
                }}
                onTriggerSOS={() => {
                    setActiveNDRRMCAlert(null);
                    dismissEmergencyAlertNotifications().catch(() => {});
                    navigateToNotificationTarget('SOS');
                }}
                onViewTracker={() => {
                    setActiveNDRRMCAlert(null);
                    dismissEmergencyAlertNotifications().catch(() => {});
                    navigateToNotificationTarget('Tracker');
                }}
                onDismiss={() => {
                    setActiveNDRRMCAlert(null);
                    dismissEmergencyAlertNotifications().catch(() => {});
                }}
            />
        </>
    );
}

export default function App() {
    const [splashFinished, setSplashFinished] = useState(false);

    return (
        <SafeAreaProvider>
            <AuthProvider>
                <AlertProvider>
                    <GlobalEmergencyWatcher>
                        <NavigationContainer ref={navigationRef}>
                            <StatusBar style="light" />
                            <AppNavigator />
                            <AlertManager />
                        </NavigationContainer>
                    </GlobalEmergencyWatcher>
                </AlertProvider>
            </AuthProvider>
            {!splashFinished && (
                <FullscreenSplash onFinish={() => setSplashFinished(true)} />
            )}
        </SafeAreaProvider>
    );
}
