type Environment = NodeJS.ProcessEnv | Record<string, string | undefined>;

function firstNonEmpty(
  environment: Environment,
  names: readonly string[],
): string {
  for (const name of names) {
    const value = environment[name]?.trim();
    if (value) return value;
  }
  return "";
}

function normalizeHostname(value: string): string {
  const candidate = value
    .trim()
    .replace(/^https?:\/\//i, "")
    .split("/")[0];
  if (
    !candidate ||
    candidate.length > 253 ||
    !/^[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/.test(candidate)
  ) {
    return "";
  }
  return candidate;
}

export type GoogleOAuthConfig = Readonly<{
  clientId: string;
  clientSecret: string;
  serverDomain: string;
  appScheme: string;
}>;

export function isAllowedMobileReturnUrl(
  rawReturnUrl: string,
  appScheme: string,
  isProduction = process.env.NODE_ENV === "production",
): boolean {
  try {
    const parsed = new URL(rawReturnUrl);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      return false;
    }
    const normalizedScheme = appScheme.toLowerCase();
    const isExactAppCallback =
      parsed.protocol === `${normalizedScheme}:` &&
      ((parsed.hostname === "auth" && ["", "/"].includes(parsed.pathname)) ||
        (parsed.hostname === "" && parsed.pathname === "/auth"));
    if (isExactAppCallback) return true;

    // Expo Go is a local developer convenience only. Production builds always
    // use Elovia's own scheme; accepting exp:// in production would expand the
    // callback interception surface unnecessarily.
    return (
      !isProduction &&
      ["exp:", "exps:"].includes(parsed.protocol) &&
      parsed.pathname.endsWith("/auth")
    );
  } catch {
    return false;
  }
}

export function loadGoogleOAuthConfig(
  environment: Environment,
  requestHost = "",
): GoogleOAuthConfig {
  const clientId = firstNonEmpty(environment, [
    "GOOGLE_WEB_CLIENT_ID",
    "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID",
  ]);
  const clientSecret = firstNonEmpty(environment, ["GOOGLE_CLIENT_SECRET"]);
  const configuredDomain = firstNonEmpty(environment, [
    "PUBLIC_DOMAIN",
    "RAILWAY_PUBLIC_DOMAIN",
    "REPLIT_DEV_DOMAIN",
  ]);
  const developmentHost =
    environment.NODE_ENV === "production" ? "" : requestHost;
  const serverDomain = normalizeHostname(configuredDomain || developmentHost);
  const appScheme = (
    firstNonEmpty(environment, ["MOBILE_APP_SCHEME"]) || "elovia"
  ).toLowerCase();

  const missing: string[] = [];
  if (!clientId) missing.push("GOOGLE_WEB_CLIENT_ID");
  if (clientSecret.length < 16) missing.push("GOOGLE_CLIENT_SECRET");
  if (!serverDomain) missing.push("PUBLIC_DOMAIN or RAILWAY_PUBLIC_DOMAIN");
  if (!/^[a-z][a-z0-9+.-]{1,31}$/i.test(appScheme)) {
    missing.push("valid MOBILE_APP_SCHEME");
  }
  if (missing.length) {
    throw new Error(
      `Google OAuth configuration is incomplete: ${missing.join(", ")}`,
    );
  }
  return { clientId, clientSecret, serverDomain, appScheme };
}

export function assertProductionRuntimeConfigured(
  environment: Environment,
): void {
  loadGoogleOAuthConfig(environment);

  const missing: string[] = [];
  if (!firstNonEmpty(environment, ["FIREBASE_PROJECT_ID"])) {
    missing.push("FIREBASE_PROJECT_ID");
  }
  const firebaseServiceAccount = firstNonEmpty(environment, [
    "FIREBASE_SERVICE_ACCOUNT_KEY",
  ]);
  const applicationCredentials = firstNonEmpty(environment, [
    "GOOGLE_APPLICATION_CREDENTIALS",
  ]);
  if (!firebaseServiceAccount && !applicationCredentials) {
    missing.push(
      "FIREBASE_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS",
    );
  } else if (firebaseServiceAccount) {
    try {
      const parsed = JSON.parse(firebaseServiceAccount) as Record<
        string,
        unknown
      >;
      if (
        typeof parsed.project_id !== "string" ||
        typeof parsed.client_email !== "string" ||
        typeof parsed.private_key !== "string"
      ) {
        missing.push("valid FIREBASE_SERVICE_ACCOUNT_KEY");
      }
    } catch {
      missing.push("valid FIREBASE_SERVICE_ACCOUNT_KEY");
    }
  }
  if (
    !firstNonEmpty(environment, [
      "ANTHROPIC_API_KEY",
      "AI_INTEGRATIONS_ANTHROPIC_API_KEY",
    ])
  ) {
    missing.push("ANTHROPIC_API_KEY");
  }
  if (missing.length) {
    throw new Error(
      `Production configuration is incomplete: ${missing.join(", ")}`,
    );
  }
}
