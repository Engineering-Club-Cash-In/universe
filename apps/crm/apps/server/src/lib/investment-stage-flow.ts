export const INVESTMENT_STAGE_FLOW = [
	"data_collection",
	"basic_profile_validation",
	"profiling_and_qualification",
	"model_presentation",
	"active_follow_up",
	"verbal_commitment_contract_sent",
	"ticket_closure_transfer_activation",
	"initial_onboarding_senior_handoff",
] as const;

export const INVESTMENT_STAGE_VALUES = [
	...INVESTMENT_STAGE_FLOW,
	"lost",
] as const;

export type InvestmentActiveStage = (typeof INVESTMENT_STAGE_FLOW)[number];
export type InvestmentStageValue = (typeof INVESTMENT_STAGE_VALUES)[number];

export function getPreviousInvestmentStage(
	stage: string | null | undefined,
): InvestmentActiveStage | null {
	if (!stage || stage === "lost") return null;

	const currentIndex = INVESTMENT_STAGE_FLOW.indexOf(
		stage as InvestmentActiveStage,
	);
	if (currentIndex <= 0) return null;

	return INVESTMENT_STAGE_FLOW[currentIndex - 1];
}

export function getNextInvestmentStage(
	stage: string | null | undefined,
): InvestmentActiveStage | null {
	if (!stage || stage === "lost") return null;

	const currentIndex = INVESTMENT_STAGE_FLOW.indexOf(
		stage as InvestmentActiveStage,
	);
	if (currentIndex === -1 || currentIndex >= INVESTMENT_STAGE_FLOW.length - 1) {
		return null;
	}

	return INVESTMENT_STAGE_FLOW[currentIndex + 1];
}
