CREATE TABLE "identity_group_members" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "identity_group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "identity_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_groups" (
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	CONSTRAINT "project_groups_project_id_group_id_pk" PRIMARY KEY("project_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "identity_group_members" ADD CONSTRAINT "identity_group_members_group_id_identity_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."identity_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_group_members" ADD CONSTRAINT "identity_group_members_user_id_identity_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."identity_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_groups" ADD CONSTRAINT "project_groups_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_groups" ADD CONSTRAINT "project_groups_group_id_identity_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."identity_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "identity_group_members_user_id_idx" ON "identity_group_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_groups_name_lower_idx" ON "identity_groups" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "project_groups_group_id_idx" ON "project_groups" USING btree ("group_id");