import { randomUUID } from "node:crypto";
import { db, pushTokensTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

/**
 * Expo push delivery.
 *
 * Uses Expo's push service rather than talking to APNs/FCM directly, which
 * means no Apple push certificate and no Firebase server key to manage. Expo
 * handles both platforms behind one endpoint.
 *
 * EXPO_ACCESS_TOKEN is optional but recommended: without it, anyone who learns
 * a token could send notifications to that device.
 */

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const MAX_BATCH = 100;

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** iOS badge count. */
  badge?: number;
  sound?: "default" | null;
}

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoResponse {
  data?: ExpoTicket[];
  errors?: { message: string }[];
}

export async function registerPushToken(params: {
  userId: string;
  token: string;
  platform?: string;
  deviceName?: string;
}): Promise<void> {
  // Upserting on the token (not on user+token) means a device that changes
  // hands is reassigned rather than duplicated, so the previous owner stops
  // receiving the new owner's notifications.
  await db
    .insert(pushTokensTable)
    .values({
      id: randomUUID(),
      userId: params.userId,
      token: params.token,
      platform: params.platform ?? null,
      deviceName: params.deviceName ?? null,
      enabled: true,
    })
    .onConflictDoUpdate({
      target: pushTokensTable.token,
      set: {
        userId: params.userId,
        platform: params.platform ?? null,
        deviceName: params.deviceName ?? null,
        enabled: true,
        invalidatedAt: null,
        lastError: null,
        updatedAt: new Date(),
      },
    });
}

export async function unregisterPushToken(
  userId: string,
  token: string,
): Promise<void> {
  await db
    .update(pushTokensTable)
    .set({ enabled: false, updatedAt: new Date() })
    .where(
      and(eq(pushTokensTable.userId, userId), eq(pushTokensTable.token, token)),
    );
}

/** Live tokens for a user: enabled and not marked dead by Expo. */
async function activeTokensFor(userId: string): Promise<string[]> {
  const rows = await db
    .select({ token: pushTokensTable.token })
    .from(pushTokensTable)
    .where(
      and(
        eq(pushTokensTable.userId, userId),
        eq(pushTokensTable.enabled, true),
        isNull(pushTokensTable.invalidatedAt),
      ),
    );

  return rows.map((r) => r.token);
}

/**
 * Send to every device a user has registered.
 *
 * Returns how many messages Expo accepted. Dead tokens are marked in the
 * database so they stop being retried forever - the most common cause of a
 * push system quietly degrading is never pruning uninstalled devices.
 */
export async function sendPushToUser(
  userId: string,
  message: PushMessage,
): Promise<{ sent: number; failed: number }> {
  const tokens = await activeTokensFor(userId);
  if (tokens.length === 0) return { sent: 0, failed: 0 };
  return sendPushToTokens(tokens, {
    ...message,
    data: {
      ...(message.data ?? {}),
      eloviaPush: 1,
      eloviaPushOwnerUserId: userId,
    },
  });
}

export async function sendPushToTokens(
  tokens: string[],
  message: PushMessage,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < tokens.length; i += MAX_BATCH) {
    const batch = tokens.slice(i, i + MAX_BATCH);

    const payload = batch.map((to) => ({
      to,
      title: message.title,
      body: message.body,
      data: message.data ?? {},
      sound: message.sound === null ? undefined : "default",
      badge: message.badge,
      channelId: "reminders",
    }));

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (process.env.EXPO_ACCESS_TOKEN) {
        headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
      }

      const response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        failed += batch.length;
        continue;
      }

      const result = (await response.json()) as ExpoResponse;
      const tickets = result.data ?? [];

      for (const [index, ticket] of tickets.entries()) {
        if (ticket.status === "ok") {
          sent += 1;
          continue;
        }

        failed += 1;
        const token = batch[index];
        const reason = ticket.details?.error ?? ticket.message ?? "unknown";

        // DeviceNotRegistered means the app was uninstalled or the token was
        // rotated. Anything else may be transient, so only retire this one.
        if (reason === "DeviceNotRegistered") {
          await db
            .update(pushTokensTable)
            .set({
              invalidatedAt: new Date(),
              lastError: reason,
              enabled: false,
            })
            .where(eq(pushTokensTable.token, token))
            .catch(() => undefined);
        } else {
          await db
            .update(pushTokensTable)
            .set({ lastError: reason.slice(0, 200) })
            .where(eq(pushTokensTable.token, token))
            .catch(() => undefined);
        }
      }

      await db
        .update(pushTokensTable)
        .set({ lastSentAt: new Date() })
        .where(eq(pushTokensTable.token, batch[0]))
        .catch(() => undefined);
    } catch {
      failed += batch.length;
    }
  }

  return { sent, failed };
}

/** Expo tokens have a fixed, checkable shape. */
export function isValidExpoPushToken(token: unknown): token is string {
  return (
    typeof token === "string" &&
    (token.startsWith("ExponentPushToken[") ||
      token.startsWith("ExpoPushToken[")) &&
    token.endsWith("]") &&
    token.length < 200
  );
}
