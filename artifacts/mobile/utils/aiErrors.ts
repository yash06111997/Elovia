import { Alert } from "react-native";
import { router } from "expo-router";
import { ApiError } from "@/utils/api";

/**
 * Route an AI failure to the right response.
 *
 * The distinction that matters: a 402 means "you do not have access" and
 * should open the paywall; a 429 means "you have access but used today's
 * allowance" and must NOT. Showing an upgrade prompt to someone who is already
 * paying is the fastest way to earn a refund request.
 */
export function handleAiError(error: unknown, fallbackMessage: string): void {
  if (!(error instanceof ApiError)) {
    const message = error instanceof Error ? error.message : fallbackMessage;
    Alert.alert("Something went wrong", message || fallbackMessage);
    return;
  }

  // Offline first: the device never reached the server, so nothing about
  // entitlement, quota or sign-in is knowable. Checking those first would
  // show an upgrade prompt to someone who is simply in a basement.
  if (error.code === "offline") {
    Alert.alert("You're offline", error.message);
    return;
  }

  if (error.requiresSignIn) {
    Alert.alert("Sign in required", "Please sign in again to use AI features.", [
      { text: "Not now", style: "cancel" },
      { text: "Sign in", onPress: () => router.push("/auth") },
    ]);
    return;
  }

  if (error.requiresUpgrade) {
    Alert.alert("Premium feature", error.message, [
      { text: "Not now", style: "cancel" },
      { text: "See plans", onPress: () => router.push("/paywall") },
    ]);
    return;
  }

  if (error.isRateLimited) {
    Alert.alert("Daily limit reached", `${error.message}${formatReset(error.resetsAt)}`);
    return;
  }

  Alert.alert("Something went wrong", error.message || fallbackMessage);
}

function formatReset(resetsAt?: string): string {
  if (!resetsAt) return "";
  const reset = new Date(resetsAt);
  if (Number.isNaN(reset.getTime())) return "";

  const hoursAway = Math.max(0, Math.round((reset.getTime() - Date.now()) / 3_600_000));
  if (hoursAway <= 0) return " Your allowance resets shortly.";
  if (hoursAway === 1) return " Your allowance resets in about an hour.";
  return ` Your allowance resets in about ${hoursAway} hours.`;
}
