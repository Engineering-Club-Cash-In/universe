import { beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * El MAPEO de la fila cruda del reporte de recuperación. `moraRecuperacion.ts`
 * ya tiene sus pruebas puras sobre el plegado, pero el endpoint de
 * `reportes.ts` arma la fila A MANO: traslada campo por campo lo que la
 * consulta devolvió. Si uno se pierde en ese traslado el reporte NO falla,
 * devuelve un número más alto, en silencio. Por eso el mapeo se fija acá,
 * contra el endpoint de verdad y sin base de datos.
 */

/** Cola de respuestas: la primera es el universo, después va una por lote. */
let respuestas: unknown[][] = [];

mock.module("../database", () => ({
	client: {},
	lockPool: {},
	db: {
		execute: () => Promise.resolve({ rows: respuestas.shift() ?? [] }),
	},
}));

const { getMoraRecuperacionPorAsesor } = await import("./reportes");

describe("getMoraRecuperacionPorAsesor — el mapeo de la fila cruda", () => {
	beforeEach(() => {
		respuestas = [];
	});

	it("MUTACIÓN: perder la marca `anulado` en el mapeo cuenta el rebote del cron como mora nueva", async () => {
		// Foto 100, el cliente paga (DECREMENTO a 0) y DESPUÉS se cae el pago.
		// La reconciliación por delta real decide, con razón, no restituir nada
		// porque el cron de la mañana siguiente ya repuso los 100 con un
		// RECALCULO común y corriente. Lo único que dice que esa bajada dejó de
		// valer es la marca sobre el PROPIO decremento: no hay INCREMENTO de
		// restitución que marcar como `reverso`.
		//
		// Con `anulado` mapeado el plegado saltea el decremento, el nivel se
		// queda en 100 y el RECALCULO no lo supera: esperado = la foto.
		// Sin mapearlo el nivel baja a 0 y el rebote del cron se cobra entero.
		respuestas = [
			[{ credito_id: 1 }],
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
});
