ALTER TABLE "credit_applications"
	DROP CONSTRAINT IF EXISTS "credit_applications_opportunity_id_unique";

ALTER TABLE "financial_statements"
	DROP CONSTRAINT IF EXISTS "financial_statements_opportunity_id_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "credit_applications_opportunity_person_unique"
	ON "credit_applications" ("opportunity_id", "person_type", "person_id");

CREATE UNIQUE INDEX IF NOT EXISTS "financial_statements_opportunity_person_unique"
	ON "financial_statements" ("opportunity_id", "person_type", "person_id");
