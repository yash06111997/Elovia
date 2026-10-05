ALTER TABLE "user_data" ADD COLUMN IF NOT EXISTS "revision" bigint NOT NULL DEFAULT 1;
ALTER TABLE "user_data" ALTER COLUMN "revision" TYPE bigint USING "revision"::bigint;
ALTER TABLE "user_data" ADD COLUMN IF NOT EXISTS "active_session" jsonb;
ALTER TABLE "user_data" ADD COLUMN IF NOT EXISTS "wellness_data" jsonb;
ALTER TABLE "user_data" ADD COLUMN IF NOT EXISTS "water_goal" jsonb;
ALTER TABLE "user_data" ADD COLUMN IF NOT EXISTS "reminder_prefs" jsonb;
ALTER TABLE "user_data" ADD COLUMN IF NOT EXISTS "places" jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_data_revision_safe'
      AND conrelid = 'user_data'::regclass
  ) THEN
    ALTER TABLE "user_data"
      ADD CONSTRAINT "user_data_revision_safe"
      CHECK ("revision" >= 1 AND "revision" <= 9007199254740991);
  END IF;
END
$$;
