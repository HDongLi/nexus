CREATE TABLE "identity_login_failures" (
	"username" text PRIMARY KEY NOT NULL,
	"failure_count" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "identity_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "identity_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"disabled_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity_sessions" ADD CONSTRAINT "identity_sessions_user_id_identity_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."identity_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "identity_sessions_expires_at_idx" ON "identity_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "identity_sessions_user_id_idx" ON "identity_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_users_username_lower_idx" ON "identity_users" USING btree (lower("username"));