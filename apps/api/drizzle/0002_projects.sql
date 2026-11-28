CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar" text NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_id_identity_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."identity_users"("id") ON DELETE restrict ON UPDATE no action;