import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { ZodError } from "zod";
import { parseUserDataWrite } from "./userDataContract";
import {
  loadUserData,
  saveUserData,
  SyncRevisionLimitError,
} from "../services/userDataStore";

const router: IRouter = Router();

function sendConflict(res: Response, currentRevision: number | null): void {
  res.status(409).json({
    error: {
      code: "SYNC_CONFLICT",
      message:
        "Cloud data changed since this device last synchronized. Restore the latest backup before retrying.",
      retryable: false,
    },
    currentRevision,
  });
}

router.get("/user-data", async (req: Request, res: Response) => {
  res.set("Cache-Control", "private, no-store");

  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    res.json(await loadUserData(db, req.user.id));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch user data");
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to fetch user data.",
        retryable: true,
      },
    });
  }
});

router.post("/user-data", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const input = parseUserDataWrite(req.body);
    const result = await saveUserData(db, req.user.id, input);

    if (result.kind === "conflict") {
      sendConflict(res, result.currentRevision);
      return;
    }

    res.status(200).json({ success: true, revision: result.revision });
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Cloud snapshot payload is invalid.",
          retryable: false,
        },
      });
      return;
    }

    if (err instanceof SyncRevisionLimitError) {
      res.status(409).json({
        error: {
          code: "SYNC_REVISION_EXHAUSTED",
          message:
            "This cloud snapshot can no longer be updated safely. Contact support before retrying.",
          retryable: false,
        },
        currentRevision: err.currentRevision,
      });
      return;
    }

    req.log.error({ err }, "Failed to save user data");
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to save user data.",
        retryable: true,
      },
    });
  }
});

export default router;
