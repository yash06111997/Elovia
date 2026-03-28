import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Platform,
  Modal,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useNutrition, Meal, FoodLogEntry } from "@/context/NutritionContext";
import { useApp } from "@/context/AppContext";
import { MacroBar } from "@/components/MacroBar";
import { MealCard } from "@/components/MealCard";
import { generateMealPlan } from "@/utils/aiEngine";
import { Colors } from "@/constants/colors";

type Tab = "plan" | "log";

export default function DietScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { mealPlan, setMealPlan, getTodayLog, getTodayTotals, logFood, removeLogEntry } = useNutrition();
  const { state: appState, calculateMacros } = useApp();
  const [activeTab, setActiveTab] = useState<Tab>("plan");
  const [logModalVisible, setLogModalVisible] = useState(false);
  const [quickLog, setQuickLog] = useState({ name: "", calories: "", protein: "", carbs: "", fats: "", mealType: "snack" as const });

  const macros = calculateMacros();
  const consumed = getTodayTotals();
  const todayLog = getTodayLog();
  const topPadding = Platform.OS === "web" ? 67 : insets.top + 12;

  const loggedMealIds = todayLog.map((l) => l.mealId).filter(Boolean) as string[];

  const handleLogMeal = (meal: Meal) => {
    logFood({
      date: new Date().toISOString().split("T")[0],
      mealId: meal.id,
      name: meal.name,
      calories: meal.calories,
      protein: meal.protein,
      carbs: meal.carbs,
      fats: meal.fats,
      mealType: meal.mealType,
      servingSize: "1 serving",
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleRegenerate = () => {
    if (!appState.profile) return;
    const newPlan = generateMealPlan(appState.profile);
    setMealPlan(newPlan);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleQuickLog = () => {
    logFood({
      date: new Date().toISOString().split("T")[0],
      name: quickLog.name || "Custom Food",
      calories: parseFloat(quickLog.calories) || 0,
      protein: parseFloat(quickLog.protein) || 0,
      carbs: parseFloat(quickLog.carbs) || 0,
      fats: parseFloat(quickLog.fats) || 0,
      mealType: quickLog.mealType,
      servingSize: "1 serving",
    });
    setLogModalVisible(false);
    setQuickLog({ name: "", calories: "", protein: "", carbs: "", fats: "", mealType: "snack" });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: topPadding, paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={[styles.screenTitle, { color: theme.text }]}>Nutrition</Text>
          <TouchableOpacity
            style={[styles.logBtn, { backgroundColor: Colors.accentGreen }]}
            onPress={() => setLogModalVisible(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={16} color="#000" />
            <Text style={styles.logBtnText}>Log Food</Text>
          </TouchableOpacity>
        </View>

        {/* Macro Progress */}
        <View style={[styles.macroCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={styles.macroCardHeader}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Daily Progress</Text>
            <Text style={[styles.calCount, { color: theme.textSecondary }]}>
              <Text style={{ color: Colors.accentYellow, fontFamily: "Inter_700Bold" }}>
                {Math.round(consumed.calories)}
              </Text>
              /{macros.calories} kcal
            </Text>
          </View>
          <MacroBar label="Protein" current={consumed.protein} target={macros.protein} color={Colors.primary} isDark={isDark} />
          <MacroBar label="Carbs" current={consumed.carbs} target={macros.carbs} color={Colors.accent} isDark={isDark} />
          <MacroBar label="Fats" current={consumed.fats} target={macros.fats} color={Colors.accentGreen} isDark={isDark} />
        </View>

        {/* Tabs */}
        <View style={[styles.tabBar, { backgroundColor: theme.card, borderColor: theme.border }]}>
          {(["plan", "log"] as Tab[]).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && { backgroundColor: Colors.primary }]}
              onPress={() => { setActiveTab(tab); Haptics.selectionAsync(); }}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, { color: activeTab === tab ? "#000" : theme.textSecondary }]}>
                {tab === "plan" ? "Meal Plan" : "Today's Log"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {activeTab === "plan" && (
          <>
            <View style={styles.tabHeaderRow}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>
                {mealPlan ? "Your Meal Plan" : "No Plan Yet"}
              </Text>
              {mealPlan && (
                <TouchableOpacity
                  style={[styles.smallBtn, { borderColor: Colors.primary + "40" }]}
                  onPress={handleRegenerate}
                  activeOpacity={0.8}
                >
                  <Ionicons name="refresh" size={14} color={Colors.primary} />
                  <Text style={[styles.smallBtnText, { color: Colors.primary }]}>Refresh</Text>
                </TouchableOpacity>
              )}
            </View>
            {mealPlan ? (
              mealPlan.meals.map((meal) => (
                <MealCard
                  key={meal.id}
                  meal={meal}
                  isDark={isDark}
                  onLog={handleLogMeal}
                  logged={loggedMealIds.includes(meal.id)}
                />
              ))
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="restaurant-outline" size={48} color={theme.textMuted} />
                <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                  Complete onboarding to generate your meal plan
                </Text>
              </View>
            )}
          </>
        )}

        {activeTab === "log" && (
          <>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Today's Log</Text>
            {todayLog.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="clipboard-outline" size={48} color={theme.textMuted} />
                <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                  No food logged today. Tap "Log Food" to add meals.
                </Text>
              </View>
            ) : (
              todayLog.map((entry) => (
                <LogEntryCard key={entry.id} entry={entry} isDark={isDark} theme={theme} onRemove={() => removeLogEntry(entry.id)} />
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* Quick Log Modal */}
      <Modal visible={logModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Log Food</Text>
              <TouchableOpacity onPress={() => setLogModalVisible(false)}>
                <Ionicons name="close" size={22} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            <QuickInput label="Food Name" value={quickLog.name} onChangeText={(v: string) => setQuickLog((p) => ({ ...p, name: v }))} placeholder="e.g. Grilled chicken" theme={theme} />
            <View style={styles.macroInputRow}>
              <QuickInputSmall label="Calories" value={quickLog.calories} onChangeText={(v: string) => setQuickLog((p) => ({ ...p, calories: v }))} theme={theme} />
              <QuickInputSmall label="Protein (g)" value={quickLog.protein} onChangeText={(v: string) => setQuickLog((p) => ({ ...p, protein: v }))} theme={theme} />
            </View>
            <View style={styles.macroInputRow}>
              <QuickInputSmall label="Carbs (g)" value={quickLog.carbs} onChangeText={(v: string) => setQuickLog((p) => ({ ...p, carbs: v }))} theme={theme} />
              <QuickInputSmall label="Fats (g)" value={quickLog.fats} onChangeText={(v: string) => setQuickLog((p) => ({ ...p, fats: v }))} theme={theme} />
            </View>

            <View style={styles.mealTypeRow}>
              {(["breakfast", "lunch", "dinner", "snack"] as const).map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.mealTypeChip, { borderColor: quickLog.mealType === type ? Colors.accentGreen : theme.border, backgroundColor: quickLog.mealType === type ? Colors.accentGreen + "20" : "transparent" }]}
                  onPress={() => setQuickLog((p) => ({ ...p, mealType: type }))}
                >
                  <Text style={[styles.mealTypeText, { color: quickLog.mealType === type ? Colors.accentGreen : theme.textSecondary }]}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={[styles.submitBtn, { backgroundColor: Colors.accentGreen }]} onPress={handleQuickLog} activeOpacity={0.8}>
              <Text style={styles.submitBtnText}>Add to Log</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function LogEntryCard({ entry, isDark, theme, onRemove }: { entry: FoodLogEntry; isDark: boolean; theme: any; onRemove: () => void }) {
  return (
    <View style={[styles.logEntry, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.logEntryName, { color: theme.text }]}>{entry.name}</Text>
        <View style={styles.logEntryMacros}>
          <Text style={[styles.logMacro, { color: Colors.accentYellow }]}>{Math.round(entry.calories)} kcal</Text>
          <Text style={[styles.logMacro, { color: Colors.primary }]}>{Math.round(entry.protein)}g P</Text>
          <Text style={[styles.logMacro, { color: Colors.accent }]}>{Math.round(entry.carbs)}g C</Text>
          <Text style={[styles.logMacro, { color: Colors.accentGreen }]}>{Math.round(entry.fats)}g F</Text>
        </View>
      </View>
      <TouchableOpacity onPress={onRemove} style={styles.removeBtn}>
        <Ionicons name="trash-outline" size={16} color={Colors.accentRed} />
      </TouchableOpacity>
    </View>
  );
}

function QuickInput({ label, value, onChangeText, placeholder, theme }: any) {
  return (
    <View style={{ gap: 5, marginBottom: 10 }}>
      <Text style={{ color: theme.textSecondary, fontSize: 12, fontFamily: "Inter_500Medium" }}>{label}</Text>
      <TextInput
        style={{ backgroundColor: theme.card, color: theme.text, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: theme.border, fontFamily: "Inter_400Regular" }}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
      />
    </View>
  );
}

function QuickInputSmall({ label, value, onChangeText, theme }: any) {
  return (
    <View style={{ gap: 5, flex: 1 }}>
      <Text style={{ color: theme.textSecondary, fontSize: 12, fontFamily: "Inter_500Medium" }}>{label}</Text>
      <TextInput
        style={{ backgroundColor: theme.card, color: theme.text, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: theme.border, fontFamily: "Inter_400Regular" }}
        value={value}
        onChangeText={onChangeText}
        keyboardType="numeric"
        placeholder="0"
        placeholderTextColor={theme.textMuted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  screenTitle: { fontSize: 24, fontFamily: "Inter_700Bold" },
  logBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  logBtnText: { color: "#000", fontSize: 13, fontFamily: "Inter_700Bold" },
  macroCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  macroCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  calCount: { fontSize: 13, fontFamily: "Inter_400Regular" },
  tabBar: { flexDirection: "row", borderRadius: 12, borderWidth: 1, padding: 4, gap: 4 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center" },
  tabText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  tabHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  smallBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  smallBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  emptyState: { alignItems: "center", gap: 12, paddingVertical: 48 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", maxWidth: 280 },
  logEntry: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 12, borderWidth: 1, gap: 12 },
  logEntryName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  logEntryMacros: { flexDirection: "row", gap: 10, marginTop: 4, flexWrap: "wrap" },
  logMacro: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  removeBtn: { padding: 6 },
  modalOverlay: { flex: 1, backgroundColor: "#00000080", justifyContent: "flex-end" },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 4 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  macroInputRow: { flexDirection: "row", gap: 12, marginBottom: 10 },
  mealTypeRow: { flexDirection: "row", gap: 8, marginVertical: 8 },
  mealTypeChip: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 8, borderWidth: 1 },
  mealTypeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  submitBtn: { padding: 14, borderRadius: 12, alignItems: "center", marginTop: 8 },
  submitBtnText: { color: "#000", fontSize: 15, fontFamily: "Inter_700Bold" },
});
