type AnalysisChecklistData = {
	sections?: {
		documentos?: {
			items?: Array<{
				documentType?: string;
				uploaded?: boolean;
			}>;
		};
		vehiculo?: {
			vehicleId?: string | null;
			inspected?: boolean;
			documentos?: {
				items?: Array<{
					documentType?: string;
					uploaded?: boolean;
				}>;
			};
		};
	};
};

type VerificationItem = {
	type?: string;
	completed?: boolean;
	verifiedBy?: string;
	verifiedAt?: string;
};

export function hasStaleAnalysisChecklistVehicleState(
	checklistData: AnalysisChecklistData | null | undefined,
	currentVehicleId: string | null | undefined,
	currentInspected: boolean,
): boolean {
	const savedVehicleId = checklistData?.sections?.vehiculo?.vehicleId ?? null;
	const savedInspected = checklistData?.sections?.vehiculo?.inspected ?? false;

	return (
		savedVehicleId !== (currentVehicleId ?? null) ||
		savedInspected !== currentInspected
	);
}

function hasStaleDocumentItems(
	items: Array<{ documentType?: string; uploaded?: boolean }> | undefined,
	currentUploadedDocumentTypes: ReadonlySet<string>,
) {
	return (items ?? []).some(
		(item) =>
			!!item.documentType &&
			(item.uploaded ?? false) !==
				currentUploadedDocumentTypes.has(item.documentType),
	);
}

export function hasStaleAnalysisChecklistDocumentState(
	checklistData: AnalysisChecklistData | null | undefined,
	currentUploadedClientDocumentTypes: ReadonlySet<string>,
	currentUploadedVehicleDocumentTypes: ReadonlySet<string>,
): boolean {
	return (
		hasStaleDocumentItems(
			checklistData?.sections?.documentos?.items,
			currentUploadedClientDocumentTypes,
		) ||
		hasStaleDocumentItems(
			checklistData?.sections?.vehiculo?.documentos?.items,
			currentUploadedVehicleDocumentTypes,
		)
	);
}

function carryForwardVerificationItems(
	nextItems: VerificationItem[] | undefined,
	previousItems: VerificationItem[] | undefined,
) {
	const previousByType = new Map(
		(previousItems ?? [])
			.filter((item) => item.type)
			.map((item) => [item.type, item]),
	);

	for (const nextItem of nextItems ?? []) {
		if (!nextItem.type) continue;

		const previousItem = previousByType.get(nextItem.type);
		if (!previousItem) continue;

		nextItem.completed = previousItem.completed ?? false;

		if (previousItem.verifiedBy) {
			nextItem.verifiedBy = previousItem.verifiedBy;
		} else {
			delete nextItem.verifiedBy;
		}

		if (previousItem.verifiedAt) {
			nextItem.verifiedAt = previousItem.verifiedAt;
		} else {
			delete nextItem.verifiedAt;
		}
	}
}

export function carryForwardAnalysisChecklistVerificationState(
	nextChecklistData: any,
	previousChecklistData: any,
) {
	carryForwardVerificationItems(
		nextChecklistData?.sections?.verificaciones?.items,
		previousChecklistData?.sections?.verificaciones?.items,
	);
	carryForwardVerificationItems(
		nextChecklistData?.sections?.vehiculo?.verificaciones?.items,
		previousChecklistData?.sections?.vehiculo?.verificaciones?.items,
	);
}
