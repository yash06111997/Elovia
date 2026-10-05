-- Webhook evidence must never masquerade as an authenticated identity. Repair
-- any legacy rows allowed by the original constraint before strengthening it.
UPDATE "revenuecat_customer_aliases"
SET "alias_kind" = 'ordinary',
    "updated_at" = clock_timestamp()
WHERE "ownership_source" = 'webhook'
  AND "alias_kind" = 'authenticated';

ALTER TABLE "revenuecat_customer_aliases"
  DROP CONSTRAINT "revenuecat_alias_provenance_valid";

ALTER TABLE "revenuecat_customer_aliases"
  ADD CONSTRAINT "revenuecat_alias_provenance_valid" CHECK (
    ("ownership_source" = 'webhook' AND "alias_kind" <> 'authenticated' AND
      "source_event_at" > '1970-01-01T00:00:00Z'::timestamptz AND
      "source_event_id" ~ '^[A-Za-z0-9_-]{8,128}$' AND
      "authenticated_at" IS NULL) OR
    ("ownership_source" = 'authenticated' AND "alias_kind" = 'authenticated' AND
      "source_event_at" IS NULL AND "source_event_id" IS NULL AND
      "authenticated_at" > '1970-01-01T00:00:00Z'::timestamptz)
  );
