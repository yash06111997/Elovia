import type { CorsOptions } from "cors";

type Environment = NodeJS.ProcessEnv | Record<string, string | undefined>;

function parseOrigin(value: string, requireHttps: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid CORS origin: "${value}"`);
  }

  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    (requireHttps && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`Invalid CORS origin: "${value}"`);
  }

  return parsed.origin;
}

function publicDomainOrigin(environment: Environment): string | null {
  const value = (
    environment.PUBLIC_DOMAIN ??
    environment.RAILWAY_PUBLIC_DOMAIN ??
    ""
  ).trim();
  if (!value) return null;

  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return parseOrigin(withScheme, environment.NODE_ENV === "production");
}

/**
 * Browser origins are intentionally opt-in. Elovia is a native mobile app, so
 * its API calls carry no Origin header and remain accepted. A future operations
 * console can be allowed explicitly without restoring reflective CORS.
 */
export function loadAllowedCorsOrigins(environment: Environment): Set<string> {
  const requireHttps = environment.NODE_ENV === "production";
  const origins = new Set<string>();
  const ownOrigin = publicDomainOrigin(environment);
  if (ownOrigin) origins.add(ownOrigin);

  for (const value of (environment.CORS_ALLOWED_ORIGINS ?? "").split(",")) {
    const candidate = value.trim();
    if (!candidate) continue;
    origins.add(parseOrigin(candidate, requireHttps));
  }

  return origins;
}

export function createCorsOptions(environment: Environment): CorsOptions {
  const allowedOrigins = loadAllowedCorsOrigins(environment);

  return {
    // The native app authenticates with an Authorization header, not cookies.
    // Omitting credentialed CORS prevents an arbitrary website from reading
    // authenticated API responses through ambient browser credentials.
    credentials: false,
    maxAge: 600,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      try {
        callback(null, allowedOrigins.has(new URL(origin).origin));
      } catch {
        callback(null, false);
      }
    },
  };
}
