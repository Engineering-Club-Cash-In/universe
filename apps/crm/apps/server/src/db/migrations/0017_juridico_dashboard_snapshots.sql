CREATE TABLE IF NOT EXISTS "juridico_dashboard_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text DEFAULT 'default' NOT NULL,
	"period_label" text NOT NULL,
	"notes" text,
	"payload" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "juridico_dashboard_snapshots_updated_by_user_id_fk"
		FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE no action ON UPDATE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS "juridico_dashboard_scope_unique"
	ON "juridico_dashboard_snapshots" ("scope");
