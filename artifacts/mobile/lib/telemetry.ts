import Constants from "expo-constants";
import { Platform } from "react-native";

export type TelemetryEvent =
  | "onboarding_completed"
  | "plan_preview_viewed"
  | "paywall_viewed"
  | "workout_feedback_submitted"
  | "client_error"
  | "account_exported"
  | "account_deleted";

type SafeProperty = string | number | boolean;

function baseUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}`;
  return "http://localhost:8080";
}

/** Events are deliberately anonymous and accept only caller-supplied scalars. */
export async function trackEvent(
  event: TelemetryEvent,
  properties: Record<string, SafeProperty> = {},
): Promise<void> {
  try {
    await fetch(`${baseUrl()}/api/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        properties,
        platform: Platform.OS,
        appVersion: Constants.expoConfig?.version ?? "unknown",
      }),
    });
  } catch {
    // Telemetry must never block or break the product flow it observes.
  }
}

export function reportClientError(error: Error): void {
  void trackEvent("client_error", { errorType: error.name.slice(0, 80) });
}
