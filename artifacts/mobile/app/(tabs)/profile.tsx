import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Platform,
  useColorScheme,
  Alert,
  Switch,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useApp, CustomMacros } from "@/context/AppContext";
import { useWorkout } from "@/context/WorkoutContext";
import { NumberEditModal } from "@/components/NumberEditModal";
import { Colors } from "@/constants/colors";

const goalLabels: Record<string, string> = {
  fat_loss: "Fat Loss",
  muscle_gain: "Muscle Gain",
  strength: "Strength",
  endurance: "Endurance",
  maintenance: "Maintenance",
  general_fitness: "General Fitness",
};

const levelLabels: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

type EditField = "heightCm" | "weightKg" | "targetWeightKg" | "targetWeeks" | null;

export default function ProfileScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { state: appState, calculateTDEE, calculateMacros, toggleColorScheme, updateProfileField, setCustomMacros } = useApp();
  const { sessions, personalRecords } = useWorkout();
  const profile = appState.profile;

  const topPadding = Platform.OS === "web" ? 67 : insets.top + 12;
  const tdee = calculateTDEE();
  const macros = calculateMacros();

  const [editField, setEditField] = useState<EditField>(null);
  const [macroModalVisible, setMacroModalVisible] = useState(false);
  const [macroForm, setMacroForm] = useState({
    calories: macros.calories.toString(),
    protein: macros.protein.toString(),
    carbs: macros.carbs.toString(),
    fats: macros.fats.toString(),
  });

  const handleResetOnboarding = () => {
    Alert.alert(
      "Reset App",
      "This will clear all your data and restart the onboarding. Are you sure?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            const AsyncStorage = require("@react-native-async-storage/async-storage").default;
            await AsyncStorage.clear();
            router.replace("/onboarding");
          },
        },
      ]
    );
  };

  const handleSaveField = (value: number) => {
    if (!editField) return;
    updateProfileField(editField, value);
  };

  const handleSaveMacros = () => {
    const custom: CustomMacros = {
      enabled: true,
      calories: parseInt(macroForm.calories) || macros.calories,
      protein: parseInt(macroForm.protein) || macros.protein,
      carbs: parseInt(macroForm.carbs) || macros.carbs,
      fats: parseInt(macroForm.fats) || macros.fats,
    };
    setCustomMacros(custom);
    setMacroModalVisible(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleResetMacros = () => {
    setCustomMacros(null);
    setMacroModalVisible(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  if (!profile) {
    return (
      <View style={[styles.empty, { backgroundColor: theme.background, paddingTop: topPadding }]}>
        <Ionicons name="person-circle-outline" size={64} color={theme.textMuted} />
        <Text style={[styles.emptyTitle, { color: theme.text }]}>No Profile</Text>
        <TouchableOpacity style={[styles.setupBtn, { backgroundColor: Colors.primary }]} onPress={() => router.push("/onboarding")}>
          <Text style={styles.setupBtnText}>Complete Setup</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const editFieldConfig: Record<string, { title: string; unit: string; min: number; max: number; step: number; value: number }> = {
    heightCm: { title: "Edit Height", unit: "cm", min: 100, max: 250, step: 1, value: profile.heightCm },
    weightKg: { title: "Edit Weight", unit: "kg", min: 30, max: 250, step: 0.5, value: profile.weightKg },
    targetWeightKg: { title: "Edit Target Weight", unit: "kg", min: 30, max: 250, step: 0.5, value: profile.targetWeightKg || profile.weightKg },
    targetWeeks: { title: "Edit Target Weeks", unit: "weeks", min: 4, max: 52, step: 1, value: profile.targetWeeks || 12 },
  };

  const currentEditConfig = editField ? editFieldConfig[editField] : null;

  const weightDelta = (profile.targetWeightKg || profile.weightKg) - profile.weightKg;
  const weightDirection = weightDelta > 0 ? "gain" : weightDelta < 0 ? "lose" : "maintain";
  const targetWeeks = profile.targetWeeks || 12;
  const dailyCalAdjust = weightDelta !== 0 ? Math.max(-1000, Math.min(1000, Math.round((weightDelta * 7700) / (targetWeeks * 7)))) : 0;
  const weeklyRateKg = weightDelta !== 0 ? (Math.abs(weightDelta) / targetWeeks).toFixed(2) : "0";

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPadding, paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 80 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.avatarSection}>
        <View style={[styles.avatarLarge, { backgroundColor: Colors.primary + "20" }]}>
          <Text style={[styles.avatarInitial, { color: Colors.primary }]}>
            {profile.name.charAt(0).toUpperCase() || "A"}
          </Text>
        </View>
        <Text style={[styles.userName, { color: theme.text }]}>{profile.name}</Text>
        <View style={styles.goalBadge}>
          <Ionicons name="flag-outline" size={12} color={Colors.primary} />
          <Text style={[styles.goalBadgeText, { color: Colors.primary }]}>{goalLabels[profile.goal]}</Text>
        </View>
      </View>

      <View style={[styles.statsCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <StatItem label="Workouts" value={sessions.filter((s) => s.completed).length.toString()} theme={theme} />
        <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
        <StatItem label="PRs" value={personalRecords.length.toString()} theme={theme} />
        <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
        <StatItem label="Streak" value={`${appState.currentStreak}d`} theme={theme} />
      </View>

      <SectionCard title="Body Stats" isDark={isDark} theme={theme} subtitle="Tap values to edit">
        <InfoRow label="Age" value={`${profile.age} years`} theme={theme} />
        <InfoRow label="Gender" value={profile.gender.charAt(0).toUpperCase() + profile.gender.slice(1)} theme={theme} />
        <TappableRow label="Height" value={`${profile.heightCm} cm`} theme={theme} onPress={() => setEditField("heightCm")} />
        <TappableRow label="Weight" value={`${profile.weightKg} kg`} theme={theme} onPress={() => setEditField("weightKg")} />
        <TappableRow
          label="Target Weight"
          value={`${profile.targetWeightKg || profile.weightKg} kg`}
          theme={theme}
          onPress={() => setEditField("targetWeightKg")}
          badge={weightDirection !== "maintain" ? `${Math.abs(weightDelta).toFixed(1)} kg to ${weightDirection}` : undefined}
          badgeColor={weightDirection === "lose" ? Colors.accent : weightDirection === "gain" ? Colors.accentGreen : undefined}
        />
        {weightDirection !== "maintain" && (
          <TappableRow
            label="Timeline"
            value={`${targetWeeks} weeks`}
            theme={theme}
            onPress={() => setEditField("targetWeeks")}
            badge={`${weeklyRateKg} kg/wk • ${dailyCalAdjust > 0 ? "+" : ""}${dailyCalAdjust} kcal/day`}
            badgeColor={Colors.primary}
          />
        )}
        <InfoRow label="BMI" value={`${(profile.weightKg / ((profile.heightCm / 100) ** 2)).toFixed(1)}`} theme={theme} />
        <InfoRow label="TDEE" value={`${tdee} kcal`} theme={theme} highlight />
      </SectionCard>

      <SectionCard title="Daily Nutrition Targets" isDark={isDark} theme={theme}>
        <View style={styles.macroActionsRow}>
          <TouchableOpacity
            style={[styles.macroEditBtn, { backgroundColor: Colors.primary + "20", borderColor: Colors.primary + "40" }]}
            onPress={() => {
              setMacroForm({
                calories: macros.calories.toString(),
                protein: macros.protein.toString(),
                carbs: macros.carbs.toString(),
                fats: macros.fats.toString(),
              });
              setMacroModalVisible(true);
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="create-outline" size={14} color={Colors.primary} />
            <Text style={[styles.macroEditText, { color: Colors.primary }]}>
              {appState.customMacros?.enabled ? "Custom Macros" : "Override Macros"}
            </Text>
          </TouchableOpacity>
          {appState.customMacros?.enabled && (
            <TouchableOpacity
              style={[styles.macroResetBtn, { borderColor: theme.border }]}
              onPress={handleResetMacros}
              activeOpacity={0.8}
            >
              <Ionicons name="refresh" size={14} color={theme.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
        <InfoRow label="Calories" value={`${macros.calories} kcal`} theme={theme} highlight />
        <InfoRow label="Protein" value={`${macros.protein} g`} theme={theme} />
        <InfoRow label="Carbs" value={`${macros.carbs} g`} theme={theme} />
        <InfoRow label="Fats" value={`${macros.fats} g`} theme={theme} />
      </SectionCard>

      <SectionCard title="Fitness Profile" isDark={isDark} theme={theme}>
        <InfoRow label="Goal" value={goalLabels[profile.goal]} theme={theme} />
        <InfoRow label="Level" value={levelLabels[profile.fitnessLevel]} theme={theme} />
        <InfoRow label="Activity" value={profile.activityLevel.replace("_", " ")} theme={theme} />
        <InfoRow label="Workout Days" value={`${profile.workoutDaysPerWeek} days/week`} theme={theme} />
        <InfoRow label="Session Length" value={`${profile.workoutDurationMins} min`} theme={theme} />
        <InfoRow label="Preference" value={profile.workoutPreference} theme={theme} />
      </SectionCard>

      <SectionCard title="Diet Profile" isDark={isDark} theme={theme}>
        <InfoRow label="Food Type" value={profile.foodPreference.replace("_", " ")} theme={theme} />
        {profile.dietaryRestrictions ? <InfoRow label="Restrictions" value={profile.dietaryRestrictions} theme={theme} /> : null}
        {profile.dislikedFoods ? <InfoRow label="Dislikes" value={profile.dislikedFoods} theme={theme} /> : null}
        {profile.medicalNotes ? <InfoRow label="Medical Notes" value={profile.medicalNotes} theme={theme} /> : null}
      </SectionCard>

      <SectionCard title="Equipment" isDark={isDark} theme={theme}>
        <View style={styles.equipmentList}>
          {profile.equipment.map((eq) => (
            <View key={eq} style={[styles.equipTag, { backgroundColor: Colors.primary + "20" }]}>
              <Text style={[styles.equipTagText, { color: Colors.primary }]}>{eq.replace(/_/g, " ")}</Text>
            </View>
          ))}
        </View>
      </SectionCard>

      <SectionCard title="Health Habits" isDark={isDark} theme={theme}>
        <InfoRow label="Sleep" value={`${profile.sleepHours} hours/night`} theme={theme} />
        <InfoRow label="Water Goal" value={`${profile.waterIntakeLiters} L/day`} theme={theme} />
      </SectionCard>

      <SectionCard title="Settings" isDark={isDark} theme={theme}>
        <View style={styles.settingRow}>
          <View style={styles.settingLeft}>
            <Ionicons name="moon-outline" size={18} color={theme.textSecondary} />
            <Text style={[styles.settingLabel, { color: theme.text }]}>Dark Mode</Text>
          </View>
          <Switch
            value={isDark}
            onValueChange={() => { toggleColorScheme(); Haptics.selectionAsync(); }}
            trackColor={{ false: theme.border, true: Colors.primary + "80" }}
            thumbColor={isDark ? Colors.primary : theme.textMuted}
          />
        </View>
      </SectionCard>

      <TouchableOpacity
        style={[styles.actionBtn, { backgroundColor: Colors.primary + "20", borderColor: Colors.primary + "40" }]}
        onPress={() => router.push("/onboarding")}
        activeOpacity={0.8}
      >
        <Ionicons name="create-outline" size={18} color={Colors.primary} />
        <Text style={[styles.actionBtnText, { color: Colors.primary }]}>Update Profile</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.actionBtn, { backgroundColor: Colors.accentRed + "15", borderColor: Colors.accentRed + "40" }]}
        onPress={handleResetOnboarding}
        activeOpacity={0.8}
      >
        <Ionicons name="trash-outline" size={18} color={Colors.accentRed} />
        <Text style={[styles.actionBtnText, { color: Colors.accentRed }]}>Reset All Data</Text>
      </TouchableOpacity>

      {currentEditConfig && (
        <NumberEditModal
          visible={!!editField}
          onClose={() => setEditField(null)}
          onSave={handleSaveField}
          title={currentEditConfig.title}
          unit={currentEditConfig.unit}
          value={currentEditConfig.value}
          min={currentEditConfig.min}
          max={currentEditConfig.max}
          step={currentEditConfig.step}
          isDark={isDark}
        />
      )}

      <Modal visible={macroModalVisible} transparent animationType="fade" onRequestClose={() => setMacroModalVisible(false)}>
        <View style={styles.macroOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setMacroModalVisible(false)} />
          <View style={[styles.macroSheet, { backgroundColor: theme.surface }]}>
            <View style={styles.macroHandle} />
            <Text style={[styles.macroTitle, { color: theme.text }]}>Custom Macro Targets</Text>
            <Text style={[styles.macroSubtitle, { color: theme.textSecondary }]}>
              Override the calculated values with your own targets
            </Text>
            <MacroInput label="Calories" unit="kcal" value={macroForm.calories} onChange={(v) => setMacroForm((p) => ({ ...p, calories: v }))} theme={theme} color={Colors.accentYellow} />
            <MacroInput label="Protein" unit="g" value={macroForm.protein} onChange={(v) => setMacroForm((p) => ({ ...p, protein: v }))} theme={theme} color={Colors.primary} />
            <MacroInput label="Carbs" unit="g" value={macroForm.carbs} onChange={(v) => setMacroForm((p) => ({ ...p, carbs: v }))} theme={theme} color={Colors.accent} />
            <MacroInput label="Fats" unit="g" value={macroForm.fats} onChange={(v) => setMacroForm((p) => ({ ...p, fats: v }))} theme={theme} color={Colors.accentGreen} />
            <View style={styles.macroActions}>
              <TouchableOpacity style={[styles.macroCancelBtn, { borderColor: theme.border }]} onPress={() => setMacroModalVisible(false)}>
                <Text style={[styles.macroCancelText, { color: theme.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.macroSaveBtn, { backgroundColor: Colors.primary }]} onPress={handleSaveMacros} activeOpacity={0.8}>
                <Text style={styles.macroSaveText}>Save Macros</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function MacroInput({ label, unit, value, onChange, theme, color }: any) {
  return (
    <View style={styles.macroInputRow}>
      <View style={[styles.macroColorDot, { backgroundColor: color }]} />
      <Text style={[styles.macroInputLabel, { color: theme.textSecondary }]}>{label}</Text>
      <TextInput
        style={[styles.macroInputField, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        selectTextOnFocus
      />
      <Text style={[styles.macroInputUnit, { color: theme.textMuted }]}>{unit}</Text>
    </View>
  );
}

function SectionCard({ title, children, isDark, theme, subtitle }: any) {
  return (
    <View style={[styles.sectionCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <View style={styles.sectionHeaderRow}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text>
        {subtitle && <Text style={[styles.sectionSubtitle, { color: theme.textMuted }]}>{subtitle}</Text>}
      </View>
      {children}
    </View>
  );
}

function InfoRow({ label, value, theme, highlight }: any) {
  return (
    <View style={[styles.infoRow, { borderBottomColor: theme.border }]}>
      <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: highlight ? Colors.primary : theme.text }]}>{value}</Text>
    </View>
  );
}

function TappableRow({ label, value, theme, onPress, badge, badgeColor }: any) {
  return (
    <TouchableOpacity
      style={[styles.infoRow, { borderBottomColor: theme.border }]}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>{label}</Text>
      <View style={styles.tappableRight}>
        {badge && (
          <View style={[styles.badge, { backgroundColor: (badgeColor || Colors.primary) + "20" }]}>
            <Text style={[styles.badgeText, { color: badgeColor || Colors.primary }]}>{badge}</Text>
          </View>
        )}
        <Text style={[styles.infoValue, { color: Colors.primary }]}>{value}</Text>
        <Ionicons name="pencil" size={12} color={Colors.primary} style={{ marginLeft: 4 }} />
      </View>
    </TouchableOpacity>
  );
}

function StatItem({ label, value, theme }: any) {
  return (
    <View style={styles.statItem}>
      <Text style={[styles.statValue, { color: theme.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: theme.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  setupBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  setupBtnText: { color: "#000", fontSize: 15, fontFamily: "Inter_700Bold" },
  avatarSection: { alignItems: "center", gap: 8, paddingVertical: 8 },
  avatarLarge: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontSize: 32, fontFamily: "Inter_700Bold" },
  userName: { fontSize: 22, fontFamily: "Inter_700Bold" },
  goalBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.primary + "20", paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10 },
  goalBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  statsCard: { flexDirection: "row", borderRadius: 16, borderWidth: 1, padding: 16 },
  statItem: { flex: 1, alignItems: "center", gap: 4 },
  statValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5 },
  statDivider: { width: 1, marginVertical: 4 },
  sectionCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 0 },
  sectionHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  sectionSubtitle: { fontSize: 11, fontFamily: "Inter_400Regular" },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 10, borderBottomWidth: 1 },
  infoLabel: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  infoValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", textAlign: "right" },
  tappableRight: { flexDirection: "row", alignItems: "center" },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, marginRight: 8 },
  badgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  macroActionsRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  macroEditBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  macroEditText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  macroResetBtn: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  equipmentList: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 4 },
  equipTag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  equipTagText: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "capitalize" },
  settingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  settingLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  settingLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 14, borderWidth: 1 },
  actionBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  macroOverlay: { flex: 1, backgroundColor: "#00000060", justifyContent: "flex-end" },
  macroSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, gap: 14 },
  macroHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#444", alignSelf: "center" },
  macroTitle: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  macroSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  macroInputRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  macroColorDot: { width: 10, height: 10, borderRadius: 5 },
  macroInputLabel: { fontSize: 14, fontFamily: "Inter_500Medium", width: 70 },
  macroInputField: { flex: 1, height: 44, borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  macroInputUnit: { fontSize: 13, fontFamily: "Inter_400Regular", width: 30 },
  macroActions: { flexDirection: "row", gap: 12, marginTop: 4 },
  macroCancelBtn: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  macroCancelText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  macroSaveBtn: { flex: 2, padding: 14, borderRadius: 12, alignItems: "center" },
  macroSaveText: { color: "#000", fontSize: 15, fontFamily: "Inter_700Bold" },
});
