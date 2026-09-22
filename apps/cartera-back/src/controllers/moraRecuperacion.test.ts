import { describe, expect, it } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
	type MoraLevelEvent,
	type MoraRecoverySourceRow,
	buildMoraRecoveryQuery,
	buildMoraRecoveryReport,
	getMoraRecoveryPeriod,
	moraGeneradaEnPeriodo,
} from "./moraRecuperacion";

const evento = (
	tipoEvento: string,
	montoAnterior: number,
	montoNuevo: number,
): MoraLevelEvent => ({ tipoEvento, montoAnterior, montoNuevo });

/** El mismo evento, pero ocurrido ANTES del corte: solo siembra el nivel. */
const previo = (
	tipoEvento: string,
	montoAnterior: number,
	montoNuevo: number,
): MoraLevelEvent => ({
	tipoEvento,
	montoAnterior,
	montoNuevo,
	previo: true,
});

const rows: MoraRecoverySourceRow[] = [
	{
		asesorId: 1,
		nombre: "Ana",
		esperado: "100.00",
		eventos: [],
		cobrado: "120.00",
	},
	{
		asesorId: null,
		nombre: "Sin asignar",
		esperado: "50.00",
		eventos: [],
		cobrado: "20.00",
	},
	{
		asesorId: 2,
		nombre: "Beto",
		esperado: "0.00",
		eventos: [],
		cobrado: "40.00",
	},
];

describe("moraGeneradaEnPeriodo", () => {
	it("no cuenta dos veces la deuda que la empresa condonó y el cron repuso", () => {
		// El ejemplo del negocio, tal cual: solo el crecimiento real de 100 a 120
		// es oportunidad de cobro nueva.
		expect(
			moraGeneradaEnPeriodo(100, [
				evento("CONDONACION", 100, 0),
				evento("RECALCULO", 0, 100),
				evento("RECALCULO", 100, 120),
				evento("CONDONACION", 120, 0),
				evento("RECALCULO", 0, 120),
			]),
		).toBe(20);
	});

	it("después de un pago la mora nueva SÍ es oportunidad nueva", () => {
		expect(
			moraGeneradaEnPeriodo(100, [
				evento("DECREMENTO", 100, 0),
				evento("CREACION", 0, 60),
			]),
		).toBe(60);
	});

	it("condonación seguida de crecimiento real: solo cuenta el crecimiento", () => {
		expect(
			moraGeneradaEnPeriodo(200, [
				evento("CONDONACION", 200, 0),
				evento("RECALCULO", 0, 200),
				evento("RECALCULO", 200, 245),
			]),
		).toBe(45);
	});

	it("el rebote parcial tampoco reabre lo ya condonado", () => {
		// El cron puede reponer en varios pasos: ninguno supera el nivel, así que
		// ninguno cuenta. Si el primer paso bajara el nivel a 60, el segundo
		// facturaría otra vez la mora condonada.
		expect(
			moraGeneradaEnPeriodo(120, [
				evento("CONDONACION", 120, 0),
				evento("RECALCULO", 0, 60),
				evento("RECALCULO", 60, 120),
			]),
		).toBe(0);
	});

	it("pago parcial: el nivel baja a lo que quedó y el crecimiento posterior cuenta", () => {
		expect(
			moraGeneradaEnPeriodo(100, [
				evento("DECREMENTO", 100, 40),
				evento("RECALCULO", 40, 70),
			]),
		).toBe(30);
	});

	it("tras una DESACTIVACION la mora nueva cuenta entera", () => {
		expect(
			moraGeneradaEnPeriodo(80, [
				evento("DESACTIVACION", 80, 0),
				evento("CREACION", 0, 95),
			]),
		).toBe(95);
	});

	it("la DESACTIVACION reinicia el nivel aunque venga de una condonación", () => {
		// `desactivarMora` registra monto_anterior = monto_mora de la fila, que una
		// condonación previa ya dejó en 0: el evento es un "0 → 0" que no baja nada
		// por sí solo. Sin reiniciar el nivel en DESACTIVACION, el crédito que se
		// puso al día y volvió a atrasarse arrastraría el techo viejo y su mora
		// nueva no se contaría.
		expect(
			moraGeneradaEnPeriodo(100, [
				evento("CONDONACION", 100, 0),
				evento("DESACTIVACION", 0, 0),
				evento("CREACION", 0, 90),
			]),
		).toBe(90);
	});

	it("un crédito sin foto inicial que genera mora adentro la cuenta toda", () => {
		expect(
			moraGeneradaEnPeriodo(0, [
				evento("CREACION", 0, 40),
				evento("RECALCULO", 40, 55),
			]),
		).toBe(55);
	});

	it("sin eventos no hay nada generado", () => {
		expect(moraGeneradaEnPeriodo(100, [])).toBe(0);
	});

	it("la condonación masiva se comporta igual que la individual", () => {
		// Ambas se registran como tipo_evento CONDONACION; solo cambia el `origen`,
		// que el nivel no mira.
		expect(
			moraGeneradaEnPeriodo(305041, [
				evento("CONDONACION", 305041, 0),
				evento("RECALCULO", 0, 305041),
			]),
		).toBe(0);
	});

	it("MUTACIÓN: si la CONDONACION bajara el nivel, el rebote se contaría de nuevo", () => {
		// Con la regla correcta el rebote no suma; con la mutación sumaría 100.
		const generado = moraGeneradaEnPeriodo(100, [
			evento("CONDONACION", 100, 0),
			evento("RECALCULO", 0, 100),
		]);
		expect(generado).toBe(0);
		expect(generado).not.toBe(100);
	});

	it("la condonación que quedó justo AFUERA del corte no revive con el rebote", () => {
		// El borde que el reporte medía mal: el 5 la empresa condona (queda fuera
		// del ciclo) y la foto del día 6 dice cero; el 6 el cron repone los 100.
		// Sin siembra el nivel arrancaba en 0 y el rebote se contaba entero.
		expect(
			moraGeneradaEnPeriodo(0, [
				previo("CONDONACION", 100, 0),
				evento("RECALCULO", 0, 100),
			]),
		).toBe(0);
	});

	it("el PAGO justo antes del corte sí deja contar la mora nueva de adentro", () => {
		// El borde simétrico: acá el cliente saldó, así que lo que nazca adentro es
		// deuda nueva y el asesor sí tuvo que cobrarla.
		expect(
			moraGeneradaEnPeriodo(0, [
				previo("DECREMENTO", 100, 0),
				evento("RECALCULO", 0, 100),
			]),
		).toBe(100);
	});

	it("condonación afuera y crecimiento real adentro: solo cuenta el crecimiento", () => {
		expect(
			moraGeneradaEnPeriodo(0, [
				previo("CONDONACION", 100, 0),
				evento("RECALCULO", 0, 100),
				evento("RECALCULO", 100, 130),
			]),
		).toBe(30);
	});

	it("sin eventos previos el nivel arranca en la foto, como antes", () => {
		expect(
			moraGeneradaEnPeriodo(100, [evento("RECALCULO", 100, 140)]),
		).toBe(40);
	});

	it("la siembra nunca deja el nivel POR DEBAJO de la foto", () => {
		// Si el tramo previo dejara el nivel en 40 y la foto dice 100, el primer
		// RECALCULO del ciclo sumaría 60 de una mora que la foto ya contó.
		expect(
			moraGeneradaEnPeriodo(100, [
				previo("DECREMENTO", 90, 40),
				evento("RECALCULO", 100, 100),
			]),
		).toBe(0);
	});

	it("MUTACIÓN: sin siembra, el rebote del borde se contaría entero", () => {
		const conSiembra = moraGeneradaEnPeriodo(0, [
			previo("CONDONACION", 100, 0),
			evento("RECALCULO", 0, 100),
		]);
		// La mutación "ignorar los previos" es exactamente esta llamada.
		const sinSiembra = moraGeneradaEnPeriodo(0, [evento("RECALCULO", 0, 100)]);
		expect(conSiembra).toBe(0);
		expect(sinSiembra).toBe(100);
		expect(conSiembra).not.toBe(sinSiembra);
	});

	it("MUTACIÓN: si la siembra también sostuviera el nivel tras un pago, la mora nueva se perdería", () => {
		// Sembrar "a lo bruto" —quedarse con el monto más alto de la ventana sin
		// mirar POR QUÉ bajó— daría 0 acá, y el asesor perdería 100 de esperado.
		const generado = moraGeneradaEnPeriodo(0, [
			previo("DECREMENTO", 100, 0),
			evento("RECALCULO", 0, 100),
		]);
		expect(generado).toBe(100);
		expect(generado).not.toBe(0);
	});

	it("MUTACIÓN: si el DECREMENTO no bajara el nivel, la mora nueva no se contaría", () => {
		// Con la regla correcta se cuentan los 60; con la mutación darían 0.
		const generado = moraGeneradaEnPeriodo(100, [
			evento("DECREMENTO", 100, 0),
			evento("RECALCULO", 0, 60),
		]);
		expect(generado).toBe(60);
		expect(generado).not.toBe(0);
	});
});

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
			// El inicio aparece dos veces —marca de `previo` y HAVING— y entre medio
			// va el arranque de la ventana de siembra, 3 días antes del corte.
			"2026-06-06 06:00:00.000",
			"2026-06-03 06:00:00.000",
			"2026-07-06 06:00:00.000",
			"2026-06-06 06:00:00.000",
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
					eventos: [],
					cobrado: "40",
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
			cobradoFueraSnapshot: "40.00",
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
					eventos: [],
					cobrado: "140",
				},
				{
					asesorId: 7,
					nombre: "Cora",
					esperado: "80",
					eventos: [],
					cobrado: "20",
				},
			],
			{ inicio: "2026-06-06", fin: "2026-07-06", alcance: "live" },
		);

		expect(report.porAsesor).toEqual([
			expect.objectContaining({
				asesorId: 7,
				esperado: "180.00",
				cobradoEnSnapshot: "160.00",
				cobradoFueraSnapshot: "0.00",
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
					eventos: [evento("RECALCULO", 100, 250)],
					cobrado: "250",
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
					eventos: [],
					cobrado: "250",
				},
			],
			{ inicio: "2026-06-06", fin: "2026-07-06", alcance: "historico" },
		);

		expect(sinGenerado.totales.excedenteEnSnapshot).toBe("150.00");
	});

	it("el rebote de la condonación no infla el esperado del asesor", () => {
		// Mismo crédito, mismo cobro: antes cada rebote sumaba su mora entera al
		// esperado y el asesor aparecía con un pendiente que nunca pudo cobrar.
		const report = buildMoraRecoveryReport(
			[
				{
					asesorId: 3,
					nombre: "Dina",
					esperado: "100",
					eventos: [
						evento("CONDONACION", 100, 0),
						evento("RECALCULO", 0, 100),
						evento("RECALCULO", 100, 120),
					],
					cobrado: "120",
				},
			],
			{ inicio: "2026-06-06", fin: "2026-07-06", alcance: "historico" },
		);

		expect(report.totales).toMatchObject({
			esperado: "120.00",
			pendiente: "0.00",
			excedenteEnSnapshot: "0.00",
		});
	});

	it("acumula lo generado por asesor sin compensar entre créditos", () => {
		const report = buildMoraRecoveryReport(
			[
				{
					asesorId: 7,
					nombre: "Cora",
					esperado: "100",
					eventos: [evento("RECALCULO", 100, 140)],
					cobrado: "140",
				},
				{
					asesorId: 7,
					nombre: "Cora",
					esperado: "0",
					eventos: [evento("CREACION", 0, 60)],
					cobrado: "10",
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

	it("los créditos no se contaminan entre sí: cada uno lleva su propio nivel", () => {
		const report = buildMoraRecoveryReport(
			[
				{
					asesorId: 9,
					nombre: "Eli",
					esperado: "100",
					eventos: [
						evento("CONDONACION", 100, 0),
						evento("RECALCULO", 0, 100),
					],
					cobrado: "0",
				},
				{
					asesorId: 9,
					nombre: "Eli",
					esperado: "0",
					eventos: [evento("CREACION", 0, 70)],
					cobrado: "0",
				},
			],
			{ inicio: "2026-06-06", fin: "2026-07-06", alcance: "historico" },
		);

		// 100 (foto del primero, sin rebote) + 70 (mora nueva del segundo).
		expect(report.totales.esperado).toBe("170.00");
	});

	it("trae los eventos del ciclo en orden y sin filtrar por tipo", () => {
		const query = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery(
				getMoraRecoveryPeriod({ mes: 6, anio: 2026, hoy: "2026-07-29" }),
			),
		);

		// El nivel depende de lo que sube Y de lo que baja: filtrar por tipo en SQL
		// escondería las condonaciones y los pagos, que son justo lo que decide si
		// una mora repuesta vuelve a ser oportunidad.
		expect(query.sql).not.toContain(
			"h.tipo_evento IN ('CREACION', 'RECALCULO', 'INCREMENTO')",
		);
		expect(query.sql).toContain("ORDER BY h.fecha, h.historial_id");
		expect(query.sql).toContain("'tipoEvento', h.tipo_evento");
		expect(query.sql).toContain(
			"'montoAnterior', h.monto_anterior::numeric::text",
		);
		expect(query.sql).toContain("'montoNuevo', h.monto_nuevo::numeric::text");
		expect(query.sql).toContain("COALESCE(e.eventos, '[]'::json) AS eventos");
	});

	it("filtra los eventos por los límites UTC contra la columna cruda y semiabierto", () => {
		const query = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery(
				getMoraRecoveryPeriod({ mes: 6, anio: 2026, hoy: "2026-07-29" }),
			),
		);

		// Columna CRUDA: envolverla en AT TIME ZONE mataría moras_historial_fecha_idx.
		// El rango arranca en la ventana de siembra y el fin sigue siendo exclusivo.
		expect(query.sql).toContain("WHERE h.fecha >= $5::timestamp");
		expect(query.sql).toContain("AND h.fecha < $6::timestamp");
		expect(query.sql).not.toContain(
			"(h.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala')::date >=",
		);
		expect(query.params.slice(3)).toEqual([
			// marca de `previo`: todo lo anterior al inicio solo siembra el nivel
			"2026-06-06 06:00:00.000",
			// arranque de la ventana de siembra: 3 días antes del corte
			"2026-06-03 06:00:00.000",
			"2026-07-06 06:00:00.000",
			// HAVING: el crédito tiene que haber tenido al menos un evento ADENTRO
			"2026-06-06 06:00:00.000",
		]);
	});

	it("trae la ventana de siembra marcada y exige un evento DENTRO del ciclo", () => {
		const query = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery(
				getMoraRecoveryPeriod({ mes: 6, anio: 2026, hoy: "2026-07-29" }),
			),
		);

		// La marca viaja por evento: el plegado necesita el ORDEN entre lo previo y
		// lo del ciclo, así que no se pueden traer en dos listas separadas.
		expect(query.sql).toContain("'previo', h.fecha < $4::timestamp");
		// Y la siembra no amplía el universo de créditos del reporte.
		expect(query.sql).toContain("HAVING BOOL_OR(h.fecha >= $7::timestamp)");
	});

	it("la siembra no cambia el agregado al plegar por lotes de créditos", () => {
		// El plegado del nivel es POR CRÉDITO, así que partir la lista de créditos
		// en lotes no puede mover el total. Con la siembra sigue siendo cierto:
		// los eventos previos vienen en la MISMA fila del crédito.
		const filas: MoraRecoverySourceRow[] = [
			{
				asesorId: 1,
				nombre: "Ana",
				esperado: "0",
				eventos: [previo("CONDONACION", 100, 0), evento("RECALCULO", 0, 100)],
				cobrado: "0",
			},
			{
				asesorId: 1,
				nombre: "Ana",
				esperado: "0",
				eventos: [previo("DECREMENTO", 80, 0), evento("RECALCULO", 0, 80)],
				cobrado: "30",
			},
			{
				asesorId: 2,
				nombre: "Beto",
				esperado: "50",
				eventos: [evento("RECALCULO", 50, 75)],
				cobrado: "10",
			},
		];
		const periodo = {
			inicio: "2026-06-06",
			fin: "2026-07-06",
			alcance: "historico" as const,
		};
		const unaPasada = buildMoraRecoveryReport(filas, periodo);
		const porLotes = [filas.slice(0, 1), filas.slice(1, 2), filas.slice(2)].map(
			(lote) => buildMoraRecoveryReport(lote, periodo),
		);
		const sumaLotes = porLotes
			.reduce((total, r) => total + Number(r.totales.esperado), 0)
			.toFixed(2);

		// 0 (condonado afuera, rebote adentro) + 80 (pagó y volvió a generar) + 75.
		expect(unaPasada.totales.esperado).toBe("155.00");
		expect(sumaLotes).toBe(unaPasada.totales.esperado);
	});

	it("un crédito que solo generó mora adentro entra al alcance del esperado", () => {
		const query = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery(
				getMoraRecoveryPeriod({ mes: 6, anio: 2026, hoy: "2026-07-29" }),
			),
		);

		// FULL JOIN: si solo tiene eventos no hay fila en snapshot ni en pagos.
		expect(query.sql).toContain("FULL JOIN eventos_por_credito e");
		expect(query.sql).toContain(
			"ca.credito_id = COALESCE(s.credito_id, p.credito_id, e.credito_id)",
		);

		// Y su cobro cuenta DENTRO del alcance, no fuera.
		const report = buildMoraRecoveryReport(
			[
				{
					asesorId: 4,
					nombre: "Fabi",
					esperado: "0",
					eventos: [evento("CREACION", 0, 80)],
					cobrado: "80",
				},
			],
			{ inicio: "2026-06-06", fin: "2026-07-06", alcance: "historico" },
		);
		expect(report.totales).toMatchObject({
			esperado: "80.00",
			cobradoEnSnapshot: "80.00",
			cobradoFueraSnapshot: "0.00",
		});
	});

	it("el cobro de un crédito sin esperado alguno queda FUERA del alcance", () => {
		const report = buildMoraRecoveryReport(
			[
				{
					asesorId: 5,
					nombre: "Gabo",
					esperado: "0",
					eventos: [],
					cobrado: "45",
				},
			],
			{ inicio: "2026-06-06", fin: "2026-07-06", alcance: "historico" },
		);

		expect(report.totales).toMatchObject({
			esperado: "0.00",
			cobradoEnSnapshot: "0.00",
			cobradoFueraSnapshot: "45.00",
		});
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
