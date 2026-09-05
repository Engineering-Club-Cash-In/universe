export type ValidationRunState = {
	attemptNumber: number;
	status: "processing" | "completed" | "error";
	startedAt: Date;
};

export type AttemptAvailability =
	| { allowed: true; nextAttempt: number }
	| { allowed: false; reason: "processing" | "limit"; nextAttempt: number };

export type ResetAvailability =
	| { allowed: true; resetAfterAttemptNumber: number }
	| { allowed: false; reason: "processing" | "quota_available" };

export function getAttemptAvailability(params: {
	latestAttempt: number;
	completedAttempts: number;
	hasProcessingRun: boolean;
	maxAttempts: number;
}): AttemptAvailability {
	const nextAttempt = params.latestAttempt + 1;
	if (params.hasProcessingRun)
		return { allowed: false, reason: "processing", nextAttempt };
	if (params.completedAttempts >= params.maxAttempts)
		return { allowed: false, reason: "limit", nextAttempt };
	return { allowed: true, nextAttempt };
}

export function getResetAvailability(params: {
	latestAttempt: number;
	completedAttempts: number;
	hasProcessingRun: boolean;
	maxAttempts: number;
}): ResetAvailability {
	if (params.hasProcessingRun) return { allowed: false, reason: "processing" };
	if (params.completedAttempts < params.maxAttempts)
		return { allowed: false, reason: "quota_available" };
	return {
		allowed: true,
		resetAfterAttemptNumber: params.latestAttempt,
	};
}

export function getAttemptStatus(params: {
	runs: ValidationRunState[];
	resetAfterAttemptNumber?: number;
	maxAttempts: number;
	staleAfterMs: number;
	now?: number;
}) {
	const now = params.now ?? Date.now();
	const currentRuns = params.runs.filter(
		(run) => run.attemptNumber > (params.resetAfterAttemptNumber ?? 0),
	);
	const attemptCount = currentRuns.filter(
		(run) => run.status === "completed",
	).length;
	const hasProcessingRun = currentRuns.some(
		(run) =>
			run.status === "processing" &&
			now - run.startedAt.getTime() < params.staleAfterMs,
	);
	return {
		attemptCount,
		maxAttempts: params.maxAttempts,
		remainingAttempts: Math.max(0, params.maxAttempts - attemptCount),
		canValidate: attemptCount < params.maxAttempts && !hasProcessingRun,
		hasProcessingRun,
	};
}

export function isCompleteValidationRun(
	results: Array<{
		validation: { autoResult: string } | null;
	}>,
	expectedDocuments: number,
): boolean {
	return (
		results.length === expectedDocuments &&
		results.every(
			(result) =>
				!!result.validation && result.validation.autoResult !== "error",
		)
	);
}

export function uploadedValidationPairsMatch(params: {
	validationIds: string[];
	files: Array<{ filePath: string; contentSha256: string }>;
	validations: Array<{
		id: string;
		validationRunId: string;
		filePath: string;
		contentSha256: string;
		autoResult:
			| "valido"
			| "observacion"
			| "revision_manual"
			| "rechazado"
			| "error";
	}>;
}): boolean {
	const uniqueValidationIds = new Set(params.validationIds);
	const uniqueFilePaths = new Set(params.files.map((file) => file.filePath));
	if (
		uniqueValidationIds.size !== params.validationIds.length ||
		uniqueFilePaths.size !== params.files.length ||
		uniqueValidationIds.size !== uniqueFilePaths.size ||
		params.validations.length !== uniqueValidationIds.size
	)
		return false;
	if (
		new Set(params.validations.map((validation) => validation.validationRunId))
			.size !== 1 ||
		params.validations.some((validation) => validation.autoResult === "error")
	)
		return false;

	const expectedValidationIds = new Set(params.validationIds);
	const validatedFiles = new Set(
		params.validations
			.filter((validation) => expectedValidationIds.has(validation.id))
			.map(
				(validation) =>
					`${validation.filePath}\u0000${validation.contentSha256}`,
			),
	);
	return params.files.every((file) =>
		validatedFiles.has(`${file.filePath}\u0000${file.contentSha256}`),
	);
}
