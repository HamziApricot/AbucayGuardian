import React, { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Vibration,
  Platform,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface NDRRMCEmergencyAlertData {
  alertType: 'loud_ping' | 'checkin';
  fromName: string;
  fromAvatar?: string | null;
  fromLat?: number;
  fromLng?: number;
  timestamp?: string;
}

interface NDRRMCEmergencyModalProps {
  visible: boolean;
  alertData: NDRRMCEmergencyAlertData | null;
  onConfirmSafe: () => void;
  onTriggerSOS: () => void;
  onDismiss: () => void;
}

export const NDRRMCEmergencyModal: React.FC<NDRRMCEmergencyModalProps> = ({
  visible,
  alertData,
  onConfirmSafe,
  onTriggerSOS,
  onDismiss,
}) => {
  // Pulsing siren beacon animation
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    if (visible) {
      // 1. Continuous emergency siren vibration (alternating NDRRMC cadence)
      // Pattern: wait 0ms, vibrate 600ms, wait 200ms, vibrate 600ms, wait 200ms, vibrate 1000ms
      Vibration.vibrate([0, 600, 200, 600, 200, 1000, 300, 1000], true);

      // 2. Loop pulsing siren beacon
      const pulseLoop = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(pulseAnim, {
              toValue: 1.15,
              duration: 450,
              useNativeDriver: true,
            }),
            Animated.timing(glowAnim, {
              toValue: 1,
              duration: 450,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(pulseAnim, {
              toValue: 1,
              duration: 450,
              useNativeDriver: true,
            }),
            Animated.timing(glowAnim, {
              toValue: 0.35,
              duration: 450,
              useNativeDriver: true,
            }),
          ]),
        ])
      );
      pulseLoop.start();

      return () => {
        Vibration.cancel();
        pulseLoop.stop();
      };
    } else {
      Vibration.cancel();
    }
  }, [visible]);

  if (!visible || !alertData) return null;

  const isLoudPing = alertData.alertType === 'loud_ping';
  const title = isLoudPing ? 'LOUD EMERGENCY PING' : 'ARE YOU SAFE?';
  const subtitle = isLoudPing ? 'CRITICAL HIGH-VOLUME AUDIBLE ALERT' : 'URGENT SAFETY CHECK-IN REQUEST';

  const handleSafe = () => {
    Vibration.cancel();
    onConfirmSafe();
  };

  const handleSOS = () => {
    Vibration.cancel();
    onTriggerSOS();
  };

  const handleDismiss = () => {
    Vibration.cancel();
    onDismiss();
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      statusBarTranslucent={true}
      onRequestClose={handleDismiss}
    >
      <View style={styles.overlay}>
        <View style={styles.alertCard}>
          {/* Header Hazard Banner (NDRRMC Style) */}
          <View style={styles.hazardHeader}>
            <View style={styles.hazardTopRow}>
              <View style={styles.hazardTag}>
                <Text style={styles.hazardTagText}>⚠️ NDRRMC PROTOCOL</Text>
              </View>
              <Text style={styles.hazardTime}>
                {alertData.timestamp || 'CRITICAL PRIORITY'}
              </Text>
            </View>
            <Text style={styles.hazardMainTitle}>EMERGENCY ALERT</Text>
            <Text style={styles.hazardSubTitle}>ABUCAY GUARDIAN SAFETY BROADCAST</Text>
          </View>

          {/* Main Content Area */}
          <View style={styles.contentBody}>
            {/* Pulsing Siren Beacon Icon */}
            <View style={styles.sirenContainer}>
              <Animated.View
                style={[
                  styles.sirenGlowRing,
                  {
                    transform: [{ scale: pulseAnim }],
                    opacity: glowAnim,
                    backgroundColor: isLoudPing ? '#EF4444' : '#F97316',
                  },
                ]}
              />
              <View
                style={[
                  styles.sirenCenterCircle,
                  { backgroundColor: isLoudPing ? '#DC2626' : '#EA580C' },
                ]}
              >
                <Ionicons
                  name={isLoudPing ? 'volume-high' : 'alert-circle'}
                  size={36}
                  color="#FFFFFF"
                />
              </View>
            </View>

            {/* Alert Headings */}
            <Text style={styles.alertHeadline}>{title}</Text>
            <Text style={styles.alertSubHeadline}>{subtitle}</Text>

            {/* Sender Identification Card */}
            <View style={styles.senderCard}>
              {alertData.fromAvatar ? (
                <Image source={{ uri: alertData.fromAvatar }} style={styles.senderAvatar} />
              ) : (
                <View style={styles.senderAvatarFallback}>
                  <Text style={styles.senderInitial}>
                    {alertData.fromName.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={styles.senderInfo}>
                <Text style={styles.senderFromLabel}>REQUESTED BY</Text>
                <Text style={styles.senderName}>{alertData.fromName}</Text>
                <Text style={styles.senderRole}>Verified Family Circle Member</Text>
              </View>
            </View>

            {/* Emergency Warning Notice Box */}
            <View style={styles.warningNoticeBox}>
              <Ionicons name="information-circle" size={20} color="#F59E0B" style={styles.noticeIcon} />
              <Text style={styles.warningNoticeText}>
                {isLoudPing
                  ? `${alertData.fromName} triggered an urgent alarm on your device. Please verify you are safe immediately.`
                  : `${alertData.fromName} is requesting your real-time safety status. Tap below to confirm you are safe.`}
              </Text>
            </View>

            {/* Action Buttons */}
            <View style={styles.actionsContainer}>
              {/* Primary: I Am Safe */}
              <TouchableOpacity
                style={styles.safeButton}
                onPress={handleSafe}
                activeOpacity={0.85}
              >
                <Ionicons name="shield-checkmark" size={24} color="#FFFFFF" />
                <View style={styles.btnTextContainer}>
                  <Text style={styles.safeButtonText}>I AM SAFE</Text>
                  <Text style={styles.safeButtonSub}>Confirm status • Stop alarm</Text>
                </View>
              </TouchableOpacity>

              {/* Secondary Emergency: Need Help (SOS) */}
              <TouchableOpacity
                style={styles.sosButton}
                onPress={handleSOS}
                activeOpacity={0.85}
              >
                <Ionicons name="alert-circle" size={22} color="#FFFFFF" />
                <View style={styles.btnTextContainer}>
                  <Text style={styles.sosButtonText}>NEED HELP (TRIGGER SOS)</Text>
                  <Text style={styles.sosButtonSub}>Broadcast emergency distress</Text>
                </View>
              </TouchableOpacity>

              {/* Dismiss / Silence Button */}
              <TouchableOpacity
                style={styles.dismissButton}
                onPress={handleDismiss}
                activeOpacity={0.7}
              >
                <Ionicons name="volume-mute-outline" size={18} color="#94A3B8" />
                <Text style={styles.dismissButtonText}>Dismiss / Silence Siren</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 999999,
  },
  alertCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#0F172A', // Slate 900
    borderRadius: 22,
    borderWidth: 3,
    borderColor: '#DC2626', // Red warning border
    overflow: 'hidden',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 25,
    elevation: 25,
  },
  hazardHeader: {
    backgroundColor: '#DC2626',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 2,
    borderBottomColor: '#991B1B',
  },
  hazardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  hazardTag: {
    backgroundColor: '#000000',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  hazardTagText: {
    color: '#FEF08A', // Yellow text
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  hazardTime: {
    color: '#FEE2E2',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  hazardMainTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 1.5,
    textAlign: 'center',
    marginTop: 2,
  },
  hazardSubTitle: {
    color: '#FEF2F2',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textAlign: 'center',
    opacity: 0.9,
    marginTop: 2,
  },
  contentBody: {
    padding: 22,
    alignItems: 'center',
  },
  sirenContainer: {
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  sirenGlowRing: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  sirenCenterCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 6,
  },
  alertHeadline: {
    fontSize: 22,
    fontWeight: '900',
    color: '#F8FAFC',
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 2,
  },
  alertSubHeadline: {
    fontSize: 11,
    fontWeight: '800',
    color: '#EF4444',
    letterSpacing: 0.8,
    textAlign: 'center',
    marginBottom: 16,
  },
  senderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    width: '100%',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 14,
  },
  senderAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2,
    borderColor: '#38BDF8',
  },
  senderAvatarFallback: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  senderInitial: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  senderInfo: {
    marginLeft: 12,
    flex: 1,
  },
  senderFromLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  senderName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  senderRole: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '600',
  },
  warningNoticeBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    borderRadius: 10,
    padding: 12,
    width: '100%',
    marginBottom: 20,
  },
  noticeIcon: {
    marginRight: 10,
    marginTop: 1,
  },
  warningNoticeText: {
    color: '#FDE68A',
    fontSize: 12,
    lineHeight: 18,
    flex: 1,
    fontWeight: '500',
  },
  actionsContainer: {
    width: '100%',
    gap: 10,
  },
  safeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#16A34A', // Emerald Green
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  btnTextContainer: {
    marginLeft: 10,
    alignItems: 'flex-start',
  },
  safeButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  safeButtonSub: {
    color: '#DCFCE7',
    fontSize: 11,
    fontWeight: '600',
  },
  sosButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DC2626', // Crimson Red
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
  },
  sosButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  sosButtonSub: {
    color: '#FEE2E2',
    fontSize: 10,
    fontWeight: '600',
  },
  dismissButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    marginTop: 4,
  },
  dismissButtonText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 6,
  },
});

