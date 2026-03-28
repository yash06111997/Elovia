import { type Request, type Response, type NextFunction } from "express";
import { verifyFirebaseToken, type AuthUser } from "../lib/auth";
import { db, usersTable } from "@workspace/db";

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

  const user = await verifyFirebaseToken(idToken);
  if (user) {
    req.user = user;
    try {
      await db
        .insert(usersTable)
        .values({
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          profileImageUrl: user.profileImageUrl,
        })
        .onConflictDoUpdate({
          target: usersTable.id,
          set: {
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            profileImageUrl: user.profileImageUrl,
            updatedAt: new Date(),
          },
        });
    } catch {}
  }

  next();
}
