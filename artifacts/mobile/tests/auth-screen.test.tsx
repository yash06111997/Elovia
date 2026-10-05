import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { Platform } from "react-native";

const mockLoginWithGoogle = jest.fn();
const mockLoginWithApple = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({
    back: jest.fn(),
    canGoBack: () => true,
    replace: jest.fn(),
  }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/auth", () => ({
  useAuth: () => ({
    authError: null,
    isAuthenticated: false,
    isLoading: false,
    login: mockLoginWithGoogle,
    loginWithApple: mockLoginWithApple,
  }),
}));
jest.mock(
  "expo-apple-authentication",
  () => {
    const ReactModule = require("react") as typeof React;
    const ReactNative = require("react-native") as typeof import("react-native");
    return {
      isAvailableAsync: jest.fn(async () => true),
      AppleAuthenticationButton: ({ onPress }: { onPress: () => void }) =>
        ReactModule.createElement(
          ReactNative.Pressable,
          {
            accessibilityRole: "button",
            accessibilityLabel: "Continue with Apple",
            onPress,
          },
          ReactModule.createElement(
            ReactNative.Text,
            null,
            "Continue with Apple",
          ),
        ),
      AppleAuthenticationButtonStyle: { WHITE: 0 },
      AppleAuthenticationButtonType: { CONTINUE: 1 },
    };
  },
  { virtual: true },
);

import AuthScreen from "../app/auth";

describe("authentication provider choice", () => {
  const originalPlatform = Platform.OS;

  beforeAll(() => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
  });

  afterAll(() => {
    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: originalPlatform,
    });
  });

  beforeEach(() => {
    mockLoginWithGoogle.mockReset();
    mockLoginWithApple.mockReset();
  });

  it("offers both Apple and Google sign in on iOS", async () => {
    const screen = await render(<AuthScreen />);

    expect(screen.getByLabelText("Continue with Apple")).toBeTruthy();
    expect(screen.getByLabelText("Continue with Google")).toBeTruthy();
  });

  it("starts the provider selected by the user", async () => {
    const screen = await render(<AuthScreen />);

    await fireEvent.press(screen.getByLabelText("Continue with Apple"));
    expect(mockLoginWithApple).toHaveBeenCalledTimes(1);
    expect(mockLoginWithGoogle).not.toHaveBeenCalled();
  });
});
