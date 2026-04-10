type AnalysisChecklistData = {
	sections?: {
		vehiculo?: {
			vehicleId?: string | null;
			inspected?: boolean;
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
