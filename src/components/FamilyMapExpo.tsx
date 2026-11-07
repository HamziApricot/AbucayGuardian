import React, { useRef, useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { StyleSheet, View, Text, Image, TouchableOpacity, Alert, Platform, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polyline, Circle } from './Map';
import { getTrackingStatus } from '../utils/tracking';
import { fetchAndCacheSafetyPOIs } from '../services/SafetyPOIService';
import { Colors } from '../constants/theme';
import type { FamilyMember3D, FamilyMap3DHandle, FamilyMap3DProps } from './FamilyMap3D';

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
  // 1. Marker Entrance Drop-In Animation (useNativeDriver: false so react-native-maps renders into Bitmap on Android)
  const markerScale = useRef(new Animated.Value(0.1)).current;
  const markerOpacity = useRef(new Animated.Value(0)).current;
  const markerTranslateY = useRef(new Animated.Value(-24)).current;

  // 2. Avatar Selection Scale Animation
  const avatarScale = useRef(new Animated.Value(isSelected ? 1.15 : 1)).current;

  // 3. Name Box Expansion & Collapse Animation (both in and out)
  const [isBadgeVisible, setIsBadgeVisible] = useState(isSelected);
  const badgeAnim = useRef(new Animated.Value(isSelected ? 1 : 0)).current;

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

  // Smooth Name Box & Avatar spring animation when selected or deselected
  useEffect(() => {
    setTracksViewChanges(true);

    if (isSelected) {
      setIsBadgeVisible(true);
      Animated.parallel([
        Animated.spring(avatarScale, {
          toValue: 1.15,
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
  }, [isSelected]);

  // When GPS coordinates, speed, or battery update, briefly unfreeze tracksViewChanges to re-render bitmap
  useEffect(() => {
    setTracksViewChanges(true);
    const timer = setTimeout(() => {
      setTracksViewChanges(false);
    }, 350);
    return () => clearTimeout(timer);
  }, [member.latitude, member.longitude, member.avatarUrl, member.speed, member.batteryLevel]);

  return (
    <Marker
      coordinate={{ latitude: member.latitude, longitude: member.longitude }}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={isSelf ? 200 : isTarget ? 199 : isSelected ? 180 : 150}
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
              { borderLeftColor: markerColor, borderLeftWidth: 3.5 },
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

        {/* Downward Pointer Triangle with matching smooth animation */}
        {isBadgeVisible && (
          <Animated.View
            style={[
              styles.nameBoxPointer,
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
              borderColor: markerColor,
              transform: [{ scale: avatarScale }],
            },
            isSelected && styles.avatarFrameSelected,
            isSelf && isNavigating && { borderWidth: 3.5, borderColor: '#2563EB' },
          ]}
        >
          {member.avatarUrl ? (
            <Image source={{ uri: member.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatarFallback, { backgroundColor: markerColor }]}>
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
              { backgroundColor: member.speed > 1 ? '#22C55E' : status.color },
            ]}
          />
        </Animated.View>
      </Animated.View>
    </Marker>
  );
};

export const FamilyMapExpo = forwardRef<FamilyMap3DHandle, FamilyMap3DProps>(
  ({ members, selectedMemberId: propSelectedId, onSelectMember, onCancelFocus, showMemberStrip = false, onMapInteraction, showSafetyPOIs = true, navigationRoute }, ref) => {
    const mapRef = useRef<any>(null);
    const isMarkerTappedRef = useRef(false);
    const [mapType, setMapType] = useState<'standard' | 'satellite' | 'hybrid'>('standard');
    const [internalSelectedId, setInternalSelectedId] = useState<string | null>(
      members[0]?.id ?? null
    );
    const [safetyGeoJSON, setSafetyGeoJSON] = useState<GeoJSON.FeatureCollection>({
      type: 'FeatureCollection',
      features: [],
    });

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
        return list;
      }

      return members;
    }, [members, navigationRoute]);

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
          showsCompass={false}
          showsMyLocationButton={false}
        >
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
                    Alert.alert(
                      name || conf.label,
                      `Category: ${conf.label}${phone ? `\nEmergency Contact: ${phone}` : ''}`
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
            const markerColor = isSelf ? '#2563EB' : isTarget ? '#10B981' : (member.color || Colors.tracker);

            return (
              <React.Fragment key={`member-group-${member.id}`}>
                {isSelected && (
                  <Circle
                    center={{ latitude: member.latitude, longitude: member.longitude }}
                    radius={Math.max(5, Math.min(member.accuracy || 15, 100))}
                    fillColor={isSelf ? 'rgba(37, 99, 235, 0.12)' : 'rgba(16, 185, 129, 0.12)'}
                    strokeColor={isSelf ? 'rgba(37, 99, 235, 0.35)' : 'rgba(16, 185, 129, 0.35)'}
                    strokeWidth={1}
                    zIndex={90}
                  />
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
        </View>

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
});

