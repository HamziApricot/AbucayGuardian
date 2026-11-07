import React, { useRef, useState, useEffect, useMemo, useImperativeHandle, forwardRef } from 'react';
import { StyleSheet, View, Text, Image, TouchableOpacity, Alert, Animated } from 'react-native';
import { getTrackingStatus } from '../utils/tracking';
import { fetchAndCacheSafetyPOIs } from '../services/SafetyPOIService';
import type { FamilyMember3D, FamilyMap3DHandle, FamilyMap3DProps } from './FamilyMap3D';

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
  const [safetyGeoJSON, setSafetyGeoJSON] = useState<GeoJSON.FeatureCollection>({
    type: 'FeatureCollection',
    features: [],
  });

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

          Alert.alert(
            props?.name ?? 'Safety Location',
            `Type: ${props?.category?.toUpperCase()}${
              props?.phone ? `\nEmergency Contact: ${props.phone}` : ''
            }`
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
  const markerScale = useRef(new Animated.Value(0.1)).current;
  const markerOpacity = useRef(new Animated.Value(0)).current;
  const markerTranslateY = useRef(new Animated.Value(-24)).current;
  const avatarScale = useRef(new Animated.Value(isSelected ? 1.15 : 1)).current;

  const [isBadgeVisible, setIsBadgeVisible] = useState(isSelected);
  const badgeAnim = useRef(new Animated.Value(isSelected ? 1 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(markerScale, { toValue: 1, friction: 5, tension: 55, useNativeDriver: false }),
      Animated.timing(markerOpacity, { toValue: 1, duration: 280, useNativeDriver: false }),
      Animated.spring(markerTranslateY, { toValue: 0, friction: 5.5, tension: 60, useNativeDriver: false }),
    ]).start();
  }, []);

  useEffect(() => {
    if (isSelected) {
      setIsBadgeVisible(true);
      Animated.parallel([
        Animated.spring(avatarScale, { toValue: 1.15, friction: 6, tension: 70, useNativeDriver: false }),
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
  }, [isSelected]);

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
              <View style={[styles.markerTitleDot, { backgroundColor: markerColor }]} />
              <Text style={styles.memberName} numberOfLines={1}>
                {isSelf ? 'You (Live)' : isTarget ? `${member.name} (Destination)` : member.name}
              </Text>
            </View>
            <Text style={styles.metaText}>
              {isSelf
                ? `${member.speed > 1 ? `${Math.round(member.speed * 3.6)} km/h • ` : ''}Live GPS${member.batteryLevel != null && member.batteryLevel > 0 ? ` • ${Math.round(member.batteryLevel * 100)}%` : ''} • ±${Math.round(member.accuracy || 5)}m`
                : status.isActive
                  ? `${member.speed > 1 ? `Moving ${Math.round(member.speed * 3.6)} km/h` : 'Stationary'}${member.batteryLevel != null && member.batteryLevel > 0 ? ` • ${Math.round(member.batteryLevel * 100)}%` : ''} • ±${Math.round(member.accuracy || 5)}m`
                  : `Inactive • ${status.timeAgo}`}
            </Text>
          </Animated.View>
        )}
        {isBadgeVisible && (
          <Animated.View
            style={[
              styles.nameBoxPointer,
              {
                opacity: badgeAnim,
                transform: [{ scale: badgeAnim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }],
              },
            ]}
          />
        )}

        {/* Facing Direction Indicator (Vision Flashlight Beam & Arrow, compensated for map rotation) */}
        {member.heading != null && !isNaN(member.heading) && (
          <View
            style={[
              styles.headingContainer,
              {
                transform: [{ rotate: `${((member.heading ?? 0) - mapBearing + 360) % 360}deg` }],
              },
            ]}
          >
            <View style={[styles.visionBeamCone, { borderTopColor: markerColor + '38' }]} />
            <View style={[styles.directionArrow, { borderBottomColor: markerColor }]} />
          </View>
        )}

        <Animated.View
          style={[
            styles.avatarFrame,
            { borderColor: markerColor, transform: [{ scale: avatarScale }] },
            isSelected && [styles.avatarFrameSelected, { borderColor: markerColor }],
            isSelf && isNavigating && { borderWidth: 3.5, borderColor: '#2563EB' },
          ]}
        >
          {member.avatarUrl ? (
            <Image source={{ uri: member.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatarFallback, { backgroundColor: markerColor }]}>
              <Text style={styles.avatarInitial}>
                {member.name ? member.name.charAt(0).toUpperCase() : '?'}
              </Text>
            </View>
          )}
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        </Animated.View>

        <View style={[styles.pointerTip, { borderTopColor: markerColor }]} />
      </Animated.View>
    </Marker>
  );
};

export const FamilyMapNative3D = forwardRef<FamilyMap3DHandle, FamilyMap3DProps>(
  ({ members, selectedMemberId: propSelectedId, onSelectMember, onCancelFocus, showMemberStrip = false, onMapInteraction, showSafetyPOIs = true, navigationRoute }, ref) => {
    const MapLibre = useMemo(() => getMapLibre(), []);
    const cameraRef = useRef<any>(null);
    const isMarkerTappedRef = useRef(false);
    const [is3DMode, setIs3DMode] = useState<boolean>(true);
    const [selectedTheme, setSelectedTheme] = useState<'liberty' | 'bright' | 'dark'>('liberty');
    const [mapBearing, setMapBearing] = useState<number>(0);
    const [internalSelectedId, setInternalSelectedId] = useState<string | null>(
      members[0]?.id ?? null
    );

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

    const { Map, Camera, VectorSource, GeoJSONSource, Layer, Marker } = MapLibre;
    const centerLng = members[0]?.longitude ?? 120.5378;
    const centerLat = members[0]?.latitude ?? 14.7275;

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
        </View>

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
  headingContainer: {
    position: 'absolute',
    bottom: 5,
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'flex-start',
    zIndex: 1,
    pointerEvents: 'none',
  },
  visionBeamCone: {
    position: 'absolute',
    top: -42,
    width: 0,
    height: 0,
    borderLeftWidth: 22,
    borderRightWidth: 22,
    borderTopWidth: 38,
    borderStyle: 'solid',
    backgroundColor: 'transparent',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  directionArrow: {
    position: 'absolute',
    top: -12,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 10,
    borderStyle: 'solid',
    backgroundColor: 'transparent',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  markerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  markerTitleDot: { width: 6, height: 6, borderRadius: 3 },
  memberName: { color: '#0F172A', fontSize: 11.5, fontWeight: '700' },
  metaText: { color: '#64748B', fontSize: 9.5, fontWeight: '600', marginTop: 1 },
  avatarFrame: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 3,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarFrameSelected: { transform: [{ scale: 1.1 }] },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
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
  controlsPanel: { position: 'absolute', top: 54, right: 16, gap: 10 },
  controlButton: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    minWidth: 52,
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

