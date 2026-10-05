import { randomUUID } from "node:crypto";
import { db, mobileOAuthAttemptsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

import {
  createOpaqueOAuthToken,
  decryptOAuthProviderToken,
  encryptOAuthProviderToken,
  hashOAuthToken,
  pkceChallengeForVerifier,
  secureStringEqual,
} from "./oauthExchangeCrypto";

const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const EXCHANGE_TTL_MS = 2 * 60 * 1000;
const CONSUMED_RETENTION_MS = 24 * 60 * 60 * 1000;

export type MobileOAuthMode = "redirect" | "popup";

export type ClaimedMobileOAuthAttempt = Readonly<{
  id: string;
  clientState: string;
  mode: MobileOAuthMode;
  returnUrl: string | null;
  codeChallenge: string | null;
}>;

export type MobileOAuthRedemption =
  | Readonly<{ status: "redeemed"; providerToken: string }>
  | Readonly<{ status: "invalid" }>;

async function cleanupExpiredAttempts(): Promise<void> {
  await db.execute(sql`
    DELETE FROM "mobile_oauth_attempts"
    WHERE "expires_at" <= clock_timestamp()
       OR "consumed_at" < clock_timestamp() - ${CONSUMED_RETENTION_MS} * interval '1 millisecond'
  `);
}

export async function createMobileOAuthAttempt(
  input: Readonly<{
    clientState: string;
    mode: MobileOAuthMode;
    returnUrl: string | null;
    codeChallenge: string | null;
  }>,
): Promise<string> {
  await cleanupExpiredAttempts();
  const providerState = createOpaqueOAuthToken();
  const createdAt = new Date();
  await db.insert(mobileOAuthAttemptsTable).values({
    id: randomUUID(),
    providerStateHash: hashOAuthToken(providerState),
    clientState: input.clientState,
    mode: input.mode,
    returnUrl: input.returnUrl,
    codeChallenge: input.codeChallenge,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + AUTHORIZATION_TTL_MS),
  });
  return providerState;
}

/** Atomically claims a provider callback so duplicate/replayed callbacks fail. */
export async function claimMobileOAuthAttempt(
  providerState: string,
): Promise<ClaimedMobileOAuthAttempt | null> {
  const claimed = await db.execute<{
    id: string;
    clientState: string;
    mode: MobileOAuthMode;
    returnUrl: string | null;
    codeChallenge: string | null;
  }>(sql`
    UPDATE "mobile_oauth_attempts"
    SET "provider_claimed_at" = clock_timestamp()
    WHERE "provider_state_hash" = ${hashOAuthToken(providerState)}
      AND "provider_claimed_at" IS NULL
      AND "exchange_code_hash" IS NULL
      AND "consumed_at" IS NULL
      AND "expires_at" > clock_timestamp()
    RETURNING
      "id",
      "client_state" AS "clientState",
      "mode",
      "return_url" AS "returnUrl",
      "code_challenge" AS "codeChallenge"
  `);
  return claimed.rows[0] ?? null;
}

export async function finalizeMobileOAuthExchange(
  input: Readonly<{
    attempt: ClaimedMobileOAuthAttempt;
    providerToken: string;
    encryptionSecret: string;
  }>,
): Promise<string | null> {
  if (input.attempt.mode !== "redirect" || !input.attempt.codeChallenge) {
    return null;
  }
  const exchangeCode = createOpaqueOAuthToken();
  const encryptedProviderToken = encryptOAuthProviderToken(
    input.providerToken,
    input.encryptionSecret,
  );
  const exchangeExpiresAt = new Date(Date.now() + EXCHANGE_TTL_MS);
  const updated = await db.execute<{ id: string }>(sql`
    UPDATE "mobile_oauth_attempts"
    SET
      "exchange_code_hash" = ${hashOAuthToken(exchangeCode)},
      "encrypted_provider_token" = ${encryptedProviderToken},
      "exchange_expires_at" = LEAST(${exchangeExpiresAt}, "expires_at")
    WHERE "id" = ${input.attempt.id}
      AND "provider_claimed_at" IS NOT NULL
      AND "exchange_code_hash" IS NULL
      AND "consumed_at" IS NULL
      AND "expires_at" > clock_timestamp()
    RETURNING "id"
  `);
  return updated.rows.length === 1 ? exchangeCode : null;
}

export async function consumeMobileOAuthExchange(
  input: Readonly<{
    exchangeCode: string;
    clientState: string;
    codeVerifier: string;
    encryptionSecret: string;
  }>,
): Promise<MobileOAuthRedemption> {
  return db.transaction(async (transaction) => {
    const locked = await transaction.execute<{
      id: string;
      clientState: string;
      codeChallenge: string;
      encryptedProviderToken: string;
    }>(sql`
      SELECT
        "id",
        "client_state" AS "clientState",
        "code_challenge" AS "codeChallenge",
        "encrypted_provider_token" AS "encryptedProviderToken"
      FROM "mobile_oauth_attempts"
      WHERE "exchange_code_hash" = ${hashOAuthToken(input.exchangeCode)}
        AND "mode" = 'redirect'
        AND "consumed_at" IS NULL
        AND "encrypted_provider_token" IS NOT NULL
        AND "exchange_expires_at" > clock_timestamp()
        AND "expires_at" > clock_timestamp()
      FOR UPDATE
    `);
    const attempt = locked.rows[0];
    if (!attempt) return { status: "invalid" } as const;

    const challenge = pkceChallengeForVerifier(input.codeVerifier);
    if (
      !secureStringEqual(attempt.clientState, input.clientState) ||
      !secureStringEqual(attempt.codeChallenge, challenge)
    ) {
      return { status: "invalid" } as const;
    }

    const providerToken = decryptOAuthProviderToken(
      attempt.encryptedProviderToken,
      input.encryptionSecret,
    );
    const consumed = await transaction.execute<{ id: string }>(sql`
      UPDATE "mobile_oauth_attempts"
      SET
        "consumed_at" = clock_timestamp(),
        "encrypted_provider_token" = NULL
      WHERE "id" = ${attempt.id}
        AND "consumed_at" IS NULL
      RETURNING "id"
    `);
    if (consumed.rows.length !== 1) return { status: "invalid" } as const;
    return { status: "redeemed", providerToken } as const;
  });
}

export async function deleteMobileOAuthAttempt(id: string): Promise<void> {
  await db
    .delete(mobileOAuthAttemptsTable)
    .where(eq(mobileOAuthAttemptsTable.id, id));
}
