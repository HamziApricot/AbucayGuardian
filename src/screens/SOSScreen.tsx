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

import { useAlert } from '../context/AlertContext';

type Props = { navigation: any };

const COUNTDOWN = 3;

export default function SOSScreen({ navigation }: Props) {
    const insets = useSafeAreaInsets();
    const { user, userProfile } = useAuth();
    const { showAlert } = useAlert();
    const [phase, setPhase] = useState<'idle' | 'countdown' | 'sent'>('idle');
    const [count, setCount] = useState(COUNTDOWN);
    const intervalRef = useRef<any>(null);
    const watchRef = useRef<any>(null);
    const pulseAnim = useRef(new Animated.Value(1)).current;
    const shakeAnim = useRef(new Animated.Value(0)).current;

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
        setPhase('countdown');
        setCount(COUNTDOWN);
        Vibration.vibrate([0, 300, 200, 300]);
        intervalRef.current = setInterval(async () => {
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
        setPhase('idle');
        setCount(COUNTDOWN);
        Vibration.cancel();
    };

    const triggerSOS = async () => {
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

        // Offer to call 911
        showAlert({
            title: '🚨 SOS Sent!',
            message: 'Your emergency alert has been sent to your family. Do you want to call 911 now?',
            type: 'warning',
            buttons: [
                { text: 'Call 911', style: 'destructive', onPress: () => Linking.openURL('tel:911') },
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
                        <TouchableOpacity style={styles.callBtn} onPress={() => Linking.openURL('tel:911')}>
                            <Ionicons name="call" size={20} color={Colors.white} />
                            <Text style={styles.callText}>Call 911</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.doneBtn} onPress={() => { setPhase('idle'); navigation.goBack(); }}>
                            <Text style={styles.doneBtnText}>Done</Text>
                        </TouchableOpacity>
                    </>
                )}
            </View>

            {/* Info Cards */}
            <View style={styles.infoRow}>
                {[
                    { icon: 'location', label: 'GPS Location\nShared' },
                    { icon: 'people', label: 'Family\nNotified' },
                    { icon: 'call', label: '911\nAvailable' },
                ].map((item) => (
                    <View key={item.label} style={styles.infoCard}>
                        <Ionicons name={item.icon as any} size={20} color={Colors.sos} />
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
        marginTop: 20, backgroundColor: Colors.sos,
        paddingHorizontal: 32, paddingVertical: 14, borderRadius: BorderRadius.full,
    },
    callText: { color: Colors.white, fontWeight: '700', fontSize: 16 },
    doneBtn: { marginTop: 12, paddingVertical: 10, paddingHorizontal: 32 },
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
