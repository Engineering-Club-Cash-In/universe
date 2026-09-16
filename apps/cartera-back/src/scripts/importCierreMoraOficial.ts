import { createHash } from "node:crypto";
import { basename } from "node:path";
import { Pool } from "pg";
import * as XLSX from "xlsx";
import {
	findOfficialSummarySheetName,
	parseOfficialAdvisorSummaryMatrix,
	parseOfficialClosureMatrix,
	saveOfficialClosure,
	summarizeOfficialAdvisorClosure,
} from "../controllers/cierreMoraOficial";

const [filePath, periodo, fechaCorte, porcentajeMora, mode] = Bun.argv.slice(2);
if (!filePath || !periodo || !fechaCorte || !porcentajeMora) {
	throw new Error(
		"Uso: bun src/scripts/importCierreMoraOficial.ts <archivo.xlsx> <YYYY-MM-01> <fecha-corte-ISO> <porcentaje-mora> [--write]",
	);
}

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error("SUPABASE_DB_URL no está configurada");
const databaseUrl = new URL(connectionString);
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const write = mode === "--write";
if (
	write &&
	!localHosts.has(databaseUrl.hostname) &&
	process.env.ALLOW_OFFICIAL_CLOSURE_IMPORT !== "YES"
) {
	throw new Error(
		"La importación remota requiere ALLOW_OFFICIAL_CLOSURE_IMPORT=YES",
	);
}

const normalizeName = (value: string) =>
	value
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.trim()
		.replace(/\s+/g, " ")
		.toLocaleLowerCase("es");

const source = Buffer.from(await Bun.file(filePath).arrayBuffer());
const fuenteHash = createHash("sha256").update(source).digest("hex");
const workbook = XLSX.read(source, {
	raw: true,
	cellFormula: false,
	cellStyles: false,
});
const detailSheet = workbook.Sheets["Listado de moras"];
if (!detailSheet)
	throw new Error("El archivo no contiene la hoja Listado de moras");
const summarySheetName = findOfficialSummarySheetName(workbook.SheetNames);
const summarySheet = workbook.Sheets[summarySheetName];
if (!summarySheet)
	throw new Error("El archivo no contiene la hoja Cierre - Cobros");
const toMatrix = (sheet: XLSX.WorkSheet) =>
	XLSX.utils.sheet_to_json<unknown[]>(sheet, {
		header: 1,
		raw: true,
		defval: null,
		blankrows: false,
	});

const pool = new Pool({
	connectionString,
	ssl: localHosts.has(databaseUrl.hostname)
		? false
		: { rejectUnauthorized: false },
});

try {
	const advisors = await pool.query<{ asesor_id: number; nombre: string }>(
		"SELECT asesor_id, nombre FROM cartera.asesores",
	);
	const advisorIds = new Map(
		advisors.rows.map((advisor) => [
			normalizeName(advisor.nombre),
			advisor.asesor_id,
		]),
	);
	const resolveAdvisorId = (name: string) =>
		advisorIds.get(normalizeName(name));
	const detail = parseOfficialClosureMatrix(
		toMatrix(detailSheet),
		resolveAdvisorId,
	);
	const rows = parseOfficialAdvisorSummaryMatrix(
		toMatrix(summarySheet),
		detail,
		resolveAdvisorId,
	);
	const summary = summarizeOfficialAdvisorClosure(
		periodo,
		rows,
		porcentajeMora,
	);
	const response = {
		mode: write ? "written" : "dry-run",
		periodo,
		posiciones: detail.length,
		asesores: rows.length,
		capitalTotal: summary.capitalCartera.total,
		mora30: summary.totales.mora_30.sumaCapital,
		mora60: summary.totales.mora_60.sumaCapital,
		mora90: summary.totales.mora_90.sumaCapital,
		mora120: summary.totales.mora_120_plus.sumaCapital,
		porcentajeMora: summary.moraMensual.porcentaje,
		moraMensualEsperada: summary.moraMensual.esperado,
	};

	if (write) {
		await saveOfficialClosure(pool, {
			periodo,
			fechaCorte,
			reglaVersion: "finanzas-v1",
			porcentajeMora,
			fuente: basename(filePath),
			fuenteHash,
			rows,
		});
	}

	console.log(JSON.stringify(response, null, 2));
} finally {
	await pool.end();
}
