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
	const expectedHeaders = [
		"Asesor",
		"Capital",
		"Mora 30",
		"Mora 60",
		"Mora 90",
		"Mora 120",
	];
	if (
		expectedHeaders.some(
			(header, offset) =>
				String(matrix[headerIndex]?.[advisorColumn + offset] ?? "").trim() !==
				header,
		)
	) {
		throw new Error("El cuadro Datos sin ajustes no tiene el formato esperado");
	}
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

const parseOfficialMoraRate = (value: string) => {
	let rate: Big;
	try {
		rate = new Big(value);
	} catch {
		throw new Error("El porcentaje mensual de mora es inválido");
	}
	if (rate.lte(0) || rate.gt(100)) {
		throw new Error("El porcentaje mensual de mora es inválido");
	}
	const canonical = rate.toFixed(2);
	if (!rate.eq(canonical)) {
		throw new Error("El porcentaje mensual de mora admite máximo dos decimales");
	}
	return canonical;
};

export function summarizeOfficialAdvisorClosure(
	periodo: string,
	rows: OfficialAdvisorClosureRow[],
	porcentajeMora: string,
	asesores?: number[],
) {
	const porcentajeMoraCanonico = parseOfficialMoraRate(porcentajeMora);
	const sumMoney = (select: (row: OfficialAdvisorClosureRow) => string) =>
		rows.reduce((sum, row) => sum.plus(select(row)), new Big(0));
	const sumCount = (select: (row: OfficialAdvisorClosureRow) => number) =>
		rows.reduce((sum, row) => sum + select(row), 0);
	const rate = new Big(porcentajeMoraCanonico);
	const expectedFor = (row: OfficialAdvisorClosureRow) =>
		new Big(row.mora30)
			.plus(row.mora60)
			.plus(row.mora90)
			.plus(row.mora120)
			.times(rate)
			.div(100);
	const globalExpectedTotal = rows.reduce(
		(sum, row) => sum.plus(expectedFor(row)),
		new Big(0),
	);
	const expectedTotalCents = globalExpectedTotal
		.times(100)
		.round(0, Big.roundHalfUp);
	const allocations = rows.map((row) => {
		const exactCents = expectedFor(row).times(100);
		const cents = exactCents.round(0, Big.roundDown);
		return {
			asesorId: row.asesorId,
			cents,
			remainder: exactCents.minus(cents),
		};
	});
	let remainingCents = Number(
		expectedTotalCents
			.minus(
				allocations.reduce((sum, allocation) => sum.plus(allocation.cents), new Big(0)),
			)
			.toString(),
	);
	for (const allocation of [...allocations].sort(
		(left, right) =>
			right.remainder.cmp(left.remainder) || left.asesorId - right.asesorId,
	)) {
		if (remainingCents === 0) break;
		allocation.cents = allocation.cents.plus(1);
		remainingCents -= 1;
	}
	const expectedCentsByAdvisor = new Map(
		allocations.map((allocation) => [allocation.asesorId, allocation.cents]),
	);
	if (asesores?.length) {
		const selectedAdvisors = new Set(asesores);
		rows = rows.filter((row) => selectedAdvisors.has(row.asesorId));
	}
	const expectedTotal = rows.reduce(
		(sum, row) =>
			sum.plus(expectedCentsByAdvisor.get(row.asesorId) ?? new Big(0)),
		new Big(0),
	).div(100);

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
		moraMensual: {
			porcentaje: rate.toFixed(2),
			esperado: displayMoney(expectedTotal),
			porAsesor: rows.map((row) => ({
				asesorId: row.asesorId,
				nombre: row.asesorNombre,
				esperado: (expectedCentsByAdvisor.get(row.asesorId) ?? new Big(0))
					.div(100)
					.toFixed(2),
			})),
		},
		metadata: { fuente: "oficial" as const, inmutable: true as const },
	};
}

export type SaveOfficialClosureInput = {
	periodo: string;
	fechaCorte: string;
	reglaVersion: string;
	porcentajeMora: string;
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
			porcentaje_mora: string;
		}>(
			`SELECT
         cierre.asesor_id, cierre.asesor_nombre,
         cierre.capital_cierre::text AS capital,
         cierre.capital_mora_30::text AS mora_30,
         cierre.capital_mora_60::text AS mora_60,
         cierre.capital_mora_90::text AS mora_90,
         cierre.capital_mora_120::text AS mora_120,
         cierre.cantidad_mora_30, cierre.cantidad_mora_60,
         cierre.cantidad_mora_90, cierre.cantidad_mora_120,
         cierre.porcentaje_mora::text
       FROM cartera.cierre_mora_oficial cierre
       WHERE cierre.periodo = $1
       ORDER BY cierre.asesor_nombre`,
			[periodo],
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
			result.rows[0].porcentaje_mora,
			asesores,
		);
	} finally {
		connection.release();
	}
}

const GUATEMALA_MONTH = new Intl.DateTimeFormat("en-CA", {
	timeZone: "America/Guatemala",
	year: "numeric",
	month: "2-digit",
});

function getGuatemalaMonth(date: Date) {
	const parts = GUATEMALA_MONTH.formatToParts(date);
	const year = parts.find((part) => part.type === "year")?.value;
	const month = parts.find((part) => part.type === "month")?.value;
	return year && month ? `${year}-${month}` : null;
}

export async function saveOfficialClosure(
	pool: Pick<Pool, "connect">,
	input: SaveOfficialClosureInput,
) {
	if (!/^\d{4}-\d{2}-01$/.test(input.periodo)) {
		throw new Error("El período debe ser el primer día del mes");
	}
	const fechaCorte = new Date(input.fechaCorte);
	if (
		!/^\d{4}-\d{2}-\d{2}T/.test(input.fechaCorte) ||
		Number.isNaN(fechaCorte.getTime()) ||
		getGuatemalaMonth(fechaCorte) !== input.periodo.slice(0, 7)
	) {
		throw new Error("La fecha de corte debe pertenecer al período oficial");
	}
	if (input.rows.length === 0) throw new Error("El cierre oficial está vacío");
	if (!/^[0-9a-f]{64}$/.test(input.fuenteHash)) {
		throw new Error("El hash SHA-256 de la fuente es inválido");
	}
	const porcentajeMora = parseOfficialMoraRate(input.porcentajeMora);
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
			porcentaje_mora: string;
			asesores: number;
		}>(
			`SELECT fuente_hash, min(porcentaje_mora)::text AS porcentaje_mora,
              count(*)::integer AS asesores
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
				if (
					new Big(existing.rows[0].porcentaje_mora).toFixed(2) !==
					porcentajeMora
				) {
					throw new Error(
						`El cierre ${input.periodo} ya fue importado con otra tasa de mora`,
					);
				}
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
          fecha_corte, regla_version, porcentaje_mora, fuente, fuente_hash
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15, $16, $17
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
					porcentajeMora,
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
