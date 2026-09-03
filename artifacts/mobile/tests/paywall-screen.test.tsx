import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

const mockRefetchOfferings = jest.fn();
const mockNavigation = { setOptions: jest.fn() };
const mockRevenueCat: Record<string, unknown> = {
  offerings: undefined,
  offeringsError: new Error("Store unavailable"),
  isLoading: false,
  isOfferingsLoading: false,
  isPurchasing: false,
  isRestoring: false,
  purchase: jest.fn(),
  restore: jest.fn(),
  refetchOfferings: mockRefetchOfferings,
};

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({}),
  useNavigation: () => mockNavigation,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success" },
}));
jest.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({
    isDark: true,
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
jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({
    startTrial: jest.fn(),
    refreshEntitlement: jest.fn(),
    isTrialActive: false,
  }),
}));
jest.mock("@/lib/auth", () => ({
  useAuth: () => ({ isAuthenticated: true, login: jest.fn() }),
}));
jest.mock("@/lib/revenuecat", () => ({
  useRevenueCat: () => mockRevenueCat,
}));
jest.mock("@/lib/telemetry", () => ({ trackEvent: jest.fn() }));
jest.mock("@/utils/api", () => ({
  getPublicApiUrl: (path: string) => `https://api.elovia.test${path}`,
}));

import PaywallScreen from "../app/paywall";

describe("paywall recovery", () => {
  beforeEach(() => {
    mockRefetchOfferings.mockReset();
    Object.assign(mockRevenueCat, {
      offerings: undefined,
      offeringsError: new Error("Store unavailable"),
      isLoading: false,
      isOfferingsLoading: false,
      isPurchasing: false,
      isRestoring: false,
    });
  });

  it("shows an actionable retry instead of claiming unavailable plans are loading", async () => {
    const screen = await render(<PaywallScreen />);

    expect(screen.getByRole("alert")).toHaveTextContent("Plans unavailable");
    expect(screen.queryByText("Loading plans...")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(mockRefetchOfferings).toHaveBeenCalledTimes(1);
  });

  it("selects the first available package when the preferred yearly plan is absent", async () => {
    Object.assign(mockRevenueCat, {
      offerings: {
        current: {
          availablePackages: [
            {
              identifier: "$rc_monthly",
              packageType: "MONTHLY",
              product: { price: 9.99, priceString: "$9.99" },
            },
          ],
        },
      },
      offeringsError: null,
    });
    const screen = await render(<PaywallScreen />);

    await fireEvent.press(screen.getByText("Subscribe Now"));
    expect(screen.getByText("Confirm Purchase")).toBeTruthy();
    expect(screen.getByText(/Monthly Premium for \$9\.99/)).toBeTruthy();
  });
});
