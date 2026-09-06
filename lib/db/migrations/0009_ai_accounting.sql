CREATE TABLE "ai_requests" (
  "id" varchar PRIMARY KEY NOT NULL,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "day" varchar NOT NULL,
  "route" varchar NOT NULL,
  "cost_ceiling_micros" integer NOT NULL,
  "status" varchar NOT NULL DEFAULT 'claimed',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ai_request_status_valid" CHECK ("status" IN ('claimed', 'started', 'closed')),
  CONSTRAINT "ai_request_ceiling_positive" CHECK ("cost_ceiling_micros" > 0)
);
CREATE INDEX "IDX_ai_requests_user_day" ON "ai_requests" ("user_id", "day");

CREATE TABLE "ai_attempts" (
  "id" varchar PRIMARY KEY NOT NULL,
  "request_id" varchar NOT NULL REFERENCES "ai_requests"("id") ON DELETE CASCADE,
  "provider" varchar NOT NULL,
  "model" varchar,
  "reserved_cost_micros" integer NOT NULL,
  "estimated_cost_micros" integer,
  "input_tokens" integer,
  "output_tokens" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "settled_at" timestamptz,
  CONSTRAINT "ai_attempt_reservation_positive" CHECK ("reserved_cost_micros" > 0),
  CONSTRAINT "ai_attempt_usage_nonnegative" CHECK (
    "estimated_cost_micros" >= 0 AND "input_tokens" >= 0 AND "output_tokens" >= 0
  )
);
CREATE INDEX "IDX_ai_attempts_request" ON "ai_attempts" ("request_id");
