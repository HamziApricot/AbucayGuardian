import React from 'react';
import { StyleSheet, View, Text, Image, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, RadialGradient, Stop, Path, Circle, Ellipse } from 'react-native-svg';

/**
 * Multi-layered compass beam cone (wide soft FOV ambient + focused center ray)
 * and beveled 3D directional pointer rendered outside the avatar halo within a 136x136 canvas.
 */
export const HeadingBeamSvg: React.FC<{
  color: string;
  gradientId: string;
}> = React.memo(({ color, gradientId }) => (
  <Svg width={136} height={136} viewBox="0 0 136 136">
    <Defs>
      <RadialGradient
        id={`${gradientId}-outer`}
        cx="68"
        cy="68"
        r="63"
        gradientUnits="userSpaceOnUse"
      >
        <Stop offset="0.46" stopColor={color} stopOpacity="0.44" />
        <Stop offset="0.76" stopColor={color} stopOpacity="0.16" />
        <Stop offset="1" stopColor={color} stopOpacity="0" />
      </RadialGradient>
      <RadialGradient
        id={`${gradientId}-inner`}
        cx="68"
        cy="68"
        r="58"
        gradientUnits="userSpaceOnUse"
      >
        <Stop offset="0.50" stopColor={color} stopOpacity="0.42" />
        <Stop offset="0.82" stopColor={color} stopOpacity="0.14" />
        <Stop offset="1" stopColor={color} stopOpacity="0" />
      </RadialGradient>
    </Defs>

    {/* Soft outer peripheral vision cone (+/- 36 deg) */}
    <Path
      d="M 50.37 43.73 L 30.97 17.03 A 63 63 0 0 1 105.03 17.03 L 85.63 43.73 A 30 30 0 0 0 50.37 43.73 Z"
      fill={`url(#${gradientId}-outer)`}
    />

    {/* Focused inner compass core (+/- 16 deg) */}
    <Path
      d="M 59.73 39.16 L 52.02 12.24 A 58 58 0 0 1 83.98 12.24 L 76.27 39.16 A 30 30 0 0 0 59.73 39.16 Z"
      fill={`url(#${gradientId}-inner)`}
    />

    {/* Precision hairline orbit ring around avatar bezel */}
    <Circle
      cx="68"
      cy="68"
      r="32.5"
      fill="none"
      stroke={color}
      strokeOpacity="0.22"
      strokeWidth={1.1}
    />

    {/* Subtle drop shadow under compass chevron */}
    <Path
      d="M 68 20.5 L 76.2 34 L 68 30.7 L 59.8 34 Z"
      fill="rgba(15, 23, 42, 0.24)"
    />

    {/* Crisp white-rimmed beveled compass dart strictly outside the 56x56 bezel */}
    <Path
      d="M 68 19 L 76.2 32.5 L 68 29.2 L 59.8 32.5 Z"
      fill={color}
      stroke="#FFFFFF"
      strokeWidth={2.2}
      strokeLinejoin="round"
    />

    {/* Subtle 3D specular highlight on left facet */}
    <Path
      d="M 68 20.6 L 68 28.4 L 61.8 30.8 Z"
      fill="#FFFFFF"
      fillOpacity={0.28}
    />
  </Svg>
));

/**
 * Smooth teardrop pin tip with subtle ground contact shadow ellipse.
 */
export const PinPointerTipSvg: React.FC<{
  color: string;
}> = React.memo(({ color }) => (
  <Svg width={20} height={14} viewBox="0 0 20 14">
    <Ellipse cx="10" cy="12" rx="4.5" ry="1.6" fill="rgba(15, 23, 42, 0.24)" />
    <Path
      d="M 3.5,0 L 16.5,0 Q 11.8,5.4 10,11 Q 8.2,5.4 3.5,0 Z"
      fill={color}
      stroke="#FFFFFF"
      strokeWidth={1.8}
      strokeLinejoin="round"
    />
  </Svg>
));

/**
 * Triple-ring porcelain-bezel avatar hub with selection halo, status/SOS badge, and clean photo mat.
 */
export const AvatarPinHub: React.FC<{
  avatarUrl?: string | null;
  name?: string;
  isSelf: boolean;
  isSOS: boolean;
  isSelected: boolean;
  ringColor: string;
  statusColor: string;
  avatarScale: Animated.Value;
}> = ({
  avatarUrl,
  name,
  isSelf,
  isSOS,
  isSelected,
  ringColor,
  statusColor,
  avatarScale,
}) => (
  <Animated.View
    style={[
      styles.avatarFrame,
      isSOS && styles.avatarFrameSOS,
      isSelected && !isSOS && styles.avatarFrameSelected,
      { transform: [{ scale: avatarScale }] },
    ]}
  >
    {isSelected && !isSOS && (
      <View
        pointerEvents="none"
        style={[
          styles.selectedHaloRing,
          {
            borderColor: `${ringColor}66`,
            backgroundColor: `${ringColor}1A`,
          },
        ]}
      />
    )}

    <View style={[styles.avatarColorRing, { borderColor: ringColor }]}>
      <View style={styles.avatarWhiteMat}>
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatarFallback, { backgroundColor: ringColor }]}>
            {isSelf ? (
              <Ionicons name="navigate" size={16} color="#FFFFFF" />
            ) : (
              <Text style={styles.avatarInitial}>
                {name ? name.charAt(0).toUpperCase() : '?'}
              </Text>
            )}
          </View>
        )}
      </View>
    </View>

    {isSOS ? (
      <View style={styles.sosMarkerBadge}>
        <Ionicons name="warning" size={10} color="#FFFFFF" />
      </View>
    ) : (
      <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
    )}
  </Animated.View>
);

/**
 * Stacked live battery capsule and teardrop pin tip positioned cleanly under AvatarPinHub.
 */
export const BatteryPinStack: React.FC<{
  batteryPct: number | null;
  isCharging: boolean;
  batteryColor: string;
  ringColor: string;
  marginTop: number;
}> = React.memo(({ batteryPct, isCharging, batteryColor, ringColor, marginTop }) => (
  <View style={[styles.bottomPinStack, { marginTop }]}>
    {batteryPct !== null && (
      <View style={[styles.mapBatteryPill, { backgroundColor: batteryColor }]}>
        <Ionicons
          name={
            isCharging
              ? 'flash'
              : batteryPct <= 20
              ? 'battery-dead'
              : batteryPct <= 50
              ? 'battery-half'
              : 'battery-full'
          }
          size={9}
          color="#FFFFFF"
        />
        <Text style={styles.mapBatteryPillText}>{batteryPct}%</Text>
      </View>
    )}
    <View style={styles.pointerTipWrapper}>
      <PinPointerTipSvg color={ringColor} />
    </View>
  </View>
));

const styles = StyleSheet.create({
  avatarFrame: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 5,
    elevation: 7,
    zIndex: 4,
  },
  avatarFrameSelected: {
    shadowOpacity: 0.38,
    shadowRadius: 7,
    elevation: 9,
  },
  avatarFrameSOS: {
    borderColor: '#FFFFFF',
    backgroundColor: '#FEF2F2',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 11,
  },
  selectedHaloRing: {
    position: 'absolute',
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 1.5,
  },
  avatarColorRing: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 3,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarWhiteMat: {
    width: 43,
    height: 43,
    borderRadius: 21.5,
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
    fontSize: 16,
    fontWeight: '800',
  },
  statusDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    zIndex: 10,
  },
  sosMarkerBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 19,
    height: 19,
    borderRadius: 9.5,
    backgroundColor: '#DC2626',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 7,
    zIndex: 10,
  },
  bottomPinStack: {
    alignItems: 'center',
    zIndex: 15,
  },
  mapBatteryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2.5,
    paddingHorizontal: 6.5,
    paddingVertical: 1.8,
    borderRadius: 9,
    borderWidth: 1.6,
    borderColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1.5 },
    shadowOpacity: 0.28,
    shadowRadius: 2.5,
    elevation: 4,
    zIndex: 10,
  },
  mapBatteryPillText: {
    color: '#FFFFFF',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  pointerTipWrapper: {
    marginTop: -1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
