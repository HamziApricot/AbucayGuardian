import React, { forwardRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../constants/theme';

export const Marker = ({ title, description }: any) => {
    // Simple placeholder for markers in a list or similar
    return null;
};

export const Circle = () => null;
export const Polyline = () => null;
export const Callout = () => null;

const MapViewWrapper = forwardRef((props: any, ref: any) => {
    return (
        <View style={[props.style, styles.placeholder]}>
            <Text style={styles.text}>Map View is currently only available on Mobile.</Text>
            <Text style={styles.subtext}>Please use an Android or iOS device to see real-time tracking.</Text>
        </View>
    );
});

const styles = StyleSheet.create({
    placeholder: {
        backgroundColor: '#f0f0f0',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
    },
    text: {
        fontSize: 16,
        fontWeight: 'bold',
        color: Colors.text,
        textAlign: 'center',
    },
    subtext: {
        fontSize: 14,
        color: Colors.textLight,
        textAlign: 'center',
        marginTop: 10,
    }
});

export default MapViewWrapper;
