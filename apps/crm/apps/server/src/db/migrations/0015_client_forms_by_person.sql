ALTER TABLE "client_form_tokens"
	ADD COLUMN IF NOT EXISTS "person_type" text,
	ADD COLUMN IF NOT EXISTS "person_id" uuid;

ALTER TABLE "credit_applications"
	ADD COLUMN IF NOT EXISTS "person_type" text,
	ADD COLUMN IF NOT EXISTS "person_id" uuid;

ALTER TABLE "financial_statements"
	ADD COLUMN IF NOT EXISTS "person_type" text,
	ADD COLUMN IF NOT EXISTS "person_id" uuid;

UPDATE "client_form_tokens" cft
SET
	"person_type" = 'lead',
	"person_id" = o."lead_id"
FROM "opportunities" o
WHERE cft."opportunity_id" = o."id"
	AND cft."person_type" IS NULL
	AND o."lead_id" IS NOT NULL;

UPDATE "credit_applications" ca
SET
	"person_type" = 'lead',
	"person_id" = o."lead_id"
FROM "opportunities" o
WHERE ca."opportunity_id" = o."id"
	AND ca."person_type" IS NULL
	AND o."lead_id" IS NOT NULL;

UPDATE "financial_statements" fs
SET
	"person_type" = 'lead',
	"person_id" = o."lead_id"
FROM "opportunities" o
WHERE fs."opportunity_id" = o."id"
	AND fs."person_type" IS NULL
	AND o."lead_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "client_form_tokens_opportunity_person_idx"
	ON "client_form_tokens" ("opportunity_id", "person_type", "person_id");

CREATE INDEX IF NOT EXISTS "credit_applications_opportunity_person_idx"
	ON "credit_applications" ("opportunity_id", "person_type", "person_id");

CREATE INDEX IF NOT EXISTS "financial_statements_opportunity_person_idx"
	ON "financial_statements" ("opportunity_id", "person_type", "person_id");
