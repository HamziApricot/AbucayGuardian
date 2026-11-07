import React, { useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet, Animated,
    Dimensions, Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Fonts } from '../constants/theme';
import { useAlert } from '../context/AlertContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');

export const CustomToast = () => {
    const { toast } = useAlert();
    const insets = useSafeAreaInsets();
    const slideAnim = useRef(new Animated.Value(-100)).current;

    useEffect(() => {
        if (toast) {
            Animated.spring(slideAnim, {
                toValue: Math.max(insets.top, 20),
                useNativeDriver: true,
                tension: 40,
                friction: 8
            }).start();
        } else {
            Animated.timing(slideAnim, {
                toValue: -100,
                duration: 300,
                useNativeDriver: true
            }).start();
        }
    }, [toast, insets.top]);

    if (!toast) return null;

    const getIcon = () => {
        switch (toast.type) {
            case 'success': return 'checkmark-circle';
            case 'error': return 'alert-circle';
            case 'warning': return 'warning';
            default: return 'information-circle';
        }
    };

    const getColor = () => {
        switch (toast.type) {
            case 'success': return Colors.success;
            case 'error': return Colors.danger;
            case 'warning': return Colors.warning;
            default: return Colors.family;
        }
    };

    return (
        <Animated.View style={[
            styles.container,
            { transform: [{ translateY: slideAnim }] }
        ]}>
            <View style={[styles.toast, { borderLeftColor: getColor() }]}>
                <Ionicons name={getIcon() as any} size={24} color={getColor()} />
                <Text style={styles.message} numberOfLines={2}>{toast.message}</Text>
            </View>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        alignItems: 'center',
        paddingHorizontal: Spacing.md,
    },
    toast: {
        backgroundColor: Colors.card,
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.lg,
        borderRadius: BorderRadius.lg,
        width: '100%',
        maxWidth: 400,
        borderLeftWidth: 4,
        gap: Spacing.sm,
        ...Platform.select({
            ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.15,
                shadowRadius: 10,
            },
            android: {
                elevation: 6,
            },
        }),
    },
    message: {
        fontSize: Fonts.sizes.md,
        fontWeight: '600',
        color: Colors.text,
        flex: 1,
    },
});
