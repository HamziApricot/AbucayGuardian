import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NavigationRoute, formatDistance, formatDuration } from '../services/RoutingService';
import { Colors, Spacing, BorderRadius, Fonts } from '../constants/theme';

interface TurnByTurnHUDProps {
  route: NavigationRoute;
  currentStepIndex: number;
  remainingDistanceMeters: number;
  onExitNavigation: () => void;
  onNextStep?: () => void;
  onPrevStep?: () => void;
  onRecalculate?: () => void;
}

export function TurnByTurnHUD({
  route,
  currentStepIndex,
  remainingDistanceMeters,
  onExitNavigation,
  onNextStep,
  onPrevStep,
  onRecalculate,
}: TurnByTurnHUDProps) {
  const insets = useSafeAreaInsets();
  const [showFullSteps, setShowFullSteps] = useState(false);

  const steps = route.steps || [];
  const currentStep = steps[currentStepIndex] || steps[0];
  const nextStep = steps[currentStepIndex + 1];

  // Map step modifier/type to an Ionicons icon
  const getManeuverIcon = (modifier?: string, type?: string) => {
    if (type === 'arrive') return 'flag';
    if (type === 'depart') return 'navigate';
    if (route.isOffline) return 'compass';

    switch (modifier) {
      case 'left':
      case 'sharp left':
        return 'arrow-back';
      case 'slight left':
        return 'arrow-up-left';
      case 'right':
      case 'sharp right':
        return 'arrow-forward';
      case 'slight right':
        return 'arrow-up-right';
      case 'uturn':
        return 'return-down-back';
      case 'straight':
      default:
        return 'arrow-up';
    }
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 14) + 6 }]}>
      {/* Main Maneuver Banner */}
      <View style={styles.hudCard}>
        <View style={styles.topRow}>
          {/* Maneuver Icon */}
          <View style={[styles.iconCircle, route.isOffline && styles.iconCircleOffline]}>
            <Ionicons
              name={getManeuverIcon(currentStep?.modifier, currentStep?.type) as any}
              size={26}
              color="#FFFFFF"
            />
          </View>

          {/* Maneuver Instruction */}
          <View style={styles.instructionContainer}>
            <Text style={styles.distanceText}>
              In {formatDistance(currentStep?.distance || remainingDistanceMeters)}
            </Text>
            <Text style={styles.instructionText} numberOfLines={2}>
              {currentStep?.instruction || `Head toward ${route.label}`}
            </Text>
            {nextStep && (
              <Text style={styles.nextPreviewText} numberOfLines={1}>
                Then: {nextStep.instruction}
              </Text>
            )}
          </View>

          {/* Exit Navigation Button */}
          <TouchableOpacity
            style={styles.exitBtn}
            onPress={onExitNavigation}
            activeOpacity={0.8}
            accessibilityLabel="Exit navigation"
          >
            <Ionicons name="close" size={20} color="#94A3B8" />
          </TouchableOpacity>
        </View>

        {/* Trip Stats Bottom Strip */}
        <View style={styles.bottomStrip}>
          <View style={styles.statsRow}>
            <View style={styles.statPill}>
              <Ionicons name="speedometer-outline" size={13} color="#10B981" />
              <Text style={styles.statText}>
                {formatDistance(remainingDistanceMeters)}
              </Text>
            </View>
            <View style={styles.statPill}>
              <Ionicons name="time-outline" size={13} color="#60A5FA" />
              <Text style={styles.statText}>{formatDuration(route.duration)}</Text>
            </View>

            {/* Offline vs Online badge */}
            <View
              style={[
                styles.modeBadge,
                route.isOffline ? styles.modeBadgeOffline : styles.modeBadgeOnline,
              ]}
            >
              <Ionicons
                name={route.isOffline ? 'cloud-offline' : 'flash'}
                size={11}
                color={route.isOffline ? '#F59E0B' : '#10B981'}
              />
              <Text
                style={[
                  styles.modeBadgeText,
                  route.isOffline ? styles.modeBadgeTextOffline : styles.modeBadgeTextOnline,
                ]}
              >
                {route.isOffline ? 'Offline Compass' : 'Live Road Route'}
              </Text>
            </View>
          </View>

          {/* Step list toggle & manual step navigation */}
          <View style={styles.stepControls}>
            {steps.length > 1 && (
              <>
                <TouchableOpacity
                  style={[styles.arrowBtn, currentStepIndex === 0 && styles.arrowBtnDisabled]}
                  onPress={onPrevStep}
                  disabled={currentStepIndex === 0}
                >
                  <Ionicons name="chevron-back" size={16} color={currentStepIndex === 0 ? '#475569' : '#FFFFFF'} />
                </TouchableOpacity>
                <Text style={styles.stepCounterText}>
                  {currentStepIndex + 1}/{steps.length}
                </Text>
                <TouchableOpacity
                  style={[styles.arrowBtn, currentStepIndex >= steps.length - 1 && styles.arrowBtnDisabled]}
                  onPress={onNextStep}
                  disabled={currentStepIndex >= steps.length - 1}
                >
                  <Ionicons name="chevron-forward" size={16} color={currentStepIndex >= steps.length - 1 ? '#475569' : '#FFFFFF'} />
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity
              style={styles.toggleListBtn}
              onPress={() => setShowFullSteps(!showFullSteps)}
            >
              <Ionicons
                name={showFullSteps ? 'chevron-up' : 'list'}
                size={15}
                color="#94A3B8"
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Expandable Step-by-Step Directions Drawer */}
        {showFullSteps && (
          <View style={styles.fullStepDrawer}>
            <Text style={styles.drawerTitle}>All Turn-by-Turn Steps</Text>
            <ScrollView style={styles.drawerScroll} nestedScrollEnabled>
              {steps.map((st, idx) => (
                <View
                  key={st.id || idx}
                  style={[
                    styles.drawerStepItem,
                    idx === currentStepIndex && styles.drawerStepItemActive,
                  ]}
                >
                  <View style={styles.drawerStepIcon}>
                    <Ionicons
                      name={getManeuverIcon(st.modifier, st.type) as any}
                      size={18}
                      color={idx === currentStepIndex ? '#10B981' : '#94A3B8'}
                    />
                  </View>
                  <View style={styles.drawerStepContent}>
                    <Text
                      style={[
                        styles.drawerStepInstruction,
                        idx === currentStepIndex && styles.drawerStepInstructionActive,
                      ]}
                    >
                      {st.instruction}
                    </Text>
                    <Text style={styles.drawerStepDistance}>
                      {formatDistance(st.distance)}
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingHorizontal: 12,
  },
  hudCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.96)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.8)',
    padding: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.35,
        shadowRadius: 10,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleOffline: {
    backgroundColor: '#D97706',
  },
  instructionContainer: {
    flex: 1,
  },
  distanceText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#34D399',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  instructionText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 1,
  },
  nextPreviewText: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  exitBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(71, 85, 105, 0.5)',
  },
  bottomStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(51, 65, 85, 0.5)',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(30, 41, 59, 0.7)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  modeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  modeBadgeOnline: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  modeBadgeOffline: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  modeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  modeBadgeTextOnline: {
    color: '#10B981',
  },
  modeBadgeTextOffline: {
    color: '#F59E0B',
  },
  stepControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  arrowBtn: {
    padding: 4,
    borderRadius: 4,
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
  },
  arrowBtnDisabled: {
    opacity: 0.4,
  },
  stepCounterText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
    minWidth: 26,
    textAlign: 'center',
  },
  toggleListBtn: {
    padding: 5,
    marginLeft: 4,
  },
  fullStepDrawer: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(51, 65, 85, 0.6)',
  },
  drawerTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  drawerScroll: {
    maxHeight: 180,
  },
  drawerStepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 8,
  },
  drawerStepItemActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderLeftWidth: 3,
    borderLeftColor: '#10B981',
  },
  drawerStepIcon: {
    width: 24,
    alignItems: 'center',
  },
  drawerStepContent: {
    flex: 1,
  },
  drawerStepInstruction: {
    fontSize: 13,
    color: '#CBD5E1',
    fontWeight: '500',
  },
  drawerStepInstructionActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  drawerStepDistance: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
});

