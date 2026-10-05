import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

const mockWorkout = {
  sessions: [
    {
      id: "session-1",
      date: "2026-09-02",
      workoutDayId: "upper",
      workoutDayName: "Upper body",
      durationMins: 46,
      completed: true,
      exerciseLogs: [
        {
          exerciseId: "bench",
          exerciseName: "Bench press",
          date: "2026-09-02",
          sets: [
            {
              setNumber: 1,
              reps: 8,
              weightKg: 60,
              completed: true,
            },
          ],
        },
      ],
    },
  ],
  personalRecords: [],
  getWeeklyCompletion: () => 33,
  getActivePlanDays: () => [],
  plan: null,
};

const mockNutrition = {
  foodLog: [
    {
      id: "today-a",
      date: "2026-09-03",
      name: "Lunch",
      calories: 500,
      protein: 30,
      carbs: 50,
      fats: 12,
      mealType: "lunch",
      servingSize: "1 serving",
      timestamp: "2026-09-03T12:00:00.000Z",
    },
    {
      id: "today-b",
      date: "2026-09-03",
      name: "Snack",
      calories: 260,
      protein: 12,
      carbs: 14,
      fats: 6,
      mealType: "snack",
      servingSize: "1 serving",
      timestamp: "2026-09-03T15:00:00.000Z",
    },
  ],
  getWeeklyCalories: () => [
    { date: "2026-08-28", calories: 1_800 },
    { date: "2026-08-29", calories: 1_900 },
    { date: "2026-08-30", calories: 0 },
    { date: "2026-08-31", calories: 2_050 },
    { date: "2026-09-01", calories: 1_950 },
    { date: "2026-09-02", calories: 2_000 },
    { date: "2026-09-03", calories: 760 },
  ],
  getTodayTotals: () => ({
    calories: 760,
    protein: 42,
    carbs: 64,
    fats: 18,
  }),
};

const mockApp = {
  state: {
    profile: {
      weightKg: 70,
      heightCm: 175,
      goal: "strength",
    },
    healthMetrics: [
      { date: "2026-09-01", weightKg: 70.4 },
      { date: "2026-09-03", weightKg: 70 },
    ],
  },
  calculateMacros: () => ({
    calories: 2_030,
    protein: 150,
    carbs: 200,
    fats: 70,
  }),
};

const mockHealth = {
  healthData: {
    sleep: [{ date: "2026-09-03", asleepMins: 450, inBedMins: 480 }],
    restingHeartRate: [{ date: "2026-09-03", value: 58 }],
    heartRateVariability: [{ date: "2026-09-03", value: 42 }],
    bodyMassKg: [],
  },
  status: { hasAnySource: true, platform: { authorized: true } },
  backendName: "Apple Health",
};

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-haptics", () => ({ selectionAsync: jest.fn() }));
jest.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({
    isDark: true,
    theme: {
      background: "#000",
      card: "#111",
      surface: "#181818",
      border: "#333",
      text: "#fff",
      textSecondary: "#bbb",
      textMuted: "#888",
    },
  }),
}));
jest.mock("@/context/WorkoutContext", () => ({
  useWorkout: () => mockWorkout,
}));
jest.mock("@/context/NutritionContext", () => ({
  useNutrition: () => mockNutrition,
}));
jest.mock("@/context/AppContext", () => ({ useApp: () => mockApp }));
jest.mock("@/context/HealthContext", () => ({ useHealth: () => mockHealth }));
jest.mock("@/components/PremiumLock", () => ({
  PremiumLock: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/components/MacroBar", () => ({
  MacroBar: ({
    label,
    current,
    target,
  }: {
    label: string;
    current: number;
    target: number;
  }) => {
    const { Text: NativeText } = require("react-native");
    return (
      <NativeText
        accessibilityLabel={`${label}: ${current} of ${target} grams`}
      >
        {label}: {current}/{target}g
      </NativeText>
    );
  },
}));

import ProgressScreen from "../app/(tabs)/progress";

describe("progress dashboard", () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-03T12:00:00+05:30"));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    mockHealth.status = {
      hasAnySource: true,
      platform: { authorized: true },
    };
    mockHealth.backendName = "Apple Health";
  });

  it("exposes the section selector as accessible tabs with selected state", async () => {
    const screen = await render(<ProgressScreen />);

    expect(
      screen.getByRole("tab", { name: "Strength" }).props.accessibilityState,
    ).toEqual(expect.objectContaining({ selected: true }));

    const nutritionTab = screen.getByRole("tab", { name: "Nutrition" });
    await fireEvent.press(nutritionTab);

    expect(
      screen.getByRole("tab", { name: "Strength" }).props.accessibilityState,
    ).toEqual(expect.objectContaining({ selected: false }));
    expect(
      screen.getByRole("tab", { name: "Nutrition" }).props.accessibilityState,
    ).toEqual(expect.objectContaining({ selected: true }));
  });

  it("keeps recent workouts visible when the user has not earned a PR yet", async () => {
    const screen = await render(<ProgressScreen />);

    expect(screen.getByText("Recent Workouts")).toBeTruthy();
    expect(screen.getByText("Upper body")).toBeTruthy();
    expect(screen.getAllByText(/46 min/).length).toBeGreaterThan(0);
  });

  it("shows today's consumed macros against targets instead of fake full bars", async () => {
    const screen = await render(<ProgressScreen />);
    await fireEvent.press(screen.getByText("Nutrition"));

    expect(screen.getByLabelText("Protein: 42 of 150 grams")).toBeTruthy();
    expect(screen.getByLabelText("Carbs: 64 of 200 grams")).toBeTruthy();
    expect(screen.getByLabelText("Fats: 18 of 70 grams")).toBeTruthy();
    expect(screen.getByText("760 / 2,030 kcal today")).toBeTruthy();
  });

  it("renders recorded recovery signals instead of a generic health placeholder", async () => {
    const screen = await render(<ProgressScreen />);
    await fireEvent.press(screen.getByText("Body"));

    expect(screen.getByText("Latest recovery signals")).toBeTruthy();
    expect(screen.getByText("7h 30m")).toBeTruthy();
    expect(screen.getByText("58 bpm")).toBeTruthy();
    expect(screen.getByText("42 ms")).toBeTruthy();
  });

  it("does not describe step-only pedometer access as a connected recovery source", async () => {
    mockHealth.status = {
      hasAnySource: true,
      platform: { authorized: false },
    };
    mockHealth.backendName = "Pedometer";
    const screen = await render(<ProgressScreen />);
    await fireEvent.press(screen.getByText("Body"));

    expect(screen.getByText("No health source connected")).toBeTruthy();
    expect(screen.queryByText("Connected to Pedometer")).toBeNull();
  });
});
