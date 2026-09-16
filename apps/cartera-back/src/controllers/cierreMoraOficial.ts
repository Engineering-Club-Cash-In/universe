import Big from "big.js";
import type { Pool } from "pg";

export type OfficialClassification =
	| "AL_DIA"
	| "MORA_30"
	| "MORA_60"
	| "MORA_90"
	| "MORA_120";

export type OfficialClosureDetailRow = {
	asesorId: number;
	asesorNombre: string;
	clasificacion: OfficialClassification;
};

export type OfficialAdvisorClosureRow = {
	asesorId: number;
	asesorNombre: string;
	capital: string;
	mora30: string;
	mora60: string;
	mora90: string;
	mora120: string;
	cantidadMora30: number;
	cantidadMora60: number;
	cantidadMora90: number;
	cantidadMora120: number;
};

const displayMoney = (value: Big) => value.toFixed(2);

export function findOfficialSummarySheetName(sheetNames: string[]) {
	const matches = sheetNames.filter((name) =>
		name.startsWith("Cierre - Cobros "),
	);
	if (matches.length !== 1) {
		throw new Error(
			`Se esperaba una hoja 'Cierre - Cobros ...' y se encontraron ${matches.length}`,
		);
	}
	return matches[0];
}

const decimalCell = (value: unknown) => {
	if (value === null || value === undefined || value === "") return "0";
	const decimal = String(value).trim();
	try {
		return new Big(decimal).toString();
	} catch {
		throw new Error(`Monto oficial inválido: ${decimal}`);
	}
};

const classificationByLabel: Record<string, OfficialClassification> = {
	"al día": "AL_DIA",
	"mora 30": "MORA_30",
	"mora 60": "MORA_60",
	"mora 90": "MORA_90",
	"mora 120": "MORA_120",
};

export function parseOfficialClosureMatrix(
	matrix: unknown[][],
	resolveAdvisorId: (name: string) => number | undefined,
): OfficialClosureDetailRow[] {
	const header = matrix[0] ?? [];
	if (
		String(header[0] ?? "").trim() !== "Asesor" ||
		String(header[1] ?? "").trim() !== "Numero de credito" ||
		String(header[8] ?? "").trim() !== "Mora"
	) {
		throw new Error("La hoja Listado de moras no tiene el formato esperado");
	}

	return matrix.slice(1).map((row, index) => {
		const asesorNombre = String(row[0] ?? "").trim();
		const label = String(row[8] ?? "")
			.trim()
			.toLocaleLowerCase("es");
		const clasificacion = classificationByLabel[label];
		const asesorId = resolveAdvisorId(asesorNombre);
		if (!clasificacion) {
			throw new Error(`Clasificación oficial inválida en fila ${index + 2}`);
		}
		if (asesorId === undefined) {
			throw new Error(`Asesor oficial no encontrado: ${asesorNombre}`);
		}
		return { asesorId, asesorNombre, clasificacion };
	});
}

export function parseOfficialAdvisorSummaryMatrix(
	matrix: unknown[][],
	detail: OfficialClosureDetailRow[],
	resolveAdvisorId: (name: string) => number | undefined,
): OfficialAdvisorClosureRow[] {
	const sectionIndex = matrix.findIndex((row) =>
		row.some((cell) => String(cell ?? "").trim() === "Datos sin ajustes"),
	);
	const relativeHeaderIndex = matrix
		.slice(sectionIndex + 1)
		.findIndex((row) =>
			row.some(
				(cell, index) =>
					String(cell ?? "").trim() === "Asesor" &&
					String(row[index + 1] ?? "").trim() === "Capital",
			),
		);
	if (sectionIndex < 0 || relativeHeaderIndex < 0) {
		throw new Error("El cierre no contiene el cuadro Datos sin ajustes");
	}
	const headerIndex = sectionIndex + 1 + relativeHeaderIndex;

	const advisorColumn = (matrix[headerIndex] ?? []).findIndex(
		(cell) => String(cell ?? "").trim() === "Asesor",
	);
	const counts = new Map<
		number,
		Pick<
			OfficialAdvisorClosureRow,
			"cantidadMora30" | "cantidadMora60" | "cantidadMora90" | "cantidadMora120"
		>
	>();
	for (const row of detail) {
		const current = counts.get(row.asesorId) ?? {
			cantidadMora30: 0,
			cantidadMora60: 0,
			cantidadMora90: 0,
			cantidadMora120: 0,
		};
		if (row.clasificacion === "MORA_30") current.cantidadMora30 += 1;
		if (row.clasificacion === "MORA_60") current.cantidadMora60 += 1;
		if (row.clasificacion === "MORA_90") current.cantidadMora90 += 1;
		if (row.clasificacion === "MORA_120") current.cantidadMora120 += 1;
		counts.set(row.asesorId, current);
	}

	const rows: OfficialAdvisorClosureRow[] = [];
	for (const source of matrix.slice(headerIndex + 1)) {
		const asesorNombre = String(source[advisorColumn] ?? "").trim();
		if (asesorNombre === "Total") break;
		if (!asesorNombre) continue;
		const asesorId = resolveAdvisorId(asesorNombre);
		if (asesorId === undefined) {
			throw new Error(`Asesor oficial no encontrado: ${asesorNombre}`);
		}
		const advisorCounts = counts.get(asesorId);
		if (!advisorCounts) {
			throw new Error(
				`El asesor ${asesorNombre} no aparece en Listado de moras`,
			);
		}
		rows.push({
			asesorId,
			asesorNombre,
			capital: decimalCell(source[advisorColumn + 1]),
			mora30: decimalCell(source[advisorColumn + 2]),
			mora60: decimalCell(source[advisorColumn + 3]),
			mora90: decimalCell(source[advisorColumn + 4]),
			mora120: decimalCell(source[advisorColumn + 5]),
			...advisorCounts,
		});
	}

	if (rows.length !== counts.size) {
		throw new Error(
			"El cuadro sin ajustes y el detalle no tienen los mismos asesores",
		);
	}
	return rows;
}

type Bucket = { cantidad: number; sumaCapital: string; sumaMora: string };
const bucket = (cantidad: number, capital: string): Bucket => ({
	cantidad,
	sumaCapital: displayMoney(new Big(capital)),
	sumaMora: "0.00",
});

export function summarizeOfficialAdvisorClosure(
	periodo: string,
	rows: OfficialAdvisorClosureRow[],
) {
	const sumMoney = (select: (row: OfficialAdvisorClosureRow) => string) =>
		rows.reduce((sum, row) => sum.plus(select(row)), new Big(0));
	const sumCount = (select: (row: OfficialAdvisorClosureRow) => number) =>
		rows.reduce((sum, row) => sum + select(row), 0);

	return {
		periodo,
		totales: {
			mora_30: bucket(
				sumCount((row) => row.cantidadMora30),
				displayMoney(sumMoney((row) => row.mora30)),
			),
			mora_60: bucket(
				sumCount((row) => row.cantidadMora60),
				displayMoney(sumMoney((row) => row.mora60)),
			),
			mora_90: bucket(
				sumCount((row) => row.cantidadMora90),
				displayMoney(sumMoney((row) => row.mora90)),
			),
			mora_120_plus: bucket(
				sumCount((row) => row.cantidadMora120),
				displayMoney(sumMoney((row) => row.mora120)),
			),
		},
		porAsesor: rows.map((row) => ({
			asesorId: row.asesorId,
			nombre: row.asesorNombre,
			mora_30: bucket(row.cantidadMora30, row.mora30),
			mora_60: bucket(row.cantidadMora60, row.mora60),
			mora_90: bucket(row.cantidadMora90, row.mora90),
			mora_120_plus: bucket(row.cantidadMora120, row.mora120),
		})),
		capitalCartera: {
			total: displayMoney(sumMoney((row) => row.capital)),
			porAsesor: rows.map((row) => ({
				asesorId: row.asesorId,
				nombre: row.asesorNombre,
				capital: displayMoney(new Big(row.capital)),
			})),
		},
		metadata: { fuente: "oficial" as const, inmutable: true as const },
	};
}

export type SaveOfficialClosureInput = {
	periodo: string;
	fechaCorte: string;
	reglaVersion: string;
	fuente: string;
	fuenteHash: string;
	rows: OfficialAdvisorClosureRow[];
};

export async function getOfficialClosure(
	pool: Pick<Pool, "connect">,
	periodo: string,
	asesores?: number[],
) {
	const connection = await pool.connect();
	try {
		const result = await connection.query<{
			asesor_id: number;
			asesor_nombre: string;
			capital: string;
			mora_30: string;
			mora_60: string;
			mora_90: string;
			mora_120: string;
			cantidad_mora_30: number;
			cantidad_mora_60: number;
			cantidad_mora_90: number;
			cantidad_mora_120: number;
		}>(
			`SELECT
         cierre.asesor_id, cierre.asesor_nombre,
         cierre.capital_cierre::text AS capital,
         cierre.capital_mora_30::text AS mora_30,
         cierre.capital_mora_60::text AS mora_60,
         cierre.capital_mora_90::text AS mora_90,
         cierre.capital_mora_120::text AS mora_120,
         cierre.cantidad_mora_30, cierre.cantidad_mora_60,
         cierre.cantidad_mora_90, cierre.cantidad_mora_120
       FROM cartera.cierre_mora_oficial cierre
       WHERE cierre.periodo = $1
         AND ($2::integer[] IS NULL OR cierre.asesor_id = ANY($2))
       ORDER BY cierre.asesor_nombre`,
			[periodo, asesores?.length ? asesores : null],
		);
		if (result.rows.length === 0) return null;
		return summarizeOfficialAdvisorClosure(
			periodo,
			result.rows.map((row) => ({
				asesorId: row.asesor_id,
				asesorNombre: row.asesor_nombre,
				capital: row.capital,
				mora30: row.mora_30,
				mora60: row.mora_60,
				mora90: row.mora_90,
				mora120: row.mora_120,
				cantidadMora30: row.cantidad_mora_30,
				cantidadMora60: row.cantidad_mora_60,
				cantidadMora90: row.cantidad_mora_90,
				cantidadMora120: row.cantidad_mora_120,
			})),
		);
	} finally {
		connection.release();
	}
}

export async function saveOfficialClosure(
	pool: Pick<Pool, "connect">,
	input: SaveOfficialClosureInput,
) {
	if (!/^\d{4}-\d{2}-01$/.test(input.periodo)) {
		throw new Error("El período debe ser el primer día del mes");
	}
	if (
		!/^\d{4}-\d{2}-\d{2}T/.test(input.fechaCorte) ||
		Number.isNaN(Date.parse(input.fechaCorte)) ||
		!input.fechaCorte.startsWith(input.periodo.slice(0, 7))
	) {
		throw new Error("La fecha de corte debe pertenecer al período oficial");
	}
	if (input.rows.length === 0) throw new Error("El cierre oficial está vacío");
	if (!/^[0-9a-f]{64}$/.test(input.fuenteHash)) {
		throw new Error("El hash SHA-256 de la fuente es inválido");
	}
	if (
		new Set(input.rows.map((row) => row.asesorId)).size !== input.rows.length
	) {
		throw new Error("El cierre oficial contiene asesores duplicados");
	}

	const connection = await pool.connect();
	try {
		await connection.query("BEGIN");
		await connection.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
			`periodo:${input.periodo}`,
		]);
		await connection.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
			`fuente:${input.fuenteHash}`,
		]);
		const reusedSource = await connection.query<{ periodo: string }>(
			`SELECT periodo::text
       FROM cartera.cierre_mora_oficial
       WHERE fuente_hash = $1
       LIMIT 1`,
			[input.fuenteHash],
		);
		if (
			reusedSource.rows[0] &&
			reusedSource.rows[0].periodo !== input.periodo
		) {
			throw new Error(
				`La fuente ya fue importada para el período ${reusedSource.rows[0].periodo}`,
			);
		}
		const existing = await connection.query<{
			fuente_hash: string;
			asesores: number;
		}>(
			`SELECT fuente_hash, count(*)::integer AS asesores
       FROM cartera.cierre_mora_oficial
       WHERE periodo = $1
       GROUP BY fuente_hash`,
			[input.periodo],
		);
		if (existing.rowCount) {
			if (
				existing.rows.length === 1 &&
				existing.rows[0]?.fuente_hash === input.fuenteHash
			) {
				await connection.query("COMMIT");
				return {
					periodo: input.periodo,
					asesores: existing.rows[0].asesores,
					imported: false,
				};
			}
			throw new Error(
				`El período ${input.periodo} ya tiene un cierre oficial de otra fuente`,
			);
		}

		for (const row of input.rows) {
			await connection.query(
				`INSERT INTO cartera.cierre_mora_oficial (
          periodo, asesor_id, asesor_nombre, capital_cierre,
          capital_mora_30, capital_mora_60, capital_mora_90, capital_mora_120,
          cantidad_mora_30, cantidad_mora_60, cantidad_mora_90, cantidad_mora_120,
          fecha_corte, regla_version, fuente, fuente_hash
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15, $16
        )`,
				[
					input.periodo,
					row.asesorId,
					row.asesorNombre,
					row.capital,
					row.mora30,
					row.mora60,
					row.mora90,
					row.mora120,
					row.cantidadMora30,
					row.cantidadMora60,
					row.cantidadMora90,
					row.cantidadMora120,
					input.fechaCorte,
					input.reglaVersion,
					input.fuente,
					input.fuenteHash,
				],
			);
		}
		await connection.query("COMMIT");
		return {
			periodo: input.periodo,
			asesores: input.rows.length,
			imported: true,
		};
	} catch (error) {
		await connection.query("ROLLBACK");
		throw error;
	} finally {
		connection.release();
	}
}
