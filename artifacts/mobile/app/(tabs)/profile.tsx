import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, Alert, Modal, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useApp, CustomMacros, FitnessGoal, FitnessLevel, ActivityLevel, WorkoutPreference, FoodPreference, Equipment, DietType, type UserProfile } from "@/context/AppContext";
import { useWorkout } from "@/context/WorkoutContext";
import { useHealth } from "@/context/HealthContext";
import { useAuth } from "@/lib/auth";
import { useSubscription } from "@/context/SubscriptionContext";
import { backupToCloud, restoreFromCloud, migrateLegacyFirebaseData, getCurrentCloudSyncUserId, getCurrentCloudSyncSession, isCloudSyncSessionCurrent, prepareLocalSyncOwner, resetCurrentAccountData, type CloudSyncSessionToken } from "@/lib/cloudSync";
import { resetCurrentAccountStorage } from "@/lib/accountSyncStorage";
import { emitDataRestored } from "@/lib/syncEvents";
import { NumberEditModal } from "@/components/NumberEditModal";
import { Colors } from "@/constants/colors";
import {
  NavRow,
  SectionCard,
  ModalSheet,
  OptionPicker,
  InfoRow,
  TappableRow,
  StatItem,
} from "@/components/ui";
import { useTheme } from "@/hooks/useTheme";

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

const activityLabels: Record<string, string> = {
  sedentary: "Sedentary",
  lightly_active: "Lightly Active",
  moderately_active: "Moderately Active",
  very_active: "Very Active",
  extra_active: "Extra Active",
};

const prefLabels: Record<string, string> = {
  gym: "Gym",
  home: "Home",
  mixed: "Mixed",
};

const foodPrefLabels: Record<string, string> = {
  non_vegetarian: "Non-Vegetarian",
  vegetarian: "Vegetarian",
  eggetarian: "Eggetarian",
  vegan: "Vegan",
};

const allEquipment: { label: string; value: Equipment }[] = [
  { label: "Dumbbells", value: "dumbbells" },
  { label: "Barbell", value: "barbell" },
  { label: "Bench", value: "bench" },
  { label: "Resistance Bands", value: "resistance_bands" },
  { label: "Pull-Up Bar", value: "pull_up_bar" },
  { label: "Cable Machine", value: "cable_machine" },
  { label: "Treadmill", value: "treadmill" },
  { label: "Cycle", value: "cycle" },
  { label: "Kettlebells", value: "kettlebells" },
  { label: "Squat Rack", value: "squat_rack" },
  { label: "Smith Machine", value: "smith_machine" },
  { label: "No Equipment", value: "no_equipment" },
];

type EditField = "heightCm" | "weightKg" | "targetWeightKg" | "targetWeeks" | "age" | "sleepHours" | "waterIntakeLiters" | "workoutDaysPerWeek" | "workoutDurationMins" | null;
type EditSection = "fitness" | "diet" | "equipment" | "health" | "name" | null;
type ManualRestoreOperation = {
  expectedUserId: string;
  sessionToken: CloudSyncSessionToken;
};

export default function ProfileScreen() {
  const { isDark, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { state: appState, calculateTDEE, calculateMacros, updateProfileField, setCustomMacros } = useApp();
  const { sessions, personalRecords } = useWorkout();
  const {
    healthData,
    toggleSync,
    syncHealthData,
    isTracking,
    startRunTracking,
    stopRunTracking,
    currentRun,
    status: healthStatus,
    isSyncing,
    connectHealth,
    backendName,
  } = useHealth();
  const { user, isAuthenticated, isLoading: authLoading, login, logout } = useAuth();
  const { state: subState, isPremium, isTrialActive, isFree, daysRemaining, trialEndDate, restorePurchases, canAccess } = useSubscription();
  const [syncing, setSyncing] = useState(false);
  const profile = appState.profile;

  function confirmCloudOverwrite(operation: ManualRestoreOperation) {
    Alert.alert(
      "Use cloud copy?",
      "This will permanently replace unsynced changes on this device with the cloud copy. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Use cloud copy",
          style: "destructive",
          onPress: () => void downloadData(operation, true),
        },
      ],
    );
  }

  const uploadData = async () => {
    if (!isAuthenticated || !user) return;
    const expectedUserId = user.id;
    const sessionToken = getCurrentCloudSyncSession(expectedUserId);
    if (!sessionToken) {
      Alert.alert("Backup unavailable", "Cloud sync is not ready for this account yet. Please try again in a moment.");
      return;
    }
    const operationIsCurrent = async () =>
      isCloudSyncSessionCurrent(sessionToken) &&
      (await getCurrentCloudSyncUserId()) === expectedUserId;
    setSyncing(true);
    try {
      const owner = await prepareLocalSyncOwner(sessionToken);
      if (owner.status !== "ready" || !(await operationIsCurrent())) {
        Alert.alert(
          owner.status === "server" ? "Backup unavailable" : "Sign-in changed",
          owner.status === "server"
            ? "Elovia could not prepare your local data right now. Please try again later."
            : "Your account changed before backup started. Try again from the current account.",
        );
        return;
      }
      if (owner.changed) {
        const reload = await emitDataRestored();
        if (!(await operationIsCurrent()) || reload.status === "failed") {
          Alert.alert("Backup unavailable", "Elovia could not reload the active account's local data safely.");
          return;
        }
      }

      const result = await backupToCloud(sessionToken);
      if (!(await operationIsCurrent())) {
        Alert.alert("Sign-in changed", "Your account changed before backup completed. Try again from the current account.");
        return;
      }
      switch (result.status) {
        case "saved":
          Alert.alert("Backup complete", "Your data has been saved to your account.");
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          break;
        case "empty":
          Alert.alert("Nothing to back up", "There is no workout or nutrition data on this device yet.");
          break;
        case "offline":
          Alert.alert("You're offline", "Connect to the internet before backing up your data.");
          break;
        case "unauthorized":
          Alert.alert("Sign-in required", "Sign in again before backing up your data.");
          break;
        case "conflict":
          confirmCloudOverwrite({ expectedUserId, sessionToken });
          break;
        case "server":
          Alert.alert("Backup unavailable", "Elovia could not save your data right now. Please try again later.");
          break;
      }
    } catch {
      Alert.alert("Backup unavailable", "Elovia could not save your data right now. Please try again later.");
    } finally {
      setSyncing(false);
    }
  };

  async function downloadData(
    operation?: ManualRestoreOperation,
    allowOverwriteDirty = false,
  ) {
    if (!isAuthenticated || !user) return;
    const expectedUserId = operation?.expectedUserId ?? user.id;
    const sessionToken = operation?.sessionToken ?? getCurrentCloudSyncSession(expectedUserId);
    if (!sessionToken) {
      Alert.alert("Restore unavailable", "Cloud sync is not ready for this account yet. Please try again in a moment.");
      return;
    }
    const operationIsCurrent = async () =>
      isCloudSyncSessionCurrent(sessionToken) &&
      (await getCurrentCloudSyncUserId()) === expectedUserId;
    setSyncing(true);
    try {
      const owner = await prepareLocalSyncOwner(sessionToken);
      if (owner.status !== "ready" || !(await operationIsCurrent())) {
        Alert.alert(
          owner.status === "server" ? "Restore unavailable" : "Sign-in changed",
          owner.status === "server"
            ? "Elovia could not prepare your local data right now. Please try again later."
            : "Your account changed before restore started. Try again from the current account.",
        );
        return;
      }
      if (owner.changed) {
        const reload = await emitDataRestored();
        if (!(await operationIsCurrent()) || reload.status === "failed") {
          Alert.alert("Restore unavailable", "Elovia could not reload the active account's local data safely.");
          return;
        }
      }

      const outcome = allowOverwriteDirty
        ? await restoreFromCloud(sessionToken, { allowOverwriteDirty: true })
        : await restoreFromCloud(sessionToken);
      if (!(await operationIsCurrent())) {
        Alert.alert("Sign-in changed", "Your account changed before restore completed. Open the current account and try again.");
        return;
      }

      if (outcome.status === "local_changes") {
        confirmCloudOverwrite({ expectedUserId, sessionToken });
        return;
      }

      if (outcome.status === "restored") {
        if (!(await operationIsCurrent())) return;
        const reload = await emitDataRestored();
        if (!(await operationIsCurrent()) || reload.status === "failed") {
          Alert.alert("Restore incomplete", "Your cloud data was saved locally, but Elovia could not reload every screen. Please reopen the app.");
          return;
        }
        Alert.alert("Restore complete", "Your latest cloud data is now on this device.");
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      }

      if (outcome.status === "empty") {
        if (allowOverwriteDirty) {
          const reload = await emitDataRestored();
          if (!(await operationIsCurrent()) || reload.status === "failed") {
            Alert.alert("Restore incomplete", "The empty cloud copy was applied, but Elovia could not reload every screen. Please reopen the app.");
            return;
          }
          Alert.alert("Cloud copy applied", "No saved cloud data existed, so the confirmed local changes were cleared.");
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          return;
        }
        const migration = await migrateLegacyFirebaseData(sessionToken);
        if (!(await operationIsCurrent())) {
          Alert.alert("Sign-in changed", "Your account changed before restore completed. Open the current account and try again.");
          return;
        }
        if (migration.status === "empty") {
          Alert.alert("No cloud backup", "No saved data was found for this account.");
          return;
        }
        if (migration.status === "unauthorized") {
          Alert.alert("Sign-in required", "Sign in again before restoring your older data.");
          return;
        }
        if (migration.status === "offline") {
          Alert.alert(
            "You're offline",
            "Connect to the internet before checking your older backup.",
          );
          return;
        }
        if (migration.status === "server") {
          Alert.alert("Legacy restore unavailable", "Elovia could not check your older backup right now.");
          return;
        }

        if (!(await operationIsCurrent())) return;
        const reload = await emitDataRestored();
        if (!(await operationIsCurrent()) || reload.status === "failed") {
          Alert.alert("Restore incomplete", "Your older data was restored, but Elovia could not reload every screen. Please reopen the app.");
          return;
        }
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        switch (migration.cloudBackup.status) {
          case "saved":
            Alert.alert("Restore complete", "Your older data was restored and secured in cloud backup.");
            break;
          case "conflict":
            Alert.alert(
              "Older data restored",
              "Your older data is on this device, but newer cloud data also exists. Restore again before backing up.",
            );
            break;
          case "offline":
            Alert.alert(
              "Older data restored",
              "Your older data is on this device. Connect to the internet to secure it in cloud backup.",
            );
            break;
          case "unauthorized":
            Alert.alert("Older data restored", "Your older data is on this device. Sign in again before backing it up.");
            break;
          case "server":
            Alert.alert(
              "Older data restored",
              "Your older data is on this device, but cloud backup is temporarily unavailable.",
            );
            break;
          case "empty":
            Alert.alert(
              "Older data restored",
              "Your older data is on this device, but there was no supported data to back up.",
            );
            break;
        }
        return;
      }

      if (outcome.status === "offline") {
        Alert.alert("You're offline", "Connect to the internet before restoring your cloud data.");
      } else if (outcome.status === "unauthorized") {
        Alert.alert("Sign-in required", "Sign in again before restoring your cloud data.");
      } else {
        Alert.alert("Restore unavailable", "Elovia could not read your cloud data right now. Please try again later.");
      }
    } catch {
      Alert.alert("Restore unavailable", "Elovia could not read your cloud data right now. Please try again later.");
    } finally {
      setSyncing(false);
    }
  }

  const topPadding = Platform.OS === "web" ? 67 : insets.top + 12;
  const tdee = calculateTDEE();
  const macros = calculateMacros();

  const [editField, setEditField] = useState<EditField>(null);
  const [editSection, setEditSection] = useState<EditSection>(null);
  const [macroModalVisible, setMacroModalVisible] = useState(false);
  const [macroForm, setMacroForm] = useState({
    calories: macros.calories.toString(),
    protein: macros.protein.toString(),
    carbs: macros.carbs.toString(),
    fats: macros.fats.toString(),
  });

  const handleResetOnboarding = () => {
    Alert.alert("Reset App", "This will clear all your data and restart the onboarding. Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reset",
        style: "destructive",
        onPress: async () => {
          if (!isAuthenticated || !user) {
            const guestReset = await resetCurrentAccountStorage();
            if (guestReset.status !== "reset") {
              Alert.alert("Reset unavailable", "Elovia could not safely reset guest data. Please try again.");
              return;
            }
            const reload = await emitDataRestored();
            if (reload.status === "failed") {
              Alert.alert("Reset incomplete", "Guest data was cleared, but Elovia could not reload every screen. Please reopen the app.");
              return;
            }
            router.replace("/onboarding");
            return;
          }
          const sessionToken = getCurrentCloudSyncSession(user.id);
          if (!sessionToken) {
            Alert.alert("Reset unavailable", "Cloud sync is not ready for this account yet. Please try again in a moment.");
            return;
          }
          const outcome = await resetCurrentAccountData(sessionToken);
          if (outcome.status === "unauthorized") {
            Alert.alert("Sign-in changed", "Your account changed before reset completed. No other account data was cleared.");
            return;
          }
          if (outcome.status === "offline") {
            Alert.alert("You're offline", "Connect to the internet before resetting. Your local data was not cleared.");
            return;
          }
          if (outcome.status === "conflict") {
            Alert.alert("Newer cloud data found", "Restore the latest cloud data before resetting. Your local data was not cleared.");
            return;
          }
          if (outcome.status === "server") {
            Alert.alert("Reset unavailable", "Elovia could not clear your cloud data, so local data was left unchanged. Please try again.");
            return;
          }
          if (outcome.status === "local") {
            Alert.alert("Reset incomplete", "Cloud data was cleared, but local reset could not finish. Restore cloud data and try again.");
            return;
          }
          const reload = await emitDataRestored();
          if (reload.status === "failed" || !isCloudSyncSessionCurrent(sessionToken)) {
            Alert.alert("Reset incomplete", "Your local data was cleared, but Elovia could not reload every screen. Please reopen the app.");
            return;
          }
          router.replace("/onboarding");
        },
      },
    ]);
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

  const editFieldConfig: Record<
    string,
    {
      title: string;
      unit: string;
      min: number;
      max: number;
      step: number;
      value: number;
    }
  > = {
    heightCm: {
      title: "Edit Height",
      unit: "cm",
      min: 100,
      max: 250,
      step: 1,
      value: profile.heightCm,
    },
    weightKg: {
      title: "Edit Weight",
      unit: "kg",
      min: 30,
      max: 250,
      step: 0.5,
      value: profile.weightKg,
    },
    targetWeightKg: {
      title: "Edit Target Weight",
      unit: "kg",
      min: 30,
      max: 250,
      step: 0.5,
      value: profile.targetWeightKg || profile.weightKg,
    },
    targetWeeks: {
      title: "Edit Target Weeks",
      unit: "weeks",
      min: 4,
      max: 52,
      step: 1,
      value: profile.targetWeeks || 12,
    },
    age: {
      title: "Edit Age",
      unit: "years",
      min: 10,
      max: 90,
      step: 1,
      value: profile.age,
    },
    sleepHours: {
      title: "Edit Sleep Hours",
      unit: "hrs",
      min: 3,
      max: 12,
      step: 0.5,
      value: profile.sleepHours,
    },
    waterIntakeLiters: {
      title: "Edit Water Intake",
      unit: "L",
      min: 0.5,
      max: 6,
      step: 0.25,
      value: profile.waterIntakeLiters,
    },
    workoutDaysPerWeek: {
      title: "Edit Workout Days",
      unit: "days/wk",
      min: 1,
      max: 7,
      step: 1,
      value: profile.workoutDaysPerWeek,
    },
    workoutDurationMins: {
      title: "Edit Session Length",
      unit: "min",
      min: 15,
      max: 120,
      step: 15,
      value: profile.workoutDurationMins,
    },
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
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: topPadding,
          paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 80,
        },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.avatarSection}>
        <View style={[styles.avatarLarge, { backgroundColor: Colors.primary + "20" }]}>
          <Text style={[styles.avatarInitial, { color: Colors.primary }]}>{profile.name.charAt(0).toUpperCase() || "A"}</Text>
        </View>
        <Text style={[styles.userName, { color: theme.text }]}>{profile.name}</Text>
        <View style={styles.goalBadge}>
          <Ionicons name="flag-outline" size={12} color={Colors.primary} />
          <Text style={[styles.goalBadgeText, { color: Colors.primary }]}>{goalLabels[profile.goal]}</Text>
        </View>
      </View>

      <View style={[styles.statsCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <StatItem label="Workouts" value={sessions.filter((s) => s.completed).length.toString()} />
        <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
        <StatItem label="PRs" value={personalRecords.length.toString()} />
        <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
        <StatItem label="Streak" value={`${appState.currentStreak}d`} />
      </View>

      <SectionCard title="Body Stats" subtitle="Tap values to edit">
        <TappableRow label="Age" value={`${profile.age} years`} onPress={() => setEditField("age")} />
        <TappableRow label="Gender" value={profile.gender.charAt(0).toUpperCase() + profile.gender.slice(1)} onPress={() => setEditSection("name")} />
        <TappableRow label="Height" value={`${profile.heightCm} cm`} onPress={() => setEditField("heightCm")} />
        <TappableRow label="Weight" value={`${profile.weightKg} kg`} onPress={() => setEditField("weightKg")} />
        <TappableRow
          label="Target Weight"
          value={`${profile.targetWeightKg || profile.weightKg} kg`}
          onPress={() => setEditField("targetWeightKg")}
          badge={weightDirection !== "maintain" ? `${Math.abs(weightDelta).toFixed(1)} kg to ${weightDirection}` : undefined}
          badgeColor={weightDirection === "lose" ? Colors.accent : weightDirection === "gain" ? Colors.accentGreen : undefined}
        />
        {weightDirection !== "maintain" && (
          <TappableRow
            label="Timeline"
            value={`${targetWeeks} weeks`}
            onPress={() => setEditField("targetWeeks")}
            badge={`${weeklyRateKg} kg/wk • ${dailyCalAdjust > 0 ? "+" : ""}${dailyCalAdjust} kcal/day`}
            badgeColor={Colors.primary}
          />
        )}
        <InfoRow label="BMI" value={`${(profile.weightKg / (profile.heightCm / 100) ** 2).toFixed(1)}`} />
        <InfoRow label="TDEE" value={`${tdee} kcal`} highlight />
      </SectionCard>

      <SectionCard title="Daily Nutrition Targets">
        <View style={styles.macroActionsRow}>
          <TouchableOpacity
            style={[
              styles.macroEditBtn,
              {
                backgroundColor: Colors.primary + "20",
                borderColor: Colors.primary + "40",
              },
            ]}
            onPress={() => {
              if (!canAccess("custom_macros")) {
                router.push("/paywall");
                return;
              }
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
            <Text style={[styles.macroEditText, { color: Colors.primary }]}>{appState.customMacros?.enabled ? "Custom Macros" : "Override Macros"}</Text>
            {!canAccess("custom_macros") && (
              <View
                style={{
                  backgroundColor: Colors.primary + "20",
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 4,
                  marginLeft: 6,
                }}
              >
                <Ionicons name="lock-closed" size={10} color={Colors.primary} />
              </View>
            )}
          </TouchableOpacity>
          {appState.customMacros?.enabled && (
            <TouchableOpacity style={[styles.macroResetBtn, { borderColor: theme.border }]} onPress={handleResetMacros} activeOpacity={0.8}>
              <Ionicons name="refresh" size={14} color={theme.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
        <InfoRow label="Calories" value={`${macros.calories} kcal`} highlight />
        <InfoRow label="Protein" value={`${macros.protein} g`} />
        <InfoRow label="Carbs" value={`${macros.carbs} g`} />
        <InfoRow label="Fats" value={`${macros.fats} g`} />
      </SectionCard>

      <SectionCard title="Fitness Profile" subtitle="Tap to edit" onEdit={() => setEditSection("fitness")}>
        <TappableRow label="Goal" value={goalLabels[profile.goal]} onPress={() => setEditSection("fitness")} />
        <TappableRow label="Level" value={levelLabels[profile.fitnessLevel]} onPress={() => setEditSection("fitness")} />
        <TappableRow label="Activity" value={activityLabels[profile.activityLevel]} onPress={() => setEditSection("fitness")} />
        <TappableRow label="Workout Days" value={`${profile.workoutDaysPerWeek} days/week`} onPress={() => setEditField("workoutDaysPerWeek")} />
        <TappableRow label="Session Length" value={`${profile.workoutDurationMins} min`} onPress={() => setEditField("workoutDurationMins")} />
        <TappableRow label="Preference" value={prefLabels[profile.workoutPreference]} onPress={() => setEditSection("fitness")} />
      </SectionCard>

      <SectionCard title="Diet Profile" subtitle="Tap to edit" onEdit={() => setEditSection("diet")}>
        <TappableRow label="Food Type" value={foodPrefLabels[profile.foodPreference]} onPress={() => setEditSection("diet")} />
        <TappableRow label="Restrictions" value={profile.dietaryRestrictions || "None"} onPress={() => setEditSection("diet")} />
        <TappableRow label="Dislikes" value={profile.dislikedFoods || "None"} onPress={() => setEditSection("diet")} />
        <TappableRow label="Medical Notes" value={profile.medicalNotes || "None"} onPress={() => setEditSection("diet")} />
      </SectionCard>

      <SectionCard title="Equipment" subtitle="Tap to edit" onEdit={() => setEditSection("equipment")}>
        <TouchableOpacity onPress={() => setEditSection("equipment")} activeOpacity={0.7}>
          <View style={styles.equipmentList}>
            {profile.equipment.map((eq) => (
              <View key={eq} style={[styles.equipTag, { backgroundColor: Colors.primary + "20" }]}>
                <Text style={[styles.equipTagText, { color: Colors.primary }]}>{eq.replace(/_/g, " ")}</Text>
              </View>
            ))}
            <View
              style={[
                styles.equipTag,
                {
                  backgroundColor: theme.card,
                  borderWidth: 1,
                  borderColor: theme.border,
                },
              ]}
            >
              <Ionicons name="pencil" size={10} color={Colors.primary} />
              <Text style={[styles.equipTagText, { color: Colors.primary }]}>Edit</Text>
            </View>
          </View>
        </TouchableOpacity>
      </SectionCard>

      <SectionCard title="Health Habits" subtitle="Tap to edit">
        <TappableRow label="Sleep" value={`${profile.sleepHours} hours/night`} onPress={() => setEditField("sleepHours")} />
        <TappableRow label="Water Goal" value={`${profile.waterIntakeLiters} L/day`} onPress={() => setEditField("waterIntakeLiters")} />
      </SectionCard>

      {/* Everything built on top of the core tabs lives here rather than
          crowding the bottom nav, which Material caps at five items. */}
      <SectionCard title="More" subtitle="Tools & tracking">
        <NavRow icon="library-outline" label="Training programmes" hint="Curated plans, free on every tier" onPress={() => router.push("/plans")} />
        <NavRow icon="navigate-outline" label="Record a run" hint="GPS tracking with splits" onPress={() => router.push("/run")} />
        <NavRow icon="water-outline" label="Hydration" hint="Track water and set a daily goal" onPress={() => router.push("/hydration")} />
        <NavRow icon="medkit-outline" label="Supplements & medication" hint="Reminders and training context" onPress={() => router.push("/supplements")} />
        <NavRow icon="videocam-outline" label="1-on-1 coaching" hint="Work with a real coach" onPress={() => router.push("/coaching")} />
        <NavRow icon="chatbubbles-outline" label="Ask your coach" hint="Training and nutrition questions" onPress={() => router.push("/coach")} />
        <NavRow icon="barcode-outline" label="Scan a barcode" hint="Look up packaged food" onPress={() => router.push("/scan")} />
        <NavRow icon="people-outline" label="Community" hint="Friends, feed and challenges" onPress={() => router.push("/social")} />
        <NavRow icon="trophy-outline" label="Achievements" hint="Level, streaks and badges" onPress={() => router.push("/achievements")} />
        <NavRow icon="location-outline" label="My places" hint="Start a session when you reach the gym" onPress={() => router.push("/places")} />
      </SectionCard>

      <SectionCard title="Health Data Sync" subtitle="Connect devices & apps">
        <View style={styles.healthSyncGrid}>
          {/* Only the card for THIS platform is shown. Offering an Apple Health
              toggle on Android (and vice versa) was always a dead control. */}
          {Platform.OS === "ios" && (
            <HealthSyncCard
              icon="logo-apple"
              label="Apple Health"
              connected={healthData?.syncStatus?.appleHealth ?? false}
              onToggle={() => {
                toggleSync("appleHealth");
                Haptics.selectionAsync();
              }}
              color={Colors.accentRed}
            />
          )}
          {Platform.OS === "android" && (
            <HealthSyncCard
              icon="fitness-outline"
              label="Health Connect"
              connected={healthData?.syncStatus?.googleFit ?? false}
              onToggle={() => {
                toggleSync("googleFit");
                Haptics.selectionAsync();
              }}
              color="#4285F4"
            />
          )}
          <HealthSyncCard
            icon="footsteps-outline"
            label="Step Counter"
            connected={healthData?.syncStatus?.stepsEnabled ?? false}
            onToggle={() => {
              toggleSync("stepsEnabled");
              Haptics.selectionAsync();
            }}
            color={Colors.accentGreen}
          />
          <HealthSyncCard
            icon="navigate-outline"
            label="GPS Tracking"
            connected={healthData?.syncStatus?.locationEnabled ?? false}
            onToggle={() => {
              toggleSync("locationEnabled");
              Haptics.selectionAsync();
            }}
            color={Colors.accent}
          />
        </View>

        {/* Tell the user WHY a source is unavailable instead of showing a
            switch that silently does nothing. */}
        {healthStatus?.platform?.requiresDevBuild && (
          <View style={[styles.healthNotice, { borderTopColor: theme.border }]}>
            <Ionicons name="information-circle-outline" size={16} color={theme.textMuted} />
            <Text style={[styles.healthNoticeText, { color: theme.textMuted }]}>
              {Platform.OS === "ios" ? "Apple Health" : "Health Connect"} needs the full app build. Step tracking works here; workouts, sleep and heart data need the installed app.
            </Text>
          </View>
        )}

        {healthStatus?.hasAnySource && (
          <View style={[styles.healthNotice, { borderTopColor: theme.border }]}>
            <Ionicons name="pulse-outline" size={16} color={Colors.accentGreen} />
            <Text style={[styles.healthNoticeText, { color: theme.textSecondary }]}>
              Reading from {backendName}
              {healthData?.lastSynced ? ` · updated ${new Date(healthData.lastSynced).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
            </Text>
            {isSyncing && <ActivityIndicator size="small" color={Colors.primary} />}
          </View>
        )}

        {!healthStatus?.hasAnySource && Platform.OS !== "web" && (
          <TouchableOpacity
            style={[styles.connectHealthBtn, { borderColor: Colors.primary }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              void connectHealth();
            }}
            activeOpacity={0.85}
          >
            <Ionicons name="link-outline" size={16} color={Colors.primary} />
            <Text style={[styles.connectHealthText, { color: Colors.primary }]}>Connect health data</Text>
          </TouchableOpacity>
        )}

        {(healthData?.todaySteps ?? 0) > 0 && (
          <View style={[styles.stepsRow, { borderTopColor: theme.border }]}>
            <Ionicons name="footsteps" size={18} color={Colors.accentGreen} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.stepsValue, { color: theme.text }]}>{healthData.todaySteps.toLocaleString()} steps today</Text>
              <Text style={[styles.stepsGoal, { color: theme.textSecondary }]}>Goal: 10,000 steps</Text>
            </View>
            <View style={[styles.stepsProgress, { backgroundColor: Colors.dark.card }]}>
              <View
                style={[
                  styles.stepsProgressFill,
                  {
                    width: `${Math.min(100, ((healthData?.todaySteps ?? 0) / 10000) * 100)}%`,
                    backgroundColor: Colors.accentGreen,
                  },
                ]}
              />
            </View>
          </View>
        )}

        {healthData?.runSessions?.length > 0 && (
          <View style={[styles.recentRunRow, { borderTopColor: theme.border }]}>
            <Ionicons name="walk-outline" size={18} color={Colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.runLabel, { color: theme.text }]}>Last Run</Text>
              <Text style={[styles.runMeta, { color: theme.textSecondary }]}>
                {healthData.runSessions[healthData.runSessions.length - 1].distanceKm} km · {healthData.runSessions[healthData.runSessions.length - 1].durationMins} min ·{" "}
                {healthData.runSessions[healthData.runSessions.length - 1].caloriesBurned} kcal
              </Text>
            </View>
          </View>
        )}

        {isTracking && currentRun && (
          <View
            style={[
              styles.activeRunBanner,
              {
                backgroundColor: Colors.accentGreen + "15",
                borderColor: Colors.accentGreen + "40",
              },
            ]}
          >
            <View style={[styles.runPulse, { backgroundColor: Colors.accentGreen }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.activeRunTitle, { color: Colors.accentGreen }]}>Run in Progress</Text>
              <Text style={[styles.activeRunMeta, { color: theme.text }]}>
                {currentRun.distanceKm.toFixed(2)} km · {currentRun.route.length} GPS points
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.stopRunBtn, { backgroundColor: Colors.accentRed }]}
              onPress={() => {
                const session = stopRunTracking();
                if (session) {
                  Alert.alert("Run Complete", `${session.distanceKm} km in ${session.durationMins} min\n${session.caloriesBurned} calories burned`);
                }
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="stop" size={14} color="#FFF" />
              <Text style={styles.stopRunBtnText}>Stop</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.healthActions}>
          {!isTracking && (
            <TouchableOpacity
              style={[
                styles.healthActionBtn,
                {
                  backgroundColor: Colors.accentGreen + "20",
                  borderColor: Colors.accentGreen + "40",
                },
              ]}
              onPress={() => {
                startRunTracking();
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                Alert.alert("Run Started", "GPS tracking is active. Go for your run! Come back here to stop and save.");
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="walk" size={16} color={Colors.accentGreen} />
              <Text style={[styles.healthActionText, { color: Colors.accentGreen }]}>Start Run</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[
              styles.healthActionBtn,
              {
                backgroundColor: Colors.primary + "20",
                borderColor: Colors.primary + "40",
              },
            ]}
            onPress={() => {
              syncHealthData();
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="sync" size={16} color={Colors.primary} />
            <Text style={[styles.healthActionText, { color: Colors.primary }]}>Sync Now</Text>
          </TouchableOpacity>
        </View>

        {healthData.lastSynced && <Text style={[styles.lastSynced, { color: theme.textMuted }]}>Last synced: {new Date(healthData.lastSynced).toLocaleString()}</Text>}
      </SectionCard>

      <SectionCard title="Subscription" subtitle={isTrialActive ? `Premium Trial · ${daysRemaining} days left` : isPremium ? "Premium" : "Free Plan"}>
        <View style={{ gap: 12 }}>
          <View
            style={[
              styles.planStatusRow,
              {
                backgroundColor: isPremium ? Colors.primary + "12" : theme.cardElevated,
              },
            ]}
          >
            <View
              style={[
                styles.planStatusIcon,
                {
                  backgroundColor: isPremium ? Colors.primary + "20" : theme.border,
                },
              ]}
            >
              <Ionicons name={isPremium ? "diamond" : "person-outline"} size={18} color={isPremium ? Colors.primary : theme.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.planStatusLabel, { color: theme.text }]}>{isTrialActive ? "Premium Trial" : isPremium ? "Premium" : "Free Plan"}</Text>
              {isTrialActive && trialEndDate && <Text style={[styles.planStatusSub, { color: theme.textSecondary }]}>Trial ends {trialEndDate}</Text>}
              {subState.status === "active" && subState.renewalDate && (
                <Text style={[styles.planStatusSub, { color: theme.textSecondary }]}>
                  Renews{" "}
                  {new Date(subState.renewalDate).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </Text>
              )}
            </View>
          </View>

          {isFree && (
            <TouchableOpacity
              style={[styles.loginBtn, { backgroundColor: Colors.primary }]}
              onPress={() => {
                router.push("/paywall");
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="diamond" size={18} color="#000" />
              <Text style={styles.loginBtnText}>Upgrade to Premium</Text>
            </TouchableOpacity>
          )}

          {!isFree && !isTrialActive && (
            <TouchableOpacity
              style={[styles.loginBtn, { backgroundColor: Colors.primary }]}
              onPress={() => {
                router.push("/paywall");
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="diamond" size={18} color="#000" />
              <Text style={styles.loginBtnText}>Manage Subscription</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            onPress={async () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              await restorePurchases();
              Alert.alert("Restore", "Purchase restore complete.");
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.planStatusSub, { color: Colors.primary, textAlign: "center" }]}>Restore Purchases</Text>
          </TouchableOpacity>
        </View>
      </SectionCard>

      <SectionCard title="Account" subtitle={isAuthenticated ? user?.email || "Signed in" : "Sign in to save your data"}>
        {isAuthenticated ? (
          <View style={{ gap: 10 }}>
            <View style={styles.accountUserRow}>
              {user?.profileImageUrl ? (
                <View style={[styles.accountAvatar, { backgroundColor: Colors.primary + "20" }]}>
                  <Text style={{ fontSize: 18 }}>{user.firstName?.[0] || "U"}</Text>
                </View>
              ) : (
                <View style={[styles.accountAvatar, { backgroundColor: Colors.primary + "20" }]}>
                  <Ionicons name="person" size={20} color={Colors.primary} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={[styles.accountName, { color: theme.text }]}>{[user?.firstName, user?.lastName].filter(Boolean).join(" ") || "User"}</Text>
                {user?.email && <Text style={[styles.accountEmail, { color: theme.textSecondary }]}>{user.email}</Text>}
              </View>
            </View>

            <View style={styles.accountActions}>
              <TouchableOpacity
                style={[
                  styles.accountActionBtn,
                  {
                    backgroundColor: Colors.accentGreen + "20",
                    borderColor: Colors.accentGreen + "40",
                  },
                ]}
                onPress={uploadData}
                disabled={syncing}
                activeOpacity={0.8}
              >
                <Ionicons name="cloud-upload-outline" size={16} color={Colors.accentGreen} />
                <Text style={[styles.accountActionText, { color: Colors.accentGreen }]}>{syncing ? "Syncing..." : "Backup"}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.accountActionBtn,
                  {
                    backgroundColor: Colors.primary + "20",
                    borderColor: Colors.primary + "40",
                  },
                ]}
                onPress={() => void downloadData()}
                disabled={syncing}
                activeOpacity={0.8}
              >
                <Ionicons name="cloud-download-outline" size={16} color={Colors.primary} />
                <Text style={[styles.accountActionText, { color: Colors.primary }]}>{syncing ? "Syncing..." : "Restore"}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.logoutBtn, { borderColor: Colors.accentRed + "40" }]}
              onPress={() => {
                Alert.alert("Sign Out", "Are you sure you want to sign out?", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Sign Out",
                    style: "destructive",
                    onPress: async () => {
                      const outcome = await logout();
                      if (outcome.status === "blocked") {
                        Alert.alert("Sign-out needs a retry", outcome.message);
                      }
                    },
                  },
                ]);
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="log-out-outline" size={16} color={Colors.accentRed} />
              <Text style={[styles.logoutBtnText, { color: Colors.accentRed }]}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.loginBtn, { backgroundColor: Colors.primary }]}
            onPress={() => {
              login();
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="log-in-outline" size={18} color="#000" />
            <Text style={styles.loginBtnText}>Sign In to Save Data</Text>
          </TouchableOpacity>
        )}
      </SectionCard>

      <SectionCard title="Settings">
        <NavRow
          icon="shield-checkmark-outline"
          label="Privacy & Data"
          hint="Privacy notice, export and account deletion"
          onPress={() => router.push("/privacy-data")}
        />
      </SectionCard>

      <TouchableOpacity
        style={[
          styles.actionBtn,
          {
            backgroundColor: Colors.primary + "20",
            borderColor: Colors.primary + "40",
          },
        ]}
        onPress={() => router.push("/onboarding")}
        activeOpacity={0.8}
      >
        <Ionicons name="create-outline" size={18} color={Colors.primary} />
        <Text style={[styles.actionBtnText, { color: Colors.primary }]}>Update Profile</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.actionBtn,
          {
            backgroundColor: Colors.accentRed + "15",
            borderColor: Colors.accentRed + "40",
          },
        ]}
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
        />
      )}

      <Modal visible={macroModalVisible} transparent animationType="fade" onRequestClose={() => setMacroModalVisible(false)}>
        <View style={styles.macroOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setMacroModalVisible(false)} />
          <View style={[styles.macroSheet, { backgroundColor: theme.surface }]}>
            <View style={styles.macroHandle} />
            <Text style={[styles.macroTitle, { color: theme.text }]}>Custom Macro Targets</Text>
            <Text style={[styles.macroSubtitle, { color: theme.textSecondary }]}>Override the calculated values with your own targets</Text>
            <MacroInput
              label="Calories"
              unit="kcal"
              value={macroForm.calories}
              onChange={(v) => setMacroForm((p) => ({ ...p, calories: v }))}
              theme={theme}
              color={Colors.accentYellow}
            />
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

      <FitnessEditModal
        visible={editSection === "fitness"}
        onClose={() => setEditSection(null)}
        profile={profile}
        updateProfileField={updateProfileField}
      />

      <DietEditModal
        visible={editSection === "diet"}
        onClose={() => setEditSection(null)}
        profile={profile}
        updateProfileField={updateProfileField}
      />

      <EquipmentEditModal
        visible={editSection === "equipment"}
        onClose={() => setEditSection(null)}
        profile={profile}
        updateProfileField={updateProfileField}
      />

      <NameGenderEditModal
        visible={editSection === "name"}
        onClose={() => setEditSection(null)}
        profile={profile}
        updateProfileField={updateProfileField}
      />
    </ScrollView>
  );
}

/**
 * Shared by the four profile edit sheets.
 *
 * These were all typed `: any`, which meant tsc could not check a single prop
 * and a removed one failed silently at runtime rather than at build time. That
 * is not hypothetical: an over-broad edit during this refactor stripped `theme`
 * from five of them and nothing complained.
 *
 * `theme` and `isDark` are deliberately absent. Every one of them took both and
 * drilled them down from the screen; they now read from useTheme directly.
 */
interface ProfileEditModalProps {
  visible: boolean;
  onClose: () => void;
  profile: UserProfile;
  updateProfileField: (key: keyof UserProfile, value: any) => void;
}

interface MacroInputProps {
  label: string;
  unit: string;
  value: string;
  onChange: (value: string) => void;
  theme: typeof Colors.dark;
  color: string;
}

function MacroInput({ label, unit, value, onChange, theme, color }: MacroInputProps) {
  return (
    <View style={styles.macroInputRow}>
      <View style={[styles.macroColorDot, { backgroundColor: color }]} />
      <Text style={[styles.macroInputLabel, { color: theme.textSecondary }]}>{label}</Text>
      <TextInput
        style={[
          styles.macroInputField,
          {
            backgroundColor: theme.card,
            borderColor: theme.border,
            color: theme.text,
          },
        ]}
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        selectTextOnFocus
      />
      <Text style={[styles.macroInputUnit, { color: theme.textMuted }]}>{unit}</Text>
    </View>
  );
}





function FitnessEditModal({ visible, onClose, profile, updateProfileField }: ProfileEditModalProps) {
  const { isDark, theme } = useTheme();
  const [goal, setGoal] = useState(profile.goal);
  const [level, setLevel] = useState(profile.fitnessLevel);
  const [activity, setActivity] = useState(profile.activityLevel);
  const [pref, setPref] = useState(profile.workoutPreference);

  React.useEffect(() => {
    if (visible) {
      setGoal(profile.goal);
      setLevel(profile.fitnessLevel);
      setActivity(profile.activityLevel);
      setPref(profile.workoutPreference);
    }
  }, [visible]);

  const handleSave = () => {
    updateProfileField("goal", goal);
    updateProfileField("fitnessLevel", level);
    updateProfileField("activityLevel", activity);
    updateProfileField("workoutPreference", pref);
    onClose();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <ModalSheet visible={visible} onClose={onClose} title="Edit Fitness Profile">
      <OptionPicker
        label="Primary Goal"
        options={(Object.entries(goalLabels) as [typeof goal, string][]).map(([value, label]) => ({
          value,
          label,
        }))}
        selected={goal}
        onSelect={setGoal}
      />
      <OptionPicker
        label="Fitness Level"
        options={(Object.entries(levelLabels) as [typeof level, string][]).map(([value, label]) => ({
          value,
          label,
        }))}
        selected={level}
        onSelect={setLevel}
      />
      <OptionPicker
        label="Activity Level"
        options={(Object.entries(activityLabels) as [typeof activity, string][]).map(([value, label]) => ({
          value,
          label,
        }))}
        selected={activity}
        onSelect={setActivity}
      />
      <OptionPicker
        label="Workout Preference"
        options={(Object.entries(prefLabels) as [typeof pref, string][]).map(([value, label]) => ({
          value,
          label,
        }))}
        selected={pref}
        onSelect={setPref}
      />
      <View style={styles.macroActions}>
        <TouchableOpacity style={[styles.macroCancelBtn, { borderColor: theme.border }]} onPress={onClose}>
          <Text style={[styles.macroCancelText, { color: theme.textSecondary }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.macroSaveBtn, { backgroundColor: Colors.primary }]} onPress={handleSave} activeOpacity={0.8}>
          <Text style={styles.macroSaveText}>Save</Text>
        </TouchableOpacity>
      </View>
    </ModalSheet>
  );
}

function DietEditModal({ visible, onClose, profile, updateProfileField }: ProfileEditModalProps) {
  const { isDark, theme } = useTheme();
  const [foodPref, setFoodPref] = useState(profile.foodPreference);
  const [restrictions, setRestrictions] = useState(profile.dietaryRestrictions || "");
  const [dislikes, setDislikes] = useState(profile.dislikedFoods || "");
  const [medicalNotes, setMedicalNotes] = useState(profile.medicalNotes || "");

  React.useEffect(() => {
    if (visible) {
      setFoodPref(profile.foodPreference);
      setRestrictions(profile.dietaryRestrictions || "");
      setDislikes(profile.dislikedFoods || "");
      setMedicalNotes(profile.medicalNotes || "");
    }
  }, [visible]);

  const handleSave = () => {
    updateProfileField("foodPreference", foodPref);
    updateProfileField("dietaryRestrictions", restrictions);
    updateProfileField("dislikedFoods", dislikes);
    updateProfileField("medicalNotes", medicalNotes);
    onClose();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <ModalSheet visible={visible} onClose={onClose} title="Edit Diet Profile">
      <OptionPicker
        label="Food Preference"
        options={(Object.entries(foodPrefLabels) as [typeof foodPref, string][]).map(([value, label]) => ({
          value,
          label,
        }))}
        selected={foodPref}
        onSelect={setFoodPref}
      />
      <View style={{ gap: 6 }}>
        <Text style={[styles.editSectionLabel, { color: theme.textSecondary }]}>Restrictions / Allergies</Text>
        <TextInput
          style={[
            styles.editTextInput,
            {
              backgroundColor: theme.card,
              borderColor: theme.border,
              color: theme.text,
            },
          ]}
          value={restrictions}
          onChangeText={setRestrictions}
          placeholder="e.g. gluten-free, nut allergy..."
          placeholderTextColor={theme.textMuted}
          multiline
        />
      </View>
      <View style={{ gap: 6 }}>
        <Text style={[styles.editSectionLabel, { color: theme.textSecondary }]}>Disliked Foods</Text>
        <TextInput
          style={[
            styles.editTextInput,
            {
              backgroundColor: theme.card,
              borderColor: theme.border,
              color: theme.text,
            },
          ]}
          value={dislikes}
          onChangeText={setDislikes}
          placeholder="e.g. broccoli, tofu..."
          placeholderTextColor={theme.textMuted}
          multiline
        />
      </View>
      <View style={{ gap: 6 }}>
        <Text style={[styles.editSectionLabel, { color: theme.textSecondary }]}>Medical Notes</Text>
        <TextInput
          style={[
            styles.editTextInput,
            {
              backgroundColor: theme.card,
              borderColor: theme.border,
              color: theme.text,
            },
          ]}
          value={medicalNotes}
          onChangeText={setMedicalNotes}
          placeholder="e.g. lower back pain..."
          placeholderTextColor={theme.textMuted}
          multiline
        />
      </View>
      <View style={styles.macroActions}>
        <TouchableOpacity style={[styles.macroCancelBtn, { borderColor: theme.border }]} onPress={onClose}>
          <Text style={[styles.macroCancelText, { color: theme.textSecondary }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.macroSaveBtn, { backgroundColor: Colors.primary }]} onPress={handleSave} activeOpacity={0.8}>
          <Text style={styles.macroSaveText}>Save</Text>
        </TouchableOpacity>
      </View>
    </ModalSheet>
  );
}

function EquipmentEditModal({ visible, onClose, profile, updateProfileField }: ProfileEditModalProps) {
  const { isDark, theme } = useTheme();
  const [selected, setSelected] = useState<Equipment[]>(profile.equipment || []);

  React.useEffect(() => {
    if (visible) {
      setSelected(profile.equipment || []);
    }
  }, [visible]);

  const toggle = (eq: Equipment) => {
    setSelected((prev) => (prev.includes(eq) ? prev.filter((e) => e !== eq) : [...prev, eq]));
    Haptics.selectionAsync();
  };

  const handleSave = () => {
    updateProfileField("equipment", selected);
    onClose();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <ModalSheet visible={visible} onClose={onClose} title="Edit Equipment">
      <View style={styles.optionGrid}>
        {allEquipment.map((eq) => {
          const active = selected.includes(eq.value);
          return (
            <TouchableOpacity
              key={eq.value}
              style={[
                styles.optionChip,
                {
                  backgroundColor: active ? Colors.primary + "20" : theme.card,
                  borderColor: active ? Colors.primary : theme.border,
                },
              ]}
              onPress={() => toggle(eq.value)}
              activeOpacity={0.8}
            >
              {active && <Ionicons name="checkmark-circle" size={14} color={Colors.primary} />}
              <Text style={[styles.optionChipText, { color: active ? Colors.primary : theme.text }]}>{eq.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={styles.macroActions}>
        <TouchableOpacity style={[styles.macroCancelBtn, { borderColor: theme.border }]} onPress={onClose}>
          <Text style={[styles.macroCancelText, { color: theme.textSecondary }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.macroSaveBtn, { backgroundColor: Colors.primary }]} onPress={handleSave} activeOpacity={0.8}>
          <Text style={styles.macroSaveText}>Save</Text>
        </TouchableOpacity>
      </View>
    </ModalSheet>
  );
}

function NameGenderEditModal({ visible, onClose, profile, updateProfileField }: ProfileEditModalProps) {
  const { isDark, theme } = useTheme();
  const [name, setName] = useState(profile.name || "");

  React.useEffect(() => {
    if (visible) {
      setName(profile.name || "");
    }
  }, [visible]);

  const handleSave = () => {
    if (name.trim()) updateProfileField("name", name.trim());
    onClose();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <ModalSheet visible={visible} onClose={onClose} title="Edit Name & Gender">
      <View style={{ gap: 6 }}>
        <Text style={[styles.editSectionLabel, { color: theme.textSecondary }]}>Name</Text>
        <TextInput
          style={[
            styles.editTextInput,
            {
              backgroundColor: theme.card,
              borderColor: theme.border,
              color: theme.text,
              height: 44,
            },
          ]}
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          placeholderTextColor={theme.textMuted}
        />
      </View>
      <OptionPicker
        label="Gender"
        options={[
          { label: "Male", value: "male" },
          { label: "Female", value: "female" },
          { label: "Other", value: "other" },
        ]}
        selected={profile.gender}
        onSelect={(v: string) => updateProfileField("gender", v)}
      />
      <View style={styles.macroActions}>
        <TouchableOpacity style={[styles.macroCancelBtn, { borderColor: theme.border }]} onPress={onClose}>
          <Text style={[styles.macroCancelText, { color: theme.textSecondary }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.macroSaveBtn, { backgroundColor: Colors.primary }]} onPress={handleSave} activeOpacity={0.8}>
          <Text style={styles.macroSaveText}>Save</Text>
        </TouchableOpacity>
      </View>
    </ModalSheet>
  );
}



interface HealthSyncCardProps {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  connected: boolean;
  onToggle: () => void;
  color: string;
}

function HealthSyncCard({ icon, label, connected, onToggle, color }: HealthSyncCardProps) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      style={[
        styles.healthCard,
        {
          backgroundColor: connected ? color + "15" : theme.card,
          borderColor: connected ? color + "40" : theme.border,
        },
      ]}
      onPress={onToggle}
      activeOpacity={0.7}
    >
      <Ionicons name={icon} size={22} color={connected ? color : theme.textMuted} />
      <Text style={[styles.healthCardLabel, { color: connected ? color : theme.textSecondary }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={[styles.healthCardStatus, { backgroundColor: connected ? color : theme.border }]}>
        <Text style={[styles.healthCardStatusText, { color: connected ? "#FFF" : theme.textMuted }]}>{connected ? "On" : "Off"}</Text>
      </View>
    </TouchableOpacity>
  );
}


const styles = StyleSheet.create({
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
    // Meets the 48dp minimum touch target.
    minHeight: 48,
  },
  navIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  navLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  navHint: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  healthNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderTopWidth: 1,
    paddingTop: 12,
    marginTop: 12,
  },
  healthNoticeText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
  connectHealthBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 12,
  },
  connectHealthText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  setupBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  setupBtnText: { color: "#000", fontSize: 15, fontFamily: "Inter_700Bold" },
  avatarSection: { alignItems: "center", gap: 8, paddingVertical: 8 },
  avatarLarge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: { fontSize: 32, fontFamily: "Inter_700Bold" },
  userName: { fontSize: 22, fontFamily: "Inter_700Bold" },
  goalBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.primary + "20",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
  },
  goalBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  statsCard: {
    flexDirection: "row",
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  statItem: { flex: 1, alignItems: "center", gap: 4 },
  statValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  statDivider: { width: 1, marginVertical: 4 },
  sectionCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 0 },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  sectionSubtitle: { fontSize: 11, fontFamily: "Inter_400Regular" },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  infoLabel: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  infoValue: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    textAlign: "right",
  },
  tappableRight: { flexDirection: "row", alignItems: "center" },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginRight: 8,
  },
  badgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  macroActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  macroEditBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  macroEditText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  macroResetBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  equipmentList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingTop: 4,
  },
  equipTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  equipTagText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textTransform: "capitalize",
  },
  settingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  settingLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  settingLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  actionBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  macroOverlay: {
    flex: 1,
    backgroundColor: "#00000060",
    justifyContent: "flex-end",
  },
  macroSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    gap: 14,
  },
  macroHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#444",
    alignSelf: "center",
  },
  macroTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  macroSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  macroInputRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  macroColorDot: { width: 10, height: 10, borderRadius: 5 },
  macroInputLabel: { fontSize: 14, fontFamily: "Inter_500Medium", width: 70 },
  macroInputField: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  macroInputUnit: { fontSize: 13, fontFamily: "Inter_400Regular", width: 30 },
  macroActions: { flexDirection: "row", gap: 12, marginTop: 4 },
  macroCancelBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  macroCancelText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  macroSaveBtn: {
    flex: 2,
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  macroSaveText: { color: "#000", fontSize: 15, fontFamily: "Inter_700Bold" },
  healthSyncGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingTop: 4,
  },
  healthCard: {
    width: "48%" as any,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    gap: 6,
  },
  healthCardLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  healthCardStatus: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  healthCardStatusText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  stepsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 12,
    marginTop: 8,
    borderTopWidth: 1,
  },
  stepsValue: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  stepsGoal: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  stepsProgress: { width: 60, height: 6, borderRadius: 3, overflow: "hidden" },
  stepsProgressFill: { height: "100%", borderRadius: 3 },
  recentRunRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 12,
    marginTop: 8,
    borderTopWidth: 1,
  },
  runLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  runMeta: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  activeRunBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    marginTop: 8,
  },
  runPulse: { width: 10, height: 10, borderRadius: 5 },
  activeRunTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  activeRunMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  stopRunBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  stopRunBtnText: { color: "#FFF", fontSize: 12, fontFamily: "Inter_700Bold" },
  healthActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  healthActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  healthActionText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  lastSynced: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 6,
  },
  accountUserRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  accountAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  accountName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  accountEmail: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  accountActions: { flexDirection: "row", gap: 8 },
  accountActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  accountActionText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  logoutBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  loginBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 14,
    borderRadius: 12,
  },
  loginBtnText: { color: "#000", fontSize: 15, fontFamily: "Inter_700Bold" },
  editSectionLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  optionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  optionChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  optionChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  editTextInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    minHeight: 60,
    textAlignVertical: "top",
  },
  planStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
  },
  planStatusIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  planStatusLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  planStatusSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
