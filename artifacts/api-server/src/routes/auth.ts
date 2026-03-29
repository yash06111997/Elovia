import { Router, type IRouter, type Request, type Response } from "express";

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

const pendingAuthStates = new Map<string, { returnUrl: string; mode: string; expiresAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingAuthStates) {
    if (val.expiresAt < now) pendingAuthStates.delete(key);
  }
}, 60000);

router.get("/auth/google-mobile", (req: Request, res: Response) => {
  const mode = (req.query.mode as string) || "redirect";
  const rawReturnUrl = (req.query.returnUrl as string) || "";
  const rawState = (req.query.state as string) || "";

  if (mode === "redirect" && rawReturnUrl) {
    const mobileSchemes = ["mobile://", "exp://", "exps://"];
    const isMobileScheme = mobileSchemes.some((scheme) => rawReturnUrl.startsWith(scheme));

    let isHttpsAllowed = false;
    if (rawReturnUrl.startsWith("https://") || rawReturnUrl.startsWith("http://localhost")) {
      try {
        const parsedUrl = new URL(rawReturnUrl);
        const replitDevDomain = process.env.REPLIT_DEV_DOMAIN || "";
        const allowedHttpHosts = [
          "localhost",
          ...(replitDevDomain ? [replitDevDomain] : []),
        ];
        isHttpsAllowed = allowedHttpHosts.some(
          (host) => parsedUrl.hostname === host || parsedUrl.hostname.endsWith(`.${host}`)
        );
      } catch {
        isHttpsAllowed = false;
      }
    }

    if (!isMobileScheme && !isHttpsAllowed) {
      res.status(400).json({ error: "Invalid return URL scheme" });
      return;
    }
  }

  const returnUrl = rawReturnUrl.replace(/['"\\<>]/g, "");
  const state = rawState.replace(/['"\\<>]/g, "");

  const googleClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_WEB_CLIENT_ID || "";
  const replitDevDomain = process.env.REPLIT_DEV_DOMAIN || "";
  const callbackUrl = `https://${replitDevDomain}/api/auth/google-callback`;

  const oauthState = `${state}|${Date.now()}`;
  pendingAuthStates.set(oauthState, {
    returnUrl,
    mode,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleAuthUrl.searchParams.set("client_id", googleClientId);
  googleAuthUrl.searchParams.set("redirect_uri", callbackUrl);
  googleAuthUrl.searchParams.set("response_type", "code");
  googleAuthUrl.searchParams.set("scope", "openid email profile");
  googleAuthUrl.searchParams.set("state", oauthState);
  googleAuthUrl.searchParams.set("access_type", "offline");
  googleAuthUrl.searchParams.set("prompt", "consent");

  res.redirect(googleAuthUrl.toString());
});

router.get("/auth/google-callback", async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const oauthState = req.query.state as string;
  const error = req.query.error as string;

  if (error) {
    res.status(400).send(errorPage("Sign-in was cancelled or failed.", error));
    return;
  }

  if (!code || !oauthState) {
    res.status(400).send(errorPage("Missing authorization code.", ""));
    return;
  }

  const pending = pendingAuthStates.get(oauthState);
  if (!pending) {
    res.status(400).send(errorPage("Invalid or expired session. Please try again.", ""));
    return;
  }
  pendingAuthStates.delete(oauthState);

  const googleClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_WEB_CLIENT_ID || "";
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  const replitDevDomain = process.env.REPLIT_DEV_DOMAIN || "";
  const callbackUrl = `https://${replitDevDomain}/api/auth/google-callback`;

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: googleClientId,
        client_secret: googleClientSecret,
        redirect_uri: callbackUrl,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenResponse.json() as { id_token?: string; error?: string; error_description?: string };

    if (!tokenResponse.ok || !tokenData.id_token) {
      console.error("Token exchange failed:", tokenData);
      res.status(500).send(errorPage(
        "Failed to complete sign-in.",
        tokenData.error_description || tokenData.error || "Token exchange failed"
      ));
      return;
    }

    const idToken = tokenData.id_token;
    const appState = oauthState.split("|")[0];

    if (pending.mode === "popup") {
      res.type("html").send(`<!DOCTYPE html>
<html><head><title>Sign In Complete</title></head>
<body><script>
if (window.opener) {
  window.opener.postMessage({
    type: 'fitai-auth',
    idToken: ${JSON.stringify(idToken)},
    state: ${JSON.stringify(appState)}
  }, '*');
  window.close();
} else {
  document.body.textContent = 'Sign-in complete. You can close this window.';
}
</script></body></html>`);
    } else {
      const returnUrl = pending.returnUrl;
      if (!returnUrl) {
        res.status(400).send(errorPage("No return URL specified.", ""));
        return;
      }
      const separator = returnUrl.includes("?") ? "&" : "?";
      let url = `${returnUrl}${separator}idToken=${encodeURIComponent(idToken)}`;
      if (appState) {
        url += `&state=${encodeURIComponent(appState)}`;
      }
      res.redirect(url);
    }
  } catch (err) {
    console.error("Google token exchange error:", err);
    res.status(500).send(errorPage("Server error during sign-in.", String(err)));
  }
});

function errorPage(message: string, detail: string): string {
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
    <p>${message}</p>
    ${detail ? `<p class="detail">${detail}</p>` : ""}
    <button onclick="window.history.back()">Go Back</button>
  </div>
</body>
</html>`;
}

export default router;
