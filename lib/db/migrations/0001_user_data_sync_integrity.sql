ALTER TABLE "user_data" ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1;
ALTER TABLE "user_data" ADD COLUMN IF NOT EXISTS "active_session" jsonb;
ALTER TABLE "user_data" ADD COLUMN IF NOT EXISTS "wellness_data" jsonb;
ALTER TABLE "user_data" ADD COLUMN IF NOT EXISTS "water_goal" jsonb;
ALTER TABLE "user_data" ADD COLUMN IF NOT EXISTS "reminder_prefs" jsonb;
ALTER TABLE "user_data" ADD COLUMN IF NOT EXISTS "places" jsonb;
