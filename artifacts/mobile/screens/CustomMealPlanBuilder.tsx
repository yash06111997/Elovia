import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Platform,
  Alert,
  KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { useTheme } from "@/hooks/useTheme";
import type { Meal, CustomMealPlan } from "@/context/NutritionContext";

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (plan: Omit<CustomMealPlan, "id" | "createdAt" | "updatedAt">) => void;
  existingPlan?: CustomMealPlan;
}

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
const MEAL_TYPE_ICONS: Record<string, string> = {
  breakfast: "sunny-outline",
  lunch: "restaurant-outline",
  dinner: "moon-outline",
  snack: "cafe-outline",
};

export function CustomMealPlanBuilder({ visible, onClose, onSave, existingPlan }: Props) {
  const { isDark, theme } = useTheme();
  const insets = useSafeAreaInsets();

  const [planName, setPlanName] = useState(existingPlan?.name || "");
  const [meals, setMeals] = useState<Meal[]>(existingPlan?.meals || []);
  const [addMealVisible, setAddMealVisible] = useState(false);

  React.useEffect(() => {
    if (visible) {
      setPlanName(existingPlan?.name || "");
      setMeals(existingPlan?.meals || []);
      setEditingMealIdx(null);
    }
  }, [visible, existingPlan]);
  const [editingMealIdx, setEditingMealIdx] = useState<number | null>(null);
  const [mealForm, setMealForm] = useState({
    name: "",
    mealType: "lunch" as Meal["mealType"],
    calories: "",
    protein: "",
    carbs: "",
    fats: "",
    description: "",
    ingredients: "",
  });

  const resetForm = () => {
    setMealForm({ name: "", mealType: "lunch", calories: "", protein: "", carbs: "", fats: "", description: "", ingredients: "" });
    setEditingMealIdx(null);
  };

  const handleAddMeal = () => {
    if (!mealForm.name.trim()) {
      Alert.alert("Missing Info", "Please enter a meal name.");
      return;
    }
    const meal: Meal = {
      id: editingMealIdx !== null ? meals[editingMealIdx].id : Date.now().toString() + Math.random().toString(36).substr(2, 9),
      name: mealForm.name.trim(),
      mealType: mealForm.mealType,
      calories: parseFloat(mealForm.calories) || 0,
      protein: parseFloat(mealForm.protein) || 0,
      carbs: parseFloat(mealForm.carbs) || 0,
      fats: parseFloat(mealForm.fats) || 0,
      description: mealForm.description.trim(),
      ingredients: mealForm.ingredients.split(",").map((s) => s.trim()).filter(Boolean),
    };

    if (editingMealIdx !== null) {
      setMeals((prev) => prev.map((m, i) => (i === editingMealIdx ? meal : m)));
    } else {
      setMeals((prev) => [...prev, meal]);
    }
    setAddMealVisible(false);
    resetForm();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleEditMeal = (idx: number) => {
    const meal = meals[idx];
    setMealForm({
      name: meal.name,
      mealType: meal.mealType,
      calories: meal.calories.toString(),
      protein: meal.protein.toString(),
      carbs: meal.carbs.toString(),
      fats: meal.fats.toString(),
      description: meal.description,
      ingredients: meal.ingredients.join(", "),
    });
    setEditingMealIdx(idx);
    setAddMealVisible(true);
  };

  const handleRemoveMeal = (idx: number) => {
    setMeals((prev) => prev.filter((_, i) => i !== idx));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleSave = () => {
    if (!planName.trim()) {
      Alert.alert("Missing Info", "Please give your meal plan a name.");
      return;
    }
    if (meals.length === 0) {
      Alert.alert("Empty Plan", "Add at least one meal to your plan.");
      return;
    }
    const totals = meals.reduce(
      (acc, m) => ({
        calories: acc.calories + m.calories,
        protein: acc.protein + m.protein,
        carbs: acc.carbs + m.carbs,
        fats: acc.fats + m.fats,
      }),
      { calories: 0, protein: 0, carbs: 0, fats: 0 }
    );
    onSave({
      name: planName.trim(),
      meals,
      totalCalories: Math.round(totals.calories),
      totalProtein: Math.round(totals.protein),
      totalCarbs: Math.round(totals.carbs),
      totalFats: Math.round(totals.fats),
    });
    onClose();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const totalCals = meals.reduce((s, m) => s + m.calories, 0);
  const totalProtein = meals.reduce((s, m) => s + m.protein, 0);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 16 : insets.top + 8 }]}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="close" size={24} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.text }]}>
            {existingPlan ? "Edit Meal Plan" : "New Meal Plan"}
          </Text>
          <TouchableOpacity onPress={handleSave}>
            <Text style={[styles.saveBtn, { color: Colors.primary }]}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: theme.textSecondary }]}>Plan Name</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
              value={planName}
              onChangeText={setPlanName}
              placeholder="e.g. My Cutting Plan"
              placeholderTextColor={theme.textMuted}
            />
          </View>

          {meals.length > 0 && (
            <View style={[styles.summaryRow, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: Colors.accentYellow }]}>{Math.round(totalCals)}</Text>
                <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>kcal</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: Colors.primary }]}>{Math.round(totalProtein)}g</Text>
                <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>protein</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: theme.text }]}>{meals.length}</Text>
                <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>meals</Text>
              </View>
            </View>
          )}

          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>MEALS</Text>

          {meals.map((meal, idx) => (
            <View key={meal.id} style={[styles.mealItem, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={[styles.mealTypeIcon, { backgroundColor: Colors.primary + "15" }]}>
                <Ionicons name={MEAL_TYPE_ICONS[meal.mealType] as any} size={18} color={Colors.primary} />
              </View>
              <TouchableOpacity style={{ flex: 1 }} onPress={() => handleEditMeal(idx)} activeOpacity={0.7}>
                <Text style={[styles.mealName, { color: theme.text }]}>{meal.name}</Text>
                <View style={styles.mealMacros}>
                  <Text style={[styles.mealMacro, { color: Colors.accentYellow }]}>{meal.calories} kcal</Text>
                  <Text style={[styles.mealMacro, { color: Colors.primary }]}>{meal.protein}g P</Text>
                  <Text style={[styles.mealMacro, { color: Colors.accent }]}>{meal.carbs}g C</Text>
                  <Text style={[styles.mealMacro, { color: Colors.accentGreen }]}>{meal.fats}g F</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleRemoveMeal(idx)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="trash-outline" size={18} color="#FF5252" />
              </TouchableOpacity>
            </View>
          ))}

          <TouchableOpacity
            style={[styles.addMealBtn, { borderColor: Colors.primary + "60" }]}
            onPress={() => { resetForm(); setAddMealVisible(true); }}
            activeOpacity={0.8}
          >
            <Ionicons name="add-circle-outline" size={20} color={Colors.primary} />
            <Text style={[styles.addMealText, { color: Colors.primary }]}>Add Meal</Text>
          </TouchableOpacity>
        </ScrollView>

        <Modal visible={addMealVisible} animationType="slide" transparent>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <View style={styles.mealModalOverlay}>
              <View style={[styles.mealModalSheet, { backgroundColor: theme.surface }]}>
                <View style={styles.mealModalHeader}>
                  <Text style={[styles.mealModalTitle, { color: theme.text }]}>
                    {editingMealIdx !== null ? "Edit Meal" : "Add Meal"}
                  </Text>
                  <TouchableOpacity onPress={() => { setAddMealVisible(false); resetForm(); }}>
                    <Ionicons name="close" size={22} color={theme.textSecondary} />
                  </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }}>
                  <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Meal Name</Text>
                  <TextInput
                    style={[styles.fieldInput, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
                    value={mealForm.name}
                    onChangeText={(v) => setMealForm((p) => ({ ...p, name: v }))}
                    placeholder="e.g. Grilled Chicken Salad"
                    placeholderTextColor={theme.textMuted}
                  />

                  <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Meal Type</Text>
                  <View style={styles.typeRow}>
                    {MEAL_TYPES.map((type) => (
                      <TouchableOpacity
                        key={type}
                        style={[styles.typeChip, {
                          backgroundColor: mealForm.mealType === type ? Colors.primary + "20" : theme.card,
                          borderColor: mealForm.mealType === type ? Colors.primary : theme.border,
                        }]}
                        onPress={() => setMealForm((p) => ({ ...p, mealType: type }))}
                      >
                        <Ionicons name={MEAL_TYPE_ICONS[type] as any} size={14} color={mealForm.mealType === type ? Colors.primary : theme.textSecondary} />
                        <Text style={[styles.typeChipText, { color: mealForm.mealType === type ? Colors.primary : theme.text }]}>
                          {type.charAt(0).toUpperCase() + type.slice(1)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <View style={styles.macroRow}>
                    <View style={styles.macroField}>
                      <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Calories</Text>
                      <TextInput
                        style={[styles.fieldInput, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
                        value={mealForm.calories}
                        onChangeText={(v) => setMealForm((p) => ({ ...p, calories: v }))}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor={theme.textMuted}
                      />
                    </View>
                    <View style={styles.macroField}>
                      <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Protein (g)</Text>
                      <TextInput
                        style={[styles.fieldInput, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
                        value={mealForm.protein}
                        onChangeText={(v) => setMealForm((p) => ({ ...p, protein: v }))}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor={theme.textMuted}
                      />
                    </View>
                  </View>
                  <View style={styles.macroRow}>
                    <View style={styles.macroField}>
                      <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Carbs (g)</Text>
                      <TextInput
                        style={[styles.fieldInput, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
                        value={mealForm.carbs}
                        onChangeText={(v) => setMealForm((p) => ({ ...p, carbs: v }))}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor={theme.textMuted}
                      />
                    </View>
                    <View style={styles.macroField}>
                      <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Fats (g)</Text>
                      <TextInput
                        style={[styles.fieldInput, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
                        value={mealForm.fats}
                        onChangeText={(v) => setMealForm((p) => ({ ...p, fats: v }))}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor={theme.textMuted}
                      />
                    </View>
                  </View>

                  <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Description</Text>
                  <TextInput
                    style={[styles.fieldInput, styles.multiline, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
                    value={mealForm.description}
                    onChangeText={(v) => setMealForm((p) => ({ ...p, description: v }))}
                    placeholder="Brief description..."
                    placeholderTextColor={theme.textMuted}
                    multiline
                  />

                  <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Ingredients (comma separated)</Text>
                  <TextInput
                    style={[styles.fieldInput, styles.multiline, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
                    value={mealForm.ingredients}
                    onChangeText={(v) => setMealForm((p) => ({ ...p, ingredients: v }))}
                    placeholder="chicken breast, olive oil, spinach..."
                    placeholderTextColor={theme.textMuted}
                    multiline
                  />
                </ScrollView>

                <TouchableOpacity
                  style={[styles.addBtn, { backgroundColor: Colors.primary }]}
                  onPress={handleAddMeal}
                  activeOpacity={0.8}
                >
                  <Ionicons name={editingMealIdx !== null ? "checkmark" : "add"} size={18} color="#000" />
                  <Text style={styles.addBtnText}>{editingMealIdx !== null ? "Update Meal" : "Add Meal"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#2A2A34" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  saveBtn: { fontSize: 16, fontFamily: "Inter_700Bold" },
  content: { padding: 16, gap: 16, paddingBottom: 40 },
  label: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  input: { borderRadius: 12, borderWidth: 1, padding: 14, fontSize: 15, fontFamily: "Inter_500Medium" },
  summaryRow: { flexDirection: "row", borderRadius: 14, borderWidth: 1, padding: 14 },
  summaryItem: { flex: 1, alignItems: "center", gap: 2 },
  summaryValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8 },
  mealItem: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 14, borderWidth: 1, gap: 10 },
  mealTypeIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  mealName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  mealMacros: { flexDirection: "row", gap: 8, marginTop: 3 },
  mealMacro: { fontSize: 11, fontFamily: "Inter_500Medium" },
  addMealBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderStyle: "dashed" },
  addMealText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  mealModalOverlay: { flex: 1, backgroundColor: "#00000080", justifyContent: "flex-end" },
  mealModalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36, gap: 4 },
  mealModalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  mealModalTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginBottom: 6, marginTop: 12 },
  fieldInput: { borderRadius: 10, borderWidth: 1, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular" },
  multiline: { height: 60, textAlignVertical: "top" },
  typeRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  typeChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  typeChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  macroRow: { flexDirection: "row", gap: 12 },
  macroField: { flex: 1 },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 16, borderRadius: 14, marginTop: 16 },
  addBtnText: { color: "#000", fontSize: 16, fontFamily: "Inter_700Bold" },
});
