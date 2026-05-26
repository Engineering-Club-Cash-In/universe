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
