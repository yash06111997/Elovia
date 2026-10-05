CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_data" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"app_state" jsonb,
	"workout_plan" jsonb,
	"custom_plans" jsonb,
	"active_plan_type" varchar,
	"active_custom_plan_id" varchar,
	"active_session" jsonb,
	"sessions" jsonb,
	"personal_records" jsonb,
	"meal_plan" jsonb,
	"food_log" jsonb,
	"custom_meal_plans" jsonb,
	"active_meal_plan_type" varchar,
	"active_custom_meal_plan_id" varchar,
	"health_data" jsonb,
	"wellness_data" jsonb,
	"water_goal" jsonb,
	"reminder_prefs" jsonb,
	"places" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_data_revision_safe" CHECK ("user_data"."revision" >= 1 AND "user_data"."revision" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"revenuecat_user_id" varchar,
	"entitlement_active" boolean DEFAULT false NOT NULL,
	"entitlement_id" varchar,
	"status" varchar DEFAULT 'free' NOT NULL,
	"tier" varchar,
	"product_id" varchar,
	"store" varchar,
	"trial_started_at" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"current_period_ends_at" timestamp with time zone,
	"last_event" jsonb,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" varchar PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"day" varchar NOT NULL,
	"route" varchar NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_micros" integer DEFAULT 0 NOT NULL,
	"provider" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"id" varchar PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"token" varchar NOT NULL,
	"platform" varchar,
	"device_name" varchar,
	"enabled" boolean DEFAULT true NOT NULL,
	"invalidated_at" timestamp with time zone,
	"last_error" varchar,
	"last_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplements" (
	"id" varchar PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"kind" varchar DEFAULT 'supplement' NOT NULL,
	"dosage" varchar,
	"unit" varchar,
	"frequency" varchar DEFAULT 'daily' NOT NULL,
	"times" jsonb,
	"with_food" boolean DEFAULT false NOT NULL,
	"notes" varchar,
	"active" boolean DEFAULT true NOT NULL,
	"analysis" jsonb,
	"analysed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_comments" (
	"id" varchar PRIMARY KEY NOT NULL,
	"activity_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"body" varchar NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "challenge_participants" (
	"id" varchar PRIMARY KEY NOT NULL,
	"challenge_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "challenges" (
	"id" varchar PRIMARY KEY NOT NULL,
	"created_by" varchar NOT NULL,
	"name" varchar NOT NULL,
	"description" varchar,
	"metric" varchar NOT NULL,
	"target" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"join_code" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "friendships" (
	"id" varchar PRIMARY KEY NOT NULL,
	"user_a_id" varchar NOT NULL,
	"user_b_id" varchar NOT NULL,
	"requested_by" varchar NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"blocked_by" varchar,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kudos" (
	"id" varchar PRIMARY KEY NOT NULL,
	"activity_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_activities" (
	"id" varchar PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"kind" varchar NOT NULL,
	"title" varchar NOT NULL,
	"caption" varchar,
	"payload" jsonb NOT NULL,
	"visibility" varchar DEFAULT 'friends' NOT NULL,
	"kudos_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_profiles" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"display_name" varchar NOT NULL,
	"friend_code" varchar NOT NULL,
	"avatar_url" varchar,
	"bio" varchar,
	"discoverable" boolean DEFAULT true NOT NULL,
	"leaderboard_opt_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_availability" (
	"id" varchar PRIMARY KEY NOT NULL,
	"coach_user_id" varchar NOT NULL,
	"weekday" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"duration_mins" integer DEFAULT 45 NOT NULL,
	"timezone" varchar NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_profiles" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"display_name" varchar NOT NULL,
	"timezone" varchar DEFAULT 'UTC' NOT NULL,
	"default_meeting_url" varchar,
	"max_clients" integer DEFAULT 30 NOT NULL,
	"cancellation_notice_hours" integer DEFAULT 24 NOT NULL,
	"booking_horizon_days" integer DEFAULT 28 NOT NULL,
	"accepting_clients" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coaching_sessions" (
	"id" varchar PRIMARY KEY NOT NULL,
	"coach_user_id" varchar NOT NULL,
	"client_user_id" varchar NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_mins" integer DEFAULT 45 NOT NULL,
	"status" varchar DEFAULT 'booked' NOT NULL,
	"kind" varchar DEFAULT 'coaching' NOT NULL,
	"meeting_url" varchar,
	"client_note" varchar,
	"coach_note" varchar,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" varchar,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_data" ADD CONSTRAINT "user_data_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplements" ADD CONSTRAINT "supplements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_comments" ADD CONSTRAINT "activity_comments_activity_id_shared_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."shared_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_comments" ADD CONSTRAINT "activity_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_a_id_users_id_fk" FOREIGN KEY ("user_a_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_b_id_users_id_fk" FOREIGN KEY ("user_b_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_activity_id_shared_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."shared_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_activities" ADD CONSTRAINT "shared_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD CONSTRAINT "social_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_availability" ADD CONSTRAINT "coach_availability_coach_user_id_users_id_fk" FOREIGN KEY ("coach_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_profiles" ADD CONSTRAINT "coach_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_sessions" ADD CONSTRAINT "coaching_sessions_coach_user_id_users_id_fk" FOREIGN KEY ("coach_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_sessions" ADD CONSTRAINT "coaching_sessions_client_user_id_users_id_fk" FOREIGN KEY ("client_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "IDX_subscriptions_revenuecat_user" ON "subscriptions" USING btree ("revenuecat_user_id");--> statement-breakpoint
CREATE INDEX "IDX_subscriptions_entitlement_active" ON "subscriptions" USING btree ("entitlement_active");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_ai_usage_user_day_route" ON "ai_usage" USING btree ("user_id","day","route");--> statement-breakpoint
CREATE INDEX "IDX_ai_usage_user_day" ON "ai_usage" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "IDX_ai_usage_day" ON "ai_usage" USING btree ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_push_tokens_token" ON "push_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "IDX_push_tokens_user" ON "push_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "IDX_supplements_user" ON "supplements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "IDX_comments_activity" ON "activity_comments" USING btree ("activity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_challenge_participant" ON "challenge_participants" USING btree ("challenge_id","user_id");--> statement-breakpoint
CREATE INDEX "IDX_challenge_participants_challenge" ON "challenge_participants" USING btree ("challenge_id","progress");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_challenges_join_code" ON "challenges" USING btree ("join_code");--> statement-breakpoint
CREATE INDEX "IDX_challenges_ends" ON "challenges" USING btree ("ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_friendships_pair" ON "friendships" USING btree ("user_a_id","user_b_id");--> statement-breakpoint
CREATE INDEX "IDX_friendships_user_a" ON "friendships" USING btree ("user_a_id","status");--> statement-breakpoint
CREATE INDEX "IDX_friendships_user_b" ON "friendships" USING btree ("user_b_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_kudos_activity_user" ON "kudos" USING btree ("activity_id","user_id");--> statement-breakpoint
CREATE INDEX "IDX_kudos_activity" ON "kudos" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "IDX_shared_activities_user" ON "shared_activities" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "IDX_shared_activities_created" ON "shared_activities" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_social_profiles_friend_code" ON "social_profiles" USING btree ("friend_code");--> statement-breakpoint
CREATE INDEX "IDX_social_profiles_discoverable" ON "social_profiles" USING btree ("discoverable");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_availability_slot" ON "coach_availability" USING btree ("coach_user_id","weekday","start_minute");--> statement-breakpoint
CREATE INDEX "IDX_availability_coach" ON "coach_availability" USING btree ("coach_user_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_session_coach_start" ON "coaching_sessions" USING btree ("coach_user_id","starts_at");--> statement-breakpoint
CREATE INDEX "IDX_sessions_client" ON "coaching_sessions" USING btree ("client_user_id","starts_at");--> statement-breakpoint
CREATE INDEX "IDX_sessions_coach" ON "coaching_sessions" USING btree ("coach_user_id","starts_at");--> statement-breakpoint
CREATE INDEX "IDX_sessions_upcoming" ON "coaching_sessions" USING btree ("starts_at","status");