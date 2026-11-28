import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Vibration,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, BorderRadius, Spacing } from '../constants/theme';
import {
  playEmergencyAlarmAudio,
  stopEmergencyAlarmAudio,
} from '../services/EmergencyAudioService';
import {
  type CrashDetectionEvent,
  confirmUserSafeFromCrash,
  escalateCrashNow,
} from '../services/CrashDetectionService';

interface CrashCheckInModalProps {
  visible: boolean;
  crashEvent: CrashDetectionEvent | null;
  onDismiss: () => void;
}

export const CrashCheckInModal: React.FC<CrashCheckInModalProps> = ({
  visible,
  crashEvent,
  onDismiss,
}) => {
  const [secondsLeft, setSecondsLeft] = useState(30);
  const [busy, setBusy] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible || !crashEvent) {
      stopEmergencyAlarmAudio().catch(() => {});
      Vibration.cancel();
      return;
    }

    setBusy(false);
    playEmergencyAlarmAudio('alert', true).catch(() => {});
    if (Platform.OS === 'android') {
      Vibration.vibrate([0, 600, 300, 600], true);
    }

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();

    const updateTimer = () => {
      const remaining = Math.max(
        0,
        Math.ceil((crashEvent.expiresAtMs - Date.now()) / 1000)
      );
      setSecondsLeft(remaining);
    };
    updateTimer();
    const interval = setInterval(updateTimer, 250);

    return () => {
      clearInterval(interval);
      pulseLoop.stop();
      stopEmergencyAlarmAudio().catch(() => {});
      Vibration.cancel();
    };
  }, [visible, crashEvent?.crashId]);

  if (!visible || !crashEvent) return null;

  const totalSecs = crashEvent.countdownSeconds || 30;
  const progressPct = Math.max(0, Math.min(100, (secondsLeft / totalSecs) * 100));

  const handleImOkay = async () => {
    if (busy) return;
    setBusy(true);
    await confirmUserSafeFromCrash();
    onDismiss();
  };

  const handleEscalateNow = async () => {
    if (busy) return;
    setBusy(true);
    await escalateCrashNow();
    onDismiss();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleImOkay}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Animated.View
            style={[styles.iconHalo, { transform: [{ scale: pulseAnim }] }]}
          >
            <View style={styles.iconCircle}>
              <Ionicons name="car-sport" size={34} color={Colors.white} />
            </View>
          </Animated.View>

          {crashEvent.isSimulated && (
            <View style={styles.simPill}>
              <Text style={styles.simPillText}>SIMULATED TEST ALERT</Text>
            </View>
          )}

          <Text style={styles.alertTag}>POSSIBLE CAR CRASH DETECTED</Text>
          <Text style={styles.title}>Are You Okay?</Text>
          <Text style={styles.subtitle}>
            We detected a high-speed sudden stop & impact signature. If you do not
            respond, your family and emergency contacts will be alerted automatically.
          </Text>

          {/* Sensor Fusion Telemetry Row */}
          <View style={styles.telemetryRow}>
            <View style={styles.telemetryChip}>
              <Ionicons name="speedometer-outline" size={14} color="#CBD5E1" />
              <Text style={styles.telemetryText}>
                {crashEvent.preImpactSpeedKmh.toFixed(0)} km/h
              </Text>
            </View>
            <View style={styles.telemetryChip}>
              <Ionicons name="pulse-outline" size={14} color="#FCA5A5" />
              <Text style={styles.telemetryText}>
                {crashEvent.peakGForce.toFixed(1)} G
              </Text>
            </View>
            <View style={styles.telemetryChip}>
              <Ionicons name="sync-outline" size={14} color="#93C5FD" />
              <Text style={styles.telemetryText}>
                {crashEvent.peakGyroRadSec.toFixed(1)} rad/s
              </Text>
            </View>
          </View>

          {/* 30-second Auto-Escalation Countdown */}
          <View style={styles.countdownBox}>
            <View style={styles.countdownHeader}>
              <Text style={styles.countdownLabel}>Sending Emergency SOS in</Text>
              <Text style={styles.countdownSeconds}>{secondsLeft}s</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
            </View>
          </View>

          <TouchableOpacity
            style={styles.safeBtn}
            onPress={handleImOkay}
            disabled={busy}
            activeOpacity={0.85}
          >
            <Ionicons name="checkmark-circle" size={22} color={Colors.white} />
            <Text style={styles.safeBtnText}>I&apos;M OK — Cancel Alert</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.sosBtn}
            onPress={handleEscalateNow}
            disabled={busy}
            activeOpacity={0.85}
          >
            <Ionicons name="warning" size={20} color={Colors.white} />
            <Text style={styles.sosBtnText}>Send Emergency SOS Now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 15, 32, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#111827',
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#DC2626',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 16,
  },
  iconHalo: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: 'rgba(220, 38, 38, 0.24)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  iconCircle: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#DC2626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  simPill: {
    backgroundColor: '#F59E0B',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    marginBottom: 8,
  },
  simPillText: {
    color: '#111827',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  alertTag: {
    fontSize: 11,
    fontWeight: '900',
    color: '#FCA5A5',
    letterSpacing: 1.1,
    marginBottom: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: Colors.white,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: '#CBD5E1',
    textAlign: 'center',
    marginBottom: 14,
  },
  telemetryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  telemetryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
  },
  telemetryText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
  },
  countdownBox: {
    width: '100%',
    backgroundColor: '#1F2937',
    borderRadius: BorderRadius.md,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#374151',
  },
  countdownHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  countdownLabel: {
    color: '#E2E8F0',
    fontSize: 12.5,
    fontWeight: '700',
  },
  countdownSeconds: {
    color: '#FCA5A5',
    fontSize: 20,
    fontWeight: '900',
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#374151',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#EF4444',
    borderRadius: 4,
  },
  safeBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#16A34A',
    paddingVertical: 15,
    borderRadius: BorderRadius.md,
    marginBottom: 10,
  },
  safeBtnText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '900',
  },
  sosBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#DC2626',
    paddingVertical: 13,
    borderRadius: BorderRadius.md,
  },
  sosBtnText: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: '800',
  },
});
