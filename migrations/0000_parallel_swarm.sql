CREATE TABLE "alert_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"school_id" text,
	"signal_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"frequency" text DEFAULT 'instant' NOT NULL,
	"slack_webhook_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"key_prefix" text NOT NULL,
	"hashed_key" text NOT NULL,
	"label" text,
	"scopes" jsonb,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token" text NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "auth_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "career_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"school_id" text NOT NULL,
	"title" text,
	"start_year" integer,
	"end_year" integer,
	"technologies_used" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_reveals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"staff_id" integer NOT NULL,
	"revealed_at" timestamp DEFAULT now() NOT NULL,
	"charged_credits" integer DEFAULT 0 NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"stripe_payment_intent_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enterprise_inquiries" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"company" text,
	"team_size" text,
	"message" text NOT NULL,
	"user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"tier" text DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'inactive' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"monthly_allocation" integer DEFAULT 0 NOT NULL,
	"used_this_period" integer DEFAULT 0 NOT NULL,
	"overage_rate_cents" integer DEFAULT 0 NOT NULL,
	"credits_balance" integer DEFAULT 0 NOT NULL,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extraction_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"target_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_schools" integer DEFAULT 0,
	"processed_schools" integer DEFAULT 0,
	"contacts_found" integer DEFAULT 0,
	"logs" jsonb,
	"extraction_metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_postings" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" text,
	"school_name" text,
	"job_title" text NOT NULL,
	"department" text,
	"posting_url" text NOT NULL,
	"source_board" text,
	"posted_at" timestamp,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true,
	CONSTRAINT "job_postings_posting_url_unique" UNIQUE("posting_url")
);
--> statement-breakpoint
CREATE TABLE "linkedin_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"entity_urn" text NOT NULL,
	"full_name" text,
	"first_name" text,
	"last_name" text,
	"headline" text,
	"profile_url" text,
	"public_identifier" text,
	"connected_at" timestamp,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"matched_staff_id" integer,
	"matched_school_id" text,
	"match_confidence" integer,
	"matched_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "nil_collectives" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" text,
	"name" text NOT NULL,
	"website" text,
	"structure" text,
	"estimated_budget" text,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"email" text NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	CONSTRAINT "organization_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" integer NOT NULL,
	"seat_limit" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_failures" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"stripe_customer_id" text,
	"source" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"error_code" text,
	"decline_code" text,
	"message" text,
	"payment_intent_id" text,
	"staff_id" integer,
	"emailed_at" timestamp,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"title_keyword" text NOT NULL,
	"mapped_persona" text NOT NULL,
	"mapped_area" text NOT NULL,
	"priority" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_list_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"list_id" integer NOT NULL,
	"staff_id" integer NOT NULL,
	"notes" text,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"alias" text NOT NULL,
	"school_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "school_aliases_alias_unique" UNIQUE("alias")
);
--> statement-breakpoint
CREATE TABLE "school_directories" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"school_name" text NOT NULL,
	"school_full_name" text NOT NULL,
	"logo_url" text,
	"ncaa_url" text NOT NULL,
	"directory_url" text,
	"division" text,
	"conference" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_extracted_at" timestamp,
	"last_attempted_at" timestamp,
	"extraction_error" text,
	"contacts_count" integer DEFAULT 0,
	"avg_confidence" integer DEFAULT 0,
	"fiscal_year_end" text DEFAULT '06-30',
	"tech_stack" jsonb,
	"buying_window_status" text,
	"priority_score" integer DEFAULT 0,
	"resolved_url" text,
	"failure_reason" text,
	"extraction_attempts" integer DEFAULT 0,
	"last_successful_method" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "school_directories_school_id_unique" UNIQUE("school_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" text PRIMARY KEY NOT NULL,
	"sess" text NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" text,
	"staff_id" integer,
	"type" text NOT NULL,
	"description" text,
	"metadata" jsonb,
	"detected_at" timestamp DEFAULT now(),
	"is_actioned" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "staff_change_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"staff_id" integer,
	"name" text NOT NULL,
	"change_type" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"detected_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"email" text NOT NULL,
	"phone" text,
	"department" text,
	"office" text,
	"linkedin_url" text,
	"twitter_handle" text,
	"bio_url" text,
	"image_url" text,
	"hired_year" integer,
	"confidence" jsonb,
	"email_confidence" text,
	"buyer_persona" text,
	"functional_area" text,
	"department_tags" jsonb,
	"extracted_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_scraped_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "target_list_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"list_id" integer NOT NULL,
	"school_id" text,
	"raw_name" text NOT NULL,
	"status" text DEFAULT 'pending'
);
--> statement-breakpoint
CREATE TABLE "target_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"school_id" text,
	"school_name" text,
	"session_id" text,
	"ip_hash" text,
	"user_agent" text,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"google_id" text,
	"full_name" text NOT NULL,
	"role" text DEFAULT 'user',
	"is_verified" boolean DEFAULT false,
	"credits_balance" integer DEFAULT 0 NOT NULL,
	"subscription_tier" text DEFAULT 'free',
	"monthly_credits_allocation" integer DEFAULT 0,
	"credits_used_this_period" integer DEFAULT 0,
	"overage_rate" integer DEFAULT 100,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"subscription_status" text DEFAULT 'inactive',
	"price_id" text,
	"current_period_end" timestamp,
	"current_period_start" timestamp,
	"created_at" timestamp DEFAULT now(),
	"last_login_at" timestamp,
	"tos_accepted_at" timestamp,
	"organization_id" integer,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscription_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb,
	"response_status" integer,
	"response_body" text,
	"success" boolean DEFAULT false,
	"attempted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"url" text NOT NULL,
	"event_types" jsonb,
	"is_active" boolean DEFAULT true,
	"secret" text NOT NULL,
	"description" text,
	"last_triggered_at" timestamp,
	"failure_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "alert_subs_user_idx" ON "alert_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "alert_subs_school_idx" ON "alert_subscriptions" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "api_keys_prefix_idx" ON "api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE INDEX "api_keys_hashed_idx" ON "api_keys" USING btree ("hashed_key");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_idx" ON "auth_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_tokens_purpose_idx" ON "auth_tokens" USING btree ("purpose");--> statement-breakpoint
CREATE INDEX "career_history_staff_idx" ON "career_history" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "career_history_school_idx" ON "career_history" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_reveals_user_staff_idx" ON "contact_reveals" USING btree ("user_id","staff_id");--> statement-breakpoint
CREATE INDEX "contact_reveals_user_idx" ON "contact_reveals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "contact_reveals_revealed_at_idx" ON "contact_reveals" USING btree ("revealed_at");--> statement-breakpoint
CREATE INDEX "credit_transactions_user_idx" ON "credit_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_transactions_stripe_pi_unique" ON "credit_transactions" USING btree ("stripe_payment_intent_id");--> statement-breakpoint
CREATE INDEX "job_postings_school_idx" ON "job_postings" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "job_postings_detected_idx" ON "job_postings" USING btree ("detected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "linkedin_connections_user_entity_unique" ON "linkedin_connections" USING btree ("user_id","entity_urn");--> statement-breakpoint
CREATE INDEX "linkedin_connections_user_idx" ON "linkedin_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "linkedin_connections_matched_staff_idx" ON "linkedin_connections" USING btree ("matched_staff_id");--> statement-breakpoint
CREATE INDEX "linkedin_connections_matched_school_idx" ON "linkedin_connections" USING btree ("matched_school_id");--> statement-breakpoint
CREATE INDEX "linkedin_connections_public_identifier_idx" ON "linkedin_connections" USING btree ("public_identifier");--> statement-breakpoint
CREATE INDEX "nil_collectives_school_idx" ON "nil_collectives" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "org_invites_token_idx" ON "organization_invites" USING btree ("token");--> statement-breakpoint
CREATE INDEX "org_invites_org_idx" ON "organization_invites" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_members_org_user_unique" ON "organization_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "org_members_org_idx" ON "organization_members" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "org_members_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payment_failures_user_idx" ON "payment_failures" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payment_failures_created_idx" ON "payment_failures" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "persona_rules_keyword_idx" ON "persona_rules" USING btree ("title_keyword");--> statement-breakpoint
CREATE INDEX "list_items_list_idx" ON "saved_list_items" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "list_items_staff_idx" ON "saved_list_items" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "school_aliases_alias_idx" ON "school_aliases" USING btree ("alias");--> statement-breakpoint
CREATE INDEX "sessions_expire_idx" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "signals_school_idx" ON "signals" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "signals_type_idx" ON "signals" USING btree ("type");--> statement-breakpoint
CREATE INDEX "signals_detected_idx" ON "signals" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "change_log_school_idx" ON "staff_change_logs" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "change_log_type_idx" ON "staff_change_logs" USING btree ("change_type");--> statement-breakpoint
CREATE INDEX "change_log_detected_idx" ON "staff_change_logs" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "staff_search_idx" ON "staff_members" USING gin (to_tsvector('english', "name" || ' ' || coalesce("title", '') || ' ' || coalesce("department", '')));--> statement-breakpoint
CREATE INDEX "staff_school_idx" ON "staff_members" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "staff_email_idx" ON "staff_members" USING btree ("email");--> statement-breakpoint
CREATE INDEX "staff_persona_idx" ON "staff_members" USING btree ("buyer_persona");--> statement-breakpoint
CREATE INDEX "target_list_items_list_idx" ON "target_list_items" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "target_list_items_status_idx" ON "target_list_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "webhook_logs_sub_idx" ON "webhook_delivery_logs" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "webhook_logs_attempt_idx" ON "webhook_delivery_logs" USING btree ("attempted_at");--> statement-breakpoint
CREATE INDEX "webhook_active_idx" ON "webhook_subscriptions" USING btree ("is_active");