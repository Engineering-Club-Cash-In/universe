import { eq } from "drizzle-orm";
import { opportunities, vehicles } from "@/db/schema";
import { db } from "../db";

/* Controller: getVehicleByCodigoController */

export const getVehicleByCodigoController = async (numero_sifco: string) => {
	if (!numero_sifco) {
		return { success: false, message: "no sifco is required" };
	}

	try {
		// TODO: replace `opportunities.id` with the actual filter field once defined
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
			.where(eq(opportunities.numeroSifco, numero_sifco)) // <-- swap field here
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
