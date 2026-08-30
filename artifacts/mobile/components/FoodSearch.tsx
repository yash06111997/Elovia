import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { useTheme } from "@/hooks/useTheme";
import {
  foodCategories,
  searchFoods,
  getFoodsByCategory,
  filterByDiet,
  FoodItem,
} from "@/utils/foodDatabase";
import { useApp } from "@/context/AppContext";

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (food: FoodItem, servings: number) => void;
}

export function FoodSearch({ visible, onClose, onSelect }: Props) {
  // Reads the theme from the hook rather than deriving it from an `isDark`
  // prop. Deriving it locally is how this file drifted out of step with the
  // rest of the app in the first place.
  const { theme } = useTheme();
  const { state: appState } = useApp();
  const dietaryPreference = appState.profile?.foodPreference;
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedFood, setSelectedFood] = useState<FoodItem | null>(null);
  const [servings, setServings] = useState("1");

  const results = useMemo(() => {
    const base = query.trim()
      ? searchFoods(query)
      : selectedCategory
        ? getFoodsByCategory(selectedCategory)
        : [];
    // Respect the user's dietary preference. searchFoods' second parameter is
    // a CATEGORY, not a diet - passing the preference there filtered by a
    // category that never matches, so this filtering never actually ran.
    return dietaryPreference ? filterByDiet(base, dietaryPreference) : base;
  }, [query, selectedCategory, dietaryPreference]);

  const handleSelect = (food: FoodItem) => {
    setSelectedFood(food);
    setServings("1");
  };

  const handleConfirm = () => {
    if (!selectedFood) return;
    const s = parseFloat(servings) || 1;
    onSelect(selectedFood, s);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSelectedFood(null);
    setQuery("");
    setSelectedCategory(null);
    onClose();
  };

  const handleClose = () => {
    setSelectedFood(null);
    setQuery("");
    setSelectedCategory(null);
    onClose();
  };

  const servingMultiplier = parseFloat(servings) || 1;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: theme.surface }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.text }]}>Search Food</Text>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close" size={22} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={[styles.searchBar, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Ionicons name="search" size={18} color={theme.textMuted} />
            <TextInput
              style={[styles.searchInput, { color: theme.text }]}
              value={query}
              onChangeText={(v) => { setQuery(v); setSelectedCategory(null); }}
              placeholder="Search foods..."
              placeholderTextColor={theme.textMuted}
              autoCorrect={false}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery("")}>
                <Ionicons name="close-circle" size={18} color={theme.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {!query.trim() && !selectedCategory && (
            <FlatList
              data={[...foodCategories]}
              keyExtractor={(item) => item}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingBottom: 20 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.categoryCard, { backgroundColor: theme.card, borderColor: theme.border }]}
                  onPress={() => { setSelectedCategory(item); Haptics.selectionAsync(); }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="restaurant-outline" size={18} color={Colors.primary} />
                  <Text style={[styles.categoryName, { color: theme.text }]}>{item}</Text>
                  <Text style={[styles.categoryCount, { color: theme.textSecondary }]}>
                    {filterByDiet(getFoodsByCategory(item), dietaryPreference ?? "").length} items
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
                </TouchableOpacity>
              )}
            />
          )}

          {(query.trim() || selectedCategory) && !selectedFood && (
            <>
              {selectedCategory && (
                <TouchableOpacity
                  style={styles.backRow}
                  onPress={() => setSelectedCategory(null)}
                >
                  <Ionicons name="arrow-back" size={16} color={Colors.primary} />
                  <Text style={[styles.backText, { color: Colors.primary }]}>{selectedCategory}</Text>
                </TouchableOpacity>
              )}
              <FlatList
                data={results}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ gap: 6, paddingBottom: 20 }}
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <Ionicons name="search-outline" size={40} color={theme.textMuted} />
                    <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                      No foods found for "{query}"
                    </Text>
                  </View>
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.foodCard, { backgroundColor: theme.card, borderColor: theme.border }]}
                    onPress={() => handleSelect(item)}
                    activeOpacity={0.8}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.foodName, { color: theme.text }]}>{item.name}</Text>
                      <Text style={[styles.foodServing, { color: theme.textSecondary }]}>{item.servingSize}</Text>
                    </View>
                    <View style={styles.foodMacros}>
                      <Text style={[styles.foodCal, { color: Colors.accentYellow }]}>{item.calories} kcal</Text>
                      <Text style={[styles.foodMacro, { color: theme.textSecondary }]}>
                        P:{item.protein} C:{item.carbs} F:{item.fats}
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}
              />
            </>
          )}

          {selectedFood && (
            <View style={styles.detailView}>
              <View style={[styles.detailCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <Text style={[styles.detailName, { color: theme.text }]}>{selectedFood.name}</Text>
                <Text style={[styles.detailServing, { color: theme.textSecondary }]}>
                  Serving: {selectedFood.servingSize} ({selectedFood.servingGrams}g)
                </Text>

                <View style={styles.servingsRow}>
                  <Text style={[styles.servingsLabel, { color: theme.textSecondary }]}>Servings:</Text>
                  <TouchableOpacity
                    style={[styles.servBtn, { backgroundColor: theme.cardElevated }]}
                    onPress={() => { const v = Math.max(0.5, (parseFloat(servings) || 1) - 0.5); setServings(v.toString()); }}
                  >
                    <Ionicons name="remove" size={16} color={theme.text} />
                  </TouchableOpacity>
                  <TextInput
                    style={[styles.servInput, { backgroundColor: theme.cardElevated, color: theme.text, borderColor: Colors.primary }]}
                    value={servings}
                    onChangeText={setServings}
                    keyboardType="numeric"
                    selectTextOnFocus
                  />
                  <TouchableOpacity
                    style={[styles.servBtn, { backgroundColor: theme.cardElevated }]}
                    onPress={() => { const v = (parseFloat(servings) || 1) + 0.5; setServings(v.toString()); }}
                  >
                    <Ionicons name="add" size={16} color={theme.text} />
                  </TouchableOpacity>
                </View>

                <View style={[styles.macroGrid]}>
                  <MacroDetail label="Calories" value={Math.round(selectedFood.calories * servingMultiplier)} unit="kcal" color={Colors.accentYellow} theme={theme} />
                  <MacroDetail label="Protein" value={Math.round(selectedFood.protein * servingMultiplier)} unit="g" color={Colors.primary} theme={theme} />
                  <MacroDetail label="Carbs" value={Math.round(selectedFood.carbs * servingMultiplier)} unit="g" color={Colors.accent} theme={theme} />
                  <MacroDetail label="Fats" value={Math.round(selectedFood.fats * servingMultiplier)} unit="g" color={Colors.accentGreen} theme={theme} />
                </View>
              </View>

              <View style={styles.detailActions}>
                <TouchableOpacity
                  style={[styles.backBtn, { borderColor: theme.border }]}
                  onPress={() => setSelectedFood(null)}
                >
                  <Text style={[styles.backBtnText, { color: theme.textSecondary }]}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.addBtn, { backgroundColor: Colors.accentGreen }]}
                  onPress={handleConfirm}
                  activeOpacity={0.8}
                >
                  <Ionicons name="add" size={16} color="#000" />
                  <Text style={styles.addBtnText}>Add to Log</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function MacroDetail({ label, value, unit, color, theme }: any) {
  return (
    <View style={[styles.macroItem, { backgroundColor: theme.cardElevated }]}>
      <Text style={[styles.macroLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[styles.macroValue, { color }]}>{value}<Text style={styles.macroUnit}> {unit}</Text></Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "#00000080", justifyContent: "flex-end" },
  container: { height: "90%", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  searchBar: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  categoryCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1 },
  categoryName: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  categoryCount: { fontSize: 12, fontFamily: "Inter_400Regular" },
  backRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  backText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  foodCard: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1, gap: 10 },
  foodName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  foodServing: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  foodMacros: { alignItems: "flex-end" },
  foodCal: { fontSize: 13, fontFamily: "Inter_700Bold" },
  foodMacro: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  emptyState: { alignItems: "center", paddingVertical: 48, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  detailView: { flex: 1, justifyContent: "center", gap: 16 },
  detailCard: { borderRadius: 16, borderWidth: 1, padding: 20, gap: 14 },
  detailName: { fontSize: 18, fontFamily: "Inter_700Bold" },
  detailServing: { fontSize: 13, fontFamily: "Inter_400Regular" },
  servingsRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  servingsLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  servBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  servInput: { width: 60, height: 36, borderRadius: 10, borderWidth: 2, textAlign: "center", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  macroGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  macroItem: { width: "47%", padding: 12, borderRadius: 12, gap: 4 },
  macroLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  macroValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  macroUnit: { fontSize: 11 },
  detailActions: { flexDirection: "row", gap: 12 },
  backBtn: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  backBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  addBtn: { flex: 2, flexDirection: "row", padding: 14, borderRadius: 12, alignItems: "center", justifyContent: "center", gap: 6 },
  addBtnText: { color: "#000", fontSize: 15, fontFamily: "Inter_700Bold" },
});
