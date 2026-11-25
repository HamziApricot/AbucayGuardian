import React, { useRef, useState, useEffect, useImperativeHandle, forwardRef, useMemo } from 'react';
import { StyleSheet, View, Text, Image, TouchableOpacity, Alert, Platform, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polyline, Circle, UrlTile } from './Map';
import { getTrackingStatus } from '../utils/tracking';
import { fetchAndCacheSafetyPOIs, INITIAL_SAFETY_GEOJSON } from '../services/SafetyPOIService';
import { Colors } from '../constants/theme';
import type { FamilyMember3D, FamilyMap3DHandle, FamilyMap3DProps } from './FamilyMap3D';
import { WindParticleOverlay } from './WindParticleOverlay';
import { WeatherHUD, type WeatherDisplayMode } from './WeatherHUD';
import {
  fetchRainViewerFrames,
  fetchPointForecast,
  getRainViewerTileUrl,
  getCurrentHourIndex,
  type RainViewerData,
  type PointForecast,
} from '../services/WeatherService';

const POI_CONFIG: Record<string, { color: string; icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  evacuation: { color: '#16A34A', icon: 'shield-checkmark', label: 'Evacuation Shelter' },
  hospital: { color: '#DC2626', icon: 'medkit', label: 'Hospital / Clinic' },
  fire_station: { color: '#EA580C', icon: 'flame', label: 'Fire Station' },
  police: { color: '#1D4ED8', icon: 'shield', label: 'Police Station' },
  school: { color: '#7C3AED', icon: 'school', label: 'School / Campus' },
};

/**
 * Premium Animated Family Marker with:
 * 1. Tactile spring drop-in & fade entrance when appearing
 * 2. Smooth scale and white name box expansion when focused
 * 3. Continuous radar pulse wave for active members
 * 4. Automatic tracksViewChanges freeze for 60fps buttery zoom & pan
 */
const FlatHeadingIndicator: React.FC<{
  heading: number;
  markerColor: string;
  isSelf: boolean;
}> = React.memo(({ heading, markerColor, isSelf }) => {
  return (
    <View
      style={[
        styles.flatHeadingContainer,
        Platform.OS === 'ios' ? { transform: [{ rotate: `${heading}deg` }] } : undefined,
      ]}
      pointerEvents="none"
    >
      {/* 1. Translucent Vision Flashlight Cone radiating forward */}
      <View
        style={[
          styles.flatVisionBeamCone,
          {
            borderTopColor: isSelf ? 'rgba(37, 99, 235, 0.42)' : markerColor + '42',
          },
        ]}
      />
      {/* 2. Directional Navigation Pointer Arrow */}
      <View
        style={[
          styles.flatDirectionArrow,
          {
            borderBottomColor: isSelf ? '#1D4ED8' : markerColor,
          },
        ]}
      />
      {/* 3. Subtle Forward Pulse / Beam Core */}
      <View
        style={[
          styles.flatBeamCore,
          {
            backgroundColor: isSelf ? 'rgba(37, 99, 235, 0.20)' : markerColor + '20',
          },
        ]}
      />
    </View>
  );
});

/**
 * Animated concentric radar ripples rendered at ground zero of a family member in distress.
 */
const AnimatedDangerRadar: React.FC = React.memo(() => {
  const wave1 = useRef(new Animated.Value(0)).current;
  const wave2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const makeAnim = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, {
            toValue: 1,
            duration: 1800,
            easing: Easing.out(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(val, {
            toValue: 0,
            duration: 0,
            useNativeDriver: false,
          }),
        ])
      );

    const a1 = makeAnim(wave1, 0);
    const a2 = makeAnim(wave2, 900);
    a1.start();
    a2.start();

    return () => {
      a1.stop();
      a2.stop();
    };
  }, []);

  return (
    <View style={styles.dangerRadarContainer} pointerEvents="none">
      <Animated.View
        style={[
          styles.dangerRadarWave,
          {
            transform: [
              {
                scale: wave1.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.6, 3.4],
                }),
              },
            ],
            opacity: wave1.interpolate({
              inputRange: [0, 0.6, 1],
              outputRange: [0.85, 0.4, 0],
            }),
          },
        ]}
      />
      <Animated.View
        style={[
          styles.dangerRadarWave,
          {
            transform: [
              {
                scale: wave2.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.6, 3.4],
                }),
              },
            ],
            opacity: wave2.interpolate({
              inputRange: [0, 0.6, 1],
              outputRange: [0.85, 0.4, 0],
            }),
          },
        ]}
      />
      <View style={styles.dangerRadarCenterDot} />
    </View>
  );
});

const AnimatedFamilyMarker: React.FC<{
  member: FamilyMember3D;
  isSelected: boolean;
  isSelf: boolean;
  isTarget: boolean;
  isNavigating: boolean;
  markerColor: string;
  status: any;
  onPress: () => void;
}> = ({
  member,
  isSelected,
  isSelf,
  isTarget,
  isNavigating,
  markerColor,
  status,
  onPress,
}) => {
  const isSOS = Boolean(member.isSOS);

  // 1. Marker Entrance Drop-In Animation (useNativeDriver: false so react-native-maps renders into Bitmap on Android)
  const markerScale = useRef(new Animated.Value(0.1)).current;
  const markerOpacity = useRef(new Animated.Value(0)).current;
  const markerTranslateY = useRef(new Animated.Value(-24)).current;

  // 2. Avatar Selection Scale Animation
  const avatarScale = useRef(new Animated.Value(isSOS ? 1.25 : isSelected ? 1.15 : 1)).current;

  // 3. Name Box Expansion & Collapse Animation (both in and out)
  const [isBadgeVisible, setIsBadgeVisible] = useState(isSelected || isSOS);
  const badgeAnim = useRef(new Animated.Value(isSelected || isSOS ? 1 : 0)).current;

  // 4. Critical: tracksViewChanges must be true during animations so Google Maps paints every frame!
  const [tracksViewChanges, setTracksViewChanges] = useState(true);

  // Entrance drop-in bounce animation
  useEffect(() => {
    setTracksViewChanges(true);
    Animated.parallel([
      Animated.spring(markerScale, {
        toValue: 1,
        friction: 5,
        tension: 55,
        useNativeDriver: false,
      }),
      Animated.timing(markerOpacity, {
        toValue: 1,
        duration: 280,
        useNativeDriver: false,
      }),
      Animated.spring(markerTranslateY, {
        toValue: 0,
        friction: 5.5,
        tension: 60,
        useNativeDriver: false,
      }),
    ]).start(() => {
      setTimeout(() => setTracksViewChanges(false), 200);
    });
  }, []);

  // Smooth Name Box & Avatar spring animation when selected, deselected, or SOS status toggles
  useEffect(() => {
    setTracksViewChanges(true);

    if (isSelected || isSOS) {
      setIsBadgeVisible(true);
      Animated.parallel([
        Animated.spring(avatarScale, {
          toValue: isSOS ? 1.25 : 1.15,
          friction: 6,
          tension: 70,
          useNativeDriver: false,
        }),
        Animated.spring(badgeAnim, {
          toValue: 1,
          friction: 6,
          tension: 65,
          useNativeDriver: false,
        }),
      ]).start(() => {
        setTimeout(() => setTracksViewChanges(false), 200);
      });
    } else {
      Animated.parallel([
        Animated.spring(avatarScale, {
          toValue: 1,
          friction: 6,
          tension: 70,
          useNativeDriver: false,
        }),
        Animated.timing(badgeAnim, {
          toValue: 0,
          duration: 220,
          useNativeDriver: false,
        }),
      ]).start(() => {
        setIsBadgeVisible(false);
        setTracksViewChanges(false);
      });
    }
  }, [isSelected, isSOS]);

  // Live battery health calculations
  const batteryPct =
    member.batteryLevel != null && member.batteryLevel >= 0
      ? Math.round(member.batteryLevel > 1 ? member.batteryLevel : member.batteryLevel * 100)
      : null;
  const isCharging = Boolean(member.isCharging);
  const batteryColor = isCharging
    ? '#059669'
    : batteryPct != null && batteryPct <= 20
    ? '#DC2626'
    : batteryPct != null && batteryPct <= 50
    ? '#D97706'
    : '#16A34A';
  const batteryHealthStr = isCharging
    ? 'Charging'
    : batteryPct != null && batteryPct <= 15
    ? 'Critical'
    : batteryPct != null && batteryPct <= 25
    ? 'Low'
    : batteryPct != null && batteryPct <= 50
    ? 'Fair'
    : 'Good';

  // When GPS coordinates, speed, battery, charging, heading, or SOS status update, unfreeze tracksViewChanges
  useEffect(() => {
    setTracksViewChanges(true);
    const timer = setTimeout(() => {
      setTracksViewChanges(false);
    }, 450);
    return () => clearTimeout(timer);
  }, [
    member.latitude,
    member.longitude,
    member.avatarUrl,
    member.speed,
    member.batteryLevel,
    member.isCharging,
    member.lowPowerMode,
    member.heading,
    member.accuracy,
    status.isActive,
    member.isSOS,
  ]);

  return (
    <Marker
      coordinate={{ latitude: member.latitude, longitude: member.longitude }}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={isSOS ? 999 : isSelf ? 200 : isTarget ? 199 : isSelected ? 180 : 150}
      onPress={onPress}
      tracksViewChanges={tracksViewChanges}
    >
      <Animated.View
        style={[
          styles.markerContainer,
          {
            opacity: markerOpacity,
            transform: [
              { scale: markerScale },
              { translateY: markerTranslateY },
            ],
          },
        ]}
      >
        {/* Animated Info Pill (Crisp White Name Box with smooth spring in & out) */}
        {isBadgeVisible && (
          <Animated.View
            style={[
              styles.infoBadge,
              styles.infoBadgeSelected,
              { borderLeftColor: isSOS ? '#DC2626' : markerColor, borderLeftWidth: 3.5 },
              isSOS && styles.infoBadgeDanger,
              {
                opacity: badgeAnim,
                transform: [
                  {
                    scale: badgeAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.35, 1],
                    }),
                  },
                  {
                    translateY: badgeAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [12, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={styles.markerTitleRow}>
              <View style={[styles.markerTitleDot, { backgroundColor: isSOS ? '#DC2626' : markerColor }]} />
              <Text style={[styles.memberName, isSOS && styles.memberNameDanger]} numberOfLines={1}>
                {isSOS ? `🚨 ${member.name} (IN DANGER!)` : isSelf ? 'You (Live)' : isTarget ? `${member.name} (Destination)` : member.name}
              </Text>
            </View>
            <Text style={[styles.metaText, isSOS && styles.metaTextDanger]}>
              {isSOS
                ? `🚨 SOS DISTRESS ACTIVE • ±${Math.round(member.accuracy || 5)}m${batteryPct !== null ? ` • ${isCharging ? '⚡' : '🔋'} ${batteryPct}% (${batteryHealthStr})` : ''}`
                : isSelf
                ? `${member.speed > 1 ? `${Math.round(member.speed * 3.6)} km/h • ` : ''}Live GPS${batteryPct !== null ? ` • ${isCharging ? '⚡' : '🔋'} ${batteryPct}% ${batteryHealthStr}` : ''} • ±${Math.round(member.accuracy || 5)}m`
                : status.isActive
                  ? `${member.speed > 1 ? `Moving ${Math.round(member.speed * 3.6)} km/h` : 'Stationary'}${batteryPct !== null ? ` • ${isCharging ? '⚡' : '🔋'} ${batteryPct}% ${batteryHealthStr}` : ''} • ±${Math.round(member.accuracy || 5)}m`
                  : `Offline • ${status.fromAgo}${batteryPct !== null ? ` • ${batteryPct}%` : ''}`}
            </Text>
          </Animated.View>
        )}

        {/* Downward Pointer Triangle with matching smooth animation */}
        {isBadgeVisible && (
          <Animated.View
            style={[
              styles.nameBoxPointer,
              isSOS && styles.nameBoxPointerDanger,
              {
                opacity: badgeAnim,
                transform: [
                  {
                    scale: badgeAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.35, 1],
                    }),
                  },
                ],
              },
            ]}
          />
        )}

        {/* Avatar Frame with spring scale */}
        <Animated.View
          style={[
            styles.avatarFrame,
            {
              borderColor: isSOS ? '#DC2626' : markerColor,
              transform: [{ scale: avatarScale }],
            },
            isSelected && styles.avatarFrameSelected,
            isSOS && styles.avatarFrameDanger,
            isSelf && isNavigating && { borderWidth: 3.5, borderColor: '#2563EB' },
          ]}
        >
          {member.avatarUrl ? (
            <Image source={{ uri: member.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatarFallback, { backgroundColor: isSOS ? '#DC2626' : markerColor }]}>
              {isSelf ? (
                <Ionicons name="navigate" size={16} color="#FFFFFF" />
              ) : (
                <Text style={styles.avatarInitial}>
                  {member.name ? member.name.charAt(0).toUpperCase() : '?'}
                </Text>
              )}
            </View>
          )}
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isSOS ? '#DC2626' : member.speed > 1 ? '#22C55E' : status.color },
            ]}
          />
          {isSOS && (
            <View style={styles.sosMarkerBadge}>
              <Ionicons name="warning" size={10} color="#FFFFFF" />
            </View>
          )}
        </Animated.View>

        {/* Always-Visible Live Battery Health Badge on Map Pin */}
        {batteryPct !== null && (
          <View style={[styles.mapBatteryPill, { backgroundColor: batteryColor }]}>
            <Ionicons
              name={isCharging ? 'flash' : batteryPct <= 20 ? 'battery-dead' : batteryPct <= 50 ? 'battery-half' : 'battery-full'}
              size={9}
              color="#FFFFFF"
            />
            <Text style={styles.mapBatteryPillText}>{batteryPct}%</Text>
          </View>
        )}
      </Animated.View>
    </Marker>
  );
};

export const FamilyMapExpo = forwardRef<FamilyMap3DHandle, FamilyMap3DProps>(
  (
    {
      members,
      selectedMemberId: propSelectedId,
      onSelectMember,
      onCancelFocus,
      showMemberStrip = false,
      onMapInteraction,
      showSafetyPOIs = true,
      navigationRoute,
      initialWeatherVisible = false,
      isWeatherVisible: controlledWeatherVisible,
      onToggleWeather: controlledOnToggleWeather,
      weatherMode: controlledWeatherMode,
      activeTileUrl: controlledActiveTileUrl,
      windSpeedMs: controlledWindSpeedMs,
      windDirectionDeg: controlledWindDirectionDeg,
      weatherBottomOffset,
    },
    ref
  ) => {
    const mapRef = useRef<any>(null);
    const isMarkerTappedRef = useRef(false);
    const [mapType, setMapType] = useState<'standard' | 'satellite' | 'hybrid'>('standard');
    const [internalSelectedId, setInternalSelectedId] = useState<string | null>(
      members[0]?.id ?? null
    );
    const [safetyGeoJSON, setSafetyGeoJSON] = useState<GeoJSON.FeatureCollection>(INITIAL_SAFETY_GEOJSON);

    // Weather state (controlled from parent screen or internal fallback)
    const isControlled = controlledWeatherVisible !== undefined;
    const [internalWeatherVisible, setInternalWeatherVisible] = useState<boolean>(initialWeatherVisible);
    const [internalWeatherMode, setInternalWeatherMode] = useState<WeatherDisplayMode>('both');
    const [radarData, setRadarData] = useState<RainViewerData | null>(null);
    const [activeFrameIndex, setActiveFrameIndex] = useState<number>(0);
    const [pointForecast, setPointForecast] = useState<PointForecast | null>(null);
    const [selectedHourIndex, setSelectedHourIndex] = useState<number>(0);
    const [isLoadingWeather, setIsLoadingWeather] = useState<boolean>(false);
    const [isCameraMoving, setIsCameraMoving] = useState<boolean>(false);

    const isWeatherVisible = isControlled ? Boolean(controlledWeatherVisible) : internalWeatherVisible;
    const weatherMode = controlledWeatherMode ?? internalWeatherMode;

    const activeSelectedId = propSelectedId !== undefined ? propSelectedId : internalSelectedId;

    const centerLat = members[0]?.latitude ?? 14.7275;
    const centerLng = members[0]?.longitude ?? 120.5378;

    // Filter displayed members:
    // In normal mode: keep all family members on the map so they don't abruptly vanish when focusing!
    // In navigation/route mode: focus on You and the target destination member.
    const displayedMembers = React.useMemo(() => {
      if (navigationRoute) {
        const youMember = members.find((m) => m.relationship === 'You') || members[0];
        const targetMember = navigationRoute.targetMemberId
          ? members.find((m) => m.id === navigationRoute.targetMemberId)
          : members.find((m) => m.id === activeSelectedId);

        const list: FamilyMember3D[] = [];
        if (youMember) list.push(youMember);
        if (targetMember && targetMember.id !== youMember?.id) {
          list.push(targetMember);
        }
        // Always retain any family member in active SOS so distress status is never lost
        members.forEach((m) => {
          if (m.isSOS && !list.some((existing) => existing.id === m.id)) {
            list.push(m);
          }
        });
        return list;
      }

      return members;
    }, [members, navigationRoute]);

    const [dangerPulseRadius, setDangerPulseRadius] = useState(60);

    // Smoothly expand and pulse danger radius when any family member is in SOS distress
    useEffect(() => {
      const hasSOS = displayedMembers.some((m) => m.isSOS);
      if (!hasSOS) return;

      let expanding = true;
      const interval = setInterval(() => {
        setDangerPulseRadius((prev) => {
          if (prev >= 92) expanding = false;
          if (prev <= 42) expanding = true;
          return expanding ? prev + 3 : prev - 3;
        });
      }, 55);

      return () => clearInterval(interval);
    }, [displayedMembers]);

    // Load safety POIs around user area
    useEffect(() => {
      if (!showSafetyPOIs) return;
      const bbox: [number, number, number, number] = [
        centerLat - 0.08,
        centerLng - 0.08,
        centerLat + 0.08,
        centerLng + 0.08,
      ];
      fetchAndCacheSafetyPOIs(bbox)
        .then(setSafetyGeoJSON)
        .catch((err) => console.warn('[SafetyPOIService] Load error:', err));
    }, [centerLat, centerLng, showSafetyPOIs]);

    // Load weather data on demand or when center changes (only when not controlled from parent)
    useEffect(() => {
      if (isControlled || !isWeatherVisible) return;
      let isMounted = true;
      setIsLoadingWeather(true);

      Promise.all([
        fetchRainViewerFrames(),
        fetchPointForecast(centerLat, centerLng),
      ])
        .then(([rvData, fcData]) => {
          if (!isMounted) return;
          setRadarData(rvData);
          if (rvData.frames.length > 0) {
            setActiveFrameIndex(rvData.frames.length - 1);
          }
          if (fcData) {
            setPointForecast(fcData);
            setSelectedHourIndex(getCurrentHourIndex(fcData.hourly));
          }
          setIsLoadingWeather(false);
        })
        .catch((err) => {
          console.warn('[FamilyMapExpo] Weather load error:', err);
          if (isMounted) setIsLoadingWeather(false);
        });

      return () => {
        isMounted = false;
      };
    }, [isControlled, isWeatherVisible, centerLat, centerLng]);

    const activeTileUrl = useMemo(() => {
      if (controlledActiveTileUrl !== undefined) return controlledActiveTileUrl;
      if (!radarData || !radarData.frames || radarData.frames.length === 0) return null;
      const frame = radarData.frames[activeFrameIndex] || radarData.frames[radarData.frames.length - 1];
      if (!frame) return null;
      return getRainViewerTileUrl(radarData.host, frame.path, 512, 2, 1, 1);
    }, [controlledActiveTileUrl, radarData, activeFrameIndex]);

    const currentWindSpeedMs = useMemo(() => {
      if (controlledWindSpeedMs !== undefined) return controlledWindSpeedMs;
      if (!pointForecast?.hourly?.wind_speed_10m) return 3.5;
      const speedKmh = pointForecast.hourly.wind_speed_10m[selectedHourIndex] ?? 12;
      return speedKmh / 3.6;
    }, [controlledWindSpeedMs, pointForecast, selectedHourIndex]);

    const currentWindDirectionDeg = useMemo(() => {
      if (controlledWindDirectionDeg !== undefined) return controlledWindDirectionDeg;
      if (!pointForecast?.hourly?.wind_direction_10m) return 45;
      return pointForecast.hourly.wind_direction_10m[selectedHourIndex] ?? 45;
    }, [controlledWindDirectionDeg, pointForecast, selectedHourIndex]);

    const handleFocusOnMember = (member: FamilyMember3D) => {
      isMarkerTappedRef.current = true;
      setTimeout(() => {
        isMarkerTappedRef.current = false;
      }, 350);

      setInternalSelectedId(member.id);
      onSelectMember?.(member);
      // Smooth cinematic zoom directly on the focused member
      mapRef.current?.animateToRegion({
        latitude: member.latitude,
        longitude: member.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      }, 850);
    };

    const handleMapPress = (e?: any) => {
      if (isMarkerTappedRef.current) return;

      onMapInteraction?.();

      // If a member is focused, tapping elsewhere on the map cancels focus and smoothly zooms to overview
      if (activeSelectedId) {
        setInternalSelectedId(null);
        onCancelFocus?.();
        onSelectMember?.(null);

        mapRef.current?.animateToRegion({
          latitude: e?.nativeEvent?.coordinate?.latitude ?? centerLat,
          longitude: e?.nativeEvent?.coordinate?.longitude ?? centerLng,
          latitudeDelta: 0.018,
          longitudeDelta: 0.018,
        }, 850);
      }
    };

    useImperativeHandle(ref, () => ({
      focusOnMember: (memberId: string) => {
        const member = members.find((m) => m.id === memberId);
        if (member) {
          handleFocusOnMember(member);
        }
      },
      focusOnCoordinates: (latitude: number, longitude: number, memberId?: string) => {
        if (memberId) {
          setInternalSelectedId(memberId);
          const member = members.find((m) => m.id === memberId);
          if (member) {
            onSelectMember?.(member);
          }
        }
        // Smooth cinematic zoom directly on the coordinates
        mapRef.current?.animateToRegion({
          latitude,
          longitude,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        }, 850);
      },
      flyTo: (options) => {
        const [lng, lat] = options.center;
        mapRef.current?.animateToRegion({
          latitude: lat,
          longitude: lng,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        }, options.duration ?? 850);
      },
      animateToRegion: (region, duration = 850) => {
        mapRef.current?.animateToRegion({
          latitude: region.latitude,
          longitude: region.longitude,
          latitudeDelta: region.latitudeDelta ?? 0.005,
          longitudeDelta: region.longitudeDelta ?? 0.005,
        }, duration);
      },
    }), [members, onSelectMember]);

    const cycleMapType = () => {
      onMapInteraction?.();
      setMapType((prev) => (prev === 'standard' ? 'hybrid' : prev === 'hybrid' ? 'satellite' : 'standard'));
    };

    const recenterToUser = () => {
      onMapInteraction?.();
      setInternalSelectedId(null);
      const target = members[0];
      if (target) {
        mapRef.current?.animateToRegion({
          latitude: target.latitude,
          longitude: target.longitude,
          latitudeDelta: 0.015,
          longitudeDelta: 0.015,
        }, 850);
      }
    };

    return (
      <View style={styles.container} onTouchStart={() => onMapInteraction?.()}>
        <MapView
          ref={mapRef}
          style={styles.map}
          mapType={mapType}
          initialRegion={{
            latitude: centerLat,
            longitude: centerLng,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          }}
          onPanDrag={() => onMapInteraction?.()}
          onPress={handleMapPress}
          onRegionChange={() => setIsCameraMoving(true)}
          onRegionChangeComplete={() => setIsCameraMoving(false)}
          showsCompass={false}
          showsMyLocationButton={false}
        >
          {/* RainViewer Live Precipitation Radar Overlay (Below annotations & markers) */}
          {isWeatherVisible && (weatherMode === 'both' || weatherMode === 'radar') && activeTileUrl && (
            <UrlTile
              urlTemplate={activeTileUrl}
              zIndex={1}
              opacity={0.68}
              maximumZ={7}
            />
          )}

          {/* Active Turn-by-Turn Navigation Route (Real Road Curves / Offline Vector) */}
          {navigationRoute && (
            <>
              {/* Outer Casing / Glow */}
              <Polyline
                coordinates={
                  navigationRoute.coordinates && navigationRoute.coordinates.length > 0
                    ? navigationRoute.coordinates
                    : [navigationRoute.from, navigationRoute.to]
                }
                strokeColor="rgba(6, 78, 59, 0.8)"
                strokeWidth={7}
                zIndex={100}
              />
              {/* Inner High-Visibility Neon Route */}
              <Polyline
                coordinates={
                  navigationRoute.coordinates && navigationRoute.coordinates.length > 0
                    ? navigationRoute.coordinates
                    : [navigationRoute.from, navigationRoute.to]
                }
                strokeColor={navigationRoute.isOffline ? '#F59E0B' : '#10B981'}
                strokeWidth={4.5}
                lineDashPattern={navigationRoute.isOffline ? [10, 6] : undefined}
                zIndex={101}
              />
              {/* Destination Flag Marker */}
              <Marker
                coordinate={navigationRoute.to}
                anchor={{ x: 0.5, y: 0.5 }}
                zIndex={102}
              >
                <View
                  style={{
                    backgroundColor: navigationRoute.isOffline ? '#D97706' : '#10B981',
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 12,
                    borderWidth: 2,
                    borderColor: '#FFFFFF',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Ionicons name="flag" size={13} color="#FFFFFF" />
                  <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '700' }}>
                    {navigationRoute.label || 'Destination'}
                  </Text>
                </View>
              </Marker>
            </>
          )}

          {/* 1. Historical Route Trails */}
          {displayedMembers.map((m) => {
            if (!m.routeHistory || m.routeHistory.length < 2) return null;
            const coords = m.routeHistory.map(([lng, lat]) => ({
              latitude: lat,
              longitude: lng,
            }));
            return (
              <Polyline
                key={`route-${m.id}`}
                coordinates={coords}
                strokeColor={m.color || '#2563EB'}
                strokeWidth={3.5}
              />
            );
          })}

          {/* 2. Safety & Evacuation POIs */}
          {showSafetyPOIs &&
            safetyGeoJSON.features.map((feature: any) => {
              const coords = feature.geometry?.coordinates;
              if (!coords || coords.length < 2) return null;
              const [lon, lat] = coords;
              const { id, name, category, phone } = feature.properties || {};
              const conf = POI_CONFIG[category] || POI_CONFIG.school;

              return (
                <Marker
                  key={`poi-${id}`}
                  coordinate={{ latitude: lat, longitude: lon }}
                  anchor={{ x: 0.5, y: 0.5 }}
                  tracksViewChanges={false}
                  onPress={() => {
                    isMarkerTappedRef.current = true;
                    setTimeout(() => {
                      isMarkerTappedRef.current = false;
                    }, 350);

                    const props = feature.properties || {};
                    const typeLabel = props.type || conf.label;
                    const details = [
                      `Type: ${typeLabel}`,
                      props.address ? `Location: ${props.address}` : null,
                      props.phone ? `Emergency Contact: ${props.phone}` : null,
                    ].filter(Boolean).join('\n');

                    Alert.alert(
                      props.name || conf.label,
                      details
                    );
                  }}
                >
                  <View style={[styles.poiBadge, { backgroundColor: conf.color }]}>
                    <Ionicons name={conf.icon} size={13} color="#FFFFFF" />
                  </View>
                </Marker>
              );
            })}

          {/* 3. Family Member Markers with Smooth Animation */}
          {displayedMembers.map((member) => {
            const isSelf = member.relationship === 'You';
            const isTarget = navigationRoute && (member.id === navigationRoute.targetMemberId || member.name === navigationRoute.label);
            const isNavigating = Boolean(navigationRoute);
            const isSelected = member.id === activeSelectedId || isTarget || (isNavigating && isSelf);
            const status = getTrackingStatus(member.lastUpdated, true);
            const markerColor = member.isSOS ? '#DC2626' : isSelf ? '#2563EB' : isTarget ? '#10B981' : (member.color || Colors.tracker);

            return (
              <React.Fragment key={`member-group-${member.id}`}>
                {/* Regular selection accuracy circle */}
                {isSelected && !member.isSOS && (
                  <Circle
                    center={{ latitude: member.latitude, longitude: member.longitude }}
                    radius={Math.max(5, Math.min(member.accuracy || 15, 100))}
                    fillColor={isSelf ? 'rgba(37, 99, 235, 0.12)' : 'rgba(16, 185, 129, 0.12)'}
                    strokeColor={isSelf ? 'rgba(37, 99, 235, 0.35)' : 'rgba(16, 185, 129, 0.35)'}
                    strokeWidth={1}
                    zIndex={90}
                  />
                )}

                {/* Animated Red Danger Zone Circles when member sent an SOS */}
                {member.isSOS && (
                  <>
                    <Circle
                      key={`danger-circle-outer-${member.id}`}
                      center={{ latitude: member.latitude, longitude: member.longitude }}
                      radius={dangerPulseRadius}
                      fillColor="rgba(220, 38, 38, 0.20)"
                      strokeColor="#DC2626"
                      strokeWidth={2.5}
                      zIndex={96}
                    />
                    <Circle
                      key={`danger-circle-inner-${member.id}`}
                      center={{ latitude: member.latitude, longitude: member.longitude }}
                      radius={Math.max(12, Math.round(dangerPulseRadius * 0.45))}
                      fillColor="rgba(239, 68, 68, 0.35)"
                      strokeColor="#991B1B"
                      strokeWidth={1.5}
                      zIndex={97}
                    />
                    <Marker
                      key={`danger-radar-${member.id}`}
                      coordinate={{ latitude: member.latitude, longitude: member.longitude }}
                      anchor={{ x: 0.5, y: 0.5 }}
                      flat={true}
                      zIndex={98}
                      tracksViewChanges={true}
                    >
                      <AnimatedDangerRadar />
                    </Marker>
                  </>
                )}

                {/* Flat Directional Marker: Locked to true ground heading, rotates with map gestures */}
                {member.heading != null && !isNaN(member.heading) && (
                  <Marker
                    key={`flat-heading-${member.id}`}
                    coordinate={{ latitude: member.latitude, longitude: member.longitude }}
                    anchor={{ x: 0.5, y: 0.5 }}
                    flat={true}
                    rotation={member.heading}
                    zIndex={isSelf ? 190 : 140}
                    tracksViewChanges={false}
                  >
                    <FlatHeadingIndicator
                      heading={member.heading}
                      markerColor={markerColor}
                      isSelf={isSelf}
                    />
                  </Marker>
                )}

                <AnimatedFamilyMarker
                  key={`animated-marker-${member.id}`}
                  member={member}
                  isSelected={Boolean(isSelected)}
                  isSelf={isSelf}
                  isTarget={Boolean(isTarget)}
                  isNavigating={isNavigating}
                  markerColor={markerColor}
                  status={status}
                  onPress={() => handleFocusOnMember(member)}
                />
              </React.Fragment>
            );
          })}
        </MapView>

        {/* Animated Wind Particle Streamlines Overlay (Windy Signature Look) */}
        {isWeatherVisible && (weatherMode === 'both' || weatherMode === 'wind') && (
          <WindParticleOverlay
            windSpeedMs={currentWindSpeedMs}
            windDirectionDeg={currentWindDirectionDeg}
            isActive={isWeatherVisible}
            isPaused={isCameraMoving}
            mapBearing={0}
          />
        )}

        {/* Floating Controls */}
        <View style={styles.controlsPanel}>
          <TouchableOpacity
            style={styles.controlButton}
            onPress={recenterToUser}
            activeOpacity={0.8}
          >
            <Ionicons name="locate" size={20} color="#FFFFFF" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlButton}
            onPress={cycleMapType}
            activeOpacity={0.8}
          >
            <Ionicons name="layers" size={20} color="#FFFFFF" />
          </TouchableOpacity>

          {/* Live Weather / Radar & Wind Particles Toggle */}
          <TouchableOpacity
            style={[styles.controlButton, isWeatherVisible && styles.controlButtonActive]}
            onPress={() => {
              onMapInteraction?.();
              if (controlledOnToggleWeather) {
                controlledOnToggleWeather();
              } else {
                setInternalWeatherVisible((prev) => !prev);
              }
            }}
            activeOpacity={0.8}
          >
            <Ionicons
              name={isWeatherVisible ? 'rainy' : 'cloud-outline'}
              size={20}
              color={isWeatherVisible ? '#38BDF8' : '#FFFFFF'}
            />
          </TouchableOpacity>
        </View>

        {/* Live Weather Radar HUD (Only rendered internally when NOT controlled by parent screen) */}
        {!isControlled && isWeatherVisible && (
          <WeatherHUD
            forecast={pointForecast}
            radarFrames={radarData?.frames ?? []}
            activeFrameIndex={activeFrameIndex}
            onSelectFrameIndex={setActiveFrameIndex}
            selectedHourIndex={selectedHourIndex}
            onSelectHourIndex={setSelectedHourIndex}
            displayMode={weatherMode}
            onChangeDisplayMode={setInternalWeatherMode}
            onClose={() => setInternalWeatherVisible(false)}
            isLoading={isLoadingWeather}
            bottomOffset={weatherBottomOffset}
          />
        )}

        {/* Optional Member Strip */}
        {showMemberStrip && (
          <View style={styles.familyStrip}>
            {members.map((member) => (
              <TouchableOpacity
                key={member.id}
                style={[
                  styles.memberChip,
                  activeSelectedId === member.id && styles.memberChipActive,
                ]}
                onPress={() => handleFocusOnMember(member)}
              >
                <View
                  style={[
                    styles.chipDot,
                    { backgroundColor: member.isOnline ? '#22C55E' : '#94A3B8' },
                  ]}
                />
                <Text style={styles.chipText}>{member.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  markerContainer: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoBadge: {
    position: 'absolute',
    bottom: 52,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 5,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    minWidth: 90,
  },
  infoBadgeSelected: {
    backgroundColor: '#FFFFFF',
    borderColor: '#CBD5E1',
    shadowOpacity: 0.22,
    shadowRadius: 7,
    elevation: 7,
  },
  nameBoxPointer: {
    position: 'absolute',
    bottom: 46,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 6,
    borderStyle: 'solid',
    backgroundColor: 'transparent',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#FFFFFF',
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  flatHeadingContainer: {
    width: 90,
    height: 90,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  flatVisionBeamCone: {
    position: 'absolute',
    top: 2,
    left: 45 - 26,
    width: 0,
    height: 0,
    borderLeftWidth: 26,
    borderRightWidth: 26,
    borderTopWidth: 32,
    borderStyle: 'solid',
    backgroundColor: 'transparent',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  flatDirectionArrow: {
    position: 'absolute',
    top: 14,
    left: 45 - 6,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 10,
    borderStyle: 'solid',
    backgroundColor: 'transparent',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 2,
  },
  flatBeamCore: {
    position: 'absolute',
    top: 9,
    left: 45 - 12,
    width: 24,
    height: 24,
    borderRadius: 12,
    transform: [{ scaleX: 1.3 }],
  },
  markerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  markerTitleDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  memberName: {
    color: '#0F172A',
    fontSize: 11.5,
    fontWeight: '700',
  },
  metaText: {
    color: '#64748B',
    fontSize: 9.5,
    fontWeight: '600',
    marginTop: 1,
  },
  avatarFrame: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  avatarFrameSelected: {
    transform: [{ scale: 1.12 }],
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  avatarFallback: {
    width: 38,
    height: 38,
    borderRadius: 19,
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
    bottom: -1,
    right: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  mapBatteryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 8,
    marginTop: -6,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 3,
  },
  mapBatteryPillText: {
    color: '#FFFFFF',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  pointerTip: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: -1,
  },
  poiBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
  controlsPanel: {
    position: 'absolute',
    top: 54,
    right: 16,
    gap: 10,
  },
  controlButton: {
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
  controlButtonActive: {
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderWidth: 1.5,
    borderColor: '#38BDF8',
  },
  familyStrip: {
    position: 'absolute',
    bottom: 32,
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  memberChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  memberChipActive: {
    backgroundColor: '#2563EB',
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chipText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  dangerRadarContainer: {
    width: 100,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerRadarWave: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: '#DC2626',
    backgroundColor: 'rgba(239, 68, 68, 0.22)',
  },
  dangerRadarCenterDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#DC2626',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  infoBadgeDanger: {
    backgroundColor: '#FEF2F2',
    borderColor: '#DC2626',
    borderWidth: 1.5,
    borderLeftWidth: 4,
    shadowColor: '#DC2626',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 7,
  },
  nameBoxPointerDanger: {
    borderTopColor: '#DC2626',
  },
  memberNameDanger: {
    color: '#DC2626',
    fontWeight: '800',
  },
  metaTextDanger: {
    color: '#B91C1C',
    fontWeight: '700',
  },
  avatarFrameDanger: {
    borderColor: '#DC2626',
    borderWidth: 4,
    backgroundColor: '#FEF2F2',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 10,
    elevation: 12,
  },
  sosMarkerBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#DC2626',
    borderRadius: 10,
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    zIndex: 10,
  },
});

