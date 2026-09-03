import React from "react";
import { render } from "@testing-library/react-native";

const mockTrackerState = {
  status: "recording" as const,
  stats: {
    distanceKm: 5.12,
    durationSec: 1_500,
    currentPaceMinPerKm: 4.88,
    avgPaceMinPerKm: 4.9,
    elevationGainM: 42,
    calories: 320,
    splits: [],
    points: [
      { latitude: 28.6139, longitude: 77.209 },
      { latitude: 28.6149, longitude: 77.21 },
      { latitude: 28.6159, longitude: 77.211 },
    ],
  },
  autoPaused: false,
  gpsAccuracy: 6,
  trackingMode: "background" as const,
  recovered: false,
  recorderError: null,
  hydrated: true,
  start: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  stop: jest.fn(),
  completeSave: jest.fn(),
  reset: jest.fn(),
};

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), replace: jest.fn() },
  Stack: { Screen: () => null },
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: "medium" },
  NotificationFeedbackType: { Success: "success" },
}));
jest.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({
    theme: {
      background: "#000",
      surface: "#111",
      card: "#222",
      border: "#333",
      text: "#fff",
      textSecondary: "#ccc",
      textMuted: "#999",
    },
    isDark: true,
  }),
}));
jest.mock("@/context/AppContext", () => ({
  useApp: () => ({ state: { profile: { weightKg: 70 } } }),
}));
jest.mock("@/context/HealthContext", () => ({
  useHealth: () => ({ addRunSession: jest.fn() }),
}));
jest.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "runner-1" } }),
}));
jest.mock("@/lib/runTracker", () => ({
  useRunTracker: () => mockTrackerState,
  formatPace: (pace: number | null) =>
    pace == null ? "--:--" : `${Math.floor(pace)}:53`,
  formatDuration: () => "25:00",
}));
jest.mock("@/components/RunRouteMap", () => {
  const ReactRuntime = require("react");
  const { Text: NativeText, View: NativeView } = require("react-native");
  return {
    RunRouteMap: ({ points }: { points: unknown[] }) =>
      ReactRuntime.createElement(
        NativeView,
        { testID: "run-route-map" },
        ReactRuntime.createElement(
          NativeText,
          null,
          `${points.length} route points`,
        ),
      ),
  };
});

import RunScreen from "./run";

describe("run recorder presentation", () => {
  it("renders the live route and primary Strava-style activity metrics", async () => {
    const screen = await render(<RunScreen />);

    expect(screen.getByTestId("run-route-map")).toBeTruthy();
    expect(screen.getByText("3 route points")).toBeTruthy();
    expect(screen.getByText("5.12")).toBeTruthy();
    expect(screen.getByText("25:00")).toBeTruthy();
    expect(screen.getByText("Pace")).toBeTruthy();
    expect(screen.getByText("4:53 /km")).toBeTruthy();
    expect(screen.getByText("320")).toBeTruthy();
    expect(screen.getByText("42 m")).toBeTruthy();
    expect(screen.getByText("±6 m")).toBeTruthy();
  });
});
