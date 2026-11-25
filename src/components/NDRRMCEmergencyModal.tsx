import React, { useEffect, useRef, useState, useCallback } from 'react';
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
  Linking,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  playEmergencyAlarmAudio,
  stopEmergencyAlarmAudio,
  setEmergencyAlarmVolume,
} from '../services/EmergencyAudioService';
import { dismissEmergencyAlertNotifications } from '../services/EmergencyNotificationService';
import {
  speakEmergencyAlert,
  stopEmergencySpeech,
} from '../services/EmergencySpeechService';

export interface NDRRMCEmergencyAlertData {
  alertType: 'loud_ping' | 'checkin' | 'sos';
  fromName: string;
  fromAvatar?: string | null;
  fromPhone?: string | null;
  fromUserId?: string;
  fromLat?: number;
  fromLng?: number;
  battery?: number | null;
  timestamp?: string;
}

interface NDRRMCEmergencyModalProps {
  visible: boolean;
  alertData: NDRRMCEmergencyAlertData | null;
  onConfirmSafe: () => void;
  onTriggerSOS: () => void;
  onViewTracker?: () => void;
  onDismiss: () => void;
}

export const NDRRMCEmergencyModal: React.FC<NDRRMCEmergencyModalProps> = ({
  visible,
  alertData,
  onConfirmSafe,
  onTriggerSOS,
  onViewTracker,
  onDismiss,
}) => {
  // Pulsing siren beacon animation
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0.4)).current;
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const speechTimeoutRef = useRef<any>(null);

  const triggerTTS = useCallback((data: NDRRMCEmergencyAlertData) => {
    // Duck siren alarm volume during speech announcement so speech is 100% intelligible
    setEmergencyAlarmVolume(0.2).catch(() => {});

    speakEmergencyAlert(
      data.alertType,
      data.fromName,
      {
        battery: data.battery,
      },
      {
        onStart: () => {
          setIsSpeaking(true);
          setEmergencyAlarmVolume(0.2).catch(() => {});
        },
        onDone: () => {
          setIsSpeaking(false);
          setEmergencyAlarmVolume(0.7).catch(() => {});
        },
        onStopped: () => {
          setIsSpeaking(false);
          setEmergencyAlarmVolume(0.7).catch(() => {});
        },
        onError: () => {
          setIsSpeaking(false);
          setEmergencyAlarmVolume(0.85).catch(() => {});
        },
      }
    ).catch(() => {
      setIsSpeaking(false);
    });
  }, []);

  const toggleSpeech = useCallback(() => {
    if (isSpeaking) {
      stopEmergencySpeech().catch(() => {});
      setIsSpeaking(false);
      setEmergencyAlarmVolume(0.7).catch(() => {});
    } else if (alertData) {
      triggerTTS(alertData);
    }
  }, [isSpeaking, alertData, triggerTTS]);

  useEffect(() => {
    if (visible && alertData) {
      // 1. Play hardware alarm audio (STREAM_ALARM - overrides Silent/Vibrate/DND)
      const isLoud = alertData.alertType === 'loud_ping' || alertData.alertType === 'sos';
      playEmergencyAlarmAudio(isLoud ? 'alert' : 'notif', isLoud).catch(() => {});

      // 2. Continuous emergency siren vibration (alternating NDRRMC cadence)
      // Pattern: wait 0ms, vibrate 600ms, wait 200ms, vibrate 600ms, wait 200ms, vibrate 1000ms
      Vibration.vibrate([0, 600, 200, 600, 200, 1000, 300, 1000], true);

      // 3. Loop pulsing siren beacon
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

      // 4. Voice reader: brief 800ms alert chime burst to grab attention, then read dialogue out loud
      if (speechTimeoutRef.current) clearTimeout(speechTimeoutRef.current);
      speechTimeoutRef.current = setTimeout(() => {
        triggerTTS(alertData);
      }, 800);

      return () => {
        if (speechTimeoutRef.current) clearTimeout(speechTimeoutRef.current);
        stopEmergencySpeech().catch(() => {});
        stopEmergencyAlarmAudio().catch(() => {});
        Vibration.cancel();
        pulseLoop.stop();
        dismissEmergencyAlertNotifications().catch(() => {});
      };
    } else {
      if (speechTimeoutRef.current) clearTimeout(speechTimeoutRef.current);
      stopEmergencySpeech().catch(() => {});
      stopEmergencyAlarmAudio().catch(() => {});
      Vibration.cancel();
      dismissEmergencyAlertNotifications().catch(() => {});
    }
  }, [visible, alertData, triggerTTS]);

  if (!visible || !alertData) return null;

  const isSOS = alertData.alertType === 'sos';
  const isLoudPing = alertData.alertType === 'loud_ping';
  const isCheckIn = alertData.alertType === 'checkin';

  const title = isSOS
    ? 'EMERGENCY SOS DISTRESS'
    : isLoudPing
    ? 'LOUD EMERGENCY PING'
    : 'ARE YOU SAFE?';

  const subtitle = isSOS
    ? 'CRITICAL LIFE DISTRESS • LIVE GPS TRANSMITTED'
    : isLoudPing
    ? 'CRITICAL HIGH-VOLUME AUDIBLE ALERT'
    : 'URGENT SAFETY CHECK-IN REQUEST';

  const hazardTag = isSOS ? '🚨 LIFE DISTRESS BEACON' : '⚠️ NDRRMC PROTOCOL';
  const hazardTitle = isSOS ? 'EMERGENCY SOS ALERT' : 'EMERGENCY ALERT';
  const hazardSub = isSOS ? 'LIFE SAFETY DISTRESS BROADCAST' : 'ABUCAY GUARDIAN SAFETY BROADCAST';

  const sirenBg = isSOS ? '#B91C1C' : isLoudPing ? '#DC2626' : '#EA580C';
  const glowBg = isSOS ? '#DC2626' : isLoudPing ? '#EF4444' : '#F97316';
  const sirenIcon = isSOS ? 'warning' : isLoudPing ? 'volume-high' : 'alert-circle';

  const handleSafe = () => {
    if (speechTimeoutRef.current) clearTimeout(speechTimeoutRef.current);
    stopEmergencySpeech().catch(() => {});
    stopEmergencyAlarmAudio().catch(() => {});
    Vibration.cancel();
    dismissEmergencyAlertNotifications().catch(() => {});
    onConfirmSafe();
  };

  const handleSOS = () => {
    if (speechTimeoutRef.current) clearTimeout(speechTimeoutRef.current);
    stopEmergencySpeech().catch(() => {});
    stopEmergencyAlarmAudio().catch(() => {});
    Vibration.cancel();
    dismissEmergencyAlertNotifications().catch(() => {});
    onTriggerSOS();
  };

  const handleViewTracker = () => {
    if (speechTimeoutRef.current) clearTimeout(speechTimeoutRef.current);
    stopEmergencySpeech().catch(() => {});
    stopEmergencyAlarmAudio().catch(() => {});
    Vibration.cancel();
    dismissEmergencyAlertNotifications().catch(() => {});
    if (onViewTracker) {
      onViewTracker();
    } else {
      onDismiss();
    }
  };

  const handleDismiss = () => {
    if (speechTimeoutRef.current) clearTimeout(speechTimeoutRef.current);
    stopEmergencySpeech().catch(() => {});
    stopEmergencyAlarmAudio().catch(() => {});
    Vibration.cancel();
    dismissEmergencyAlertNotifications().catch(() => {});
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
        <View style={[styles.alertCard, isSOS && styles.alertCardSOS]}>
          {/* Header Hazard Banner (NDRRMC Style) */}
          <View style={[styles.hazardHeader, isSOS && styles.hazardHeaderSOS]}>
            <View style={styles.hazardTopRow}>
              <View style={[styles.hazardTag, isSOS && styles.hazardTagSOS]}>
                <Text style={styles.hazardTagText}>{hazardTag}</Text>
              </View>

              <View style={styles.hazardRightActions}>
                {/* Text to Speech Voice Toggle Button */}
                <TouchableOpacity
                  style={[styles.ttsSpeakerBtn, isSpeaking && styles.ttsSpeakerBtnActive]}
                  onPress={toggleSpeech}
                  activeOpacity={0.75}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name={isSpeaking ? 'volume-high' : 'volume-mute'}
                    size={14}
                    color="#FFFFFF"
                  />
                  <Text style={styles.ttsSpeakerBtnText}>
                    {isSpeaking ? 'VOICE ON' : 'READ ALOUD'}
                  </Text>
                </TouchableOpacity>

                <Text style={styles.hazardTime}>
                  {alertData.timestamp || 'CRITICAL'}
                </Text>
              </View>
            </View>
            <Text style={styles.hazardMainTitle}>{hazardTitle}</Text>
            <Text style={styles.hazardSubTitle}>{hazardSub}</Text>
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
                    backgroundColor: glowBg,
                  },
                ]}
              />
              <View
                style={[
                  styles.sirenCenterCircle,
                  { backgroundColor: sirenBg },
                ]}
              >
                <Ionicons
                  name={sirenIcon as any}
                  size={36}
                  color="#FFFFFF"
                />
              </View>
            </View>

            {/* Alert Headings */}
            <Text style={styles.alertHeadline}>{title}</Text>
            <Text style={[styles.alertSubHeadline, isSOS && { color: '#F87171' }]}>{subtitle}</Text>

            {/* Sender Identification Card */}
            <View style={[styles.senderCard, isSOS && styles.senderCardSOS]}>
              {alertData.fromAvatar ? (
                <Image source={{ uri: alertData.fromAvatar }} style={styles.senderAvatar} />
              ) : (
                <View style={[styles.senderAvatarFallback, isSOS && { backgroundColor: '#DC2626' }]}>
                  <Text style={styles.senderInitial}>
                    {alertData.fromName.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={styles.senderInfo}>
                <Text style={styles.senderFromLabel}>
                  {isSOS ? 'DISTRESS SIGNAL FROM' : 'REQUESTED BY'}
                </Text>
                <Text style={styles.senderName}>{alertData.fromName}</Text>
                <Text style={[styles.senderRole, isSOS && { color: '#F87171' }]}>
                  {isSOS ? 'Family Circle • Urgent Distress' : 'Verified Family Circle Member'}
                </Text>
                {(alertData.fromLat !== undefined && alertData.fromLng !== undefined) && (
                  <View style={styles.senderCoordsRow}>
                    <Ionicons name="location-sharp" size={13} color="#EF4444" />
                    <Text style={styles.senderCoordsText}>
                      GPS: {alertData.fromLat.toFixed(4)}, {alertData.fromLng.toFixed(4)}
                      {alertData.battery !== undefined && alertData.battery !== null
                        ? ` • 🔋 ${Math.round(alertData.battery * 100)}%`
                        : ''}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Emergency Warning Notice Box */}
            <View style={[styles.warningNoticeBox, isSOS && styles.warningNoticeBoxSOS]}>
              <Ionicons
                name={isSOS ? 'warning' : 'information-circle'}
                size={20}
                color={isSOS ? '#EF4444' : '#F59E0B'}
                style={styles.noticeIcon}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.warningNoticeText, isSOS && styles.warningNoticeTextSOS]}>
                  {isSOS
                    ? `🚨 ${alertData.fromName} broadcasted an EMERGENCY SOS DISTRESS ALERT! Live coordinates and battery status have been reported. Check on them immediately or call emergency dispatch.`
                    : isLoudPing
                    ? `${alertData.fromName} triggered an urgent alarm on your device. Please verify you are safe immediately.`
                    : `${alertData.fromName} is requesting your real-time safety status. Tap below to confirm you are safe.`}
                </Text>
                {isSpeaking && (
                  <View style={styles.voiceSpeakingIndicator}>
                    <Ionicons name="volume-high" size={13} color="#10B981" />
                    <Text style={styles.voiceSpeakingText}>Voice reading dialogue out loud...</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Action Buttons */}
            <View style={styles.actionsContainer}>
              {isSOS ? (
                <>
                  {/* Primary SOS Action: View on Live Tracker */}
                  <TouchableOpacity
                    style={styles.trackerButton}
                    onPress={handleViewTracker}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="location" size={24} color="#FFFFFF" />
                    <View style={styles.btnTextContainer}>
                      <Text style={styles.trackerButtonText}>VIEW ON LIVE TRACKER</Text>
                      <Text style={styles.trackerButtonSub}>Track coordinates • Open live map</Text>
                    </View>
                  </TouchableOpacity>

                  {/* Secondary SOS Action: Call or SMS Family Member */}
                  {alertData.fromPhone ? (
                    <TouchableOpacity
                      style={styles.directContactButton}
                      onPress={() => {
                        Alert.alert(
                          `Contact ${alertData.fromName}`,
                          `Phone: ${alertData.fromPhone}\nChoose communication channel:`,
                          [
                            {
                              text: `Call ${alertData.fromName}`,
                              onPress: () => {
                                stopEmergencyAlarmAudio().catch(() => {});
                                Vibration.cancel();
                                Linking.openURL(`tel:${alertData.fromPhone}`).catch(() => {});
                              },
                            },
                            {
                              text: `Send SMS to ${alertData.fromName}`,
                              onPress: () => {
                                const sep = Platform.OS === 'ios' ? '&' : '?';
                                const text = `I received your emergency SOS! Hang in there, help is on the way.`;
                                Linking.openURL(`sms:${alertData.fromPhone}${sep}body=${encodeURIComponent(text)}`).catch(() => {});
                              },
                            },
                            { text: 'Cancel', style: 'cancel' },
                          ]
                        );
                      }}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="chatbubbles" size={22} color="#FFFFFF" />
                      <View style={styles.btnTextContainer}>
                        <Text style={styles.directContactButtonText}>
                          CALL / SMS {alertData.fromName.toUpperCase()}
                        </Text>
                        <Text style={styles.directContactButtonSub}>
                          Direct cellular response to family member
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ) : null}

                  {/* Tertiary SOS Action: Call 911 Emergency */}
                  <TouchableOpacity
                    style={styles.sosButton}
                    onPress={() => {
                      stopEmergencyAlarmAudio().catch(() => {});
                      Vibration.cancel();
                      dismissEmergencyAlertNotifications().catch(() => {});
                      Linking.openURL('tel:911').catch(() => {});
                    }}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="call" size={22} color="#FFFFFF" />
                    <View style={styles.btnTextContainer}>
                      <Text style={styles.sosButtonText}>CALL 911 EMERGENCY</Text>
                      <Text style={styles.sosButtonSub}>Direct emergency hotline dispatch</Text>
                    </View>
                  </TouchableOpacity>
                </>
              ) : (
                <>
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

                  {/* Tertiary: Quick Call or SMS Requester */}
                  {alertData.fromPhone ? (
                    <TouchableOpacity
                      style={styles.directContactButton}
                      onPress={() => {
                        Alert.alert(
                          `Contact ${alertData.fromName}`,
                          `Phone: ${alertData.fromPhone}\nChoose communication channel:`,
                          [
                            {
                              text: `Call ${alertData.fromName}`,
                              onPress: () => {
                                stopEmergencyAlarmAudio().catch(() => {});
                                Vibration.cancel();
                                Linking.openURL(`tel:${alertData.fromPhone}`).catch(() => {});
                              },
                            },
                            {
                              text: `Send SMS to ${alertData.fromName}`,
                              onPress: () => {
                                const sep = Platform.OS === 'ios' ? '&' : '?';
                                const text = isCheckIn
                                  ? `I am SAFE. Thanks for checking on me! - Sent via Abucay Guardian`
                                  : `I received your loud ping alert! - Sent via Abucay Guardian`;
                                Linking.openURL(`sms:${alertData.fromPhone}${sep}body=${encodeURIComponent(text)}`).catch(() => {});
                              },
                            },
                            { text: 'Cancel', style: 'cancel' },
                          ]
                        );
                      }}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="chatbubbles" size={20} color="#FFFFFF" />
                      <View style={styles.btnTextContainer}>
                        <Text style={styles.directContactButtonText}>
                          CALL / SMS {alertData.fromName.toUpperCase()}
                        </Text>
                        <Text style={styles.directContactButtonSub}>
                          Direct cellular response
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ) : null}
                </>
              )}

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
  hazardRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ttsSpeakerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  ttsSpeakerBtnActive: {
    backgroundColor: '#059669',
    borderColor: '#34D399',
  },
  ttsSpeakerBtnText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  voiceSpeakingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  voiceSpeakingText: {
    color: '#34D399',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
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
  directContactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0284C7', // Blue
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
  },
  directContactButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  directContactButtonSub: {
    color: '#E0F2FE',
    fontSize: 10,
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
  alertCardSOS: {
    borderColor: '#EF4444',
    shadowColor: '#EF4444',
  },
  hazardHeaderSOS: {
    backgroundColor: '#B91C1C',
    borderBottomColor: '#7F1D1D',
  },
  hazardTagSOS: {
    backgroundColor: '#450A0A',
  },
  senderCardSOS: {
    borderColor: '#7F1D1D',
    backgroundColor: '#1E1B2E',
  },
  senderCoordsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  senderCoordsText: {
    color: '#FCA5A5',
    fontSize: 11,
    fontWeight: '700',
  },
  warningNoticeBoxSOS: {
    backgroundColor: 'rgba(220, 38, 38, 0.16)',
    borderColor: 'rgba(239, 68, 68, 0.45)',
  },
  warningNoticeTextSOS: {
    color: '#FECACA',
  },
  trackerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563EB',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  trackerButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  trackerButtonSub: {
    color: '#DBEAFE',
    fontSize: 11,
    fontWeight: '600',
  },
});

