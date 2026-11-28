import React, { useEffect, useRef, useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Animated, Linking,
    Alert, Vibration, Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import * as Location from 'expo-location';
import { queueSOSEvent } from '../utils/cache';
import { sendEmergencyPushNotification } from '../services/EmergencyNotificationService';
import { sendEmergencySMSToFamily } from '../services/EmergencySMSService';
import { getDeviceBatteryLevel } from '../services/batteryService';

import { useAlert } from '../context/AlertContext';

type Props = { navigation: any };

const COUNTDOWN = 3;

export default function SOSScreen({ navigation }: Props) {
    const insets = useSafeAreaInsets();
    const { user, userProfile } = useAuth();
    const { showAlert, showToast } = useAlert();
    const [phase, setPhase] = useState<'idle' | 'countdown' | 'sent'>('idle');
    const [count, setCount] = useState(COUNTDOWN);
    const [smsStatus, setSmsStatus] = useState<{
        sent: boolean;
        count: number;
        names: string[];
        method?: string;
        isFallback?: boolean;
        fallbackReason?: string;
        error?: string;
    } | null>(null);
    const [lastSOSLocation, setLastSOSLocation] = useState<{ lat?: number; lng?: number }>({});
    const [deviceBattery, setDeviceBattery] = useState<number | null>(null);
    const intervalRef = useRef<any>(null);
    const watchRef = useRef<any>(null);
    const pulseAnim = useRef(new Animated.Value(1)).current;
    const shakeAnim = useRef(new Animated.Value(0)).current;
    const isTriggeringRef = useRef(false);

    // Pulsing background
    useEffect(() => {
        if (phase === 'countdown') {
            Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, { toValue: 1.15, duration: 400, useNativeDriver: true }),
                    Animated.timing(pulseAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
                ])
            ).start();
        } else {
            pulseAnim.setValue(1);
        }
    }, [phase]);

    // Cleanup watcher on unmount
    useEffect(() => {
        return () => {
            if (watchRef.current) watchRef.current.remove();
        };
    }, []);

    const startSOS = () => {
        if (isTriggeringRef.current || phase !== 'idle') return;
        setPhase('countdown');
        setCount(COUNTDOWN);
        Vibration.vibrate([0, 300, 200, 300]);
        intervalRef.current = setInterval(() => {
            setCount((c) => {
                if (c <= 1) {
                    clearInterval(intervalRef.current);
                    triggerSOS();
                    return 0;
                }
                return c - 1;
            });
        }, 1000);
    };

    const cancelSOS = () => {
        clearInterval(intervalRef.current);
        isTriggeringRef.current = false;
        setPhase('idle');
        setCount(COUNTDOWN);
        Vibration.cancel();
    };

    const triggerSOS = async () => {
        if (isTriggeringRef.current) return;
        isTriggeringRef.current = true;
        setPhase('sent');
        Vibration.vibrate([0, 500, 200, 500, 200, 1000]);

        let lat: number | undefined;
        let lng: number | undefined;

        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status === 'granted') {
                const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
                lat = loc.coords.latitude;
                lng = loc.coords.longitude;
            }
        } catch { }

        // Fetch battery level safely
        let battery: number | null = null;
        try {
            battery = await getDeviceBatteryLevel();
            setDeviceBattery(battery);
        } catch {}

        setLastSOSLocation({ lat, lng });

        const event = {
            user_id: user?.id,
            lat,
            lng,
            triggered_at: new Date().toISOString(),
            status: 'active',
        };

        // Try to insert to Supabase, queue offline if fail
        const { error } = await supabase.from('sos_events').insert(event);
        if (lat && lng && user?.id) {
            await supabase.from('tracker').upsert({ user_id: user.id, lat, lng, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
            await supabase.from('users').update({ lat, lng, updated_at: new Date().toISOString() }).eq('id', user.id);
        }
        if (error) {
            await queueSOSEvent(event);
        }

        // Broadcast strictly to active family members over family-broadcast channel
        try {
            let targetFamilyUserIds: string[] = [];
            if (user?.id) {
                const { data: familyData } = await supabase
                    .from('family_members')
                    .select('member_user_id')
                    .eq('user_id', user.id);
                if (familyData) {
                    targetFamilyUserIds = familyData
                        .map((m: any) => m.member_user_id)
                        .filter(Boolean);
                }
            }

            await supabase.channel('family-broadcast').send({
                type: 'broadcast',
                event: 'sos_alert',
                payload: {
                    from_user_id: user?.id,
                    from_name: userProfile?.name || user?.user_metadata?.name || 'Family Member',
                    from_avatar: userProfile?.avatar_url || null,
                    from_phone: userProfile?.phone || null,
                    lat,
                    lng,
                    battery,
                    target_family_user_ids: targetFamilyUserIds,
                    triggered_at: new Date().toISOString(),
                },
            });

            // Dispatch APNs / FCM push notification to wake closed apps & locked screens
            if (targetFamilyUserIds.length > 0) {
                sendEmergencyPushNotification(
                    targetFamilyUserIds,
                    '🚨 EMERGENCY SOS ALERT!',
                    `${userProfile?.name || 'A family member'} broadcasted an emergency SOS! Tap to open live distress map.`,
                    'sos',
                    userProfile?.name || 'Family Member',
                    lat,
                    lng,
                    battery
                ).catch(() => {});
            }
        } catch (e) {
            console.warn('[SOSScreen] Broadcast SOS error:', e);
        }

        // Dispatch emergency SMS to all family members
        let smsResult: any = null;
        try {
            smsResult = await sendEmergencySMSToFamily({
                senderName: userProfile?.name || user?.user_metadata?.name || 'A family member',
                senderPhone: userProfile?.phone,
                senderId: user?.id,
                lat,
                lng,
                battery,
            });
            if (smsResult && smsResult.recipients.length > 0) {
                setSmsStatus({
                    sent: smsResult.success,
                    count: smsResult.recipients.length,
                    names: smsResult.recipientNames,
                    method: smsResult.method,
                    isFallback: smsResult.isFallback,
                    fallbackReason: smsResult.fallbackReason,
                });
            } else if (smsResult && !smsResult.success) {
                setSmsStatus({
                    sent: false,
                    count: 0,
                    names: [],
                    error: smsResult.error || 'No other family members found to alert.',
                });
            }
        } catch (smsErr) {
            console.warn('[SOSScreen] SMS dispatch error:', smsErr);
        }

        // Start continuous tracking while in "sent" phase
        if (lat && lng) {
            watchRef.current = await Location.watchPositionAsync(
                { accuracy: Location.Accuracy.Highest, distanceInterval: 2, timeInterval: 4000 },
                async (loc) => {
                    if (user?.id) {
                        await supabase.from('tracker').upsert({
                            user_id: user.id,
                            lat: loc.coords.latitude,
                            lng: loc.coords.longitude,
                            updated_at: new Date().toISOString()
                        }, { onConflict: 'user_id' });
                        await supabase.from('users').update({
                            lat: loc.coords.latitude,
                            lng: loc.coords.longitude,
                            updated_at: new Date().toISOString()
                        }).eq('id', user.id);
                    }
                }
            );
        }

        const methodTag = smsResult?.method === 'supabase-api'
            ? ' (via SMS Gateway Webhook - No load needed)'
            : smsResult?.isFallback && smsResult?.fallbackReason
            ? ` (via SIM direct SMS fallback: ${smsResult.fallbackReason})`
            : smsResult?.method === 'direct-sms'
            ? ' (via SIM direct SMS fallback)'
            : '';
        const smsSummary = smsResult?.recipientNames?.length > 0
            ? ` and individual SMS distress message sent to ${smsResult.recipientNames.join(', ')}${methodTag}`
            : smsResult?.error
            ? ` (${smsResult.error})`
            : '';

        // Show concise toast confirmation and offer to call 911 or re-send SMS
        showToast({ message: 'SOS sent', type: 'success' });
        showAlert({
            title: '🚨 SOS & SMS Dispatched!',
            message: `Your emergency SOS has been broadcasted to your family${smsSummary}. Do you want to call 911 now?`,
            type: 'warning',
            buttons: [
                { text: 'Call 911', style: 'destructive', onPress: () => Linking.openURL('tel:911') },
                ...(smsResult?.recipients?.length > 0 ? [{
                    text: 'Re-send SMS',
                    onPress: () => sendEmergencySMSToFamily({
                        senderName: userProfile?.name || user?.user_metadata?.name || 'A family member',
                        senderPhone: userProfile?.phone,
                        senderId: user?.id,
                        lat,
                        lng,
                        battery,
                    }),
                }] : []),
                { text: 'Later', style: 'cancel' },
            ]
        });
    };

    return (
        <View style={styles.container}>
            {/* Back */}
            <TouchableOpacity style={[styles.backBtn, { top: Math.max(insets.top, 16) }]} onPress={() => { cancelSOS(); navigation.goBack(); }}>
                <Ionicons name="arrow-back" size={24} color={Colors.white} />
            </TouchableOpacity>

            <Text style={[styles.screenTitle, { marginTop: Math.max(insets.top + 20, 60) }]}>SOS Emergency</Text>
            <Text style={styles.screenSubtitle}>Your location will be shared with family</Text>

            {/* Main button area */}
            <View style={styles.center}>
                {phase === 'idle' && (
                    <>
                        <View style={styles.buttonWrapper}>
                            <Animated.View style={[styles.outerRing, { transform: [{ scale: pulseAnim }] }]} />
                            <TouchableOpacity style={styles.sosBtn} onPress={startSOS} activeOpacity={0.85}>
                                <Ionicons name="warning" size={52} color={Colors.white} />
                                <Text style={styles.sosBtnText}>SOS</Text>
                                <Text style={styles.sosBtnSub}>Tap to Alert</Text>
                            </TouchableOpacity>
                        </View>
                        <Text style={styles.hint}>Alerts will be sent to all family members</Text>
                    </>
                )}

                {phase === 'countdown' && (
                    <>
                        <View style={styles.buttonWrapper}>
                            <Animated.View style={[styles.outerRing, styles.outerRingActive, { transform: [{ scale: pulseAnim }] }]} />
                            <View style={styles.sosBtn}>
                                <Text style={styles.countdownNum}>{count}</Text>
                                <Text style={styles.countdownLabel}>Sending in...</Text>
                            </View>
                        </View>
                        <TouchableOpacity style={styles.cancelBtn} onPress={cancelSOS}>
                            <Ionicons name="close-circle" size={22} color={Colors.white} />
                            <Text style={styles.cancelText}>Cancel SOS</Text>
                        </TouchableOpacity>
                    </>
                )}

                {phase === 'sent' && (
                    <>
                        <View style={styles.buttonWrapper}>
                            <View style={[styles.sosBtn, styles.sosBtnSent]}>
                                <Ionicons name="checkmark-circle" size={52} color={Colors.white} />
                                <Text style={styles.sosBtnText}>SENT</Text>
                                <Text style={styles.sosBtnSub}>Help is on the way</Text>
                            </View>
                        </View>

                        {/* SMS Distress Alert Status Card */}
                        <View style={styles.smsAlertCard}>
                            <View style={styles.smsAlertHeader}>
                                <Ionicons
                                    name={smsStatus?.method === 'supabase-api' ? 'cloud-done' : smsStatus?.error ? 'warning' : 'chatbubbles'}
                                    size={20}
                                    color={smsStatus?.method === 'supabase-api' ? '#38BDF8' : smsStatus?.error ? '#F59E0B' : '#10B981'}
                                />
                                <Text style={styles.smsAlertTitle}>
                                    {smsStatus && smsStatus.count > 0
                                        ? smsStatus.method === 'supabase-api'
                                            ? `TextBee Cloud SMS Sent (No Load Needed)`
                                            : `Device SIM Sent (Fallback)`
                                        : smsStatus?.error
                                            ? 'No Family Members on Record'
                                            : 'Family SMS Dispatch Ready'}
                                </Text>
                            </View>
                            <Text style={styles.smsAlertBody}>
                                {smsStatus && smsStatus.names.length > 0
                                    ? smsStatus.method === 'supabase-api'
                                        ? `☁️ SMS Gateway webhook delivered to: ${smsStatus.names.join(', ')}`
                                        : `📶 SIM cellular SMS sent to: ${smsStatus.names.join(', ')}${smsStatus.fallbackReason ? `\n(Fallback: ${smsStatus.fallbackReason})` : ''}`
                                    : smsStatus?.error
                                        ? smsStatus.error
                                        : 'Emergency SMS with live GPS link prepared for family circle.'}
                            </Text>
                            <TouchableOpacity
                                style={styles.resendSmsBtn}
                                onPress={() => sendEmergencySMSToFamily({
                                    senderName: userProfile?.name || user?.user_metadata?.name || 'A family member',
                                    senderPhone: userProfile?.phone,
                                    senderId: user?.id,
                                    lat: lastSOSLocation.lat,
                                    lng: lastSOSLocation.lng,
                                    battery: deviceBattery,
                                })}
                                activeOpacity={0.8}
                            >
                                <Ionicons name="chatbox-ellipses" size={16} color={Colors.white} />
                                <Text style={styles.resendSmsText}>Re-send SMS to Family</Text>
                            </TouchableOpacity>
                        </View>

                        <TouchableOpacity style={styles.callBtn} onPress={() => Linking.openURL('tel:911')}>
                            <Ionicons name="call" size={20} color={Colors.white} />
                            <Text style={styles.callText}>Call 911</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.doneBtn} onPress={() => { isTriggeringRef.current = false; setPhase('idle'); navigation.goBack(); }}>
                            <Text style={styles.doneBtnText}>Done</Text>
                        </TouchableOpacity>
                    </>
                )}
            </View>

            {/* Info Cards */}
            <View style={styles.infoRow}>
                {[
                    { icon: 'location', label: 'GPS Location\nShared' },
                    { icon: 'chatbubbles', label: 'SMS Alert\nDispatched' },
                    { icon: 'people', label: 'Family\nNotified' },
                    { icon: 'call', label: '911\nAvailable' },
                ].map((item) => (
                    <View key={item.label} style={styles.infoCard}>
                        <Ionicons name={item.icon as any} size={18} color={Colors.sos} />
                        <Text style={styles.infoLabel}>{item.label}</Text>
                    </View>
                ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#1a0008', alignItems: 'center' },
    backBtn: { position: 'absolute', top: 48, left: 20, zIndex: 10, padding: 8 },
    screenTitle: { marginTop: 48, fontSize: 26, fontWeight: '800', color: Colors.white, letterSpacing: 1 },
    screenSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.55)', marginTop: 4 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    buttonWrapper: {
        width: 240,
        height: 240,
        alignItems: 'center',
        justifyContent: 'center',
    },
    outerRing: {
        position: 'absolute',
        width: 220,
        height: 220,
        borderRadius: 110,
        backgroundColor: Colors.sos + '25',
    },
    outerRingActive: { backgroundColor: Colors.sos + '40' },
    sosBtn: {
        width: 180,
        height: 180,
        borderRadius: 90,
        backgroundColor: Colors.sos,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: Colors.sos,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.7,
        shadowRadius: 28,
        elevation: 12,
    },
    sosBtnSent: { backgroundColor: Colors.tracker },
    sosBtnText: { color: Colors.white, fontSize: 28, fontWeight: '900', letterSpacing: 3, marginTop: 4 },
    sosBtnSub: { color: 'rgba(255,255,255,0.75)', fontSize: 12 },
    countdownNum: { color: Colors.white, fontSize: 64, fontWeight: '900' },
    countdownLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 13 },
    hint: { color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 24, textAlign: 'center', paddingHorizontal: 40 },
    cancelBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        marginTop: 28, backgroundColor: 'rgba(255,255,255,0.15)',
        paddingHorizontal: 28, paddingVertical: 14, borderRadius: BorderRadius.full,
    },
    cancelText: { color: Colors.white, fontWeight: '700', fontSize: 16 },
    callBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        marginTop: 14, backgroundColor: Colors.sos,
        paddingHorizontal: 32, paddingVertical: 14, borderRadius: BorderRadius.full,
    },
    callText: { color: Colors.white, fontWeight: '700', fontSize: 16 },
    smsAlertCard: {
        marginTop: 16,
        marginHorizontal: Spacing.lg,
        backgroundColor: 'rgba(16, 185, 129, 0.12)',
        borderColor: 'rgba(16, 185, 129, 0.4)',
        borderWidth: 1,
        borderRadius: BorderRadius.lg,
        padding: Spacing.md,
        width: '90%',
        alignItems: 'center',
    },
    smsAlertHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 4,
    },
    smsAlertTitle: {
        color: '#10B981',
        fontSize: 14,
        fontWeight: '800',
    },
    smsAlertBody: {
        color: 'rgba(255, 255, 255, 0.8)',
        fontSize: 12,
        textAlign: 'center',
        lineHeight: 16,
        marginBottom: 10,
    },
    resendSmsBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#059669',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: BorderRadius.full,
    },
    resendSmsText: {
        color: Colors.white,
        fontSize: 12,
        fontWeight: '700',
    },
    doneBtn: { marginTop: 8, paddingVertical: 8, paddingHorizontal: 32 },
    doneBtnText: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
    infoRow: {
        flexDirection: 'row', gap: Spacing.sm,
        paddingHorizontal: Spacing.lg, paddingBottom: 40,
    },
    infoCard: {
        flex: 1, backgroundColor: 'rgba(255,255,255,0.08)',
        borderRadius: BorderRadius.md, padding: Spacing.md,
        alignItems: 'center', gap: 6,
    },
    infoLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 11, textAlign: 'center' },
});
