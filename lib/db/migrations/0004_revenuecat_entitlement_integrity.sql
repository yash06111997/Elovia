CREATE TABLE "revenuecat_webhook_events" (
  "event_id" varchar(128) COLLATE "C" PRIMARY KEY,
  "type" varchar(64) NOT NULL,
  "event_at" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "environment" varchar(16),
  "disposition" varchar(32) NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "identity_count" integer NOT NULL,
  "retained_identity_count" integer NOT NULL DEFAULT 0,
  "pruned_identity_count" integer NOT NULL DEFAULT 0,
  "identity_required" boolean NOT NULL,
  "identity_applied_at" timestamptz,
  "entitlement_required" boolean NOT NULL,
  "entitlement_applied_at" timestamptz,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "processing_lease_id" varchar(128),
  "processing_lease_until" timestamptz,
  "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
  "processed_at" timestamptz,
  "retention_until" timestamptz NOT NULL,
  CONSTRAINT "revenuecat_event_identity_valid" CHECK (
    "event_id" ~ '^[A-Za-z0-9_-]{8,128}$' AND
    "type" ~ '^[A-Z0-9_]{3,64}$' AND
    "event_at" > '1970-01-01T00:00:00Z'::timestamptz
  ),
  CONSTRAINT "revenuecat_event_environment_valid"
    CHECK ("environment" IS NULL OR "environment" IN ('production','sandbox')),
  CONSTRAINT "revenuecat_event_disposition_valid"
    CHECK ("disposition" IN ('pending','applied','stale','ignored_unknown')),
  CONSTRAINT "revenuecat_event_metadata_object" CHECK (jsonb_typeof("metadata") = 'object'),
  CONSTRAINT "revenuecat_event_identity_count_valid" CHECK (
    "identity_count" BETWEEN 0 AND 256 AND
    "retained_identity_count" BETWEEN 0 AND "identity_count" AND
    "pruned_identity_count" BETWEEN 0 AND "identity_count" AND
    "retained_identity_count" + "pruned_identity_count" <= "identity_count"
  ),
  CONSTRAINT "revenuecat_event_phase_fields_valid" CHECK (
    "identity_required" = ("identity_count" > 0) AND
    (NOT "entitlement_required" OR "identity_required") AND
    ("identity_required" OR "identity_applied_at" IS NULL) AND
    ("entitlement_required" OR "entitlement_applied_at" IS NULL)
  ),
  CONSTRAINT "revenuecat_event_attempt_valid" CHECK ("attempt_count" >= 0),
  CONSTRAINT "revenuecat_event_lease_consistent" CHECK (
    ("processing_lease_id" IS NULL) = ("processing_lease_until" IS NULL) AND
    ("processing_lease_id" IS NULL OR length("processing_lease_id") BETWEEN 8 AND 128)
  ),
  CONSTRAINT "revenuecat_event_state_consistent" CHECK (
    ("disposition" = 'pending' AND "processed_at" IS NULL) OR
    ("disposition" IN ('applied','stale') AND "processed_at" IS NOT NULL AND
      (NOT "identity_required" OR "identity_applied_at" IS NOT NULL) AND
      (NOT "entitlement_required" OR "entitlement_applied_at" IS NOT NULL) AND
      "processing_lease_id" IS NULL AND "processing_lease_until" IS NULL) OR
    ("disposition" = 'ignored_unknown' AND "processed_at" IS NOT NULL AND
      "identity_count" = 0 AND "identity_required" = false AND
      "entitlement_required" = false AND "identity_applied_at" IS NULL AND
      "entitlement_applied_at" IS NULL AND
      "processing_lease_id" IS NULL AND "processing_lease_until" IS NULL)
  ),
  CONSTRAINT "revenuecat_event_schedule_valid" CHECK (
    "next_attempt_at" >= "received_at" AND
    ("identity_applied_at" IS NULL OR "identity_applied_at" >= "received_at") AND
    ("entitlement_applied_at" IS NULL OR "entitlement_applied_at" >= "received_at") AND
    ("processed_at" IS NULL OR (
      "processed_at" >= "received_at" AND
      ("identity_applied_at" IS NULL OR "processed_at" >= "identity_applied_at") AND
      ("entitlement_applied_at" IS NULL OR "processed_at" >= "entitlement_applied_at")
    ))
  ),
  CONSTRAINT "revenuecat_event_retention_valid" CHECK ("retention_until" > "received_at")
);

CREATE TABLE "revenuecat_event_subjects" (
  "event_id" varchar(128) COLLATE "C" NOT NULL
    REFERENCES "revenuecat_webhook_events"("event_id") ON DELETE CASCADE,
  "subject_hash" char(64) NOT NULL,
  "role_mask" smallint NOT NULL,
  "local_user_id" varchar REFERENCES "users"("id") ON DELETE CASCADE,
  PRIMARY KEY ("event_id","subject_hash"),
  CONSTRAINT "revenuecat_subject_hash_valid" CHECK ("subject_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "revenuecat_subject_role_mask_valid" CHECK ("role_mask" BETWEEN 1 AND 127)
);

-- role_mask bits: primary=1, original=2, alias=4, transferred_from=8,
-- transferred_to=16, redeemed_from=32, redeemed_by=64.
CREATE FUNCTION "revenuecat_guard_event_capacity"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() = 1 AND (
    NEW."retained_identity_count" IS DISTINCT FROM OLD."retained_identity_count" OR
    NEW."pruned_identity_count" IS DISTINCT FROM OLD."pruned_identity_count"
  ) THEN
    RAISE EXCEPTION 'RevenueCat event capacity counters are trigger-managed'
      USING ERRCODE = '23514',
            CONSTRAINT = 'revenuecat_event_capacity_counters_managed',
            TABLE = 'revenuecat_webhook_events';
  END IF;

  IF NEW."retained_identity_count" + NEW."pruned_identity_count" > NEW."identity_count" THEN
    RAISE EXCEPTION 'RevenueCat event identity capacity is below retained and pruned subjects'
      USING ERRCODE = '23514',
            CONSTRAINT = 'revenuecat_event_subject_capacity_valid',
            TABLE = 'revenuecat_webhook_events';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "TR_revenuecat_guard_event_capacity"
BEFORE UPDATE OF "identity_count", "retained_identity_count", "pruned_identity_count"
ON "revenuecat_webhook_events"
FOR EACH ROW EXECUTE FUNCTION "revenuecat_guard_event_capacity"();

CREATE FUNCTION "revenuecat_reserve_subject_capacity"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."event_id" IS DISTINCT FROM OLD."event_id" OR
       NEW."subject_hash" IS DISTINCT FROM OLD."subject_hash" THEN
      RAISE EXCEPTION 'RevenueCat event subject identity is immutable'
        USING ERRCODE = '23514',
              CONSTRAINT = 'revenuecat_subject_identity_immutable',
              TABLE = 'revenuecat_event_subjects';
    END IF;
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM "revenuecat_webhook_events"
  WHERE "event_id" = NEW."event_id"
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  UPDATE "revenuecat_webhook_events"
  SET "retained_identity_count" = "retained_identity_count" + 1
  WHERE "event_id" = NEW."event_id"
    AND "retained_identity_count" + "pruned_identity_count" < "identity_count";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RevenueCat event subject capacity exceeded'
      USING ERRCODE = '23514',
            CONSTRAINT = 'revenuecat_subject_capacity_valid',
            TABLE = 'revenuecat_event_subjects';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "TR_revenuecat_reserve_subject_capacity"
BEFORE INSERT OR UPDATE OF "event_id", "subject_hash"
ON "revenuecat_event_subjects"
FOR EACH ROW EXECUTE FUNCTION "revenuecat_reserve_subject_capacity"();

CREATE FUNCTION "revenuecat_count_pruned_subject"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "revenuecat_webhook_events"
  SET "retained_identity_count" = "retained_identity_count" - 1,
      "pruned_identity_count" = "pruned_identity_count" + 1
  WHERE "event_id" = OLD."event_id";
  RETURN OLD;
END;
$$;

CREATE TRIGGER "TR_revenuecat_count_pruned_subject"
AFTER DELETE ON "revenuecat_event_subjects"
FOR EACH ROW EXECUTE FUNCTION "revenuecat_count_pruned_subject"();

-- Both counters are trigger-managed. Subject insertion reserves retained capacity
-- while holding the parent row lock; deletion atomically converts one retained slot
-- into one pruned slot. Parent event deletion cascades after the parent is gone and
-- therefore updates zero rows without retaining deleted subject hashes.

CREATE TABLE "revenuecat_customer_aliases" (
  "alias_hash" char(64) PRIMARY KEY,
  "local_user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "alias_kind" varchar(32) NOT NULL,
  "ownership_source" varchar(16) NOT NULL,
  "source_event_at" timestamptz,
  "source_event_id" varchar(128) COLLATE "C",
  "authenticated_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "revenuecat_alias_hash_valid" CHECK ("alias_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "revenuecat_alias_kind_valid" CHECK (
    "alias_kind" IN ('authenticated','anonymous','original','ordinary','transferred')
  ),
  CONSTRAINT "revenuecat_alias_ownership_source_valid" CHECK (
    "ownership_source" IN ('webhook','authenticated')
  ),
  CONSTRAINT "revenuecat_alias_provenance_valid" CHECK (
    ("ownership_source" = 'webhook' AND
      "source_event_at" > '1970-01-01T00:00:00Z'::timestamptz AND
      "source_event_id" ~ '^[A-Za-z0-9_-]{8,128}$' AND
      "authenticated_at" IS NULL) OR
    ("ownership_source" = 'authenticated' AND "alias_kind" = 'authenticated' AND
      "source_event_at" IS NULL AND "source_event_id" IS NULL AND
      "authenticated_at" > '1970-01-01T00:00:00Z'::timestamptz)
  )
);

CREATE TABLE "revenuecat_customer_state" (
  "user_id" varchar PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "canonicalization_state" varchar(32) NOT NULL,
  "source_kind" varchar(32) NOT NULL,
  "source_environment" varchar(16),
  "last_snapshot_at" timestamptz,
  "last_operation_id" varchar(192) COLLATE "C",
  "last_reconciled_at" timestamptz,
  "reconcile_reason" varchar(32) NOT NULL,
  "reconcile_after" timestamptz NOT NULL,
  "reconcile_attempt_count" integer NOT NULL DEFAULT 0,
  "reconcile_lease_id" varchar(128),
  "reconcile_lease_until" timestamptz,
  "reconcile_last_error_code" varchar(64),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "revenuecat_customer_state_valid" CHECK (
    "canonicalization_state" IN ('legacy_unverified','pending','canonical')
  ),
  CONSTRAINT "revenuecat_customer_source_kind_valid" CHECK (
    "source_kind" IN ('none','legacy_unverified','webhook_canonical','bootstrap_canonical','auth_canonical','worker_canonical')
  ),
  CONSTRAINT "revenuecat_customer_environment_valid" CHECK (
    "source_environment" IS NULL OR "source_environment" IN ('production','sandbox')
  ),
  CONSTRAINT "revenuecat_customer_reason_valid" CHECK (
    "reconcile_reason" IN ('legacy_bootstrap','webhook_failure','authenticated','on_demand','scheduled')
  ),
  CONSTRAINT "revenuecat_customer_attempt_valid" CHECK ("reconcile_attempt_count" >= 0),
  CONSTRAINT "revenuecat_customer_schedule_valid" CHECK (
    "reconcile_after" > '1970-01-01T00:00:00Z'::timestamptz AND
    ("last_snapshot_at" IS NULL OR "last_snapshot_at" > '1970-01-01T00:00:00Z'::timestamptz) AND
    ("last_reconciled_at" IS NULL OR "last_reconciled_at" > '1970-01-01T00:00:00Z'::timestamptz)
  ),
  CONSTRAINT "revenuecat_customer_lease_consistent" CHECK (
    ("reconcile_lease_id" IS NULL) = ("reconcile_lease_until" IS NULL) AND
    ("reconcile_lease_id" IS NULL OR length("reconcile_lease_id") BETWEEN 8 AND 128)
  ),
  CONSTRAINT "revenuecat_customer_error_code_valid" CHECK (
    "reconcile_last_error_code" IS NULL OR
      "reconcile_last_error_code" ~ '^[a-z0-9_]{3,64}$'
  ),
  CONSTRAINT "revenuecat_customer_operation_valid" CHECK (
    "last_operation_id" IS NULL OR
    "last_operation_id" ~ '^(webhook:[A-Za-z0-9_-]{8,128}|bootstrap:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|auth:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|worker:[A-Za-z0-9_-]{8,128})$'
  ),
  CONSTRAINT "revenuecat_customer_operation_source_consistent" CHECK (
    "last_operation_id" IS NULL OR
    ("source_kind" = 'webhook_canonical' AND "last_operation_id" LIKE 'webhook:%') OR
    ("source_kind" = 'bootstrap_canonical' AND "last_operation_id" LIKE 'bootstrap:%') OR
    ("source_kind" = 'auth_canonical' AND "last_operation_id" LIKE 'auth:%') OR
    ("source_kind" = 'worker_canonical' AND "last_operation_id" LIKE 'worker:%')
  ),
  CONSTRAINT "revenuecat_customer_canonical_consistent" CHECK (
    ("canonicalization_state" = 'legacy_unverified' AND "source_kind" = 'legacy_unverified' AND
      "source_environment" IS NULL AND "last_snapshot_at" IS NULL AND "last_operation_id" IS NULL) OR
    ("canonicalization_state" = 'pending' AND "source_kind" = 'none' AND
      "source_environment" IS NULL AND "last_snapshot_at" IS NULL AND "last_operation_id" IS NULL) OR
    ("canonicalization_state" = 'canonical' AND
      "source_kind" IN ('webhook_canonical','bootstrap_canonical','auth_canonical','worker_canonical') AND
      "source_environment" IS NOT NULL AND "last_snapshot_at" IS NOT NULL AND
      "last_operation_id" IS NOT NULL AND "last_reconciled_at" IS NOT NULL)
  )
);

CREATE TABLE "subscription_entitlements" (
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "entitlement_id" varchar(128) NOT NULL,
  "active" boolean NOT NULL DEFAULT false,
  "status" varchar(32) NOT NULL,
  "product_id" varchar(256),
  "store" varchar(32),
  "period_ends_at" timestamptz,
  "grace_ends_at" timestamptz,
  "access_ends_at" timestamptz,
  "will_renew" boolean NOT NULL DEFAULT false,
  "source_environment" varchar(16),
  "source_kind" varchar(32) NOT NULL,
  "source_snapshot_at" timestamptz NOT NULL,
  "source_operation_id" varchar(192) COLLATE "C" NOT NULL,
  "source_trigger_event_id" varchar(128) COLLATE "C"
    REFERENCES "revenuecat_webhook_events"("event_id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id","entitlement_id"),
  CONSTRAINT "subscription_entitlement_id_valid"
    CHECK (length(btrim("entitlement_id")) BETWEEN 1 AND 128),
  CONSTRAINT "subscription_entitlement_status_valid" CHECK (
    "status" IN ('active','trial','intro','prepaid','promotional','cancelled','billing_issue','grace','expired','refunded','paused')
  ),
  CONSTRAINT "subscription_entitlement_store_valid" CHECK (
    "store" IS NULL OR "store" IN ('app_store','mac_app_store','play_store','amazon','stripe','promotional','rc_billing','paddle','roku','test_store')
  ),
  CONSTRAINT "subscription_entitlement_environment_valid" CHECK (
    "source_environment" IS NULL OR "source_environment" IN ('production','sandbox')
  ),
  CONSTRAINT "subscription_entitlement_source_kind_valid" CHECK (
    "source_kind" IN ('legacy_unverified','webhook_canonical','bootstrap_canonical','auth_canonical','worker_canonical')
  ),
  CONSTRAINT "subscription_entitlement_operation_valid" CHECK (
    "source_operation_id" = 'legacy' OR
    "source_operation_id" ~ '^(webhook:[A-Za-z0-9_-]{8,128}|bootstrap:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|auth:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|worker:[A-Za-z0-9_-]{8,128})$'
  ),
  CONSTRAINT "subscription_entitlement_operation_source_consistent" CHECK (
    ("source_kind" = 'legacy_unverified' AND "source_operation_id" = 'legacy') OR
    ("source_kind" = 'webhook_canonical' AND "source_operation_id" LIKE 'webhook:%') OR
    ("source_kind" = 'bootstrap_canonical' AND "source_operation_id" LIKE 'bootstrap:%') OR
    ("source_kind" = 'auth_canonical' AND "source_operation_id" LIKE 'auth:%') OR
    ("source_kind" = 'worker_canonical' AND "source_operation_id" LIKE 'worker:%')
  ),
  CONSTRAINT "subscription_entitlement_source_consistent" CHECK (
    ("source_kind" = 'legacy_unverified' AND "source_environment" IS NULL AND
      "entitlement_id" = '__legacy_unverified__' AND "active" = false AND
      "status" = 'expired' AND "product_id" IS NULL AND "store" IS NULL AND
      "period_ends_at" IS NULL AND "grace_ends_at" IS NULL AND
      "access_ends_at" IS NULL AND "will_renew" = false AND
      "source_snapshot_at" = '1970-01-01T00:00:00Z'::timestamptz AND
      "source_operation_id" = 'legacy' AND "source_trigger_event_id" IS NULL) OR
    ("source_kind" <> 'legacy_unverified' AND "source_environment" IS NOT NULL AND
      "source_snapshot_at" > '1970-01-01T00:00:00Z'::timestamptz AND
      ("source_kind" = 'webhook_canonical' OR "source_trigger_event_id" IS NULL))
  ),
  CONSTRAINT "subscription_entitlement_active_status_valid"
    CHECK ("active" = ("status" NOT IN ('expired','refunded'))),
  CONSTRAINT "subscription_entitlement_renewal_valid" CHECK (
    "will_renew" = false OR
    ("active" = true AND "status" IN ('active','trial','intro','billing_issue','grace'))
  ),
  CONSTRAINT "subscription_entitlement_access_window_valid" CHECK (
    "status" = 'refunded' OR "access_ends_at" IS NULL OR
    "period_ends_at" IS NULL OR "access_ends_at" >= "period_ends_at"
  )
);

CREATE INDEX "IDX_revenuecat_events_type_time"
  ON "revenuecat_webhook_events" ("type","event_at" DESC);
CREATE INDEX "IDX_revenuecat_events_pending_due"
  ON "revenuecat_webhook_events" ("disposition","next_attempt_at","processing_lease_until","identity_applied_at","entitlement_applied_at");
CREATE INDEX "IDX_revenuecat_events_retention"
  ON "revenuecat_webhook_events" ("retention_until","disposition");
CREATE INDEX "IDX_revenuecat_event_subjects_local"
  ON "revenuecat_event_subjects" ("local_user_id","event_id");
CREATE INDEX "IDX_revenuecat_aliases_local"
  ON "revenuecat_customer_aliases" ("local_user_id");
CREATE INDEX "IDX_revenuecat_aliases_source"
  ON "revenuecat_customer_aliases" ("ownership_source","source_event_at","source_event_id");
CREATE INDEX "IDX_revenuecat_customer_reconcile_due"
  ON "revenuecat_customer_state" ("reconcile_after","reconcile_lease_until","user_id");
CREATE INDEX "IDX_subscription_entitlements_active"
  ON "subscription_entitlements" ("user_id","active","access_ends_at");
CREATE INDEX "IDX_subscription_entitlements_source"
  ON "subscription_entitlements" ("user_id","source_snapshot_at","source_operation_id");

INSERT INTO "revenuecat_customer_state" (
  "user_id","canonicalization_state","source_kind","reconcile_reason","reconcile_after"
)
SELECT u."id",
       CASE WHEN s."user_id" IS NULL THEN 'pending' ELSE 'legacy_unverified' END,
       CASE WHEN s."user_id" IS NULL THEN 'none' ELSE 'legacy_unverified' END,
       'legacy_bootstrap',now()
FROM "users" u
LEFT JOIN "subscriptions" s ON s."user_id" = u."id"
ON CONFLICT ("user_id") DO NOTHING;

INSERT INTO "subscription_entitlements" (
  "user_id","entitlement_id","active","status","will_renew",
  "source_kind","source_snapshot_at","source_operation_id"
)
SELECT "user_id",'__legacy_unverified__',false,'expired',false,
       'legacy_unverified','1970-01-01T00:00:00Z'::timestamptz,'legacy'
FROM "subscriptions" ON CONFLICT ("user_id","entitlement_id") DO NOTHING;

UPDATE "subscriptions"
SET "last_event" = NULL, "revenuecat_user_id" = "user_id"
WHERE "last_event" IS NOT NULL OR "revenuecat_user_id" IS DISTINCT FROM "user_id";

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_last_event_must_be_null" CHECK ("last_event" IS NULL),
  ADD CONSTRAINT "subscriptions_revenuecat_user_is_local" CHECK (
    "revenuecat_user_id" IS NULL OR "revenuecat_user_id" = "user_id"
  );
