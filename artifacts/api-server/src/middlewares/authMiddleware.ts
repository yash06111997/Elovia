import { type Request, type Response, type NextFunction } from "express";
import { verifyFirebaseDeletionToken, type AuthUser } from "../lib/auth";
import {
  findAccountDeletionTombstone,
  provisionAuthenticatedUserIfActive,
} from "../lib/accountDeletion";
import { loadRevenueCatConfig } from "../lib/revenuecatConfig";
import { createRevenueCatAuthProvisioningCallback } from "../lib/revenuecatWorker";

declare global {
  namespace Express {
    interface User extends AuthUser {}

    interface Request {
      isAuthenticated(): this is AuthedRequest;

      user?: User | undefined;
    }

    export interface AuthedRequest {
      user: User;
    }
  }
}

function isAccountDeletionRequest(req: Request): boolean {
  return (
    (req.method === "DELETE" && req.path === "/api/account") ||
    (req.method === "GET" && req.path === "/api/account/deletion-status")
  );
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

type VerifiedFirebaseDeletionIdentity = Exclude<
  Awaited<ReturnType<typeof verifyFirebaseDeletionToken>>,
  null
>;

/** Apply an already verified identity; exported so DB-backed auth policy tests
 * do not need to forge or weaken Firebase token verification. */
export async function applyVerifiedFirebaseAuth(
  req: Request,
  res: Response,
  next: NextFunction,
  deletionVerification: VerifiedFirebaseDeletionIdentity,
): Promise<void> {
  const user = deletionVerification.user;
  const deletionRequest = isAccountDeletionRequest(req);
  try {
    if (deletionVerification.deletionFallback) {
      // A revoked/deleted identity is accepted only to finalize its existing
      // tombstone. Never provision a user from this narrow fallback.
      const tombstone = await findAccountDeletionTombstone(user.id);
      if (!tombstone) {
        next();
        return;
      }
      if (deletionRequest) {
        req.user = user;
        next();
      } else {
        res.status(410).json({
          error: "This Elovia account has been deleted",
          code: "deleted_account",
        });
      }
      return;
    }

    const revenueCatConfig = loadRevenueCatConfig(process.env);
    const provisioned = await provisionAuthenticatedUserIfActive(
      user,
      createRevenueCatAuthProvisioningCallback(user, revenueCatConfig),
    );
    if (provisioned === "deleted") {
      if (deletionRequest) {
        req.user = user;
        next();
        return;
      }
      res.status(410).json({
        error: "This Elovia account has been deleted",
        code: "deleted_account",
      });
      return;
    }
    req.user = user;
  } catch (error) {
    req.log.error(
      { errorType: errorType(error) },
      "Authentication account-state check failed",
    );
    res.status(503).json({
      error: "Authentication is temporarily unavailable",
      code: "authentication_unavailable",
    });
    return;
  }

  next();
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request["isAuthenticated"];

  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    next();
    return;
  }

  const idToken = authHeader.slice(7);
  if (!idToken) {
    next();
    return;
  }

  const deletionVerification = await verifyFirebaseDeletionToken(idToken);
  if (!deletionVerification) {
    next();
    return;
  }
  await applyVerifiedFirebaseAuth(req, res, next, deletionVerification);
}
