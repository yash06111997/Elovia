ALTER TABLE "account_deletions"
	ADD COLUMN "identity_attempt_count" integer DEFAULT 0 NOT NULL,
	ADD COLUMN "identity_next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	ADD COLUMN "identity_lease_id" varchar(128),
	ADD COLUMN "identity_lease_until" timestamp with time zone,
	ADD COLUMN "identity_last_attempt_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "IDX_account_deletions_identity_retry" ON "account_deletions" USING btree ("status", "identity_next_attempt_at", "identity_lease_until");
