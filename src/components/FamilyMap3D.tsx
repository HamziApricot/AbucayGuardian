import React, { forwardRef } from 'react';
import { isMapLibreNativeAvailable } from '../utils/nativeCheck';
import { FamilyMapExpo } from './FamilyMapExpo';

export interface FamilyMember3D {
  id: string;
  memberUserId?: string | null; // Supabase auth user id for peer-to-peer targeting
  name: string;
  avatarUrl?: string | null;
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number;
  heading?: number | null; // Facing/travel direction in degrees (0 - 360)
  batteryLevel?: number | null; // 0.0 to 1.0 or null/undefined if unknown
  isOnline: boolean;
  lastUpdated: string;
  color?: string;
  phone?: string;
  relationship?: string;
  // Historical coordinates synced from offline buffer: [[lng, lat], ...]
  routeHistory?: [number, number][];
}

export interface FamilyMap3DHandle {
  focusOnMember: (memberId: string) => void;
  focusOnCoordinates: (latitude: number, longitude: number, memberId?: string) => void;
  flyTo: (options: {
    center: [number, number];
    zoom?: number;
    pitch?: number;
    bearing?: number;
    duration?: number;
  }) => void;
  animateToRegion?: (
    region: { latitude: number; longitude: number; latitudeDelta?: number; longitudeDelta?: number },
    duration?: number
  ) => void;
}

import type { NavigationRoute } from '../services/RoutingService';
export type { NavigationRoute };

export interface FamilyMap3DProps {
  members: FamilyMember3D[];
  selectedMemberId?: string | null;
  onSelectMember?: (member: FamilyMember3D | null) => void;
  onCancelFocus?: () => void;
  showMemberStrip?: boolean;
  onMapInteraction?: () => void;
  showSafetyPOIs?: boolean;
  navigationRoute?: NavigationRoute | null;
}

export const OPENFREEMAP_STYLES = {
  liberty: 'https://tiles.openfreemap.org/styles/liberty',
  bright: 'https://tiles.openfreemap.org/styles/bright',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

export const FamilyMap3D = forwardRef<FamilyMap3DHandle, FamilyMap3DProps>((props, ref) => {
  // If running in a native custom development build where MapLibre native code is compiled
  if (isMapLibreNativeAvailable()) {
    try {
      const FamilyMapNative3D = require('./FamilyMapNative3D').default;
      if (FamilyMapNative3D) {
        return <FamilyMapNative3D ref={ref} {...props} />;
      }
    } catch (e) {
      console.warn('[FamilyMap3D] Failed to load MapLibre native engine, falling back to Expo map:', e);
    }
  }

  // Running in Expo Go or standard runtime: use react-native-maps engine
  return <FamilyMapExpo ref={ref} {...props} />;
});

export default FamilyMap3D;
