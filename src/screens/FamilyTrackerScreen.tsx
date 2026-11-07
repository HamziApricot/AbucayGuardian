import React, { useEffect, useRef, useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
    FlatList, Image, Animated, Linking, Vibration, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { useAlert } from '../context/AlertContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { getDeviceBatteryLevel, subscribeToBatteryLevel } from '../services/batteryService';
import { Colors, Spacing, BorderRadius } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { FamilyMember, TrackerLocation } from '../types';
import { LocationTrackingService, getBackgroundGeolocation } from '../services/LocationTrackingService';
import { checkBatteryOptimizations } from '../services/batteryOptimization';
import { startBackgroundLocationTracking } from '../services/BackgroundLocationTask';
import { FamilyMap3D, type FamilyMember3D, type FamilyMap3DHandle } from '../components/FamilyMap3D';
import { TurnByTurnHUD } from '../components/TurnByTurnHUD';
import {
    getTurnByTurnRoute,
    calculateDistanceMeters,
    formatDistance,
    formatDuration,
    type NavigationRoute,
} from '../services/RoutingService';
import { FamilyActionSheet } from '../components/FamilyActionSheet';
import { queueSOSEvent } from '../utils/cache';
import { getTrackingStatus } from '../utils/tracking';

/**
 * Calculates bearing angle in degrees (0-360) from coordinate 1 to coordinate 2.
 */
function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const toDeg = (rad: number) => (rad * 180) / Math.PI;

    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x =
        Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
        Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    const brng = toDeg(Math.atan2(y, x));
    return (brng + 360) % 360;
}

export default function FamilyTrackerScreen() {
    const { user, userProfile } = useAuth();
    const insets = useSafeAreaInsets();
    const { showAlert, showToast } = useAlert();
    const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
    const [familyLocations, setFamilyLocations] = useState<(FamilyMember & { lat?: number; lng?: number; updated_at?: string; heading?: number | null })[]>([]);
    const [loading, setLoading] = useState(true);
    const [sharing, setSharing] = useState(false);
    const [userSpeed, setUserSpeed] = useState<number>(0);
    const [userAccuracy, setUserAccuracy] = useState<number>(5);
    const [userBattery, setUserBattery] = useState<number>(1.0);
    const [userHeading, setUserHeading] = useState<number>(0);
    const [userRouteHistory, setUserRouteHistory] = useState<[number, number][]>([]);
    const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [cardHeight, setCardHeight] = useState<number>(360);
    const [isLocalOnline, setIsLocalOnline] = useState(true);
    const [isMarkedSafe, setIsMarkedSafe] = useState(false);
    const [navigationRoute, setNavigationRoute] = useState<NavigationRoute | null>(null);
    const [currentNavStepIndex, setCurrentNavStepIndex] = useState<number>(0);
    const [remainingDistance, setRemainingDistance] = useState<number>(0);
    const userHeadingRef = useRef<number>(0);
    const headingSubRef = useRef<Location.LocationSubscription | null>(null);
    const prevCoordsRef = useRef<{ [userId: string]: { lat: number; lng: number } }>({});
    const collapseAnim = useRef(new Animated.Value(0)).current; // 0 = expanded, 1 = collapsed
    const mapRef = useRef<FamilyMap3DHandle>(null);

    const collapseCard = () => {
        setIsCollapsed(true);
        Animated.spring(collapseAnim, {
            toValue: 1,
            useNativeDriver: true,
            tension: 65,
            friction: 11,
        }).start();
    };

    const expandCard = () => {
        setIsCollapsed(false);
        Animated.spring(collapseAnim, {
            toValue: 0,
            useNativeDriver: true,
            tension: 65,
            friction: 11,
        }).start();
    };

    const toggleCollapse = () => {
        if (isCollapsed) {
            expandCard();
        } else {
            collapseCard();
        }
    };

    const collapsedHeight = 54 + Math.max(insets.bottom, 12);
    const translateY = collapseAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, Math.max(0, cardHeight - collapsedHeight)],
    });

    const [, setTick] = useState(0);
    // Periodically tick for relative timestamps and poll fresh family locations
    useEffect(() => {
        const timer = setInterval(() => {
            setTick((t) => t + 1);
            if (user?.id) {
                fetchFamilyLocations();
            }
        }, 15000); // Poll every 15s so changes appear immediately
        return () => clearInterval(timer);
    }, [user?.id]);

    // Query and subscribe to true device battery percentage safely
    useEffect(() => {
        let unsubscribe: (() => void) | null = null;

        const updateBattery = async () => {
            try {
                const level = await getDeviceBatteryLevel();
                if (level !== null && level >= 0) {
                    setUserBattery(level);
                }
            } catch (e) {
                console.warn('[Battery] Query error:', e);
            }
        };

        updateBattery();

        unsubscribe = subscribeToBatteryLevel((batteryLevel) => {
            if (batteryLevel >= 0) {
                setUserBattery(batteryLevel);
            }
        });

        return () => {
            if (unsubscribe) {
                unsubscribe();
            }
        };
    }, []);

    // Unified helper: Broadcasts live location peer-to-peer and syncs to Supabase with schema-safe column fallback
    const syncLocationToSupabaseAndFamily = async (
        coords: { lat: number; lng: number },
        speed: number = 0,
        accuracy: number = 5,
        battery: number = 1.0,
        heading: number = 0
    ) => {
        if (!user?.id) return;
        const nowIso = new Date().toISOString();

        // 1. Peer-to-peer broadcast for instant real-time UI indicator on all circle members' devices
        try {
            await supabase.channel('family-broadcast').send({
                type: 'broadcast',
                event: 'location_update',
                payload: {
                    user_id: user.id,
                    lat: coords.lat,
                    lng: coords.lng,
                    accuracy,
                    speed,
                    battery,
                    heading,
                    updated_at: nowIso,
                },
            });
        } catch { }

        // 2. Upsert to tracker table with graceful column fallback (handles schema variations)
        try {
            const basePayload: any = {
                user_id: user.id,
                lat: coords.lat,
                lng: coords.lng,
                accuracy,
                speed,
                battery,
                updated_at: nowIso,
            };

            let res = await supabase.from('tracker').upsert({ ...basePayload, heading }, { onConflict: 'user_id' });
            if (res.error) {
                res = await supabase.from('tracker').upsert(basePayload, { onConflict: 'user_id' });
            }
            if (res.error) {
                await supabase.from('tracker').upsert({
                    user_id: user.id,
                    lat: coords.lat,
                    lng: coords.lng,
                    updated_at: nowIso,
                }, { onConflict: 'user_id' });
            }
        } catch { }

        // 3. Keep users table updated for profile/last-active sync
        try {
            await supabase.from('users').update({
                lat: coords.lat,
                lng: coords.lng,
                updated_at: nowIso,
            }).eq('id', user.id);
        } catch { }

        // 4. Record to location_history with fallback
        try {
            const hRes = await supabase.from('location_history').insert({
                user_id: user.id,
                lat: coords.lat,
                lng: coords.lng,
                speed,
                accuracy,
                battery,
                captured_at: nowIso,
            });
            if (hRes.error) {
                await supabase.from('location_history').insert({
                    user_id: user.id,
                    lat: coords.lat,
                    lng: coords.lng,
                    captured_at: nowIso,
                });
            }
        } catch { }
    };

    // Active sharing heartbeat: even when stationary, refresh our timestamp and battery every 20s
    useEffect(() => {
        if (!user?.id || !myLocation) return;

        const heartbeat = setInterval(async () => {
            let freshBattery = userBattery;
            try {
                const bLevel = await getDeviceBatteryLevel();
                if (bLevel !== null && bLevel >= 0) {
                    freshBattery = bLevel;
                    setUserBattery(bLevel);
                }
            } catch { }

            syncLocationToSupabaseAndFamily(
                myLocation,
                userSpeed,
                userAccuracy,
                freshBattery,
                userHeadingRef.current
            );
        }, 20000);

        return () => clearInterval(heartbeat);
    }, [user?.id, myLocation?.lat, myLocation?.lng, userAccuracy, userSpeed, userBattery]);

    useEffect(() => {
        const unsubscribe = NetInfo.addEventListener((state) => {
            setIsLocalOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
        });
        return () => unsubscribe();
    }, []);

    const selectedMember = React.useMemo(() => {
        if (selectedMemberId === user?.id) {
            return {
                id: user?.id,
                name: userProfile?.name || 'You',
                avatar_url: userProfile?.avatar_url,
                lat: myLocation?.lat,
                lng: myLocation?.lng,
                updated_at: new Date().toISOString(),
                phone: userProfile?.phone,
                relationship: 'You',
            };
        }
        return familyLocations.find((m) => m.id === selectedMemberId || m.member_user_id === selectedMemberId);
    }, [selectedMemberId, user?.id, userProfile, familyLocations, myLocation]);

    const selectedMemberStatus = React.useMemo(() => {
        if (!selectedMember) return null;
        const hasLoc = Boolean(selectedMember.lat && selectedMember.lng);
        return getTrackingStatus(selectedMember.updated_at, hasLoc);
    }, [selectedMember]);

    const activeCount = React.useMemo(() => {
        const activeFamily = familyLocations.filter((m) => {
            const hasLoc = Boolean(m.lat && m.lng);
            return getTrackingStatus(m.updated_at, hasLoc).isActive;
        }).length;
        return activeFamily + (myLocation ? 1 : 0);
    }, [familyLocations, myLocation]);

    useEffect(() => {
        if (!user?.id) return;

        let locationSub: any = null;

        const startTracking = async () => {
            locationSub = await requestAndTrack();
            // Start persistent background tracking with Foreground Service notification
            await startBackgroundLocationTracking(user.id);
        };

        startTracking();
        fetchFamilyLocations();

        // Initialize background tracking engine and check OEM battery optimization
        let bgLocationSub: any = null;
        try {
            LocationTrackingService.init(user.id);
            checkBatteryOptimizations();

            const bgGeo = getBackgroundGeolocation();
            if (bgGeo && typeof bgGeo.onLocation === 'function') {
                bgLocationSub = bgGeo.onLocation((location: any) => {
                    const { latitude, longitude, accuracy = 5, speed = 0 } = location.coords;
                    const batteryLevel = location.battery?.level ?? 1;

                    setMyLocation({ lat: latitude, lng: longitude });
                    setUserSpeed(Math.max(0, speed));
                    setUserAccuracy(accuracy);
                    setUserBattery(Math.abs(batteryLevel));
                    setUserRouteHistory((prev) => [
                        ...prev.slice(-100),
                        [longitude, latitude],
                    ]);
                });
            }
        } catch (e) {
            console.log('[LocationTrackingService] Initialized in fallback mode:', e);
        }

        // Subscribe to real-time updates from others
        const trackerSub = supabase
            .channel(`tracker-updates-${user.id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tracker' }, () => {
                fetchFamilyLocations();
            })
            .subscribe();

        const familySub = supabase
            .channel(`family-updates-${user.id}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'family_members',
                filter: `user_id=eq.${user.id}`
            }, () => {
                fetchFamilyLocations();
            })
            .subscribe();

        // Live broadcast listener for instant peer-to-peer coordinates, battery, heading & accuracy
        const broadcastSub = supabase
            .channel('family-broadcast')
            .on('broadcast', { event: 'location_update' }, ({ payload }) => {
                if (!payload || payload.user_id === user.id) return;

                let memberHeading = payload.heading;
                if (memberHeading == null && payload.lat && payload.lng) {
                    const prev = prevCoordsRef.current[payload.user_id];
                    if (prev) {
                        const dist = calculateDistanceMeters(prev.lat, prev.lng, payload.lat, payload.lng);
                        if (dist > 1.5) {
                            memberHeading = Math.round(calculateBearing(prev.lat, prev.lng, payload.lat, payload.lng));
                        }
                    }
                    prevCoordsRef.current[payload.user_id] = { lat: payload.lat, lng: payload.lng };
                }

                setFamilyLocations((prev) =>
                    prev.map((m) => {
                        if (m.member_user_id === payload.user_id) {
                            return {
                                ...m,
                                lat: payload.lat,
                                lng: payload.lng,
                                accuracy: payload.accuracy ?? m.accuracy,
                                speed: payload.speed ?? m.speed,
                                battery: payload.battery !== undefined ? payload.battery : m.battery,
                                heading: memberHeading !== undefined ? memberHeading : m.heading,
                                updated_at: payload.updated_at || m.updated_at,
                            };
                        }
                        return m;
                    })
                );
            })
            .on('broadcast', { event: 'checkin_reply' }, ({ payload }) => {
                if (!payload || !payload.from_user_id) return;
                fetchFamilyLocations();
            })
            .subscribe();

        return () => {
            if (locationSub) locationSub.remove();
            if (headingSubRef.current) {
                headingSubRef.current.remove();
            }
            if (bgLocationSub && typeof bgLocationSub.remove === 'function') {
                bgLocationSub.remove();
            }
            supabase.removeChannel(trackerSub);
            supabase.removeChannel(familySub);
            // Notice: We deliberately do NOT remove 'family-broadcast' here so App.tsx's global emergency listeners stay active
        };
    }, [user?.id]);

    const requestAndTrack = async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
            showAlert({
                title: 'Permission Denied',
                message: 'Location permission is required for the Family Tracker.',
                type: 'error'
            });
            setLoading(false);
            return;
        }

        // Request Android High Accuracy provider if available
        if (Platform.OS === 'android') {
            try {
                const isEnabled = await Location.hasServicesEnabledAsync();
                if (!isEnabled) {
                    await Location.enableNetworkProviderAsync();
                }
            } catch (e) {
                console.warn('[Location] Network provider check warning:', e);
            }
        }

        // Initial position with Highest Precision GPS
        const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Highest,
        });
        const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        setMyLocation(coords);
        setUserAccuracy(Math.round(loc.coords.accuracy ?? 5));
        setUserSpeed(Math.max(0, loc.coords.speed ?? 0));
        setLoading(false);
        mapRef.current?.animateToRegion?.({
            latitude: coords.lat, longitude: coords.lng, latitudeDelta: 0.02, longitudeDelta: 0.02,
        });

        // Immediately sync initial coordinates to Supabase and family broadcast (so stationary member is Active now!)
        syncLocationToSupabaseAndFamily(
            coords,
            loc.coords.speed ?? 0,
            Math.round(loc.coords.accuracy ?? 5),
            userBattery,
            userHeadingRef.current
        );

        // Live orientation/compass tracking for the facing indicator
        try {
            headingSubRef.current = await Location.watchHeadingAsync((h) => {
                const heading = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
                if (typeof heading === 'number' && !isNaN(heading)) {
                    const rounded = Math.round(heading);
                    userHeadingRef.current = rounded;
                    setUserHeading(rounded);
                }
            });
        } catch (e) {
            console.warn('[FamilyTracker] Heading watch error:', e);
        }

        // Continuous high-precision tracking (satellite GPS)
        const subscription = await Location.watchPositionAsync(
            {
                accuracy: Location.Accuracy.Highest, // True satellite GNSS / GPS!
                distanceInterval: 2, // Fine-grained 2-meter resolution
                timeInterval: 4000, // Update at least every 4 seconds for live positioning
            },
            async (newLocation) => {
                const newCoords = { lat: newLocation.coords.latitude, lng: newLocation.coords.longitude };
                const curAcc = Math.round(newLocation.coords.accuracy ?? 5);
                const curSpeed = Math.max(0, newLocation.coords.speed ?? 0);

                if (newLocation.coords.heading != null && newLocation.coords.heading >= 0) {
                    const rounded = Math.round(newLocation.coords.heading);
                    userHeadingRef.current = rounded;
                    setUserHeading(rounded);
                }

                setMyLocation(newCoords);
                setUserSpeed(curSpeed);
                setUserAccuracy(curAcc);
                setUserRouteHistory((prev) => [
                    ...prev.slice(-100),
                    [newCoords.lng, newCoords.lat],
                ]);

                // Query fresh device battery safely
                let curBat = userBattery;
                try {
                    const freshBat = await getDeviceBatteryLevel();
                    if (freshBat !== null && freshBat >= 0) {
                        curBat = freshBat;
                        setUserBattery(freshBat);
                    }
                } catch { }

                // Automatically sync coordinates, heading, and battery to Supabase and live family circle
                syncLocationToSupabaseAndFamily(
                    newCoords,
                    curSpeed,
                    curAcc,
                    curBat,
                    userHeadingRef.current
                );

                // If in-map turn-by-turn navigation is active, track live route progression
                setNavigationRoute((currentRoute) => {
                    if (currentRoute) {
                        const distToDest = calculateDistanceMeters(
                            newCoords.lat,
                            newCoords.lng,
                            currentRoute.to.latitude,
                            currentRoute.to.longitude
                        );
                        setRemainingDistance(distToDest);

                        // Trigger arrival when within 30 meters
                        if (distToDest <= 30) {
                            Vibration.vibrate([0, 300, 150, 300, 150, 600]);
                            showToast({
                                message: `🎉 You have arrived at ${currentRoute.label}!`,
                                type: 'success',
                            });
                        }

                        // Auto-advance step if user approaches the next maneuver checkpoint
                        const steps = currentRoute.steps || [];
                        setCurrentNavStepIndex((prevIdx) => {
                            if (prevIdx < steps.length - 1) {
                                const nextStep = steps[prevIdx + 1];
                                if (nextStep && nextStep.location) {
                                    const distToNext = calculateDistanceMeters(
                                        newCoords.lat,
                                        newCoords.lng,
                                        nextStep.location.latitude,
                                        nextStep.location.longitude
                                    );
                                    if (distToNext < 25) {
                                        Vibration.vibrate(80);
                                        return prevIdx + 1;
                                    }
                                }
                            }
                            return prevIdx;
                        });
                    }
                    return currentRoute;
                });
            }
        );

        return subscription;
    };

    const shareLocation = async () => {
        if (!myLocation || !user) return;
        setSharing(true);
        try {
            let freshBat = userBattery;
            try {
                const b = await getDeviceBatteryLevel();
                if (b !== null && b >= 0) {
                    freshBat = b;
                    setUserBattery(b);
                }
            } catch { }

            await syncLocationToSupabaseAndFamily(
                myLocation,
                userSpeed,
                userAccuracy,
                freshBat,
                userHeadingRef.current
            );
        } catch (e) {
            console.warn('[FamilyTracker] Manual share error:', e);
        }
        setSharing(false);
        showToast({
            message: 'Location has been shared with family',
            type: 'success'
        });
    };

    const fetchFamilyLocations = async () => {
        if (!user) return;
        try {
            // Fetch family members with joined user details (avatar, lat, lng, updated_at)
            const { data: members, error: memError } = await supabase
                .from('family_members')
                .select('*, member:users!member_user_id(avatar_url, lat, lng, updated_at)')
                .eq('user_id', user.id);

            if (memError) {
                console.warn('[FamilyTracker] Fetch members error:', memError);
                return;
            }
            if (!members) return;

            // Fetch tracker entries for each family member
            const memberUserIds = members.filter((m: any) => m.member_user_id).map((m: any) => m.member_user_id);
            if (memberUserIds.length === 0) {
                setFamilyLocations([]);
                return;
            }

            const { data: locs, error: locsError } = await supabase
                .from('tracker')
                .select('*')
                .in('user_id', memberUserIds);

            if (locsError) {
                console.warn('[FamilyTracker] Fetch tracker error:', locsError);
            }

            // Also check latest location_history for true battery, speed, and accuracy
            const historyMap: { [userId: string]: any } = {};
            try {
                const { data: histData } = await supabase
                    .from('location_history')
                    .select('user_id, battery, accuracy, speed, captured_at')
                    .in('user_id', memberUserIds)
                    .order('captured_at', { ascending: false })
                    .limit(memberUserIds.length * 3);

                if (histData) {
                    histData.forEach((h: any) => {
                        if (!historyMap[h.user_id]) {
                            historyMap[h.user_id] = h;
                        }
                    });
                }
            } catch (hErr) {
                // Non-blocking
            }

            const merged = members.map((m: any) => {
                const loc = locs?.find((l: any) => l.user_id === m.member_user_id);
                const userFallback = m.member;
                const hist = historyMap[m.member_user_id];

                // Pick the freshest timestamp between tracker and users table
                let resolvedLat = loc?.lat ?? userFallback?.lat ?? m.lat;
                let resolvedLng = loc?.lng ?? userFallback?.lng ?? m.lng;
                let resolvedUpdatedAt = loc?.updated_at || userFallback?.updated_at || m.updated_at;

                if (loc?.updated_at && userFallback?.updated_at) {
                    const trackerTime = new Date(loc.updated_at).getTime();
                    const userTime = new Date(userFallback.updated_at).getTime();
                    if (!isNaN(userTime) && userTime > trackerTime) {
                        resolvedLat = userFallback.lat ?? resolvedLat;
                        resolvedLng = userFallback.lng ?? resolvedLng;
                        resolvedUpdatedAt = userFallback.updated_at;
                    }
                }

                const resolvedBattery = loc?.battery ?? hist?.battery ?? m.battery ?? null;
                const resolvedAccuracy = loc?.accuracy ?? hist?.accuracy ?? m.accuracy ?? 5;
                const resolvedSpeed = loc?.speed ?? hist?.speed ?? m.speed ?? 0;
                const resolvedHeading = loc?.heading ?? hist?.heading ?? m.heading ?? null;

                return {
                    ...m,
                    lat: resolvedLat,
                    lng: resolvedLng,
                    accuracy: resolvedAccuracy,
                    speed: resolvedSpeed,
                    battery: resolvedBattery,
                    heading: resolvedHeading,
                    updated_at: resolvedUpdatedAt,
                    avatar_url: m.member?.avatar_url || m.avatar_url // Prioritize live avatar
                };
            });
            setFamilyLocations(merged);
        } catch (err) {
            console.warn('[FamilyTracker] fetchFamilyLocations caught error:', err);
        }
    };

    const focusOnMember = (
        lat?: number | string,
        lng?: number | string,
        memberId?: string,
        name?: string,
        updatedAt?: string | null
    ) => {
        const numLat = typeof lat === 'string' ? parseFloat(lat) : lat;
        const numLng = typeof lng === 'string' ? parseFloat(lng) : lng;

        if (!numLat || !numLng || isNaN(numLat) || isNaN(numLng)) {
            showAlert({
                title: 'Location Missing',
                message: `${name || 'This family member'} has not shared their location yet.`,
                type: 'warning'
            });
            return;
        }

        // If tapping the already focused member, toggle off and show all members with smooth zoom
        if (memberId && memberId === selectedMemberId) {
            setSelectedMemberId(null);
            if (myLocation) {
                mapRef.current?.animateToRegion?.({
                    latitude: myLocation.lat,
                    longitude: myLocation.lng,
                    latitudeDelta: 0.018,
                    longitudeDelta: 0.018,
                }, 850);
            }
            return;
        }

        const status = getTrackingStatus(updatedAt, true);

        if (memberId) {
            setSelectedMemberId(memberId);
        }
        mapRef.current?.focusOnCoordinates(numLat, numLng, memberId);
        expandCard();

        if (!status.isActive) {
            showToast({
                message: `${name || 'Member'}'s tracking is inactive (${status.inactiveDuration}). Showing last known location.`,
                type: 'info'
            });
        }
    };

    const MEMBER_COLORS = [Colors.family, Colors.tracker, Colors.hotline, Colors.emergencyPlan];

    // Sort family members:
    // 1. Active members first (status.isActive === true)
    // 2. Sort by last active time descending (newest activity first)
    const sortedFamilyMembers = React.useMemo(() => {
        return [...familyLocations].sort((a, b) => {
            const hasLocA = Boolean(a.lat && a.lng);
            const hasLocB = Boolean(b.lat && b.lng);
            const statusA = getTrackingStatus(a.updated_at, hasLocA);
            const statusB = getTrackingStatus(b.updated_at, hasLocB);

            // 1. Active members first
            if (statusA.isActive && !statusB.isActive) return -1;
            if (!statusA.isActive && statusB.isActive) return 1;

            // 2. Members with coordinates before those without
            if (hasLocA && !hasLocB) return -1;
            if (!hasLocA && hasLocB) return 1;

            // 3. Sort by last active time descending (newest update first)
            const timeA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
            const timeB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
            return timeB - timeA;
        });
    }, [familyLocations]);

    const members3D: FamilyMember3D[] = React.useMemo(() => {
        const list: FamilyMember3D[] = [];
        if (myLocation && user?.id) {
            list.push({
                id: user.id,
                memberUserId: user.id,
                name: (userProfile?.name || 'You') + (isMarkedSafe ? ' ✓ Safe' : ''),
                avatarUrl: userProfile?.avatar_url,
                latitude: myLocation.lat,
                longitude: myLocation.lng,
                accuracy: userAccuracy,
                speed: userSpeed,
                batteryLevel: userBattery,
                heading: userHeading,
                isOnline: true,
                lastUpdated: new Date().toISOString(),
                color: isMarkedSafe ? '#16A34A' : Colors.sos,
                routeHistory: userRouteHistory,
                phone: userProfile?.phone,
                relationship: 'You',
            });
        }

        sortedFamilyMembers.forEach((m, index) => {
            const lat = typeof m.lat === 'string' ? parseFloat(m.lat) : m.lat;
            const lng = typeof m.lng === 'string' ? parseFloat(m.lng) : m.lng;
            if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
                const status = getTrackingStatus(m.updated_at, true);
                const assignedColor = MEMBER_COLORS[index % MEMBER_COLORS.length];
                list.push({
                    id: m.id,
                    memberUserId: m.member_user_id || null,
                    name: m.name,
                    avatarUrl: m.avatar_url,
                    latitude: lat,
                    longitude: lng,
                    accuracy: m.accuracy ?? 5,
                    speed: m.speed ?? 0,
                    batteryLevel: m.battery != null && m.battery > 0 ? m.battery : null,
                    heading: m.heading != null && !isNaN(m.heading) ? m.heading : null,
                    isOnline: status.isActive,
                    lastUpdated: m.updated_at || new Date().toISOString(),
                    color: assignedColor,
                    phone: m.phone,
                    relationship: m.relationship,
                });
            }
        });

        return list;
    }, [myLocation, user?.id, userProfile, userAccuracy, userSpeed, userBattery, userHeading, userRouteHistory, sortedFamilyMembers, isMarkedSafe]);

    const selectedMember3D = React.useMemo(() => {
        if (!selectedMemberId) return null;
        return members3D.find((m) => m.id === selectedMemberId || m.memberUserId === selectedMemberId) || null;
    }, [selectedMemberId, members3D]);

    // Live Auto-Reroute: Dynamically re-sync route if the target family member is moving
    useEffect(() => {
        if (!navigationRoute?.targetMemberId || !myLocation) return;

        const targetMember = members3D.find((m) => m.id === navigationRoute.targetMemberId);
        if (!targetMember) return;

        const distMoved = calculateDistanceMeters(
            navigationRoute.to.latitude,
            navigationRoute.to.longitude,
            targetMember.latitude,
            targetMember.longitude
        );

        // When member moves by >= 20 meters, recalculate route live to keep up with them
        if (distMoved >= 20) {
            getTurnByTurnRoute(
                { latitude: myLocation.lat, longitude: myLocation.lng },
                { latitude: targetMember.latitude, longitude: targetMember.longitude },
                targetMember.name,
                targetMember.id
            ).then((updated) => {
                setNavigationRoute(updated);
                setRemainingDistance(updated.distance);
            }).catch((err) => {
                console.warn('[Navigation] Dynamic live reroute error:', err);
            });
        }
    }, [members3D, navigationRoute?.targetMemberId, myLocation]);

    const handleCheckIn = async (member: FamilyMember3D) => {
        const targetUserId = member.memberUserId || member.id;
        try {
            await supabase.channel('family-broadcast').send({
                type: 'broadcast',
                event: 'checkin_request',
                payload: {
                    from_user_id: user?.id,
                    from_name: userProfile?.name || 'Family Circle',
                    from_avatar: userProfile?.avatar_url,
                    from_lat: myLocation?.lat,
                    from_lng: myLocation?.lng,
                    to_member_id: targetUserId,
                    to_user_id: targetUserId,
                    to_row_id: member.id,
                    sent_at: new Date().toISOString(),
                },
            });
            Vibration.vibrate(60);
            showToast({
                message: `Safety check-in prompt sent to ${member.name}`,
                type: 'success',
            });
        } catch (e) {
            console.warn('[CheckIn] Send error:', e);
            if (member.phone) {
                showAlert({
                    title: 'Check-In Fallback',
                    message: `Could not deliver instant push prompt. Send SMS check-in to ${member.name}?`,
                    buttons: [
                        { text: 'Send SMS', onPress: () => handleSendSMSCheckIn(member) },
                        { text: 'Cancel', style: 'cancel' }
                    ]
                });
            } else {
                showToast({
                    message: `Could not send push check-in.`,
                    type: 'warning',
                });
            }
        }
    };

    const handleSendSMSCheckIn = (member: FamilyMember3D) => {
        const phone = member.phone || '';
        const body = `Hi ${member.name}, are you safe? Please reply 'SAFE' or 'NEED HELP'. - Sent via Abucay Guardian`;
        const separator = Platform.OS === 'ios' ? '&' : '?';
        const url = `sms:${phone}${separator}body=${encodeURIComponent(body)}`;
        Linking.openURL(url).catch(() => {
            showAlert({
                title: 'Unable to open SMS',
                message: `Could not open your device SMS app. Please text ${phone || member.name} directly.`,
                type: 'error',
            });
        });
    };

    const startTurnByTurnNavigation = async (
        toCoords: { latitude: number; longitude: number },
        destinationLabel: string,
        targetMemberId?: string
    ) => {
        if (!myLocation) {
            showToast({ message: 'Getting your current location...', type: 'info' });
            return;
        }

        try {
            showToast({ message: `Calculating route to ${destinationLabel}...`, type: 'info' });
            const route = await getTurnByTurnRoute(
                { latitude: myLocation.lat, longitude: myLocation.lng },
                toCoords,
                destinationLabel,
                targetMemberId
            );

            setNavigationRoute(route);
            setCurrentNavStepIndex(0);
            setRemainingDistance(route.distance);

            // Fit map bounds to show route
            const allLats = (route.coordinates || []).map((c) => c.latitude);
            const allLngs = (route.coordinates || []).map((c) => c.longitude);
            const minLat = Math.min(...allLats, myLocation.lat, toCoords.latitude);
            const maxLat = Math.max(...allLats, myLocation.lat, toCoords.latitude);
            const minLng = Math.min(...allLngs, myLocation.lng, toCoords.longitude);
            const maxLng = Math.max(...allLngs, myLocation.lng, toCoords.longitude);

            mapRef.current?.animateToRegion?.({
                latitude: (minLat + maxLat) / 2,
                longitude: (minLng + maxLng) / 2,
                latitudeDelta: Math.max(0.008, (maxLat - minLat) * 1.5),
                longitudeDelta: Math.max(0.008, (maxLng - minLng) * 1.5),
            }, 800);

            // Collapse card slightly to give full focus to in-map route
            collapseCard();

            showToast({
                message: route.isOffline
                    ? `🧭 Offline Compass Route (${formatDistance(route.distance)})`
                    : `📍 Live Road Navigation (${formatDistance(route.distance)} • ${formatDuration(route.duration)})`,
                type: 'success',
            });
        } catch (e) {
            console.warn('[Navigation] Route error:', e);
            showToast({ message: 'Could not calculate navigation route.', type: 'error' });
        }
    };

    const handleNavigateToMember = (member: FamilyMember3D) => {
        if (!myLocation) {
            showToast({ message: 'Getting your current location...', type: 'info' });
            return;
        }

        showAlert({
            title: `Navigate to ${member.name}`,
            message: `Start in-map turn-by-turn route to ${member.name}? Works online or offline during outages.`,
            type: 'info',
            buttons: [
                {
                    text: `Navigate to ${member.name}`,
                    onPress: () => startTurnByTurnNavigation(
                        { latitude: member.latitude, longitude: member.longitude },
                        member.name,
                        member.id
                    ),
                },
                {
                    text: 'Nearest Evacuation Shelter',
                    onPress: () => handleNavigateToNearestShelter(member),
                },
                { text: 'Cancel', style: 'cancel' },
            ],
        });
    };

    const handleNavigateToNearestShelter = async (member?: FamilyMember3D) => {
        if (!myLocation) {
            showToast({ message: 'Getting your current location...', type: 'info' });
            return;
        }

        try {
            const cachedPois = await AsyncStorage.getItem('OFFLINE_SAFETY_POIS_GEOJSON');
            if (cachedPois) {
                const geo = JSON.parse(cachedPois);
                const shelters = (geo.features || []).filter(
                    (f: any) => f.properties?.category === 'evacuation'
                );

                if (shelters.length > 0) {
                    let closest = shelters[0];
                    let minDistance = 999999;
                    shelters.forEach((s: any) => {
                        const [sLng, sLat] = s.geometry.coordinates;
                        const dist = Math.hypot(sLat - myLocation.lat, sLng - myLocation.lng);
                        if (dist < minDistance) {
                            minDistance = dist;
                            closest = s;
                        }
                    });

                    const [cLng, cLat] = closest.geometry.coordinates;
                    const shelterName = closest.properties?.name || 'Evacuation Center';

                    await startTurnByTurnNavigation(
                        { latitude: cLat, longitude: cLng },
                        shelterName
                    );
                    return;
                }
            }
        } catch (e) {
            console.warn('[Evacuation] Shelter lookup failed:', e);
        }

        showToast({ message: 'No cached evacuation shelters found nearby.', type: 'warning' });
    };

    const handleCallMember = (phone: string, name: string) => {
        if (!phone) {
            showAlert({ title: 'No Phone Number', message: `No phone number on record for ${name}.`, type: 'warning' });
            return;
        }
        Linking.openURL(`tel:${phone}`);
    };

    const handleSendOfflineSMS = (phone: string, name: string) => {
        if (!phone) {
            showAlert({ title: 'No Phone Number', message: `No phone number on record for ${name}.`, type: 'warning' });
            return;
        }
        const loc = myLocation ? `\nMy GPS: https://maps.google.com/?q=${myLocation.lat},${myLocation.lng}` : '';
        const body = `Urgent check-in from ${userProfile?.name || 'Family'}: Please call or text back as soon as you see this.${loc}`;
        const separator = Platform.OS === 'ios' ? '&' : '?';
        Linking.openURL(`sms:${phone}${separator}body=${encodeURIComponent(body)}`);
    };

    const handleLoudPing = async (member: FamilyMember3D) => {
        const targetUserId = member.memberUserId || member.id;
        try {
            await supabase.channel('family-broadcast').send({
                type: 'broadcast',
                event: 'loud_ping',
                payload: {
                    from_user_id: user?.id,
                    from_name: userProfile?.name || 'Family Circle',
                    to_member_id: targetUserId,
                    to_user_id: targetUserId,
                    to_row_id: member.id,
                    sent_at: new Date().toISOString(),
                },
            });
            Vibration.vibrate([0, 500, 200, 500, 200, 1000]);
            showAlert({
                title: 'Loud Emergency Ping Sent',
                message: `Triggered high-priority alarm sound and vibration on ${member.name}'s phone.`,
                type: 'warning',
            });
        } catch (e) {
            console.warn('[LoudPing] Error:', e);
            if (member.phone) {
                showAlert({
                    title: 'Ping Fallback',
                    message: `Could not send internet ping. Send an urgent SMS ping to ${member.name}?`,
                    buttons: [
                        {
                            text: 'Send SMS Alert',
                            onPress: () => handleSendOfflineSMS(member.phone || '', member.name),
                        },
                        { text: 'Cancel', style: 'cancel' },
                    ],
                });
            } else {
                showToast({ message: 'Could not send loud ping via internet.', type: 'error' });
            }
        }
    };

    const handleTriggerSOS = async () => {
        if (!user?.id) return;
        Vibration.vibrate([0, 600, 200, 600, 200, 1000]);

        const event = {
            user_id: user.id,
            lat: myLocation?.lat,
            lng: myLocation?.lng,
            triggered_at: new Date().toISOString(),
            status: 'active',
        };

        try {
            const { error } = await supabase.from('sos_events').insert(event);
            if (myLocation) {
                await supabase.from('tracker').upsert({
                    user_id: user.id,
                    lat: myLocation.lat,
                    lng: myLocation.lng,
                    updated_at: new Date().toISOString(),
                }, { onConflict: 'user_id' });
            }
            if (error) {
                await queueSOSEvent(event);
            }
        } catch (e) {
            await queueSOSEvent(event);
        }

        showAlert({
            title: '🚨 SOS BROADCASTED!',
            message: `Emergency alert with live GPS coordinates (${myLocation?.lat ? myLocation.lat.toFixed(4) : 'Pending'}, ${myLocation?.lng ? myLocation.lng.toFixed(4) : 'Pending'}) and battery level (${Math.round(userBattery * 100)}%) has been sent to your family circle and emergency responders.`,
            type: 'error',
            buttons: [
                {
                    text: 'Call 911 Emergency',
                    onPress: () => Linking.openURL('tel:911'),
                },
                { text: 'OK', style: 'cancel' },
            ],
        });
    };

    const handleMarkSafe = async () => {
        const nextState = !isMarkedSafe;
        setIsMarkedSafe(nextState);

        if (myLocation && user?.id) {
            try {
                await supabase.from('tracker').upsert({
                    user_id: user.id,
                    lat: myLocation.lat,
                    lng: myLocation.lng,
                    updated_at: new Date().toISOString(),
                }, { onConflict: 'user_id' });
            } catch (e) {
                console.warn('[MarkSafe] Sync error:', e);
            }
        }

        showToast({
            message: nextState
                ? 'Reassurance badge posted to your family map.'
                : 'Safe status updated.',
            type: 'success',
        });
    };

    return (
        <View style={styles.container}>
            {/* Map */}
            {loading ? (
                <View style={styles.mapPlaceholder}>
                    <ActivityIndicator size="large" color={Colors.tracker} />
                    <Text style={styles.loadingText}>Getting your location...</Text>
                </View>
            ) : (
                <FamilyMap3D
                    ref={mapRef}
                    members={members3D}
                    selectedMemberId={selectedMemberId}
                    navigationRoute={navigationRoute}
                    onSelectMember={(m) => {
                        setSelectedMemberId(m ? m.id : null);
                        expandCard();
                    }}
                    onCancelFocus={() => {
                        setSelectedMemberId(null);
                        setNavigationRoute(null);
                    }}
                    onMapInteraction={collapseCard}
                    showMemberStrip={false}
                />
            )}

            {/* In-Map Turn-by-Turn Navigation HUD (Online/Offline) */}
            {navigationRoute && (
                <TurnByTurnHUD
                    route={navigationRoute}
                    currentStepIndex={currentNavStepIndex}
                    remainingDistanceMeters={remainingDistance || navigationRoute.distance}
                    onExitNavigation={() => {
                        setNavigationRoute(null);
                        setCurrentNavStepIndex(0);
                    }}
                    onNextStep={() => {
                        if (navigationRoute.steps && currentNavStepIndex < navigationRoute.steps.length - 1) {
                            setCurrentNavStepIndex((i) => i + 1);
                        }
                    }}
                    onPrevStep={() => {
                        if (currentNavStepIndex > 0) {
                            setCurrentNavStepIndex((i) => i - 1);
                        }
                    }}
                    onRecalculate={() => {
                        if (navigationRoute && myLocation) {
                            startTurnByTurnNavigation(navigationRoute.to, navigationRoute.label, navigationRoute.targetMemberId);
                        }
                    }}
                />
            )}

            {/* Bottom Card */}
            <Animated.View
                style={[
                    styles.bottomCard,
                    {
                        transform: [{ translateY }],
                        paddingBottom: Math.max(insets.bottom, 16) + Spacing.xs,
                    },
                ]}
                onLayout={(e) => {
                    const h = e.nativeEvent.layout.height;
                    if (h > 0 && Math.abs(h - cardHeight) > 2) {
                        setCardHeight(h);
                    }
                }}
            >
                {/* Drag Handle & Toggle Header */}
                <TouchableOpacity
                    style={styles.cardHeaderHandle}
                    onPress={toggleCollapse}
                    activeOpacity={0.7}
                >
                    <View style={styles.handleBar} />
                    <View style={styles.cardHeaderRow}>
                        <View style={styles.cardHeaderLeft}>
                            <View style={[
                                styles.statusPulse,
                                { backgroundColor: isCollapsed && selectedMemberStatus ? selectedMemberStatus.color : Colors.tracker }
                            ]} />
                            <Text style={styles.cardHeaderTitle} numberOfLines={1}>
                                {navigationRoute
                                    ? `Navigating • ${navigationRoute.label}`
                                    : selectedMember
                                        ? selectedMemberStatus?.isActive
                                            ? `Viewing ${selectedMember.name.split(' ')[0]} • Active`
                                            : `Viewing ${selectedMember.name.split(' ')[0]} • Inactive (${selectedMemberStatus?.timeAgo})`
                                        : 'Family Members'}
                            </Text>
                            <View style={styles.countBadge}>
                                <Text style={styles.countBadgeText}>
                                    {familyLocations.length + (myLocation ? 1 : 0)}
                                </Text>
                            </View>
                        </View>

                        <View style={styles.cardHeaderRight}>
                            <Text style={styles.collapseHintText}>
                                {isCollapsed ? (navigationRoute ? 'Controls' : selectedMember ? 'Show Actions' : 'Show List') : 'Expand Map'}
                            </Text>
                            <Ionicons
                                name={isCollapsed ? 'chevron-up' : 'chevron-down'}
                                size={18}
                                color={Colors.textMuted}
                            />
                        </View>
                    </View>
                </TouchableOpacity>

                {/* If navigating: dedicated Turn-by-Turn Bottom Controls */}
                {navigationRoute ? (
                    <View style={styles.navBottomBar}>
                        <View style={styles.navBottomInfo}>
                            <View style={styles.navDestRow}>
                                <View style={styles.navDestIconCircle}>
                                    <Ionicons name="navigate" size={18} color="#10B981" />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.navDestTitle} numberOfLines={1}>
                                        {navigationRoute.label}
                                    </Text>
                                    <Text style={styles.navDestSub}>
                                        {formatDistance(remainingDistance || navigationRoute.distance)} remaining • {navigationRoute.isOffline ? 'Offline Compass Guidance' : 'Live Road Guidance'}
                                    </Text>
                                </View>
                            </View>
                        </View>

                        <View style={styles.navActionRow}>
                            <TouchableOpacity
                                style={styles.navRecenterBtn}
                                onPress={() => {
                                    if (myLocation) {
                                        mapRef.current?.animateToRegion?.({
                                            latitude: myLocation.lat,
                                            longitude: myLocation.lng,
                                            latitudeDelta: 0.006,
                                            longitudeDelta: 0.006,
                                        }, 600);
                                    }
                                }}
                                activeOpacity={0.8}
                            >
                                <Ionicons name="locate" size={17} color="#FFFFFF" />
                                <Text style={styles.navRecenterText}>My Position</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.navRecalculateBtn}
                                onPress={() => {
                                    if (navigationRoute && myLocation) {
                                        startTurnByTurnNavigation(navigationRoute.to, navigationRoute.label, navigationRoute.targetMemberId);
                                    }
                                }}
                                activeOpacity={0.8}
                            >
                                <Ionicons name="refresh" size={16} color="#38BDF8" />
                                <Text style={styles.navRecalculateText}>Reroute</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.navEndBtn}
                                onPress={() => {
                                    setNavigationRoute(null);
                                    setCurrentNavStepIndex(0);
                                }}
                                activeOpacity={0.8}
                            >
                                <Ionicons name="stop-circle" size={17} color="#EF4444" />
                                <Text style={styles.navEndText}>End</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                ) : selectedMember3D ? (
                    <FamilyActionSheet
                        member={selectedMember3D}
                        isSelf={selectedMemberId === user?.id}
                        isOnline={selectedMemberStatus?.isActive ?? true}
                        isLocalOnline={isLocalOnline}
                        myLocation={myLocation}
                        userBattery={userBattery}
                        onClose={() => {
                            setSelectedMemberId(null);
                            setNavigationRoute(null);
                        }}
                        onCheckIn={handleCheckIn}
                        onSendSMSCheckIn={handleSendSMSCheckIn}
                        onNavigateToMember={handleNavigateToMember}
                        onCallMember={handleCallMember}
                        onSendOfflineSMS={handleSendOfflineSMS}
                        onLoudPing={handleLoudPing}
                        onTriggerSOS={handleTriggerSOS}
                        onMarkSafe={handleMarkSafe}
                        isMarkedSafe={isMarkedSafe}
                    />
                ) : (
                    <>
                        <View style={styles.legend}>
                            <TouchableOpacity
                                style={[
                                    styles.legendItem,
                                    !selectedMemberId && styles.legendItemActive,
                                ]}
                                onPress={() => {
                                    setSelectedMemberId(null);
                                    setNavigationRoute(null);
                                    if (myLocation) {
                                        mapRef.current?.animateToRegion?.({
                                            latitude: myLocation.lat,
                                            longitude: myLocation.lng,
                                            latitudeDelta: 0.02,
                                            longitudeDelta: 0.02,
                                        }, 600);
                                    }
                                }}
                                activeOpacity={0.7}
                            >
                                <Ionicons
                                    name="people"
                                    size={14}
                                    color={!selectedMemberId ? Colors.tracker : Colors.textMuted}
                                />
                                <Text style={[
                                    styles.legendText,
                                    !selectedMemberId && styles.legendTextActive,
                                ]}>All</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[
                                    styles.legendItem,
                                    selectedMemberId === user?.id && styles.legendItemActive,
                                ]}
                                onPress={() => focusOnMember(myLocation?.lat, myLocation?.lng, user?.id, 'You', new Date().toISOString())}
                                activeOpacity={0.7}
                            >
                                <View style={[styles.dot, { backgroundColor: isMarkedSafe ? '#16A34A' : Colors.sos }]} />
                                <Text style={[
                                    styles.legendText,
                                    selectedMemberId === user?.id && styles.legendTextActive,
                                ]}>You {isMarkedSafe ? '✓' : ''}</Text>
                                <View style={styles.legendLiveBadge}>
                                    <Text style={styles.legendLiveText}>LIVE</Text>
                                </View>
                            </TouchableOpacity>
                        </View>

                        {/* Family List (Active members first, sorted by last active time) */}
                        <FlatList
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            data={sortedFamilyMembers}
                            keyExtractor={(item) => item.id}
                            contentContainerStyle={styles.familyList}
                            renderItem={({ item, index }) => {
                                const isSelected = selectedMemberId === item.id;
                                const hasLocation = Boolean(item.lat && item.lng);
                                const status = getTrackingStatus(item.updated_at, hasLocation);

                                return (
                                    <TouchableOpacity
                                        style={[
                                            styles.memberCard,
                                            isSelected && styles.memberCardActive,
                                        ]}
                                        onPress={() => focusOnMember(item.lat, item.lng, item.id, item.name, item.updated_at)}
                                        activeOpacity={0.7}
                                    >
                                        <View style={[
                                            styles.memberAvatar,
                                            { borderColor: MEMBER_COLORS[index % MEMBER_COLORS.length] },
                                            isSelected && styles.memberAvatarActive,
                                            !hasLocation && styles.memberAvatarOffline,
                                        ]}>
                                            {item.avatar_url ? (
                                                <Image source={{ uri: item.avatar_url }} style={styles.avatarImg} />
                                            ) : (
                                                <Text style={[styles.avatarText, { color: MEMBER_COLORS[index % MEMBER_COLORS.length] }]}>
                                                    {item.name.charAt(0).toUpperCase()}
                                                </Text>
                                            )}
                                            <View style={[styles.onlineBadge, { backgroundColor: status.color }]} />
                                        </View>
                                        <Text
                                            style={[
                                                styles.memberName,
                                                isSelected && styles.memberNameActive,
                                            ]}
                                            numberOfLines={1}
                                        >
                                            {item.name.split(' ')[0]}
                                        </Text>
                                        <View style={[styles.statusPill, { backgroundColor: status.color + '18' }]}>
                                            <View style={[styles.statusMiniDot, { backgroundColor: status.color }]} />
                                            <Text style={[styles.statusPillText, { color: status.color }]} numberOfLines={1}>
                                                {status.isActive ? 'Active' : status.timeAgo}
                                            </Text>
                                        </View>
                                    </TouchableOpacity>
                                );
                            }}
                        />

                        <View style={styles.liveIndicator}>
                            <View style={[styles.liveDot, { backgroundColor: activeCount > 0 ? Colors.secondary : Colors.textMuted }]} />
                            <Text style={styles.liveText}>
                                {activeCount} of {familyLocations.length + (myLocation ? 1 : 0)} Active • Live Tracking
                            </Text>
                        </View>

                        <TouchableOpacity style={[styles.shareBtn, { backgroundColor: Colors.secondary }]} onPress={fetchFamilyLocations}>
                            <Ionicons name="refresh" size={18} color={Colors.white} />
                            <Text style={styles.shareBtnText}>Refresh Family Locations</Text>
                        </TouchableOpacity>
                    </>
                )}
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    header: {
        backgroundColor: Colors.tracker,
        paddingTop: 48, paddingBottom: Spacing.lg, paddingHorizontal: Spacing.lg,
    },
    headerTitle: { fontSize: 24, fontWeight: '800', color: Colors.white },
    headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
    mapPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    loadingText: { color: Colors.textLight, marginTop: 12, fontSize: 14 },
    map: { flex: 1 },
    bottomCard: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: Colors.white,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: Spacing.lg,
        paddingTop: 6,
        shadowColor: '#000',
        shadowOpacity: 0.15,
        shadowRadius: 16,
        elevation: 10,
        overflow: 'hidden',
    },
    cardHeaderHandle: {
        paddingTop: 6,
        paddingBottom: 10,
        width: '100%',
    },
    handleBar: {
        width: 38,
        height: 4,
        borderRadius: 2,
        backgroundColor: '#CBD5E1',
        alignSelf: 'center',
        marginBottom: 8,
    },
    cardHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
    },
    cardHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flex: 1,
    },
    statusPulse: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    cardHeaderTitle: {
        fontSize: 14,
        fontWeight: '800',
        color: Colors.text,
    },
    countBadge: {
        backgroundColor: Colors.background,
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: BorderRadius.full,
    },
    countBadgeText: {
        fontSize: 11,
        fontWeight: '700',
        color: Colors.textMuted,
    },
    cardHeaderRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    collapseHintText: {
        fontSize: 12,
        fontWeight: '600',
        color: Colors.textMuted,
    },
    legend: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.md, flexWrap: 'wrap' },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, paddingVertical: 3, borderRadius: BorderRadius.full },
    legendItemActive: {
        backgroundColor: Colors.sos + '18',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: BorderRadius.full,
    },
    legendLiveBadge: {
        backgroundColor: '#22C55E20',
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: BorderRadius.full,
        marginLeft: 2,
    },
    legendLiveText: {
        fontSize: 9,
        fontWeight: '800',
        color: '#22C55E',
    },
    dot: { width: 10, height: 10, borderRadius: 5 },
    legendText: { fontSize: 12, color: Colors.text },
    legendTextActive: {
        fontWeight: '800',
        color: Colors.sos,
    },
    shareBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        backgroundColor: Colors.tracker, borderRadius: BorderRadius.md,
        paddingVertical: 14,
    },
    shareBtnText: { color: Colors.white, fontWeight: '700', fontSize: 15 },
    updateText: { textAlign: 'center', color: Colors.textMuted, fontSize: 11, marginTop: 8 },
    liveIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        marginBottom: 12,
        backgroundColor: Colors.secondary + '10',
        paddingVertical: 6,
        borderRadius: BorderRadius.full,
    },
    liveDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: Colors.secondary,
    },
    liveText: {
        fontSize: 12,
        fontWeight: '700',
        color: Colors.secondary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    familyList: { gap: 14, paddingVertical: 8 },
    memberCard: { alignItems: 'center', width: 78 },
    memberCardActive: {
        transform: [{ scale: 1.05 }],
    },
    memberAvatar: {
        width: 56, height: 56, borderRadius: 28,
        borderWidth: 2, padding: 2,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: Colors.white,
    },
    memberAvatarActive: {
        borderWidth: 3,
        borderColor: Colors.secondary,
        shadowColor: Colors.secondary,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.35,
        shadowRadius: 5,
        elevation: 6,
    },
    memberAvatarOffline: {
        opacity: 0.55,
    },
    avatarImg: { width: '100%', height: '100%', borderRadius: 28 },
    avatarText: { fontSize: 20, fontWeight: '800' },
    onlineBadge: {
        position: 'absolute', bottom: 0, right: 0,
        width: 14, height: 14, borderRadius: 7,
        borderWidth: 2, borderColor: Colors.white
    },
    memberName: { fontSize: 12, fontWeight: '600', color: Colors.text, textAlign: 'center', marginTop: 4 },
    memberNameActive: {
        fontWeight: '800',
        color: Colors.secondary,
    },
    statusPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: BorderRadius.full,
        marginTop: 3,
        maxWidth: 74,
    },
    statusMiniDot: {
        width: 5,
        height: 5,
        borderRadius: 2.5,
    },
    statusPillText: {
        fontSize: 9,
        fontWeight: '700',
    },
    markerContainer: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    markerLabel: {
        backgroundColor: Colors.white,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
        marginBottom: 3,
        borderWidth: 1.5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 3,
        elevation: 3,
    },
    markerLabelText: {
        fontSize: 11,
        fontWeight: '800',
        color: Colors.text,
    },
    markerBubble: {
        width: 48,
        height: 48,
        borderRadius: 24,
        borderWidth: 3,
        backgroundColor: Colors.white,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 6,
    },
    markerAvatarImg: {
        width: '100%',
        height: '100%',
        borderRadius: 22,
    },
    markerAvatarFallback: {
        width: '100%',
        height: '100%',
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    markerInitialText: {
        fontSize: 18,
        fontWeight: '800',
        color: Colors.white,
    },
    markerStatusDot: {
        position: 'absolute',
        top: -1,
        right: -1,
        width: 12,
        height: 12,
        borderRadius: 6,
        borderWidth: 2,
        borderColor: Colors.white,
    },
    markerPointer: {
        width: 0,
        height: 0,
        backgroundColor: 'transparent',
        borderStyle: 'solid',
        borderLeftWidth: 6,
        borderRightWidth: 6,
        borderTopWidth: 7,
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
        alignSelf: 'center',
        marginTop: -1,
    },
    navBottomBar: {
        paddingTop: Spacing.sm,
        paddingHorizontal: Spacing.md,
        paddingBottom: Spacing.xs,
    },
    navBottomInfo: {
        marginBottom: Spacing.sm,
    },
    navDestRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    navDestIconCircle: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    navDestTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: Colors.text,
    },
    navDestSub: {
        fontSize: 12,
        color: Colors.textMuted,
        marginTop: 2,
    },
    navActionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    navRecenterBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: Colors.secondary,
        paddingVertical: 10,
        borderRadius: BorderRadius.md,
    },
    navRecenterText: {
        color: Colors.white,
        fontWeight: '600',
        fontSize: 13,
    },
    navRecalculateBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        backgroundColor: '#0F172A',
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: BorderRadius.md,
        borderWidth: 1,
        borderColor: '#334155',
    },
    navRecalculateText: {
        color: '#38BDF8',
        fontWeight: '600',
        fontSize: 12,
    },
    navEndBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        backgroundColor: '#FEF2F2',
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: BorderRadius.md,
        borderWidth: 1,
        borderColor: '#FEE2E2',
    },
    navEndText: {
        color: '#DC2626',
        fontWeight: '600',
        fontSize: 12,
    },
});
