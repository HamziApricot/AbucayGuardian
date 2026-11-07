import React, { useState } from 'react';
import {
    View, Text, StyleSheet, FlatList, TouchableOpacity, Linking,
    TextInput, SectionList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius } from '../constants/theme';
import { HOTLINES } from '../constants/hotlines';

const CATEGORIES = ['All', 'Emergency', 'Medical', 'Police', 'Fire', 'Disaster', 'Security', 'Utility'];

export default function HotlinesScreen() {
    const insets = useSafeAreaInsets();
    const [search, setSearch] = useState('');
    const [selectedCat, setSelectedCat] = useState('All');

    const filtered = HOTLINES.filter((h) => {
        const matchSearch = h.name.toLowerCase().includes(search.toLowerCase()) || h.number.includes(search);
        const matchCat = selectedCat === 'All' || h.category === selectedCat;
        return matchSearch && matchCat;
    });

    const handleCall = (number: string) => {
        const clean = number.replace(/[-\s()]/g, '');
        Linking.openURL(`tel:${clean}`);
    };

    return (
        <View style={styles.container}>
            {/* Premium Header */}
            <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
                <View style={styles.headerContent}>
                    <View>
                        <Text style={styles.headerTitle}>Abucay Hotlines</Text>
                        <Text style={styles.headerSub}>Emergency and Utility Services</Text>
                    </View>
                    <View style={styles.headerIcon}>
                        <Ionicons name="call" size={24} color={Colors.white} />
                    </View>
                </View>

                {/* Modern Search */}
                <View style={styles.searchContainer}>
                    <Ionicons name="search-outline" size={20} color={Colors.textMuted} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search agency or number..."
                        placeholderTextColor={Colors.textMuted}
                        value={search}
                        onChangeText={setSearch}
                    />
                    {search.length > 0 && (
                        <TouchableOpacity onPress={() => setSearch('')}>
                            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {/* Category Filter */}
            <View>
                <FlatList
                    data={CATEGORIES}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    keyExtractor={(item) => item}
                    contentContainerStyle={styles.catList}
                    renderItem={({ item }) => (
                        <TouchableOpacity
                            style={[styles.catChip, selectedCat === item && styles.catChipActive]}
                            onPress={() => setSelectedCat(item)}
                        >
                            <Text style={[styles.catChipText, selectedCat === item && styles.catChipTextActive]}>
                                {item}
                            </Text>
                        </TouchableOpacity>
                    )}
                />
            </View>

            {/* Hotlines List */}
            <FlatList
                data={filtered}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.list}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                    <View style={styles.empty}>
                        <View style={styles.emptyIcon}>
                            <Ionicons name="search-outline" size={48} color={Colors.textMuted} />
                        </View>
                        <Text style={styles.emptyText}>No matching contacts found</Text>
                        <Text style={styles.emptySub}>Try searching for a different keyword</Text>
                    </View>
                }
                renderItem={({ item }) => (
                    <TouchableOpacity
                        style={styles.card}
                        activeOpacity={0.7}
                        onPress={() => handleCall(item.number)}
                    >
                        <View style={[styles.iconBox, { backgroundColor: item.color + '15' }]}>
                            <Ionicons name={item.icon as any} size={26} color={item.color} />
                        </View>
                        <View style={styles.info}>
                            <Text style={styles.name}>{item.name}</Text>
                            <Text style={styles.numberText}>{item.number}</Text>
                            <View style={[styles.badge, { backgroundColor: item.color + '10' }]}>
                                <Text style={[styles.badgeText, { color: item.color }]}>{item.category}</Text>
                            </View>
                        </View>
                        <View style={styles.callAction}>
                            <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
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
        backgroundColor: Colors.secondary,
        paddingTop: 48,
        paddingBottom: 28,
        paddingHorizontal: Spacing.lg,
        borderBottomLeftRadius: 32,
        borderBottomRightRadius: 32,
        shadowColor: Colors.secondary,
        shadowOpacity: 0.3,
        shadowRadius: 15,
        elevation: 10,
    },
    headerContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
    headerTitle: { fontSize: 28, fontWeight: '900', color: Colors.white, letterSpacing: -0.5 },
    headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
    headerIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
    searchContainer: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: Colors.white,
        borderRadius: BorderRadius.lg,
        paddingHorizontal: Spacing.md, height: 52,
        shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 5,
    },
    searchInput: { flex: 1, fontSize: 15, color: Colors.text, marginLeft: 10, fontWeight: '500' },
    catList: { paddingHorizontal: Spacing.lg, paddingVertical: 20, gap: 10 },
    catChip: {
        paddingHorizontal: 18, paddingVertical: 9,
        borderRadius: 14,
        backgroundColor: Colors.white,
        borderWidth: 1, borderColor: '#EEE',
        shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 5, elevation: 1,
    },
    catChipActive: { backgroundColor: Colors.secondary, borderColor: Colors.secondary },
    catChipText: { fontSize: 13, fontWeight: '700', color: Colors.textLight },
    catChipTextActive: { color: Colors.white },
    list: { paddingHorizontal: Spacing.lg, paddingBottom: 40 },
    card: {
        flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
        backgroundColor: Colors.white,
        borderRadius: 20, padding: 16,
        marginBottom: 14,
        shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 12, elevation: 3,
    },
    iconBox: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    info: { flex: 1 },
    name: { fontSize: 16, fontWeight: '800', color: Colors.text },
    numberText: { fontSize: 14, color: Colors.textLight, marginTop: 3, fontWeight: '600' },
    badge: {
        marginTop: 8, alignSelf: 'flex-start',
        borderRadius: 8,
        paddingHorizontal: 10, paddingVertical: 4,
    },
    badgeText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
    callAction: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F8F9FA', alignItems: 'center', justifyContent: 'center' },
    empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: 40 },
    emptyIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#F1F3F5', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
    emptyText: { color: Colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
    emptySub: { color: Colors.textMuted, fontSize: 14, textAlign: 'center', marginTop: 8 },
});

