import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Colors, BorderRadius, Spacing } from '../constants/theme';
import {
  type CrashReadinessStatus,
  getCrashReadinessStatus,
  setCrashDetectionEnabled,
  simulateCrashDetection,
} from '../services/CrashDetectionService';
import { openBatteryOptimizationSettings } from '../services/EmergencyAudioService';

interface CrashDetectionSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  onOpenPermissions?: () => void;
}

export const CrashDetectionSettingsModal: React.FC<CrashDetectionSettingsModalProps> = ({
  visible,
  onClose,
  onOpenPermissions,
}) => {
  const [status, setStatus] = useState<CrashReadinessStatus | null>(null);
  const [testing, setTesting] = useState(false);

  const refreshStatus = async () => {
    const next = await getCrashReadinessStatus();
    setStatus(next);
  };

  useEffect(() => {
    if (visible) {
      refreshStatus();
    }
  }, [visible]);

  const handleToggle = async (val: boolean) => {
    setStatus((prev) => (prev ? { ...prev, enabled: val } : prev));
    await setCrashDetectionEnabled(val);
    setTimeout(refreshStatus, 400);
  };

  const handleTestAlert = async () => {
    if (testing) return;
    setTesting(true);
    try {
      let lat = 0;
      let lng = 0;
      try {
        const last = await Location.getLastKnownPositionAsync();
        if (last?.coords) {
          lat = last.coords.latitude;
          lng = last.coords.longitude;
        }
      } catch {}
      onClose();
      await simulateCrashDetection(lat, lng);
    } finally {
      setTesting(false);
    }
  };

  const renderConditionRow = (
    ok: boolean,
    title: string,
    detail: string,
    actionLabel?: string,
    onAction?: () => void
  ) => (
    <View style={styles.condRow}>
      <Ionicons
        name={ok ? 'checkmark-circle' : 'alert-circle'}
        size={18}
        color={ok ? '#16A34A' : '#D97706'}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.condTitle}>{title}</Text>
        <Text style={styles.condSub}>{detail}</Text>
      </View>
      {!ok && actionLabel && onAction && (
        <TouchableOpacity style={styles.fixBtn} onPress={onAction}>
          <Text style={styles.fixBtnText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <View style={styles.headerIcon}>
                <Ionicons name="car-sport" size={20} color="#DC2626" />
              </View>
              <View>
                <Text style={styles.title}>Car Crash Detection</Text>
                <Text style={styles.subTitle}>
                  GPS speed gate + G-force & gyroscope fusion
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={Colors.textLight} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
            <View style={styles.toggleCard}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={styles.toggleTitle}>Automatic Crash Detection</Text>
                <Text style={styles.toggleSub}>
                  Arms automatically above 40 km/h (25 mph) and checks in if a severe
                  collision & sudden stop are detected.
                </Text>
              </View>
              <Switch
                value={status?.enabled ?? true}
                onValueChange={handleToggle}
                trackColor={{ false: '#CBD5E1', true: '#DC2626' }}
                thumbColor="#FFFFFF"
              />
            </View>

            <Text style={styles.sectionHeader}>HOW SENSOR FUSION WORKS</Text>
            <View style={styles.pipelineCard}>
              <Text style={styles.pipelineStep}>
                1. <Text style={styles.bold}>Speed Gating</Text>: Arms only after
                reaching ≥40 km/h (25 mph) within 5s prior to impact (prevents phone-drop
                false alarms).
              </Text>
              <Text style={styles.pipelineStep}>
                2. <Text style={styles.bold}>Impact + Rotation</Text>: Pairs ≥4.0G
                linear deceleration with gyroscope rotation dynamics & post-impact
                stationary check.
              </Text>
              <Text style={styles.pipelineStep}>
                3. <Text style={styles.bold}>30s Check-In</Text>: Alarms loudly asking
                &quot;Are you okay?&quot;—if unresponded, auto-sends SOS & SMS with GPS.
              </Text>
            </View>

            <Text style={styles.sectionHeader}>REQUIRED DEVICE CONDITIONS</Text>
            <View style={styles.conditionsCard}>
              {renderConditionRow(
                Boolean(status?.hasAlwaysLocation),
                'Location: Always Allowed',
                status?.hasAlwaysLocation
                  ? 'Background vehicle speed tracking enabled'
                  : 'Set Location permission to "Allow all the time"',
                'Grant',
                () => {
                  onClose();
                  onOpenPermissions?.();
                }
              )}
              {renderConditionRow(
                Boolean(status?.hasActivityRecognition),
                'Physical Activity Access',
                status?.hasActivityRecognition
                  ? 'Vehicle motion activity permitted'
                  : 'Required to distinguish driving vs walking',
                'Grant',
                () => {
                  onClose();
                  onOpenPermissions?.();
                }
              )}
              {renderConditionRow(
                Boolean(
                  status?.batteryAbove10 &&
                    !status?.powerSaveMode &&
                    status?.ignoringBatteryOptimization
                ),
                `Battery & Power (${status?.batteryPct ?? 100}%)`,
                !status?.batteryAbove10
                  ? 'Battery ≤10%: sensor paused to preserve power'
                  : status?.powerSaveMode
                  ? 'Disable Battery Saver mode for full sensor rate'
                  : !status?.ignoringBatteryOptimization
                  ? 'Set Abucay Guardian battery usage to Unrestricted'
                  : 'Above 10%, Power Saver off, Unrestricted',
                'Fix',
                async () => {
                  await openBatteryOptimizationSettings();
                  setTimeout(refreshStatus, 500);
                }
              )}
              {renderConditionRow(
                Boolean(status?.hasAccelerometer),
                `Crash Sensors${status?.hasGyroscope ? ' (Accel + Gyro)' : ' (Accel only)'}`,
                status?.hasGyroscope
                  ? 'Hardware accelerometer and gyroscope available'
                  : 'Accelerometer active (gyroscope not present on device)'
              )}
              {renderConditionRow(
                Boolean(status?.hasNetwork),
                'Mobile Data / Network Signal',
                status?.hasNetwork
                  ? 'Connected for instant SOS & SMS escalation'
                  : 'No internet signal (SIM Direct SMS fallback still active)'
              )}
            </View>
          </ScrollView>

          <TouchableOpacity
            style={styles.testBtn}
            onPress={handleTestAlert}
            disabled={testing}
            activeOpacity={0.85}
          >
            <Ionicons name="flask-outline" size={18} color={Colors.white} />
            <Text style={styles.testBtnText}>Test Crash Check-In Alert</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(13, 31, 78, 0.72)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: Spacing.lg,
    paddingBottom: 28,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.text,
  },
  subTitle: {
    fontSize: 11.5,
    color: Colors.textLight,
    fontWeight: '600',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    padding: 14,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: '#FECACA',
    marginBottom: 14,
  },
  toggleTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 2,
  },
  toggleSub: {
    fontSize: 11.5,
    color: '#64748B',
    lineHeight: 16,
  },
  sectionHeader: {
    fontSize: 10.5,
    fontWeight: '800',
    color: Colors.textLight,
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  pipelineCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: BorderRadius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 6,
    marginBottom: 14,
  },
  pipelineStep: {
    fontSize: 12,
    lineHeight: 17,
    color: '#334155',
  },
  bold: {
    fontWeight: '800',
    color: Colors.secondary,
  },
  conditionsCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: BorderRadius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
    marginBottom: 16,
  },
  condRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  condTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: Colors.text,
  },
  condSub: {
    fontSize: 11,
    color: '#64748B',
  },
  fixBtn: {
    backgroundColor: Colors.secondary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  fixBtnText: {
    color: Colors.white,
    fontSize: 11,
    fontWeight: '800',
  },
  testBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.secondary,
    paddingVertical: 13,
    borderRadius: BorderRadius.md,
  },
  testBtnText: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: '800',
  },
});
