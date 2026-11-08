import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, Animated, Image, Vibration, Linking } from 'react-native';
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
    registerNDRRMCModalHandler,
    requestOverlayAndBatteryPermissions,
} from './src/services/EmergencyNotificationService';
import { stopBackgroundLocationTracking } from './src/services/BackgroundLocationTask';
import { navigationRef, navigateToNotificationTarget } from './src/services/NavigationService';
import { supabase } from './src/lib/supabase';
import './src/services/BackgroundLocationTask';

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

    useEffect(() => {
        initEmergencyNotifications();
        // Clear any orphan legacy background location foreground notification from earlier runs
        stopBackgroundLocationTracking();

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
            if (url.includes('emergency-alert') || url.includes('loud_ping') || url.includes('checkin')) {
                const isCheckIn = url.includes('type=checkin');
                const matchSender = url.match(/[?&]from=([^&]+)/);
                const sender = matchSender ? decodeURIComponent(matchSender[1]) : 'Family Circle';
                setActiveNDRRMCAlert({
                    alertType: isCheckIn ? 'checkin' : 'loud_ping',
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
                        if (data.type === 'ndrrmc_alert' || data.type === 'loud_ping' || data.type === 'checkin' || data.emergencyId) {
                            setActiveNDRRMCAlert({
                                alertType: data.alertType || (data.type === 'checkin' ? 'checkin' : 'loud_ping'),
                                fromName: data.fromName || data.memberName || 'Emergency Alert',
                                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                            });
                        }
                    }
                }).catch(() => {});

                unsubNotifee = notifee.onForegroundEvent(({ type, detail }: any) => {
                    const data = detail?.notification?.data;
                    if (data && (data.type === 'ndrrmc_alert' || data.type === 'loud_ping' || data.type === 'checkin' || data.emergencyId)) {
                        setActiveNDRRMCAlert({
                            alertType: data.alertType || (data.type === 'checkin' ? 'checkin' : 'loud_ping'),
                            fromName: data.fromName || data.memberName || 'Emergency Alert',
                            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        });
                    }
                });
            }
        } catch {}

        return () => {
            registerNDRRMCModalHandler(null);
            sub.remove();
            if (unsubNotifee) unsubNotifee();
        };
    }, []);

    useEffect(() => {
        if (!user?.id) {
            dismissGuardianQuickActionsNotification();
            stopEmergencyAlertMonitoring();
            return;
        }
        showGuardianQuickActionsNotification();
        requestOverlayAndBatteryPermissions();

        const unsubscribe = listenForEmergencyAlerts(user.id, {
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

        // Global Online Presence: Marks member as Active while the app is open
        const syncAppPresence = async () => {
            try {
                const nowIso = new Date().toISOString();
                await supabase.from('users').update({ updated_at: nowIso }).eq('id', user.id);

                // If location permission is already granted, keep tracker updated
                const { status } = await Location.getForegroundPermissionsAsync();
                if (status === 'granted') {
                    const loc = await Location.getCurrentPositionAsync({
                        accuracy: Location.Accuracy.Balanced,
                    });
                    const basePayload = {
                        user_id: user.id,
                        lat: loc.coords.latitude,
                        lng: loc.coords.longitude,
                        accuracy: Math.round(loc.coords.accuracy ?? 5),
                        speed: Math.max(0, loc.coords.speed ?? 0),
                        updated_at: nowIso,
                    };
                    const res = await supabase.from('tracker').upsert(basePayload, { onConflict: 'user_id' });
                    if (res.error) {
                        await supabase.from('tracker').upsert({
                            user_id: user.id,
                            lat: loc.coords.latitude,
                            lng: loc.coords.longitude,
                            updated_at: nowIso,
                        }, { onConflict: 'user_id' });
                    }
                }
            } catch (e) {
                // Non-blocking
            }
        };

        syncAppPresence();
        const presenceTimer = setInterval(syncAppPresence, 25000);

        return () => {
            unsubscribe();
            clearInterval(presenceTimer);
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
                    showToast({ message: '✅ Marked as safe on the family map!', type: 'success' });
                }}
                onTriggerSOS={() => {
                    setActiveNDRRMCAlert(null);
                    navigateToNotificationTarget('SOS');
                }}
                onDismiss={() => {
                    setActiveNDRRMCAlert(null);
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
