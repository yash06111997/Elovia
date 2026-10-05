import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const OAUTH_CLIENT_STATE_PATTERN = /^[A-Za-z0-9._~-]{16,128}$/;
const OAUTH_TOKEN_BYTES = 32;
const AUTH_TAG_BYTES = 16;
const IV_BYTES = 12;
const ENCRYPTION_VERSION = "v1";

function toBase64Url(value: Buffer): string {
  return value.toString("base64url");
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function encryptionKey(secret: string): Buffer {
  if (secret.length < 16) {
    throw new Error("OAuth encryption secret is not configured safely.");
  }
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      Buffer.from("elovia-mobile-oauth", "utf8"),
      Buffer.from("provider-token-encryption-v1", "utf8"),
      32,
    ),
  );
}

export function createOpaqueOAuthToken(): string {
  return toBase64Url(randomBytes(OAUTH_TOKEN_BYTES));
}

export function hashOAuthToken(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function isValidPkceVerifier(value: string): boolean {
  return PKCE_VERIFIER_PATTERN.test(value);
}

export function isValidPkceChallenge(value: string): boolean {
  return PKCE_CHALLENGE_PATTERN.test(value);
}

export function isValidOAuthClientState(value: string): boolean {
  return OAUTH_CLIENT_STATE_PATTERN.test(value);
}

export function pkceChallengeForVerifier(verifier: string): string {
  return toBase64Url(createHash("sha256").update(verifier, "utf8").digest());
}

export function secureStringEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export function encryptOAuthProviderToken(
  providerToken: string,
  secret: string,
): string {
  if (!providerToken) throw new Error("OAuth provider token is missing.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(providerToken, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    ENCRYPTION_VERSION,
    toBase64Url(iv),
    toBase64Url(ciphertext),
    toBase64Url(authTag),
  ].join(".");
}

export function decryptOAuthProviderToken(
  encrypted: string,
  secret: string,
): string {
  try {
    const [version, ivRaw, ciphertextRaw, authTagRaw, extra] =
      encrypted.split(".");
    if (
      version !== ENCRYPTION_VERSION ||
      !ivRaw ||
      !ciphertextRaw ||
      !authTagRaw ||
      extra !== undefined
    ) {
      throw new Error("Malformed encrypted value.");
    }
    const iv = fromBase64Url(ivRaw);
    const ciphertext = fromBase64Url(ciphertextRaw);
    const authTag = fromBase64Url(authTagRaw);
    if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
      throw new Error("Malformed encrypted value.");
    }
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("OAuth provider token could not be decrypted.");
  }
}

export function appendOAuthExchangeResult(
  returnUrl: string,
  result: Readonly<{ code: string; state: string }>,
): string {
  const callback = new URL(returnUrl);
  const fragment = new URLSearchParams(callback.hash.slice(1));
  fragment.set("code", result.code);
  fragment.set("state", result.state);
  callback.hash = fragment.toString();
  return callback.toString();
}
