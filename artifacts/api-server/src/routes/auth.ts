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
  const allowedSchemes = ["mobile://", "exp://", "exps://"];
  const isAllowed = allowedSchemes.some((scheme) => rawReturnUrl.startsWith(scheme));
  if (!isAllowed) {
    res.status(400).json({ error: "Invalid return URL scheme" });
    return;
  }
  const returnUrl = rawReturnUrl.replace(/['"\\<>]/g, "");
  const rawState = (req.query.state as string) || "";
  const state = rawState.replace(/['"\\<>]/g, "");

  const firebaseConfig = {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || "",
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "",
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID || "",
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID || "",
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign In</title>
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
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      background: #fff;
      color: #333;
      border: none;
      border-radius: 12px;
      padding: 14px 28px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      justify-content: center;
    }
    .btn:hover { background: #f0f0f0; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn svg { width: 20px; height: 20px; }
    .status { margin-top: 20px; color: #00D4FF; font-size: 14px; min-height: 20px; }
    .error { color: #FF4444; }
  </style>
</head>
<body>
  <div class="container">
    <h1>FitAI</h1>
    <p>Sign in with your Google account to continue</p>
    <button class="btn" id="signInBtn" onclick="doSignIn()">
      <svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
      Sign in with Google
    </button>
    <div class="status" id="status"></div>
  </div>

  <script type="module">
    import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js';
    import { getAuth, GoogleAuthProvider, signInWithRedirect, getRedirectResult } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';

    const firebaseConfig = ${JSON.stringify(firebaseConfig)};
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const RETURN_URL = '${returnUrl}';
    const STATE = '${state}';

    function redirectToApp(idToken) {
      const separator = RETURN_URL.includes('?') ? '&' : '?';
      let url = RETURN_URL + separator + 'idToken=' + encodeURIComponent(idToken);
      if (STATE) { url += '&state=' + encodeURIComponent(STATE); }
      window.location.href = url;
    }

    getRedirectResult(auth).then(async (result) => {
      if (result && result.user) {
        const status = document.getElementById('status');
        status.textContent = 'Success! Returning to app...';
        const idToken = await result.user.getIdToken();
        redirectToApp(idToken);
      }
    }).catch((err) => {
      console.error('Redirect result error:', err);
    });

    window.doSignIn = async function() {
      const btn = document.getElementById('signInBtn');
      const status = document.getElementById('status');
      btn.disabled = true;
      status.textContent = 'Redirecting to Google...';
      status.className = 'status';

      try {
        const provider = new GoogleAuthProvider();
        await signInWithRedirect(auth, provider);
      } catch (err) {
        console.error('Sign-in error:', err);
        status.textContent = err.message || 'Sign-in failed. Please try again.';
        status.className = 'status error';
        btn.disabled = false;
      }
    };
  </script>
</body>
</html>`;

  res.type("html").send(html);
});

export default router;
