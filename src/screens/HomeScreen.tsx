import React, { useRef, useState } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    Linking, Dimensions, Animated, Alert, Vibration,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { HOTLINES } from '../constants/hotlines';
import { PROCEDURES } from '../constants/procedures';

import { useAlert } from '../context/AlertContext';

const { width } = Dimensions.get('window');

type Props = { navigation: any };

const QuickCard = ({ icon, label, color, onPress }: any) => (
    <TouchableOpacity style={[styles.quickCard, { borderTopColor: color }]} onPress={onPress}>
        <View style={[styles.quickIcon, { backgroundColor: color + '20' }]}>
            <Ionicons name={icon} size={24} color={color} />
        </View>
        <Text style={styles.quickLabel}>{label}</Text>
    </TouchableOpacity>
);

export default function HomeScreen({ navigation }: Props) {
    const { userProfile } = useAuth();
    const insets = useSafeAreaInsets();
    const { showAlert } = useAlert();
    const pulseAnim = useRef(new Animated.Value(1)).current;

    const [familyMemberIds, setFamilyMemberIds] = useState<string[]>([]);

    React.useEffect(() => {
        const pulse = Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, { toValue: 1.08, duration: 800, useNativeDriver: true }),
                Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
            ])
        );
        pulse.start();

        fetchFamilyIds();

        // Subscribe to SOS alerts
        const channel = supabase
            .channel('global-sos')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sos_events' }, (payload: any) => {
                const newSOS = payload.new;
                // Only alert if the user is in our family list
                if (familyMemberIds.includes(newSOS.user_id)) {
                    showAlert({
                        title: '🚨 EMERGENCY ALERT',
                        message: 'A family member has triggered an SOS! Check the Tracker immediately.',
                        type: 'error',
                        buttons: [
                            { text: 'View Tracker', onPress: () => navigation.navigate('Tracker') },
                            { text: 'Dismiss', style: 'cancel' }
                        ]
                    });
                    Vibration.vibrate([0, 500, 200, 500]);
                }
            })
            .subscribe();

        return () => {
            pulse.stop();
            supabase.removeChannel(channel);
        };
    }, [familyMemberIds]);

    const fetchFamilyIds = async () => {
        const { data } = await supabase.from('family_members').select('member_user_id');
        if (data) {
            setFamilyMemberIds(data.map((m: any) => m.member_user_id).filter(Boolean));
        }
    };

    const topHotlines = HOTLINES.slice(0, 3);

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {/* Header */}
            <View style={styles.headerBg}>
                <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
                    <View>
                        <Text style={styles.greeting}>Hello, {userProfile?.name?.split(' ')[0] ?? 'Guardian'} 👋</Text>
                        <Text style={styles.headerSub}>Stay safe in Abucay, Bataan</Text>
                    </View>
                    <TouchableOpacity style={styles.profileBtn} onPress={() => navigation.navigate('Profile')}>
                        <Ionicons name="person-circle-outline" size={36} color={Colors.white} />
                    </TouchableOpacity>
                </View>

                {/* SOS Button */}
                <View style={styles.sosWrapper}>
                    <Animated.View style={[styles.sosPulse, { transform: [{ scale: pulseAnim }] }]} />
                    <TouchableOpacity
                        style={styles.sosBtn}
                        onPress={() => navigation.navigate('SOS')}
                        activeOpacity={0.85}
                    >
                        <Ionicons name="warning" size={36} color={Colors.white} />
                        <Text style={styles.sosBtnText}>SOS</Text>
                        <Text style={styles.sosBtnSub}>Emergency</Text>
                    </TouchableOpacity>
                </View>
                <Text style={styles.sosTip}>Tap to activate SOS alert</Text>
            </View>

            {/* Quick Actions */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Quick Actions</Text>
                <View style={styles.quickGrid}>
                    <QuickCard icon="call" label="Hotlines" color={Colors.hotline} onPress={() => navigation.navigate('Hotlines')} />
                    <QuickCard icon="document-text" label="Procedures" color={Colors.family} onPress={() => navigation.navigate('Procedures')} />
                    <QuickCard icon="location" label="Tracker" color={Colors.tracker} onPress={() => navigation.navigate('Tracker')} />
                    <QuickCard icon="people" label="Family" color={Colors.family} onPress={() => navigation.navigate('Family')} />
                    <QuickCard icon="clipboard" label="Emergency Plan" color={Colors.emergencyPlan} onPress={() => navigation.navigate('EmergencyPlan')} />
                    <QuickCard icon="person" label="Profile" color={Colors.secondary} onPress={() => navigation.navigate('Profile')} />
                </View>
            </View>

            {/* Top Hotlines */}
            <View style={styles.section}>
                <View style={styles.sectionRow}>
                    <Text style={styles.sectionTitle}>Quick Call</Text>
                    <TouchableOpacity onPress={() => navigation.navigate('Hotlines')}>
                        <Text style={styles.seeAll}>See all</Text>
                    </TouchableOpacity>
                </View>
                {topHotlines.map((h) => (
                    <TouchableOpacity
                        key={h.id}
                        style={styles.hotlineRow}
                        onPress={() => Linking.openURL(`tel:${h.number.replace(/[-\s()]/g, '')}`)}
                    >
                        <View style={[styles.hotlineIcon, { backgroundColor: h.color + '18' }]}>
                            <Ionicons name={h.icon as any} size={20} color={h.color} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.hotlineName}>{h.name}</Text>
                            <Text style={styles.hotlineNumber}>{h.number}</Text>
                        </View>
                        <Ionicons name="call" size={18} color={Colors.tracker} />
                    </TouchableOpacity>
                ))}
            </View>

            {/* Top Procedures */}
            <View style={styles.section}>
                <View style={styles.sectionRow}>
                    <Text style={styles.sectionTitle}>Emergency Procedures</Text>
                    <TouchableOpacity onPress={() => navigation.navigate('Procedures')}>
                        <Text style={styles.seeAll}>See all</Text>
                    </TouchableOpacity>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.procScroll}>
                    {PROCEDURES.map((p) => (
                        <TouchableOpacity
                            key={p.id}
                            style={[styles.procCard, { borderBottomColor: p.color }]}
                            onPress={() => navigation.navigate('Procedures', { selectedId: p.id })}
                        >
                            <View style={[styles.procIcon, { backgroundColor: p.color + '20' }]}>
                                <Ionicons name={p.icon as any} size={22} color={p.color} />
                            </View>
                            <Text style={styles.procTitle}>{p.title}</Text>
                            <Text style={styles.procCategory}>{p.category}</Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            <View style={{ height: 80 }} />
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    content: {},
    headerBg: { backgroundColor: Colors.secondary, paddingBottom: Spacing.xl, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingTop: 48, // Base padding
        paddingBottom: Spacing.md
    },
    greeting: { fontSize: 20, fontWeight: '700', color: Colors.white },
    headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
    profileBtn: { padding: 4 },
    sosWrapper: {
        alignItems: 'center',
        justifyContent: 'center',
        width: 144,
        height: 144,
        alignSelf: 'center',
        marginTop: 4,
        marginBottom: 4,
    },
    sosPulse: {
        position: 'absolute',
        width: 136,
        height: 136,
        borderRadius: 68,
        backgroundColor: Colors.sos + '35',
    },
    sosBtn: {
        width: 120,
        height: 120,
        borderRadius: 60,
        backgroundColor: Colors.sos,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: Colors.sos,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.65,
        shadowRadius: 18,
        elevation: 8,
    },
    sosBtnText: { color: Colors.white, fontSize: 22, fontWeight: '900', letterSpacing: 2 },
    sosBtnSub: { color: 'rgba(255,255,255,0.8)', fontSize: 10, marginTop: -2 },
    sosTip: { textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 11, marginBottom: 4 },
    section: { padding: Spacing.lg, paddingBottom: 0 },
    sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: Spacing.sm },
    seeAll: { fontSize: 12, color: Colors.family, fontWeight: '600' },
    quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    quickCard: {
        width: (width - Spacing.lg * 2 - Spacing.sm * 2) / 3,
        backgroundColor: Colors.white,
        borderRadius: BorderRadius.md,
        padding: Spacing.md,
        alignItems: 'center',
        borderTopWidth: 3,
        shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
    },
    quickIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
    quickLabel: { fontSize: 11, fontWeight: '600', color: Colors.text, textAlign: 'center' },
    hotlineRow: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: Colors.white, borderRadius: BorderRadius.md,
        padding: Spacing.md, marginBottom: Spacing.sm,
        shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 1,
    },
    hotlineIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: Spacing.md },
    hotlineName: { fontSize: 14, fontWeight: '600', color: Colors.text },
    hotlineNumber: { fontSize: 12, color: Colors.textLight, marginTop: 2 },
    procScroll: { marginLeft: -4 },
    procCard: {
        backgroundColor: Colors.white, borderRadius: BorderRadius.md,
        padding: Spacing.md, marginRight: Spacing.sm, width: 110,
        borderBottomWidth: 3,
        shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
    },
    procIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
    procTitle: { fontSize: 12, fontWeight: '700', color: Colors.text },
    procCategory: { fontSize: 10, color: Colors.textLight, marginTop: 2 },
});
