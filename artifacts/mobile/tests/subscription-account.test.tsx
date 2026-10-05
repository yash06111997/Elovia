import React from "react";
import { Text } from "react-native";
import { act, render } from "@testing-library/react-native";

let mockUserId = "user-a";
const mockFetch = jest.fn();
const mockRc = { restore: jest.fn() };
jest.mock("@/lib/auth", () => ({ useAuth: () => ({ isAuthenticated: true, isLoading: false, user: { id: mockUserId } }) }));
jest.mock("@/lib/revenuecat", () => ({ useRevenueCat: () => mockRc }));
jest.mock("@/utils/api", () => ({ fetchEntitlement: () => mockFetch(), ApiError: class extends Error {} }));
import { SubscriptionProvider, useSubscription } from "../context/SubscriptionContext";

function Probe() {
  const subscription = useSubscription();
  return <Text>{subscription.isPremium ? "pro" : "free"}</Text>;
}
const tree = () => <SubscriptionProvider><Probe /></SubscriptionProvider>;
const pro = { hasProAccess: true, tier: "premium", status: "active", hasCoaching: false, trialEndsAt: null, currentPeriodEndsAt: null, productId: "elovia_pro_monthly" };

describe("subscription account isolation", () => {
  beforeEach(() => { mockUserId = "user-a"; mockFetch.mockReset(); });
  it("does not show a previous user's access while the new account loads", async () => {
    mockFetch.mockResolvedValueOnce(pro).mockImplementationOnce(() => new Promise(() => {}));
    const screen = await render(tree());
    expect(screen.getByText("pro")).toBeTruthy();
    mockUserId = "user-b";
    await screen.rerender(tree());
    expect(screen.getByText("free")).toBeTruthy();
  });
  it("ignores an old account's delayed server response after switching accounts", async () => {
    let resolveOld!: (value: unknown) => void;
    mockFetch.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ ...pro, tier: "free", hasProAccess: false });
    const screen = await render(tree());
    mockUserId = "user-b";
    await screen.rerender(tree());
    await act(async () => { resolveOld(pro); });
    expect(screen.getByText("free")).toBeTruthy();
  });
});
