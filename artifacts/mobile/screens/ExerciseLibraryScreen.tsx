import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  FlatList,
  useColorScheme,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  allExercises,
  EXERCISE_CATEGORIES,
  ExerciseEntry,
} from "@/utils/exerciseDatabase";
import { Colors } from "@/constants/colors";

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelectExercise?: (exercise: ExerciseEntry) => void;
  selectionMode?: boolean;
  userEquipment?: string[];
}

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "#00E676",
  intermediate: "#FFD600",
  advanced: "#FF5252",
};

const TYPE_COLORS: Record<string, string> = {
  compound: "#00D4FF",
  isolation: "#A78BFA",
  cardio: "#FF9800",
};

export function ExerciseLibraryScreen({
  visible,
  onClose,
  onSelectExercise,
  selectionMode = false,
  userEquipment = [],
}: Props) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();

  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterEquipment, setFilterEquipment] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const categories = ["All", ...EXERCISE_CATEGORIES];

  const filtered = useMemo(() => {
    let list = allExercises;

    if (selectedCategory !== "All") {
      list = list.filter((e) => e.category === selectedCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.muscleGroup.toLowerCase().includes(q) ||
          e.primaryMuscle.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q)
      );
    }

    if (filterEquipment && userEquipment.length > 0) {
      list = list.filter((e) =>
        e.equipment.some(
          (eq) => eq === "none" || userEquipment.includes(eq)
        )
      );
    }

    return list;
  }, [selectedCategory, searchQuery, filterEquipment, userEquipment]);

  const renderExercise = ({ item }: { item: ExerciseEntry }) => {
    const isExpanded = expandedId === item.id;
    return (
      <TouchableOpacity
        style={[styles.exerciseCard, { backgroundColor: theme.card, borderColor: theme.border }]}
        onPress={() => {
          if (selectionMode && onSelectExercise) {
            onSelectExercise(item);
          } else {
            setExpandedId(isExpanded ? null : item.id);
          }
        }}
        activeOpacity={0.8}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardLeft}>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: DIFFICULTY_COLORS[item.difficulty] + "20" }]}>
                <Text style={[styles.badgeText, { color: DIFFICULTY_COLORS[item.difficulty] }]}>
                  {item.difficulty}
                </Text>
              </View>
              <View style={[styles.badge, { backgroundColor: TYPE_COLORS[item.type] + "20" }]}>
                <Text style={[styles.badgeText, { color: TYPE_COLORS[item.type] }]}>
                  {item.type}
                </Text>
              </View>
            </View>
            <Text style={[styles.exerciseName, { color: theme.text }]}>{item.name}</Text>
            <Text style={[styles.muscleLine, { color: theme.textSecondary }]}>
              {item.primaryMuscle}
              {item.secondaryMuscles.length > 0 && ` · ${item.secondaryMuscles.slice(0, 2).join(", ")}`}
            </Text>
          </View>
          <View style={styles.cardRight}>
            {selectionMode ? (
              <View style={[styles.addBtn, { backgroundColor: Colors.primary }]}>
                <Ionicons name="add" size={18} color="#000" />
              </View>
            ) : (
              <Ionicons
                name={isExpanded ? "chevron-up" : "chevron-down"}
                size={18}
                color={theme.textMuted}
              />
            )}
          </View>
        </View>

        {isExpanded && (
          <View style={[styles.details, { borderTopColor: theme.border }]}>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={[styles.statLabel, { color: theme.textMuted }]}>SETS</Text>
                <Text style={[styles.statValue, { color: theme.text }]}>{item.sets}</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statLabel, { color: theme.textMuted }]}>REPS</Text>
                <Text style={[styles.statValue, { color: theme.text }]}>{item.reps}</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statLabel, { color: theme.textMuted }]}>REST</Text>
                <Text style={[styles.statValue, { color: theme.text }]}>{item.restSeconds}s</Text>
              </View>
            </View>
            <View style={[styles.notesBox, { backgroundColor: isDark ? "#0A0A0F" : "#F5F6FA" }]}>
              <Ionicons name="information-circle" size={14} color="#00D4FF" />
              <Text style={[styles.notesText, { color: theme.textSecondary }]}>{item.notes}</Text>
            </View>
            <View style={styles.equipRow}>
              <Ionicons name="barbell-outline" size={13} color={theme.textMuted} />
              <Text style={[styles.equipText, { color: theme.textMuted }]}>
                {item.equipment.map((e) => e.replace(/_/g, " ")).join(", ")}
              </Text>
            </View>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: Platform.OS === "ios" ? insets.top + 4 : 16, borderBottomColor: theme.border }]}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={24} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.text }]}>
            {selectionMode ? "Add Exercise" : "Exercise Library"}
          </Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Search */}
        <View style={[styles.searchContainer, { backgroundColor: isDark ? "#1A1A24" : "#F5F6FA", borderColor: theme.border }]}>
          <Ionicons name="search" size={18} color={theme.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search exercises..."
            placeholderTextColor={theme.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery("")}>
              <Ionicons name="close-circle" size={18} color={theme.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filters row */}
        <View style={styles.filtersRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryScroll}>
            {categories.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[
                  styles.categoryChip,
                  { borderColor: theme.border, backgroundColor: selectedCategory === cat ? Colors.primary : "transparent" },
                ]}
                onPress={() => setSelectedCategory(cat)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.categoryChipText,
                    { color: selectedCategory === cat ? "#000" : theme.textSecondary },
                  ]}
                >
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {userEquipment.length > 0 && (
            <TouchableOpacity
              style={[
                styles.equipFilter,
                { borderColor: filterEquipment ? Colors.primary : theme.border, backgroundColor: filterEquipment ? Colors.primary + "20" : "transparent" },
              ]}
              onPress={() => setFilterEquipment(!filterEquipment)}
              activeOpacity={0.8}
            >
              <Ionicons name="filter" size={14} color={filterEquipment ? Colors.primary : theme.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Count */}
        <Text style={[styles.countText, { color: theme.textMuted }]}>
          {filtered.length} exercise{filtered.length !== 1 ? "s" : ""}
        </Text>

        {/* List */}
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderExercise}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 20 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    padding: 0,
  },
  filtersRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    gap: 8,
    paddingRight: 16,
  },
  categoryScroll: {
    paddingLeft: 16,
    gap: 8,
    paddingRight: 4,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  categoryChipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  equipFilter: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  countText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 8,
  },
  exerciseCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 8,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  cardLeft: { flex: 1, gap: 4 },
  cardRight: { alignItems: "center", justifyContent: "center" },
  badgeRow: { flexDirection: "row", gap: 6, marginBottom: 2 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    textTransform: "capitalize",
  },
  exerciseName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  muscleLine: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  addBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  details: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    gap: 10,
    paddingTop: 10,
  },
  statsRow: {
    flexDirection: "row",
    gap: 16,
  },
  statItem: { alignItems: "center", gap: 2 },
  statLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  statValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  notesBox: {
    flexDirection: "row",
    gap: 6,
    padding: 10,
    borderRadius: 8,
    alignItems: "flex-start",
  },
  notesText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    flex: 1,
    lineHeight: 18,
  },
  equipRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  equipText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textTransform: "capitalize",
  },
});
