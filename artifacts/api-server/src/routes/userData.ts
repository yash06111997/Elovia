import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  userDataTable,
  type InsertUserData,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { ZodError } from "zod";
import {
  buildUserDataPatch,
  parseUserDataWrite,
  revisionMatches,
  USER_DATA_FIELDS,
} from "./userDataContract";

const router: IRouter = Router();

type UserDataPatch = Partial<
  Omit<InsertUserData, "userId" | "revision" | "updatedAt">
>;

type ConflictResult = {
  kind: "conflict";
  currentRevision: number | null;
};

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
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const [row] = await db
      .select()
      .from(userDataTable)
      .where(eq(userDataTable.userId, req.user.id));

    if (!row) {
      res.json({ data: null, revision: null });
      return;
    }

    const data = Object.fromEntries(
      USER_DATA_FIELDS.map((field) => [field, row[field]]),
    );

    res.json({
      data,
      revision: row.revision,
      updatedAt: row.updatedAt.toISOString(),
    });
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

  const userId = req.user.id;

  try {
    const input = parseUserDataWrite(req.body);
    const patch = buildUserDataPatch(input) as UserDataPatch;

    const result = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ revision: userDataTable.revision })
        .from(userDataTable)
        .where(eq(userDataTable.userId, userId));

      const currentRevision = current?.revision ?? null;
      if (!revisionMatches(currentRevision, input.baseRevision)) {
        return {
          kind: "conflict" as const,
          currentRevision,
        } satisfies ConflictResult;
      }

      if (!current) {
        const [created] = await tx
          .insert(userDataTable)
          .values({ userId, ...patch, revision: 1 })
          .onConflictDoNothing({ target: userDataTable.userId })
          .returning({ revision: userDataTable.revision });

        if (created) {
          return { kind: "saved" as const, revision: created.revision };
        }

        // Another create won after our initial read. READ COMMITTED makes that
        // committed row visible to this statement, so report a typed conflict.
        const [winner] = await tx
          .select({ revision: userDataTable.revision })
          .from(userDataTable)
          .where(eq(userDataTable.userId, userId));

        return {
          kind: "conflict" as const,
          currentRevision: winner?.revision ?? null,
        } satisfies ConflictResult;
      }

      const [updated] = await tx
        .update(userDataTable)
        .set({
          ...patch,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(userDataTable.userId, userId),
            eq(userDataTable.revision, current.revision),
          ),
        )
        .returning({ revision: userDataTable.revision });

      if (updated) {
        return { kind: "saved" as const, revision: updated.revision };
      }

      const [latest] = await tx
        .select({ revision: userDataTable.revision })
        .from(userDataTable)
        .where(eq(userDataTable.userId, userId));

      return {
        kind: "conflict" as const,
        currentRevision: latest?.revision ?? current.revision,
      } satisfies ConflictResult;
    });

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
