CREATE TABLE "mobile_oauth_attempts" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "provider_state_hash" varchar(64) NOT NULL,
  "client_state" varchar(128) NOT NULL,
  "mode" varchar(16) NOT NULL,
  "return_url" varchar(512),
  "code_challenge" varchar(64),
  "provider_claimed_at" timestamptz,
  "exchange_code_hash" varchar(64),
  "encrypted_provider_token" text,
  "exchange_expires_at" timestamptz,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "mobile_oauth_state_valid" CHECK (
    "provider_state_hash" ~ '^[a-f0-9]{64}$' AND
    length("client_state") BETWEEN 16 AND 128
  ),
  CONSTRAINT "mobile_oauth_mode_valid" CHECK (
    "mode" IN ('redirect','popup')
  ),
  CONSTRAINT "mobile_oauth_redirect_valid" CHECK (
    ("mode" = 'redirect' AND "return_url" IS NOT NULL AND
      "code_challenge" ~ '^[A-Za-z0-9_-]{43}$') OR
    ("mode" = 'popup' AND "return_url" IS NULL AND
      "code_challenge" IS NULL)
  ),
  CONSTRAINT "mobile_oauth_exchange_valid" CHECK (
    ("exchange_code_hash" IS NULL AND "encrypted_provider_token" IS NULL AND
      "exchange_expires_at" IS NULL AND "consumed_at" IS NULL) OR
    ("exchange_code_hash" ~ '^[a-f0-9]{64}$' AND
      "exchange_expires_at" IS NOT NULL AND
      ("encrypted_provider_token" IS NOT NULL OR "consumed_at" IS NOT NULL))
  ),
  CONSTRAINT "mobile_oauth_expiry_valid" CHECK (
    "expires_at" > "created_at" AND
    ("exchange_expires_at" IS NULL OR
      ("exchange_expires_at" >= "created_at" AND
       "exchange_expires_at" <= "expires_at"))
  )
);

CREATE UNIQUE INDEX "UQ_mobile_oauth_provider_state_hash"
  ON "mobile_oauth_attempts" ("provider_state_hash");
CREATE UNIQUE INDEX "UQ_mobile_oauth_exchange_code_hash"
  ON "mobile_oauth_attempts" ("exchange_code_hash")
  WHERE "exchange_code_hash" IS NOT NULL;
CREATE INDEX "IDX_mobile_oauth_cleanup"
  ON "mobile_oauth_attempts" ("expires_at", "consumed_at");
