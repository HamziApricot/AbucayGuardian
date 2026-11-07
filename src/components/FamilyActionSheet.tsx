import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Animated,
  Vibration,
  Linking,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius } from '../constants/theme';
import type { FamilyMember3D } from './FamilyMap3D';
import { triggerTestNDRRMCAlert } from '../services/EmergencyNotificationService';

interface FamilyActionSheetProps {
  member: FamilyMember3D & {
    relationship?: string;
    phone?: string;
  };
  isSelf: boolean;
  isOnline: boolean;
  isLocalOnline: boolean;
  myLocation: { lat: number; lng: number } | null;
  userBattery: number;
  onClose: () => void;
  onCheckIn: (member: FamilyMember3D) => void;
  onSendSMSCheckIn: (member: FamilyMember3D) => void;
  onNavigateToMember: (member: FamilyMember3D) => void;
  onCallMember: (phone: string, name: string) => void;
  onSendOfflineSMS: (phone: string, name: string) => void;
  onLoudPing: (member: FamilyMember3D) => void;
  onTriggerSOS: () => void;
  onMarkSafe: () => void;
  isMarkedSafe: boolean;
}

export const FamilyActionSheet: React.FC<FamilyActionSheetProps> = ({
  member,
  isSelf,
  isOnline,
  isLocalOnline,
  myLocation,
  userBattery,
  onClose,
  onCheckIn,
  onSendSMSCheckIn,
  onNavigateToMember,
  onCallMember,
  onSendOfflineSMS,
  onLoudPing,
  onTriggerSOS,
  onMarkSafe,
  isMarkedSafe,
}) => {
  // SOS 3-Second Hold Animation State
  const [sosHolding, setSosHolding] = useState(false);
  const [sosCountdown, setSosCountdown] = useState(3);
  const sosProgressAnim = useRef(new Animated.Value(0)).current;
  const isHoldingRef = useRef(false);
  const countdownIntervalRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, []);

  const handleSosPressIn = () => {
    isHoldingRef.current = true;
    setSosHolding(true);
    setSosCountdown(3);
    Vibration.vibrate(60);

    let currentSec = 3;
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    countdownIntervalRef.current = setInterval(() => {
      currentSec -= 1;
      if (currentSec > 0) {
        setSosCountdown(currentSec);
        Vibration.vibrate(60);
      } else {
        clearInterval(countdownIntervalRef.current);
      }
    }, 1000);

    sosProgressAnim.setValue(0);
    Animated.timing(sosProgressAnim, {
      toValue: 1,
      duration: 3000,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished && isHoldingRef.current) {
        setSosHolding(false);
        Vibration.vibrate([0, 400, 150, 400, 150, 800]);
        onTriggerSOS();
      }
    });
  };

  const handleSosPressOut = () => {
    if (!isHoldingRef.current) return;
    isHoldingRef.current = false;
    setSosHolding(false);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    sosProgressAnim.stopAnimation();
    Animated.timing(sosProgressAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  };

  // Smart Offline Determination:
  // If either the targeted member is offline OR local device has no internet
  const useCellularFallback = !isOnline || !isLocalOnline;

  const memberColor = member.color || Colors.tracker;
  const memberPhone = member.phone || '';

  return (
    <View style={styles.sheetContainer}>
      {/* Top Header Card: Member Profile Summary & Dismiss Button */}
      <View style={styles.headerRow}>
        <View style={styles.profileLeft}>
          <View style={[styles.avatarRing, { borderColor: memberColor }]}>
            {member.avatarUrl ? (
              <Image source={{ uri: member.avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatarFallback, { backgroundColor: memberColor }]}>
                <Text style={styles.avatarInitial}>
                  {member.name ? member.name.charAt(0).toUpperCase() : '?'}
                </Text>
              </View>
            )}
            <View
              style={[
                styles.headerStatusDot,
                { backgroundColor: isOnline ? '#22C55E' : '#94A3B8' },
              ]}
            />
          </View>

          <View style={styles.headerInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.headerName} numberOfLines={1}>
                {member.name} {isSelf ? '(You)' : ''}
              </Text>
              {member.relationship && !isSelf && (
                <View style={styles.relationshipBadge}>
                  <Text style={styles.relationshipText}>{member.relationship}</Text>
                </View>
              )}
            </View>

            {/* Status Pill */}
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusMiniDot,
                  { backgroundColor: isOnline ? '#22C55E' : '#F59E0B' },
                ]}
              />
              <Text style={styles.headerStatusText}>
                {isSelf
                  ? `Battery ${userBattery > 0 ? `${Math.round(userBattery * 100)}%` : 'Active'} • Live GPS (±${Math.round(member.accuracy || 5)}m)`
                  : isOnline
                  ? `Online${member.batteryLevel != null && member.batteryLevel > 0 ? ` • ${Math.round(member.batteryLevel * 100)}% battery` : ''} • ${
                      member.speed > 1 ? `${Math.round(member.speed * 3.6)} km/h` : 'Stationary'
                    } • ±${Math.round(member.accuracy || 5)}m GPS`
                  : `Offline • Last known: ${member.lastUpdated ? new Date(member.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Unknown'}`}
              </Text>
            </View>
          </View>
        </View>

        {/* Close Button to return to All Family Overview */}
        <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
          <Ionicons name="close" size={20} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* ========================================================================= */}
      {/* CASE A: ANOTHER FAMILY MEMBER SELECTED (4 Primary Emergency Actions)      */}
      {/* ========================================================================= */}
      {!isSelf ? (
        <View style={styles.actionsContainer}>
          {/* Action 1: Ask "Are You Safe?" Hero Action */}
          <TouchableOpacity
            style={[styles.primaryHeroBtn, styles.heroBtnOnline]}
            onPress={() => onCheckIn(member)}
            activeOpacity={0.8}
          >
            <View style={styles.heroBtnContent}>
              <View style={[styles.heroIconCircle, { backgroundColor: '#2563EB' }]}>
                <Ionicons name="help-buoy" size={22} color="#FFFFFF" />
              </View>
              <View style={styles.heroTextCol}>
                <View style={styles.heroTitleRow}>
                  <Text style={styles.heroTitle}>Ask "Are You Safe?"</Text>
                  <View style={styles.livePushBadge}>
                    <Text style={styles.livePushBadgeText}>{isOnline ? 'LIVE PUSH' : 'HIGH PRIORITY'}</Text>
                  </View>
                </View>
                <Text style={styles.heroSub}>
                  Sends 1-tap "I'm Safe" or "Need Help" prompt to their screen.
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#2563EB" />
          </TouchableOpacity>

          {/* Action 2, 3, 4: Quick Action Grid */}
          <View style={styles.actionGrid}>
            {/* Action 2: Navigate to Member */}
            <TouchableOpacity
              style={styles.gridActionItem}
              onPress={() => onNavigateToMember(member)}
              activeOpacity={0.75}
            >
              <View style={[styles.gridIconCircle, { backgroundColor: '#ECFDF5' }]}>
                <Ionicons name="navigate" size={22} color="#10B981" />
              </View>
              <Text style={styles.gridActionTitle}>Navigate</Text>
              <Text style={styles.gridActionSub}>Turn-by-turn route</Text>
            </TouchableOpacity>

            {/* Action 3: Direct Call / Offline SMS */}
            <TouchableOpacity
              style={styles.gridActionItem}
              onPress={() => {
                if (!memberPhone) {
                  Alert.alert('No Phone Listed', `${member.name} has no phone number on file.`);
                  return;
                }
                Alert.alert(
                  `Contact ${member.name}`,
                  `Phone: ${memberPhone}\nChoose communication channel for power/network outage:`,
                  [
                    {
                      text: 'Voice Call',
                      onPress: () => onCallMember(memberPhone, member.name),
                    },
                    {
                      text: 'Emergency SMS',
                      onPress: () => onSendOfflineSMS(memberPhone, member.name),
                    },
                    { text: 'Cancel', style: 'cancel' },
                  ]
                );
              }}
              activeOpacity={0.75}
            >
              <View style={[styles.gridIconCircle, { backgroundColor: '#F0F9FF' }]}>
                <Ionicons name="call" size={22} color="#0284C7" />
              </View>
              <Text style={styles.gridActionTitle}>Call / SMS</Text>
              <Text style={styles.gridActionSub}>Cellular fallback</Text>
            </TouchableOpacity>

            {/* Action 4: Loud Ping */}
            <TouchableOpacity
              style={styles.gridActionItem}
              onPress={() => onLoudPing(member)}
              activeOpacity={0.75}
            >
              <View style={[styles.gridIconCircle, { backgroundColor: '#FFF1F2' }]}>
                <Ionicons name="volume-high" size={22} color="#E11D48" />
              </View>
              <Text style={styles.gridActionTitle}>Loud Ping</Text>
              <Text style={styles.gridActionSub}>Ring at max volume</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        /* ========================================================================= */
        /* CASE B: YOUR OWN PIN SELECTED (Self-Status Emergency Actions)             */
        /* ========================================================================= */
        <View style={styles.actionsContainer}>
          {/* Action 1: Hold for SOS (3-Second Press with Progress Bar) */}
          <View style={styles.sosContainer}>
            <TouchableOpacity
              style={styles.sosButton}
              onPressIn={handleSosPressIn}
              onPressOut={handleSosPressOut}
              activeOpacity={0.9}
            >
              {/* Animated Progress Bar fill */}
              <Animated.View
                style={[
                  styles.sosProgressFill,
                  {
                    width: sosProgressAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                    }),
                  },
                ]}
              />

              <View style={styles.sosButtonContent}>
                <Ionicons name="warning" size={26} color="#FFFFFF" />
                <View style={styles.sosTextCol}>
                  <Text style={styles.sosButtonTitle}>
                    {sosHolding ? `BROADCASTING IN ${sosCountdown}s...` : 'HOLD FOR SOS (3s)'}
                  </Text>
                  <Text style={styles.sosButtonSub}>
                    {sosHolding
                      ? 'Keep holding to broadcast Send Help alert'
                      : 'Broadcasts GPS & battery alert to all family members'}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          </View>

          {/* Action 2: Mark "I'm Safe" Reassurance Button */}
          <TouchableOpacity
            style={[
              styles.safeReassuranceBtn,
              isMarkedSafe && styles.safeReassuranceBtnActive,
            ]}
            onPress={onMarkSafe}
            activeOpacity={0.8}
          >
            <View style={styles.safeBtnContent}>
              <View
                style={[
                  styles.safeIconCircle,
                  { backgroundColor: isMarkedSafe ? '#15803D' : '#16A34A' },
                ]}
              >
                <Ionicons
                  name={isMarkedSafe ? 'checkmark-circle' : 'shield-checkmark'}
                  size={24}
                  color="#FFFFFF"
                />
              </View>
              <View style={styles.safeTextCol}>
                <Text style={styles.safeTitle}>
                  {isMarkedSafe ? "You're Marked Safe" : "Mark 'I'm Safe'"}
                </Text>
                <Text style={styles.safeSub}>
                  {isMarkedSafe
                    ? 'Reassurance badge posted to your family map.'
                    : 'Posts instant green reassurance status during severe weather.'}
                </Text>
              </View>
            </View>
            <View style={styles.safeBadgeCheck}>
              <Ionicons
                name={isMarkedSafe ? 'checkmark-done' : 'add-circle-outline'}
                size={20}
                color={isMarkedSafe ? '#16A34A' : Colors.textMuted}
              />
            </View>
          </TouchableOpacity>

          {/* Action 3: Single-Device Emergency Test Card */}
          <View style={styles.testCard}>
            <View style={styles.testHeaderRow}>
              <View style={styles.testTag}>
                <Text style={styles.testTagText}>🧪 SINGLE-DEVICE TEST</Text>
              </View>
              <Text style={styles.testHeaderSub}>Test without 2nd phone</Text>
            </View>
            <Text style={styles.testDescription}>
              Test how the NDRRMC warning popup box and siren look on this device:
            </Text>

            <View style={styles.testBtnRow}>
              <TouchableOpacity
                style={[styles.testBtn, { backgroundColor: '#DC2626' }]}
                onPress={() => triggerTestNDRRMCAlert('loud_ping', 0, 'Self Test (Loud Ping)')}
                activeOpacity={0.8}
              >
                <Ionicons name="volume-high" size={15} color="#FFFFFF" />
                <Text style={styles.testBtnText}>Loud Ping</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.testBtn, { backgroundColor: '#2563EB' }]}
                onPress={() => triggerTestNDRRMCAlert('checkin', 0, 'Self Test (Check-In)')}
                activeOpacity={0.8}
              >
                <Ionicons name="shield-checkmark" size={15} color="#FFFFFF" />
                <Text style={styles.testBtnText}>Are You Safe?</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.testBtn, { backgroundColor: '#7C3AED' }]}
                onPress={() => {
                  Alert.alert(
                    '⏱️ 5-Second Test Armed',
                    'Minimize the app or lock your phone NOW!\n\nThe NDRRMC emergency alert will fire in 5 seconds with siren vibration and heads-up banner.',
                    [{ text: 'Start 5s Countdown', onPress: () => triggerTestNDRRMCAlert('loud_ping', 5, 'NDRRMC / Test Alert') }]
                  );
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="timer-outline" size={15} color="#FFFFFF" />
                <Text style={styles.testBtnText}>Lock Phone (5s)</Text>
              </TouchableOpacity>
            </View>

            {Platform.OS === 'android' && (
              <TouchableOpacity
                style={styles.permissionHintRow}
                onPress={() => Linking.openSettings()}
                activeOpacity={0.8}
              >
                <Ionicons name="shield-checkmark" size={14} color="#93C5FD" />
                <Text style={styles.permissionHintText}>
                  Lock-screen Full-Screen Alerts: Tap to verify <Text style={{ fontWeight: '700', color: '#FFFFFF', textDecorationLine: 'underline' }}>Full-screen intent</Text> is allowed in App Settings.
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  sheetContainer: {
    paddingTop: 6,
    paddingBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  profileLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  avatarRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2.5,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  headerStatusDot: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  headerInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerName: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.text,
    maxWidth: 160,
  },
  relationshipBadge: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: BorderRadius.full,
  },
  relationshipText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  statusMiniDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  headerStatusText: {
    fontSize: 11,
    color: Colors.textLight,
    fontWeight: '500',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  actionsContainer: {
    gap: Spacing.sm,
  },
  /* Hero Primary Check-In Buttons */
  primaryHeroBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: BorderRadius.lg,
    borderWidth: 1.5,
  },
  heroBtnOnline: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  heroBtnOffline: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FED7AA',
  },
  heroBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  heroIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroTextCol: {
    flex: 1,
  },
  heroTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.text,
  },
  heroSub: {
    fontSize: 11,
    color: Colors.textLight,
    marginTop: 2,
  },
  livePushBadge: {
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: BorderRadius.full,
  },
  livePushBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#1D4ED8',
  },
  cellularBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#EA580C',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: BorderRadius.full,
  },
  cellularBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  /* 3-Column Action Grid */
  actionGrid: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  gridActionItem: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: BorderRadius.md,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  gridIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  gridActionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  gridActionSub: {
    fontSize: 9,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 1,
  },
  /* SOS Hold Section */
  sosContainer: {
    marginTop: 2,
  },
  sosButton: {
    backgroundColor: '#DC2626',
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1.5,
    borderColor: '#B91C1C',
  },
  sosProgressFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: '#991B1B',
  },
  sosButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  sosTextCol: {
    flex: 1,
  },
  sosButtonTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  sosButtonSub: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 11,
    marginTop: 2,
  },
  /* Mark Safe Reassurance Button */
  safeReassuranceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F0FDF4',
    padding: 12,
    borderRadius: BorderRadius.lg,
    borderWidth: 1.5,
    borderColor: '#BBF7D0',
    marginTop: 4,
  },
  safeReassuranceBtnActive: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  safeBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  safeIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
  },
  safeTextCol: {
    flex: 1,
  },
  safeTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#14532D',
  },
  safeSub: {
    fontSize: 11,
    color: '#166534',
    marginTop: 2,
  },
  safeBadgeCheck: {
    paddingLeft: 8,
  },
  /* Single-Device Test Section */
  testCard: {
    backgroundColor: '#0F172A',
    borderRadius: BorderRadius.lg,
    padding: 12,
    borderWidth: 1.5,
    borderColor: '#334155',
    marginTop: 4,
  },
  testHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  testTag: {
    backgroundColor: '#F59E0B',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  testTagText: {
    color: '#000000',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  testHeaderSub: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '600',
  },
  testDescription: {
    color: '#CBD5E1',
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 10,
  },
  testBtnRow: {
    flexDirection: 'row',
    gap: 6,
  },
  testBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 8,
    gap: 4,
  },
  testBtnText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  permissionHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  permissionHintText: {
    color: '#93C5FD',
    fontSize: 10.5,
    flex: 1,
  },
});

