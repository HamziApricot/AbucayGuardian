import React, { useEffect, useState } from 'react';
import {
    View, Text, StyleSheet, FlatList, TouchableOpacity,
    Modal, TextInput, ActivityIndicator, ScrollView,
} from 'react-native';
import { useAlert } from '../context/AlertContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { EmergencyPlan, EmergencyPlanStep } from '../types';
import 'react-native-get-random-values';

const generateId = () => Math.random().toString(36).substring(2);

export default function EmergencyPlanScreen() {
    const { user } = useAuth();
    const insets = useSafeAreaInsets();
    const { showAlert, showToast } = useAlert();
    const [plans, setPlans] = useState<EmergencyPlan[]>([]);
    const [loading, setLoading] = useState(true);
    const [viewPlan, setViewPlan] = useState<EmergencyPlan | null>(null);
    const [modalVisible, setModalVisible] = useState(false);
    const [editPlan, setEditPlan] = useState<EmergencyPlan | null>(null);
    const [title, setTitle] = useState('');
    const [steps, setSteps] = useState<EmergencyPlanStep[]>([{ id: generateId(), text: '' }]);
    const [saving, setSaving] = useState(false);

    useEffect(() => { fetchPlans(); }, []);

    const fetchPlans = async () => {
        if (!user) return;
        const { data } = await supabase.from('emergency_plans').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
        setPlans((data as EmergencyPlan[]) ?? []);
        setLoading(false);
    };

    const openAdd = () => {
        setEditPlan(null); setTitle(''); setSteps([{ id: generateId(), text: '' }]);
        setModalVisible(true);
    };

    const openEdit = (plan: EmergencyPlan) => {
        setEditPlan(plan); setTitle(plan.title); setSteps(plan.steps ?? []);
        setModalVisible(true);
    };

    const addStep = () => setSteps([...steps, { id: generateId(), text: '' }]);
    const updateStep = (id: string, text: string) =>
        setSteps(steps.map((s) => (s.id === id ? { ...s, text } : s)));
    const removeStep = (id: string) => setSteps(steps.filter((s) => s.id !== id));

    const savePlan = async () => {
        if (!title) {
            showAlert({
                title: 'Missing Title',
                message: 'Please enter a plan title.',
                type: 'warning'
            });
            return;
        }
        const validSteps = steps.filter((s) => s.text.trim());
        if (validSteps.length === 0) {
            showAlert({
                title: 'No Steps',
                message: 'Add at least one step.',
                type: 'warning'
            });
            return;
        }
        setSaving(true);
        if (editPlan) {
            await supabase.from('emergency_plans').update({ title, steps: validSteps, updated_at: new Date().toISOString() }).eq('id', editPlan.id);
        } else {
            await supabase.from('emergency_plans').insert({ user_id: user?.id, title, steps: validSteps, created_at: new Date().toISOString() });
        }
        setSaving(false);
        setModalVisible(false);
        fetchPlans();
    };

    const deletePlan = (id: string) => {
        showAlert({
            title: 'Delete Plan',
            message: 'Are you sure you want to delete this emergency plan?',
            type: 'warning',
            buttons: [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete', style: 'destructive', onPress: async () => {
                        await supabase.from('emergency_plans').delete().eq('id', id);
                        showToast({
                            message: 'Plan deleted successfully',
                            type: 'success'
                        });
                        fetchPlans();
                    }
                },
            ]
        });
    };

    if (viewPlan) {
        return (
            <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 80 }}>
                <View style={[styles.detailHeader, { paddingTop: Math.max(insets.top, 20) }]}>
                    <TouchableOpacity style={styles.backBtn} onPress={() => setViewPlan(null)}>
                        <Ionicons name="arrow-back" size={22} color={Colors.white} />
                        <Text style={styles.backText}>Back</Text>
                    </TouchableOpacity>
                    <Ionicons name="clipboard" size={36} color={Colors.white} style={{ marginTop: 8 }} />
                    <Text style={styles.detailTitle}>{viewPlan.title}</Text>
                </View>
                <View style={{ padding: Spacing.lg }}>
                    <Text style={styles.stepsLabel}>Steps</Text>
                    {viewPlan.steps.map((step, i) => (
                        <View key={step.id} style={styles.stepRow}>
                            <View style={styles.stepNum}>
                                <Text style={styles.stepNumText}>{i + 1}</Text>
                            </View>
                            <Text style={styles.stepText}>{step.text}</Text>
                        </View>
                    ))}
                </View>
            </ScrollView>
        );
    }

    return (
        <View style={styles.container}>
            <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
                <Text style={styles.headerTitle}>Emergency Plans</Text>
                <Text style={styles.headerSub}>Your personalized safety plans</Text>
                <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
                    <Ionicons name="add" size={16} color={Colors.white} />
                    <Text style={styles.addBtnText}>New Plan</Text>
                </TouchableOpacity>
            </View>

            {loading ? (
                <ActivityIndicator style={{ marginTop: 40 }} color={Colors.emergencyPlan} />
            ) : (
                <FlatList
                    data={plans}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.list}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={
                        <View style={styles.empty}>
                            <Ionicons name="clipboard-outline" size={48} color={Colors.textMuted} />
                            <Text style={styles.emptyTitle}>No emergency plans yet</Text>
                            <Text style={styles.emptyText}>Create a plan with evacuation routes, meeting points, and contacts.</Text>
                            <TouchableOpacity style={styles.emptyBtn} onPress={openAdd}>
                                <Text style={styles.emptyBtnText}>Create First Plan</Text>
                            </TouchableOpacity>
                        </View>
                    }
                    renderItem={({ item }) => (
                        <TouchableOpacity style={styles.card} onPress={() => setViewPlan(item)}>
                            <View style={styles.cardIcon}>
                                <Ionicons name="clipboard" size={22} color={Colors.emergencyPlanDark} />
                            </View>
                            <View style={styles.cardInfo}>
                                <Text style={styles.cardTitle}>{item.title}</Text>
                                <Text style={styles.cardSteps}>{item.steps?.length ?? 0} steps</Text>
                            </View>
                            <View style={styles.cardActions}>
                                <TouchableOpacity style={styles.iconBtn} onPress={() => openEdit(item)}>
                                    <Ionicons name="pencil" size={15} color={Colors.family} />
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.iconBtn} onPress={() => deletePlan(item.id)}>
                                    <Ionicons name="trash" size={15} color={Colors.sos} />
                                </TouchableOpacity>
                            </View>
                        </TouchableOpacity>
                    )}
                />
            )}

            {/* Modal */}
            <Modal visible={modalVisible} animationType="slide" transparent>
                <View style={styles.overlay}>
                    <View style={styles.modal}>
                        <Text style={styles.modalTitle}>{editPlan ? 'Edit Plan' : 'New Emergency Plan'}</Text>
                        <View style={styles.formGroup}>
                            <Text style={styles.formLabel}>Plan Title</Text>
                            <TextInput
                                style={styles.formInput}
                                value={title}
                                onChangeText={setTitle}
                                placeholder="e.g. Earthquake Evacuation"
                                placeholderTextColor={Colors.textMuted}
                            />
                        </View>
                        <Text style={styles.formLabel}>Steps</Text>
                        <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
                            {steps.map((step, i) => (
                                <View key={step.id} style={styles.stepInput}>
                                    <Text style={styles.stepInputNum}>{i + 1}</Text>
                                    <TextInput
                                        style={styles.stepInputField}
                                        value={step.text}
                                        onChangeText={(t) => updateStep(step.id, t)}
                                        placeholder={`Step ${i + 1}...`}
                                        placeholderTextColor={Colors.textMuted}
                                        multiline
                                    />
                                    {steps.length > 1 && (
                                        <TouchableOpacity onPress={() => removeStep(step.id)}>
                                            <Ionicons name="close-circle" size={20} color={Colors.sos} />
                                        </TouchableOpacity>
                                    )}
                                </View>
                            ))}
                        </ScrollView>
                        <TouchableOpacity style={styles.addStepBtn} onPress={addStep}>
                            <Ionicons name="add" size={16} color={Colors.emergencyPlanDark} />
                            <Text style={styles.addStepText}>Add Step</Text>
                        </TouchableOpacity>
                        <View style={styles.modalActions}>
                            <TouchableOpacity style={styles.cancelModalBtn} onPress={() => setModalVisible(false)}>
                                <Text style={styles.cancelModalText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.saveBtn} onPress={savePlan} disabled={saving}>
                                {saving ? <ActivityIndicator color={Colors.white} size="small" /> : <Text style={styles.saveBtnText}>Save</Text>}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    header: {
        backgroundColor: Colors.emergencyPlanDark,
        paddingTop: 48, paddingBottom: Spacing.lg, paddingHorizontal: Spacing.lg,
        borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
    },
    headerTitle: { fontSize: 24, fontWeight: '800', color: Colors.white },
    headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 2, marginBottom: Spacing.md },
    addBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: 'rgba(255,255,255,0.25)',
        alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 8, borderRadius: BorderRadius.full,
    },
    addBtnText: { color: Colors.white, fontWeight: '600', fontSize: 13 },
    list: { padding: Spacing.lg, paddingBottom: 100 },
    card: {
        flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
        backgroundColor: Colors.white, borderRadius: BorderRadius.md, padding: Spacing.md,
        marginBottom: Spacing.sm, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
    },
    cardIcon: {
        width: 48, height: 48, borderRadius: 24,
        backgroundColor: Colors.emergencyPlan + '30', alignItems: 'center', justifyContent: 'center',
    },
    cardInfo: { flex: 1 },
    cardTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
    cardSteps: { fontSize: 12, color: Colors.textLight, marginTop: 2 },
    cardActions: { flexDirection: 'row', gap: 6 },
    iconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
    empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 40 },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginTop: 16 },
    emptyText: { fontSize: 13, color: Colors.textLight, textAlign: 'center', marginTop: 8 },
    emptyBtn: { marginTop: 20, backgroundColor: Colors.emergencyPlanDark, paddingHorizontal: 24, paddingVertical: 12, borderRadius: BorderRadius.md },
    emptyBtnText: { color: Colors.white, fontWeight: '700', fontSize: 14 },
    overlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
    modal: { backgroundColor: Colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.xl },
    modalTitle: { fontSize: 20, fontWeight: '700', color: Colors.text, marginBottom: Spacing.lg },
    formGroup: { marginBottom: Spacing.md },
    formLabel: { fontSize: 12, fontWeight: '600', color: Colors.text, marginBottom: 6 },
    formInput: {
        backgroundColor: Colors.background, borderRadius: BorderRadius.md,
        borderWidth: 1, borderColor: Colors.border,
        paddingHorizontal: Spacing.md, height: 48, fontSize: 15, color: Colors.text,
    },
    stepInput: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
    stepInputNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.emergencyPlan + '30', textAlign: 'center', fontWeight: '700', color: Colors.emergencyPlanDark, lineHeight: 24 },
    stepInputField: {
        flex: 1, backgroundColor: Colors.background, borderRadius: BorderRadius.sm,
        borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 10, paddingVertical: 10,
        fontSize: 14, color: Colors.text, minHeight: 44,
    },
    addStepBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: Colors.emergencyPlan + '25',
        alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: BorderRadius.full, marginTop: 6, marginBottom: Spacing.lg,
    },
    addStepText: { fontSize: 13, fontWeight: '600', color: Colors.emergencyPlanDark },
    modalActions: { flexDirection: 'row', gap: Spacing.md },
    cancelModalBtn: { flex: 1, paddingVertical: 14, borderRadius: BorderRadius.md, backgroundColor: Colors.background, alignItems: 'center' },
    cancelModalText: { fontWeight: '700', color: Colors.textLight },
    saveBtn: { flex: 1, paddingVertical: 14, borderRadius: BorderRadius.md, backgroundColor: Colors.emergencyPlanDark, alignItems: 'center' },
    saveBtnText: { fontWeight: '700', color: Colors.white },
    // Detail view
    detailHeader: {
        backgroundColor: Colors.emergencyPlanDark, paddingTop: 52, paddingBottom: Spacing.xl, paddingHorizontal: Spacing.lg,
        borderBottomLeftRadius: 28, borderBottomRightRadius: 28,
    },
    backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: Spacing.sm },
    backText: { color: Colors.white, fontWeight: '600', fontSize: 14 },
    detailTitle: { fontSize: 24, fontWeight: '800', color: Colors.white, marginTop: 8 },
    stepsLabel: { fontSize: 13, fontWeight: '700', color: Colors.textLight, textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing.md },
    stepRow: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.md, alignItems: 'flex-start' },
    stepNum: { width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.emergencyPlan + '30', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    stepNumText: { fontWeight: '800', fontSize: 13, color: Colors.emergencyPlanDark },
    stepText: { flex: 1, fontSize: 14, color: Colors.text, lineHeight: 22, paddingTop: 4 },
});
