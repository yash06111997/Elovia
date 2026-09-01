import * as Crypto from "expo-crypto";

const OWNER_MARKER_NAMESPACE = "elovia-notification-owner-v1";

/** Stable opaque account marker for device-local notification ownership. */
export async function notificationOwnerMarker(
  userId: string | null,
): Promise<string | null> {
  try {
    return await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${OWNER_MARKER_NAMESPACE}:${userId ?? "guest"}`,
    );
  } catch {
    return null;
  }
}
