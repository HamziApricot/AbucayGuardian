import React, { useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, ScrollView,
    TextInput, ActivityIndicator, Modal, Image
} from 'react-native';
import { useAlert } from '../context/AlertContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Colors, Spacing, BorderRadius } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import CountryCodePicker from '../components/CountryCodePicker';
import PermissionsOnboardingScreen from './PermissionsOnboardingScreen';

export default function ProfileScreen() {
    const { userProfile, user, signOut, refreshProfile } = useAuth();
    const insets = useSafeAreaInsets();
    const { showAlert, showToast } = useAlert();
    const [editing, setEditing] = useState(false);
    const [showPermissionsModal, setShowPermissionsModal] = useState(false);
    const [name, setName] = useState(userProfile?.name ?? '');
    const [countryCode, setCountryCode] = useState('+63');
    const [phone, setPhone] = useState(userProfile?.phone ?? '');
    const [saving, setSaving] = useState(false);
    const [uploadingAvatar, setUploadingAvatar] = useState(false);

    const handleSave = async () => {
        if (!name || !phone) {
            showAlert({
                title: 'Missing Fields',
                message: 'Name and phone are required.',
                type: 'error'
            });
            return;
        }
        setSaving(true);
        const fullPhone = `${countryCode}${phone.replace(/^0+/, '')}`;
        await supabase.from('users').update({ name, phone: fullPhone, updated_at: new Date().toISOString() }).eq('id', user?.id);
        await refreshProfile();
        setSaving(false);
        setEditing(false);
    };

    const uploadAvatar = async () => {
        try {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
                showAlert({
                    title: 'Permission Denied',
                    message: 'Sorry, we need camera roll permissions to upload an avatar.',
                    type: 'error'
                });
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.5,
            });

            if (!result.canceled && result.assets[0] && user) {
                setUploadingAvatar(true);
                const asset = result.assets[0];

                const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' });
                const filePath = `${user.id}/${Date.now()}_avatar.jpg`;

                const { error: uploadError } = await supabase.storage
                    .from('avatars')
                    .upload(filePath, decode(base64), { contentType: 'image/jpeg' });

                if (uploadError) throw uploadError;

                const { data: publicUrlData } = supabase.storage
                    .from('avatars')
                    .getPublicUrl(filePath);

                await supabase.from('users').update({ avatar_url: publicUrlData.publicUrl }).eq('id', user.id);

                await refreshProfile();
                setUploadingAvatar(false);
            }
        } catch (error: any) {
            setUploadingAvatar(false);
            const msg = error.message || 'An error occurred while uploading.';
            showAlert({
                title: 'Upload failed',
                message: `${msg}\n\nTip: Ensure the "avatars" storage bucket exists and has correct RLS policies.`,
                type: 'error'
            });
        }
    };

    const removeAvatar = async () => {
        if (!user) return;
        setUploadingAvatar(true);
        try {
            await supabase.from('users').update({ avatar_url: null }).eq('id', user.id);
            await refreshProfile();
        } catch (error: any) {
            showAlert({
                title: 'Failed to remove avatar',
                message: error.message,
                type: 'error'
            });
        }
        setUploadingAvatar(false);
    };

    const handleAvatarPress = () => {
        if (userProfile?.avatar_url) {
            showAlert({
                title: 'Profile Picture',
                message: 'What would you like to do?',
                type: 'info',
                buttons: [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Remove', style: 'destructive', onPress: removeAvatar },
                    { text: 'Change', onPress: uploadAvatar }
                ]
            });
        } else {
            uploadAvatar();
        }
    };

    const handleLogout = () => {
        showAlert({
            title: 'Sign Out',
            message: 'Are you sure you want to sign out?',
            type: 'warning',
            buttons: [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign Out', style: 'destructive', onPress: signOut },
            ]
        });
    };

    const initials = (userProfile?.name ?? 'U').split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

    const InfoRow = ({ icon, label, value, color = Colors.primary }: { icon: string; label: string; value: string; color?: string }) => (
        <View style={styles.infoRow}>
            <View style={[styles.infoIcon, { backgroundColor: color + '10' }]}>
                <Ionicons name={icon as any} size={18} color={color} />
            </View>
            <View style={{ flex: 1 }}>
                <Text style={styles.infoLabel}>{label}</Text>
                <Text style={styles.infoValue}>{value}</Text>
            </View>
        </View>
    );

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {/* Immersive Header */}
            <View style={[styles.header, { paddingTop: Math.max(insets.top, 24) }]}>
                <View style={styles.headerTop}>
                    <Text style={styles.profileTag}>GUARDIAN PROFILE</Text>
                    <TouchableOpacity onPress={handleLogout} style={styles.logoutIcon}>
                        <Ionicons name="log-out-outline" size={22} color={Colors.white} />
                    </TouchableOpacity>
                </View>

                <TouchableOpacity style={styles.avatarContainer} onPress={handleAvatarPress} disabled={uploadingAvatar}>
                    <View style={styles.avatarOuter}>
                        {uploadingAvatar ? (
                            <ActivityIndicator color={Colors.white} size="large" />
                        ) : (
                            <View style={styles.avatarInner}>
                                {userProfile?.avatar_url ? (
                                    <Image source={{ uri: userProfile.avatar_url }} style={styles.avatarImage} />
                                ) : (
                                    <Text style={styles.avatarText}>{initials}</Text>
                                )}
                            </View>
                        )}
                        <View style={styles.editBadge}>
                            <Ionicons name="camera" size={12} color={Colors.white} />
                        </View>
                    </View>
                </TouchableOpacity>

                <Text style={styles.userName}>{userProfile?.name ?? ''}</Text>
                <Text style={styles.userPhone}>{userProfile?.phone ?? ''}</Text>

                <View style={styles.rankBadge}>
                    <Ionicons name="shield-checkmark" size={14} color={Colors.tracker} />
                    <Text style={styles.rankText}>Verified Citizen</Text>
                </View>
            </View>

            {/* Info Cards */}
            <View style={styles.section}>
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <View style={styles.cardTitleBox}>
                            <Ionicons name="person" size={18} color={Colors.text} />
                            <Text style={styles.cardTitle}>Identity Details</Text>
                        </View>
                        <TouchableOpacity
                            style={styles.editBtn}
                            onPress={() => {
                                setEditing(true);
                                setName(userProfile?.name ?? '');
                                const p = userProfile?.phone ?? '';
                                if (p.startsWith('+')) {
                                    const match = p.match(/^(\+\d{1,3})/);
                                    if (match) {
                                        setCountryCode(match[1]);
                                        setPhone(p.replace(match[1], ''));
                                    } else {
                                        setPhone(p);
                                    }
                                } else {
                                    setPhone(p);
                                }
                            }}
                        >
                            <Text style={styles.editBtnText}>Edit</Text>
                        </TouchableOpacity>
                    </View>

                    <InfoRow icon="finger-print" label="Full Display Name" value={userProfile?.name ?? '—'} color={Colors.secondary} />
                    <InfoRow icon="call" label="Primary Contact" value={userProfile?.phone ?? '—'} color={Colors.tracker} />
                    <InfoRow icon="key" label="Guardian Code" value={userProfile?.pairing_code ?? '—'} color={Colors.family} />
                </View>
            </View>

            <View style={styles.section}>
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <View style={styles.cardTitleBox}>
                            <Ionicons name="information-circle" size={18} color={Colors.text} />
                            <Text style={styles.cardTitle}>Service Information</Text>
                        </View>
                    </View>
                    <InfoRow icon="location" label="Assigned Municipality" value="Abucay, Bataan" color={Colors.hotline} />
                    <InfoRow icon="git-branch" label="System Version" value="v1.0.4-Guardian" color={Colors.textMuted} />
                    <InfoRow icon="shield-checkmark" label="Protection Level" value="Active Monitoring" color={Colors.tracker} />
                </View>
            </View>

            {/* System Permissions & Emergency Readiness */}
            <View style={styles.section}>
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <View style={styles.cardTitleBox}>
                            <Ionicons name="shield-checkmark" size={18} color={Colors.secondary} />
                            <Text style={styles.cardTitle}>Emergency Readiness</Text>
                        </View>
                    </View>
                    <TouchableOpacity
                        style={styles.permissionActionRow}
                        onPress={() => setShowPermissionsModal(true)}
                        activeOpacity={0.7}
                    >
                        <View style={styles.permissionLeft}>
                            <View style={[styles.infoIcon, { backgroundColor: '#DC262615' }]}>
                                <Ionicons name="options-outline" size={18} color="#DC2626" />
                            </View>
                            <View style={{ flex: 1, paddingRight: 8 }}>
                                <Text style={styles.infoLabel}>App Permissions & Wake-Up</Text>
                                <Text style={styles.permissionSub}>
                                    Check & adjust all 7 system permissions
                                </Text>
                            </View>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Danger Zone */}
            <View style={styles.section}>
                <TouchableOpacity style={styles.signOutCard} onPress={handleLogout}>
                    <Ionicons name="log-out" size={20} color={Colors.sos} />
                    <Text style={styles.signOutText}>Securely Sign Out</Text>
                </TouchableOpacity>
            </View>

            <View style={{ height: 40 }} />

            {/* Redesigned Edit Modal */}
            <Modal visible={editing} animationType="slide" transparent statusBarTranslucent>
                <View style={styles.overlay}>
                    <View style={styles.modal}>
                        <View style={styles.modalHandle} />
                        <Text style={styles.modalTitle}>Update Identity</Text>
                        <Text style={styles.modalSub}>This name will be visible to your linked family members.</Text>

                        <View style={styles.form}>
                            <View style={styles.formGroup}>
                                <Text style={styles.fieldLabel}>Display Name</Text>
                                <View style={styles.inputContainer}>
                                    <Ionicons name="person-outline" size={20} color={Colors.textLight} />
                                    <TextInput
                                        style={styles.fieldInput}
                                        value={name}
                                        onChangeText={setName}
                                        placeholder="Full Name"
                                        placeholderTextColor={Colors.textMuted}
                                    />
                                </View>
                            </View>

                            <View style={styles.formGroup}>
                                <Text style={styles.fieldLabel}>Phone Number</Text>
                                <View style={styles.phoneInputRow}>
                                    <CountryCodePicker selectedCountry={countryCode} onSelect={setCountryCode} />
                                    <TextInput
                                        style={styles.flexInput}
                                        value={phone}
                                        onChangeText={setPhone}
                                        placeholder="9XX XXX XXXX"
                                        placeholderTextColor={Colors.textMuted}
                                        keyboardType="phone-pad"
                                    />
                                </View>
                            </View>
                        </View>

                        <View style={styles.modalFooter}>
                            <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(false)}>
                                <Text style={styles.cancelBtnText}>Discard</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.saveActionBtn} onPress={handleSave} disabled={saving}>
                                {saving ? <ActivityIndicator color={Colors.white} size="small" /> : <Text style={styles.saveActionBtnText}>Save Changes</Text>}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* App Permissions Setup Modal */}
            <Modal
                visible={showPermissionsModal}
                animationType="slide"
                statusBarTranslucent
                onRequestClose={() => setShowPermissionsModal(false)}
            >
                <PermissionsOnboardingScreen
                    isSettingsMode={true}
                    onComplete={() => setShowPermissionsModal(false)}
                />
            </Modal>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F8F9FA' },
    content: { paddingBottom: 60 },
    header: {
        backgroundColor: Colors.secondary,
        paddingTop: 48, paddingBottom: 40,
        alignItems: 'center',
        borderBottomLeftRadius: 36, borderBottomRightRadius: 36,
        shadowColor: Colors.secondary, shadowOpacity: 0.3, shadowRadius: 15, elevation: 12,
    },
    headerTop: {
        width: '100%', flexDirection: 'row', justifyContent: 'space-between',
        alignItems: 'center', paddingHorizontal: 24, marginBottom: 10
    },
    profileTag: { fontSize: 10, fontWeight: '900', color: 'rgba(255,255,255,0.6)', letterSpacing: 1.5 },
    logoutIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },

    avatarContainer: { marginBottom: 16 },
    avatarOuter: {
        width: 100, height: 100, borderRadius: 32,
        backgroundColor: 'rgba(255,255,255,0.2)',
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)',
    },
    avatarInner: { width: 88, height: 88, borderRadius: 26, backgroundColor: Colors.white, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
    avatarImage: { width: '100%', height: '100%' },
    avatarText: { fontSize: 32, fontWeight: '900', color: Colors.secondary },
    editBadge: {
        position: 'absolute', bottom: -4, right: -4,
        backgroundColor: Colors.tracker,
        width: 32, height: 32, borderRadius: 12,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 3, borderColor: Colors.secondary
    },

    userName: { fontSize: 26, fontWeight: '900', color: Colors.white, letterSpacing: -0.5 },
    userPhone: { fontSize: 14, color: 'rgba(255,255,255,0.6)', marginTop: 4, fontWeight: '600' },
    rankBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: 'rgba(255,255,255,0.15)',
        paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginTop: 16,
    },
    rankText: { fontSize: 12, color: Colors.white, fontWeight: '800', letterSpacing: 0.2 },

    section: { paddingHorizontal: 20, marginTop: 20 },
    card: {
        backgroundColor: Colors.white, borderRadius: 28,
        padding: 24, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 12, elevation: 3,
    },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    cardTitleBox: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    cardTitle: { fontSize: 16, fontWeight: '800', color: Colors.text },
    editBtn: { backgroundColor: '#F1F3F5', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10 },
    editBtnText: { fontSize: 12, fontWeight: '800', color: Colors.secondary },

    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 },
    infoIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    infoLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
    infoValue: { fontSize: 15, color: Colors.text, marginTop: 3, fontWeight: '600' },

    permissionActionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#F8FAFC',
        padding: 14,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    permissionLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        flex: 1,
    },
    permissionSub: {
        fontSize: 13,
        color: Colors.text,
        marginTop: 2,
        fontWeight: '600',
    },

    signOutCard: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
        backgroundColor: Colors.white, paddingVertical: 20, borderRadius: 28,
        borderWidth: 1.5, borderColor: '#FFEBEB',
    },
    signOutText: { fontSize: 16, fontWeight: '800', color: Colors.sos },

    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    modal: { backgroundColor: Colors.white, borderTopLeftRadius: 36, borderTopRightRadius: 36, padding: 32, paddingBottom: 40 },
    modalHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#EEE', alignSelf: 'center', marginBottom: 20 },
    modalTitle: { fontSize: 24, fontWeight: '900', color: Colors.text, textAlign: 'center' },
    modalSub: { fontSize: 13, color: Colors.textLight, textAlign: 'center', marginTop: 8, marginBottom: 32 },
    form: { gap: 20 },
    formGroup: { gap: 8 },
    fieldLabel: { fontSize: 11, fontWeight: '800', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
    inputContainer: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        backgroundColor: '#F8F9FA', borderRadius: 16, paddingHorizontal: 16, height: 56,
        borderWidth: 1.5, borderColor: '#EEE'
    },
    fieldInput: { flex: 1, fontSize: 16, color: Colors.text, fontWeight: '600' },
    phoneInputRow: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        backgroundColor: '#F8F9FA', borderRadius: 16, paddingHorizontal: 8, height: 56,
        borderWidth: 1.5, borderColor: '#EEE'
    },
    flexInput: { flex: 1, fontSize: 16, color: Colors.text, fontWeight: '600', paddingRight: 16 },
    modalFooter: { flexDirection: 'row', gap: 16, marginTop: 32 },
    cancelBtn: { flex: 1, height: 56, borderRadius: 18, backgroundColor: '#F1F3F5', alignItems: 'center', justifyContent: 'center' },
    cancelBtnText: { fontWeight: '800', color: Colors.textMuted, fontSize: 15 },
    saveActionBtn: {
        flex: 2, height: 56, borderRadius: 18, backgroundColor: Colors.secondary,
        alignItems: 'center', justifyContent: 'center',
        shadowColor: Colors.secondary, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5
    },
    saveActionBtnText: { fontWeight: '900', color: Colors.white, fontSize: 15 },
});
