import { db, userDataTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  buildUserDataPatch,
  MAX_SYNC_REVISION,
  revisionMatches,
  USER_DATA_FIELDS,
  type UserDataWrite,
} from "../routes/userDataContract";

export type UserDataDatabase = typeof db;

export type SaveUserDataResult =
  | { kind: "saved"; revision: number }
  | { kind: "conflict"; currentRevision: number | null };

export class SyncRevisionLimitError extends Error {
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super("The cloud snapshot revision limit has been reached.");
    this.name = "SyncRevisionLimitError";
    this.currentRevision = currentRevision;
  }
}

function assertSafeRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("Cloud snapshot has an invalid server revision.");
  }
}

export async function loadUserData(database: UserDataDatabase, userId: string) {
  const [row] = await database
    .select()
    .from(userDataTable)
    .where(eq(userDataTable.userId, userId));

  if (!row) {
    return { data: null, revision: null } as const;
  }

  assertSafeRevision(row.revision);

  const data = Object.fromEntries(
    USER_DATA_FIELDS.map((field) => [field, row[field]]),
  );

  return {
    data,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function saveUserData(
  database: UserDataDatabase,
  userId: string,
  input: UserDataWrite,
): Promise<SaveUserDataResult> {
  const patch = buildUserDataPatch(input);

  return database.transaction(
    async (tx) => {
      const [current] = await tx
        .select({ revision: userDataTable.revision })
        .from(userDataTable)
        .where(eq(userDataTable.userId, userId));

      const currentRevision = current?.revision ?? null;
      if (currentRevision !== null) {
        assertSafeRevision(currentRevision);
      }

      if (!revisionMatches(currentRevision, input.baseRevision)) {
        return { kind: "conflict", currentRevision };
      }

      if (!current) {
        const [created] = await tx
          .insert(userDataTable)
          .values({ userId, ...patch, revision: 1 })
          .onConflictDoNothing({ target: userDataTable.userId })
          .returning({ revision: userDataTable.revision });

        if (created) {
          return { kind: "saved", revision: created.revision };
        }

        const [winner] = await tx
          .select({ revision: userDataTable.revision })
          .from(userDataTable)
          .where(eq(userDataTable.userId, userId));

        if (winner) {
          assertSafeRevision(winner.revision);
        }

        return {
          kind: "conflict",
          currentRevision: winner?.revision ?? null,
        };
      }

      if (current.revision >= MAX_SYNC_REVISION) {
        throw new SyncRevisionLimitError(current.revision);
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
        return { kind: "saved", revision: updated.revision };
      }

      const [latest] = await tx
        .select({ revision: userDataTable.revision })
        .from(userDataTable)
        .where(eq(userDataTable.userId, userId));

      if (latest) {
        assertSafeRevision(latest.revision);
      }

      return {
        kind: "conflict",
        currentRevision: latest?.revision ?? null,
      };
    },
    { isolationLevel: "read committed" },
  );
}
