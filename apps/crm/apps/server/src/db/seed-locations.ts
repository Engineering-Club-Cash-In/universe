import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { db } from "./index";
import { guatemalaLocations } from "./schema/locations";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function seedLocations() {
	console.log("Cargando ubicaciones de Guatemala...");

	try {
		const csvPath = resolve(
			__dirname,
			"../../../../temp/guatemala_locations.csv",
		);
		const csvContent = readFileSync(csvPath, "utf-8");

		// El CSV tiene columnas duplicadas "nombre", usamos parse sin columns
		// Columna 0: cod_depto, Columna 1: nombre (depto), Columna 2: cod_mupio, Columna 3: nombre (municipio)
		const rawRecords = parse(csvContent, {
			skip_empty_lines: true,
		}) as string[][];

		// Saltamos el header
		const dataRows = rawRecords.slice(1);

		const locationsToInsert = dataRows.map((row) => ({
			departamento: row[1], // nombre del departamento
			municipio: row[3], // nombre del municipio
		}));

		console.log(`Procesando ${locationsToInsert.length} ubicaciones...`);

		// Insertar en lotes para mejor rendimiento
		const batchSize = 100;
		let inserted = 0;

		for (let i = 0; i < locationsToInsert.length; i += batchSize) {
			const batch = locationsToInsert.slice(i, i + batchSize);
			await db.insert(guatemalaLocations).values(batch).onConflictDoNothing();
			inserted += batch.length;
			console.log(`Insertados ${inserted}/${locationsToInsert.length}`);
		}

		console.log("Carga de ubicaciones completada!");
	} catch (error) {
		console.error("Error cargando ubicaciones:", error);
		process.exit(1);
	}
}

seedLocations().then(() => {
	process.exit(0);
});

export { seedLocations };
