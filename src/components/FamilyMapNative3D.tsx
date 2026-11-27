import React, { useRef, useState, useEffect, useMemo, useImperativeHandle, forwardRef } from 'react';
import { StyleSheet, View, Text, Image, TouchableOpacity, Alert, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { HeadingBeamSvg, PinPointerTipSvg } from './MarkerVisuals';
import { getTrackingStatus } from '../utils/tracking';
import { fetchAndCacheSafetyPOIs, INITIAL_SAFETY_GEOJSON } from '../services/SafetyPOIService';
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

// Dynamically obtain MapLibre components if linked
const getMapLibre = () => {
  try {
    return require('@maplibre/maplibre-react-native');
  } catch (e) {
    return null;
  }
};

const SAFETY_ICONS = {
  school: require('../../assets/icons/school-pin.png'),
  hospital: require('../../assets/icons/hospital-pin.png'),
  police: require('../../assets/icons/police-pin.png'),
  fire_station: require('../../assets/icons/fire-pin.png'),
  evacuation: require('../../assets/icons/evacuation-pin.png'),
};

export const OPENFREEMAP_STYLES = {
  liberty: 'https://tiles.openfreemap.org/styles/liberty',
  bright: 'https://tiles.openfreemap.org/styles/bright',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

const SafetyMarkersOverlay: React.FC<{ centerLat?: number; centerLng?: number; MapLibre: any }> = ({
  centerLat,
  centerLng,
  MapLibre,
}) => {
  const { Images, GeoJSONSource, Layer } = MapLibre;
  const [safetyGeoJSON, setSafetyGeoJSON] = useState<GeoJSON.FeatureCollection>(INITIAL_SAFETY_GEOJSON);

  useEffect(() => {
    const lat = centerLat ?? 14.7275;
    const lng = centerLng ?? 120.5378;
    const bbox: [number, number, number, number] = [
      lat - 0.08,
      lng - 0.08,
      lat + 0.08,
      lng + 0.08,
    ];
    fetchAndCacheSafetyPOIs(bbox).then(setSafetyGeoJSON);
  }, [centerLat, centerLng]);

  return (
    <>
      <Images images={SAFETY_ICONS} />
      <GeoJSONSource
        id="safety-pois-source"
        data={safetyGeoJSON}
        cluster={true}
        clusterRadius={40}
        clusterMaxZoom={14}
        onPress={(event: any) => {
          const feature = event.features?.[0];
          if (!feature) return;
          const props = feature.properties;
          if (props?.cluster) return;

          const typeLabel = props?.type || (props?.category ? props.category.toUpperCase() : 'Safety Location');
          const details = [
            `Type: ${typeLabel}`,
            props?.address ? `Location: ${props.address}` : null,
            props?.phone ? `Emergency Contact: ${props.phone}` : null,
          ].filter(Boolean).join('\n');

          Alert.alert(
            props?.name ?? 'Safety Location',
            details
          );
        }}
      >
        <Layer
          id="safety-poi-halo"
          type="circle"
          source="safety-pois-source"
          filter={['!', ['has', 'point_count']]}
          paint={{
            'circle-radius': 16,
            'circle-color': [
              'match',
              ['get', 'category'],
              'evacuation', '#16A34A',
              'hospital', '#DC2626',
              'fire_station', '#EA580C',
              'police', '#1D4ED8',
              'school', '#7C3AED',
              '#475569',
            ],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#FFFFFF',
          }}
        />
        <Layer
          id="safety-poi-symbols"
          type="symbol"
          source="safety-pois-source"
          filter={['!', ['has', 'point_count']]}
          layout={{
            'icon-image': ['get', 'category'],
            'icon-size': 0.5,
            'icon-allow-overlap': true,
            'icon-pitch-alignment': 'viewport',
            'text-field': ['get', 'name'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 11,
            'text-offset': [0, 1.8],
            'text-anchor': 'top',
            'text-optional': true,
          }}
          paint={{
            'text-color': '#0F172A',
            'text-halo-color': '#FFFFFF',
            'text-halo-width': 1.5,
          }}
        />
        <Layer
          id="safety-poi-clusters"
          type="circle"
          source="safety-pois-source"
          filter={['has', 'point_count']}
          paint={{
            'circle-color': '#0D1F4E',
            'circle-radius': [
              'step',
              ['get', 'point_count'],
              16,
              10,
              20,
              50,
              26,
            ],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#FFFFFF',
          }}
        />
        <Layer
          id="safety-poi-cluster-count"
          type="symbol"
          source="safety-pois-source"
          filter={['has', 'point_count']}
          layout={{
            'text-field': '{point_count_abbreviated}',
            'text-font': ['Noto Sans Bold'],
            'text-size': 11,
          }}
          paint={{
            'text-color': '#FFFFFF',
          }}
        />
      </GeoJSONSource>
    </>
  );
};

const AnimatedNativeMarker: React.FC<{
  member: FamilyMember3D;
  isSelected: boolean;
  isSelf: boolean;
  isTarget: boolean;
  isNavigating: boolean;
  markerColor: string;
  statusColor: string;
  status: any;
  onPress: () => void;
  Marker: any;
  mapBearing?: number;
}> = ({
  member,
  isSelected,
  isSelf,
  isTarget,
  isNavigating,
  markerColor,
  statusColor,
  status,
  onPress,
  Marker,
  mapBearing = 0,
}) => {
  const isSOS = Boolean(member.isSOS);
  const effectiveMarkerColor = isSOS ? '#DC2626' : markerColor;
  const effectiveStatusColor = isSOS ? '#DC2626' : statusColor;
  const ringColor = isSOS ? '#DC2626' : isSelf && isNavigating ? '#2563EB' : effectiveMarkerColor;
  const beamColor = isSOS ? '#EF4444' : isSelf ? '#2563EB' : effectiveMarkerColor;
  const safeGradId = useMemo(
    () => (member.id || 'member').replace(/[^a-zA-Z0-9_-]/g, '') || 'member',
    [member.id]
  );

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

  const markerScale = useRef(new Animated.Value(0.1)).current;
  const markerOpacity = useRef(new Animated.Value(0)).current;
  const markerTranslateY = useRef(new Animated.Value(-24)).current;
  const avatarScale = useRef(new Animated.Value(isSOS ? 1.2 : isSelected ? 1.12 : 1)).current;
  const sosPulse = useRef(new Animated.Value(0)).current;

  const [isBadgeVisible, setIsBadgeVisible] = useState(isSelected || isSOS);
  const badgeAnim = useRef(new Animated.Value(isSelected || isSOS ? 1 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(markerScale, { toValue: 1, friction: 5, tension: 55, useNativeDriver: false }),
      Animated.timing(markerOpacity, { toValue: 1, duration: 280, useNativeDriver: false }),
      Animated.spring(markerTranslateY, { toValue: 0, friction: 5.5, tension: 60, useNativeDriver: false }),
    ]).start();
  }, []);

  useEffect(() => {
    if (!isSOS) {
      sosPulse.stopAnimation();
      sosPulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(sosPulse, {
        toValue: 1,
        duration: 1500,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [isSOS]);

  const sosPulseScale = sosPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.88, 1.72],
  });
  const sosPulseOpacity = sosPulse.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [0.75, 0.25, 0],
  });

  useEffect(() => {
    if (isSelected || isSOS) {
      setIsBadgeVisible(true);
      Animated.parallel([
        Animated.spring(avatarScale, { toValue: isSOS ? 1.2 : 1.12, friction: 6, tension: 70, useNativeDriver: false }),
        Animated.spring(badgeAnim, { toValue: 1, friction: 6, tension: 65, useNativeDriver: false }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.spring(avatarScale, { toValue: 1, friction: 6, tension: 70, useNativeDriver: false }),
        Animated.timing(badgeAnim, { toValue: 0, duration: 220, useNativeDriver: false }),
      ]).start(() => {
        setIsBadgeVisible(false);
      });
    }
  }, [isSelected, isSOS]);

  return (
    <Marker
      key={member.id}
      id={`marker-${member.id}`}
      lngLat={[member.longitude, member.latitude]}
      anchor="bottom"
      onPress={onPress}
    >
      <Animated.View
        style={[
          styles.markerContainer,
          {
            opacity: markerOpacity,
            transform: [{ scale: markerScale }, { translateY: markerTranslateY }],
          },
        ]}
      >
        {isBadgeVisible && (
          <Animated.View
            style={[
              styles.infoBadge,
              styles.infoBadgeSelected,
              { borderLeftColor: markerColor, borderLeftWidth: 3.5 },
              {
                opacity: badgeAnim,
                transform: [
                  { scale: badgeAnim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) },
                  { translateY: badgeAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
                ],
              },
            ]}
          >
            <View style={styles.markerTitleRow}>
              <View style={[styles.markerTitleDot, { backgroundColor: effectiveMarkerColor }]} />
              <Text style={[styles.memberName, isSOS && { color: '#DC2626', fontWeight: '800' }]} numberOfLines={1}>
                {isSOS ? `🚨 ${member.name} (IN DANGER!)` : isSelf ? 'You (Live)' : isTarget ? `${member.name} (Destination)` : member.name}
              </Text>
            </View>
            <Text style={[styles.metaText, isSOS && { color: '#B91C1C', fontWeight: '700' }]}>
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
        {isBadgeVisible && (
          <Animated.View
            style={[
              styles.nameBoxPointer,
              isSOS && { borderTopColor: '#DC2626' },
              {
                opacity: badgeAnim,
                transform: [{ scale: badgeAnim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }],
              },
            ]}
          />
        )}

        {/* Centered Marker Hub: Heading Beam, SOS Pulse Beacon, and Double-Ring Profile Photo */}
        <View style={styles.avatarAnchor}>
          {/* Facing Direction Indicator (Radial FOV Beam & Outer Chevron, compensated for map rotation) */}
          {member.heading != null && !isNaN(member.heading) && (
            <View
              pointerEvents="none"
              style={[
                styles.headingContainer,
                {
                  transform: [{ rotate: `${((member.heading ?? 0) - mapBearing + 360) % 360}deg` }],
                },
              ]}
            >
              <HeadingBeamSvg color={beamColor} gradientId={`heading-beam-${safeGradId}`} />
            </View>
          )}

          {/* Pulsing Emergency SOS Beacon Ring behind Avatar */}
          {isSOS && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.sosPulseRing,
                {
                  opacity: sosPulseOpacity,
                  transform: [{ scale: sosPulseScale }],
                },
              ]}
            />
          )}

          <Animated.View
            style={[
              styles.avatarFrame,
              isSOS && styles.avatarFrameSOS,
              isSelected && styles.avatarFrameSelected,
              { transform: [{ scale: avatarScale }] },
            ]}
          >
            <View style={[styles.avatarColorRing, { borderColor: ringColor }]}>
              {member.avatarUrl ? (
                <Image source={{ uri: member.avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatarFallback, { backgroundColor: ringColor }]}>
                  {isSelf ? (
                    <Ionicons name="navigate" size={16} color="#FFFFFF" />
                  ) : (
                    <Text style={styles.avatarInitial}>
                      {member.name ? member.name.charAt(0).toUpperCase() : '?'}
                    </Text>
                  )}
                </View>
              )}
            </View>

            {/* Status Dot / SOS Alert Badge placed at Top-Right to never overlap Battery Pill */}
            {isSOS ? (
              <View style={styles.sosMarkerBadge}>
                <Ionicons name="warning" size={10} color="#FFFFFF" />
              </View>
            ) : (
              <View style={[styles.statusDot, { backgroundColor: effectiveStatusColor }]} />
            )}
          </Animated.View>
        </View>

        {/* Bottom Stack: Live Battery Pill + Clean White-Outlined Pin Tip */}
        <View style={[styles.bottomPinStack, batteryPct === null && styles.bottomPinStackCompact]}>
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

          <View style={styles.pointerTipWrapper}>
            <PinPointerTipSvg color={ringColor} />
          </View>
        </View>
      </Animated.View>
    </Marker>
  );
};

export const FamilyMapNative3D = forwardRef<FamilyMap3DHandle, FamilyMap3DProps>(
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
    const MapLibre = useMemo(() => getMapLibre(), []);
    const cameraRef = useRef<any>(null);
    const isMarkerTappedRef = useRef(false);
    const [is3DMode, setIs3DMode] = useState<boolean>(true);
    const [selectedTheme, setSelectedTheme] = useState<'liberty' | 'bright' | 'dark'>('liberty');
    const [mapBearing, setMapBearing] = useState<number>(0);
    const [internalSelectedId, setInternalSelectedId] = useState<string | null>(
      members[0]?.id ?? null
    );

    // Weather state (controlled from parent screen or internal standalone fallback)
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

    // Filter displayed members:
    // 1. In navigation/route mode: ALWAYS show "You" AND the target member!
    // 2. In normal mode when a member is focused: show that member.
    // 3. Otherwise: show all members.
    const displayedMembers = useMemo(() => {
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
        return list;
      }

      if (activeSelectedId) {
        const focused = members.filter((m) => m.id === activeSelectedId);
        if (focused.length > 0) return focused;
      }
      return members;
    }, [members, activeSelectedId, navigationRoute]);

    const routeGeoJSON = useMemo(() => {
      return {
        type: 'FeatureCollection' as const,
        features: displayedMembers
          .filter((m) => m.routeHistory && m.routeHistory.length > 1)
          .map((m) => ({
            type: 'Feature' as const,
            id: `route-${m.id}`,
            properties: {
              memberId: m.id,
              color: m.color || (m.isOnline ? '#2563EB' : '#64748B'),
            },
            geometry: {
              type: 'LineString' as const,
              coordinates: m.routeHistory!,
            },
          })),
      };
    }, [displayedMembers]);

    const navigationRouteGeoJSON = useMemo(() => {
      if (!navigationRoute) return null;
      const coords =
        navigationRoute.coordinates && navigationRoute.coordinates.length > 0
          ? navigationRoute.coordinates.map((c) => [c.longitude, c.latitude])
          : [
              [navigationRoute.from.longitude, navigationRoute.from.latitude],
              [navigationRoute.to.longitude, navigationRoute.to.latitude],
            ];

      return {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            id: 'active-navigation-route',
            properties: {
              color: navigationRoute.isOffline ? '#F59E0B' : '#10B981',
            },
            geometry: {
              type: 'LineString' as const,
              coordinates: coords,
            },
          },
        ],
      };
    }, [navigationRoute]);

    const handleFocusOnMember = (member: FamilyMember3D) => {
      isMarkerTappedRef.current = true;
      setTimeout(() => {
        isMarkerTappedRef.current = false;
      }, 350);

      setInternalSelectedId(member.id);
      onSelectMember?.(member);
      cameraRef.current?.flyTo({
        center: [member.longitude, member.latitude],
        zoom: 18,
        pitch: is3DMode ? 55 : 0,
        bearing: -17.6,
        duration: 1000,
      });
    };

    const handleMapPress = () => {
      if (isMarkerTappedRef.current) return;
      onMapInteraction?.();
      if (activeSelectedId) {
        setInternalSelectedId(null);
        onCancelFocus?.();
        onSelectMember?.(null);
        cameraRef.current?.easeTo({
          zoom: 15,
          duration: 600,
        });
      }
    };

    useImperativeHandle(ref, () => ({
      focusOnMember: (memberId: string) => {
        const member = members.find((m) => m.id === memberId);
        if (member) handleFocusOnMember(member);
      },
      focusOnCoordinates: (latitude: number, longitude: number, memberId?: string) => {
        if (memberId) {
          setInternalSelectedId(memberId);
          const member = members.find((m) => m.id === memberId);
          if (member) onSelectMember?.(member);
        }
        cameraRef.current?.flyTo({
          center: [longitude, latitude],
          zoom: 18,
          pitch: is3DMode ? 55 : 0,
          bearing: -17.6,
          duration: 1000,
        });
      },
      flyTo: (options) => {
        cameraRef.current?.flyTo(options);
      },
      animateToRegion: (region, duration = 1000) => {
        cameraRef.current?.flyTo({
          center: [region.longitude, region.latitude],
          zoom: 18,
          pitch: is3DMode ? 55 : 0,
          bearing: is3DMode ? -17.6 : 0,
          duration,
        });
      },
    }), [members, is3DMode, onSelectMember]);

    if (!MapLibre) {
      return null;
    }

    const { Map, Camera, VectorSource, GeoJSONSource, Layer, Marker, RasterSource } = MapLibre;
    const centerLng = members[0]?.longitude ?? 120.5378;
    const centerLat = members[0]?.latitude ?? 14.7275;

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
          console.warn('[FamilyMapNative3D] Weather load error:', err);
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

    const toggle3DCamera = () => {
      const next3D = !is3DMode;
      setIs3DMode(next3D);
      cameraRef.current?.easeTo({
        center: [centerLng, centerLat],
        pitch: next3D ? 55 : 0,
        bearing: next3D ? -17.6 : 0,
        duration: 600,
      });
    };

    return (
      <View style={styles.container} onTouchStart={() => onMapInteraction?.()}>
        <Map
          style={styles.map}
          mapStyle={OPENFREEMAP_STYLES[selectedTheme]}
          onPress={handleMapPress}
          onRegionWillChange={(e: any) => {
            setIsCameraMoving(true);
            if (e.nativeEvent?.userInteraction) onMapInteraction?.();
          }}
          onRegionIsChanging={(e: any) => {
            if (e.nativeEvent?.userInteraction) onMapInteraction?.();
            const heading = e.properties?.heading ?? e.nativeEvent?.properties?.heading;
            if (typeof heading === 'number' && !isNaN(heading)) {
              setMapBearing(heading);
            }
          }}
          onRegionDidChange={(e: any) => {
            setIsCameraMoving(false);
            const heading = e.properties?.heading ?? e.nativeEvent?.properties?.heading;
            if (typeof heading === 'number' && !isNaN(heading)) {
              setMapBearing(heading);
            }
          }}
        >
          <Camera
            ref={cameraRef}
            initialViewState={{
              center: [centerLng, centerLat],
              zoom: 16,
              pitch: 55,
              bearing: -17.6,
            }}
          />

          {/* RainViewer Live & Forecast Precipitation Radar Overlay - Mounted below 3D extruded buildings */}
          {isWeatherVisible && (weatherMode === 'both' || weatherMode === 'radar') && activeTileUrl && RasterSource && (
            <RasterSource
              id="rainviewer-source"
              tiles={[activeTileUrl]}
              tileSize={512}
              maxzoom={7}
              attribution="Weather data by RainViewer"
            >
              <Layer
                id="rainviewer-layer"
                type="raster"
                beforeId="3d-buildings-extrusion"
                paint={{
                  'raster-opacity': 0.68,
                  'raster-fade-duration': 300,
                }}
              />
            </RasterSource>
          )}

          <VectorSource id="openfreemap-planet" url="https://tiles.openfreemap.org/planet">
            <Layer
              id="3d-buildings-extrusion"
              type="fill-extrusion"
              source="openfreemap-planet"
              source-layer="building"
              minzoom={15}
              filter={['!=', ['get', 'hide_3d'], true]}
              paint={{
                'fill-extrusion-color': [
                  'interpolate',
                  ['linear'],
                  ['get', 'render_height'],
                  0,
                  selectedTheme === 'dark' ? '#1E293B' : '#E2E8F0',
                  100,
                  selectedTheme === 'dark' ? '#334155' : '#CBD5E1',
                  250,
                  selectedTheme === 'dark' ? '#475569' : '#94A3B8',
                ],
                'fill-extrusion-height': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  15,
                  0,
                  15.5,
                  ['get', 'render_height'],
                ],
                'fill-extrusion-base': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  15,
                  0,
                  15.5,
                  ['get', 'render_min_height'],
                ],
                'fill-extrusion-opacity': 0.85,
                'fill-extrusion-vertical-gradient': true,
              }}
            />
          </VectorSource>

          {navigationRouteGeoJSON && (
            <GeoJSONSource id="nav-route-source" data={navigationRouteGeoJSON}>
              <Layer
                id="nav-route-line-casing"
                type="line"
                source="nav-route-source"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{
                  'line-color': '#064E3B',
                  'line-width': 7,
                  'line-opacity': 0.8,
                }}
              />
              <Layer
                id="nav-route-line"
                type="line"
                source="nav-route-source"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{
                  'line-color': ['get', 'color'],
                  'line-width': 4.5,
                  'line-opacity': 1,
                }}
              />
            </GeoJSONSource>
          )}

          <GeoJSONSource id="family-routes" data={routeGeoJSON}>
            <Layer
              id="family-route-lines"
              type="line"
              source="family-routes"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{
                'line-color': ['get', 'color'],
                'line-width': 4,
                'line-opacity': 0.8,
              }}
            />
          </GeoJSONSource>

          {showSafetyPOIs && (
            <SafetyMarkersOverlay centerLat={centerLat} centerLng={centerLng} MapLibre={MapLibre} />
          )}

          {displayedMembers.map((member) => {
            const isSelf = member.relationship === 'You';
            const isTarget = navigationRoute && (member.id === navigationRoute.targetMemberId || member.name === navigationRoute.label);
            const isNavigating = Boolean(navigationRoute);
            const isSelected = member.id === activeSelectedId || isTarget || (isNavigating && isSelf);
            const status = getTrackingStatus(member.lastUpdated, true);
            const statusColor = member.speed > 1 ? '#22C55E' : status.color;
            const markerColor = isSelf ? '#2563EB' : isTarget ? '#10B981' : (member.color || '#2176AE');

            return (
              <AnimatedNativeMarker
                key={member.id}
                member={member}
                isSelected={Boolean(isSelected)}
                isSelf={isSelf}
                isTarget={Boolean(isTarget)}
                isNavigating={isNavigating}
                markerColor={markerColor}
                statusColor={statusColor}
                status={status}
                onPress={() => handleFocusOnMember(member)}
                Marker={Marker}
                mapBearing={mapBearing}
              />
            );
          })}
        </Map>

        {/* Animated Wind Particle Streamlines Overlay (Windy Signature Look) */}
        {isWeatherVisible && (weatherMode === 'both' || weatherMode === 'wind') && (
          <WindParticleOverlay
            windSpeedMs={currentWindSpeedMs}
            windDirectionDeg={currentWindDirectionDeg}
            isActive={isWeatherVisible}
            isPaused={isCameraMoving}
            mapBearing={mapBearing}
          />
        )}

        <View style={styles.controlsPanel}>
          <TouchableOpacity
            style={styles.controlButton}
            onPress={() => {
              onMapInteraction?.();
              toggle3DCamera();
            }}
          >
            <Text style={styles.controlText}>{is3DMode ? '3D' : '2D'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlButton}
            onPress={() => {
              onMapInteraction?.();
              setSelectedTheme((prev) =>
                prev === 'liberty' ? 'dark' : prev === 'dark' ? 'bright' : 'liberty'
              );
            }}
          >
            <Text style={styles.controlText}>{selectedTheme.toUpperCase()}</Text>
          </TouchableOpacity>

          {/* Live Weather / Rain Radar & Wind Particles Toggle */}
          <TouchableOpacity
            style={[styles.controlButton, styles.weatherControlButton, isWeatherVisible && styles.controlButtonActive]}
            onPress={() => {
              onMapInteraction?.();
              if (controlledOnToggleWeather) {
                controlledOnToggleWeather();
              } else {
                setInternalWeatherVisible((prev) => !prev);
              }
            }}
          >
            <Ionicons
              name={isWeatherVisible ? 'rainy' : 'cloud-outline'}
              size={16}
              color={isWeatherVisible ? '#38BDF8' : '#FFFFFF'}
            />
            <Text
              style={[styles.controlText, styles.weatherControlText, isWeatherVisible && { color: '#38BDF8' }]}
              numberOfLines={1}
            >
              {isWeatherVisible ? 'WEATHER' : 'RADAR'}
            </Text>
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

export default FamilyMapNative3D;

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  markerContainer: { alignItems: 'center' },
  infoBadge: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    marginBottom: 2,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 5,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  infoBadgeSelected: {
    backgroundColor: '#FFFFFF',
    borderColor: '#CBD5E1',
    shadowOpacity: 0.22,
    shadowRadius: 7,
    elevation: 7,
  },
  nameBoxPointer: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 5,
    borderStyle: 'solid',
    backgroundColor: 'transparent',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#FFFFFF',
    alignSelf: 'center',
    marginTop: -2,
    marginBottom: 4,
  },
  avatarAnchor: {
    width: 108,
    height: 108,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headingContainer: {
    position: 'absolute',
    width: 108,
    height: 108,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  sosPulseRing: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2.5,
    borderColor: '#EF4444',
    backgroundColor: 'rgba(239, 68, 68, 0.24)',
    zIndex: 2,
  },
  markerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  markerTitleDot: { width: 6, height: 6, borderRadius: 3 },
  memberName: { color: '#0F172A', fontSize: 11.5, fontWeight: '700' },
  metaText: { color: '#64748B', fontSize: 9.5, fontWeight: '600', marginTop: 1 },
  avatarFrame: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 4.5,
    elevation: 6,
    zIndex: 4,
  },
  avatarFrameSelected: {
    shadowOpacity: 0.38,
    shadowRadius: 6,
    elevation: 8,
  },
  avatarFrameSOS: {
    borderColor: '#FFFFFF',
    backgroundColor: '#FEF2F2',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 9,
    elevation: 10,
  },
  avatarColorRing: {
    width: 47,
    height: 47,
    borderRadius: 23.5,
    borderWidth: 3,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatar: { width: 39, height: 39, borderRadius: 19.5 },
  avatarFallback: {
    width: 39,
    height: 39,
    borderRadius: 19.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  statusDot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    borderWidth: 2.2,
    borderColor: '#FFFFFF',
    zIndex: 10,
  },
  sosMarkerBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#DC2626',
    borderWidth: 1.8,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    zIndex: 10,
  },
  bottomPinStack: {
    alignItems: 'center',
    marginTop: -30,
    zIndex: 15,
  },
  bottomPinStackCompact: {
    marginTop: -27,
  },
  mapBatteryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2.5,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1.5 },
    shadowOpacity: 0.28,
    shadowRadius: 2,
    elevation: 4,
    zIndex: 10,
  },
  mapBatteryPillText: {
    color: '#FFFFFF',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  pointerTipWrapper: {
    marginTop: -1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlsPanel: { position: 'absolute', top: 54, right: 16, gap: 10 },
  controlButton: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    minWidth: 52,
  },
  controlButtonActive: {
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderWidth: 1.5,
    borderColor: '#38BDF8',
  },
  weatherControlButton: {
    minWidth: 62,
    paddingHorizontal: 6,
    paddingVertical: 8,
    gap: 3,
  },
  weatherControlText: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  controlText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
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
  memberChipActive: { backgroundColor: '#2563EB' },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
});

