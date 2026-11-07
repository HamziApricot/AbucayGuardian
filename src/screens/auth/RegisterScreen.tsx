import React, { useState } from 'react';
import {
    View, Text, TextInput, TouchableOpacity, StyleSheet,
    KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { useAlert } from '../../context/AlertContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import CountryCodePicker from '../../components/CountryCodePicker';

type Props = { navigation: any };

export default function RegisterScreen({ navigation }: Props) {
    const insets = useSafeAreaInsets();
    const { showAlert, showToast } = useAlert();
    const { session, userProfile, user, sendOtp, verifyOtp, createProfile } = useAuth();
    const [name, setName] = useState('');
    const [countryCode, setCountryCode] = useState('+63');
    const [phone, setPhone] = useState('');
    const [code, setCode] = useState('');
    const [phase, setPhase] = useState<'request' | 'verify' | 'setup'>('request');
    const [loading, setLoading] = useState(false);

    React.useEffect(() => {
        if (session && !userProfile) {
            setPhase('setup');
            if (user?.phone && !phone) {
                // Heuristic to split user.phone back to countryCode and phone
                const p = user.phone;
                const match = p.match(/^(\+\d{1,3})/);
                if (match) {
                    setCountryCode(match[1]);
                    setPhone(p.replace(match[1], ''));
                }
            }
        }
    }, [session, userProfile, user]);

    const handleRequestOtp = async () => {
        if (!phone) {
            showAlert({
                title: 'Missing Phone',
                message: 'Please enter your phone number.',
                type: 'warning'
            });
            return;
        }
        setLoading(true);
        const fullPhone = `${countryCode}${phone.replace(/^0+/, '')}`;
        const { error } = await sendOtp(fullPhone);
        setLoading(false);
        if (error) {
            showAlert({
                title: 'Request Failed',
                message: error,
                type: 'error'
            });
        } else {
            setPhase('verify');
        }
    };

    const handleVerifyOtp = async () => {
        if (!code) {
            showAlert({
                title: 'Missing Code',
                message: 'Please enter the verification code.',
                type: 'warning'
            });
            return;
        }
        setLoading(true);
        const fullPhone = `${countryCode}${phone.replace(/^0+/, '')}`;
        const { error, isNewUser } = await verifyOtp(fullPhone, code.trim());
        setLoading(false);

        if (error) {
            showAlert({
                title: 'Verification Failed',
                message: error,
                type: 'error'
            });
        } else if (isNewUser) {
            setPhase('setup');
        } else {
            showToast({
                message: 'You already have an account. Logging you in...',
                type: 'info'
            });
        }
    };

    const handleCompleteSetup = async () => {
        if (!name) {
            showAlert({
                title: 'Missing Name',
                message: 'Please enter your full name.',
                type: 'warning'
            });
            return;
        }
        setLoading(true);
        const fullPhone = `${countryCode}${phone.replace(/^0+/, '')}`;
        const { error } = await createProfile(name.trim(), fullPhone);
        setLoading(false);
        if (error) {
            showAlert({
                title: 'Setup Failed',
                message: error,
                type: 'error'
            });
        }
    };

    return (
        <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
                <View style={[styles.header, { paddingTop: Math.max(insets.top, 24) }]}>
                    <View style={styles.logoContainer}>
                        <Ionicons name="shield-checkmark" size={40} color={Colors.white} />
                    </View>
                    <Text style={styles.appName}>Abucay Guardian</Text>
                </View>

                <View style={styles.card}>
                    <Text style={styles.title}>
                        {phase === 'request' ? 'Create Account' : phase === 'verify' ? 'Verify Phone' : 'Complete Profile'}
                    </Text>
                    <Text style={styles.subtitle}>
                        {phase === 'request' ? 'Protect your family starting today' :
                            phase === 'verify' ? `Enter the code sent to ${phone}` :
                                'Tell us your name to finish registration'}
                    </Text>

                    {phase === 'request' && (
                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Phone Number</Text>
                            <View style={styles.inputRow}>
                                <CountryCodePicker selectedCountry={countryCode} onSelect={setCountryCode} />
                                <TextInput
                                    style={styles.input}
                                    placeholder="9XX XXX XXXX"
                                    placeholderTextColor={Colors.textMuted}
                                    value={phone}
                                    onChangeText={setPhone}
                                    keyboardType="phone-pad"
                                />
                            </View>
                        </View>
                    )}

                    {phase === 'verify' && (
                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Verification Code</Text>
                            <View style={styles.inputRow}>
                                <Ionicons name="key-outline" size={18} color={Colors.textLight} style={styles.inputIcon} />
                                <TextInput
                                    style={styles.input}
                                    placeholder="123456"
                                    placeholderTextColor={Colors.textMuted}
                                    value={code}
                                    onChangeText={setCode}
                                    keyboardType="number-pad"
                                    maxLength={6}
                                />
                            </View>
                        </View>
                    )}

                    {phase === 'setup' && (
                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Full Name</Text>
                            <View style={styles.inputRow}>
                                <Ionicons name="person-outline" size={18} color={Colors.textLight} style={styles.inputIcon} />
                                <TextInput
                                    style={styles.input}
                                    placeholder="Juan dela Cruz"
                                    placeholderTextColor={Colors.textMuted}
                                    value={name}
                                    onChangeText={setName}
                                    autoCapitalize="words"
                                />
                            </View>
                        </View>
                    )}

                    <TouchableOpacity
                        style={styles.btn}
                        onPress={
                            phase === 'request' ? handleRequestOtp :
                                phase === 'verify' ? handleVerifyOtp :
                                    handleCompleteSetup
                        }
                        disabled={loading}
                    >
                        {loading ? <ActivityIndicator color={Colors.white} /> : (
                            <Text style={styles.btnText}>
                                {phase === 'request' ? 'Send Code' :
                                    phase === 'verify' ? 'Verify & Register' :
                                        'Complete Registration'}
                            </Text>
                        )}
                    </TouchableOpacity>

                    {phase !== 'request' && (
                        <TouchableOpacity onPress={() => setPhase('request')} style={{ marginBottom: Spacing.md }}>
                            <Text style={styles.link}>Start over</Text>
                        </TouchableOpacity>
                    )}

                    <TouchableOpacity onPress={() => navigation.navigate('Login')}>
                        <Text style={styles.link}>
                            Already have an account? <Text style={styles.linkBold}>Sign In</Text>
                        </Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.secondary },
    inner: { flexGrow: 1, paddingHorizontal: Spacing.lg },
    header: { alignItems: 'center', paddingTop: 48, paddingBottom: Spacing.lg },
    logoContainer: {
        width: 72, height: 72, borderRadius: 36,
        backgroundColor: Colors.sos, alignItems: 'center', justifyContent: 'center',
        marginBottom: Spacing.sm, shadowColor: Colors.sos, shadowOpacity: 0.4, shadowRadius: 16, elevation: 8,
    },
    appName: { fontSize: 24, fontWeight: '800', color: Colors.white },
    card: {
        backgroundColor: Colors.white, borderRadius: BorderRadius.xl,
        padding: Spacing.xl, marginBottom: Spacing.xl,
        shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, elevation: 8,
    },
    title: { fontSize: 22, fontWeight: '700', color: Colors.text, marginBottom: 4 },
    subtitle: { fontSize: 13, color: Colors.textLight, marginBottom: Spacing.lg },
    inputGroup: { marginBottom: Spacing.md },
    label: { fontSize: 12, fontWeight: '600', color: Colors.text, marginBottom: 6 },
    inputRow: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: Colors.background, borderRadius: BorderRadius.md,
        borderWidth: 1, borderColor: Colors.border,
        paddingHorizontal: Spacing.md, height: 48,
    },
    inputIcon: { marginRight: 8 },
    input: { flex: 1, fontSize: 15, color: Colors.text },
    btn: {
        backgroundColor: Colors.secondary, borderRadius: BorderRadius.md,
        paddingVertical: 14, alignItems: 'center', marginTop: Spacing.sm, marginBottom: Spacing.md,
    },
    btnText: { color: Colors.white, fontSize: 16, fontWeight: '700' },
    link: { textAlign: 'center', fontSize: 13, color: Colors.textLight },
    linkBold: { color: Colors.secondary, fontWeight: '700' },
});
