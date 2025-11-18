import { z } from "zod";

// Schema for vehicle registration card (tarjeta de circulación) OCR extraction
export const vehicleRegistrationOCRSchema = z.object({
	// Basic document info
	documentNumber: z
		.string()
		.optional()
		.describe("Número de tarjeta de circulación (ej: 202506579150)"),
	uniqueCode: z
		.string()
		.optional()
		.describe("Código único identificador (ej: 2025-480937-8)"),
	validUntil: z
		.string()
		.optional()
		.describe("Válida hasta fecha (ej: 31/07/2026)"),

	// Owner information
	ownerName: z.string().optional().describe("Nombre completo del propietario"),
	nit: z.string().optional().describe("NIT del propietario"),
	cui: z.string().optional().describe("CUI del propietario"),

	// Vehicle basic info
	licensePlate: z
		.string()
		.optional()
		.describe("Número de placa del vehículo (ej: P0-018LKF)"),
	vehicleType: z
		.string()
		.optional()
		.describe("Tipo de vehículo (ej: CAMIONETA)"),
	make: z.string().optional().describe("Marca del vehículo (ej: CHANGAN)"),
	line: z
		.string()
		.optional()
		.describe("Línea del vehículo (ej: COROLLA, CIVIC)"),
	model: z.string().optional().describe("Año del vehículo (ej: 2020, 2023)"),

	// Technical specifications
	chassis: z.string().optional().describe("Número de chasis"),
	vin: z.string().optional().describe("Número VIN"),
	series: z.string().optional().describe("Número de serie"),
	motor: z.string().optional().describe("Número de motor"),
	seats: z.string().optional().describe("Número de asientos"),
	cylinders: z.string().optional().describe("Número de cilindros"),
	color: z.string().optional().describe("Color del vehículo"),
	axes: z.string().optional().describe("Número de ejes"),
	cc: z.string().optional().describe("Cilindrada del motor en CC"),
	ton: z.string().optional().describe("Tonelaje del vehículo"),

	// Dates
	registrationDate: z
		.string()
		.optional()
		.describe("Fecha de registro del vehículo"),
	issueDate: z.string().optional().describe("Fecha de emisión de la tarjeta"),
	issueTime: z.string().optional().describe("Hora de emisión de la tarjeta"),

	// Usage type
	use: z.string().optional().describe("Uso del vehículo (ej: PARTICULAR)"),

	// Extraction confidence
	extractionSuccess: z
		.boolean()
		.default(false)
		.describe("Si la extracción fue exitosa o no"),
	extractionErrors: z
		.array(z.string())
		.default([])
		.describe("Lista de errores o campos que no se pudieron extraer"),
});

export type VehicleRegistrationOCR = z.infer<
	typeof vehicleRegistrationOCRSchema
>;

// Helper function to map OCR data to vehicle form fields
export function mapOCRToVehicleForm(ocrData: VehicleRegistrationOCR) {
	return {
		// Map to form field names correctly
		vehicleMake: ocrData.make || "", // Marca
		vehicleModel: ocrData.line || "", // Línea (ej: YARIS IA, COROLLA)
		vehicleYear: ocrData.model || "", // Año (ej: 2017, 2023)
		licensePlate: ocrData.licensePlate || "",
		vinNumber: ocrData.vin || ocrData.chassis || ocrData.series || "",
		color: ocrData.color || "",
		cylinders: ocrData.cylinders || "",
		engineCC: ocrData.cc || "",
		vehicleType: ocrData.vehicleType || "",
		// Default values for fields not in tarjeta de circulación
		origin: "Nacional", // Default since it's a Guatemalan registration
		fuelType: "", // Not available in registration card
		transmission: "", // Not available in registration card
		kmMileage: "", // Not available in registration card
		milesMileage: "", // Not available in registration card
	};
}
