CREATE TABLE "community_memberships" (
  "user_id" varchar PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "terms_version" varchar(32) NOT NULL,
  "adult_attested" boolean NOT NULL,
  "accepted_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "community_membership_adult_attested" CHECK ("adult_attested" = true)
);

CREATE INDEX "IDX_community_memberships_terms"
  ON "community_memberships" ("terms_version", "revoked_at");

CREATE TABLE "ai_response_receipts" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "route" varchar(40) NOT NULL,
  "content_hash" varchar(64) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "ai_response_receipt_hash_valid" CHECK (
    "content_hash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "ai_response_receipt_expiry_valid" CHECK (
    "expires_at" > "created_at"
  )
);

CREATE INDEX "IDX_ai_response_receipts_cleanup"
  ON "ai_response_receipts" ("expires_at");
CREATE INDEX "IDX_ai_response_receipts_user"
  ON "ai_response_receipts" ("user_id", "created_at");

CREATE TABLE "content_reports" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "reporter_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "target_type" varchar(32) NOT NULL,
  "target_id" varchar(64) NOT NULL,
  "subject_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "reason" varchar(40) NOT NULL,
  "details" varchar(500),
  "content_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" varchar(20) NOT NULL DEFAULT 'queued',
  "priority" varchar(16) NOT NULL DEFAULT 'standard',
  "review_due_at" timestamptz NOT NULL,
  "resolved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "content_report_target_valid" CHECK (
    "target_type" IN ('activity','comment','user','ai_response')
  ),
  CONSTRAINT "content_report_status_valid" CHECK (
    "status" IN ('queued','reviewing','actioned','dismissed')
  ),
  CONSTRAINT "content_report_priority_valid" CHECK (
    "priority" IN ('standard','urgent')
  ),
  CONSTRAINT "content_report_reason_valid" CHECK (
    "reason" IN (
      'harassment','hate','sexual_content','self_harm','dangerous_advice',
      'privacy','spam','other'
    )
  ),
  CONSTRAINT "content_report_resolution_valid" CHECK (
    ("status" IN ('actioned','dismissed') AND "resolved_at" IS NOT NULL) OR
    ("status" IN ('queued','reviewing') AND "resolved_at" IS NULL)
  )
);

CREATE UNIQUE INDEX "UQ_content_reports_reporter_target"
  ON "content_reports" ("reporter_user_id", "target_type", "target_id");
CREATE INDEX "IDX_content_reports_queue"
  ON "content_reports" ("status", "priority", "review_due_at");
CREATE INDEX "IDX_content_reports_subject"
  ON "content_reports" ("subject_user_id", "created_at");

CREATE TABLE "moderation_audit_log" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "report_id" varchar(64) NOT NULL REFERENCES "content_reports"("id"),
  "actor_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "action" varchar(40) NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "IDX_moderation_audit_report"
  ON "moderation_audit_log" ("report_id", "created_at");

CREATE OR REPLACE FUNCTION community_moderation_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Community moderation audit history is append-only';
END;
$$;

CREATE TRIGGER "TR_community_moderation_audit_append_only"
  BEFORE UPDATE OR DELETE ON "moderation_audit_log"
  FOR EACH ROW EXECUTE FUNCTION community_moderation_audit_append_only();

COMMENT ON COLUMN "content_reports"."content_snapshot" IS 'SENSITIVE: user-reported fitness, health, or AI content; moderator access only';
COMMENT ON COLUMN "content_reports"."details" IS 'SENSITIVE: reporter-provided moderation context; moderator access only';
