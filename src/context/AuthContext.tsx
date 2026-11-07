import React, { createContext, useContext, useEffect, useState } from 'react';
// @ts-ignore
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { UserProfile } from '../types';

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

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }: any) => {
            setSession(session);
            setUser(session?.user ?? null);
            if (session?.user) fetchProfile(session.user.id);
            setLoading(false);
        });

        const { data: listener } = supabase.auth.onAuthStateChange((_event: any, session: any) => {
            setSession(session);
            setUser(session?.user ?? null);
            if (session?.user) {
                fetchProfile(session.user.id);
            } else {
                setUserProfile(null);
            }
        });

        return () => listener.subscription.unsubscribe();
    }, []);

    const generatePairingCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

    const fetchProfile = async (userId: string) => {
        const { data } = await supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();

        if (data) {
            let profile = data as UserProfile;
            if (!profile.pairing_code) {
                const newCode = generatePairingCode();
                await supabase.from('users').update({ pairing_code: newCode }).eq('id', userId);
                profile = { ...profile, pairing_code: newCode };
            }
            setUserProfile(profile);
        }
    };

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

        const { error } = await supabase.from('users').insert({
            id: user.id,
            name: name.trim(),
            phone: phone.trim(),
            pairing_code: generatePairingCode(),
            updated_at: new Date().toISOString(),
        });

        if (error) return { error: error.message };
        await fetchProfile(user.id);
        return { error: null };
    };

    const signOut = async () => {
        await supabase.auth.signOut();
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
