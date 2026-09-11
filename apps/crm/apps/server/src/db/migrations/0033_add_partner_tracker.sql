DO $$ BEGIN
	ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'partner';
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "public"."partner_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "partner_members_user_id_company_id_unique" UNIQUE("user_id","company_id")
);--> statement-breakpoint

ALTER TABLE "public"."partner_members" ADD CONSTRAINT "partner_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."partner_members" ADD CONSTRAINT "partner_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_members_user_id_idx" ON "public"."partner_members" USING btree ("user_id");

CREATE TABLE IF NOT EXISTS "public"."partner_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"password_changed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "partner_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint

INSERT INTO "public"."partner_accounts" ("user_id")
SELECT "id" FROM "public"."user" WHERE "role"::text = 'partner'
ON CONFLICT ("user_id") DO NOTHING;
