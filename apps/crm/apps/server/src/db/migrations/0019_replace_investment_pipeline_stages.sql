ALTER TYPE "public"."investment_stage" RENAME TO "investment_stage_old";--> statement-breakpoint
CREATE TYPE "public"."investment_stage" AS ENUM(
	'data_collection',
	'basic_profile_validation',
	'profiling_and_qualification',
	'model_presentation',
	'active_follow_up',
	'verbal_commitment_contract_sent',
	'ticket_closure_transfer_activation',
	'initial_onboarding_senior_handoff',
	'lost'
);--> statement-breakpoint

ALTER TABLE "investment_opportunities"
	ALTER COLUMN "stage" DROP DEFAULT;--> statement-breakpoint

ALTER TABLE "investment_opportunities"
	ALTER COLUMN "stage" TYPE "public"."investment_stage"
	USING (
		CASE
			WHEN "stage"::text = 'prospecting' THEN 'data_collection'
			WHEN "stage"::text = 'contacted' THEN 'basic_profile_validation'
			WHEN "stage"::text = 'negotiation' THEN 'active_follow_up'
			WHEN "stage"::text = 'acceptance_signatures' THEN 'verbal_commitment_contract_sent'
			WHEN "stage"::text = 'welcome' THEN 'initial_onboarding_senior_handoff'
			WHEN "stage"::text = 'closed' THEN 'ticket_closure_transfer_activation'
			WHEN "stage"::text = 'lost' THEN 'lost'
		END
	)::"public"."investment_stage";--> statement-breakpoint

ALTER TABLE "investment_opportunities"
	ALTER COLUMN "stage" SET DEFAULT 'data_collection'::"public"."investment_stage";--> statement-breakpoint

ALTER TABLE "investment_opportunities"
	ALTER COLUMN "last_stage_before_lost" TYPE "public"."investment_stage"
	USING (
		CASE
			WHEN "last_stage_before_lost" IS NULL THEN NULL
			WHEN "last_stage_before_lost"::text = 'prospecting' THEN 'data_collection'
			WHEN "last_stage_before_lost"::text = 'contacted' THEN 'basic_profile_validation'
			WHEN "last_stage_before_lost"::text = 'negotiation' THEN 'active_follow_up'
			WHEN "last_stage_before_lost"::text = 'acceptance_signatures' THEN 'verbal_commitment_contract_sent'
			WHEN "last_stage_before_lost"::text = 'welcome' THEN 'initial_onboarding_senior_handoff'
			WHEN "last_stage_before_lost"::text = 'closed' THEN 'ticket_closure_transfer_activation'
			WHEN "last_stage_before_lost"::text = 'lost' THEN 'lost'
		END
	)::"public"."investment_stage";--> statement-breakpoint

ALTER TABLE "investment_stage_history"
	ALTER COLUMN "from_stage" TYPE "public"."investment_stage"
	USING (
		CASE
			WHEN "from_stage" IS NULL THEN NULL
			WHEN "from_stage"::text = 'prospecting' THEN 'data_collection'
			WHEN "from_stage"::text = 'contacted' THEN 'basic_profile_validation'
			WHEN "from_stage"::text = 'negotiation' THEN 'active_follow_up'
			WHEN "from_stage"::text = 'acceptance_signatures' THEN 'verbal_commitment_contract_sent'
			WHEN "from_stage"::text = 'welcome' THEN 'initial_onboarding_senior_handoff'
			WHEN "from_stage"::text = 'closed' THEN 'ticket_closure_transfer_activation'
			WHEN "from_stage"::text = 'lost' THEN 'lost'
		END
	)::"public"."investment_stage";--> statement-breakpoint

ALTER TABLE "investment_stage_history"
	ALTER COLUMN "to_stage" TYPE "public"."investment_stage"
	USING (
		CASE
			WHEN "to_stage"::text = 'prospecting' THEN 'data_collection'
			WHEN "to_stage"::text = 'contacted' THEN 'basic_profile_validation'
			WHEN "to_stage"::text = 'negotiation' THEN 'active_follow_up'
			WHEN "to_stage"::text = 'acceptance_signatures' THEN 'verbal_commitment_contract_sent'
			WHEN "to_stage"::text = 'welcome' THEN 'initial_onboarding_senior_handoff'
			WHEN "to_stage"::text = 'closed' THEN 'ticket_closure_transfer_activation'
			WHEN "to_stage"::text = 'lost' THEN 'lost'
		END
	)::"public"."investment_stage";--> statement-breakpoint

DROP TYPE "public"."investment_stage_old";
