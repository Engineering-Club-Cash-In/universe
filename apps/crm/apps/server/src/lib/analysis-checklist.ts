type AnalysisChecklistData = {
	sections?: {
		vehiculo?: {
			vehicleId?: string | null;
		};
	};
};

export function hasStaleAnalysisChecklistVehicle(
	checklistData: AnalysisChecklistData | null | undefined,
	currentVehicleId: string | null | undefined,
): boolean {
	const savedVehicleId = checklistData?.sections?.vehiculo?.vehicleId ?? null;
	return savedVehicleId !== (currentVehicleId ?? null);
}
