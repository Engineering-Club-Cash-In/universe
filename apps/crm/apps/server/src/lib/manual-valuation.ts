export const MANUAL_VALUATION_TECHNICIAN_NAME = "Actualizacion manual CRM";
export const MANUAL_VALUATION_RESULT =
	"Actualización manual de valores comerciales del vehículo";

type ManualValuationInput = {
	vehicleRating: "Comercial" | "No comercial";
	marketValue: string;
	suggestedCommercialValue: string;
	bankValue: string;
	currentConditionValue: string;
};

export function buildManualValuationData(input: ManualValuationInput) {
	return {
		vehicleRating: input.vehicleRating,
		marketValue: input.marketValue,
		suggestedCommercialValue: input.suggestedCommercialValue,
		bankValue: input.bankValue,
		currentConditionValue: input.currentConditionValue,
		technicianName: MANUAL_VALUATION_TECHNICIAN_NAME,
		inspectionDate: new Date(),
		inspectionResult: MANUAL_VALUATION_RESULT,
		vehicleEquipment: "Pendiente de inspección completa",
		status: "approved" as const,
		alerts: [] as string[],
		sectionTimes: {},
		scannerUsed: false,
		airbagWarning: false,
		testDrive: false,
		hasSpareTire: false,
		hasAgencyHistory: false,
		updatedAt: new Date(),
	};
}
