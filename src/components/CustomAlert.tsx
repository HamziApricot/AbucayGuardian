import React, { useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet, Modal, TouchableOpacity,
    Animated, Dimensions, Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Fonts } from '../constants/theme';
import { useAlert } from '../context/AlertContext';

const { width } = Dimensions.get('window');

export const CustomAlert = () => {
    const { alert, hideAlert } = useAlert();
    const scaleAnim = useRef(new Animated.Value(0)).current;
    const opacityAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (alert) {
            Animated.parallel([
                Animated.spring(scaleAnim, {
                    toValue: 1,
                    useNativeDriver: true,
                    tension: 50,
                    friction: 7
                }),
                Animated.timing(opacityAnim, {
                    toValue: 1,
                    duration: 200,
                    useNativeDriver: true
                })
            ]).start();
        } else {
            scaleAnim.setValue(0);
            opacityAnim.setValue(0);
        }
    }, [alert]);

    if (!alert) return null;

    const getIcon = () => {
        switch (alert.type) {
            case 'success': return 'checkmark-circle';
            case 'error': return 'alert-circle';
            case 'warning': return 'warning';
            default: return 'information-circle';
        }
    };

    const getColor = () => {
        switch (alert.type) {
            case 'success': return Colors.success;
            case 'error': return Colors.danger;
            case 'warning': return Colors.warning;
            default: return Colors.family;
        }
    };

    return (
        <Modal transparent visible={!!alert} animationType="none">
            <View style={styles.overlay}>
                <Animated.View style={[
                    styles.container,
                    {
                        opacity: opacityAnim,
                        transform: [{ scale: scaleAnim }]
                    }
                ]}>
                    <View style={[styles.header, { backgroundColor: getColor() + '10' }]}>
                        <Ionicons name={getIcon() as any} size={40} color={getColor()} />
                    </View>

                    <View style={styles.content}>
                        <Text style={styles.title}>{alert.title}</Text>
                        <Text style={styles.message}>{alert.message}</Text>
                    </View>

                    <View style={styles.footer}>
                        {alert.buttons ? alert.buttons.map((btn, index) => (
                            <TouchableOpacity
                                key={index}
                                style={[
                                    styles.button,
                                    index > 0 && styles.borderLeft,
                                    btn.style === 'destructive' && styles.destructiveBtn
                                ]}
                                onPress={() => {
                                    hideAlert();
                                    if (btn.onPress) btn.onPress();
                                }}
                            >
                                <Text style={[
                                    styles.buttonText,
                                    btn.style === 'destructive' && styles.destructiveText,
                                    btn.style === 'cancel' && styles.cancelText
                                ]}>
                                    {btn.text}
                                </Text>
                            </TouchableOpacity>
                        )) : (
                            <TouchableOpacity style={styles.button} onPress={hideAlert}>
                                <Text style={styles.buttonText}>OK</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                </Animated.View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(13, 31, 78, 0.6)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: Spacing.xl,
    },
    container: {
        backgroundColor: Colors.card,
        width: '100%',
        maxWidth: 340,
        borderRadius: BorderRadius.xl,
        overflow: 'hidden',
        ...Platform.select({
            ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 10 },
                shadowOpacity: 0.2,
                shadowRadius: 20,
            },
            android: {
                elevation: 10,
            },
        }),
    },
    header: {
        alignItems: 'center',
        paddingVertical: Spacing.lg,
    },
    content: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.lg,
        alignItems: 'center',
    },
    title: {
        fontSize: Fonts.sizes.xl,
        fontWeight: '800',
        color: Colors.text,
        textAlign: 'center',
        marginBottom: Spacing.sm,
    },
    message: {
        fontSize: Fonts.sizes.md,
        color: Colors.textLight,
        textAlign: 'center',
        lineHeight: 22,
    },
    footer: {
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: 'rgba(0,0,0,0.05)',
    },
    button: {
        flex: 1,
        paddingVertical: Spacing.md,
        alignItems: 'center',
        justifyContent: 'center',
    },
    borderLeft: {
        borderLeftWidth: 1,
        borderLeftColor: 'rgba(0,0,0,0.05)',
    },
    buttonText: {
        fontSize: Fonts.sizes.md,
        fontWeight: '700',
        color: Colors.family,
    },
    destructiveBtn: {
        // backgroundColor: Colors.danger + '05',
    },
    destructiveText: {
        color: Colors.danger,
    },
    cancelText: {
        color: Colors.textMuted,
        fontWeight: '500',
    },
});
