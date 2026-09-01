CREATE TABLE "account_deletions" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"request_id" varchar(128) NOT NULL,
	"status" varchar(32) DEFAULT 'identity_pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data_deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_deletions_status_valid" CHECK ("account_deletions"."status" IN ('identity_pending', 'finalized'))
);
--> statement-breakpoint
CREATE INDEX "IDX_account_deletions_status" ON "account_deletions" USING btree ("status");
