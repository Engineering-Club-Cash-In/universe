import { sql } from "drizzle-orm";
import * as fs from "fs";
import { db } from "./index";
import { insuranceCosts } from "./schema";

async function seedInsurance() {
	try {
		console.log("Cargando datos de seguros desde JSON...");

		const jsonPath = "/tmp/excel_reader/insurance_table.json";
		const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

		console.log(`Insertando/actualizando ${data.length} registros...`);

		// Insertar en lotes de 100 con upsert
		const batchSize = 100;
		for (let i = 0; i < data.length; i += batchSize) {
			const batch = data.slice(i, i + batchSize);
			await db
				.insert(insuranceCosts)
				.values(
					batch.map((item: any) => ({
						price: item.precio,
						inrexsa: item.inrexsa.toString(),
						pickUp: item.pickUp.toString(),
						panelCamionMicrobus: item.panelCamionMicrobus.toString(),
						membership: item.membresia.toString(),
					})),
				)
				.onConflictDoUpdate({
					target: insuranceCosts.price,
					set: {
						inrexsa: sql`EXCLUDED.inrexsa`,
						pickUp: sql`EXCLUDED.pick_up`,
						panelCamionMicrobus: sql`EXCLUDED.panel_camion_microbus`,
						membership: sql`EXCLUDED.membership`,
					},
				});
			console.log(
				`Procesados ${Math.min(i + batchSize, data.length)} / ${data.length}`,
			);
		}

		console.log("Datos de seguros cargados exitosamente");
		process.exit(0);
	} catch (error) {
		console.error("Error al cargar datos de seguros:", error);
		process.exit(1);
	}
}

seedInsurance();
