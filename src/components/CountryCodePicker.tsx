import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, FlatList, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, BorderRadius, Spacing } from '../constants/theme';
import { CountryCodes } from '../constants/countries';

type Props = {
    selectedCountry: string;
    onSelect: (code: string) => void;
};

export default function CountryCodePicker({ selectedCountry, onSelect }: Props) {
    const [visible, setVisible] = useState(false);
    const [search, setSearch] = useState('');

    const country = CountryCodes.find(c => c.code === selectedCountry) || CountryCodes[0];

    const filtered = CountryCodes.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.code.includes(search)
    );

    const handleSelect = (code: string) => {
        onSelect(code);
        setVisible(false);
        setSearch('');
    };

    return (
        <>
            <TouchableOpacity style={styles.selector} onPress={() => setVisible(true)}>
                <Text style={styles.flag}>{country.flag}</Text>
                <Text style={styles.code}>{country.code}</Text>
                <Ionicons name="chevron-down" size={12} color={Colors.textLight} />
            </TouchableOpacity>

            <Modal visible={visible} animationType="slide" transparent>
                <SafeAreaView style={styles.overlay}>
                    <View style={styles.modal}>
                        <View style={styles.header}>
                            <Text style={styles.title}>Select Country</Text>
                            <TouchableOpacity onPress={() => setVisible(false)}>
                                <Ionicons name="close" size={24} color={Colors.text} />
                            </TouchableOpacity>
                        </View>

                        <View style={styles.searchBar}>
                            <Ionicons name="search-outline" size={18} color={Colors.textLight} />
                            <TextInput
                                style={styles.searchInput}
                                placeholder="Search country or code..."
                                value={search}
                                onChangeText={setSearch}
                                autoFocus
                            />
                        </View>

                        <FlatList
                            data={filtered}
                            keyExtractor={item => item.code}
                            renderItem={({ item }) => (
                                <TouchableOpacity style={styles.item} onPress={() => handleSelect(item.code)}>
                                    <View style={styles.itemRow}>
                                        <Text style={styles.itemFlag}>{item.flag}</Text>
                                        <Text style={styles.itemName}>{item.name}</Text>
                                    </View>
                                    <Text style={styles.itemCode}>{item.code}</Text>
                                </TouchableOpacity>
                            )}
                        />
                    </View>
                </SafeAreaView>
            </Modal>
        </>
    );
}

const styles = StyleSheet.create({
    selector: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        height: 48,
        borderRightWidth: 1,
        borderRightColor: Colors.border,
        gap: 4,
    },
    flag: { fontSize: 18 },
    code: { fontSize: 15, color: Colors.text, fontWeight: '600' },
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modal: {
        backgroundColor: Colors.white,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        height: '80%',
        padding: Spacing.lg,
    },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
    title: { fontSize: 18, fontWeight: '700', color: Colors.text },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Colors.background,
        borderRadius: BorderRadius.md,
        paddingHorizontal: 12,
        height: 44,
        marginBottom: Spacing.md,
    },
    searchInput: { flex: 1, marginLeft: 8, fontSize: 15, color: Colors.text },
    item: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: Colors.background,
    },
    itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    itemFlag: { fontSize: 24 },
    itemName: { fontSize: 16, fontWeight: '500', color: Colors.text },
    itemCode: { fontSize: 15, color: Colors.textLight, fontWeight: '600' },
});
