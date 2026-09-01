import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  Switch,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { Space, Radius } from "@/constants/design";
import { PressableScale } from "@/components/Pressable";
import { EmptyState } from "@/components/Skeleton";
import { useTheme } from "@/hooks/useTheme";
import { onDataRestored } from "@/lib/syncEvents";
import {
  loadPlaces,
  savePlaces,
  syncGeofences,
  stopAllGeofences,
  requestGeofencePermissions,
  hasBackgroundPermission,
  getCurrentPlaceCoordinates,
  makePlaceId,
  DEFAULT_RADIUS_M,
  MIN_RADIUS_M,
  MAX_PLACES,
  type SavedPlace,
} from "@/lib/geofence";

const KINDS = [
  { key: "gym", label: "Gym", icon: "barbell-outline" },
  { key: "home", label: "Home", icon: "home-outline" },
  { key: "work", label: "Work", icon: "briefcase-outline" },
  { key: "other", label: "Other", icon: "location-outline" },
] as const;

export default function PlacesScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [backgroundGranted, setBackgroundGranted] = useState(false);
  const [addVisible, setAddVisible] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setPlaces(await loadPlaces());
    setBackgroundGranted(await hasBackgroundPermission());
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    return onDataRestored(refresh);
  }, [refresh]);

  const persist = useCallback(async (next: SavedPlace[]): Promise<boolean> => {
    try {
      await savePlaces(next);
      setPlaces(next);
      await syncGeofences();
      return true;
    } catch {
      Alert.alert(
        "Could not save places",
        "Your changes were not saved. Please try again.",
      );
      return false;
    }
  }, []);

  const togglePlace = (
    id: string,
    field: "enabled" | "notifyOnArrive" | "autoStartWorkout",
  ) => {
    void persist(
      places.map((p) => (p.id === id ? { ...p, [field]: !p[field] } : p)),
    );
  };

  const removePlace = (place: SavedPlace) => {
    Alert.alert(
      "Remove place?",
      `${place.name} will no longer trigger anything.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => void persist(places.filter((p) => p.id !== place.id)),
        },
      ],
    );
  };

  const enableBackground = async () => {
    const outcome = await requestGeofencePermissions();

    if (outcome === "granted") {
      setBackgroundGranted(true);
      await syncGeofences();
      return;
    }

    Alert.alert(
      outcome === "unsupported"
        ? "Not available"
        : "Background location needed",
      outcome === "unsupported"
        ? "Place reminders need the mobile app."
        : Platform.OS === "ios"
          ? 'Open Settings > Elovia > Location and choose "Always". Without it, arrivals can only be detected while the app is open.'
          : 'Open Settings > Apps > Elovia > Permissions > Location and choose "Allow all the time".',
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: "My Places", headerShown: true }} />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.intro, { color: theme.textSecondary }]}>
          Elovia can notice when you arrive somewhere and offer to start your
          session. Arrival detection stays on your device. Saved place details
          are included in your private account backup when you sign in.
        </Text>

        {!backgroundGranted && places.length > 0 && (
          <PressableScale
            style={[
              styles.warnBanner,
              { borderColor: Colors.accentYellow + "50" },
            ]}
            onPress={enableBackground}
          >
            <Ionicons
              name="alert-circle-outline"
              size={18}
              color={Colors.accentYellow}
            />
            <Text style={[styles.warnText, { color: theme.textSecondary }]}>
              Background location is off, so arrivals will only be noticed while
              the app is open. Tap to enable.
            </Text>
          </PressableScale>
        )}

        {loading && (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 30 }} />
        )}

        {!loading && places.length === 0 && (
          <EmptyState
            icon={
              <Ionicons
                name="location-outline"
                size={28}
                color={theme.textMuted}
              />
            }
            title="No places yet"
            body="Add your gym and Elovia will offer to start your workout when you get there."
          />
        )}

        {places.map((place) => {
          const kind = KINDS.find((k) => k.key === place.kind) ?? KINDS[3];
          return (
            <View
              key={place.id}
              style={[
                styles.card,
                { backgroundColor: theme.card, borderColor: theme.border },
              ]}
            >
              <View style={styles.cardHeader}>
                <View
                  style={[
                    styles.kindIcon,
                    { backgroundColor: Colors.primary + "18" },
                  ]}
                >
                  <Ionicons
                    name={kind.icon as any}
                    size={18}
                    color={Colors.primary}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardName, { color: theme.text }]}>
                    {place.name}
                  </Text>
                  <Text style={[styles.cardMeta, { color: theme.textMuted }]}>
                    {kind.label} · {place.radius}m radius
                  </Text>
                </View>
                <PressableScale
                  onPress={() => removePlace(place)}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Delete"
                >
                  <Ionicons
                    name="trash-outline"
                    size={18}
                    color={theme.textMuted}
                  />
                </PressableScale>
              </View>

              <ToggleRow
                label="Active"
                value={place.enabled}
                onChange={() => togglePlace(place.id, "enabled")}
                theme={theme}
              />
              <ToggleRow
                label="Notify me on arrival"
                value={place.notifyOnArrive}
                onChange={() => togglePlace(place.id, "notifyOnArrive")}
                theme={theme}
                disabled={!place.enabled}
              />
              <ToggleRow
                label="Start a workout automatically"
                hint="Off by default — an app that starts recording on its own tends to feel intrusive."
                value={place.autoStartWorkout}
                onChange={() => togglePlace(place.id, "autoStartWorkout")}
                theme={theme}
                disabled={!place.enabled}
              />
            </View>
          );
        })}
      </ScrollView>

      {places.length < MAX_PLACES && (
        <PressableScale
          style={[
            styles.fab,
            { backgroundColor: Colors.primary, bottom: insets.bottom + 20 },
          ]}
          onPress={() => setAddVisible(true)}
          haptic
          accessibilityRole="button"
          accessibilityLabel="Add"
        >
          <Ionicons name="add" size={26} color="#000" />
        </PressableScale>
      )}

      <AddPlaceModal
        visible={addVisible}
        onClose={() => setAddVisible(false)}
        onSave={async (place) => {
          const next = [...places, place];
          if (!(await persist(next))) return false;
          setAddVisible(false);
          if (!(await hasBackgroundPermission())) await enableBackground();
          else setBackgroundGranted(true);
          return true;
        }}
        theme={theme}
      />
    </View>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
  theme,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: () => void;
  theme: any;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.toggleRow, disabled && { opacity: 0.45 }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.toggleLabel, { color: theme.text }]}>{label}</Text>
        {hint ? (
          <Text style={[styles.toggleHint, { color: theme.textMuted }]}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: Colors.primary }}
      />
    </View>
  );
}

function AddPlaceModal({
  visible,
  onClose,
  onSave,
  theme,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (place: SavedPlace) => Promise<boolean>;
  theme: any;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>("gym");
  const [radius, setRadius] = useState(String(DEFAULT_RADIUS_M));
  const [locating, setLocating] = useState(false);

  const saveHere = async () => {
    if (!name.trim()) return;
    setLocating(true);

    try {
      const coords = await getCurrentPlaceCoordinates();
      if (!coords) {
        Alert.alert(
          "Could not get your location",
          "Make sure location is enabled, and try again while you are at the place you want to save.",
        );
        return;
      }

      const parsedRadius = Number(radius);
      const saved = await onSave({
        id: makePlaceId(),
        name: name.trim().slice(0, 60),
        kind,
        latitude: coords.latitude,
        longitude: coords.longitude,
        // Enforced floor: below ~100m, GPS drift alone trips the fence
        // repeatedly and the user gets spammed.
        radius: Number.isFinite(parsedRadius)
          ? Math.max(MIN_RADIUS_M, Math.min(1000, parsedRadius))
          : DEFAULT_RADIUS_M,
        notifyOnArrive: true,
        autoStartWorkout: false,
        enabled: true,
      });

      if (!saved) return;

      setName("");
      setRadius(String(DEFAULT_RADIUS_M));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setLocating(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
          <Text style={[styles.modalTitle, { color: theme.text }]}>
            Save this place
          </Text>
          <PressableScale
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={24} color={theme.textMuted} />
          </PressableScale>
        </View>

        <ScrollView contentContainerStyle={styles.formContent}>
          <Text style={[styles.formHint, { color: theme.textMuted }]}>
            Saves your current position, so do this while you are actually at
            the place.
          </Text>

          <View style={styles.kindGrid}>
            {KINDS.map((option) => (
              <PressableScale
                key={option.key}
                style={[
                  styles.kindOption,
                  {
                    backgroundColor:
                      kind === option.key ? Colors.primary : theme.card,
                    borderColor:
                      kind === option.key ? Colors.primary : theme.border,
                  },
                ]}
                onPress={() => setKind(option.key)}
              >
                <Ionicons
                  name={option.icon as any}
                  size={18}
                  color={kind === option.key ? "#000" : theme.textSecondary}
                />
                <Text
                  style={[
                    styles.kindLabel,
                    {
                      color: kind === option.key ? "#000" : theme.textSecondary,
                    },
                  ]}
                >
                  {option.label}
                </Text>
              </PressableScale>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>
            Name
          </Text>
          <TextInput
            style={[
              styles.input,
              { color: theme.text, borderColor: theme.border },
            ]}
            value={name}
            onChangeText={setName}
            placeholder="e.g. PureGym Waterloo"
            placeholderTextColor={theme.textMuted}
          />

          <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>
            Trigger radius (metres)
          </Text>
          <TextInput
            style={[
              styles.input,
              { color: theme.text, borderColor: theme.border },
            ]}
            value={radius}
            onChangeText={setRadius}
            keyboardType="number-pad"
          />
          <Text style={[styles.formHint, { color: theme.textMuted }]}>
            Minimum {MIN_RADIUS_M}m. Smaller radii sound precise but GPS drift
            alone will trigger them repeatedly.
          </Text>

          <PressableScale
            style={[
              styles.saveBtn,
              { backgroundColor: name.trim() ? Colors.primary : theme.border },
            ]}
            onPress={saveHere}
            disabled={!name.trim() || locating}
          >
            {locating ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.saveBtnText}>Save my current location</Text>
            )}
          </PressableScale>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Space.lg, gap: Space.md },
  intro: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },

  warnBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.sm,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Space.md,
  },
  warnText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },

  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Space.lg,
    gap: Space.sm,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.md,
    marginBottom: 2,
  },
  kindIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  cardName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cardMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },

  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.md,
    paddingVertical: 4,
  },
  toggleLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  toggleHint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    lineHeight: 15,
    marginTop: 2,
  },

  fab: {
    position: "absolute",
    right: Space.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },

  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.md,
    padding: Space.xl,
    paddingTop: Space.xxl,
    borderBottomWidth: 1,
  },
  modalTitle: { flex: 1, fontSize: 20, fontFamily: "Inter_700Bold" },

  formContent: { padding: Space.xl, gap: Space.md },
  formHint: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },

  kindGrid: { flexDirection: "row", gap: Space.sm },
  kindOption: {
    flex: 1,
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingVertical: Space.md,
  },
  kindLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  fieldLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginTop: Space.xs,
  },
  input: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },

  saveBtn: {
    borderRadius: Radius.lg,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: Space.sm,
  },
  saveBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#000" },
});
