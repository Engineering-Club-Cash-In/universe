import { describe, expect, it } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
	type MoraRecoverySourceRow,
	buildMoraRecoveryQuery,
	buildMoraRecoveryReport,
	getMoraRecoveryPeriod,
} from "./moraRecuperacion";

const rows: MoraRecoverySourceRow[] = [
	{
		asesorId: 1,
		nombre: "Ana",
		esperado: "100.00",
		generadoEnPeriodo: "0",
		cobradoEnSnapshot: "120.00",
		cobradoFueraSnapshot: "30.00",
	},
	{
		asesorId: null,
		nombre: "Sin asignar",
		esperado: "50.00",
		generadoEnPeriodo: "0",
		cobradoEnSnapshot: "20.00",
		cobradoFueraSnapshot: "0.00",
	},
	{
		asesorId: 2,
		nombre: "Beto",
		esperado: "0.00",
		generadoEnPeriodo: "0",
		cobradoEnSnapshot: "0.00",
		cobradoFueraSnapshot: "40.00",
	},
];

describe("buildMoraRecoveryReport", () => {
	it("construye el contrato SQL histórico con el ciclo, FULL JOIN y filtros actuales", () => {
		const period = getMoraRecoveryPeriod({
			mes: 6,
			anio: 2026,
			hoy: "2026-07-29",
		});
		const query = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery({
				...period,
				asesores: [7, 8],
				emailCobrador: "cashin@example.com",
			}),
		);

		expect(period).toEqual({
			inicio: "2026-06-06",
			fin: "2026-07-06",
			fechaSnapshot: "2026-06-06",
			alcance: "historico",
		});
		expect(query.sql).toContain("FULL JOIN pagos_por_credito");
		expect(query.sql).toContain("moras_historial");
		expect(query.sql).toContain("IN ('ACTIVO', 'MOROSO')");
		expect(query.sql).not.toContain("PENDIENTE_CANCELACION");
		expect(query.sql).not.toContain("INCOBRABLE");
		expect(query.sql).not.toContain("EN_CONVENIO");
		expect(query.sql).not.toContain("CANCELADO");
		expect(query.sql).not.toContain("CAIDO");
		expect(query.sql).toContain("LOWER(a.email_cash_in) = LOWER(TRIM($2))");
		expect(query.sql).toContain("a.asesor_id IN ($3, $4)");
		expect(query.sql).toContain("COALESCE(ca.nombre, 'Sin asignar')");
		expect(query.params).toEqual([
			"2026-06-06",
			"cashin@example.com",
			7,
			8,
			"2026-06-06",
			"2026-07-06",
			// Los límites del ciclo como instantes UTC: el día 6 GT empieza a las 06:00Z.
			"2026-06-06 06:00:00.000",
			"2026-07-06 06:00:00.000",
		]);
	});

	it("usa la misma población vigente para recuperación live e histórica", () => {
		const statusPopulation = "'ACTIVO', 'MOROSO'";
		for (const alcance of ["live", "historico"] as const) {
			const query = new PgDialect().sqlToQuery(
				buildMoraRecoveryQuery({
					inicio: "2026-06-06",
					fin: "2026-07-06",
					fechaSnapshot: "2026-06-06",
					alcance,
				}),
			);

			expect(query.sql).toContain(statusPopulation);
		}
	});

	it("usa un snapshot estrictamente anterior al inicio y cuenta el pago del día 6", () => {
		const period = getMoraRecoveryPeriod({
			mes: 6,
			anio: 2026,
			hoy: "2026-07-29",
		});
		const query = new PgDialect().sqlToQuery(buildMoraRecoveryQuery(period));
		const report = buildMoraRecoveryReport(
			[
				{
					asesorId: 1,
					nombre: "Ana",
					esperado: "100",
					generadoEnPeriodo: "0",
					cobradoEnSnapshot: "40",
					cobradoFueraSnapshot: "0",
				},
			],
			period,
		);

		expect(query.sql).toContain(
			"(h.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala')::date < $1::date",
		);
		expect(report.totales).toMatchObject({
			esperado: "100.00",
			cobradoEnSnapshot: "40.00",
			cobradoFueraSnapshot: "0.00",
			pendiente: "60.00",
		});
	});

	it("separa cobrado del snapshot, fuera, excedente y pendiente sin truncar", () => {
		const report = buildMoraRecoveryReport(rows, {
			inicio: "2026-06-06",
			fin: "2026-07-06",
			alcance: "historico",
		});

		expect(report.totales).toEqual({
			esperado: "150.00",
			cobradoEnSnapshot: "140.00",
			cobradoFueraSnapshot: "70.00",
			excedenteEnSnapshot: "20.00",
			pendiente: "30.00",
		});
		expect(
			report.porAsesor.find((row) => row.asesorId === 1)?.excedenteEnSnapshot,
		).toBe("20.00");
		expect(report.porAsesor.find((row) => row.asesorId === 2)?.pendiente).toBe(
			"0.00",
		);
	});

	it("conserva asesores exclusivos y representa Sin asignar de forma tipada", () => {
		const report = buildMoraRecoveryReport(rows, {
			inicio: "2026-06-06",
			fin: "2026-07-06",
			alcance: "historico",
		});

		expect(report.porAsesor.map((row) => row.asesorId)).toEqual([1, null, 2]);
		expect(report.porAsesor.find((row) => row.asesorId === null)).toMatchObject(
			{
				nombre: "Sin asignar",
				esperado: "50.00",
				pendiente: "30.00",
			},
		);
		expect(report.metadata).toEqual({
			alcance: "historico",
			atribucionAsesor: "actual",
		});
	});

	it("agrega por asesor sin permitir que excedentes compensen pendientes de otro crédito", () => {
		const report = buildMoraRecoveryReport(
			[
				{
					asesorId: 7,
					nombre: "Cora",
					esperado: "100",
					generadoEnPeriodo: "0",
					cobradoEnSnapshot: "140",
					cobradoFueraSnapshot: "0",
				},
				{
					asesorId: 7,
					nombre: "Cora",
					esperado: "80",
					generadoEnPeriodo: "0",
					cobradoEnSnapshot: "20",
					cobradoFueraSnapshot: "90",
				},
			],
			{ inicio: "2026-06-06", fin: "2026-07-06", alcance: "live" },
		);

		expect(report.porAsesor).toEqual([
			expect.objectContaining({
				asesorId: 7,
				esperado: "180.00",
				cobradoEnSnapshot: "160.00",
				cobradoFueraSnapshot: "90.00",
				excedenteEnSnapshot: "40.00",
				pendiente: "60.00",
			}),
		]);
	});

	it("permite el mes actual provisional antes del día 6 y rechaza ciclos futuros", () => {
		for (const dia of ["01", "02", "03", "04", "05"]) {
			expect(
				getMoraRecoveryPeriod({ mes: 6, anio: 2026, hoy: `2026-06-${dia}` }),
			).toMatchObject({ fechaSnapshot: `2026-06-${dia}`, alcance: "live" });
		}
		expect(() =>
			getMoraRecoveryPeriod({ mes: 7, anio: 2026, hoy: "2026-06-03" }),
		).toThrow("ciclo futuro");
		expect(() =>
			getMoraRecoveryPeriod({ mes: 1, anio: 2027, hoy: "2026-12-20" }),
		).toThrow("ciclo futuro");
	});

	it("usa el snapshot histórico de apertura desde el día 6", () => {
		const period = getMoraRecoveryPeriod({
			mes: 6,
			anio: 2026,
			hoy: "2026-06-06",
		});
		const query = new PgDialect().sqlToQuery(buildMoraRecoveryQuery(period));

		expect(period).toMatchObject({
			fechaSnapshot: "2026-06-06",
			alcance: "historico",
		});
		expect(query.sql).toContain("moras_historial");
		expect(query.sql).not.toContain("mora_activa");
	});

	it("suma al esperado la mora generada dentro del ciclo", () => {
		const report = buildMoraRecoveryReport(
			[
				{
					asesorId: 1,
					nombre: "Ana",
					esperado: "100",
					generadoEnPeriodo: "150",
					cobradoEnSnapshot: "250",
					cobradoFueraSnapshot: "0",
				},
			],
			{ inicio: "2026-06-06", fin: "2026-07-06", alcance: "historico" },
		);

		expect(report.totales).toEqual({
			esperado: "250.00",
			cobradoEnSnapshot: "250.00",
			cobradoFueraSnapshot: "0.00",
			excedenteEnSnapshot: "0.00",
			pendiente: "0.00",
		});
	});

	it("sin la mora generada el mismo cobro fingía un excedente del asesor", () => {
		const sinGenerado = buildMoraRecoveryReport(
			[
				{
					asesorId: 1,
					nombre: "Ana",
					esperado: "100",
					generadoEnPeriodo: "0",
					cobradoEnSnapshot: "250",
					cobradoFueraSnapshot: "0",
				},
			],
			{ inicio: "2026-06-06", fin: "2026-07-06", alcance: "historico" },
		);

		expect(sinGenerado.totales.excedenteEnSnapshot).toBe("150.00");
	});

	it("acumula lo generado por asesor sin compensar entre créditos", () => {
		const report = buildMoraRecoveryReport(
			[
				{
					asesorId: 7,
					nombre: "Cora",
					esperado: "100",
					generadoEnPeriodo: "40",
					cobradoEnSnapshot: "140",
					cobradoFueraSnapshot: "0",
				},
				{
					asesorId: 7,
					nombre: "Cora",
					esperado: "0",
					generadoEnPeriodo: "60",
					cobradoEnSnapshot: "10",
					cobradoFueraSnapshot: "0",
				},
			],
			{ inicio: "2026-06-06", fin: "2026-07-06", alcance: "live" },
		);

		expect(report.porAsesor).toEqual([
			expect.objectContaining({
				asesorId: 7,
				esperado: "200.00",
				excedenteEnSnapshot: "0.00",
				pendiente: "50.00",
			}),
		]);
	});

	it("solo suma incrementos: condonaciones y decrementos no bajan el esperado", () => {
		const query = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery(
				getMoraRecoveryPeriod({ mes: 6, anio: 2026, hoy: "2026-07-29" }),
			),
		);

		expect(query.sql).toContain(
			"h.tipo_evento IN ('CREACION', 'RECALCULO', 'INCREMENTO')",
		);
		expect(query.sql).toContain(
			"SUM(GREATEST(0, h.monto_nuevo::numeric - h.monto_anterior::numeric))",
		);
		// El total generado llega al reporte como columna propia: sin esto el
		// esperado seguiría siendo solo la foto inicial.
		expect(query.sql).toContain(
			"COALESCE(g.generado, 0)::text AS generado_en_periodo",
		);
		expect(query.sql).not.toContain("'CONDONACION'");
		expect(query.sql).not.toContain("'DECREMENTO'");
	});

	it("filtra lo generado por los límites UTC contra la columna cruda y semiabierto", () => {
		const query = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery(
				getMoraRecoveryPeriod({ mes: 6, anio: 2026, hoy: "2026-07-29" }),
			),
		);

		// Columna CRUDA: envolverla en AT TIME ZONE mataría moras_historial_fecha_idx.
		expect(query.sql).toContain("AND h.fecha >= $4::timestamp");
		expect(query.sql).toContain("AND h.fecha < $5::timestamp");
		expect(query.sql).not.toContain(
			"(h.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala')::date >=",
		);
		expect(query.params.slice(3)).toEqual([
			"2026-06-06 06:00:00.000",
			"2026-07-06 06:00:00.000",
		]);
	});

	it("un crédito que solo generó mora adentro entra al alcance del esperado", () => {
		const query = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery(
				getMoraRecoveryPeriod({ mes: 6, anio: 2026, hoy: "2026-07-29" }),
			),
		);

		// FULL JOIN: si solo tiene generado no hay fila en snapshot ni en pagos.
		expect(query.sql).toContain("FULL JOIN generado_por_credito g");
		expect(query.sql).toContain(
			"ca.credito_id = COALESCE(s.credito_id, p.credito_id, g.credito_id)",
		);
		// Y su cobro cuenta DENTRO del alcance, no fuera.
		expect(query.sql).toContain(
			"CASE WHEN s.credito_id IS NOT NULL OR g.credito_id IS NOT NULL THEN COALESCE(p.cobrado, 0) ELSE 0 END::text AS cobrado_en_snapshot",
		);
		expect(query.sql).toContain(
			"CASE WHEN s.credito_id IS NULL AND g.credito_id IS NULL THEN COALESCE(p.cobrado, 0) ELSE 0 END::text AS cobrado_fuera_snapshot",
		);
	});

	it("rechaza un ciclo con límites que no son un día real", () => {
		expect(() =>
			buildMoraRecoveryQuery({
				inicio: "2026-02-31",
				fin: "2026-07-06",
				fechaSnapshot: "2026-06-06",
				alcance: "historico",
			}),
		).toThrow("Período de recuperación de mora inválido");
		expect(() =>
			buildMoraRecoveryQuery({
				inicio: "2026-06-06",
				fin: "no-es-fecha",
				fechaSnapshot: "2026-06-06",
				alcance: "historico",
			}),
		).toThrow("Período de recuperación de mora inválido");
	});
});
