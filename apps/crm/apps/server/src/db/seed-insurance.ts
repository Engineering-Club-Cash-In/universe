import * as fs from "fs";
import * as path from "path";
import { db } from "./index";
import { insuranceCosts } from "./schema";

interface InsuranceDataItem {
	precio: number;
	inrexsa: number;
	pickUp: number;
	panelCamionMicrobus: number;
	membresia: number;
}

async function seedInsurance() {
	try {
		console.log("Cargando datos de seguros desde JSON...");

		const jsonPath = "/tmp/excel_reader/insurance_table.json";
		const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

		console.log(`Insertando ${data.length} registros...`);

		// Insertar en lotes de 100
		const batchSize = 100;
		for (let i = 0; i < data.length; i += batchSize) {
			const batch = data.slice(i, i + batchSize);
			await db.insert(insuranceCosts).values(
				batch.map((item: InsuranceDataItem) => ({
					price: item.precio,
					inrexsa: item.inrexsa.toFixed(2),
					pickUp: item.pickUp.toFixed(2),
					panelCamionMicrobus: item.panelCamionMicrobus.toFixed(2),
					membership: item.membresia.toFixed(2),
				})),
			);
			console.log(
				`Insertados ${Math.min(i + batchSize, data.length)} / ${data.length}`,
			);
		}

		console.log("✓ Datos de seguros cargados exitosamente");
		process.exit(0);
	} catch (error) {
		console.error("Error al cargar datos de seguros:", error);
		process.exit(1);
	}
}

seedInsurance();
