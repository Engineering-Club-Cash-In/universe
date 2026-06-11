import { z } from "zod";

// Schema for AI vehicle valuation
export const vehicleValuationSchema = z.object({
	suggestedValue: z
		.number()
		.describe("Valor sugerido del vehículo en Quetzales. Este es el valor EN CONDICIONES ACTUALES (ya descontados los daños físicos, llantas, etc.)"),
	baseMarketValue: z
		.number()
		.optional()
		.describe("Valor de mercado base en Quetzales (sin tomar en cuenta estado físico ni daños actuales, solo basado en marca, modelo y año del vehículo en el mercado)"),
	reasoning: z.string().describe("Razón detallada de la valoración"),
	marketAnalysis: z
		.string()
		.describe("Análisis del mercado actual para este tipo de vehículo"),
	depreciationFactors: z
		.array(z.string())
		.describe("Factores principales de depreciación considerados"),
	confidence: z
		.enum(["Baja", "Media", "Alta"])
		.describe("Nivel de confianza en la valoración"),
	marketComparison: z
		.string()
		.optional()
		.describe("Comparación con vehículos similares en el mercado"),
	recommendedActions: z
		.array(z.string())
		.optional()
		.describe("Recomendaciones para mejorar el valor"),
	commercialClassification: z
		.enum(["Comercial", "No comercial"])
		.describe(
			"Comercial = alta demanda en el mercado, se vende fácil. No comercial = vehículo de nicho, difícil de vender",
		),
	commercialClassificationReasoning: z
		.string()
		.describe("Razón de la clasificación comercial"),
});

export type VehicleValuation = z.infer<typeof vehicleValuationSchema>;

// Basic interfaces for data structures
export interface ValuationVehicleData {
	vehicleMake?: string;
	vehicleModel?: string;
	vehicleYear?: string;
	trim?: string;
	licensePlate?: string;
	vinNumber?: string;
	color?: string;
	vehicleType?: string;
	cylinders?: string;
	engineCC?: string;
	fuelType?: string;
	transmission?: string;
	origin?: string;
	traction?: string;
	kmMileage?: string;
	milesMileage?: string;
	technicianName?: string;
	inspectionDate?: Date | string;
	inspectionResult?: string;
	tiresCondition?: number;
	tireConditionFrontLeft?: number;
	tireConditionFrontRight?: number;
	tireConditionRearLeft?: number;
	tireConditionRearRight?: number;
	hasSpareTire?: boolean | string;
	tireConditionSpare?: number;
	paintCondition?: number;
	hasAgencyHistory?: boolean | string;
	vehicleEquipment?: string;
	importantConsiderations?: string;
	scannerUsed?: string | boolean;
	airbagWarning?: string | boolean;
	missingAirbag?: string;
	testDrive?: string | boolean;
	noTestDriveReason?: string;
}

export interface ValuationChecklistItem {
	item: string;
	checked: boolean;
	severity: "critical" | "warning" | "good" | "standard";
}

export interface ValuationPhoto {
	category: string;
	photoType: string;
	title: string;
	valuatorComment?: string;
	noCommentsChecked?: boolean;
}

// Helper to prepare context for AI valuation
export function prepareValuationContext(
	vehicleData: ValuationVehicleData,
	checklistItems: ValuationChecklistItem[],
	photos: ValuationPhoto[],
): {
	location: string;
	evaluationDate: string;
	currency: string;
	make: string;
	model: string;
	year: string;
	age: number;
	licensePlate: string;
	vin: string;
	color: string;
	vehicleType: string;
	cylinders: string;
	engineCC: string;
	fuelType: string;
	transmission: string;
	origin: string;
	kmMileage: string;
	milesMileage: string;
	technicianName: string;
	inspectionDate: string;
	inspectionResult: string;
	criticalIssues: string[];
	warningIssues: string[];
	criticalIssueCount: number;
	warningIssueCount: number;
	vehicleEquipment: string;
	importantConsiderations: string;
	scannerUsed: boolean;
	airbagWarning: boolean;
	missingAirbag: string;
	testDrive: boolean;
	noTestDriveReason: string;
	photoCount: number;
	photoCategories: Record<string, number>;
	hasExteriorPhotos: boolean;
	hasInteriorPhotos: boolean;
	hasEnginePhotos: boolean;
	hasDamagePhotos: boolean;
	photoComments: Array<{
		category: string;
		photoType: string;
		title: string;
		comment: string;
	}>;
	hasPhotoComments: boolean;
	// New fields for enhanced valuation
	trim: string;
	traction: string;
	tiresCondition: string;
	tireConditionFrontLeft: string;
	tireConditionFrontRight: string;
	tireConditionRearLeft: string;
	tireConditionRearRight: string;
	hasSpareTire: boolean;
	tireConditionSpare: string;
	paintCondition: string;
	hasAgencyHistory: string;
} {
	const today = new Date().toLocaleDateString("es-GT");

	// Calculate age
	const currentYear = new Date().getFullYear();
	const vehicleAge = vehicleData.vehicleYear
		? currentYear - Number.parseInt(vehicleData.vehicleYear)
		: 0;

	// Identify critical issues from checklist
	const criticalIssues =
		checklistItems?.filter(
			(item) => item.checked && item.severity === "critical",
		) || [];
	const warningIssues =
		checklistItems?.filter(
			(item) => item.checked && item.severity === "warning",
		) || [];

	// Extract photo comments (only photos with valuator comments, not "sin comentarios")
	const photoComments =
		photos
			?.filter(
				(photo) =>
					photo.valuatorComment &&
					photo.valuatorComment.trim() !== "" &&
					!photo.noCommentsChecked,
			)
			.map((photo) => ({
				category: photo.category,
				photoType: photo.photoType,
				title: photo.title,
				comment: photo.valuatorComment!,
			})) || [];

	// Count photos by category
	const photoCategories = (photos || []).reduce(
		(acc: Record<string, number>, photo) => {
			acc[photo.category] = (acc[photo.category] || 0) + 1;
			return acc;
		},
		{} as Record<string, number>,
	);

	return {
		// Location context
		location: "Ciudad de Guatemala, Guatemala",
		evaluationDate: today,
		currency: "Quetzales (GTQ)",

		// Vehicle basic info
		make: vehicleData.vehicleMake || "No especificado",
		model: vehicleData.vehicleModel || "No especificado",
		year: vehicleData.vehicleYear || "No especificado",
		trim: vehicleData.trim || "No especificado", // New Field
		age: vehicleAge,
		licensePlate: vehicleData.licensePlate || "No especificado",
		vin: vehicleData.vinNumber || "No especificado",
		color: vehicleData.color || "No especificado",
		vehicleType: vehicleData.vehicleType || "No especificado",

		// Technical specs
		cylinders: vehicleData.cylinders || "No especificado",
		engineCC: vehicleData.engineCC || "No especificado",
		fuelType: vehicleData.fuelType || "No especificado",
		transmission: vehicleData.transmission || "No especificado",
		origin: vehicleData.origin || "No especificado",
		traction: vehicleData.traction || "No especificado", // New Field

		// Mileage
		kmMileage: vehicleData.kmMileage || "No especificado",
		milesMileage: vehicleData.milesMileage || "No especificado",

		// Inspection details
		technicianName: vehicleData.technicianName || "No especificado",
		inspectionDate: vehicleData.inspectionDate
			? new Date(vehicleData.inspectionDate).toLocaleDateString("es-GT")
			: today,
		inspectionResult: vehicleData.inspectionResult || "No especificado",

		// New Condition details
		tiresCondition: vehicleData.tiresCondition
			? `${vehicleData.tiresCondition}%`
			: "No especificado",
		tireConditionFrontLeft: vehicleData.tireConditionFrontLeft
			? `${vehicleData.tireConditionFrontLeft}%`
			: "No especificado",
		tireConditionFrontRight: vehicleData.tireConditionFrontRight
			? `${vehicleData.tireConditionFrontRight}%`
			: "No especificado",
		tireConditionRearLeft: vehicleData.tireConditionRearLeft
			? `${vehicleData.tireConditionRearLeft}%`
			: "No especificado",
		tireConditionRearRight: vehicleData.tireConditionRearRight
			? `${vehicleData.tireConditionRearRight}%`
			: "No especificado",
		hasSpareTire:
			vehicleData.hasSpareTire === "Sí" || vehicleData.hasSpareTire === true,
		tireConditionSpare: vehicleData.tireConditionSpare
			? `${vehicleData.tireConditionSpare}%`
			: "No especificado",
		paintCondition: vehicleData.paintCondition
			? `${vehicleData.paintCondition}%`
			: "No especificado",
		hasAgencyHistory:
			vehicleData.hasAgencyHistory === "Sí" ||
			vehicleData.hasAgencyHistory === true
				? "Sí"
				: "No",

		// Issues and condition
		criticalIssues: criticalIssues.map((item) => item.item),
		warningIssues: warningIssues.map((item) => item.item),
		criticalIssueCount: criticalIssues.length,
		warningIssueCount: warningIssues.length,

		// Equipment and features
		vehicleEquipment: vehicleData.vehicleEquipment || "No especificado",
		importantConsiderations: vehicleData.importantConsiderations || "Ninguna",

		// Technical checks
		scannerUsed: vehicleData.scannerUsed === "Sí",
		airbagWarning: vehicleData.airbagWarning === "Sí",
		missingAirbag: vehicleData.missingAirbag || "Ninguno",
		testDrive: vehicleData.testDrive === "Sí",
		noTestDriveReason: vehicleData.noTestDriveReason || "No aplicable",

		// Documentation
		photoCount: photos?.length || 0,
		photoCategories,
		hasExteriorPhotos: (photoCategories["exterior"] || 0) > 0,
		hasInteriorPhotos: (photoCategories["interior"] || 0) > 0,
		hasEnginePhotos: (photoCategories["engine"] || 0) > 0,
		hasDamagePhotos: (photoCategories["damage"] || 0) > 0,

		// Photo valuator comments (key insights from photos)
		photoComments,
		hasPhotoComments: photoComments.length > 0,
	};
}
