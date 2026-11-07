import React, { useState, useMemo, useEffect } from 'react';
import {
    View, Text, StyleSheet, FlatList, TouchableOpacity, ScrollView,
    TextInput, Linking, Share, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius } from '../constants/theme';
import { PROCEDURES } from '../constants/procedures';
import { Procedure } from '../types';

type Props = { route?: any; navigation?: any };

const CATEGORIES = [
    'All',
    'Natural Disaster',
    'Medical & First Aid',
    'Fire & Hazards',
    'Accidents & Public Safety',
];

export default function ProceduresScreen({ route, navigation }: Props) {
    const insets = useSafeAreaInsets();
    const [selectedId, setSelectedId] = useState<string | null>(route?.params?.selectedId ?? null);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [completedSteps, setCompletedSteps] = useState<{ [key: string]: boolean }>({});

    // Keep selectedId in sync if passed from navigation
    useEffect(() => {
        if (route?.params?.selectedId) {
            setSelectedId(route?.params?.selectedId);
        }
    }, [route?.params?.selectedId]);

    const selected: Procedure | null = useMemo(() => {
        return PROCEDURES.find((p) => p.id === selectedId) ?? null;
    }, [selectedId]);

    // Filter procedures based on search query and category
    const filteredProcedures = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        return PROCEDURES.filter((item) => {
            const matchesCategory =
                selectedCategory === 'All' || item.category.toLowerCase() === selectedCategory.toLowerCase();

            if (!matchesCategory) return false;
            if (!query) return true;

            const inTitle = item.title.toLowerCase().includes(query);
            const inCategory = item.category.toLowerCase().includes(query);
            const inSummary = item.summary?.toLowerCase().includes(query) ?? false;
            const inSteps = item.steps.some((s) => s.toLowerCase().includes(query));
            const inDoNots = item.doNots?.some((d) => d.toLowerCase().includes(query)) ?? false;

            return inTitle || inCategory || inSummary || inSteps || inDoNots;
        });
    }, [searchQuery, selectedCategory]);

    const toggleStep = (stepIndex: number) => {
        if (!selected) return;
        const key = `${selected.id}-${stepIndex}`;
        setCompletedSteps((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const handleCall = (phoneNumber: string) => {
        const cleaned = phoneNumber.replace(/[^0-9+]/g, '');
        Linking.openURL(`tel:${cleaned}`).catch(() => {
            Alert.alert('Unable to place call', `Please dial ${phoneNumber} manually.`);
        });
    };

    const handleShare = async () => {
        if (!selected) return;
        try {
            const stepsText = selected.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
            const doNotsText = selected.doNots?.length
                ? `\n\n⚠️ WHAT NOT TO DO:\n${selected.doNots.map((d) => `• ${d}`).join('\n')}`
                : '';
            const hotlineText = selected.urgentCall
                ? `\n\n🚨 Emergency Hotline: ${selected.urgentCall.name} (${selected.urgentCall.number})`
                : '';

            await Share.share({
                title: `Emergency Guide: ${selected.title}`,
                message: `📋 EMERGENCY GUIDE: ${selected.title} (${selected.category})\n\n${selected.summary || ''}\n\nACTION STEPS:\n${stepsText}${doNotsText}${hotlineText}\n\n— Shared from Abucay Guardian`,
            });
        } catch { }
    };

    // Detail View for a selected procedure
    if (selected) {
        const completedCount = selected.steps.filter((_, i) => completedSteps[`${selected.id}-${i}`]).length;

        return (
            <ScrollView style={styles.container} contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator={false}>
                {/* Immersive Header */}
                <View style={[styles.detailHeader, { backgroundColor: selected.color, paddingTop: Math.max(insets.top, 24) }]}>
                    <View style={styles.detailNavRow}>
                        <TouchableOpacity style={styles.backBtn} onPress={() => setSelectedId(null)} activeOpacity={0.8}>
                            <Ionicons name="chevron-back" size={20} color={Colors.white} />
                            <Text style={styles.backText}>All Guides</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.8}>
                            <Ionicons name="share-social-outline" size={20} color={Colors.white} />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.detailIconOuter}>
                        <View style={styles.detailIconInner}>
                            <Ionicons name={selected.icon as any} size={42} color={selected.color} />
                        </View>
                    </View>

                    <Text style={styles.detailTitle}>{selected.title}</Text>
                    <View style={styles.detailBadge}>
                        <Text style={styles.detailCategory}>{selected.category}</Text>
                    </View>

                    {selected.summary && (
                        <Text style={styles.detailSummary}>{selected.summary}</Text>
                    )}
                </View>

                {/* Direct Emergency Call Banner if available */}
                {selected.urgentCall && (
                    <View style={styles.urgentBannerContainer}>
                        <View style={styles.urgentBanner}>
                            <View style={styles.urgentInfo}>
                                <Text style={styles.urgentPrompt}>Immediate Assistance Needed?</Text>
                                <Text style={styles.urgentName}>{selected.urgentCall.name}</Text>
                                <Text style={styles.urgentNumber}>{selected.urgentCall.number}</Text>
                            </View>
                            <TouchableOpacity
                                style={styles.urgentCallBtn}
                                activeOpacity={0.85}
                                onPress={() => handleCall(selected.urgentCall!.number)}
                            >
                                <Ionicons name="call" size={18} color={Colors.white} />
                                <Text style={styles.urgentCallBtnText}>{selected.urgentCall.label || 'Call'}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                )}

                {/* Steps Section */}
                <View style={styles.stepsWrapper}>
                    <View style={styles.stepsHeader}>
                        <View style={styles.stepsHeaderLeft}>
                            <Ionicons name="list" size={18} color={Colors.text} />
                            <Text style={styles.stepsLabel}>Recommended Action Plan</Text>
                        </View>
                        <Text style={styles.stepsProgressBadge}>
                            {completedCount}/{selected.steps.length} Done
                        </Text>
                    </View>

                    {selected.steps.map((step, index) => {
                        const isDone = !!completedSteps[`${selected.id}-${index}`];
                        return (
                            <TouchableOpacity
                                key={index}
                                style={[styles.stepCard, isDone && styles.stepCardDone]}
                                activeOpacity={0.7}
                                onPress={() => toggleStep(index)}
                            >
                                <View style={[styles.stepNum, { backgroundColor: isDone ? Colors.tracker : selected.color }]}>
                                    {isDone ? (
                                        <Ionicons name="checkmark" size={16} color={Colors.white} />
                                    ) : (
                                        <Text style={styles.stepNumText}>{index + 1}</Text>
                                    )}
                                </View>
                                <View style={styles.stepTextContainer}>
                                    <Text style={[styles.stepText, isDone && styles.stepTextDone]}>{step}</Text>
                                </View>
                                <Ionicons
                                    name={isDone ? 'checkbox' : 'square-outline'}
                                    size={20}
                                    color={isDone ? Colors.tracker : '#CCD4E5'}
                                />
                            </TouchableOpacity>
                        );
                    })}
                </View>

                {/* Critical "What NOT to Do" Alert Box */}
                {selected.doNots && selected.doNots.length > 0 && (
                    <View style={styles.doNotWrapper}>
                        <View style={styles.doNotHeader}>
                            <Ionicons name="close-circle" size={20} color={Colors.sos} />
                            <Text style={styles.doNotLabel}>CRITICAL: WHAT NOT TO DO</Text>
                        </View>
                        <View style={styles.doNotCard}>
                            {selected.doNots.map((item, idx) => (
                                <View key={idx} style={styles.doNotRow}>
                                    <View style={styles.doNotBullet}>
                                        <Ionicons name="close" size={14} color={Colors.sos} />
                                    </View>
                                    <Text style={styles.doNotText}>{item}</Text>
                                </View>
                            ))}
                        </View>
                    </View>
                )}

                {/* Emergency Supplies / Kit */}
                {selected.emergencyKit && selected.emergencyKit.length > 0 && (
                    <View style={styles.kitWrapper}>
                        <View style={styles.kitHeader}>
                            <Ionicons name="bag-check" size={18} color={Colors.text} />
                            <Text style={styles.kitLabel}>Recommended Supplies & Equipment</Text>
                        </View>
                        <View style={styles.kitItems}>
                            {selected.emergencyKit.map((kitItem, idx) => (
                                <View key={idx} style={styles.kitChip}>
                                    <Ionicons name="checkmark-circle-outline" size={14} color={Colors.tracker} />
                                    <Text style={styles.kitChipText}>{kitItem}</Text>
                                </View>
                            ))}
                        </View>
                    </View>
                )}

                {/* Footer with Universal 911 Call & Offline Storage Notice */}
                <View style={styles.footer}>
                    <TouchableOpacity
                        style={styles.global911Btn}
                        activeOpacity={0.85}
                        onPress={() => handleCall('911')}
                    >
                        <Ionicons name="warning" size={18} color={Colors.white} />
                        <Text style={styles.global911Text}>Call 911 Emergency Hotline</Text>
                    </TouchableOpacity>

                    <View style={styles.offlineBadge}>
                        <Ionicons name="shield-checkmark" size={16} color={Colors.tracker} />
                        <Text style={styles.offlineBadgeText}>Stored 100% locally for offline survival access</Text>
                    </View>
                </View>
                <View style={{ height: 40 }} />
            </ScrollView>
        );
    }

    // List View for all procedures
    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
                <View style={styles.headerTop}>
                    <View>
                        <Text style={styles.headerTitle}>Emergency Procedures</Text>
                        <Text style={styles.headerSub}>Offline survival & response guides</Text>
                    </View>
                    <View style={styles.headerIcon}>
                        <Ionicons name="book" size={24} color={Colors.white} />
                    </View>
                </View>

                {/* Search Bar */}
                <View style={styles.searchContainer}>
                    <Ionicons name="search" size={18} color={Colors.textLight} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search procedures, symptoms, hazards..."
                        placeholderTextColor={Colors.textMuted}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        clearButtonMode="while-editing"
                        returnKeyType="search"
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setSearchQuery('')}>
                            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {/* Category Filter Chips */}
            <View style={styles.categoryContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryScroll}>
                    {CATEGORIES.map((cat) => {
                        const isSelected = selectedCategory === cat;
                        return (
                            <TouchableOpacity
                                key={cat}
                                style={[styles.categoryChip, isSelected && styles.categoryChipActive]}
                                onPress={() => setSelectedCategory(cat)}
                                activeOpacity={0.75}
                            >
                                <Text style={[styles.categoryChipText, isSelected && styles.categoryChipTextActive]}>
                                    {cat}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>
            </View>

            {/* Results count & status */}
            <View style={styles.countRow}>
                <Text style={styles.countText}>
                    Showing {filteredProcedures.length} {filteredProcedures.length === 1 ? 'guide' : 'guides'}
                </Text>
                <View style={styles.offlineMiniBadge}>
                    <Ionicons name="cloud-offline-outline" size={13} color={Colors.tracker} />
                    <Text style={styles.offlineMiniText}>Offline ready</Text>
                </View>
            </View>

            {/* List */}
            <FlatList
                data={filteredProcedures}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.list}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Ionicons name="search-outline" size={48} color={Colors.textMuted} />
                        <Text style={styles.emptyTitle}>No procedures found</Text>
                        <Text style={styles.emptySub}>
                            Try searching for different keywords like "cpr", "flood", "burn", or "electric".
                        </Text>
                        <TouchableOpacity
                            style={styles.resetBtn}
                            onPress={() => {
                                setSearchQuery('');
                                setSelectedCategory('All');
                            }}
                        >
                            <Text style={styles.resetBtnText}>Clear filters</Text>
                        </TouchableOpacity>
                    </View>
                }
                renderItem={({ item }) => (
                    <TouchableOpacity
                        style={styles.card}
                        activeOpacity={0.7}
                        onPress={() => setSelectedId(item.id)}
                    >
                        <View style={[styles.iconBox, { backgroundColor: item.color + '18' }]}>
                            <Ionicons name={item.icon as any} size={28} color={item.color} />
                        </View>
                        <View style={styles.cardInfo}>
                            <Text style={styles.cardTitle}>{item.title}</Text>
                            {item.summary && (
                                <Text style={styles.cardSummary} numberOfLines={2}>
                                    {item.summary}
                                </Text>
                            )}
                            <View style={styles.cardMeta}>
                                <View style={[styles.miniBadge, { backgroundColor: item.color + '15' }]}>
                                    <Text style={[styles.miniBadgeText, { color: item.color }]}>{item.category}</Text>
                                </View>
                                <Text style={styles.cardSteps}>• {item.steps.length} steps</Text>
                                {item.urgentCall && (
                                    <View style={styles.callAvailableBadge}>
                                        <Ionicons name="call" size={10} color={Colors.tracker} />
                                        <Text style={styles.callAvailableText}>Hotline</Text>
                                    </View>
                                )}
                            </View>
                        </View>
                        <View style={styles.chevronBox}>
                            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                        </View>
                    </TouchableOpacity>
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F8F9FA' },
    header: {
        backgroundColor: Colors.family,
        paddingTop: 48,
        paddingBottom: 20,
        paddingHorizontal: Spacing.lg,
        borderBottomLeftRadius: 28,
        borderBottomRightRadius: 28,
        shadowColor: Colors.family,
        shadowOpacity: 0.25,
        shadowRadius: 12,
        elevation: 8,
    },
    headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    headerTitle: { fontSize: 24, fontWeight: '900', color: Colors.white, letterSpacing: -0.5 },
    headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
    headerIcon: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(255,255,255,0.2)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Colors.white,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginTop: 16,
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 3,
        gap: 8,
    },
    searchInput: {
        flex: 1,
        fontSize: 14,
        color: Colors.text,
        paddingVertical: 0,
    },
    categoryContainer: {
        marginTop: 12,
        marginBottom: 4,
    },
    categoryScroll: {
        paddingHorizontal: Spacing.lg,
        gap: 8,
    },
    categoryChip: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: Colors.white,
        borderWidth: 1,
        borderColor: '#E6E9F0',
    },
    categoryChipActive: {
        backgroundColor: Colors.family,
        borderColor: Colors.family,
    },
    categoryChipText: {
        fontSize: 12,
        fontWeight: '600',
        color: Colors.textLight,
    },
    categoryChipTextActive: {
        color: Colors.white,
        fontWeight: '700',
    },
    countRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        marginTop: 10,
        marginBottom: 4,
    },
    countText: {
        fontSize: 12,
        color: Colors.textLight,
        fontWeight: '600',
    },
    offlineMiniBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: '#EAF7EE',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
    },
    offlineMiniText: {
        fontSize: 11,
        fontWeight: '700',
        color: Colors.tracker,
    },
    list: { padding: Spacing.lg, paddingTop: 8, paddingBottom: 100 },
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        backgroundColor: Colors.white,
        borderRadius: 18,
        padding: 16,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOpacity: 0.04,
        shadowRadius: 10,
        elevation: 2,
        borderWidth: 1,
        borderColor: '#F0F2F5',
    },
    iconBox: {
        width: 52,
        height: 52,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cardInfo: { flex: 1 },
    cardTitle: { fontSize: 16, fontWeight: '800', color: Colors.text, marginBottom: 2 },
    cardSummary: { fontSize: 12, color: Colors.textLight, lineHeight: 16, marginBottom: 6 },
    cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    miniBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
    },
    miniBadgeText: {
        fontSize: 10,
        fontWeight: '700',
        textTransform: 'uppercase',
    },
    cardSteps: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' },
    callAvailableBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        backgroundColor: '#EAF7EE',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
    },
    callAvailableText: {
        fontSize: 10,
        color: Colors.tracker,
        fontWeight: '700',
    },
    chevronBox: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: '#F8F9FA',
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 60,
        paddingHorizontal: 32,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: Colors.text,
        marginTop: 12,
    },
    emptySub: {
        fontSize: 13,
        color: Colors.textLight,
        textAlign: 'center',
        marginTop: 6,
        lineHeight: 18,
    },
    resetBtn: {
        marginTop: 16,
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: Colors.family,
        borderRadius: 20,
    },
    resetBtnText: {
        color: Colors.white,
        fontWeight: '700',
        fontSize: 13,
    },

    // Detail View Styles
    detailContent: { backgroundColor: '#F8F9FA' },
    detailHeader: {
        paddingTop: 52,
        paddingBottom: 36,
        paddingHorizontal: Spacing.lg,
        alignItems: 'center',
        borderBottomLeftRadius: 32,
        borderBottomRightRadius: 32,
    },
    detailNavRow: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    backBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: 'rgba(0,0,0,0.18)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
    },
    backText: { color: Colors.white, fontWeight: '700', fontSize: 13 },
    shareBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(0,0,0,0.18)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    detailIconOuter: {
        width: 90,
        height: 90,
        borderRadius: 45,
        backgroundColor: 'rgba(255,255,255,0.22)',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 14,
    },
    detailIconInner: {
        width: 72,
        height: 72,
        borderRadius: 36,
        backgroundColor: Colors.white,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 8,
        elevation: 4,
    },
    detailTitle: {
        fontSize: 24,
        fontWeight: '900',
        color: Colors.white,
        textAlign: 'center',
        paddingHorizontal: 10,
    },
    detailBadge: {
        marginTop: 8,
        backgroundColor: 'rgba(255,255,255,0.25)',
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 10,
    },
    detailCategory: {
        fontSize: 11,
        color: Colors.white,
        fontWeight: '800',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    detailSummary: {
        marginTop: 12,
        fontSize: 13,
        color: 'rgba(255,255,255,0.92)',
        textAlign: 'center',
        lineHeight: 19,
        paddingHorizontal: 8,
    },

    // Urgent Hotline Banner
    urgentBannerContainer: {
        paddingHorizontal: Spacing.lg,
        marginTop: -16,
        zIndex: 10,
    },
    urgentBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: Colors.white,
        borderRadius: 18,
        padding: 16,
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 10,
        elevation: 4,
        borderLeftWidth: 5,
        borderLeftColor: Colors.sos,
    },
    urgentInfo: { flex: 1, paddingRight: 10 },
    urgentPrompt: { fontSize: 11, fontWeight: '700', color: Colors.sos, textTransform: 'uppercase', letterSpacing: 0.5 },
    urgentName: { fontSize: 14, fontWeight: '800', color: Colors.text, marginTop: 2 },
    urgentNumber: { fontSize: 12, fontWeight: '600', color: Colors.textLight, marginTop: 1 },
    urgentCallBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: Colors.tracker,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 12,
        shadowColor: Colors.tracker,
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 3,
    },
    urgentCallBtnText: {
        color: Colors.white,
        fontWeight: '800',
        fontSize: 13,
    },

    // Steps
    stepsWrapper: { padding: Spacing.lg, paddingTop: 16 },
    stepsHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    stepsHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    stepsLabel: {
        fontSize: 13,
        fontWeight: '800',
        color: Colors.text,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    stepsProgressBadge: {
        fontSize: 12,
        fontWeight: '700',
        color: Colors.tracker,
        backgroundColor: '#EAF7EE',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
    },
    stepCard: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 14,
        marginBottom: 12,
        backgroundColor: Colors.white,
        borderRadius: 16,
        padding: 16,
        shadowColor: '#000',
        shadowOpacity: 0.03,
        shadowRadius: 8,
        elevation: 2,
        borderWidth: 1,
        borderColor: '#F0F2F5',
    },
    stepCardDone: {
        backgroundColor: '#F8FCF9',
        borderColor: '#C7EAD1',
    },
    stepNum: {
        width: 26,
        height: 26,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        marginTop: 1,
    },
    stepNumText: { fontWeight: '900', fontSize: 13, color: Colors.white },
    stepTextContainer: { flex: 1 },
    stepText: { fontSize: 14, color: Colors.text, lineHeight: 22, fontWeight: '500' },
    stepTextDone: { color: Colors.textLight, textDecorationLine: 'line-through' },

    // What NOT To Do Section
    doNotWrapper: { paddingHorizontal: Spacing.lg, marginBottom: 16 },
    doNotHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 10,
    },
    doNotLabel: {
        fontSize: 12,
        fontWeight: '900',
        color: Colors.sos,
        letterSpacing: 0.6,
    },
    doNotCard: {
        backgroundColor: '#FFF5F5',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: '#FFD7D7',
        gap: 10,
    },
    doNotRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
    },
    doNotBullet: {
        width: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: '#FFE3E3',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
    },
    doNotText: {
        flex: 1,
        fontSize: 13,
        color: '#8A1C24',
        lineHeight: 18,
        fontWeight: '600',
    },

    // Kit Section
    kitWrapper: { paddingHorizontal: Spacing.lg, marginBottom: 16 },
    kitHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 10,
    },
    kitLabel: {
        fontSize: 12,
        fontWeight: '800',
        color: Colors.text,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    kitItems: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    kitChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: Colors.white,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#E6EBF5',
    },
    kitChipText: {
        fontSize: 12,
        fontWeight: '600',
        color: Colors.text,
    },

    // Footer
    footer: { padding: Spacing.lg, alignItems: 'center', gap: 12 },
    global911Btn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        width: '100%',
        backgroundColor: Colors.sos,
        paddingVertical: 14,
        borderRadius: 16,
        shadowColor: Colors.sos,
        shadowOpacity: 0.35,
        shadowRadius: 8,
        elevation: 4,
    },
    global911Text: {
        color: Colors.white,
        fontSize: 14,
        fontWeight: '800',
        letterSpacing: 0.3,
    },
    offlineBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: Colors.white,
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#EEE',
    },
    offlineBadgeText: { fontSize: 11, color: Colors.textLight, fontWeight: '700' },
});
