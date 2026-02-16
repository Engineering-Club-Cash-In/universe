import { eq } from "drizzle-orm";
import * as fs from "fs";
import { db } from "./index";
import { insuranceCosts } from "./schema";

async function seedBusInsurance() {
	try {
		console.log("Cargando datos de seguros de bus RCDP desde JSON...");

		const jsonPath = new URL("./bus-insurance-data.json", import.meta.url)
			.pathname;
		const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

		console.log(`Procesando ${data.length} registros de bus...`);

		let updated = 0;
		let skipped = 0;

		for (const item of data) {
			// Solo actualizar filas existentes para no crear filas con 0.00 en columnas de otros tipos
			const [existing] = await db
				.select()
				.from(insuranceCosts)
				.where(eq(insuranceCosts.price, item.price))
				.limit(1);

			if (existing) {
				await db
					.update(insuranceCosts)
					.set({
						busHasta20: item.bus_hasta_20.toFixed(2),
						bus21a35: item.bus_21_a_35.toFixed(2),
						busMas35: item.bus_mas_35.toFixed(2),
					})
					.where(eq(insuranceCosts.price, item.price));
				updated++;
			} else {
				skipped++;
			}
		}

		console.log(
			`✓ Datos de seguros de bus cargados: ${updated} actualizados, ${skipped} omitidos (sin fila base)`,
		);
		process.exit(0);
	} catch (error) {
		console.error("Error al cargar datos de seguros de bus:", error);
		process.exit(1);
	}
}

seedBusInsurance();
