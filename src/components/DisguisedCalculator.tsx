import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Modal,
  TextInput,
  Switch,
  ScrollView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  triggerSilentSOS,
  resolveSilentSOS,
  getCovertSettings,
  saveCovertSettings,
  getActiveSilentSOSStatus,
  type CovertSettings,
  type ActiveSilentSOSStatus,
  DEFAULT_COVERT_SETTINGS,
} from '../services/SilentSOSService';

export function useCovertCalculator(onCovertTriggered?: () => void) {
  const [display, setDisplay] = useState('0');
  const [prevValue, setPrevValue] = useState<number | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);
  const [rawPinBuffer, setRawPinBuffer] = useState('');
  const settingsRef = useRef<CovertSettings>(DEFAULT_COVERT_SETTINGS);

  useEffect(() => {
    getCovertSettings().then((s) => {
      settingsRef.current = s;
    });
  }, []);

  const refreshSettings = async () => {
    const s = await getCovertSettings();
    settingsRef.current = s;
  };

  const calculate = (a: number, b: number, op: string): number => {
    switch (op) {
      case '+':
        return a + b;
      case '−':
      case '-':
        return a - b;
      case '×':
      case '*':
        return a * b;
      case '÷':
      case '/':
        return b === 0 ? 0 : a / b;
      default:
        return b;
    }
  };

  const handlePress = (key: string) => {
    if (key === 'C') {
      setDisplay('0');
      setPrevValue(null);
      setOperator(null);
      setWaitingForOperand(false);
      setRawPinBuffer('');
      return;
    }

    if (key === '+/-') {
      const val = parseFloat(display);
      if (!isNaN(val)) {
        setDisplay(String(-val));
      }
      return;
    }

    if (key === '%') {
      const val = parseFloat(display);
      if (!isNaN(val)) {
        setDisplay(String(val / 100));
      }
      return;
    }

    if (['+', '−', '×', '÷'].includes(key)) {
      const currentValue = parseFloat(display);
      if (prevValue === null) {
        setPrevValue(currentValue);
      } else if (operator && !waitingForOperand) {
        const result = calculate(prevValue, currentValue, operator);
        setPrevValue(result);
        setDisplay(String(result));
      }
      setOperator(key);
      setWaitingForOperand(true);
      return;
    }

    if (key === '=') {
      // 1. Check if the entered digits match the covert SOS secret PIN
      const currentDigitsOnly = rawPinBuffer.replace(/[^0-9]/g, '');
      const activePin = settingsRef.current.secretPin || DEFAULT_COVERT_SETTINGS.secretPin;

      if (
        rawPinBuffer === activePin ||
        currentDigitsOnly === activePin ||
        display === activePin
      ) {
        // Trigger covert silent emergency SOS: zero sound, zero vibration, zero modal
        triggerSilentSOS('calculator');
        setDisplay('0');
        setPrevValue(null);
        setOperator(null);
        setWaitingForOperand(false);
        setRawPinBuffer('');
        if (onCovertTriggered) onCovertTriggered();
        return;
      }

      // Normal math evaluation
      if (operator && prevValue !== null) {
        const currentValue = parseFloat(display);
        const result = calculate(prevValue, currentValue, operator);
        const formatted = Number.isInteger(result)
          ? String(result)
          : parseFloat(result.toFixed(6)).toString();
        setDisplay(formatted);
        setPrevValue(null);
        setOperator(null);
        setWaitingForOperand(true);
        setRawPinBuffer('');
      }
      return;
    }

    // Number keys and decimal point
    if (key === '.') {
      if (waitingForOperand) {
        setDisplay('0.');
        setWaitingForOperand(false);
      } else if (!display.includes('.')) {
        setDisplay(display + '.');
      }
      return;
    }

    // Digits 0-9
    setRawPinBuffer((prev) => (waitingForOperand || display === '0' ? key : prev + key));

    if (waitingForOperand) {
      setDisplay(key);
      setWaitingForOperand(false);
    } else {
      setDisplay(display === '0' ? key : display + key);
    }
  };

  return { display, handlePress, refreshSettings };
}

interface CalcButtonDef {
  label: string;
  type: 'func' | 'num' | 'op';
  wide?: boolean;
  longPressable?: boolean;
}

interface DisguisedCalculatorProps {
  onClose?: () => void;
  isModal?: boolean;
}

export const DisguisedCalculator: React.FC<DisguisedCalculatorProps> = ({
  onClose,
  isModal = false,
}) => {
  const insets = useSafeAreaInsets();
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settings, setSettings] = useState<CovertSettings>(DEFAULT_COVERT_SETTINGS);
  const [pinInput, setPinInput] = useState(DEFAULT_COVERT_SETTINGS.secretPin);
  const [allClearStatus, setAllClearStatus] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [activeSosInfo, setActiveSosInfo] = useState<ActiveSilentSOSStatus | null>(null);

  const { display, handlePress, refreshSettings } = useCovertCalculator(() => {
    setTimeout(() => {
      getActiveSilentSOSStatus().then(setActiveSosInfo);
    }, 300);
  });

  useEffect(() => {
    getCovertSettings().then((s) => {
      setSettings(s);
      setPinInput(s.secretPin);
    });
    getActiveSilentSOSStatus().then(setActiveSosInfo);
  }, []);

  const openSettings = () => {
    Promise.all([getCovertSettings(), getActiveSilentSOSStatus()]).then(([s, sosStatus]) => {
      setSettings(s);
      setPinInput(s.secretPin);
      setActiveSosInfo(sosStatus);
      setAllClearStatus(null);
      setShowSettingsModal(true);
    });
  };

  const handleSaveSettings = async () => {
    const updated = await saveCovertSettings({
      secretPin: pinInput.trim() || DEFAULT_COVERT_SETTINGS.secretPin,
      shakeEnabled: settings.shakeEnabled,
      volumePatternEnabled: settings.volumePatternEnabled,
      weatherTapEnabled: settings.weatherTapEnabled,
    });
    setSettings(updated);
    refreshSettings();
    setShowSettingsModal(false);
  };

  const handleResolveSOS = async () => {
    setIsResolving(true);
    try {
      const ok = await resolveSilentSOS();
      setActiveSosInfo(null);
      if (ok) {
        setAllClearStatus('✅ All-Clear broadcast sent! Family alerted.');
      } else {
        setAllClearStatus('No active distress alarm to resolve.');
      }
    } catch {
      setAllClearStatus('Resolution request processed.');
    } finally {
      setIsResolving(false);
    }
  };

  const buttons: CalcButtonDef[][] = [
    [
      { label: 'C', type: 'func', longPressable: true },
      { label: '+/-', type: 'func' },
      { label: '%', type: 'func' },
      { label: '÷', type: 'op' },
    ],
    [
      { label: '7', type: 'num' },
      { label: '8', type: 'num' },
      { label: '9', type: 'num' },
      { label: '×', type: 'op' },
    ],
    [
      { label: '4', type: 'num' },
      { label: '5', type: 'num' },
      { label: '6', type: 'num' },
      { label: '−', type: 'op' },
    ],
    [
      { label: '1', type: 'num' },
      { label: '2', type: 'num' },
      { label: '3', type: 'num' },
      { label: '+', type: 'op' },
    ],
    [
      { label: '0', type: 'num', wide: true },
      { label: '.', type: 'num' },
      { label: '=', type: 'op' },
    ],
  ];

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom, 20) }]}>
      {/* Stealth Header */}
      <View style={styles.topBar}>
        {onClose ? (
          <TouchableOpacity onPress={onClose} style={styles.topIconBtn}>
            <Ionicons name="chevron-down" size={24} color="#64748B" />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}

        <Text style={styles.appTitle}>Calculator</Text>

        {/* Discreet settings touch target */}
        <TouchableOpacity
          onPress={openSettings}
          style={styles.topIconBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color="#334155" />
        </TouchableOpacity>
      </View>

      {/* Main Number Display */}
      <View style={styles.displayContainer}>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.4}
          style={styles.displayText}
        >
          {display}
        </Text>
      </View>

      {/* Keypad Grid */}
      <View style={styles.keypad}>
        {buttons.map((row, rIdx) => (
          <View key={`row-${rIdx}`} style={styles.buttonRow}>
            {row.map((btn) => {
              const isFunc = btn.type === 'func';
              const isOp = btn.type === 'op';
              const isWide = !!btn.wide;

              return (
                <TouchableOpacity
                  key={btn.label}
                  activeOpacity={0.7}
                  onPress={() => handlePress(btn.label)}
                  onLongPress={btn.longPressable ? openSettings : undefined}
                  delayLongPress={700}
                  style={[
                    styles.calcBtn,
                    isFunc && styles.funcBtn,
                    isOp && styles.opBtn,
                    isWide && styles.wideBtn,
                  ]}
                >
                  <Text
                    style={[
                      styles.calcBtnText,
                      isFunc && styles.funcBtnText,
                      isOp && styles.opBtnText,
                    ]}
                  >
                    {btn.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      {/* Discreet Covert Management & All-Clear Modal */}
      <Modal
        visible={showSettingsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSettingsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderTitleBox}>
                <Ionicons name="shield-checkmark" size={20} color="#10B981" />
                <Text style={styles.modalTitle}>Covert Emergency Tools</Text>
              </View>
              <TouchableOpacity onPress={() => setShowSettingsModal(false)}>
                <Ionicons name="close" size={22} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
              {/* Live Covert Dispatch Status Indicator (only visible inside secret settings) */}
              <View style={[
                styles.cardSection,
                activeSosInfo?.active && { borderWidth: 1, borderColor: '#DC2626', backgroundColor: '#450A0A' }
              ]}>
                <Text style={styles.sectionHeader}>SILENT SOS DISPATCH STATUS</Text>
                <Text style={[
                  styles.sectionDesc,
                  { marginBottom: 0, color: activeSosInfo?.active ? '#FCA5A5' : '#34D399', fontWeight: '600' }
                ]}>
                  {activeSosInfo?.active
                    ? `🚨 ACTIVE DISTRESS SENT via "${activeSosInfo.source.toUpperCase()}" at ${new Date(activeSosInfo.triggeredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                    : '🟢 STANDBY • Ready (911911= or Vol UP-UP-DOWN-UP or 3x Shake)'}
                </Text>
              </View>

              {/* Cancel Alarm / All-Clear Section */}
              <View style={styles.cardSection}>
                <Text style={styles.sectionHeader}>FALSE ALARM RESOLUTION</Text>
                <Text style={styles.sectionDesc}>
                  If a silent SOS was triggered inadvertently or the emergency has passed, broadcast an All-Clear signal to family phones.
                </Text>
                <TouchableOpacity
                  style={[styles.allClearBtn, isResolving && { opacity: 0.6 }]}
                  onPress={handleResolveSOS}
                  disabled={isResolving}
                  activeOpacity={0.8}
                >
                  <Ionicons name="checkmark-done-circle" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                  <Text style={styles.allClearBtnText}>
                    {isResolving ? 'Broadcasting...' : 'Send All-Clear / Cancel Alarm'}
                  </Text>
                </TouchableOpacity>
                {allClearStatus && (
                  <Text style={styles.statusFeedbackText}>{allClearStatus}</Text>
                )}
              </View>

              {/* Secret Calculator PIN */}
              <View style={styles.cardSection}>
                <Text style={styles.sectionHeader}>CALCULATOR SECRET PIN</Text>
                <Text style={styles.sectionDesc}>
                  Typing this number followed by = instantly dispatches a covert SOS with zero sound or screen wake.
                </Text>
                <TextInput
                  style={styles.pinInput}
                  value={pinInput}
                  onChangeText={setPinInput}
                  placeholder="e.g. 911911"
                  placeholderTextColor="#64748B"
                  keyboardType="numeric"
                  maxLength={10}
                />
              </View>

              {/* Covert Trigger Toggles */}
              <View style={styles.cardSection}>
                <Text style={styles.sectionHeader}>COVERT GESTURE SHORTCUTS</Text>

                <View style={styles.toggleRow}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={styles.toggleTitle}>3-Spike Shake Trigger</Text>
                    <Text style={styles.toggleSub}>
                      Shake phone 3 times firmly within 1.5 seconds
                    </Text>
                  </View>
                  <Switch
                    value={settings.shakeEnabled}
                    onValueChange={(val) =>
                      setSettings((prev) => ({ ...prev, shakeEnabled: val }))
                    }
                    trackColor={{ false: '#334155', true: '#10B981' }}
                    thumbColor="#FFFFFF"
                  />
                </View>

                <View style={styles.toggleRow}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={styles.toggleTitle}>Hardware Volume Sequence</Text>
                    <Text style={styles.toggleSub}>
                      Press UP, UP, DOWN, UP on volume keys within 2.5s (Android)
                    </Text>
                  </View>
                  <Switch
                    value={settings.volumePatternEnabled}
                    onValueChange={(val) =>
                      setSettings((prev) => ({ ...prev, volumePatternEnabled: val }))
                    }
                    trackColor={{ false: '#334155', true: '#10B981' }}
                    thumbColor="#FFFFFF"
                  />
                </View>

                <View style={styles.toggleRow}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={styles.toggleTitle}>Weather HUD Multi-Tap</Text>
                    <Text style={styles.toggleSub}>
                      Tap temperature badge 5 times within 2 seconds
                    </Text>
                  </View>
                  <Switch
                    value={settings.weatherTapEnabled}
                    onValueChange={(val) =>
                      setSettings((prev) => ({ ...prev, weatherTapEnabled: val }))
                    }
                    trackColor={{ false: '#334155', true: '#10B981' }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.saveSettingsBtn}
                onPress={handleSaveSettings}
                activeOpacity={0.8}
              >
                <Text style={styles.saveSettingsBtnText}>Save Preferences</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export const DisguisedCalculatorModal: React.FC<{
  visible: boolean;
  onClose: () => void;
}> = ({ visible, onClose }) => {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <DisguisedCalculator onClose={onClose} isModal />
    </Modal>
  );
};

export default DisguisedCalculator;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
  },
  topIconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#475569',
    letterSpacing: 0.5,
  },
  displayContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingBottom: 20,
  },
  displayText: {
    color: '#FFFFFF',
    fontSize: 70,
    fontWeight: '300',
    textAlign: 'right',
  },
  keypad: {
    paddingBottom: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  calcBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#333333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wideBtn: {
    width: 164,
    borderRadius: 38,
    alignItems: 'flex-start',
    paddingLeft: 30,
  },
  funcBtn: {
    backgroundColor: '#A5A5A5',
  },
  opBtn: {
    backgroundColor: '#F39C12',
  },
  calcBtnText: {
    fontSize: 32,
    fontWeight: '400',
    color: '#FFFFFF',
  },
  funcBtnText: {
    color: '#000000',
    fontWeight: '500',
  },
  opBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxHeight: '85%',
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    paddingBottom: 12,
  },
  modalHeaderTitleBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  cardSection: {
    marginBottom: 20,
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 14,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  sectionDesc: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 16,
    marginBottom: 12,
  },
  allClearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10B981',
    borderRadius: 10,
    paddingVertical: 12,
  },
  allClearBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  statusFeedbackText: {
    marginTop: 8,
    fontSize: 12,
    color: '#34D399',
    textAlign: 'center',
  },
  pinInput: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    color: '#FFFFFF',
    fontSize: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    letterSpacing: 3,
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#334155',
  },
  toggleTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F1F5F9',
    marginBottom: 2,
  },
  toggleSub: {
    fontSize: 11,
    color: '#64748B',
  },
  modalFooter: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  saveSettingsBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveSettingsBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
});
