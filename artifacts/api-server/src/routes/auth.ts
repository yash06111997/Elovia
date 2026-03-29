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

router.get("/auth/google-mobile", (req: Request, res: Response) => {
  const rawReturnUrl = (req.query.returnUrl as string) || "mobile://auth";

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
  const returnUrl = rawReturnUrl.replace(/['"\\<>]/g, "");
  const rawState = (req.query.state as string) || "";
  const state = rawState.replace(/['"\\<>]/g, "");

  const googleClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_WEB_CLIENT_ID || "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign In - FitAI</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0A0A0F;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .container {
      text-align: center;
      padding: 40px 24px;
      max-width: 400px;
    }
    h1 { font-size: 24px; margin-bottom: 8px; }
    p { color: #999; margin-bottom: 32px; font-size: 14px; }
    #g_id_onload, .g_id_signin { display: flex; justify-content: center; }
    .status { margin-top: 20px; color: #00D4FF; font-size: 14px; min-height: 20px; }
    .error { color: #FF4444; }
    .loading { color: #999; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>FitAI</h1>
    <p>Sign in with your Google account to continue</p>
    <div id="g_id_onload"
      data-client_id="${googleClientId}"
      data-callback="handleCredentialResponse"
      data-auto_prompt="false">
    </div>
    <div class="g_id_signin"
      data-type="standard"
      data-size="large"
      data-theme="filled_black"
      data-text="sign_in_with"
      data-shape="rectangular"
      data-logo_alignment="left"
      data-width="300">
    </div>
    <div class="status" id="status"></div>
  </div>

  <script>
    var RETURN_URL = '${returnUrl}';
    var STATE = '${state}';

    function handleCredentialResponse(response) {
      var status = document.getElementById('status');
      if (response && response.credential) {
        status.textContent = 'Success! Returning to app...';
        var separator = RETURN_URL.indexOf('?') !== -1 ? '&' : '?';
        var url = RETURN_URL + separator + 'idToken=' + encodeURIComponent(response.credential);
        if (STATE) { url += '&state=' + encodeURIComponent(STATE); }
        window.location.href = url;
      } else {
        status.textContent = 'Sign-in failed. Please try again.';
        status.className = 'status error';
      }
    }
  </script>
  <script src="https://accounts.google.com/gsi/client" async defer></script>
</body>
</html>`;

  res.type("html").send(html);
});

export default router;
