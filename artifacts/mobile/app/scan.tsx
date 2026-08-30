import React, { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  ScrollView,
} from "react-native";
import { router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Colors } from "@/constants/colors";
import { useTheme } from "@/hooks/useTheme";
import { useNutrition } from "@/context/NutritionContext";
import {
  lookupBarcode,
  novaLabel,
  type PackagedFood,
  type BarcodeLookupResult,
} from "@/lib/openFoodFacts";

/**
 * Barcode scanner for packaged food.
 *
 * Complements the AI photo scan rather than replacing it: a barcode gives
 * exact label data for anything packaged, while the photo scan handles cooked
 * meals that have no barcode at all.
 */
export default function ScanScreen() {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const { logFood: logFoodEntry } = useNutrition();

  const [looking, setLooking] = useState(false);
  const [result, setResult] = useState<BarcodeLookupResult | null>(null);
  const [servings, setServings] = useState(1);

  /**
   * The camera fires continuously while a barcode is in frame. Without this
   * guard a single scan triggers dozens of identical network lookups.
   */
  const scanLockRef = useRef(false);

  const handleScan = useCallback(async ({ data }: { data: string }) => {
    if (scanLockRef.current) return;
    scanLockRef.current = true;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setLooking(true);

    try {
      const lookup = await lookupBarcode(data);
      setResult(lookup);
      setServings(1);
    } finally {
      setLooking(false);
    }
  }, []);

  const resetScan = () => {
    setResult(null);
    scanLockRef.current = false;
  };

  const logFood = (food: PackagedFood) => {
    logFoodEntry({
      date: new Date().toISOString().split("T")[0],
      name: food.name,
      calories: Math.round(food.calories * servings),
      protein: Math.round(food.protein * servings),
      carbs: Math.round(food.carbs * servings),
      fats: Math.round(food.fats * servings),
      servingSize: `${servings} × ${food.servingSize}`,
      mealType: guessMealType(),
    });

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  if (Platform.OS === "web") {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Stack.Screen options={{ title: "Scan", headerShown: true }} />
        <Ionicons name="phone-portrait-outline" size={40} color={theme.textMuted} />
        <Text style={[styles.centerText, { color: theme.textSecondary }]}>
          Barcode scanning needs the mobile app.
        </Text>
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Stack.Screen options={{ title: "Scan", headerShown: true }} />
        <Ionicons name="camera-outline" size={40} color={theme.textMuted} />
        <Text style={[styles.centerTitle, { color: theme.text }]}>Camera access needed</Text>
        <Text style={[styles.centerText, { color: theme.textSecondary }]}>
          Elovia uses the camera to read barcodes on packaged food.
        </Text>
        <TouchableOpacity
          style={[styles.permissionBtn, { backgroundColor: Colors.primary }]}
          onPress={requestPermission}
          activeOpacity={0.85}
        >
          <Text style={styles.permissionBtnText}>Allow camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: "#000" }]}>
      <Stack.Screen options={{ title: "Scan barcode", headerShown: true }} />

      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128"],
        }}
        onBarcodeScanned={result ? undefined : handleScan}
      />

      {!result && (
        <View style={styles.overlay} pointerEvents="none">
          <View style={styles.reticle} />
          <Text style={styles.overlayHint}>
            {looking ? "Looking that up…" : "Point at the barcode"}
          </Text>
        </View>
      )}

      {result && (
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.background, paddingBottom: insets.bottom + 16 },
          ]}
        >
          <ScrollView showsVerticalScrollIndicator={false}>
            {result.status === "found" ? (
              <FoundProduct
                food={result.food}
                servings={servings}
                onServingsChange={setServings}
                theme={theme}
                isDark={isDark}
              />
            ) : (
              <View style={styles.miss}>
                <Ionicons
                  name={result.status === "not_found" ? "help-circle-outline" : "alert-circle-outline"}
                  size={34}
                  color={theme.textMuted}
                />
                <Text style={[styles.missTitle, { color: theme.text }]}>
                  {result.status === "not_found"
                    ? "Not in the database"
                    : "Could not use this product"}
                </Text>
                <Text style={[styles.missBody, { color: theme.textSecondary }]}>
                  {result.status === "not_found"
                    ? "This barcode is not in Open Food Facts yet. You can log it manually or try the photo scan instead."
                    : result.reason}
                </Text>
              </View>
            )}

            <View style={styles.sheetActions}>
              <TouchableOpacity
                style={[styles.secondaryBtn, { borderColor: theme.border }]}
                onPress={resetScan}
                activeOpacity={0.85}
              >
                <Text style={[styles.secondaryBtnText, { color: theme.text }]}>Scan again</Text>
              </TouchableOpacity>

              {result.status === "found" && (
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: Colors.primary }]}
                  onPress={() => logFood(result.food)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.primaryBtnText}>Log it</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function FoundProduct({
  food,
  servings,
  onServingsChange,
  theme,
  isDark,
}: {
  food: PackagedFood;
  servings: number;
  onServingsChange: (n: number) => void;
  theme: any;
  isDark: boolean;
}) {
  const nova = novaLabel(food.novaGroup);

  return (
    <View style={styles.product}>
      <Text style={[styles.productName, { color: theme.text }]}>{food.name}</Text>
      <Text style={[styles.productServing, { color: theme.textMuted }]}>
        Per {food.servingSize}
        {food.per100gOnly ? " (no serving size on the label)" : ""}
      </Text>

      <View style={styles.macroRow}>
        <Macro label="kcal" value={Math.round(food.calories * servings)} tone={Colors.accentYellow} theme={theme} />
        <Macro label="protein" value={Math.round(food.protein * servings)} unit="g" tone={Colors.primary} theme={theme} />
        <Macro label="carbs" value={Math.round(food.carbs * servings)} unit="g" tone={Colors.accent} theme={theme} />
        <Macro label="fat" value={Math.round(food.fats * servings)} unit="g" tone={Colors.accentGreen} theme={theme} />
      </View>

      <View style={[styles.servingRow, { borderColor: theme.border }]}>
        <Text style={[styles.servingLabel, { color: theme.textSecondary }]}>Servings</Text>
        <TouchableOpacity
          onPress={() => onServingsChange(Math.max(0.5, servings - 0.5))}
          hitSlop={10} accessibilityRole="button" accessibilityLabel="Decrease"
        >
          <Ionicons name="remove-circle-outline" size={26} color={theme.textMuted} />
        </TouchableOpacity>
        <Text style={[styles.servingValue, { color: theme.text }]}>{servings}</Text>
        <TouchableOpacity
          onPress={() => onServingsChange(Math.min(20, servings + 0.5))}
          hitSlop={10} accessibilityRole="button" accessibilityLabel="Increase"
        >
          <Ionicons name="add-circle-outline" size={26} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {(food.nutriScore || nova) && (
        <View style={styles.badges}>
          {food.nutriScore && (
            <View style={[styles.badge, { backgroundColor: nutriScoreColor(food.nutriScore) + "25" }]}>
              <Text style={[styles.badgeText, { color: nutriScoreColor(food.nutriScore) }]}>
                Nutri-Score {food.nutriScore}
              </Text>
            </View>
          )}
          {nova && (
            <View style={[styles.badge, { backgroundColor: Colors.dark.text + "12" }]}>
              <Text style={[styles.badgeText, { color: theme.textSecondary }]}>{nova}</Text>
            </View>
          )}
        </View>
      )}

      {food.allergens.length > 0 && (
        <View style={[styles.allergenBox, { borderColor: Colors.accentRed + "40" }]}>
          <Ionicons name="warning-outline" size={15} color={Colors.accentRed} />
          <Text style={[styles.allergenText, { color: theme.textSecondary }]}>
            Contains: {food.allergens.join(", ")}
          </Text>
        </View>
      )}
    </View>
  );
}

function Macro({
  label,
  value,
  unit,
  tone,
  theme,
}: {
  label: string;
  value: number;
  unit?: string;
  tone: string;
  theme: any;
}) {
  return (
    <View style={styles.macro}>
      <Text style={[styles.macroValue, { color: tone }]}>
        {value}
        {unit ?? ""}
      </Text>
      <Text style={[styles.macroLabel, { color: theme.textMuted }]}>{label}</Text>
    </View>
  );
}

function nutriScoreColor(grade: string): string {
  switch (grade) {
    case "A":
      return "#038141";
    case "B":
      return "#85BB2F";
    case "C":
      return "#FECB02";
    case "D":
      return "#EE8100";
    default:
      return "#E63E11";
  }
}

/** Best guess at which meal this is, from the time of day. */
function guessMealType(): "breakfast" | "lunch" | "dinner" | "snack" {
  const hour = new Date().getHours();
  if (hour < 11) return "breakfast";
  if (hour < 15) return "lunch";
  if (hour < 21) return "dinner";
  return "snack";
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
  centerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  centerText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },
  permissionBtn: { borderRadius: 12, paddingHorizontal: 24, paddingVertical: 13, marginTop: 8 },
  permissionBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#000" },

  overlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 20 },
  reticle: {
    width: "72%",
    height: 150,
    borderWidth: 2.5,
    borderColor: Colors.primary,
    borderRadius: 16,
    backgroundColor: "transparent",
  },
  overlayHint: { color: "#FFF", fontSize: 14, fontFamily: "Inter_500Medium" },

  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "72%",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
  },
  product: { gap: 12 },
  productName: { fontSize: 18, fontFamily: "Inter_700Bold" },
  productServing: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: -8 },

  macroRow: { flexDirection: "row", gap: 8 },
  macro: { flex: 1, alignItems: "center", gap: 2 },
  macroValue: { fontSize: 19, fontFamily: "Inter_700Bold" },
  macroLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },

  servingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  servingLabel: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  servingValue: { fontSize: 16, fontFamily: "Inter_600SemiBold", minWidth: 32, textAlign: "center" },

  badges: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  allergenBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  allergenText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular" },

  miss: { alignItems: "center", gap: 8, paddingVertical: 20 },
  missTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  missBody: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },

  sheetActions: { flexDirection: "row", gap: 10, marginTop: 18 },
  secondaryBtn: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  secondaryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  primaryBtn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  primaryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#000" },
});
