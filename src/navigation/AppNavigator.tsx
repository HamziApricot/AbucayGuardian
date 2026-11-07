import React, { useState, useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Colors } from '../constants/theme';
import { useAuth } from '../context/AuthContext';

// Auth Screens
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';

// Permissions Onboarding Screen
import PermissionsOnboardingScreen from '../screens/PermissionsOnboardingScreen';

// Main Screens
import HomeScreen from '../screens/HomeScreen';
import SOSScreen from '../screens/SOSScreen';
import HotlinesScreen from '../screens/HotlinesScreen';
import ProceduresScreen from '../screens/ProceduresScreen';
import FamilyTrackerScreen from '../screens/FamilyTrackerScreen';
import FamilyMembersScreen from '../screens/FamilyMembersScreen';
import EmergencyPlanScreen from '../screens/EmergencyPlanScreen';
import ProfileScreen from '../screens/ProfileScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const TAB_CONFIG = [
    { name: 'Home', label: 'Home', icon: 'home', activeIcon: 'home', color: Colors.secondary },
    { name: 'Hotlines', label: 'Hotlines', icon: 'call-outline', activeIcon: 'call', color: Colors.hotline },
    { name: 'Procedures', label: 'Guide', icon: 'document-text-outline', activeIcon: 'document-text', color: Colors.family },
    { name: 'Tracker', label: 'Tracker', icon: 'location-outline', activeIcon: 'location', color: Colors.tracker },
    { name: 'Family', label: 'Family', icon: 'people-outline', activeIcon: 'people', color: Colors.family },
    { name: 'Profile', label: 'Profile', icon: 'person-outline', activeIcon: 'person', color: Colors.secondary },
];

// SOS Tab Button — custom center button
function SOSTabButton({ onPress }: { onPress: () => void }) {
    return (
        <View style={sosStyles.container}>
            <View
                // @ts-ignore
                onStartShouldSetResponder={() => true}
                onResponderRelease={onPress}
                style={sosStyles.btn}
            >
                <Ionicons name="warning" size={28} color={Colors.white} />
            </View>
        </View>
    );
}

const sosStyles = StyleSheet.create({
    container: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: -20 },
    btn: {
        width: 60, height: 60, borderRadius: 30,
        backgroundColor: Colors.sos,
        alignItems: 'center', justifyContent: 'center',
        shadowColor: Colors.sos,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 12,
        elevation: 8,
    },
});

function MainTabs({ navigation }: any) {
    const insets = useSafeAreaInsets();

    return (
        <Tab.Navigator
            screenOptions={({ route }) => ({
                headerShown: false,
                tabBarStyle: {
                    backgroundColor: Colors.white,
                    borderTopColor: Colors.border,
                    paddingBottom: Math.max(insets.bottom, 8),
                    paddingTop: 8,
                    height: 60 + Math.max(insets.bottom - 12, 0),
                },
                tabBarActiveTintColor: TAB_CONFIG.find((t) => t.name === route.name)?.color ?? Colors.secondary,
                tabBarInactiveTintColor: Colors.textMuted,
                tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
                tabBarIcon: ({ focused, color }) => {
                    const cfg = TAB_CONFIG.find((t) => t.name === route.name);
                    const iconName = focused ? cfg?.activeIcon : cfg?.icon;
                    return <Ionicons name={iconName as any} size={22} color={color} />;
                },
            })}
        >
            <Tab.Screen name="Home" component={HomeStack} options={{ title: 'Home' }} />
            <Tab.Screen name="Hotlines" component={HotlinesScreen} />
            <Tab.Screen name="Procedures" component={ProceduresScreen} options={{ title: 'Guide' }} />
            <Tab.Screen name="Tracker" component={FamilyTrackerScreen} />
            <Tab.Screen name="Family" component={FamilyMembersScreen} />
            <Tab.Screen name="Profile" component={ProfileScreen} />
        </Tab.Navigator>
    );
}

// Home nested stack to allow SOS and EmergencyPlan push
const HomeStackNav = createNativeStackNavigator();
function HomeStack() {
    return (
        <HomeStackNav.Navigator screenOptions={{ headerShown: false }}>
            <HomeStackNav.Screen name="HomeMain" component={HomeScreen} />
            <HomeStackNav.Screen name="SOS" component={SOSScreen} options={{ presentation: 'fullScreenModal' }} />
            <HomeStackNav.Screen name="EmergencyPlan" component={EmergencyPlanScreen} />
        </HomeStackNav.Navigator>
    );
}

// Auth Stack
function AuthStack() {
    return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
        </Stack.Navigator>
    );
}

export default function AppNavigator() {
    const { session, userProfile, loading } = useAuth();
    const [permissionsChecked, setPermissionsChecked] = useState(false);
    const [permissionsOnboarded, setPermissionsOnboarded] = useState(false);

    useEffect(() => {
        const checkOnboarding = async () => {
            try {
                const onboarded = await AsyncStorage.getItem('@abucay_permissions_onboarded_v1');
                setPermissionsOnboarded(onboarded === 'true');
            } catch (e) {
                setPermissionsOnboarded(false);
            } finally {
                setPermissionsChecked(true);
            }
        };

        if (session) {
            checkOnboarding();
        } else {
            setPermissionsChecked(true);
        }
    }, [session?.user?.id, userProfile?.id]);

    if (loading || !permissionsChecked) return null;

    if (session && (userProfile || permissionsOnboarded)) {
        if (!permissionsOnboarded) {
            return (
                <PermissionsOnboardingScreen
                    onComplete={async () => {
                        try {
                            await AsyncStorage.setItem('@abucay_permissions_onboarded_v1', 'true');
                        } catch {}
                        setPermissionsOnboarded(true);
                    }}
                />
            );
        }
        return <MainTabs />;
    }

    return <AuthStack />;
}
