import React, { useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, ScrollView,
    TextInput, ActivityIndicator, Modal, Image, Switch, DeviceEventEmitter
} from 'react-native';
import { useAlert } from '../context/AlertContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Colors, Spacing, BorderRadius } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import CountryCodePicker from '../components/CountryCodePicker';
import PermissionsOnboardingScreen from './PermissionsOnboardingScreen';
import { normalizePhoneNumber } from '../utils/phone';
import {
    getTextBeeConfig,
    setTextBeeConfig,
    testTextBeeConnection
} from '../services/EmergencySMSService';
import { DisguisedCalculatorModal } from '../components/DisguisedCalculator';
import {
    getEmergencySpeechSettings,
    saveEmergencySpeechSettings,
    speakDialogueText,
    stopEmergencySpeech,
} from '../services/EmergencySpeechService';
import { checkForAppUpdate, getCurrentAppVersion } from '../services/AppUpdateService';
import { CrashDetectionSettingsModal } from '../components/CrashDetectionSettingsModal';
import { getCrashDetectionEnabled } from '../services/CrashDetectionService';

export default function ProfileScreen() {
    const { userProfile, user, signOut, refreshProfile } = useAuth();
    const navigation = useNavigation<any>();
    const insets = useSafeAreaInsets();
    const { showAlert, showToast } = useAlert();
    const [editing, setEditing] = useState(false);
    const [showPermissionsModal, setShowPermissionsModal] = useState(false);
    const [showCovertModal, setShowCovertModal] = useState(false);
    const [showCrashModal, setShowCrashModal] = useState(false);
    const [crashEnabled, setCrashEnabled] = useState(true);
    const [speechEnabled, setSpeechEnabled] = useState(true);
    const [name, setName] = useState(userProfile?.name ?? '');
    const [countryCode, setCountryCode] = useState('+63');
    const [phone, setPhone] = useState(userProfile?.phone ?? '');
    const [saving, setSaving] = useState(false);
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const [appVersion, setAppVersion] = useState('2.0.0');
    const [checkingUpdate, setCheckingUpdate] = useState(false);

    // TextBee SMS Gateway Settings State
    const [showTextBeeModal, setShowTextBeeModal] = useState(false);
    const [tbApiKey, setTbApiKey] = useState('');
    const [tbDeviceId, setTbDeviceId] = useState('');
    const [tbWebhookUrl, setTbWebhookUrl] = useState('');
    const [testingTb, setTestingTb] = useState(false);
    const [savingTb, setSavingTb] = useState(false);
    const [hasTbConfigured, setHasTbConfigured] = useState(false);

    React.useEffect(() => {
        getTextBeeConfig().then((cfg) => {
            setTbApiKey(cfg.apiKey);
            setTbDeviceId(cfg.deviceId);
            setTbWebhookUrl(cfg.webhookUrl);
            setHasTbConfigured(Boolean(cfg.apiKey && cfg.apiKey.trim().length > 0));
        });
        getEmergencySpeechSettings().then((s) => {
            setSpeechEnabled(s.enabled);
        });
        getCurrentAppVersion().then((v) => {
            if (v?.versionName) setAppVersion(v.versionName);
        }).catch(() => {});
        getCrashDetectionEnabled().then(setCrashEnabled).catch(() => {});
    }, []);

    const handleSaveTextBee = async () => {
        setSavingTb(true);
        try {
            await setTextBeeConfig({
                apiKey: tbApiKey.trim(),
                deviceId: tbDeviceId.trim(),
                webhookUrl: tbWebhookUrl.trim(),
            });
            setHasTbConfigured(Boolean(tbApiKey.trim().length > 0));
            showToast({ message: 'TextBee SMS gateway settings saved!', type: 'success' });
            setShowTextBeeModal(false);
        } catch (e: any) {
            showAlert({ title: 'Save Failed', message: e?.message || 'Failed to save TextBee settings.', type: 'error' });
        } finally {
            setSavingTb(false);
        }
    };

    const handleTestTextBee = async () => {
        setTestingTb(true);
        try {
            const result = await testTextBeeConnection(tbApiKey, tbDeviceId, tbWebhookUrl);
            showAlert({
                title: result.success ? 'TextBee Connected!' : 'Connection Failed',
                message: result.message,
                type: result.success ? 'info' : 'error',
            });
        } finally {
            setTestingTb(false);
        }
    };

    const handleSave = async () => {
        if (!name.trim() || !phone.trim()) {
            showAlert({
                title: 'Missing Fields',
                message: 'Name and phone are required.',
                type: 'error'
            });
            return;
        }
        setSaving(true);
        try {
            const trimmedName = name.trim();
            const fullPhone = normalizePhoneNumber(phone, countryCode);
            const nowIso = new Date().toISOString();

            // 1. Update personal row in users table
            const { error: userUpdateError } = await supabase
                .from('users')
                .update({ name: trimmedName, phone: fullPhone, updated_at: nowIso })
                .eq('id', user?.id);

            if (userUpdateError) throw userUpdateError;

            // 2. Sync to all paired family_members rows so linked relatives see updated personal info immediately
            if (user?.id) {
                try {
                    await supabase
                        .from('family_members')
                        .update({ name: trimmedName, phone: fullPhone })
                        .eq('member_user_id', user.id);
                } catch (fmErr) {
                    console.warn('[ProfileScreen] sync to family_members non-fatal:', fmErr);
                }

                // 3. Sync name to Auth user metadata
                try {
                    await supabase.auth.updateUser({ data: { name: trimmedName } });
                } catch {}

                // 4. Realtime broadcast to all active family members' devices (0ms instant update)
                try {
                    await supabase.channel('family-broadcast').send({
                        type: 'broadcast',
                        event: 'profile_updated',
                        payload: {
                            user_id: user.id,
                            name: trimmedName,
                            phone: fullPhone,
                            avatar_url: userProfile?.avatar_url,
                        },
                    });
                } catch {}
            }

            await refreshProfile();
            showToast({ message: 'Profile updated successfully!', type: 'success' });
            setEditing(false);
        } catch (err: any) {
            showAlert({
                title: 'Update Failed',
                message: err.message || 'Could not update profile.',
                type: 'error',
            });
        } finally {
            setSaving(false);
        }
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

                const newAvatarUrl = publicUrlData.publicUrl;

                // 1. Update personal users row
                await supabase.from('users').update({ avatar_url: newAvatarUrl }).eq('id', user.id);

                // 2. Sync avatar to paired family members' lists
                try {
                    await supabase
                        .from('family_members')
                        .update({ avatar_url: newAvatarUrl })
                        .eq('member_user_id', user.id);
                } catch {}

                // 3. Realtime broadcast to peers
                try {
                    await supabase.channel('family-broadcast').send({
                        type: 'broadcast',
                        event: 'profile_updated',
                        payload: {
                            user_id: user.id,
                            name: userProfile?.name,
                            phone: userProfile?.phone,
                            avatar_url: newAvatarUrl,
                        },
                    });
                } catch {}

                await refreshProfile();
                showToast({ message: 'Profile picture updated!', type: 'success' });
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

            // Sync removal to family members and broadcast
            try {
                await supabase
                    .from('family_members')
                    .update({ avatar_url: null })
                    .eq('member_user_id', user.id);
            } catch {}

            try {
                await supabase.channel('family-broadcast').send({
                    type: 'broadcast',
                    event: 'profile_updated',
                    payload: {
                        user_id: user.id,
                        name: userProfile?.name,
                        phone: userProfile?.phone,
                        avatar_url: null,
                    },
                });
            } catch {}

            await refreshProfile();
            showToast({ message: 'Profile picture removed.', type: 'info' });
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
                    <InfoRow icon="git-branch" label="System Version" value={`v${appVersion}-Guardian`} color={Colors.textMuted} />
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

                    <View style={{ height: 12 }} />

                    {/* TextBee SMS Gateway Settings */}
                    <TouchableOpacity
                        style={styles.permissionActionRow}
                        onPress={async () => {
                            const cfg = await getTextBeeConfig();
                            setTbApiKey(cfg.apiKey);
                            setTbDeviceId(cfg.deviceId);
                            setTbWebhookUrl(cfg.webhookUrl);
                            setShowTextBeeModal(true);
                        }}
                        activeOpacity={0.7}
                    >
                        <View style={styles.permissionLeft}>
                            <View style={[styles.infoIcon, { backgroundColor: '#0284C715' }]}>
                                <Ionicons name="cloud-upload-outline" size={18} color="#0284C7" />
                            </View>
                            <View style={{ flex: 1, paddingRight: 8 }}>
                                <Text style={styles.infoLabel}>TextBee SMS Gateway</Text>
                                <Text style={styles.permissionSub}>
                                    {hasTbConfigured ? 'Connected (API Key Active)' : 'Not configured (Tap to add key)'}
                                </Text>
                            </View>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                    </TouchableOpacity>

                    <View style={{ height: 12 }} />

                    {/* Disguised Tools & Covert SOS Trigger */}
                    <TouchableOpacity
                        style={styles.permissionActionRow}
                        onPress={() => navigation.navigate('CovertCalculator')}
                        activeOpacity={0.7}
                    >
                        <View style={styles.permissionLeft}>
                            <View style={[styles.infoIcon, { backgroundColor: '#10B98115' }]}>
                                <Ionicons name="calculator-outline" size={18} color="#10B981" />
                            </View>
                            <View style={{ flex: 1, paddingRight: 8 }}>
                                <Text style={styles.infoLabel}>Disguised Tools & Covert SOS</Text>
                                <Text style={styles.permissionSub}>
                                    Stealth calculator trigger, weather tap & volume shortcuts
                                </Text>
                            </View>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                    </TouchableOpacity>

                    <View style={{ height: 12 }} />

                    {/* Car Crash Detection */}
                    <TouchableOpacity
                        style={styles.permissionActionRow}
                        onPress={() => setShowCrashModal(true)}
                        activeOpacity={0.7}
                    >
                        <View style={styles.permissionLeft}>
                            <View style={[styles.infoIcon, { backgroundColor: '#DC262615' }]}>
                                <Ionicons name="car-sport-outline" size={18} color="#DC2626" />
                            </View>
                            <View style={{ flex: 1, paddingRight: 8 }}>
                                <Text style={styles.infoLabel}>Car Crash Detection</Text>
                                <Text style={styles.permissionSub}>
                                    {crashEnabled
                                        ? 'Armed above 40 km/h • Impact & gyro sensor fusion'
                                        : 'Paused • Tap to enable & check device readiness'}
                                </Text>
                            </View>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                    </TouchableOpacity>

                    <View style={{ height: 12 }} />

                    {/* Emergency Voice Reader (TTS) */}
                    <View style={styles.permissionActionRow}>
                        <View style={styles.permissionLeft}>
                            <View style={[styles.infoIcon, { backgroundColor: '#8B5CF615' }]}>
                                <Ionicons name="volume-high-outline" size={18} color="#8B5CF6" />
                            </View>
                            <View style={{ flex: 1, paddingRight: 8 }}>
                                <Text style={styles.infoLabel}>Emergency Voice Reader (TTS)</Text>
                                <Text style={styles.permissionSub}>
                                    {speechEnabled
                                        ? 'Active • Reads SOS, Loud Ping & Check-In dialogues'
                                        : 'Muted • Dialogue voice reading is off'}
                                </Text>
                            </View>
                        </View>
                        <Switch
                            value={speechEnabled}
                            onValueChange={async (val) => {
                                setSpeechEnabled(val);
                                await saveEmergencySpeechSettings({ enabled: val });
                                if (val) {
                                    speakDialogueText('Emergency voice reader is active. Emergency dialogues will be read out loud.');
                                } else {
                                    stopEmergencySpeech().catch(() => {});
                                }
                            }}
                            trackColor={{ false: '#CBD5E1', true: '#8B5CF6' }}
                            thumbColor="#FFFFFF"
                        />
                    </View>
                    <View style={{ height: 12 }} />

                    {/* App Version & Auto-Update Check */}
                    <TouchableOpacity
                        style={styles.permissionActionRow}
                        disabled={checkingUpdate}
                        activeOpacity={0.7}
                        onPress={async () => {
                            setCheckingUpdate(true);
                            try {
                                const info = await checkForAppUpdate({ force: true });
                                if (info?.hasUpdate) {
                                    DeviceEventEmitter.emit('onOpenAppUpdateModal', info);
                                } else if (info) {
                                    showToast({ message: `You're on the latest version (v${info.currentVersion}).`, type: 'success' });
                                } else {
                                    showToast({ message: 'Unable to check for updates right now.', type: 'warning' });
                                }
                            } finally {
                                setCheckingUpdate(false);
                            }
                        }}
                    >
                        <View style={styles.permissionLeft}>
                            <View style={[styles.infoIcon, { backgroundColor: '#2176AE15' }]}>
                                <Ionicons name="cloud-download-outline" size={18} color={Colors.family} />
                            </View>
                            <View style={{ flex: 1, paddingRight: 8 }}>
                                <Text style={styles.infoLabel}>App Updates</Text>
                                <Text style={styles.permissionSub}>
                                    {checkingUpdate ? 'Checking GitHub Releases...' : `Installed v${appVersion} • Tap to check for updates`}
                                </Text>
                            </View>
                        </View>
                        {checkingUpdate ? (
                            <ActivityIndicator size="small" color={Colors.family} />
                        ) : (
                            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                        )}
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

            {/* TextBee SMS Gateway Settings Modal */}
            <Modal visible={showTextBeeModal} animationType="slide" transparent statusBarTranslucent>
                <View style={styles.overlay}>
                    <View style={styles.modal}>
                        <View style={styles.modalHandle} />
                        <Text style={styles.modalTitle}>TextBee SMS Gateway</Text>
                        <Text style={styles.modalSub}>
                            Connect your TextBee (textbee.dev) API to send cloud SMS alerts for free without mobile load.
                        </Text>

                        <View style={styles.form}>
                            <View style={styles.formGroup}>
                                <Text style={styles.fieldLabel}>TextBee API Key (Required)</Text>
                                <View style={styles.inputContainer}>
                                    <Ionicons name="key-outline" size={20} color={Colors.textLight} />
                                    <TextInput
                                        style={styles.fieldInput}
                                        value={tbApiKey}
                                        onChangeText={setTbApiKey}
                                        placeholder="Paste your TextBee API key"
                                        placeholderTextColor={Colors.textMuted}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                    />
                                </View>
                            </View>

                            <View style={styles.formGroup}>
                                <Text style={styles.fieldLabel}>Device ID (Optional)</Text>
                                <View style={styles.inputContainer}>
                                    <Ionicons name="phone-portrait-outline" size={20} color={Colors.textLight} />
                                    <TextInput
                                        style={styles.fieldInput}
                                        value={tbDeviceId}
                                        onChangeText={setTbDeviceId}
                                        placeholder="Optional specific Android device ID"
                                        placeholderTextColor={Colors.textMuted}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                    />
                                </View>
                            </View>

                            <View style={styles.formGroup}>
                                <Text style={styles.fieldLabel}>Webhook / API Endpoint</Text>
                                <View style={styles.inputContainer}>
                                    <Ionicons name="link-outline" size={20} color={Colors.textLight} />
                                    <TextInput
                                        style={styles.fieldInput}
                                        value={tbWebhookUrl}
                                        onChangeText={setTbWebhookUrl}
                                        placeholder="https://api.textbee.dev/api/v1/gateway/send-sms"
                                        placeholderTextColor={Colors.textMuted}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                    />
                                </View>
                            </View>
                        </View>

                        <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
                            <TouchableOpacity
                                style={[styles.cancelBtn, { flex: 1 }]}
                                onPress={handleTestTextBee}
                                disabled={testingTb}
                            >
                                {testingTb ? (
                                    <ActivityIndicator size="small" color={Colors.text} />
                                ) : (
                                    <Text style={styles.cancelBtnText}>Test Ping</Text>
                                )}
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.saveActionBtn, { flex: 1.5 }]}
                                onPress={handleSaveTextBee}
                                disabled={savingTb}
                            >
                                {savingTb ? (
                                    <ActivityIndicator size="small" color={Colors.white} />
                                ) : (
                                    <Text style={styles.saveActionBtnText}>Save Gateway</Text>
                                )}
                            </TouchableOpacity>
                        </View>

                        <TouchableOpacity
                            style={{ alignSelf: 'center', marginTop: 16 }}
                            onPress={() => setShowTextBeeModal(false)}
                        >
                            <Text style={{ color: Colors.textMuted, fontWeight: '700', fontSize: 13 }}>Cancel / Close</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* Disguised Emergency Tools / Covert Calculator Modal */}
            <DisguisedCalculatorModal
                visible={showCovertModal}
                onClose={() => setShowCovertModal(false)}
            />

            {/* Car Crash Detection Settings & Readiness Modal */}
            <CrashDetectionSettingsModal
                visible={showCrashModal}
                onClose={() => {
                    setShowCrashModal(false);
                    getCrashDetectionEnabled().then(setCrashEnabled).catch(() => {});
                }}
                onOpenPermissions={() => setShowPermissionsModal(true)}
            />
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
