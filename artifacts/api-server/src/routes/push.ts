import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/aiGate";
import {
  registerPushToken,
  unregisterPushToken,
  sendPushToUser,
  isValidExpoPushToken,
} from "../lib/push";

const router: IRouter = Router();

/** Register (or re-register) this device for push. */
router.post("/push/register", requireAuth, async (req: Request, res: Response) => {
  const { token, platform, deviceName } = req.body ?? {};

  if (!isValidExpoPushToken(token)) {
    res.status(400).json({ error: "A valid Expo push token is required", code: "bad_request" });
    return;
  }

  try {
    await registerPushToken({
      userId: req.user!.id,
      token,
      platform: typeof platform === "string" ? platform.slice(0, 20) : undefined,
      deviceName: typeof deviceName === "string" ? deviceName.slice(0, 100) : undefined,
    });
    res.json({ registered: true });
  } catch (err) {
    req.log.error({ err }, "Failed to register push token");
    res.status(500).json({ error: "Could not register for notifications" });
  }
});

router.post("/push/unregister", requireAuth, async (req: Request, res: Response) => {
  const { token } = req.body ?? {};

  if (!isValidExpoPushToken(token)) {
    res.status(400).json({ error: "A valid Expo push token is required", code: "bad_request" });
    return;
  }

  try {
    await unregisterPushToken(token);
    res.json({ unregistered: true });
  } catch (err) {
    req.log.error({ err }, "Failed to unregister push token");
    res.status(500).json({ error: "Could not disable notifications" });
  }
});

/**
 * Send a test notification to the caller's own devices.
 *
 * Deliberately scoped to `req.user.id` with no recipient parameter: an
 * endpoint that lets an authenticated user name a target is an endpoint that
 * lets them notify anyone.
 */
router.post("/push/test", requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await sendPushToUser(req.user!.id, {
      title: "Notifications are working",
      body: "This is a test from Elovia. You are all set.",
      data: { kind: "test" },
    });

    if (result.sent === 0) {
      res.status(409).json({
        error:
          "No active devices are registered for notifications. Enable them in the app first.",
        code: "no_devices",
        ...result,
      });
      return;
    }

    res.json({ ok: true, ...result });
  } catch (err) {
    req.log.error({ err }, "Failed to send test push");
    res.status(500).json({ error: "Could not send test notification" });
  }
});

export default router;
