import { sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { getFileBuffer } from "../lib/storage";
import { db } from "./index";
import { gytInsuranceCosts } from "./schema";

// Key del Excel de tarifas GyT en R2 (bucket por defecto de storage).
// Subir el archivo a R2 bajo esta key, o sobreescribir con GYT_INSURANCE_XLSX_KEY.
const DEFAULT_WORKBOOK_KEY =
	"Precios junio 2026 (valor Universales actualizado).xlsx";

type GytInsuranceRow = {
	price: number;
	currentAutomovilCamioneta?: string;
	automovilCamioneta?: string;
	currentMicrobus?: string;
	microbus?: string;
};

function readGytRows(
	workbook: XLSX.WorkBook,
	sheetName: string,
	field: "automovilCamioneta" | "microbus",
): Map<number, GytInsuranceRow> {
	const sheet = workbook.Sheets[sheetName];
	if (!sheet) throw new Error(`No se encontró la hoja ${sheetName}`);

	const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
		header: 1,
		blankrows: false,
		defval: null,
	});
	const result = new Map<number, GytInsuranceRow>();
	const currentField =
		field === "automovilCamioneta"
			? "currentAutomovilCamioneta"
			: "currentMicrobus";

	for (const row of rows) {
		const price = row[1];
		const currentCost = row[2];
		const monthlyCost = row[9];

		if (typeof price !== "number" || typeof monthlyCost !== "number") continue;

		result.set(price, {
			price,
			...(typeof currentCost === "number" && {
				[currentField]: currentCost.toFixed(8),
			}),
			[field]: monthlyCost.toFixed(8),
		});
	}

	return result;
}

async function seedGytInsurance() {
	const workbookKey =
		process.env.GYT_INSURANCE_XLSX_KEY ?? DEFAULT_WORKBOOK_KEY;
	const buffer = await getFileBuffer(workbookKey);
	const workbook = XLSX.read(buffer, { type: "buffer" });
	const automovilRows = readGytRows(
		workbook,
		"AUTOMOVIL - CAMIONETA",
		"automovilCamioneta",
	);
	const microbusRows = readGytRows(workbook, "MICROBUS", "microbus");
	const merged = new Map<number, GytInsuranceRow>();

	for (const row of automovilRows.values()) merged.set(row.price, row);
	for (const row of microbusRows.values()) {
		const current = merged.get(row.price) ?? { price: row.price };
		merged.set(row.price, { ...current, ...row });
	}

	const values = [...merged.values()].sort((a, b) => a.price - b.price);
	let processed = 0;

	for (const row of values) {
		await db
			.insert(gytInsuranceCosts)
			.values({
				price: row.price,
				currentAutomovilCamioneta: row.currentAutomovilCamioneta,
				automovilCamioneta: row.automovilCamioneta,
				currentMicrobus: row.currentMicrobus,
				microbus: row.microbus,
			})
			.onConflictDoUpdate({
				target: gytInsuranceCosts.price,
				set: {
					currentAutomovilCamioneta: sql`COALESCE(EXCLUDED.current_automovil_camioneta, ${gytInsuranceCosts.currentAutomovilCamioneta})`,
					automovilCamioneta: sql`COALESCE(EXCLUDED.automovil_camioneta, ${gytInsuranceCosts.automovilCamioneta})`,
					currentMicrobus: sql`COALESCE(EXCLUDED.current_microbus, ${gytInsuranceCosts.currentMicrobus})`,
					microbus: sql`COALESCE(EXCLUDED.microbus, ${gytInsuranceCosts.microbus})`,
					updatedAt: new Date(),
				},
			});
		processed++;
	}

	console.log(
		`Tarifas GyT cargadas: ${processed} filas desde R2 (${workbookKey})`,
	);
}

seedGytInsurance()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error("Error al cargar tarifas GyT:", error);
		process.exit(1);
	});
