import React, { useState } from "react";
import { Semantic } from "@/constants/design";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Platform,
  Modal,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useNutrition, Meal, FoodLogEntry, CustomMealPlan } from "@/context/NutritionContext";
import { useApp } from "@/context/AppContext";
import { useSubscription } from "@/context/SubscriptionContext";
import { router } from "expo-router";
import { MacroBar } from "@/components/MacroBar";
import { MealCard } from "@/components/MealCard";
import { FoodSearch } from "@/components/FoodSearch";
import { generateMealPlan } from "@/utils/aiEngine";
import { recognizeFood, generateAIMealPlan } from "@/utils/api";
import { Colors } from "@/constants/colors";
import { CustomMealPlanBuilder } from "@/screens/CustomMealPlanBuilder";
import type { FoodItem } from "@/utils/foodDatabase";
import { handleAiError } from "@/utils/aiErrors";
import type { DietType } from "@/context/AppContext";
import { useTheme } from "@/hooks/useTheme";
import { toLocalDateKey } from "@/lib/localDate";

type Tab = "plan" | "log";

export default function DietScreen() {
  const { isDark, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const {
    mealPlan,
    setMealPlan,
    getTodayLog,
    getTodayTotals,
    logFood,
    removeLogEntry,
    customMealPlans,
    activeMealPlanType,
    activeCustomMealPlanId,
    addCustomMealPlan,
    updateCustomMealPlan,
    deleteCustomMealPlan,
    setActiveMealPlan,
    getActiveMealPlanMeals,
  } = useNutrition();
  const { state: appState, calculateMacros } = useApp();
  const { canAccess } = useSubscription();
  const hasPlan = !!(mealPlan || customMealPlans.length > 0);
  const [activeTab, setActiveTab] = useState<Tab>(hasPlan ? "plan" : "log");
  const [logModalVisible, setLogModalVisible] = useState(false);
  const [foodSearchVisible, setFoodSearchVisible] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [quickLog, setQuickLog] = useState<{ name: string; calories: string; protein: string; carbs: string; fats: string; mealType: "breakfast" | "lunch" | "dinner" | "snack" }>({ name: "", calories: "", protein: "", carbs: "", fats: "", mealType: "snack" });
  const [aiMealModalVisible, setAiMealModalVisible] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiDietType, setAiDietType] = useState<DietType>(appState.profile?.dietType || "balanced");
  const [aiFavFoods, setAiFavFoods] = useState(appState.profile?.favoriteFoods || "");
  const [aiSuggestions, setAiSuggestions] = useState(appState.profile?.mealSuggestions || "");
  const [aiMealsPerDay, setAiMealsPerDay] = useState(4);
  const [showPlanSwitcher, setShowPlanSwitcher] = useState(false);
  const [showMealPlanBuilder, setShowMealPlanBuilder] = useState(false);
  const [editingMealPlan, setEditingMealPlan] = useState<CustomMealPlan | undefined>(undefined);

  const macros = calculateMacros();
  const consumed = getTodayTotals();
  const todayLog = getTodayLog();
  const topPadding = Platform.OS === "web" ? 67 : insets.top + 12;
  const activeMeals = getActiveMealPlanMeals();

  const loggedMealIds = todayLog.map((l) => l.mealId).filter(Boolean) as string[];

  const activeCustomMealPlan = customMealPlans.find((p) => p.id === activeCustomMealPlanId) ?? null;
  const displayPlanName =
    activeMealPlanType === "custom" && activeCustomMealPlan
      ? activeCustomMealPlan.name
      : mealPlan
      ? "AI Meal Plan"
      : "No Plan";

  const handleLogMeal = (meal: Meal) => {
    logFood({
      date: toLocalDateKey(new Date()),
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
        ingredients: m.ingredients || [],
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
      handleAiError(e, "Failed to generate meal plan. Please try again.");
    } finally {
      setAiGenerating(false);
    }
  };

  const handleQuickLog = () => {
    logFood({
      date: toLocalDateKey(new Date()),
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
      date: toLocalDateKey(new Date()),
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
    if (!canAccess("ai_food_scan")) {
      router.push("/paywall");
      return;
    }
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Camera permission is required to scan food.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.7, allowsEditing: true });
      if (result.canceled || !result.assets[0]?.base64) return;
      setScanning(true);
      const analysis = await recognizeFood(result.assets[0].base64);
      analysis.foods.forEach((food) => {
        logFood({
          date: toLocalDateKey(new Date()),
          name: food.name,
          calories: food.calories,
          protein: food.protein,
          carbs: food.carbs,
          fats: food.fats,
          mealType: "snack",
          servingSize: food.servingSize,
        });
      });
      Alert.alert("Food Recognized", `${analysis.description}\n\nAdded ${analysis.foods.length} item(s) totaling ${analysis.totalCalories} kcal.`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      handleAiError(e, "Failed to analyze food photo.");
    } finally {
      setScanning(false);
    }
  };

  const handleDeleteCustomMealPlan = (id: string) => {
    Alert.alert("Delete Plan", "Are you sure you want to delete this meal plan?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => { deleteCustomMealPlan(id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } },
    ]);
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
              disabled={scanning} accessibilityRole="button" accessibilityLabel="Open camera"
        >
              {scanning ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : canAccess("ai_food_scan") ? (
                <Ionicons name="camera" size={18} color={Colors.primary} />
              ) : (
                <View style={{ position: "relative" }}>
                  <Ionicons name="camera" size={18} color={Colors.primary} />
                  <View style={{ position: "absolute", top: -4, right: -4, backgroundColor: Colors.primary, borderRadius: 5, width: 10, height: 10, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="lock-closed" size={6} color="#000" />
                  </View>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: Colors.accent + "20" }]}
              onPress={() => setFoodSearchVisible(true)}
              activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Search"
        >
              <Ionicons name="search" size={18} color={Colors.accent} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: Colors.accent + "20" }]}
              onPress={() => {
                if (!canAccess("ai_meal_plan")) {
                  router.push("/paywall");
                  return;
                }
                setAiMealModalVisible(true);
              }}
              activeOpacity={0.8}
            >
              <View style={{ position: "relative" }}>
                <Ionicons name="sparkles" size={18} color={Colors.accent} />
                {!canAccess("ai_meal_plan") && (
                  <View style={{ position: "absolute", top: -4, right: -4, backgroundColor: Colors.primary, borderRadius: 5, width: 10, height: 10, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="lock-closed" size={6} color="#000" />
                  </View>
                )}
              </View>
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
          <MacroBar label="Protein" current={consumed.protein} target={macros.protein} color={Colors.primary} />
          <MacroBar label="Carbs" current={consumed.carbs} target={macros.carbs} color={Colors.accent} />
          <MacroBar label="Fats" current={consumed.fats} target={macros.fats} color={Colors.accentGreen} />
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
            {/* Plan Switcher Header */}
            <TouchableOpacity
              style={[styles.planSwitcherRow, { backgroundColor: theme.card, borderColor: theme.border }]}
              onPress={() => setShowPlanSwitcher(true)}
              activeOpacity={0.8}
            >
              <View style={[styles.planTypeIcon, {
                backgroundColor: activeMealPlanType === "ai" ? Colors.accent + "20" : Semantic.manual + "20",
              }]}>
                <Ionicons
                  name={activeMealPlanType === "ai" ? "sparkles" : "list"}
                  size={16}
                  color={activeMealPlanType === "ai" ? Colors.accent : Semantic.manual}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.planNameText, { color: theme.text }]}>{displayPlanName}</Text>
                <Text style={[styles.planMetaText, { color: theme.textSecondary }]}>
                  {activeMeals.length} meal{activeMeals.length !== 1 ? "s" : ""}
                  {" · "}
                  {activeMealPlanType === "ai" ? "AI Generated" : "Custom"}
                </Text>
              </View>
              <View style={[styles.switchBadge, { backgroundColor: Colors.primary + "20" }]}>
                <Ionicons name="swap-horizontal" size={11} color={Colors.primary} />
                <Text style={[styles.switchBadgeText, { color: Colors.primary }]}>Switch</Text>
              </View>
            </TouchableOpacity>

            <View style={styles.tabHeaderRow}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>
                {activeMeals.length > 0 ? "Meals" : "No Plan Yet"}
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity
                  style={[styles.smallBtn, { borderColor: Semantic.manual + "40" }]}
                  onPress={() => { setEditingMealPlan(undefined); setShowMealPlanBuilder(true); }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="add" size={14} color={Semantic.manual} />
                  <Text style={[styles.smallBtnText, { color: Semantic.manual }]}>Custom</Text>
                </TouchableOpacity>
                {activeMealPlanType === "ai" && mealPlan && (
                  <TouchableOpacity
                    style={[styles.smallBtn, { borderColor: Colors.primary + "40" }]}
                    onPress={() => {
                      if (!canAccess("ai_meal_plan")) {
                        router.push("/paywall");
                        return;
                      }
                      handleRegenerate();
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="refresh" size={14} color={Colors.primary} />
                    <Text style={[styles.smallBtnText, { color: Colors.primary }]}>Refresh</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {activeMeals.length > 0 ? (
              activeMeals.map((meal) => (
                <MealCard
                  key={meal.id}
                  meal={meal}
                  onLog={handleLogMeal}
                  logged={loggedMealIds.includes(meal.id)}
                />
              ))
            ) : (
              <View style={styles.emptyState}>
                <TouchableOpacity
                  style={[styles.dietOptionCard, { backgroundColor: theme.card, borderColor: theme.border }]}
                  onPress={() => { setEditingMealPlan(undefined); setShowMealPlanBuilder(true); }}
                  activeOpacity={0.8}
                >
                  <View style={[styles.dietOptionIcon, { backgroundColor: Semantic.manual + "20" }]}>
                    <Ionicons name="create-outline" size={26} color={Semantic.manual} />
                  </View>
                  <View style={styles.dietOptionContent}>
                    <Text style={[styles.dietOptionTitle, { color: theme.text }]}>Custom Meal Plan</Text>
                    <Text style={[styles.dietOptionDesc, { color: theme.textSecondary }]}>
                      Create your own meals with custom macros and ingredients.
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.dietOptionCard, { backgroundColor: theme.card, borderColor: Colors.accent + "40" }]}
                  onPress={() => {
                    if (!canAccess("ai_meal_plan")) {
                      router.push("/paywall");
                      return;
                    }
                    setAiMealModalVisible(true);
                  }}
                  activeOpacity={0.8}
                >
                  <View style={[styles.dietOptionIcon, { backgroundColor: Colors.accent + "20" }]}>
                    <Ionicons name="sparkles" size={26} color={Colors.accent} />
                  </View>
                  <View style={styles.dietOptionContent}>
                    <Text style={[styles.dietOptionTitle, { color: theme.text }]}>AI Meal Plan</Text>
                    <Text style={[styles.dietOptionDesc, { color: theme.textSecondary }]}>
                      Get a personalized plan based on your goals, diet type, and food preferences.
                    </Text>
                  </View>
                  {!canAccess("ai_meal_plan") && (
                    <View style={{ backgroundColor: Colors.accent + "20", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginRight: 4 }}>
                      <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: Colors.accent }}>PREMIUM</Text>
                    </View>
                  )}
                  <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.dietQuickGenBtn, { backgroundColor: Colors.dark.card, borderColor: theme.border }]}
                  onPress={() => {
                    if (!canAccess("ai_meal_plan")) {
                      router.push("/paywall");
                      return;
                    }
                    handleRegenerate();
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="flash-outline" size={16} color={Colors.primary} />
                  <Text style={[styles.dietQuickGenText, { color: Colors.primary }]}>Quick Generate from Profile</Text>
                  {!canAccess("ai_meal_plan") && (
                    <View style={{ backgroundColor: Colors.primary + "20", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                      <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: Colors.primary }}>PREMIUM</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* Custom Meal Plans Section */}
            {customMealPlans.length > 0 && (
              <View style={styles.customSection}>
                <Text style={[styles.customSectionTitle, { color: theme.textSecondary }]}>CUSTOM MEAL PLANS</Text>
                {customMealPlans.map((cp) => (
                  <View key={cp.id} style={[styles.customPlanRow, {
                    backgroundColor: theme.card,
                    borderColor: activeCustomMealPlanId === cp.id && activeMealPlanType === "custom" ? Colors.primary : theme.border,
                  }]}>
                    <TouchableOpacity
                      style={styles.customPlanInfo}
                      onPress={() => setActiveMealPlan("custom", cp.id)}
                      activeOpacity={0.8}
                    >
                      {activeCustomMealPlanId === cp.id && activeMealPlanType === "custom" && (
                        <Ionicons name="checkmark-circle" size={18} color={Colors.primary} />
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.customPlanName, { color: theme.text }]}>{cp.name}</Text>
                        <Text style={[styles.customPlanMeta, { color: theme.textMuted }]}>
                          {cp.meals.length} meal{cp.meals.length !== 1 ? "s" : ""} · {cp.totalCalories} kcal
                        </Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => { setEditingMealPlan(cp); setShowMealPlanBuilder(true); }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="create-outline" size={18} color={theme.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleDeleteCustomMealPlan(cp.id)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Delete"
        >
                      <Ionicons name="trash-outline" size={18} color={Colors.accentRed} />
                    </TouchableOpacity>
                  </View>
                ))}
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
                <LogEntryCard key={entry.id} entry={entry} onRemove={() => removeLogEntry(entry.id)} />
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* Plan Switcher Modal */}
      {showPlanSwitcher && (
        <View style={styles.switcherOverlay}>
          <TouchableOpacity style={styles.switcherBackdrop} onPress={() => setShowPlanSwitcher(false)} />
          <View style={[styles.switcherSheet, { backgroundColor: theme.card }]}>
            <Text style={[styles.switcherTitle, { color: theme.text }]}>Choose Meal Plan</Text>

            {mealPlan && (
              <TouchableOpacity
                style={[styles.switcherOption, { borderColor: activeMealPlanType === "ai" ? Colors.primary : theme.border }]}
                onPress={() => { setActiveMealPlan("ai"); setShowPlanSwitcher(false); }}
                activeOpacity={0.8}
              >
                <View style={[styles.switcherIcon, { backgroundColor: Colors.accent + "20" }]}>
                  <Ionicons name="sparkles" size={16} color={Colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.switcherOptionName, { color: theme.text }]}>AI Meal Plan</Text>
                  <Text style={[styles.switcherOptionMeta, { color: theme.textMuted }]}>
                    AI Generated · {mealPlan.meals.length} meals · {mealPlan.totalCalories} kcal
                  </Text>
                </View>
                {activeMealPlanType === "ai" && <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />}
              </TouchableOpacity>
            )}

            {customMealPlans.map((cp) => (
              <TouchableOpacity
                key={cp.id}
                style={[styles.switcherOption, { borderColor: activeMealPlanType === "custom" && activeCustomMealPlanId === cp.id ? Colors.primary : theme.border }]}
                onPress={() => { setActiveMealPlan("custom", cp.id); setShowPlanSwitcher(false); }}
                activeOpacity={0.8}
              >
                <View style={[styles.switcherIcon, { backgroundColor: Semantic.manual + "20" }]}>
                  <Ionicons name="list" size={16} color={Semantic.manual} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.switcherOptionName, { color: theme.text }]}>{cp.name}</Text>
                  <Text style={[styles.switcherOptionMeta, { color: theme.textMuted }]}>
                    Custom · {cp.meals.length} meals · {cp.totalCalories} kcal
                  </Text>
                </View>
                {activeMealPlanType === "custom" && activeCustomMealPlanId === cp.id && (
                  <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />
                )}
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={[styles.switcherNewBtn, { borderColor: theme.border }]}
              onPress={() => { setShowPlanSwitcher(false); setEditingMealPlan(undefined); setShowMealPlanBuilder(true); }}
              activeOpacity={0.8}
            >
              <Ionicons name="add" size={16} color={theme.textSecondary} />
              <Text style={[styles.switcherNewBtnText, { color: theme.textSecondary }]}>New Custom Meal Plan</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Modal visible={logModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Log Food</Text>
              <TouchableOpacity onPress={() => setLogModalVisible(false)} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>
            <QuickInput label="Food Name" value={quickLog.name} onChangeText={(v: string) => setQuickLog((p) => ({ ...p, name: v }))} placeholder="e.g. Grilled chicken" />
            <View style={styles.macroInputRow}>
              <QuickInputSmall label="Calories" value={quickLog.calories} onChangeText={(v: string) => setQuickLog((p) => ({ ...p, calories: v }))} />
              <QuickInputSmall label="Protein (g)" value={quickLog.protein} onChangeText={(v: string) => setQuickLog((p) => ({ ...p, protein: v }))} />
            </View>
            <View style={styles.macroInputRow}>
              <QuickInputSmall label="Carbs (g)" value={quickLog.carbs} onChangeText={(v: string) => setQuickLog((p) => ({ ...p, carbs: v }))} />
              <QuickInputSmall label="Fats (g)" value={quickLog.fats} onChangeText={(v: string) => setQuickLog((p) => ({ ...p, fats: v }))} />
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
      />

      <Modal visible={aiMealModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.aiModalContent, { backgroundColor: theme.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>AI Meal Plan</Text>
              <TouchableOpacity onPress={() => setAiMealModalVisible(false)} accessibilityRole="button" accessibilityLabel="Close">
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

      <CustomMealPlanBuilder
        visible={showMealPlanBuilder}
        onClose={() => { setShowMealPlanBuilder(false); setEditingMealPlan(undefined); }}
        onSave={(planData) => {
          if (editingMealPlan) {
            updateCustomMealPlan({ ...editingMealPlan, ...planData });
          } else {
            const saved = addCustomMealPlan(planData);
            setActiveMealPlan("custom", saved.id);
          }
        }}
        existingPlan={editingMealPlan}
      />
    </View>
  );
}

function LogEntryCard({ entry, onRemove }: { entry: FoodLogEntry; onRemove: () => void }) {
  const { theme } = useTheme();
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
      <TouchableOpacity onPress={onRemove} style={styles.removeBtn} accessibilityRole="button" accessibilityLabel="Delete">
        <Ionicons name="trash-outline" size={16} color={Colors.accentRed} />
      </TouchableOpacity>
    </View>
  );
}

function QuickInput({ label, value, onChangeText, placeholder }: { label: string; value: string; onChangeText: (v: string) => void; placeholder?: string }) {
  const { theme } = useTheme();
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

function QuickInputSmall({ label, value, onChangeText }: { label: string; value: string; onChangeText: (v: string) => void }) {
  const { theme } = useTheme();
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
  planSwitcherRow: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 1, gap: 12 },
  planTypeIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  planNameText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  planMetaText: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  switchBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  switchBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  tabHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  smallBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  smallBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  emptyState: { gap: 14, paddingVertical: 8, alignItems: "center" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  dietOptionCard: { flexDirection: "row", alignItems: "center", padding: 18, borderRadius: 16, borderWidth: 1, gap: 14 },
  dietOptionIcon: { width: 50, height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  dietOptionContent: { flex: 1, gap: 4 },
  dietOptionTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  dietOptionDesc: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  dietQuickGenBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 12, borderWidth: 1 },
  dietQuickGenText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  customSection: { gap: 8, marginTop: 4 },
  customSectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, paddingHorizontal: 2 },
  customPlanRow: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 1, gap: 10 },
  customPlanInfo: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  customPlanName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  customPlanMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  logEntry: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 12, borderWidth: 1, gap: 12 },
  logEntryName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  logEntryMacros: { flexDirection: "row", gap: 10, marginTop: 4, flexWrap: "wrap" },
  logMacro: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  removeBtn: { padding: 6 },
  switcherOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "flex-end" },
  switcherBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)" },
  switcherSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 10, paddingBottom: 36 },
  switcherTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 4 },
  switcherOption: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  switcherIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  switcherOptionName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  switcherOptionMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  switcherNewBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 14, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", marginTop: 4 },
  switcherNewBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
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
