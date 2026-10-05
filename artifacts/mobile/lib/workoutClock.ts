export function elapsedWorkoutSeconds(session: { id: string; startedAt?: number }, now = Date.now(), fallbackSeconds = 0): number {
  const legacyStart = Number(session.id);
  const startedAt = session.startedAt ?? (legacyStart > 1_000_000_000_000 ? legacyStart : now - fallbackSeconds * 1000);
  return Number.isFinite(startedAt) ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
}
