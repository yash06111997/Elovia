/**
 * Restore listeners must report load failures, while each provider still
 * resets its in-memory state before the failure reaches the aggregate barrier.
 */
export async function runProviderReload(
  resetDefaults: () => void,
  load: () => Promise<void>,
): Promise<void> {
  try {
    await load();
  } catch (error) {
    resetDefaults();
    throw error;
  }
}

export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseStoredJson<T>(
  raw: string,
  isValid: (value: unknown) => value is T,
): T {
  const value: unknown = JSON.parse(raw);
  if (!isValid(value))
    throw new TypeError("Stored provider data is malformed.");
  return value;
}

export function isNullablePlainRecord(
  value: unknown,
): value is Record<string, unknown> | null {
  return value === null || isPlainRecord(value);
}

export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
