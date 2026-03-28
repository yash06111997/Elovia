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
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useNutrition, Meal, FoodLogEntry } from "@/context/NutritionContext";
import { useApp } from "@/context/AppContext";
import { MacroBar } from "@/components/MacroBar";
import { MealCard } from "@/components/MealCard";
import { FoodSearch } from "@/components/FoodSearch";
import { generateMealPlan } from "@/utils/aiEngine";
import { recognizeFood, generateAIMealPlan } from "@/utils/api";
import { Colors } from "@/constants/colors";
import type { FoodItem } from "@/utils/foodDatabase";
import type { DietType } from "@/context/AppContext";

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
  const [foodSearchVisible, setFoodSearchVisible] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [quickLog, setQuickLog] = useState({ name: "", calories: "", protein: "", carbs: "", fats: "", mealType: "snack" as const });
  const [aiMealModalVisible, setAiMealModalVisible] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiDietType, setAiDietType] = useState<DietType>(appState.profile?.dietType || "balanced");
  const [aiFavFoods, setAiFavFoods] = useState(appState.profile?.favoriteFoods || "");
  const [aiSuggestions, setAiSuggestions] = useState(appState.profile?.mealSuggestions || "");
  const [aiMealsPerDay, setAiMealsPerDay] = useState(4);

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

  const handleAIMealPlan = async () => {
    if (!appState.profile) return;
    setAiGenerating(true);
    try {
      const result = await generateAIMealPlan(appState.profile, {
        dietType: aiDietType,
        favoriteFoods: aiFavFoods,
        mealSuggestions: aiSuggestions,
        mealsPerDay: aiMealsPerDay,
      });
      const convertedMeals = result.meals.map((m) => ({
        id: m.id,
        name: m.name,
        mealType: m.mealType as "breakfast" | "lunch" | "dinner" | "snack",
        calories: m.calories,
        protein: m.protein,
        carbs: m.carbs,
        fats: m.fats,
        description: m.ingredients?.join(", ") || "",
      }));
      setMealPlan({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        meals: convertedMeals,
        totalCalories: result.totalCalories,
        totalProtein: result.totalProtein,
        totalCarbs: result.totalCarbs,
        totalFats: result.totalFats,
        generatedAt: new Date().toISOString(),
      });
      setAiMealModalVisible(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Meal Plan Generated", result.summary || "Your personalized AI meal plan is ready!");
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to generate meal plan. Please try again.");
    } finally {
      setAiGenerating(false);
    }
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

  const handleFoodSelect = (food: FoodItem, servings: number) => {
    logFood({
      date: new Date().toISOString().split("T")[0],
      name: food.name,
      calories: Math.round(food.calories * servings),
      protein: Math.round(food.protein * servings),
      carbs: Math.round(food.carbs * servings),
      fats: Math.round(food.fats * servings),
      mealType: "snack",
      servingSize: `${servings} x ${food.servingSize}`,
    });
  };

  const handleScanFood = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Camera permission is required to scan food.");
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        base64: true,
        quality: 0.7,
        allowsEditing: true,
      });

      if (result.canceled || !result.assets[0]?.base64) return;

      setScanning(true);
      const analysis = await recognizeFood(result.assets[0].base64);

      analysis.foods.forEach((food) => {
        logFood({
          date: new Date().toISOString().split("T")[0],
          name: food.name,
          calories: food.calories,
          protein: food.protein,
          carbs: food.carbs,
          fats: food.fats,
          mealType: "snack",
          servingSize: food.servingSize,
        });
      });

      Alert.alert(
        "Food Recognized",
        `${analysis.description}\n\nAdded ${analysis.foods.length} item(s) totaling ${analysis.totalCalories} kcal.`
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to analyze food photo.");
    } finally {
      setScanning(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: topPadding, paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <Text style={[styles.screenTitle, { color: theme.text }]}>Nutrition</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: Colors.primary + "20" }]}
              onPress={handleScanFood}
              activeOpacity={0.8}
              disabled={scanning}
            >
              {scanning ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <Ionicons name="camera" size={18} color={Colors.primary} />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: Colors.accent + "20" }]}
              onPress={() => setFoodSearchVisible(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="search" size={18} color={Colors.accent} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: "#FF6B35" + "20" }]}
              onPress={() => setAiMealModalVisible(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="sparkles" size={18} color="#FF6B35" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.logBtn, { backgroundColor: Colors.accentGreen }]}
              onPress={() => setLogModalVisible(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="add" size={16} color="#000" />
              <Text style={styles.logBtnText}>Log</Text>
            </TouchableOpacity>
          </View>
        </View>

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
                  No food logged today. Tap the camera, search, or "Log" to add meals.
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

      <FoodSearch
        visible={foodSearchVisible}
        onClose={() => setFoodSearchVisible(false)}
        onSelect={handleFoodSelect}
        isDark={isDark}
      />

      <Modal visible={aiMealModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.aiModalContent, { backgroundColor: theme.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>AI Meal Plan</Text>
              <TouchableOpacity onPress={() => setAiMealModalVisible(false)}>
                <Ionicons name="close" size={22} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
              <Text style={[styles.aiSectionLabel, { color: theme.textSecondary }]}>Diet Type</Text>
              <View style={styles.aiDietGrid}>
                {([
                  { label: "Balanced", value: "balanced", icon: "pie-chart-outline" },
                  { label: "Keto", value: "keto", icon: "flame-outline" },
                  { label: "Low Carb", value: "low_carb", icon: "trending-down-outline" },
                  { label: "High Protein", value: "high_protein", icon: "barbell-outline" },
                  { label: "Mediterranean", value: "mediterranean", icon: "fish-outline" },
                  { label: "Paleo", value: "paleo", icon: "leaf-outline" },
                ] as { label: string; value: DietType; icon: string }[]).map((dt) => {
                  const active = aiDietType === dt.value;
                  return (
                    <TouchableOpacity
                      key={dt.value}
                      style={[styles.aiDietChip, { backgroundColor: active ? Colors.primary + "20" : theme.card, borderColor: active ? Colors.primary : theme.border }]}
                      onPress={() => { setAiDietType(dt.value); Haptics.selectionAsync(); }}
                      activeOpacity={0.8}
                    >
                      <Ionicons name={dt.icon as any} size={14} color={active ? Colors.primary : theme.textSecondary} />
                      <Text style={[styles.aiDietChipText, { color: active ? Colors.primary : theme.text }]}>{dt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.aiSectionLabel, { color: theme.textSecondary, marginTop: 16 }]}>Meals per Day</Text>
              <View style={styles.aiMealsRow}>
                {[3, 4, 5, 6].map((n) => (
                  <TouchableOpacity
                    key={n}
                    style={[styles.aiMealCountBtn, { backgroundColor: aiMealsPerDay === n ? Colors.primary : theme.card, borderColor: aiMealsPerDay === n ? Colors.primary : theme.border }]}
                    onPress={() => { setAiMealsPerDay(n); Haptics.selectionAsync(); }}
                  >
                    <Text style={[styles.aiMealCountText, { color: aiMealsPerDay === n ? "#000" : theme.text }]}>{n}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[styles.aiSectionLabel, { color: theme.textSecondary, marginTop: 16 }]}>Favorite Foods</Text>
              <TextInput
                style={[styles.aiInput, { backgroundColor: theme.card, color: theme.text, borderColor: theme.border }]}
                value={aiFavFoods}
                onChangeText={setAiFavFoods}
                placeholder="e.g. chicken, rice, eggs, salmon..."
                placeholderTextColor={theme.textMuted}
                multiline
              />

              <Text style={[styles.aiSectionLabel, { color: theme.textSecondary, marginTop: 16 }]}>Special Suggestions</Text>
              <TextInput
                style={[styles.aiInput, { backgroundColor: theme.card, color: theme.text, borderColor: theme.border }]}
                value={aiSuggestions}
                onChangeText={setAiSuggestions}
                placeholder="e.g. easy recipes, meal prep, high fiber..."
                placeholderTextColor={theme.textMuted}
                multiline
              />
            </ScrollView>

            <TouchableOpacity
              style={[styles.aiGenerateBtn, aiGenerating && { opacity: 0.7 }]}
              onPress={handleAIMealPlan}
              disabled={aiGenerating}
              activeOpacity={0.8}
            >
              {aiGenerating ? (
                <View style={styles.aiGenRow}>
                  <ActivityIndicator size="small" color="#000" />
                  <Text style={styles.aiGenerateBtnText}>Generating with AI...</Text>
                </View>
              ) : (
                <View style={styles.aiGenRow}>
                  <Ionicons name="sparkles" size={18} color="#000" />
                  <Text style={styles.aiGenerateBtnText}>Generate Meal Plan</Text>
                </View>
              )}
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
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  screenTitle: { fontSize: 24, fontFamily: "Inter_700Bold" },
  iconBtn: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
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
  aiModalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 4 },
  aiSectionLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  aiDietGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  aiDietChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1 },
  aiDietChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  aiMealsRow: { flexDirection: "row", gap: 10 },
  aiMealCountBtn: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  aiMealCountText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  aiInput: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular", height: 60, textAlignVertical: "top" },
  aiGenerateBtn: { backgroundColor: Colors.primary, borderRadius: 14, padding: 16, alignItems: "center", marginTop: 16 },
  aiGenerateBtnText: { color: "#000", fontSize: 16, fontFamily: "Inter_700Bold" },
  aiGenRow: { flexDirection: "row", alignItems: "center", gap: 8 },
});
