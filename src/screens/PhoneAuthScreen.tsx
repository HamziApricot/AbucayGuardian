import React, { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  Alert,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { supabase } from '../services/supabase';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { normalizePhoneNumber, cleanOtpCode } from '../utils/phone';

// Format input into E.164 (+639XXXXXXXXX)
export const formatE164 = (num: string) => normalizePhoneNumber(num);

export function PhoneAuthScreen({ navigation }: { navigation?: any }) {
  const [phone, setPhone] = useState('');
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [step, setStep] = useState<'phone' | 'otp' | 'setup'>('phone');
  const [loading, setLoading] = useState(false);
  const auth = useAuth();

  const handleSendOtp = async () => {
    if (!phone.trim()) {
      Alert.alert('Phone Required', 'Please enter your mobile phone number.');
      return;
    }
    setLoading(true);
    try {
      const e164 = formatE164(phone);
      const { error } = await supabase.auth.signInWithOtp({ phone: e164 });
      if (error) throw error;
      setStep('otp');
      Alert.alert('Code Sent', `Check your SMS inbox for the verification code sent to ${e164}.`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to send OTP code.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    const cleanedToken = cleanOtpCode(token);
    if (!cleanedToken || cleanedToken.length < 6) {
      Alert.alert('Code Required', 'Please enter the 6-digit verification code.');
      return;
    }
    setLoading(true);
    try {
      const e164 = formatE164(phone);
      const { data, error } = await supabase.auth.verifyOtp({
        phone: e164,
        token: cleanedToken,
        type: 'sms',
      });
      if (error) throw error;

      if (auth?.refreshProfile) {
        await auth.refreshProfile();
      }

      // Check if user has an existing profile in users table
      if (data.user) {
        const { data: profile } = await supabase
          .from('users')
          .select('id, name')
          .eq('id', data.user.id)
          .single();

        if (!profile) {
          // Prompt user for their name to finish profile creation
          setStep('setup');
          return;
        }
      }

      Alert.alert('Success', 'Verification successful! Logging you in...');
    } catch (err: any) {
      Alert.alert('Verification Failed', err.message || 'Invalid or expired OTP code.');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteSetup = async () => {
    if (!name.trim()) {
      Alert.alert('Name Required', 'Please enter your name to complete your profile.');
      return;
    }
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No authenticated user session found.');

      const e164 = formatE164(phone);
      const pairingCode = Math.random().toString(36).substring(2, 8).toUpperCase();

      const { error } = await supabase.from('users').insert({
        id: user.id,
        name: name.trim(),
        phone: e164,
        pairing_code: pairingCode,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;

      if (auth?.refreshProfile) {
        await auth.refreshProfile();
      }
      Alert.alert('Profile Created', 'Your Abucay Guardian profile has been registered!');
    } catch (err: any) {
      Alert.alert('Setup Error', err.message || 'Failed to create profile.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <Ionicons name="chatbox-ellipses-outline" size={42} color={Colors.white} />
          </View>
          <Text style={styles.title}>
            {step === 'phone'
              ? 'Phone Verification'
              : step === 'otp'
              ? 'Enter Verification Code'
              : 'Complete Your Profile'}
          </Text>
          <Text style={styles.subtitle}>
            {step === 'phone'
              ? 'Enter your mobile number to receive a one-time SMS verification code via TextBee.'
              : step === 'otp'
              ? `We sent a 6-digit code to ${formatE164(phone)}`
              : 'Please enter your name to finish setting up your account.'}
          </Text>
        </View>

        {/* Card */}
        <View style={styles.card}>
          {step === 'phone' && (
            <>
              <Text style={styles.inputLabel}>Mobile Number (e.g., 09171234567)</Text>
              <View style={styles.inputContainer}>
                <Ionicons name="call-outline" size={20} color={Colors.textLight} style={styles.fieldIcon} />
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="09171234567"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="phone-pad"
                  style={styles.textInput}
                  autoFocus
                />
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, loading && styles.btnDisabled]}
                onPress={handleSendOtp}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color={Colors.white} />
                ) : (
                  <Text style={styles.primaryBtnText}>Send OTP Code</Text>
                )}
              </TouchableOpacity>
            </>
          )}

          {step === 'otp' && (
            <>
              <Text style={styles.inputLabel}>Enter 6-Digit Code</Text>
              <View style={styles.inputContainer}>
                <Ionicons name="key-outline" size={20} color={Colors.textLight} style={styles.fieldIcon} />
                <TextInput
                  value={token}
                  onChangeText={(text) => setToken(cleanOtpCode(text))}
                  placeholder="123456"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={10}
                  style={[styles.textInput, styles.otpInput]}
                  autoFocus
                />
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, loading && styles.btnDisabled]}
                onPress={handleVerifyOtp}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color={Colors.white} />
                ) : (
                  <Text style={styles.primaryBtnText}>Verify Code</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => setStep('phone')}
                disabled={loading}
              >
                <Text style={styles.secondaryBtnText}>← Change Number / Back</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'setup' && (
            <>
              <Text style={styles.inputLabel}>Full Name</Text>
              <View style={styles.inputContainer}>
                <Ionicons name="person-outline" size={20} color={Colors.textLight} style={styles.fieldIcon} />
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Juan dela Cruz"
                  placeholderTextColor={Colors.textMuted}
                  style={styles.textInput}
                  autoCapitalize="words"
                  autoFocus
                />
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, loading && styles.btnDisabled]}
                onPress={handleCompleteSetup}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color={Colors.white} />
                ) : (
                  <Text style={styles.primaryBtnText}>Complete Setup</Text>
                )}
              </TouchableOpacity>
            </>
          )}

          {navigation && (
            <TouchableOpacity
              style={styles.backLink}
              onPress={() => navigation.goBack?.() || navigation.navigate?.('Login')}
            >
              <Text style={styles.backLinkText}>Return to Standard Login</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.secondary,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  header: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.sos,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
    shadowColor: Colors.sos,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.white,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.75)',
    textAlign: 'center',
    paddingHorizontal: Spacing.md,
    lineHeight: 18,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 15,
    elevation: 8,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.md,
    height: 52,
    marginBottom: Spacing.lg,
  },
  fieldIcon: {
    marginRight: 10,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    color: Colors.text,
  },
  otpInput: {
    letterSpacing: 8,
    fontWeight: '700',
    fontSize: 20,
  },
  primaryBtn: {
    backgroundColor: Colors.secondary,
    borderRadius: BorderRadius.md,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.secondary,
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    marginTop: Spacing.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: Colors.textLight,
    fontSize: 14,
    fontWeight: '600',
  },
  backLink: {
    marginTop: Spacing.lg,
    paddingVertical: 8,
    alignItems: 'center',
  },
  backLinkText: {
    color: Colors.secondary,
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});

export default PhoneAuthScreen;

