CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"subject" text,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"trace_id" text
);
--> statement-breakpoint
CREATE INDEX "events_type_id_idx" ON "events" USING btree ("type","id");--> statement-breakpoint
CREATE INDEX "events_subject_id_idx" ON "events" USING btree ("subject","id");