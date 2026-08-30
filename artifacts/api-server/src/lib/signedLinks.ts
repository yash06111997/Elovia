import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived signed links.
 *
 * Some things have to be opened by the operating system rather than fetched by
 * the app: a calendar file has to reach the calendar app, and the OS opens the
 * URL in a plain browser with none of our headers. A bearer token cannot ride
 * along, so the authorisation has to be IN the URL.
 *
 * The token is therefore scoped as tightly as it can be: one subject, one
 * purpose, and a few minutes of validity. It grants the ability to download one
 * specific calendar file and nothing else.
 */

const DEFAULT_TTL_SECONDS = 600;

/**
 * The signing key.
 *
 * Falls back to a hash of DATABASE_URL rather than a per-process random value.
 * A random secret would silently invalidate every outstanding link on restart
 * and break entirely across two instances; a derived one is stable, is already
 * a server-only secret, and never leaves this process.
 */
function signingKey(): Buffer {
  const explicit = process.env.LINK_SIGNING_SECRET;
  if (explicit && explicit.length >= 16) return Buffer.from(explicit, "utf8");

  const fallback = process.env.DATABASE_URL ?? "elovia-development-only";
  return createHash("sha256").update(`link-signing:${fallback}`).digest();
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Sign `subject` for `purpose`.
 *
 * `purpose` is part of the signed payload so a token minted for one kind of
 * link cannot be replayed against another route that happens to share an id.
 */
export function signLinkToken(
  subject: string,
  purpose: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${purpose}:${subject}:${expiresAt}`;
  const signature = createHmac("sha256", signingKey()).update(payload).digest();

  return `${expiresAt}.${base64url(signature)}`;
}

/**
 * Verify a token against the subject and purpose it was supposedly minted for.
 *
 * Compares in constant time. A plain `===` on a signature leaks how many
 * leading bytes were correct through timing, which is enough to forge one byte
 * at a time given enough attempts.
 */
export function verifyLinkToken(token: string, subject: string, purpose: string): boolean {
  const separator = token.indexOf(".");
  if (separator <= 0) return false;

  const expiresAt = Number(token.slice(0, separator));
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return false;

  const payload = `${purpose}:${subject}:${expiresAt}`;
  const expected = base64url(createHmac("sha256", signingKey()).update(payload).digest());

  const given = Buffer.from(token.slice(separator + 1), "utf8");
  const want = Buffer.from(expected, "utf8");

  // timingSafeEqual throws on a length mismatch, which would itself be a
  // (coarse) oracle, so the lengths are compared first and deliberately.
  if (given.length !== want.length) return false;

  return timingSafeEqual(given, want);
}
