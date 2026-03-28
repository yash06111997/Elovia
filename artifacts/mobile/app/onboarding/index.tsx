import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Platform,
  useColorScheme,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useApp, UserProfile, FitnessGoal, FitnessLevel, ActivityLevel, WorkoutPreference, FoodPreference, Equipment, DietType } from "@/context/AppContext";
import { useWorkout } from "@/context/WorkoutContext";
import { useNutrition } from "@/context/NutritionContext";
import { useAuth } from "@/lib/auth";
import { generateWorkoutPlan, generateMealPlan } from "@/utils/aiEngine";
import { Colors } from "@/constants/colors";

const TOTAL_STEPS = 7;

export default function OnboardingScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { setProfile, completeOnboarding } = useApp();
  const { setPlan } = useWorkout();
  const { setMealPlan } = useNutrition();
  const { isAuthenticated, login, user } = useAuth();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState<Partial<UserProfile>>({
    name: "",
    age: 25,
    gender: "male",
    heightCm: 170,
    weightKg: 70,
    targetWeightKg: 70,
    targetWeeks: 12,
    goal: "general_fitness",
    fitnessLevel: "beginner",
    activityLevel: "moderately_active",
    workoutPreference: "gym",
    workoutDaysPerWeek: 3,
    workoutDurationMins: 45,
    equipment: ["dumbbells"],
    customEquipment: "",
    foodPreference: "non_vegetarian",
    dietType: "balanced",
    favoriteFoods: "",
    dietaryRestrictions: "",
    dislikedFoods: "",
    mealSuggestions: "",
    medicalNotes: "",
    sleepHours: 7,
    waterIntakeLiters: 2,
  });

  const update = (key: keyof UserProfile, value: any) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const toggleEquipment = (eq: Equipment) => {
    const current = form.equipment ?? [];
    if (current.includes(eq)) {
      update("equipment", current.filter((e) => e !== eq));
    } else {
      update("equipment", [...current, eq]);
    }
    Haptics.selectionAsync();
  };

  const next = () => {
    if (step < TOTAL_STEPS - 1) {
      setStep(step + 1);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      handleFinish();
    }
  };

  const handleFinish = async () => {
    setLoading(true);
    const profile = form as UserProfile;
    setProfile(profile);
    const workoutPlan = generateWorkoutPlan(profile);
    const mealPlan = generateMealPlan(profile);
    setPlan(workoutPlan);
    setMealPlan(mealPlan);
    completeOnboarding();
    router.replace("/(tabs)");
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return <StepWelcome isAuthenticated={isAuthenticated} login={login} user={user} isDark={isDark} theme={theme} />;
      case 1:
        return <StepPersonal form={form} update={update} isDark={isDark} theme={theme} />;
      case 2:
        return <StepGoal form={form} update={update} isDark={isDark} theme={theme} />;
      case 3:
        return <StepWorkout form={form} update={update} isDark={isDark} theme={theme} />;
      case 4:
        return <StepEquipment form={form} toggleEquipment={toggleEquipment} isDark={isDark} theme={theme} />;
      case 5:
        return <StepDiet form={form} update={update} isDark={isDark} theme={theme} />;
      case 6:
        return <StepHealth form={form} update={update} isDark={isDark} theme={theme} />;
      default:
        return null;
    }
  };

  const stepTitles = [
    "Welcome",
    "About You",
    "Your Goals",
    "Workout Preferences",
    "Available Equipment",
    "Diet & Nutrition",
    "Health Habits",
  ];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + 16 }]}>
        {step > 0 ? (
          <TouchableOpacity onPress={() => setStep(step - 1)}>
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </TouchableOpacity>
        ) : <View style={{ width: 22 }} />}
        <View style={styles.progressDots}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i <= step ? { backgroundColor: Colors.primary, width: i === step ? 20 : 8 } : { backgroundColor: theme.border },
              ]}
            />
          ))}
        </View>
        <Text style={[styles.stepCount, { color: theme.textSecondary }]}>
          {step + 1}/{TOTAL_STEPS}
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.stepTitle, { color: theme.text }]}>{stepTitles[step]}</Text>
        {renderStep()}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16, borderTopColor: theme.border }]}>
        <TouchableOpacity
          style={[styles.nextBtn, loading && { opacity: 0.7 }]}
          onPress={next}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <Text style={styles.nextBtnText}>Building your plan...</Text>
          ) : (
            <>
              <Text style={styles.nextBtnText}>
                {step === TOTAL_STEPS - 1 ? "Create My Plan" : "Continue"}
              </Text>
              <Ionicons name="arrow-forward" size={18} color="#000" />
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function StepWelcome({ isAuthenticated, login, user, isDark, theme }: any) {
  return (
    <View style={styles.stepContent}>
      <View style={styles.welcomeIconWrap}>
        <View style={[styles.welcomeIconCircle, { backgroundColor: Colors.primary + "20" }]}>
          <Ionicons name="fitness" size={48} color={Colors.primary} />
        </View>
      </View>

      <Text style={[styles.welcomeHeadline, { color: theme.text }]}>
        Your AI-Powered{"\n"}Fitness Companion
      </Text>
      <Text style={[styles.welcomeSubtext, { color: theme.textSecondary }]}>
        Personalized workouts, meal plans, and health tracking — all in one place.
      </Text>

      <View style={[styles.welcomeCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <View style={styles.welcomeFeature}>
          <Ionicons name="barbell-outline" size={20} color={Colors.primary} />
          <Text style={[styles.welcomeFeatureText, { color: theme.text }]}>Custom workout plans</Text>
        </View>
        <View style={styles.welcomeFeature}>
          <Ionicons name="nutrition-outline" size={20} color={Colors.accentGreen} />
          <Text style={[styles.welcomeFeatureText, { color: theme.text }]}>AI meal planning</Text>
        </View>
        <View style={styles.welcomeFeature}>
          <Ionicons name="analytics-outline" size={20} color={Colors.accent} />
          <Text style={[styles.welcomeFeatureText, { color: theme.text }]}>Progress tracking</Text>
        </View>
      </View>

      {isAuthenticated ? (
        <View style={[styles.signedInCard, { backgroundColor: Colors.accentGreen + "15", borderColor: Colors.accentGreen + "40" }]}>
          <Ionicons name="checkmark-circle" size={22} color={Colors.accentGreen} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.signedInTitle, { color: Colors.accentGreen }]}>Signed In</Text>
            <Text style={[styles.signedInEmail, { color: theme.textSecondary }]}>
              {user?.email || "Your data will be saved to your account"}
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.welcomeAuthSection}>
          <TouchableOpacity
            style={[styles.googleSignInBtn, { backgroundColor: theme.card, borderColor: theme.border }]}
            onPress={() => { login(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
            activeOpacity={0.8}
          >
            <Ionicons name="logo-google" size={20} color="#4285F4" />
            <Text style={[styles.googleSignInText, { color: theme.text }]}>Sign in with Google</Text>
          </TouchableOpacity>
          <Text style={[styles.skipAuthText, { color: theme.textMuted }]}>
            Optional — you can sign in later from your Profile
          </Text>
        </View>
      )}
    </View>
  );
}

function StepPersonal({ form, update, isDark, theme }: any) {
  return (
    <View style={styles.stepContent}>
      <LabelInput
        label="Full Name"
        value={form.name}
        onChangeText={(v: string) => update("name", v)}
        placeholder="Your name"
        theme={theme}
      />
      <NumberStepper label="Age" value={form.age} min={10} max={90} step={1} onChange={(v: number) => update("age", v)} theme={theme} />
      <View style={styles.field}>
        <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Gender</Text>
        <ChipRow
          options={[
            { label: "Male", value: "male" },
            { label: "Female", value: "female" },
            { label: "Other", value: "other" },
          ]}
          selected={form.gender}
          onSelect={(v: string) => update("gender", v)}
          theme={theme}
        />
      </View>
      <NumberStepper label="Height (cm)" value={form.heightCm} min={100} max={250} step={1} onChange={(v: number) => update("heightCm", v)} theme={theme} />
      <NumberStepper label="Weight (kg)" value={form.weightKg} min={30} max={250} step={0.5} onChange={(v: number) => update("weightKg", v)} theme={theme} />
      <NumberStepper label="Target Weight (kg)" value={form.targetWeightKg} min={30} max={250} step={0.5} onChange={(v: number) => update("targetWeightKg", v)} theme={theme} />
    </View>
  );
}

function StepGoal({ form, update, isDark, theme }: any) {
  const goals: { label: string; value: FitnessGoal; icon: string; desc: string }[] = [
    { label: "Fat Loss", value: "fat_loss", icon: "flame-outline", desc: "Burn fat, get lean" },
    { label: "Muscle Gain", value: "muscle_gain", icon: "barbell-outline", desc: "Build size and strength" },
    { label: "Strength", value: "strength", icon: "trophy-outline", desc: "Maximize raw strength" },
    { label: "Endurance", value: "endurance", icon: "walk-outline", desc: "Cardio & stamina" },
    { label: "Maintenance", value: "maintenance", icon: "repeat-outline", desc: "Maintain current physique" },
    { label: "General Fitness", value: "general_fitness", icon: "heart-outline", desc: "Overall health" },
  ];
  const levels: { label: string; value: FitnessLevel; desc: string }[] = [
    { label: "Beginner", value: "beginner", desc: "Less than 1 year" },
    { label: "Intermediate", value: "intermediate", desc: "1–3 years" },
    { label: "Advanced", value: "advanced", desc: "3+ years" },
  ];
  const activity: { label: string; value: ActivityLevel }[] = [
    { label: "Sedentary", value: "sedentary" },
    { label: "Lightly Active", value: "lightly_active" },
    { label: "Moderately Active", value: "moderately_active" },
    { label: "Very Active", value: "very_active" },
    { label: "Extra Active", value: "extra_active" },
  ];

  const weightDelta = (form.targetWeightKg || form.weightKg || 70) - (form.weightKg || 70);
  const weeks = form.targetWeeks || 12;
  const dailyAdjust = weightDelta !== 0 ? Math.round((weightDelta * 7700) / (weeks * 7)) : 0;
  const cappedAdjust = Math.max(-1000, Math.min(1000, dailyAdjust));
  const weeklyRateKg = Math.abs(weightDelta) / weeks;

  return (
    <View style={styles.stepContent}>
      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Primary Goal</Text>
      {goals.map((g) => (
        <TouchableOpacity
          key={g.value}
          style={[styles.goalCard, { backgroundColor: theme.card, borderColor: form.goal === g.value ? Colors.primary : theme.border }]}
          onPress={() => { update("goal", g.value); Haptics.selectionAsync(); }}
          activeOpacity={0.8}
        >
          <View style={[styles.goalIcon, { backgroundColor: Colors.primary + (form.goal === g.value ? "30" : "15") }]}>
            <Ionicons name={g.icon as any} size={20} color={Colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.goalLabel, { color: theme.text }]}>{g.label}</Text>
            <Text style={[styles.goalDesc, { color: theme.textSecondary }]}>{g.desc}</Text>
          </View>
          {form.goal === g.value && <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />}
        </TouchableOpacity>
      ))}

      {weightDelta !== 0 && (
        <>
          <Text style={[styles.sectionLabel, { color: theme.textSecondary, marginTop: 16 }]}>Goal Timeline</Text>
          <NumberStepper label="Target Weeks" value={form.targetWeeks ?? 12} min={4} max={52} step={1} onChange={(v: number) => update("targetWeeks", v)} theme={theme} />
          <View style={[styles.timelineInfo, { backgroundColor: Colors.primary + "10", borderColor: Colors.primary + "30" }]}>
            <Ionicons name="analytics-outline" size={18} color={Colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.timelineText, { color: theme.text }]}>
                {weightDelta > 0 ? "Gain" : "Lose"} {Math.abs(weightDelta).toFixed(1)} kg in {weeks} weeks
              </Text>
              <Text style={[styles.timelineDetail, { color: theme.textSecondary }]}>
                {weeklyRateKg.toFixed(2)} kg/week • {cappedAdjust > 0 ? "+" : ""}{cappedAdjust} kcal/day {Math.abs(dailyAdjust) > 1000 ? "(capped)" : ""}
              </Text>
            </View>
          </View>
        </>
      )}

      <Text style={[styles.sectionLabel, { color: theme.textSecondary, marginTop: 16 }]}>Fitness Level</Text>
      <ChipRow options={levels.map((l) => ({ label: l.label, value: l.value }))} selected={form.fitnessLevel} onSelect={(v: string) => update("fitnessLevel", v)} theme={theme} />
      <Text style={[styles.sectionLabel, { color: theme.textSecondary, marginTop: 16 }]}>Daily Activity Level</Text>
      <ChipRow options={activity.map((a) => ({ label: a.label, value: a.value }))} selected={form.activityLevel} onSelect={(v: string) => update("activityLevel", v)} theme={theme} wrap />
    </View>
  );
}

function StepWorkout({ form, update, isDark, theme }: any) {
  return (
    <View style={styles.stepContent}>
      <View style={styles.field}>
        <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Workout Location</Text>
        <ChipRow
          options={[
            { label: "Gym", value: "gym" },
            { label: "Home", value: "home" },
            { label: "Mixed", value: "mixed" },
          ]}
          selected={form.workoutPreference}
          onSelect={(v: string) => update("workoutPreference", v)}
          theme={theme}
        />
      </View>
      <NumberStepper label="Days per week" value={form.workoutDaysPerWeek} min={1} max={7} step={1} onChange={(v: number) => update("workoutDaysPerWeek", v)} theme={theme} />
      <NumberStepper label="Session duration (min)" value={form.workoutDurationMins} min={15} max={120} step={15} onChange={(v: number) => update("workoutDurationMins", v)} theme={theme} />
    </View>
  );
}

function StepEquipment({ form, toggleEquipment, isDark, theme }: any) {
  const items: { label: string; value: Equipment; icon: string }[] = [
    { label: "Dumbbells", value: "dumbbells", icon: "barbell-outline" },
    { label: "Barbell", value: "barbell", icon: "barbell-outline" },
    { label: "Bench", value: "bench", icon: "bed-outline" },
    { label: "Resistance Bands", value: "resistance_bands", icon: "infinite-outline" },
    { label: "Pull-Up Bar", value: "pull_up_bar", icon: "fitness-outline" },
    { label: "Cable Machine", value: "cable_machine", icon: "options-outline" },
    { label: "Treadmill", value: "treadmill", icon: "walk-outline" },
    { label: "Cycle", value: "cycle", icon: "bicycle-outline" },
    { label: "Kettlebells", value: "kettlebells", icon: "ellipse-outline" },
    { label: "Squat Rack", value: "squat_rack", icon: "cube-outline" },
    { label: "Smith Machine", value: "smith_machine", icon: "grid-outline" },
    { label: "No Equipment", value: "no_equipment", icon: "body-outline" },
  ];
  const selected: Equipment[] = form.equipment ?? [];
  return (
    <View style={styles.stepContent}>
      <Text style={[styles.hint, { color: theme.textSecondary }]}>Select all equipment you have access to.</Text>
      <View style={styles.equipmentGrid}>
        {items.map((item) => {
          const active = selected.includes(item.value);
          return (
            <TouchableOpacity
              key={item.value}
              style={[styles.equipBtn, { backgroundColor: active ? Colors.primary + "20" : theme.card, borderColor: active ? Colors.primary : theme.border }]}
              onPress={() => toggleEquipment(item.value)}
              activeOpacity={0.8}
            >
              <Ionicons name={item.icon as any} size={18} color={active ? Colors.primary : theme.textSecondary} />
              <Text style={[styles.equipLabel, { color: active ? Colors.primary : theme.text }]}>{item.label}</Text>
              {active && <Ionicons name="checkmark-circle" size={14} color={Colors.primary} style={{ position: "absolute", top: 6, right: 6 }} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function StepDiet({ form, update, isDark, theme }: any) {
  const prefs: { label: string; value: FoodPreference; icon: string; desc: string }[] = [
    { label: "Non-Vegetarian", value: "non_vegetarian", icon: "nutrition-outline", desc: "Meat, eggs, dairy" },
    { label: "Vegetarian", value: "vegetarian", icon: "leaf-outline", desc: "No meat or fish" },
    { label: "Eggetarian", value: "eggetarian", icon: "egg-outline", desc: "Vegetarian + eggs" },
    { label: "Vegan", value: "vegan", icon: "flower-outline", desc: "No animal products" },
  ];
  const dietTypes: { label: string; value: DietType; icon: string }[] = [
    { label: "Balanced", value: "balanced", icon: "pie-chart-outline" },
    { label: "Keto", value: "keto", icon: "flame-outline" },
    { label: "Low Carb", value: "low_carb", icon: "trending-down-outline" },
    { label: "High Protein", value: "high_protein", icon: "barbell-outline" },
    { label: "Mediterranean", value: "mediterranean", icon: "fish-outline" },
    { label: "Paleo", value: "paleo", icon: "leaf-outline" },
  ];
  return (
    <View style={styles.stepContent}>
      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Food Preference</Text>
      {prefs.map((p) => (
        <TouchableOpacity
          key={p.value}
          style={[styles.goalCard, { backgroundColor: theme.card, borderColor: form.foodPreference === p.value ? "#00E676" : theme.border }]}
          onPress={() => { update("foodPreference", p.value); Haptics.selectionAsync(); }}
          activeOpacity={0.8}
        >
          <View style={[styles.goalIcon, { backgroundColor: "#00E676" + (form.foodPreference === p.value ? "30" : "15") }]}>
            <Ionicons name={p.icon as any} size={20} color="#00E676" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.goalLabel, { color: theme.text }]}>{p.label}</Text>
            <Text style={[styles.goalDesc, { color: theme.textSecondary }]}>{p.desc}</Text>
          </View>
          {form.foodPreference === p.value && <Ionicons name="checkmark-circle" size={20} color="#00E676" />}
        </TouchableOpacity>
      ))}

      <Text style={[styles.sectionLabel, { color: theme.textSecondary, marginTop: 16 }]}>Diet Type</Text>
      <View style={styles.dietTypeGrid}>
        {dietTypes.map((dt) => {
          const active = form.dietType === dt.value;
          return (
            <TouchableOpacity
              key={dt.value}
              style={[styles.dietTypeBtn, { backgroundColor: active ? Colors.primary + "20" : theme.card, borderColor: active ? Colors.primary : theme.border }]}
              onPress={() => { update("dietType", dt.value); Haptics.selectionAsync(); }}
              activeOpacity={0.8}
            >
              <Ionicons name={dt.icon as any} size={16} color={active ? Colors.primary : theme.textSecondary} />
              <Text style={[styles.dietTypeLabel, { color: active ? Colors.primary : theme.text }]}>{dt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <LabelInput label="Favorite foods" value={form.favoriteFoods} onChangeText={(v: string) => update("favoriteFoods", v)} placeholder="e.g. chicken, rice, eggs, salmon..." theme={theme} multiline />
      <LabelInput label="Dietary restrictions / allergies" value={form.dietaryRestrictions} onChangeText={(v: string) => update("dietaryRestrictions", v)} placeholder="e.g. gluten-free, nut allergy..." theme={theme} multiline />
      <LabelInput label="Foods you dislike" value={form.dislikedFoods} onChangeText={(v: string) => update("dislikedFoods", v)} placeholder="e.g. broccoli, tofu..." theme={theme} multiline />
      <LabelInput label="Any meal plan suggestions?" value={form.mealSuggestions} onChangeText={(v: string) => update("mealSuggestions", v)} placeholder="e.g. prefer easy recipes, meal prep friendly..." theme={theme} multiline />
    </View>
  );
}

function StepHealth({ form, update, isDark, theme }: any) {
  return (
    <View style={styles.stepContent}>
      <NumberStepper label="Sleep hours per night" value={form.sleepHours} min={3} max={12} step={0.5} onChange={(v: number) => update("sleepHours", v)} theme={theme} />
      <NumberStepper label="Daily water intake (liters)" value={form.waterIntakeLiters} min={0.5} max={6} step={0.25} onChange={(v: number) => update("waterIntakeLiters", v)} theme={theme} />
      <LabelInput label="Medical issues / injuries (optional)" value={form.medicalNotes} onChangeText={(v: string) => update("medicalNotes", v)} placeholder="e.g. lower back pain, knee injury..." theme={theme} multiline />
    </View>
  );
}

function LabelInput({ label, value, onChangeText, placeholder, theme, multiline }: any) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>{label}</Text>
      <TextInput
        style={[styles.input, { backgroundColor: theme.card, color: theme.text, borderColor: theme.border, ...(multiline && { height: 80, textAlignVertical: "top" }) }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        multiline={multiline}
      />
    </View>
  );
}

function NumberStepper({ label, value, min, max, step, onChange, theme }: any) {
  const [editing, setEditing] = useState(false);
  const [textVal, setTextVal] = useState(String(value));

  const handleEndEditing = () => {
    setEditing(false);
    const parsed = parseFloat(textVal);
    if (!isNaN(parsed)) {
      const clamped = Math.max(min, Math.min(max, +(parsed).toFixed(2)));
      onChange(clamped);
      setTextVal(String(clamped));
    } else {
      setTextVal(String(value));
    }
  };

  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>{label}</Text>
      <View style={styles.stepper}>
        <TouchableOpacity
          style={[styles.stepBtn, { backgroundColor: theme.card, borderColor: theme.border }]}
          onPress={() => { const v = Math.max(min, +(value - step).toFixed(2)); onChange(v); setTextVal(String(v)); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        >
          <Ionicons name="remove" size={18} color={theme.text} />
        </TouchableOpacity>
        {editing ? (
          <TextInput
            style={[styles.stepValueInput, { backgroundColor: theme.card, borderColor: Colors.primary, color: theme.text }]}
            value={textVal}
            onChangeText={setTextVal}
            onBlur={handleEndEditing}
            onSubmitEditing={handleEndEditing}
            keyboardType="decimal-pad"
            selectTextOnFocus
            autoFocus
          />
        ) : (
          <TouchableOpacity
            style={[styles.stepValue, { backgroundColor: theme.card, borderColor: theme.border }]}
            onPress={() => { setTextVal(String(value)); setEditing(true); }}
            activeOpacity={0.7}
          >
            <Text style={[styles.stepValueText, { color: theme.text }]}>{value}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.stepBtn, { backgroundColor: theme.card, borderColor: theme.border }]}
          onPress={() => { const v = Math.min(max, +(value + step).toFixed(2)); onChange(v); setTextVal(String(v)); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        >
          <Ionicons name="add" size={18} color={theme.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ChipRow({ options, selected, onSelect, theme, wrap }: any) {
  return (
    <View style={[styles.chipRow, wrap && { flexWrap: "wrap" }]}>
      {options.map((opt: any) => (
        <TouchableOpacity
          key={opt.value}
          style={[styles.chip, { backgroundColor: selected === opt.value ? Colors.primary : theme.card, borderColor: selected === opt.value ? Colors.primary : theme.border }]}
          onPress={() => { onSelect(opt.value); Haptics.selectionAsync(); }}
          activeOpacity={0.8}
        >
          <Text style={[styles.chipText, { color: selected === opt.value ? "#000" : theme.text }]}>{opt.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 16 },
  progressDots: { flexDirection: "row", gap: 5, alignItems: "center" },
  dot: { height: 8, borderRadius: 4, transition: "all 0.2s" as any },
  stepCount: { fontSize: 12, fontFamily: "Inter_500Medium" },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8 },
  stepTitle: { fontSize: 26, fontFamily: "Inter_700Bold", marginBottom: 20 },
  stepContent: { gap: 16 },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  hint: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  field: { gap: 8 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 15, fontFamily: "Inter_400Regular" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepBtn: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  stepValue: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  stepValueText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  stepValueInput: { flex: 1, height: 44, borderRadius: 12, borderWidth: 2, textAlign: "center", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  chipRow: { flexDirection: "row", gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  goalCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  goalIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  goalLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  goalDesc: { fontSize: 12, fontFamily: "Inter_400Regular" },
  equipmentGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  equipBtn: { width: "47%", padding: 14, borderRadius: 12, borderWidth: 1, alignItems: "center", gap: 8 },
  equipLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center" },
  timelineInfo: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, borderWidth: 1 },
  timelineText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  timelineDetail: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  dietTypeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dietTypeBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  dietTypeLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
  nextBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: Colors.primary, borderRadius: 14, padding: 16, gap: 8 },
  nextBtnText: { color: "#000", fontSize: 16, fontFamily: "Inter_700Bold" },
  welcomeIconWrap: { alignItems: "center", marginTop: 20, marginBottom: 16 },
  welcomeIconCircle: { width: 100, height: 100, borderRadius: 50, alignItems: "center", justifyContent: "center" },
  welcomeHeadline: { fontSize: 28, fontFamily: "Inter_700Bold", textAlign: "center", lineHeight: 36 },
  welcomeSubtext: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22, paddingHorizontal: 10 },
  welcomeCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 14, marginTop: 8 },
  welcomeFeature: { flexDirection: "row", alignItems: "center", gap: 12 },
  welcomeFeatureText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  welcomeAuthSection: { gap: 10, marginTop: 8 },
  googleSignInBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, padding: 16, borderRadius: 14, borderWidth: 1 },
  googleSignInText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  skipAuthText: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
  signedInCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, marginTop: 8 },
  signedInTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  signedInEmail: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
});
