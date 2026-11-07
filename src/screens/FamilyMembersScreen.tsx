import React, { useEffect, useState, useMemo } from 'react';
import {
    View, Text, StyleSheet, FlatList, TouchableOpacity,
    Modal, TextInput, ActivityIndicator, Linking, Image, ScrollView,
} from 'react-native';
import { useAlert } from '../context/AlertContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Colors, Spacing, BorderRadius } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { FamilyMember } from '../types';
import { getTrackingStatus } from '../utils/tracking';

const RELATIONSHIPS = ['Parent', 'Sibling', 'Child', 'Spouse', 'Relative', 'Friend', 'Other'];
const CATEGORY_TABS = ['All', 'Parent', 'Sibling', 'Child', 'Spouse', 'Relative', 'Friend', 'Other'];

const RELATIONSHIP_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
    Spouse: 'heart',
    Parent: 'shield-checkmark',
    Child: 'happy',
    Sibling: 'people',
    Relative: 'home',
    Friend: 'hand-left',
    Other: 'person',
};

const getRelColor = (rel: string) => {
    const map: Record<string, string> = {
        Spouse: '#E11D48',
        Parent: '#0284C7',
        Child: '#16A34A',
        Sibling: '#7C3AED',
        Relative: '#D97706',
        Friend: '#0D9488',
        Other: '#64748B',
    };
    return map[rel] ?? '#64748B';
};

export default function FamilyMembersScreen({ navigation }: any) {
    const { user, userProfile } = useAuth();
    const insets = useSafeAreaInsets();
    const { showAlert, showToast } = useAlert();
    const [members, setMembers] = useState<FamilyMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedCategory, setSelectedCategory] = useState<string>('All');
    const [tick, setTick] = useState(0);

    // UI States for Pairing
    const [modalVisible, setModalVisible] = useState(false);
    const [pairingMode, setPairingMode] = useState<'scan' | 'code' | 'display' | null>(null);
    const [scannedCode, setScannedCode] = useState('');
    const [relationship, setRelationship] = useState('Parent');
    const [saving, setSaving] = useState(false);

    // Edit Relationship State
    const [editingMember, setEditingMember] = useState<FamilyMember | null>(null);

    // Camera Permissions
    const [permission, requestPermission] = useCameraPermissions();

    // Periodic tick to refresh relative active timestamps ("Active now", "12m ago")
    useEffect(() => {
        const interval = setInterval(() => {
            setTick((t) => t + 1);
        }, 15000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (!user?.id) return;

        fetchMembers();

        // 1. Listen for real-time changes to family members
        const memberChannel = supabase
            .channel(`family-changes-${user.id}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'family_members',
                filter: `user_id=eq.${user.id}`
            }, () => {
                fetchMembers();
            })
            .subscribe();

        // 2. Listen for tracker table updates
        const trackerChannel = supabase
            .channel(`family-tracker-sync-${user.id}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'tracker',
            }, () => {
                fetchMembers();
            })
            .subscribe();

        // 3. Listen for live peer-to-peer location broadcasts
        const broadcastChannel = supabase
            .channel('family-broadcast')
            .on('broadcast', { event: 'location_update' }, ({ payload }) => {
                if (!payload || !payload.user_id) return;
                setMembers((prev) =>
                    prev.map((m) => {
                        if (m.member_user_id === payload.user_id) {
                            return {
                                ...m,
                                updated_at: payload.updated_at || new Date().toISOString(),
                                battery: payload.battery !== undefined ? payload.battery : m.battery,
                                lat: payload.lat ?? m.lat,
                                lng: payload.lng ?? m.lng,
                            };
                        }
                        return m;
                    })
                );
            })
            .subscribe();

        return () => {
            supabase.removeChannel(memberChannel);
            supabase.removeChannel(trackerChannel);
            supabase.removeChannel(broadcastChannel);
        };
    }, [user?.id]);

    const fetchMembers = async () => {
        if (!user) return;
        try {
            // Join with users table to get latest avatar_url, lat, lng, and updated_at
            const { data, error } = await supabase
                .from('family_members')
                .select('*, member:users!member_user_id(avatar_url, lat, lng, updated_at)')
                .eq('user_id', user.id);

            if (error) {
                console.error('[FamilyMembers] Fetch error:', error);
                setLoading(false);
                return;
            }

            const rawMembers = (data as any[]) ?? [];
            const memberUserIds = rawMembers.filter((m) => m.member_user_id).map((m) => m.member_user_id);

            // Fetch latest tracker status for each member
            let trackerMap: Record<string, any> = {};
            if (memberUserIds.length > 0) {
                try {
                    const { data: trackerData } = await supabase
                        .from('tracker')
                        .select('*')
                        .in('user_id', memberUserIds);
                    if (trackerData) {
                        trackerData.forEach((t) => {
                            trackerMap[t.user_id] = t;
                        });
                    }
                } catch { }
            }

            // Resolve the freshest timestamp between tracker, users table, and family_members
            const resolvedMembers: FamilyMember[] = rawMembers.map((m) => {
                const loc = trackerMap[m.member_user_id];
                const userFallback = m.member;

                let resolvedLat = loc?.lat ?? userFallback?.lat ?? m.lat;
                let resolvedLng = loc?.lng ?? userFallback?.lng ?? m.lng;
                let resolvedUpdatedAt = loc?.updated_at || userFallback?.updated_at || m.updated_at;

                if (loc?.updated_at && userFallback?.updated_at) {
                    const trackerTime = new Date(loc.updated_at).getTime();
                    const userTime = new Date(userFallback.updated_at).getTime();
                    if (!isNaN(userTime) && userTime > trackerTime) {
                        resolvedLat = userFallback.lat ?? resolvedLat;
                        resolvedLng = userFallback.lng ?? resolvedLng;
                        resolvedUpdatedAt = userFallback.updated_at;
                    }
                }

                const resolvedBattery = loc?.battery ?? m.battery ?? null;

                return {
                    ...m,
                    lat: resolvedLat,
                    lng: resolvedLng,
                    battery: resolvedBattery,
                    updated_at: resolvedUpdatedAt,
                    avatar_url: m.member?.avatar_url || m.avatar_url,
                };
            });

            setMembers(resolvedMembers);
        } catch (e) {
            console.error('[FamilyMembers] fetchMembers error:', e);
        } finally {
            setLoading(false);
        }
    };

    // Sort members based on last active time (freshest activity first)
    const sortedMembers = useMemo(() => {
        return [...members].sort((a, b) => {
            const timeA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
            const timeB = b.updated_at ? new Date(b.updated_at).getTime() : 0;

            const isTimeAValid = !isNaN(timeA) && timeA > 0;
            const isTimeBValid = !isNaN(timeB) && timeB > 0;

            // Primary sort: Most recently active first
            if (isTimeAValid && isTimeBValid) {
                if (timeB !== timeA) return timeB - timeA;
            } else if (isTimeBValid && !isTimeAValid) {
                return 1;
            } else if (isTimeAValid && !isTimeBValid) {
                return -1;
            }

            // Secondary sort: Alphabetical by name
            return (a.name || '').localeCompare(b.name || '');
        });
    }, [members, tick]);

    // Compute category counts
    const categoryCounts = useMemo(() => {
        const counts: Record<string, number> = { All: members.length };
        CATEGORY_TABS.forEach((cat) => {
            if (cat !== 'All') counts[cat] = 0;
        });
        members.forEach((m) => {
            const rel = m.relationship || 'Other';
            counts[rel] = (counts[rel] || 0) + 1;
        });
        return counts;
    }, [members]);

    // Filter members by selected relationship category
    const filteredMembers = useMemo(() => {
        if (selectedCategory === 'All') {
            return sortedMembers;
        }
        return sortedMembers.filter(
            (m) => (m.relationship || 'Other').toLowerCase() === selectedCategory.toLowerCase()
        );
    }, [sortedMembers, selectedCategory]);

    // Active count for header status
    const activeCount = useMemo(() => {
        return members.filter((m) => {
            const status = getTrackingStatus(m.updated_at, true);
            return status.isActive;
        }).length;
    }, [members, tick]);

    const handleBarcodeScanned = ({ data }: { data: string }) => {
        if (data && data.length === 6) {
            setScannedCode(data.toUpperCase());
            setPairingMode('code');
        }
    };

    const openPairing = async (mode: 'scan' | 'code' | 'display') => {
        if (mode === 'scan') {
            const status = await requestPermission();
            if (!status.granted) {
                // Modal will display permission prompt
            }
        }
        setScannedCode('');
        setRelationship('Parent');
        setPairingMode(mode);
        setModalVisible(true);
    };

    const getReciprocalRelationship = (rel: string) => {
        switch (rel) {
            case 'Spouse': return 'Spouse';
            case 'Parent': return 'Child';
            case 'Child': return 'Parent';
            case 'Sibling': return 'Sibling';
            case 'Relative': return 'Relative';
            case 'Friend': return 'Friend';
            default: return 'Family';
        }
    };

    const pairMember = async () => {
        if (!scannedCode || scannedCode.length !== 6) {
            showAlert({
                title: 'Invalid Code',
                message: 'Please enter a valid 6-character pairing code.',
                type: 'warning'
            });
            return;
        }
        if (scannedCode === userProfile?.pairing_code) {
            showAlert({
                title: 'Invalid Code',
                message: 'You cannot pair with yourself.',
                type: 'warning'
            });
            return;
        }

        setSaving(true);
        try {
            const { data: targetUser } = await supabase
                .from('users')
                .select('*')
                .eq('pairing_code', scannedCode)
                .single();

            if (!targetUser) throw new Error('No user found with this pairing code.');

            const existing = members.find((m) => m.member_user_id === targetUser.id);
            if (existing) throw new Error('You are already paired with this user.');

            const reciprocalRel = getReciprocalRelationship(relationship);

            const { error: insertError } = await supabase.from('family_members').insert([
                {
                    user_id: user?.id,
                    member_user_id: targetUser.id,
                    name: targetUser.name,
                    phone: targetUser.phone,
                    relationship,
                    avatar_url: targetUser.avatar_url
                },
                {
                    user_id: targetUser.id,
                    member_user_id: user?.id,
                    name: userProfile?.name || 'Unknown',
                    phone: userProfile?.phone || '',
                    relationship: reciprocalRel,
                    avatar_url: userProfile?.avatar_url
                },
            ]);

            if (insertError) throw insertError;

            showToast({
                message: `You are now paired with ${targetUser.name}!`,
                type: 'success'
            });
            setModalVisible(false);
            fetchMembers();
        } catch (error: any) {
            showAlert({
                title: 'Pairing Failed',
                message: error.message,
                type: 'error'
            });
        }
        setSaving(false);
    };

    const updateMemberRelationship = async (member: FamilyMember, newRel: string) => {
        try {
            const { error } = await supabase
                .from('family_members')
                .update({ relationship: newRel })
                .eq('id', member.id);

            if (error) throw error;

            showToast({
                message: `Updated ${member.name} to "${newRel}"`,
                type: 'success'
            });
            setEditingMember(null);
            fetchMembers();
        } catch (error: any) {
            showAlert({
                title: 'Update Failed',
                message: error.message,
                type: 'error'
            });
        }
    };

    const deleteMember = (item: FamilyMember) => {
        showAlert({
            title: 'Remove Member',
            message: `Are you sure you want to stop sharing location with ${item.name}?`,
            type: 'warning',
            buttons: [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Remove', style: 'destructive', onPress: async () => {
                        try {
                            const { error } = await supabase
                                .from('family_members')
                                .delete()
                                .match({ user_id: user?.id, member_user_id: item.member_user_id });

                            if (error) throw error;
                            fetchMembers();
                        } catch (error: any) {
                            showAlert({
                                title: 'Error',
                                message: 'Failed to remove member. They might have already removed you.',
                                type: 'error'
                            });
                            fetchMembers();
                        }
                    }
                },
            ]
        });
    };

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
                <View style={styles.headerContent}>
                    <View>
                        <Text style={styles.headerTitle}>Family Hub</Text>
                        <View style={styles.headerSubRow}>
                            <Text style={styles.headerSub}>
                                {members.length} {members.length === 1 ? 'member' : 'members'} protected
                            </Text>
                            {members.length > 0 && (
                                <View style={styles.activePillBadge}>
                                    <View style={styles.activePillDot} />
                                    <Text style={styles.activePillText}>{activeCount} active</Text>
                                </View>
                            )}
                        </View>
                    </View>
                    <View style={styles.headerIcon}>
                        <Ionicons name="people" size={24} color={Colors.white} />
                    </View>
                </View>

                <View style={styles.headerActions}>
                    <TouchableOpacity style={styles.actionPill} onPress={() => openPairing('code')}>
                        <Ionicons name="add-circle" size={18} color={Colors.white} />
                        <Text style={styles.actionPillText}>Add Someone</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionPill, styles.actionPillOutline]} onPress={() => openPairing('display')}>
                        <Ionicons name="qr-code" size={17} color={Colors.white} />
                        <Text style={styles.actionPillText}>My Code</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* Relationship Category Filter Tabs */}
            <View style={styles.categoryContainer}>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.categoryScroll}
                >
                    {CATEGORY_TABS.map((cat) => {
                        const isSelected = selectedCategory === cat;
                        const count = categoryCounts[cat] || 0;
                        const iconName = cat === 'All' ? 'grid' : (RELATIONSHIP_ICONS[cat] || 'person');
                        const color = cat === 'All' ? Colors.family : getRelColor(cat);

                        return (
                            <TouchableOpacity
                                key={cat}
                                style={[
                                    styles.categoryPill,
                                    isSelected && { backgroundColor: color, borderColor: color },
                                ]}
                                onPress={() => setSelectedCategory(cat)}
                                activeOpacity={0.7}
                            >
                                <Ionicons
                                    name={iconName as any}
                                    size={13}
                                    color={isSelected ? Colors.white : color}
                                />
                                <Text
                                    style={[
                                        styles.categoryPillText,
                                        isSelected && styles.categoryPillTextActive,
                                    ]}
                                >
                                    {cat}
                                </Text>
                                <View
                                    style={[
                                        styles.categoryCountBadge,
                                        isSelected
                                            ? styles.categoryCountBadgeActive
                                            : { backgroundColor: color + '15' },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.categoryCountText,
                                            isSelected ? { color } : { color },
                                        ]}
                                    >
                                        {count}
                                    </Text>
                                </View>
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>
            </View>

            {loading ? (
                <View style={styles.loadingBox}>
                    <ActivityIndicator size="large" color={Colors.family} />
                    <Text style={styles.loadingText}>Syncing circle & active times...</Text>
                </View>
            ) : (
                <FlatList
                    data={filteredMembers}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.list}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={
                        <View style={styles.empty}>
                            <View style={styles.emptyIconBox}>
                                <Ionicons
                                    name={
                                        selectedCategory === 'All'
                                            ? 'people-outline'
                                            : (RELATIONSHIP_ICONS[selectedCategory] || 'people-outline')
                                    }
                                    size={52}
                                    color={Colors.textMuted}
                                />
                            </View>
                            <Text style={styles.emptyTitle}>
                                {selectedCategory === 'All' ? 'Circle is empty' : `No ${selectedCategory}s added`}
                            </Text>
                            <Text style={styles.emptyText}>
                                {selectedCategory === 'All'
                                    ? 'Add your loved ones to see live locations and receive SOS alerts.'
                                    : `You don't have any family members categorized as "${selectedCategory}".`}
                            </Text>
                            {selectedCategory === 'All' ? (
                                <TouchableOpacity style={styles.emptyBtn} onPress={() => openPairing('code')}>
                                    <Text style={styles.emptyBtnText}>Start Pairing</Text>
                                </TouchableOpacity>
                            ) : (
                                <TouchableOpacity style={styles.emptyBtn} onPress={() => setSelectedCategory('All')}>
                                    <Text style={styles.emptyBtnText}>View All Members</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    }
                    renderItem={({ item }) => {
                        const status = getTrackingStatus(item.updated_at, true);
                        const relColor = getRelColor(item.relationship);
                        const relIcon = RELATIONSHIP_ICONS[item.relationship] || 'person';
                        const initials = (item.name || 'U').charAt(0).toUpperCase();

                        return (
                            <View style={styles.card}>
                                <View style={styles.cardMain}>
                                    <View style={[styles.avatar, { backgroundColor: relColor + '15' }]}>
                                        {item.member?.avatar_url || item.avatar_url ? (
                                            <Image
                                                source={{ uri: item.member?.avatar_url || item.avatar_url }}
                                                style={styles.avatarImg}
                                            />
                                        ) : (
                                            <Text style={[styles.avatarText, { color: relColor }]}>
                                                {initials}
                                            </Text>
                                        )}
                                        {/* Status indicator pip */}
                                        <View style={[styles.statusPip, { backgroundColor: status.color }]} />
                                    </View>

                                    <View style={styles.info}>
                                        <View style={styles.nameRow}>
                                            <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                                            <TouchableOpacity
                                                style={[styles.relBadge, { backgroundColor: relColor + '12' }]}
                                                onPress={() => setEditingMember(item)}
                                                activeOpacity={0.7}
                                            >
                                                <Ionicons name={relIcon as any} size={11} color={relColor} />
                                                <Text style={[styles.relText, { color: relColor }]}>
                                                    {item.relationship}
                                                </Text>
                                                <Ionicons name="pencil" size={9} color={relColor} style={{ marginLeft: 3 }} />
                                            </TouchableOpacity>
                                        </View>

                                        <Text style={styles.phone} numberOfLines={1}>
                                            {item.phone || 'No phone number'}
                                        </Text>

                                        {/* Last Active Time Row */}
                                        <View style={styles.activeTimeRow}>
                                            <View style={[styles.activeDot, { backgroundColor: status.color }]} />
                                            <Text
                                                style={[
                                                    styles.activeTimeText,
                                                    { color: status.isActive ? '#16A34A' : Colors.textMuted },
                                                ]}
                                            >
                                                {status.isActive ? 'Active now' : `Active ${status.timeAgo}`}
                                            </Text>

                                            {item.battery !== null && item.battery !== undefined && (
                                                <View style={styles.batteryChip}>
                                                    <Ionicons
                                                        name={
                                                            (item.battery <= 0.2 ? 'battery-dead' :
                                                             item.battery <= 0.5 ? 'battery-half' : 'battery-full') as any
                                                        }
                                                        size={11}
                                                        color={item.battery <= 0.2 ? Colors.sos : Colors.textMuted}
                                                    />
                                                    <Text style={styles.batteryChipText}>
                                                        {Math.round(item.battery > 1 ? item.battery : item.battery * 100)}%
                                                    </Text>
                                                </View>
                                            )}
                                        </View>
                                    </View>
                                </View>

                                <View style={styles.cardActions}>
                                    {navigation && (
                                        <TouchableOpacity
                                            style={[styles.miniBtn, { backgroundColor: Colors.tracker + '15' }]}
                                            onPress={() => navigation.navigate('Tracker', { focusUserId: item.member_user_id })}
                                            activeOpacity={0.7}
                                        >
                                            <Ionicons name="location" size={16} color={Colors.tracker} />
                                        </TouchableOpacity>
                                    )}
                                    <TouchableOpacity
                                        style={[styles.miniBtn, { backgroundColor: Colors.hotline + '15' }]}
                                        onPress={() => Linking.openURL(`tel:${item.phone.replace(/[-\s()]/g, '')}`)}
                                        activeOpacity={0.7}
                                    >
                                        <Ionicons name="call" size={16} color={Colors.hotline} />
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.miniBtn, { backgroundColor: Colors.sos + '15' }]}
                                        onPress={() => deleteMember(item)}
                                        activeOpacity={0.7}
                                    >
                                        <Ionicons name="trash-outline" size={16} color={Colors.sos} />
                                    </TouchableOpacity>
                                </View>
                            </View>
                        );
                    }}
                />
            )}

            {/* Edit Relationship Category Modal */}
            <Modal visible={!!editingMember} animationType="fade" transparent statusBarTranslucent>
                <View style={styles.overlay}>
                    <View style={styles.modal}>
                        <View style={styles.modalHeader}>
                            <View style={styles.modalHandle} />
                        </View>
                        <View style={styles.formContainer}>
                            <Text style={styles.modalTitle}>Relationship Category</Text>
                            <Text style={styles.editRelSub}>
                                Choose a category for{' '}
                                <Text style={{ fontWeight: '800', color: Colors.text }}>
                                    {editingMember?.name}
                                </Text>
                            </Text>

                            <View style={styles.relSelection}>
                                {RELATIONSHIPS.map((r) => {
                                    const isCurrent = editingMember?.relationship === r;
                                    const icon = RELATIONSHIP_ICONS[r] || 'person';
                                    const color = getRelColor(r);
                                    return (
                                        <TouchableOpacity
                                            key={r}
                                            style={[
                                                styles.relOption,
                                                isCurrent && { borderColor: color, backgroundColor: color + '15' },
                                            ]}
                                            onPress={() => editingMember && updateMemberRelationship(editingMember, r)}
                                            activeOpacity={0.7}
                                        >
                                            <Ionicons
                                                name={icon as any}
                                                size={16}
                                                color={isCurrent ? color : Colors.textMuted}
                                            />
                                            <Text
                                                style={[
                                                    styles.relOptionText,
                                                    isCurrent && { color, fontWeight: '800' },
                                                ]}
                                            >
                                                {r}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>

                            <TouchableOpacity
                                style={styles.closeBtn}
                                onPress={() => setEditingMember(null)}
                                activeOpacity={0.8}
                            >
                                <Text style={styles.closeBtnText}>Cancel</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Pairing Modal */}
            <Modal visible={modalVisible} animationType="slide" transparent statusBarTranslucent>
                <View style={styles.overlay}>
                    <View style={styles.modal}>
                        <View style={styles.modalHeader}>
                            <View style={styles.modalHandle} />
                        </View>

                        {pairingMode === 'display' ? (
                            <View style={styles.displayContainer}>
                                <Text style={styles.modalTitle}>Your Guardian Code</Text>
                                <Text style={styles.displaySub}>Others can scan this to add you to their family list.</Text>

                                <View style={styles.qrOuter}>
                                    <View style={styles.qrInner}>
                                        <QRCode
                                            value={userProfile?.pairing_code || 'INVALID'}
                                            size={220}
                                            backgroundColor={Colors.white}
                                            color={Colors.text}
                                        />
                                    </View>
                                </View>

                                <View style={styles.codeContainer}>
                                    <Text style={styles.codeLabel}>ALPHANUMERIC CODE</Text>
                                    <View style={styles.codeBox}>
                                        <Text style={styles.codeText}>{userProfile?.pairing_code}</Text>
                                    </View>
                                </View>

                                <TouchableOpacity style={styles.closeBtn} onPress={() => setModalVisible(false)}>
                                    <Text style={styles.closeBtnText}>Done</Text>
                                </TouchableOpacity>
                            </View>
                        ) : pairingMode === 'scan' ? (
                            <View style={styles.scanContainer}>
                                <Text style={styles.modalTitle}>Scan Family Code</Text>
                                <View style={styles.cameraFrame}>
                                    {permission?.granted ? (
                                        <>
                                            <CameraView
                                                style={StyleSheet.absoluteFill}
                                                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                                                onBarcodeScanned={handleBarcodeScanned}
                                            />
                                            <View style={styles.scanOverlay}>
                                                <View style={styles.scannerLine} />
                                                <View style={styles.scanWindow} />
                                            </View>
                                        </>
                                    ) : (
                                        <View style={styles.noPerm}>
                                            <Ionicons name="camera-outline" size={56} color={Colors.textMuted} />
                                            <Text style={styles.noPermText}>
                                                Camera access is needed to scan QR codes.
                                            </Text>
                                            <TouchableOpacity
                                                style={styles.permBtn}
                                                onPress={() => permission?.canAskAgain === false ? Linking.openSettings() : requestPermission()}
                                            >
                                                <Text style={styles.permBtnText}>
                                                    {permission?.canAskAgain === false ? 'Open Settings' : 'Enable Camera'}
                                                </Text>
                                            </TouchableOpacity>
                                        </View>
                                    )}
                                </View>
                                <TouchableOpacity style={styles.manualBtn} onPress={() => setPairingMode('code')}>
                                    <Text style={styles.manualBtnText}>Enter Code Manually</Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <View style={styles.formContainer}>
                                <Text style={styles.modalTitle}>Pair New Member</Text>

                                <View style={styles.formSection}>
                                    <Text style={styles.inputLabel}>Enter 6-Digit Code</Text>
                                    <View style={styles.codeEntryRow}>
                                        <TextInput
                                            style={styles.pairingInput}
                                            value={scannedCode}
                                            onChangeText={(v) => setScannedCode(v.toUpperCase())}
                                            placeholder="XXXXXX"
                                            placeholderTextColor={Colors.textMuted}
                                            maxLength={6}
                                            autoCapitalize="characters"
                                        />
                                        <TouchableOpacity style={styles.quickScan} onPress={() => setPairingMode('scan')}>
                                            <Ionicons name="qr-code-outline" size={24} color={Colors.family} />
                                        </TouchableOpacity>
                                    </View>
                                </View>

                                <View style={styles.formSection}>
                                    <Text style={styles.inputLabel}>Relationship Category</Text>
                                    <View style={styles.relSelection}>
                                        {RELATIONSHIPS.map((r) => {
                                            const icon = RELATIONSHIP_ICONS[r] || 'person';
                                            const color = getRelColor(r);
                                            const isSelected = relationship === r;
                                            return (
                                                <TouchableOpacity
                                                    key={r}
                                                    style={[
                                                        styles.relOption,
                                                        isSelected && { backgroundColor: color, borderColor: color },
                                                    ]}
                                                    onPress={() => setRelationship(r)}
                                                >
                                                    <Ionicons
                                                        name={icon as any}
                                                        size={14}
                                                        color={isSelected ? Colors.white : color}
                                                    />
                                                    <Text
                                                        style={[
                                                            styles.relOptionText,
                                                            isSelected && styles.relOptionTextActive,
                                                        ]}
                                                    >
                                                        {r}
                                                    </Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                </View>

                                <View style={styles.modalFooter}>
                                    <TouchableOpacity style={styles.cancelLink} onPress={() => setModalVisible(false)}>
                                        <Text style={styles.cancelLinkText}>Cancel</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity style={styles.primaryPairBtn} onPress={pairMember} disabled={saving}>
                                        {saving ? (
                                            <ActivityIndicator color={Colors.white} />
                                        ) : (
                                            <Text style={styles.primaryPairBtnText}>Verify & Pair</Text>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F8F9FA' },
    header: {
        backgroundColor: Colors.family,
        paddingTop: 48, paddingBottom: 24, paddingHorizontal: Spacing.lg,
        borderBottomLeftRadius: 36, borderBottomRightRadius: 36,
        shadowColor: Colors.family, shadowOpacity: 0.3, shadowRadius: 15, elevation: 12,
    },
    headerContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    headerTitle: { fontSize: 28, fontWeight: '900', color: Colors.white, letterSpacing: -0.5 },
    headerSubRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
    headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.75)', fontWeight: '500' },
    activePillBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 5,
        backgroundColor: 'rgba(34, 197, 94, 0.25)',
        paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
    },
    activePillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22C55E' },
    activePillText: { fontSize: 10, fontWeight: '700', color: '#86EFAC' },
    headerIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
    headerActions: { flexDirection: 'row', gap: 12 },
    actionPill: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        backgroundColor: 'rgba(255,255,255,0.18)',
        paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
    },
    actionPillOutline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
    actionPillText: { color: Colors.white, fontWeight: '700', fontSize: 13 },

    // Category Filter Bar
    categoryContainer: {
        paddingTop: 14,
        paddingBottom: 6,
        backgroundColor: '#F8F9FA',
    },
    categoryScroll: {
        paddingHorizontal: Spacing.lg,
        gap: 8,
    },
    categoryPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: Colors.white,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        shadowColor: '#000',
        shadowOpacity: 0.03,
        shadowRadius: 4,
        elevation: 1,
    },
    categoryPillText: {
        fontSize: 12,
        fontWeight: '700',
        color: Colors.text,
    },
    categoryPillTextActive: {
        color: Colors.white,
        fontWeight: '800',
    },
    categoryCountBadge: {
        borderRadius: 10,
        paddingHorizontal: 6,
        paddingVertical: 1,
    },
    categoryCountBadgeActive: {
        backgroundColor: Colors.white,
    },
    categoryCountText: {
        fontSize: 10,
        fontWeight: '800',
    },

    loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    loadingText: { marginTop: 12, color: Colors.textLight, fontWeight: '600' },

    list: { padding: Spacing.lg, paddingBottom: 100 },
    card: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        backgroundColor: Colors.white, borderRadius: 24, padding: 14,
        marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 10, elevation: 2,
        borderWidth: 1, borderColor: '#F1F5F9',
    },
    cardMain: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 14 },
    avatar: { width: 56, height: 56, borderRadius: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' },
    avatarImg: { width: '100%', height: '100%' },
    avatarText: { fontSize: 24, fontWeight: '900' },
    statusPip: {
        position: 'absolute', bottom: 3, right: 3,
        width: 12, height: 12, borderRadius: 6,
        borderWidth: 2, borderColor: Colors.white,
    },
    info: { flex: 1 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    name: { fontSize: 16, fontWeight: '800', color: Colors.text, maxWidth: '58%' },
    phone: { fontSize: 12, color: Colors.textMuted, marginTop: 2, fontWeight: '500' },
    relBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
    },
    relText: { fontSize: 10, fontWeight: '800', textTransform: 'capitalize' },

    // Last Active Time Row
    activeTimeRow: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        marginTop: 5, flexWrap: 'wrap',
    },
    activeDot: { width: 7, height: 7, borderRadius: 3.5 },
    activeTimeText: { fontSize: 11, fontWeight: '600' },
    batteryChip: {
        flexDirection: 'row', alignItems: 'center', gap: 3,
        backgroundColor: '#F1F5F9', paddingHorizontal: 6, paddingVertical: 1,
        borderRadius: 8, marginLeft: 4,
    },
    batteryChipText: { fontSize: 10, fontWeight: '700', color: Colors.textMuted },

    cardActions: { flexDirection: 'row', gap: 6, alignItems: 'center' },
    miniBtn: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

    empty: { alignItems: 'center', marginTop: 60, paddingHorizontal: 40 },
    emptyIconBox: {
        width: 90, height: 90, borderRadius: 45, backgroundColor: '#F1F3F5',
        alignItems: 'center', justifyContent: 'center', marginBottom: 20
    },
    emptyTitle: { fontSize: 20, fontWeight: '800', color: Colors.text },
    emptyText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', marginTop: 8, lineHeight: 20 },
    emptyBtn: { marginTop: 24, backgroundColor: Colors.family, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 16, shadowColor: Colors.family, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
    emptyBtnText: { color: Colors.white, fontWeight: '800', fontSize: 14 },

    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    modal: { backgroundColor: Colors.white, borderTopLeftRadius: 36, borderTopRightRadius: 36, paddingBottom: 40 },
    modalHeader: { alignItems: 'center', paddingVertical: 14 },
    modalHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#DDD' },
    modalTitle: { fontSize: 24, fontWeight: '900', color: Colors.text, textAlign: 'center', marginBottom: 6 },
    editRelSub: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', marginBottom: 20 },

    displayContainer: { alignItems: 'center', paddingHorizontal: Spacing.xl },
    displaySub: { fontSize: 14, color: Colors.textLight, textAlign: 'center', marginBottom: 28, lineHeight: 20 },
    qrOuter: {
        padding: 24, backgroundColor: Colors.white, borderRadius: 32,
        shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 20, elevation: 8,
        marginBottom: 28, borderWidth: 1, borderColor: '#F0F0F0'
    },
    qrInner: { padding: 8, backgroundColor: Colors.white },
    codeContainer: { alignItems: 'center', marginBottom: 28 },
    codeLabel: { fontSize: 10, fontWeight: '800', color: Colors.textMuted, letterSpacing: 2, marginBottom: 10 },
    codeBox: {
        backgroundColor: '#F8F9FA', paddingVertical: 14, paddingHorizontal: 32,
        borderRadius: 20, borderWidth: 1, borderColor: Colors.border,
    },
    codeText: { fontSize: 28, fontWeight: '900', letterSpacing: 8, color: Colors.family },
    closeBtn: { width: '100%', paddingVertical: 16, borderRadius: 20, backgroundColor: '#F1F3F5', alignItems: 'center', marginTop: 8 },
    closeBtnText: { fontWeight: '800', color: Colors.text, fontSize: 16 },

    scanContainer: { paddingHorizontal: Spacing.lg, alignItems: 'center' },
    cameraFrame: {
        width: '100%', aspectRatio: 1, borderRadius: 32, overflow: 'hidden',
        backgroundColor: '#000', marginTop: 16, marginBottom: 20,
    },
    scanOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
    scanWindow: { width: 220, height: 220, borderWidth: 2, borderColor: Colors.white, borderRadius: 24, backgroundColor: 'transparent' },
    scannerLine: { position: 'absolute', width: 220, height: 2, backgroundColor: Colors.family, top: '50%', zIndex: 10, shadowColor: Colors.family, shadowOpacity: 0.8, shadowRadius: 10 },
    noPerm: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
    noPermText: { textAlign: 'center', color: Colors.white, marginTop: 16, marginBottom: 24, fontSize: 14, opacity: 0.8 },
    permBtn: { backgroundColor: Colors.family, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 16 },
    permBtnText: { color: Colors.white, fontWeight: '800' },
    manualBtn: { paddingVertical: 12 },
    manualBtnText: { fontWeight: '700', color: Colors.family, fontSize: 15 },

    formContainer: { paddingHorizontal: Spacing.xl },
    formSection: { marginBottom: 24 },
    inputLabel: { fontSize: 11, fontWeight: '800', color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
    codeEntryRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    pairingInput: {
        flex: 1, backgroundColor: '#F8F9FA', borderRadius: 18,
        borderWidth: 1.5, borderColor: '#EEE',
        paddingHorizontal: 20, height: 56, fontSize: 20, fontWeight: '800', color: Colors.text, letterSpacing: 4,
    },
    quickScan: { width: 56, height: 56, borderRadius: 18, backgroundColor: Colors.family + '10', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.family + '20' },
    relSelection: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
    relOption: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14,
        backgroundColor: '#F8F9FA', borderWidth: 1.5, borderColor: '#EEE',
    },
    relOptionText: { fontSize: 13, fontWeight: '700', color: Colors.textLight },
    relOptionTextActive: { color: Colors.white },
    modalFooter: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 12 },
    cancelLink: { flex: 0.4, alignItems: 'center' },
    cancelLinkText: { fontWeight: '700', color: Colors.textMuted },
    primaryPairBtn: { flex: 1, paddingVertical: 16, borderRadius: 20, backgroundColor: Colors.family, alignItems: 'center', shadowColor: Colors.family, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 },
    primaryPairBtnText: { fontWeight: '800', color: Colors.white, fontSize: 16 },
});
