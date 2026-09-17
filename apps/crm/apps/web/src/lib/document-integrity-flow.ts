export type IntegrityResult =
	| "valido"
	| "observacion"
	| "revision_manual"
	| "rechazado"
	| "error";

export interface IntegrityValidatedBatchLike {
	payloads: unknown[];
	results: Array<{
		validation: {
			result: IntegrityResult;
			manualApproval?: unknown | null;
		} | null;
	}>;
}

export function requiresManualApproval(_result: IntegrityResult): boolean {
	return false;
}

export function hasCompleteIntegrityValidation(
	batch: IntegrityValidatedBatchLike | null,
): boolean {
	return (
		!!batch &&
		batch.payloads.length > 0 &&
		batch.results.length === batch.payloads.length &&
		batch.results.every(
			(result) =>
				!!result.validation &&
				result.validation.result !== "error" &&
				result.validation.result !== "rechazado",
		)
	);
}

const RESULT_PRIORITY: IntegrityResult[] = ["rechazado", "error", "valido"];

export function aggregateIntegrityResult(
	results: Array<{ autoResult: IntegrityResult }>,
): IntegrityResult {
	return (
		RESULT_PRIORITY.find((result) =>
			results.some((validation) => validation.autoResult === result),
		) ?? (results.length > 0 ? "valido" : "error")
	);
}

export function getReusableBatchSyncAction(params: {
	reusableRunId?: string;
	reusableOpportunityId?: string;
	currentOpportunityId?: string;
	restoredRunId?: string;
}): "restore" | "clear_restored" | "keep_local" {
	if (
		params.reusableRunId &&
		params.currentOpportunityId &&
		params.reusableOpportunityId === params.currentOpportunityId
	)
		return "restore";
	return params.restoredRunId ? "clear_restored" : "keep_local";
}
