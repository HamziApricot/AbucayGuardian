import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Linking,
  Alert,
  AppState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import * as IntentLauncher from 'expo-intent-launcher';
import { Colors, Spacing, BorderRadius, Fonts } from '../constants/theme';

interface PermissionsOnboardingScreenProps {
  onComplete: () => void;
  isSettingsMode?: boolean;
}

export default function PermissionsOnboardingScreen({
  onComplete,
  isSettingsMode = false,
}: PermissionsOnboardingScreenProps) {
  const insets = useSafeAreaInsets();

  // Permission states
  const [notificationGranted, setNotificationGranted] = useState(false);
  const [locationGranted, setLocationGranted] = useState(false);
  const [activityGranted, setActivityGranted] = useState(false);
  const [batteryGranted, setBatteryGranted] = useState(false);
  const [overlayGranted, setOverlayGranted] = useState(false);
  const [popupsGranted, setPopupsGranted] = useState(false);
  const [fullScreenGranted, setFullScreenGranted] = useState(false);

  // Check current permission statuses
  const checkAllPermissions = async () => {
    try {
      // 1. Notification
      const notifStatus = await Notifications.getPermissionsAsync();
      setNotificationGranted(notifStatus.granted || notifStatus.status === 'granted');

      // 2. Location
      const fgStatus = await Location.getForegroundPermissionsAsync();
      const bgStatus = await Location.getBackgroundPermissionsAsync().catch(() => null);
      setLocationGranted(
        (fgStatus.granted || fgStatus.status === 'granted') &&
        (bgStatus ? bgStatus.granted || bgStatus.status === 'granted' : true)
      );

      // 3. Physical Activity
      if (Platform.OS === 'android') {
        try {
          const { PermissionsAndroid } = require('react-native');
          const hasActivity = await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION
          );
          setActivityGranted(hasActivity);
        } catch {
          // ignore
        }
      } else {
        setActivityGranted(true);
      }

      // 4. Battery Optimization
      if (Platform.OS === 'android') {
        try {
          const batteryOpt = require('react-native-battery-optimization-check');
          if (batteryOpt && typeof batteryOpt.BatteryOptEnabled === 'function') {
            const isOptEnabled = await batteryOpt.BatteryOptEnabled();
            // If optimization is enabled, unrestricted background is FALSE; if disabled, background activity is TRUE
            setBatteryGranted(!isOptEnabled);
          }
        } catch {}
      }

      // 5, 6, 7. Load previously configured flags from storage
      try {
        const [savedOverlay, savedPopups, savedFullScreen] = await Promise.all([
          AsyncStorage.getItem('@abucay_perm_overlay'),
          AsyncStorage.getItem('@abucay_perm_popups'),
          AsyncStorage.getItem('@abucay_perm_fullscreen'),
        ]);
        if (savedOverlay === 'true') setOverlayGranted(true);
        if (savedPopups === 'true') setPopupsGranted(true);
        if (savedFullScreen === 'true') setFullScreenGranted(true);
      } catch {}
    } catch (e) {
      // Non-blocking
    }
  };

  useEffect(() => {
    checkAllPermissions();

    // Re-check when app regains focus from system settings
    const sub = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        checkAllPermissions();
      }
    });

    return () => sub.remove();
  }, []);

  // Request 1: Notifications
  const handleRequestNotifications = async () => {
    try {
      try {
        const notifee = require('@notifee/react-native').default;
        if (notifee) {
          await notifee.requestPermission({ criticalAlert: true });
        }
      } catch {}

      const res = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
      const granted = res.granted || res.status === 'granted';
      setNotificationGranted(granted);
      if (!granted) {
        Alert.alert(
          'Notifications Required',
          'Please enable Notifications in App Settings to receive emergency alerts.',
          [
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
            { text: 'Cancel', style: 'cancel' },
          ]
        );
      }
    } catch {
      Linking.openSettings();
    }
  };

  // Request 2: Location (Foreground + Background)
  const handleRequestLocation = async () => {
    try {
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status === 'granted') {
        const bg = await Location.requestBackgroundPermissionsAsync().catch(() => null);
        const allGranted = bg ? bg.status === 'granted' : true;
        setLocationGranted(allGranted);
        if (!allGranted) {
          Alert.alert(
            'Background Location Needed',
            'To allow your family circle to see your location during an SOS or disaster, select "Allow all the time" in Location permissions.',
            [
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
              { text: 'Later', style: 'cancel' },
            ]
          );
        }
      } else {
        Linking.openSettings();
      }
    } catch {
      Linking.openSettings();
    }
  };

  // Request 3: Physical Activity (Motion Detection)
  const handleRequestActivity = async () => {
    if (Platform.OS === 'android') {
      try {
        const { PermissionsAndroid } = require('react-native');
        const res = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
          {
            title: 'Physical Activity Permission',
            message: 'Abucay Guardian uses motion recognition to save battery while you are stationary.',
            buttonPositive: 'Allow',
          }
        );
        const granted = res === PermissionsAndroid.RESULTS.GRANTED;
        setActivityGranted(granted);
        if (!granted) {
          Linking.openSettings();
        }
      } catch {
        Linking.openSettings();
      }
    } else {
      setActivityGranted(true);
    }
  };

  // Request 4: Battery Usage (Allow background activity)
  const handleRequestBattery = () => {
    if (Platform.OS === 'android') {
      try {
        const batteryOpt = require('react-native-battery-optimization-check');
        if (batteryOpt && typeof batteryOpt.RequestDisableOptimization === 'function') {
          batteryOpt.RequestDisableOptimization();
          setBatteryGranted(true);
          return;
        }
      } catch {}
      Alert.alert(
        '🔋 Allow Background Activity',
        'To prevent Android from putting the emergency listener to sleep:\n\n1. Go to App Info > Battery (or Battery usage).\n2. Select "Unrestricted" (or "Allow background activity").',
        [
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    }
  };

  // Helper to open Special App Access menu
  const openSpecialAppAccess = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return false;

    // 1. Try launching the direct Special Access Settings activity alias
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.MAIN', {
        packageName: 'com.android.settings',
        className: 'com.android.settings.Settings$SpecialAccessSettingsActivity',
      });
      return true;
    } catch {}

    // 2. Try direct fragment activity class
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.MAIN', {
        packageName: 'com.android.settings',
        className: 'com.android.settings.applications.specialaccess.SpecialAccessSettingsActivity',
      });
      return true;
    } catch {}

    // 3. Try Xiaomi/MIUI permission editor
    try {
      await IntentLauncher.startActivityAsync('miui.intent.action.APP_PERM_EDITOR', {
        packageName: 'com.miui.securitycenter',
        className: 'com.miui.permcenter.permissions.PermissionsEditorActivity',
        extra: { extra_pkgname: 'com.abucay.guardian' },
      });
      return true;
    } catch {}

    // 4. Try overlay permissions list (direct ancestor/sibling in special access)
    try {
      await IntentLauncher.startActivityAsync('android.settings.action.MANAGE_OVERLAY_PERMISSION');
      return true;
    } catch {}

    return false;
  };

  // Request 5: Display over other apps (Appear on top)
  const handleRequestOverlay = async () => {
    setOverlayGranted(true);
    AsyncStorage.setItem('@abucay_perm_overlay', 'true').catch(() => {});

    if (Platform.OS === 'android') {
      try {
        await IntentLauncher.startActivityAsync(
          'android.settings.action.MANAGE_OVERLAY_PERMISSION',
          { data: 'package:com.abucay.guardian' }
        );
        return;
      } catch {}

      try {
        await IntentLauncher.startActivityAsync(
          'android.settings.action.MANAGE_OVERLAY_PERMISSION'
        );
        return;
      } catch {}

      Linking.openSettings();
    }
  };

  // Request 6: Display pop-ups while running in background (Under Special App Access)
  const handleRequestPopups = async () => {
    setPopupsGranted(true);
    AsyncStorage.setItem('@abucay_perm_popups', 'true').catch(() => {});

    if (Platform.OS === 'android') {
      const opened = await openSpecialAppAccess();
      if (!opened) {
        Alert.alert(
          '📱 Display Pop-ups While in Background',
          'Under Special App Access:\n\n1. In Settings, go to Apps → Special app access.\n2. Tap "Display pop-ups while in background".\n3. Select "Abucay Guardian" and toggle to Allowed.',
          [
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
            { text: 'Got It', style: 'cancel' },
          ]
        );
      }
    }
  };

  // Request 7: Send Full-Screen Notifications (Android 14+ / Special App Access)
  const handleRequestFullScreen = async () => {
    setFullScreenGranted(true);
    AsyncStorage.setItem('@abucay_perm_fullscreen', 'true').catch(() => {});

    if (Platform.OS === 'android') {
      // 1. Target exact "Send full-screen notifications" screen for our app
      try {
        await IntentLauncher.startActivityAsync(
          'android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT',
          { data: 'package:com.abucay.guardian' }
        );
        return;
      } catch {}

      // 2. Target "Send full-screen notifications" list under Special App Access
      try {
        await IntentLauncher.startActivityAsync(
          'android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT'
        );
        return;
      } catch {}

      // 3. Fallback: Open Special App Access
      const opened = await openSpecialAppAccess();
      if (!opened) {
        Alert.alert(
          '🚨 Send Full-Screen Notifications',
          'Under Special App Access:\n\n1. In Settings, go to Apps → Special app access.\n2. Tap "Send full-screen notifications".\n3. Switch the toggle ON for Abucay Guardian.',
          [
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
            { text: 'Got It', style: 'cancel' },
          ]
        );
      }
    }
  };

  // Sequential 1-Tap Quick Setup
  const handleQuickGrant = async () => {
    await handleRequestNotifications();
    await handleRequestLocation();
    await handleRequestActivity();
    handleRequestBattery();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Top Banner Header */}
      <View style={styles.header}>
        {isSettingsMode && (
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onComplete}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        )}
        <View style={styles.shieldBadge}>
          <Ionicons name="shield-checkmark" size={32} color="#FFFFFF" />
        </View>
        <Text style={styles.title}>
          {isSettingsMode ? 'Emergency App Permissions' : 'Emergency Protection Setup'}
        </Text>
        <Text style={styles.subtitle}>
          {isSettingsMode
            ? 'Review and manage your system permissions, background activity, and special app access settings below.'
            : 'Abucay Guardian protects your life and family circle 24/7. To wake your phone and sound sirens during typhoons, earthquakes, and SOS alerts, configure the permissions below:'}
        </Text>

        <TouchableOpacity
          style={styles.quickGrantBtn}
          onPress={handleQuickGrant}
          activeOpacity={0.8}
        >
          <Ionicons name="flash" size={18} color="#FFFFFF" />
          <Text style={styles.quickGrantText}>⚡ Grant Standard Permissions (1-Tap)</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* SECTION 1: CORE APP PERMISSIONS */}
        <View style={styles.sectionHeader}>
          <Ionicons name="key" size={16} color={Colors.secondary} />
          <Text style={styles.sectionTitle}>1. CORE DEVICE PERMISSIONS</Text>
        </View>

        {/* 1. Notification */}
        <View style={styles.card}>
          <View style={[styles.iconCircle, { backgroundColor: '#FEE2E2' }]}>
            <Ionicons name="notifications" size={22} color="#DC2626" />
          </View>
          <View style={styles.cardBody}>
            <View style={styles.tagRow}>
              <Text style={styles.cardTitle}>1. Notifications</Text>
              <View style={[styles.subBadge, { backgroundColor: '#F1F5F9' }]}>
                <Text style={styles.subBadgeText}>Under Permissions</Text>
              </View>
            </View>
            <Text style={styles.cardDesc}>
              Allows high-volume sirens, heads-up warning banners, and NDRRMC safety check-in alerts.
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.actionBtn, notificationGranted && styles.actionBtnDone]}
            onPress={handleRequestNotifications}
            activeOpacity={0.8}
          >
            <Ionicons
              name={notificationGranted ? 'checkmark-circle' : 'chevron-forward'}
              size={18}
              color={notificationGranted ? '#16A34A' : '#FFFFFF'}
            />
            <Text style={[styles.actionBtnText, notificationGranted && styles.actionBtnDoneText]}>
              {notificationGranted ? 'Allowed' : 'Enable'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 2. Location */}
        <View style={styles.card}>
          <View style={[styles.iconCircle, { backgroundColor: '#DCFCE7' }]}>
            <Ionicons name="location" size={22} color="#16A34A" />
          </View>
          <View style={styles.cardBody}>
            <View style={styles.tagRow}>
              <Text style={styles.cardTitle}>2. Location</Text>
              <View style={[styles.subBadge, { backgroundColor: '#F1F5F9' }]}>
                <Text style={styles.subBadgeText}>Under Permissions</Text>
              </View>
            </View>
            <Text style={styles.cardDesc}>
              Required for family live tracking and broadcasting your coordinates when SOS is triggered.
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.actionBtn, locationGranted && styles.actionBtnDone]}
            onPress={handleRequestLocation}
            activeOpacity={0.8}
          >
            <Ionicons
              name={locationGranted ? 'checkmark-circle' : 'chevron-forward'}
              size={18}
              color={locationGranted ? '#16A34A' : '#FFFFFF'}
            />
            <Text style={[styles.actionBtnText, locationGranted && styles.actionBtnDoneText]}>
              {locationGranted ? 'Allowed' : 'Enable'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 3. Physical Activity */}
        <View style={styles.card}>
          <View style={[styles.iconCircle, { backgroundColor: '#E0E7FF' }]}>
            <Ionicons name="fitness" size={22} color="#4F46E5" />
          </View>
          <View style={styles.cardBody}>
            <View style={styles.tagRow}>
              <Text style={styles.cardTitle}>3. Physical Activity</Text>
              <View style={[styles.subBadge, { backgroundColor: '#F1F5F9' }]}>
                <Text style={styles.subBadgeText}>Under Permissions</Text>
              </View>
            </View>
            <Text style={styles.cardDesc}>
              Detects stationary motion to intelligently preserve battery life when you are not moving.
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.actionBtn, activityGranted && styles.actionBtnDone]}
            onPress={handleRequestActivity}
            activeOpacity={0.8}
          >
            <Ionicons
              name={activityGranted ? 'checkmark-circle' : 'chevron-forward'}
              size={18}
              color={activityGranted ? '#16A34A' : '#FFFFFF'}
            />
            <Text style={[styles.actionBtnText, activityGranted && styles.actionBtnDoneText]}>
              {activityGranted ? 'Allowed' : 'Enable'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* SECTION 2: BATTERY & BACKGROUND */}
        <View style={[styles.sectionHeader, { marginTop: Spacing.md }]}>
          <Ionicons name="battery-charging" size={16} color={Colors.hotline} />
          <Text style={[styles.sectionTitle, { color: Colors.hotline }]}>2. BATTERY & SLEEP OPTIMIZATION</Text>
        </View>

        {/* 4. Allow Background Activity */}
        <View style={styles.card}>
          <View style={[styles.iconCircle, { backgroundColor: '#FEF3C7' }]}>
            <Ionicons name="battery-full" size={22} color="#D97706" />
          </View>
          <View style={styles.cardBody}>
            <View style={styles.tagRow}>
              <Text style={styles.cardTitle}>4. Background Activity</Text>
              <View style={[styles.subBadge, { backgroundColor: '#FEF3C7' }]}>
                <Text style={[styles.subBadgeText, { color: '#92400E' }]}>Under Battery Usage</Text>
              </View>
            </View>
            <Text style={styles.cardDesc}>
              Prevents Android Doze mode from sleeping your emergency broadcast receiver. Choose "Unrestricted".
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#D97706' }, batteryGranted && styles.actionBtnDone]}
            onPress={handleRequestBattery}
            activeOpacity={0.8}
          >
            <Ionicons
              name={batteryGranted ? 'checkmark-circle' : 'settings-outline'}
              size={17}
              color={batteryGranted ? '#16A34A' : '#FFFFFF'}
            />
            <Text style={[styles.actionBtnText, batteryGranted && styles.actionBtnDoneText]}>
              {batteryGranted ? 'Allowed' : 'Configure'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* SECTION 3: SPECIAL APP ACCESS & OVERLAYS */}
        <View style={[styles.sectionHeader, { marginTop: Spacing.md }]}>
          <Ionicons name="layers" size={16} color="#7C3AED" />
          <Text style={[styles.sectionTitle, { color: '#7C3AED' }]}>3. SPECIAL APP ACCESS & WAKE-UP</Text>
        </View>

        {/* 5. Display Over Other Apps */}
        <View style={styles.card}>
          <View style={[styles.iconCircle, { backgroundColor: '#EDE9FE' }]}>
            <Ionicons name="browsers" size={22} color="#7C3AED" />
          </View>
          <View style={styles.cardBody}>
            <View style={styles.tagRow}>
              <Text style={styles.cardTitle}>5. Display Over Apps</Text>
              <View style={[styles.subBadge, { backgroundColor: '#EDE9FE' }]}>
                <Text style={[styles.subBadgeText, { color: '#6D28D9' }]}>Appear on Top</Text>
              </View>
            </View>
            <Text style={styles.cardDesc}>
              Allows the NDRRMC warning box to pop up directly over your home launcher and other apps.
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#7C3AED' }, overlayGranted && styles.actionBtnDone]}
            onPress={handleRequestOverlay}
            activeOpacity={0.8}
          >
            <Ionicons
              name={overlayGranted ? 'checkmark-circle' : 'open-outline'}
              size={17}
              color={overlayGranted ? '#16A34A' : '#FFFFFF'}
            />
            <Text style={[styles.actionBtnText, overlayGranted && styles.actionBtnDoneText]}>
              {overlayGranted ? 'Configured' : 'Open'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 6. Display pop-ups while in background */}
        <View style={styles.card}>
          <View style={[styles.iconCircle, { backgroundColor: '#F0F9FF' }]}>
            <Ionicons name="chatbubbles" size={22} color="#0284C7" />
          </View>
          <View style={styles.cardBody}>
            <View style={styles.tagRow}>
              <Text style={styles.cardTitle}>6. Background Pop-ups</Text>
              <View style={[styles.subBadge, { backgroundColor: '#F0F9FF' }]}>
                <Text style={[styles.subBadgeText, { color: '#0369A1' }]}>Special App Access</Text>
              </View>
            </View>
            <Text style={styles.cardDesc}>
              Settings → Apps → Special app access → Display pop-ups while in background. Allows emergency sirens to launch over other apps.
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#0284C7' }, popupsGranted && styles.actionBtnDone]}
            onPress={handleRequestPopups}
            activeOpacity={0.8}
          >
            <Ionicons
              name={popupsGranted ? 'checkmark-circle' : 'open-outline'}
              size={17}
              color={popupsGranted ? '#16A34A' : '#FFFFFF'}
            />
            <Text style={[styles.actionBtnText, popupsGranted && styles.actionBtnDoneText]}>
              {popupsGranted ? 'Configured' : 'Open'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 7. Send full-screen notifications */}
        <View style={styles.card}>
          <View style={[styles.iconCircle, { backgroundColor: '#FFF1F2' }]}>
            <Ionicons name="alarm" size={22} color="#E11D48" />
          </View>
          <View style={styles.cardBody}>
            <View style={styles.tagRow}>
              <Text style={styles.cardTitle}>7. Full-Screen Alerts</Text>
              <View style={[styles.subBadge, { backgroundColor: '#FFF1F2' }]}>
                <Text style={[styles.subBadgeText, { color: '#BE123C' }]}>Special App Access</Text>
              </View>
            </View>
            <Text style={styles.cardDesc}>
              Settings → Apps → Special app access → Send full-screen notifications. Wakes screen and displays emergency alerts over the lock screen.
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#E11D48' }, fullScreenGranted && styles.actionBtnDone]}
            onPress={handleRequestFullScreen}
            activeOpacity={0.8}
          >
            <Ionicons
              name={fullScreenGranted ? 'checkmark-circle' : 'settings-outline'}
              size={17}
              color={fullScreenGranted ? '#16A34A' : '#FFFFFF'}
            />
            <Text style={[styles.actionBtnText, fullScreenGranted && styles.actionBtnDoneText]}>
              {fullScreenGranted ? 'Configured' : 'Open'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Sticky Bottom Action Bar */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <TouchableOpacity
          style={styles.continueBtn}
          onPress={onComplete}
          activeOpacity={0.85}
        >
          <Text style={styles.continueBtnText}>
            {isSettingsMode ? 'Done & Return to Profile' : 'Continue to Abucay Guardian →'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.bottomHint}>
          You can re-adjust or verify these settings anytime in Profile → App Permissions.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A1535',
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    backgroundColor: '#0D1F4E',
    borderBottomWidth: 1,
    borderBottomColor: '#1A3365',
    alignItems: 'center',
    position: 'relative',
  },
  closeBtn: {
    position: 'absolute',
    top: Spacing.md,
    right: Spacing.md,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shieldBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 12,
    color: '#CBD5E1',
    lineHeight: 17,
    textAlign: 'center',
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.xs,
  },
  quickGrantBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563EB',
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: 8,
    width: '100%',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
  quickGrantText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: Spacing.sm,
    paddingLeft: Spacing.xs,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.secondary,
    letterSpacing: 0.8,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: BorderRadius.lg,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3,
    flexWrap: 'wrap',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  subBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  subBadgeText: {
    fontSize: 9.5,
    fontWeight: '600',
    color: '#475569',
  },
  cardDesc: {
    fontSize: 11.5,
    color: '#64748B',
    lineHeight: 15,
  },
  actionBtn: {
    backgroundColor: Colors.secondary,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  actionBtnDone: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  actionBtnDoneText: {
    color: '#16A34A',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingHorizontal: Spacing.lg,
    paddingTop: 12,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 10,
  },
  continueBtn: {
    backgroundColor: '#16A34A',
    width: '100%',
    paddingVertical: 14,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 5,
  },
  continueBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  bottomHint: {
    color: '#94A3B8',
    fontSize: 10.5,
    marginTop: 6,
    textAlign: 'center',
  },
});
