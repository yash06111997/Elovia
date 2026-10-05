import React from "react";
import { Linking } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";

const mockRequestPermission = jest.fn();
let mockPermission = {
  granted: false,
  canAskAgain: false,
  status: "denied",
  expires: "never",
};

jest.mock("expo-camera", () => ({
  CameraView: () => null,
  useCameraPermissions: () => [mockPermission, mockRequestPermission],
}));
jest.mock("expo-router", () => ({
  router: { back: jest.fn() },
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
    isDark: true,
    theme: {
      background: "#000",
      border: "#333",
      text: "#fff",
      textSecondary: "#bbb",
      textMuted: "#888",
    },
  }),
}));
jest.mock("@/context/NutritionContext", () => ({
  useNutrition: () => ({ logFood: jest.fn() }),
}));
jest.mock("@/lib/openFoodFacts", () => ({
  lookupBarcode: jest.fn(),
  novaLabel: jest.fn(),
}));

import ScanScreen from "../app/scan";

describe("barcode camera permissions", () => {
  const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue();

  beforeEach(() => {
    mockRequestPermission.mockReset();
    openSettings.mockClear();
    mockPermission = {
      granted: false,
      canAskAgain: false,
      status: "denied",
      expires: "never",
    };
  });

  afterAll(() => {
    openSettings.mockRestore();
  });

  it("opens system settings after camera permission is permanently denied", async () => {
    const screen = await render(<ScanScreen />);

    expect(screen.getByText("Camera access is blocked")).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", { name: "Open Settings" }),
    );

    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it("requests camera access while the operating system still allows a prompt", async () => {
    mockPermission = {
      granted: false,
      canAskAgain: true,
      status: "undetermined",
      expires: "never",
    };
    const screen = await render(<ScanScreen />);

    await fireEvent.press(screen.getByRole("button", { name: "Allow camera" }));
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(openSettings).not.toHaveBeenCalled();
  });
});
