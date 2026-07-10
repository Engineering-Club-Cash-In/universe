import { and, desc, eq, inArray } from "drizzle-orm";
import { opportunities, vehicles } from "@/db/schema";
import { db } from "../db";

/* Controller: getVehicleByCodigoController */

export const getVehicleByCodigoController = async (numero_sifco: string) => {
	if (!numero_sifco) {
		return { success: false, message: "no sifco is required" };
	}

	try {
		const result = await db
			.select({
					vehicle: {
					id: vehicles.id,
					make: vehicles.make,
					model: vehicles.model,
					year: vehicles.year,
					licensePlate: vehicles.licensePlate,
					vinNumber: vehicles.vinNumber,
					color: vehicles.color,
					vehicleType: vehicles.vehicleType,
					kmMileage: vehicles.kmMileage,
					fuelType: vehicles.fuelType,
					transmission: vehicles.transmission,
					status: vehicles.status,
					seguroVigente: vehicles.seguroVigente,
					numeroPoliza: vehicles.numeroPoliza,
					companiaSeguro: vehicles.companiaSeguro,
					fechaVencimientoSeguro: vehicles.fechaVencimientoSeguro,
					gpsActivo: vehicles.gpsActivo,
					notes: vehicles.notes,
				},
			})
			.from(opportunities)
			.innerJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
			.where(
				and(
					eq(opportunities.numeroSifco, numero_sifco),
					inArray(opportunities.status, ["won", "migrate"]),
				),
			)
			.orderBy(desc(opportunities.updatedAt), desc(opportunities.createdAt))
			.limit(1)
			.then((rows) => rows[0] || null);

		if (!result) {
			return {
				success: false,
				message: "No vehicle found for the given codigo",
			};
		}

		return {
			success: true,
			data: result,
		};
	} catch (err: any) {
		console.error("[ERROR] getVehicleByCodigoController:", err);
		return {
			success: false,
			message: err.message || "Internal server error",
		};
	}
};

export type VehicleBySifco = {
	numeroSifco: string;
	licensePlate: string | null;
	vinNumber: string | null;
};

export const getVehiclesBySifcoController = async (numeroSifcos: string[]) => {
	const uniqueSifcos = [...new Set(numeroSifcos.map((value) => value.trim()).filter(Boolean))];

	if (uniqueSifcos.length === 0) {
		return { success: true, data: { vehicles: [] as VehicleBySifco[] } };
	}

	try {
		const rows = await db
			.select({
				numeroSifco: opportunities.numeroSifco,
				licensePlate: vehicles.licensePlate,
				vinNumber: vehicles.vinNumber,
			})
			.from(opportunities)
			.innerJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
			.where(
				and(
					inArray(opportunities.numeroSifco, uniqueSifcos),
					inArray(opportunities.status, ["won", "migrate"]),
				),
			)
			.orderBy(desc(opportunities.updatedAt), desc(opportunities.createdAt));

		const seen = new Set<string>();
		const matchedVehicles: VehicleBySifco[] = [];
		for (const row of rows) {
			if (!row.numeroSifco || seen.has(row.numeroSifco)) continue;
			seen.add(row.numeroSifco);
			matchedVehicles.push({
				numeroSifco: row.numeroSifco,
				licensePlate: row.licensePlate,
				vinNumber: row.vinNumber,
			});
		}

		return { success: true, data: { vehicles: matchedVehicles } };
	} catch (err: any) {
		console.error("[ERROR] getVehiclesBySifcoController:", err);
		return {
			success: false,
			message: err.message || "Internal server error",
		};
	}
};
