const ALLOWED_DATABASE_CODES = new Set([
  "08001",
  "08006",
  "23503",
  "23505",
  "23514",
  "40001",
  "40P01",
  "53300",
  "57P01",
]);

export type SafeSnapshotErrorMetadata = {
  errorType: "USER_DATA_PERSISTENCE_ERROR";
  dbCode?: string;
};

function allowedDatabaseCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  try {
    const code = (value as { code?: unknown }).code;
    return typeof code === "string" &&
      /^[0-9A-Z]{5}$/.test(code) &&
      ALLOWED_DATABASE_CODES.has(code)
      ? code
      : undefined;
  } catch {
    return undefined;
  }
}

export function safeSnapshotErrorMetadata(
  error: unknown,
): SafeSnapshotErrorMetadata {
  const directCode = allowedDatabaseCode(error);
  let causeCode: string | undefined;

  if (!directCode && typeof error === "object" && error !== null) {
    try {
      causeCode = allowedDatabaseCode((error as { cause?: unknown }).cause);
    } catch {
      causeCode = undefined;
    }
  }

  const dbCode = directCode ?? causeCode;
  return dbCode
    ? { errorType: "USER_DATA_PERSISTENCE_ERROR", dbCode }
    : { errorType: "USER_DATA_PERSISTENCE_ERROR" };
}
