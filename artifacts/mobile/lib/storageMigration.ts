export const STORAGE_NAMESPACE_MIGRATION_FLAG = "@elovia_storage_namespace_v1";

const LEGACY_KEYS = [
  "@fitai_state",
  "@fitai_plan",
  "@fitai_custom_plans",
  "@fitai_active_plan_type",
  "@fitai_active_custom_plan_id",
  "@fitai_sessions",
  "@fitai_prs",
  "@fitai_active_session",
  "@fitai_meal_plan",
  "@fitai_food_log",
  "@fitai_custom_meal_plans",
  "@fitai_active_meal_plan_type",
  "@fitai_active_custom_meal_plan_id",
  "@fitai_health_data",
  "@fitai_auth_user",
  "@fitai_auth_token",
  "@fitai_subscription",
] as const;

const REMOVED_ONLY_KEYS = new Set<string>([
  "@fitai_auth_user",
  "@fitai_auth_token",
  "@fitai_subscription",
]);

const DEPRECATED_CURRENT_KEYS = [
  "@elovia_auth_user",
  "@elovia_auth_token",
  "@elovia_subscription",
];

export interface StorageMigrationPlan {
  writes: [string, string][];
  remove: string[];
}

export function planStorageNamespaceMigration(
  entries: readonly (readonly [string, string | null])[],
): StorageMigrationPlan {
  const values = new Map(entries);
  const writes: [string, string][] = [];
  const remove: string[] = [];

  for (const oldKey of LEGACY_KEYS) {
    const oldValue = values.get(oldKey);
    if (oldValue == null) continue;

    if (REMOVED_ONLY_KEYS.has(oldKey)) {
      remove.push(oldKey);
      continue;
    }

    const newKey = oldKey.replace("@fitai_", "@elovia_");
    if (values.get(newKey) == null) writes.push([newKey, oldValue]);
    remove.push(oldKey);
  }

  return { writes, remove };
}

interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  multiGet(
    keys: string[],
  ): Promise<readonly (readonly [string, string | null])[]>;
  multiSet(entries: [string, string][]): Promise<void>;
  multiRemove(keys: string[]): Promise<void>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * Copy legacy values before providers read them. Existing @elovia values win,
 * and legacy keys are removed only after all required writes succeed.
 */
export async function migrateStorageNamespace(
  storage: StorageAdapter,
): Promise<void> {
  // Firebase owns its credential persistence; remove the former duplicate ID
  // token and profile cache even when the namespace migration already ran.
  await storage.multiRemove(DEPRECATED_CURRENT_KEYS);
  if (await storage.getItem(STORAGE_NAMESPACE_MIGRATION_FLAG)) return;

  const oldKeys = [...LEGACY_KEYS];
  const newKeys = oldKeys.map((key) => key.replace("@fitai_", "@elovia_"));
  const entries = await storage.multiGet([...oldKeys, ...newKeys]);
  const migration = planStorageNamespaceMigration(entries);

  if (migration.writes.length > 0) await storage.multiSet(migration.writes);
  if (migration.remove.length > 0) await storage.multiRemove(migration.remove);
  await storage.setItem(
    STORAGE_NAMESPACE_MIGRATION_FLAG,
    new Date().toISOString(),
  );
}
