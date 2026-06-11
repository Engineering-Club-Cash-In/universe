import type { Context } from "hono";
import { db } from "../db";
import { vehicleInspections, vehicles } from "../db/schema/vehicles";

interface CarData {
	"TALLER QUE RECIBIÓ": string;
	Placa: string;
	Marca: string;
	Linea: string;
	Modelo: number;
	Llaves: number;
	GPS: string;
	"STATUS ACTUAL DEL PROCESO ": string;
	Cliente: string;
	"Monto cotizacion pintura": string;
	"Monto cotizacion mecánica": string;
	"Gastos adicionales": string;
	"Cotizacion autorizada": string;
	"Costo sin reparacion": string;
	"Costo con reparacion": string;
	"Valor mercado": string;
	"Valor comercial": string;
	"Valor  bancario": string;
	"Referencia de precio #1": string;
	"Referencia de precio #2": string;
	"Referencia de precio #3": string;
	"Precio de venta": string;
	"Precio de remate": string;
	Observaciones: string;
	Procedenica: string;
	"OFERTA COMPRA ACTIVOS EXTRA": string;
	"VENTA CERRADA": string;
	"Fecha Venta": string;
	"Unnamed: 28": string;
}

/**
 * Mapea el status del Excel al enum de la base de datos
 */
function mapVehicleStatus(
	status: string,
): "pending" | "available" | "sold" | "maintenance" | "auction" {
	const statusLower = status.toLowerCase().trim();

	if (statusLower.includes("vendido")) {
		return "sold";
	}
	if (
		statusLower.includes("en taller") ||
		statusLower.includes("taller") ||
		statusLower.includes("reparación")
	) {
		return "maintenance";
	}
	if (
		statusLower.includes("venta") ||
		statusLower.includes("listo") ||
		statusLower.includes("pronto")
	) {
		return "available";
	}
	if (statusLower.includes("remate") || statusLower.includes("auction")) {
		return "auction";
	}

	return "pending";
}

/**
 * Mapea el status a inspection_status
 */
function mapInspectionStatus(
	status: string,
): "pending" | "approved" | "rejected" | "auction" {
	const statusLower = status.toLowerCase().trim();

	if (statusLower.includes("vendido")) {
		return "approved";
	}
	if (
		statusLower.includes("venta") ||
		statusLower.includes("listo") ||
		statusLower.includes("pronto")
	) {
		return "approved";
	}
	if (statusLower.includes("remate") || statusLower.includes("auction")) {
		return "auction";
	}

	return "pending";
}

/**
 * Limpia valores monetarios: "Q388.959,33" -> "388959.33"
 */
function cleanMoneyValue(value: string): string | null {
	if (!value || value.trim() === "") return null;

	// Remover Q, espacios, y puntos de miles
	const cleaned = value
		.replace(/Q/g, "")
		.replace(/\s/g, "")
		.replace(/\./g, "")
		.replace(/,/g, ".");

	const parsed = Number.parseFloat(cleaned);
	return Number.isNaN(parsed) ? null : parsed.toString();
}

/**
 * Controlador para cargar vehículos desde un JSON
 */
export async function loadCarsController(c: Context) {
	try {
		const body = await c.req.json<CarData[]>();

		if (!Array.isArray(body)) {
			return c.json({ error: "Se espera un array de vehículos" }, 400);
		}

		const results = [];

		for (const car of body) {
			try {
				console.log("Procesando vehículo:", car.Placa, car.Marca, car.Linea);

				// 1. Crear el vehículo en la tabla vehicles
				const vehicleData: any = {
					make: car.Marca || "Desconocido",
					model: car.Linea || "Desconocido",
					year: Math.floor(car.Modelo) || new Date().getFullYear(),
					color: "No especificado",
					vehicleType: "No especificado",
					status: mapVehicleStatus(car["STATUS ACTUAL DEL PROCESO "] || ""),
					gpsActivo: car.GPS?.toLowerCase() === "si",
					isNew: false,
				};

				// Solo agregar licensePlate si tiene valor
				if (car.Placa && car.Placa.trim() !== "") {
					vehicleData.licensePlate = car.Placa.trim();
				}

				// Solo agregar notes si tiene valor
				if (car.Observaciones && car.Observaciones.trim() !== "") {
					vehicleData.notes = car.Observaciones.trim();
				}

				console.log("Datos del vehículo a insertar:", vehicleData);

				// Usar onConflictDoUpdate para actualizar si la placa ya existe
				const [newVehicle] = await db
					.insert(vehicles)
					.values(vehicleData)
					.onConflictDoUpdate({
						target: vehicles.licensePlate,
						set: {
							make: vehicleData.make,
							model: vehicleData.model,
							year: vehicleData.year,
							color: vehicleData.color,
							vehicleType: vehicleData.vehicleType,
							status: vehicleData.status,
							gpsActivo: vehicleData.gpsActivo,
							isNew: vehicleData.isNew,
							notes: vehicleData.notes,
							updatedAt: new Date(),
						},
					})
					.returning();

				console.log("Vehículo creado con ID:", newVehicle.id);

				// 2. Crear registro en vehicle_inspections
				const marketValue = cleanMoneyValue(car["Valor mercado"]);
				const commercialValue = cleanMoneyValue(car["Valor comercial"]);
				const bankValue = cleanMoneyValue(car["Valor  bancario"]);
				const currentCondition = cleanMoneyValue(
					car["Costo con reparacion"] || car["Costo sin reparacion"],
				);

				console.log("Valores monetarios:", {
					marketValue,
					commercialValue,
					bankValue,
					currentCondition,
				});

				const inspectionData: any = {
					vehicleId: newVehicle.id,
					technicianName: car["TALLER QUE RECIBIÓ"] || "No especificado",
					inspectionDate: new Date(),
					inspectionResult: `Cliente: ${car.Cliente || "N/A"}. Estado: ${car["STATUS ACTUAL DEL PROCESO "] || "N/A"}`,
					vehicleRating: "Comercial",
					marketValue: marketValue || "0",
					suggestedCommercialValue: commercialValue || marketValue || "0",
					bankValue: bankValue || "0",
					currentConditionValue: currentCondition || marketValue || "0",
					vehicleEquipment: `${car.Llaves || 0} llaves. GPS: ${car.GPS || "No"}`,
					scannerUsed: false,
					airbagWarning: false,
					testDrive: false,
					status: mapInspectionStatus(car["STATUS ACTUAL DEL PROCESO "] || ""),
					alerts: [],
					sectionTimes: {},
				};

				// Solo agregar importantConsiderations si tiene valor
				if (car.Observaciones && car.Observaciones.trim() !== "") {
					inspectionData.importantConsiderations = car.Observaciones.trim();
				}

				console.log("Datos de inspección a insertar:", inspectionData);

				const [newInspection] = await db
					.insert(vehicleInspections)
					.values(inspectionData)
					.returning();

				results.push({
					success: true,
					vehicle: newVehicle,
					inspection: newInspection,
					originalData: {
						placa: car.Placa,
						marca: car.Marca,
						linea: car.Linea,
						cliente: car.Cliente,
					},
				});
			} catch (error) {
				console.error("Error procesando vehículo:", car.Placa, error);
				const errorMessage =
					error instanceof Error ? error.message : "Error desconocido";
				const errorStack = error instanceof Error ? error.stack : "";
				results.push({
					success: false,
					error: errorMessage,
					errorStack: errorStack,
					originalData: {
						placa: car.Placa,
						marca: car.Marca,
						linea: car.Linea,
					},
				});
			}
		}

		return c.json({
			message: "Proceso completado",
			total: body.length,
			successful: results.filter((r) => r.success).length,
			failed: results.filter((r) => !r.success).length,
			results,
		});
	} catch (error) {
		console.error("Error en loadCarsController:", error);
		return c.json(
			{
				error: "Error procesando la solicitud",
				details: error instanceof Error ? error.message : "Error desconocido",
			},
			500,
		);
	}
}
