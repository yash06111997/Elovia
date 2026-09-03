import { Router, type IRouter, type Request, type Response } from "express";

import { rateLimit } from "../lib/rateLimit";
import {
  appendOAuthExchangeResult,
  isValidOAuthClientState,
  isValidPkceChallenge,
  isValidPkceVerifier,
} from "../lib/oauthExchangeCrypto";
import {
  claimMobileOAuthAttempt,
  consumeMobileOAuthExchange,
  createMobileOAuthAttempt,
  deleteMobileOAuthAttempt,
  finalizeMobileOAuthExchange,
  type MobileOAuthMode,
} from "../lib/mobileOAuthTransactions";
import {
  isAllowedMobileReturnUrl,
  loadGoogleOAuthConfig,
} from "../lib/productionConfig";

const router: IRouter = Router();

router.get("/auth/user", (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.json({ user: null });
    return;
  }

  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      profileImageUrl: req.user.profileImageUrl,
    },
  });
});

const beginOAuthLimit = rateLimit({
  windowMs: 60_000,
  max: 20,
  keyPrefix: "oauth-begin",
  message: "Too many sign-in attempts. Please wait and try again.",
});
const callbackOAuthLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyPrefix: "oauth-callback",
  message: "Too many sign-in callbacks. Please wait and try again.",
});
const exchangeOAuthLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyPrefix: "oauth-exchange",
  message: "Too many sign-in exchanges. Please wait and try again.",
});

router.get(
  "/auth/google-mobile",
  beginOAuthLimit,
  async (req: Request, res: Response) => {
    const rawMode =
      typeof req.query.mode === "string" ? req.query.mode : "redirect";
    const mode: MobileOAuthMode | null =
      rawMode === "redirect" || rawMode === "popup" ? rawMode : null;
    const returnUrl =
      typeof req.query.returnUrl === "string" ? req.query.returnUrl : "";
    const clientState =
      typeof req.query.state === "string" ? req.query.state : "";
    const codeChallenge =
      typeof req.query.codeChallenge === "string"
        ? req.query.codeChallenge
        : "";

    if (!mode || !isValidOAuthClientState(clientState)) {
      res
        .status(400)
        .json({ error: "Missing or invalid authentication state" });
      return;
    }

    let config;
    try {
      config = loadGoogleOAuthConfig(process.env, req.get("host") ?? "");
    } catch {
      res.status(503).json({ error: "Google sign-in is not configured" });
      return;
    }

    if (
      mode === "redirect" &&
      (!isAllowedMobileReturnUrl(returnUrl, config.appScheme) ||
        !isValidPkceChallenge(codeChallenge))
    ) {
      res.status(400).json({ error: "Invalid mobile sign-in callback" });
      return;
    }
    if (mode === "popup" && (returnUrl || codeChallenge)) {
      res.status(400).json({ error: "Invalid popup sign-in request" });
      return;
    }

    const callbackUrl = `https://${config.serverDomain}/api/auth/google-callback`;
    let providerState;
    try {
      providerState = await createMobileOAuthAttempt({
        clientState,
        mode,
        returnUrl: mode === "redirect" ? returnUrl : null,
        codeChallenge: mode === "redirect" ? codeChallenge : null,
      });
    } catch (error) {
      req.log?.error(
        { errorType: error instanceof Error ? error.name : "UnknownError" },
        "Could not persist OAuth attempt",
      );
      res.status(503).json({ error: "Sign-in is temporarily unavailable" });
      return;
    }

    const googleAuthUrl = new URL(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    googleAuthUrl.searchParams.set("client_id", config.clientId);
    googleAuthUrl.searchParams.set("redirect_uri", callbackUrl);
    googleAuthUrl.searchParams.set("response_type", "code");
    googleAuthUrl.searchParams.set("scope", "openid email profile");
    googleAuthUrl.searchParams.set("state", providerState);
    googleAuthUrl.searchParams.set("prompt", "select_account");

    res.redirect(googleAuthUrl.toString());
  },
);

router.get(
  "/auth/google-callback",
  callbackOAuthLimit,
  async (req: Request, res: Response) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const providerState =
      typeof req.query.state === "string" ? req.query.state : "";
    const providerError =
      typeof req.query.error === "string" ? req.query.error : "";

    if (!/^[A-Za-z0-9_-]{43}$/.test(providerState)) {
      res
        .status(400)
        .send(errorPage("Invalid or expired session. Please try again.", ""));
      return;
    }

    let attempt;
    try {
      attempt = await claimMobileOAuthAttempt(providerState);
    } catch (error) {
      req.log?.error(
        { errorType: error instanceof Error ? error.name : "UnknownError" },
        "OAuth callback persistence failed",
      );
      res
        .status(503)
        .send(errorPage("Sign-in is temporarily unavailable.", ""));
      return;
    }
    if (!attempt) {
      res
        .status(400)
        .send(errorPage("Invalid or expired session. Please try again.", ""));
      return;
    }

    if (providerError) {
      await deleteMobileOAuthAttempt(attempt.id).catch(() => undefined);
      res
        .status(400)
        .send(errorPage("Sign-in was cancelled or failed.", providerError));
      return;
    }
    if (!code || code.length > 4096) {
      await deleteMobileOAuthAttempt(attempt.id).catch(() => undefined);
      res.status(400).send(errorPage("Missing authorization code.", ""));
      return;
    }

    let config;
    try {
      config = loadGoogleOAuthConfig(process.env, req.get("host") ?? "");
    } catch {
      await deleteMobileOAuthAttempt(attempt.id).catch(() => undefined);
      res.status(503).send(errorPage("Google sign-in is not configured.", ""));
      return;
    }
    const callbackUrl = `https://${config.serverDomain}/api/auth/google-callback`;

    try {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: callbackUrl,
          grant_type: "authorization_code",
        }),
        signal: AbortSignal.timeout(15_000),
      });

      const tokenData = (await tokenResponse.json()) as {
        id_token?: string;
        error?: string;
        error_description?: string;
      };

      if (!tokenResponse.ok || !tokenData.id_token) {
        req.log?.warn(
          {
            providerStatus: tokenResponse.status,
            providerError: tokenData.error ?? "missing_id_token",
          },
          "Google token exchange failed",
        );
        await deleteMobileOAuthAttempt(attempt.id).catch(() => undefined);
        res
          .status(502)
          .send(
            errorPage(
              "Failed to complete sign-in.",
              tokenData.error_description ||
                tokenData.error ||
                "Token exchange failed",
            ),
          );
        return;
      }

      const idToken = tokenData.id_token;
      if (attempt.mode === "popup") {
        await deleteMobileOAuthAttempt(attempt.id);
        const popupOrigin = `https://${config.serverDomain}`;
        res.setHeader("Cache-Control", "no-store");
        res.type("html").send(`<!DOCTYPE html>
<html><head><title>Sign In Complete</title></head>
<body><script>
if (window.opener) {
  window.opener.postMessage({
    type: 'elovia-auth',
    idToken: ${JSON.stringify(idToken)},
    state: ${JSON.stringify(attempt.clientState)}
  }, ${JSON.stringify(popupOrigin)});
  window.close();
} else {
  document.body.textContent = 'Sign-in complete. You can close this window.';
}
</script></body></html>`);
        return;
      }

      if (!attempt.returnUrl) {
        await deleteMobileOAuthAttempt(attempt.id).catch(() => undefined);
        res.status(400).send(errorPage("No return URL specified.", ""));
        return;
      }
      const exchangeCode = await finalizeMobileOAuthExchange({
        attempt,
        providerToken: idToken,
        encryptionSecret: config.clientSecret,
      });
      if (!exchangeCode) {
        throw new Error("OAuth exchange could not be finalized.");
      }
      res.setHeader("Cache-Control", "no-store");
      res.redirect(
        appendOAuthExchangeResult(attempt.returnUrl, {
          code: exchangeCode,
          state: attempt.clientState,
        }),
      );
    } catch (error) {
      req.log?.error(
        { errorType: error instanceof Error ? error.name : "UnknownError" },
        "Google OAuth callback failed",
      );
      res.status(500).send(errorPage("Server error during sign-in.", ""));
    }
  },
);

router.post(
  "/auth/google-mobile/exchange",
  exchangeOAuthLimit,
  async (req: Request, res: Response) => {
    const exchangeCode =
      typeof req.body?.code === "string" ? req.body.code : "";
    const clientState =
      typeof req.body?.state === "string" ? req.body.state : "";
    const codeVerifier =
      typeof req.body?.codeVerifier === "string" ? req.body.codeVerifier : "";
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(exchangeCode) ||
      !isValidOAuthClientState(clientState) ||
      !isValidPkceVerifier(codeVerifier)
    ) {
      res.status(400).json({ error: "Invalid sign-in exchange" });
      return;
    }

    let config;
    try {
      config = loadGoogleOAuthConfig(process.env, req.get("host") ?? "");
    } catch {
      res.status(503).json({ error: "Google sign-in is not configured" });
      return;
    }

    try {
      const redemption = await consumeMobileOAuthExchange({
        exchangeCode,
        clientState,
        codeVerifier,
        encryptionSecret: config.clientSecret,
      });
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
      if (redemption.status !== "redeemed") {
        res.status(400).json({ error: "Invalid or expired sign-in exchange" });
        return;
      }
      res.status(200).json({ idToken: redemption.providerToken });
    } catch (error) {
      req.log?.error(
        { errorType: error instanceof Error ? error.name : "UnknownError" },
        "OAuth redemption failed",
      );
      res.status(503).json({ error: "Sign-in is temporarily unavailable" });
    }
  },
);

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

function errorPage(message: string, detail: string): string {
  const safeMessage = escapeHtml(message);
  const safeDetail = escapeHtml(detail);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign In Error</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0A0A0F; color: #fff;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0;
    }
    .container { text-align: center; padding: 40px 24px; max-width: 400px; }
    h1 { font-size: 24px; margin-bottom: 16px; color: #FF4444; }
    p { color: #999; margin-bottom: 24px; font-size: 14px; }
    .detail { color: #666; font-size: 12px; word-break: break-all; }
    button {
      background: #00D4FF; color: #000; border: none; border-radius: 12px;
      padding: 14px 28px; font-size: 16px; font-weight: 600; cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Sign-In Error</h1>
    <p>${safeMessage}</p>
    ${safeDetail ? `<p class="detail">${safeDetail}</p>` : ""}
    <button onclick="window.history.back()">Go Back</button>
  </div>
</body>
</html>`;
}

export default router;
