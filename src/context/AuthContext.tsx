import React, { createContext, useContext, useEffect, useState } from 'react';
// @ts-ignore
import { Session, User } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { UserProfile } from '../types';

const CACHED_PROFILE_KEY = '@abucay_cached_user_profile';
const ONBOARDED_KEY = '@abucay_permissions_onboarded_v1';

type AuthContextType = {
    session: Session | null;
    user: User | null;
    userProfile: UserProfile | null;
    loading: boolean;
    sendOtp: (phone: string) => Promise<{ error: string | null }>;
    verifyOtp: (phone: string, token: string, name?: string) => Promise<{ error: string | null; isNewUser?: boolean }>;
    createProfile: (name: string, phone: string) => Promise<{ error: string | null }>;
    signOut: () => Promise<void>;
    refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [session, setSession] = useState<Session | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    const generatePairingCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

    const fetchProfile = async (userId: string): Promise<void> => {
        try {
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('id', userId)
                .single();

            if (data) {
                let profile = data as UserProfile;
                if (!profile.pairing_code) {
                    const newCode = generatePairingCode();
                    try {
                        await supabase.from('users').update({ pairing_code: newCode }).eq('id', userId);
                    } catch {}
                    profile = { ...profile, pairing_code: newCode };
                }
                setUserProfile(profile);
                try {
                    await AsyncStorage.setItem(CACHED_PROFILE_KEY, JSON.stringify(profile));
                } catch {}
                return;
            }

            if (error) {
                // If it's a genuine 404 / PGRST116 (user confirmed nonexistent in DB while online)
                if (error.code === 'PGRST116') {
                    // Check if we have an onboarded user locally; if so, keep fallback
                    const onboarded = await AsyncStorage.getItem(ONBOARDED_KEY);
                    if (onboarded !== 'true') {
                        setUserProfile(null);
                    }
                } else {
                    console.log('[AuthContext] Network/offline fetch error:', error.message);
                    // Offline fallback: restore from cached profile
                    await restoreFromCache(userId);
                }
            }
        } catch (err) {
            console.log('[AuthContext] fetchProfile offline exception:', err);
            await restoreFromCache(userId);
        }
    };

    const restoreFromCache = async (userId: string) => {
        try {
            const cachedStr = await AsyncStorage.getItem(CACHED_PROFILE_KEY);
            if (cachedStr) {
                const cached = JSON.parse(cachedStr) as UserProfile;
                if (cached && cached.id === userId) {
                    setUserProfile(cached);
                    return;
                }
            }
        } catch (e) {
            console.warn('[AuthContext] restoreFromCache error:', e);
        }
    };

    useEffect(() => {
        let isMounted = true;

        const initAuth = async () => {
            try {
                // 1. Preload cached profile from disk (instant offline recovery)
                let cachedProfile: UserProfile | null = null;
                try {
                    const cachedStr = await AsyncStorage.getItem(CACHED_PROFILE_KEY);
                    if (cachedStr) {
                        cachedProfile = JSON.parse(cachedStr) as UserProfile;
                    }
                } catch (e) {
                    console.warn('[AuthContext] Preload cached profile error:', e);
                }

                // 2. Fetch persisted Supabase auth session
                const { data: { session: initialSession } } = await supabase.auth.getSession();
                if (!isMounted) return;

                setSession(initialSession);
                setUser(initialSession?.user ?? null);

                if (initialSession?.user) {
                    const currentUserId = initialSession.user.id;
                    if (cachedProfile && cachedProfile.id === currentUserId) {
                        setUserProfile(cachedProfile);
                    } else {
                        // Check if previously onboarded on this device or has user metadata
                        const onboarded = await AsyncStorage.getItem(ONBOARDED_KEY);
                        if (onboarded === 'true' || initialSession.user.user_metadata?.name) {
                            const fallbackProfile: UserProfile = {
                                id: currentUserId,
                                name: initialSession.user.user_metadata?.name || initialSession.user.phone || 'Citizen Guardian',
                                phone: initialSession.user.phone || '',
                                pairing_code: '',
                            };
                            setUserProfile(fallbackProfile);
                            try {
                                await AsyncStorage.setItem(CACHED_PROFILE_KEY, JSON.stringify(fallbackProfile));
                            } catch {}
                        }
                    }

                    // Background network query to refresh remote changes if online
                    fetchProfile(currentUserId);
                } else {
                    setUserProfile(null);
                }
            } catch (err) {
                console.warn('[AuthContext] initAuth error:', err);
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        };

        initAuth();

        const { data: listener } = supabase.auth.onAuthStateChange(async (event: string, authSession: any) => {
            if (!isMounted) return;
            setSession(authSession);
            setUser(authSession?.user ?? null);

            if (authSession?.user) {
                fetchProfile(authSession.user.id);
            } else if (event === 'SIGNED_OUT') {
                setUserProfile(null);
                try {
                    await AsyncStorage.removeItem(CACHED_PROFILE_KEY);
                } catch {}
            }
        });

        return () => {
            isMounted = false;
            listener.subscription.unsubscribe();
        };
    }, []);

    const refreshProfile = async () => {
        if (user) await fetchProfile(user.id);
    };

    const sendOtp = async (phone: string) => {
        const { error } = await supabase.auth.signInWithOtp({ phone: phone.trim() });
        return { error: error?.message ?? null };
    };

    const verifyOtp = async (phone: string, token: string, name?: string) => {
        const { data, error } = await supabase.auth.verifyOtp({
            phone: phone.trim(),
            token: token.trim(),
            type: 'sms',
        });

        if (error) return { error: error.message };

        if (data.user) {
            // Check if profile exists
            const { data: profile } = await supabase
                .from('users')
                .select('id')
                .eq('id', data.user.id)
                .single();

            if (!profile) {
                if (name) {
                    await createProfile(name, phone);
                    return { error: null, isNewUser: false };
                }
                return { error: null, isNewUser: true };
            }
            await fetchProfile(data.user.id);
        }

        return { error: null, isNewUser: false };
    };

    const createProfile = async (name: string, phone: string) => {
        if (!user) return { error: 'No authenticated user' };

        const trimmedName = name.trim();
        const trimmedPhone = phone.trim();
        const pairingCode = generatePairingCode();

        const { error } = await supabase.from('users').insert({
            id: user.id,
            name: trimmedName,
            phone: trimmedPhone,
            pairing_code: pairingCode,
            updated_at: new Date().toISOString(),
        });

        if (error) return { error: error.message };

        // Sync name into Supabase Auth user metadata so session permanently retains it
        try {
            await supabase.auth.updateUser({ data: { name: trimmedName } });
        } catch {}

        const newProfile: UserProfile = {
            id: user.id,
            name: trimmedName,
            phone: trimmedPhone,
            pairing_code: pairingCode,
            updated_at: new Date().toISOString(),
        };

        setUserProfile(newProfile);
        try {
            await AsyncStorage.setItem(CACHED_PROFILE_KEY, JSON.stringify(newProfile));
        } catch {}

        await fetchProfile(user.id);
        return { error: null };
    };

    const signOut = async () => {
        try {
            await supabase.auth.signOut();
        } catch (e) {
            console.warn('[AuthContext] SignOut error:', e);
        }
        try {
            await AsyncStorage.removeItem(CACHED_PROFILE_KEY);
        } catch {}
        setSession(null);
        setUser(null);
        setUserProfile(null);
    };

    return (
        <AuthContext.Provider value={{ session, user, userProfile, loading, sendOtp, verifyOtp, createProfile, signOut, refreshProfile }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
};
