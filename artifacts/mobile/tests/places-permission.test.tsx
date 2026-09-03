import React from "react";
import { Alert, Linking } from "react-native";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: "success" },
}));
jest.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({
    theme: {
      background: "#000",
      card: "#111",
      border: "#333",
      text: "#fff",
      textSecondary: "#bbb",
      textMuted: "#888",
    },
  }),
}));
jest.mock("@/components/Pressable", () => {
  const ReactRuntime = require("react");
  const { Pressable } = require("react-native");
  return {
    PressableScale: ({ children, ...props }: Record<string, unknown>) =>
      ReactRuntime.createElement(Pressable, props, children),
  };
});
jest.mock("@/components/Skeleton", () => ({ EmptyState: () => null }));
jest.mock("@/lib/syncEvents", () => ({ onDataRestored: () => () => {} }));
jest.mock("@/lib/geofence", () => ({
  DEFAULT_RADIUS_M: 150,
  MIN_RADIUS_M: 100,
  MAX_PLACES: 20,
  loadPlaces: jest.fn().mockResolvedValue([
    {
      id: "gym-1",
      name: "My gym",
      kind: "gym",
      latitude: 28.61,
      longitude: 77.2,
      radius: 150,
      notifyOnArrive: true,
      autoStartWorkout: false,
      enabled: true,
    },
  ]),
  savePlaces: jest.fn(),
  syncGeofences: jest.fn(),
  stopAllGeofences: jest.fn(),
  requestGeofencePermissions: jest.fn().mockResolvedValue("blocked"),
  hasBackgroundPermission: jest.fn().mockResolvedValue(false),
  getCurrentPlaceCoordinates: jest.fn(),
  makePlaceId: jest.fn(() => "place-2"),
}));

import PlacesScreen from "../app/places";

describe("saved-place location permissions", () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue();

  beforeEach(() => {
    alert.mockClear();
    openSettings.mockClear();
  });

  afterAll(() => {
    alert.mockRestore();
    openSettings.mockRestore();
  });

  it("offers a working Settings action when background location is blocked", async () => {
    const screen = await render(<PlacesScreen />);
    const warning = await screen.findByText(/Background location is off/);

    await fireEvent.press(warning);
    await waitFor(() => expect(alert).toHaveBeenCalled());

    const buttons = alert.mock.calls.at(-1)?.[2];
    const settingsButton = buttons?.find(
      (button) => button.text === "Open Settings",
    );
    expect(settingsButton).toBeDefined();

    settingsButton?.onPress?.();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });
});
