import { beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * El reporte de recuperación se arma con VARIAS consultas: la que enumera el
 * universo de créditos y una por lote. En READ COMMITTED cada una abriría su
 * propio snapshot, así que el cron nocturno de mora (o un pago, o un cambio de
 * asesor) podía mover el piso entre lote y lote y el total terminaba
 * dependiendo de dónde cayeron los cortes. Estas pruebas fijan que TODAS las
 * consultas salgan por la MISMA transacción y que esa transacción sea
 * REPEATABLE READ.
 */

type Llamada = { sql: string; dentroDeTx: boolean };

let llamadas: Llamada[] = [];
let configTx: unknown = null;
let transaccionesAbiertas = 0;
/** Cola de respuestas: la primera es el universo, después va una por lote. */
let respuestas: unknown[][] = [];

const dialect = await import("drizzle-orm/pg-core").then(
	(m) => new m.PgDialect(),
);
const textoDe = (query: unknown) => {
	try {
		return dialect.sqlToQuery(query as never).sql;
	} catch {
		return String(query);
	}
};

const ejecutar = (query: unknown, dentroDeTx: boolean) => {
	llamadas.push({ sql: textoDe(query), dentroDeTx });
	return Promise.resolve({ rows: respuestas.shift() ?? [] });
};

mock.module("../database", () => ({
	client: {},
	lockPool: {},
	db: {
		// Cualquier consulta suelta del reporte cae acá y revienta: si la
		// enumeración o un lote vuelven a correr fuera de la transacción, este
		// test falla en vez de dejar pasar el reporte inconsistente.
		execute: (query: unknown) => {
			llamadas.push({ sql: textoDe(query), dentroDeTx: false });
			return Promise.reject(
				new Error("consulta del reporte FUERA de la transacción de snapshot"),
			);
		},
		transaction: async (
			cb: (tx: { execute: (q: unknown) => Promise<unknown> }) => Promise<unknown>,
			config: unknown,
		) => {
			transaccionesAbiertas += 1;
			configTx = config;
			return await cb({ execute: (q: unknown) => ejecutar(q, true) });
		},
	},
}));

const { getMoraRecuperacionPorAsesor } = await import("./reportes");

const universo = (n: number) =>
	Array.from({ length: n }, (_, i) => ({ credito_id: i + 1 }));

const filaReporte = {
	asesor_id: 7,
	nombre: "Ana",
	esperado: "100",
	eventos: [],
	cobrado: "40",
};

describe("getMoraRecuperacionPorAsesor — un solo snapshot", () => {
	beforeEach(() => {
		llamadas = [];
		configTx = null;
		transaccionesAbiertas = 0;
		respuestas = [];
	});

	it("la enumeración del universo y TODOS los lotes salen por la misma transacción", async () => {
		// 1.200 créditos = 3 lotes de 500: la enumeración más tres consultas.
		respuestas = [universo(1200), [filaReporte], [], []];

		await getMoraRecuperacionPorAsesor({ mes: 7, anio: 2026 });

		expect(transaccionesAbiertas).toBe(1);
		expect(llamadas.length).toBe(4);
		expect(llamadas.every((l) => l.dentroDeTx)).toBe(true);
		// La primera es la enumeración; las otras tres traen el filtro de lote.
		expect(llamadas[0].sql).toContain("SELECT c.credito_id");
		expect(llamadas[0].sql).not.toContain("moras_historial");
		for (const lote of llamadas.slice(1)) {
			expect(lote.sql).toContain("moras_historial");
			expect(lote.sql).toContain("c.credito_id IN (");
		}
	});

	it("la transacción se abre en REPEATABLE READ", async () => {
		respuestas = [universo(3), [filaReporte]];

		await getMoraRecuperacionPorAsesor({ mes: 7, anio: 2026 });

		expect(configTx).toMatchObject({ isolationLevel: "repeatable read" });
	});

	it("MUTACIÓN: en READ COMMITTED cada consulta vería su propio instante", async () => {
		respuestas = [universo(3), [filaReporte]];

		await getMoraRecuperacionPorAsesor({ mes: 7, anio: 2026 });

		// READ COMMITTED (el default de Postgres) es exactamente la mutación que
		// reintroduce el defecto: los lotes volverían a leer instantes distintos.
		expect((configTx as { isolationLevel?: string }).isolationLevel).not.toBe(
			"read committed",
		);
		// Y tampoco vale dejar el nivel sin fijar: sin config, Postgres usa el
		// default del servidor, que es READ COMMITTED.
		expect(configTx).not.toBeUndefined();
		expect(configTx).not.toBeNull();
	});

	it("MUTACIÓN: sacar la enumeración de la transacción rompe el reporte", async () => {
		// El mock de `db.execute` (fuera de la transacción) rechaza siempre: si
		// alguien devuelve la enumeración a `db.execute`, esto deja de pasar.
		respuestas = [universo(3), [filaReporte]];

		const reporte = await getMoraRecuperacionPorAsesor({ mes: 7, anio: 2026 });

		expect(llamadas.some((l) => !l.dentroDeTx)).toBe(false);
		expect(reporte.totales.esperado).toBe("100.00");
	});

	// ------------------------------------------------------------------
	// El MAPEO de la fila cruda. La consulta devuelve `nivel_sembrado` y
	// `reverso`, y el endpoint los tiene que trasladar a la fila que el plegado
	// consume. Si uno se pierde el reporte NO falla: devuelve un número más
	// alto, en silencio. Contra el dump local la siembra se nota (el ciclo
	// jul-2026 pasa de Q3.572.124,45 a Q3.691.327,40) pero el reverso no —no hay
	// reversas de pago en ese ciclo—, así que las dos se fijan acá, sin base.
	// ------------------------------------------------------------------

	it("MUTACIÓN: perder `nivel_sembrado` en el mapeo infla el esperado", async () => {
		// Techo sembrado en 100 y un RECALCULO que repone esos mismos 100 adentro
		// del ciclo: es el rebote de una condonación anterior al corte, NO mora
		// nueva. Sin la siembra el nivel arrancaría en la foto (0) y el rebote se
		// cobraría entero.
		respuestas = [
			universo(1),
			[
				{
					asesor_id: 7,
					nombre: "Ana",
					esperado: "0",
					eventos: [
						{
							tipoEvento: "RECALCULO",
							montoAnterior: "0",
							montoNuevo: "100",
							reverso: false,
						},
					],
					nivel_sembrado: "100",
					cobrado: "0",
				},
			],
		];

		const reporte = await getMoraRecuperacionPorAsesor({ mes: 7, anio: 2026 });

		// Con la siembra mapeada: 0.00. Sin ella: 100.00.
		expect(reporte.totales.esperado).toBe("0.00");
	});

	it("MUTACIÓN: perder la marca `reverso` en el mapeo cuenta la deuda dos veces", async () => {
		// Foto 100, el cliente paga (DECREMENTO a 0) y el pago se ANULA: la
		// restitución repone los 100 que el pago había bajado. Es el mismo dinero,
		// no una oportunidad de cobro nueva.
		respuestas = [
			universo(1),
			[
				{
					asesor_id: 7,
					nombre: "Ana",
					esperado: "100",
					eventos: [
						{
							tipoEvento: "DECREMENTO",
							montoAnterior: "100",
							montoNuevo: "0",
							reverso: false,
						},
						{
							tipoEvento: "INCREMENTO",
							montoAnterior: "0",
							montoNuevo: "100",
							reverso: true,
						},
					],
					nivel_sembrado: "0",
					cobrado: "0",
				},
			],
		];

		const reporte = await getMoraRecuperacionPorAsesor({ mes: 7, anio: 2026 });

		// Con la marca mapeada: 100.00 (la foto). Sin ella: 200.00.
		expect(reporte.totales.esperado).toBe("100.00");
	});

	it("MUTACIÓN: perder la marca `anulado` en el mapeo cuenta el rebote del cron como mora nueva", async () => {
		// Foto 100, el cliente paga (DECREMENTO a 0) y DESPUÉS se cae el pago.
		// La reconciliación por delta real decide, con razón, no restituir nada
		// porque el cron de la mañana siguiente ya repuso los 100 con un
		// RECALCULO común y corriente. Lo único que dice que esa bajada dejó de
		// valer es la marca sobre el PROPIO decremento: no hay INCREMENTO de
		// restitución que marcar como `reverso`.
		//
		// OJO CON LA FUERZA DE ESTE CANDADO: desde que el techo dejó de bajar con
		// un pago, el nivel se queda en 100 con la marca y sin ella, así que hoy
		// el número NO depende de este mapeo. La marca sigue siendo contrato —la
		// escribe `marcarDecrementoAnulado` y el plegado la lee—, pero quien
		// impide el esperado de 200 acá es el techo, no ella.
		respuestas = [
			universo(1),
			[
				{
					asesor_id: 7,
					nombre: "Ana",
					esperado: "100",
					eventos: [
						{
							tipoEvento: "DECREMENTO",
							montoAnterior: "100",
							montoNuevo: "0",
							reverso: false,
							anulado: true,
						},
						{
							tipoEvento: "RECALCULO",
							montoAnterior: "0",
							montoNuevo: "100",
							reverso: false,
							anulado: false,
						},
					],
					nivel_sembrado: "0",
					cobrado: "0",
				},
			],
		];

		const reporte = await getMoraRecuperacionPorAsesor({ mes: 7, anio: 2026 });

		// Con la marca mapeada: 100.00 (la foto). Sin ella: 200.00.
		expect(reporte.totales.esperado).toBe("100.00");
	});

	it("MUTACIÓN: perder `pagoId` en el mapeo deja que un pago ajeno tape la restitución", async () => {
		// Foto 100. Adentro el cliente paga esos Q100 (pago 7) y además se
		// revierte un pago ANTERIOR al ciclo (pago 9): son Q100 de mora que nunca
		// se contaron y que el asesor tiene vivos. Sin el id, las dos mitades
		// caen a la misma bolsa, el pago 7 tapa la reversa del 9 y el esperado
		// vuelve a 100.00 con Q100 cobrables afuera del reporte.
		respuestas = [
			universo(1),
			[
				{
					asesor_id: 7,
					nombre: "Ana",
					esperado: "100",
					eventos: [
						{
							tipoEvento: "DECREMENTO",
							montoAnterior: "100",
							montoNuevo: "0",
							reverso: false,
							anulado: false,
							pagoId: "7",
						},
						{
							tipoEvento: "INCREMENTO",
							montoAnterior: "0",
							montoNuevo: "100",
							reverso: true,
							anulado: false,
							pagoId: "9",
						},
					],
					nivel_sembrado: "0",
					cobrado: "0",
				},
			],
		];

		const reporte = await getMoraRecuperacionPorAsesor({ mes: 7, anio: 2026 });

		// Con el id mapeado: 200.00. Sin él: 100.00.
		expect(reporte.totales.esperado).toBe("200.00");
	});

	it("sin créditos elegibles no se pide ni un lote, pero la transacción igual es la única puerta", async () => {
		respuestas = [[]];

		const reporte = await getMoraRecuperacionPorAsesor({ mes: 7, anio: 2026 });

		expect(llamadas.length).toBe(1);
		expect(llamadas[0].dentroDeTx).toBe(true);
		expect(reporte.totales.esperado).toBe("0.00");
		expect(reporte.porAsesor).toEqual([]);
	});
});
