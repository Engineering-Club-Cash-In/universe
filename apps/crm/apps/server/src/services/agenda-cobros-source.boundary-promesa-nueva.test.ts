import { describe, expect, mock, test } from "bun:test";

// Crédito SIN SLA hoy, con una promesa "pendiente" registrada ESTA MAÑANA
// (createdAt después del boundary 00:00 GT) prometiendo pago para hoy — la
// promesa no existía a medianoche, así que no debe entrar al universo de
// agenda aunque su fechaProximoContacto sea hoy. Sin el filtro por
// createdAt, esto inflaba total_planificado con algo que nunca estuvo
// planificado al momento del corte (Codex PR #1331).
const HOY_STR = "2026-02-10";
const casoId = "caso-1";

let ultimoWherePromesas: unknown;

mock.module("../db", () => ({
	db: {
		select: (fields: Record<string, unknown>) => ({
			from: () => ({
				where: (condicion: unknown) => {
					if ("activo" in fields) {
						return Promise.resolve([
							{
								id: casoId,
								numeroCreditoSifco: "SIFCO-1",
								activo: true,
								updatedAt: new Date("2026-02-01T00:00:00.000Z"),
							},
						]);
					}
					if ("estadoPromesa" in fields) {
						ultimoWherePromesas = condicion;
						// La query real filtra createdAt < hoy en el WHERE — este mock
						// simplemente no retorna nada, simulando que Postgres ya la
						// excluyó. Se verifica por separado que el WHERE capturado
						// realmente contiene ese filtro (no solo confiar en el mock).
						return Promise.resolve([]);
					}
					return Object.assign(Promise.resolve([]), {
						groupBy: () => Promise.resolve([]),
					});
				},
			}),
		}),
	},
}));

mock.module("./cartera-back-client", () => ({
	carteraBackClient: {
		getColaDiaSLA: mock(async () => ({
			data: [
				{
					credito_id: 1,
					numero_credito_sifco: "SIFCO-1",
					cliente: "Cliente Test",
					asesor_id: 8,
					asesor: "Octavio",
					bucket: 1,
					bucket_prefijo: "B1",
					bucket_nombre: "Alerta Temprana",
					dias_sla: 4,
					fecha_entrada_bucket: "2026-02-01",
					fecha_limite_sla: "2026-02-09",
				},
			],
			page: 1,
			perPage: 100,
			total: 1,
			totalPages: 1,
		})),
	},
}));

const { obtenerColaOperacionAsesor } = await import("./agenda-cobros-source");

describe("obtenerColaOperacionAsesor — promesa creada después del boundary (Codex PR #1331)", () => {
	test("la query de promesas acota por createdAt < hoy, no solo por estadoPromesa", async () => {
		const hoy = new Date(`${HOY_STR}T06:00:00.000Z`);
		await obtenerColaOperacionAsesor(
			{ userId: "crm-octavio", asesorCarteraId: 8, nombre: "Octavio" },
			hoy,
		);

		// `and()` anida sub-SQLs dentro de queryChunks; se recorre a mano
		// porque el objeto SQL completo tiene referencias cíclicas.
		function extraerValores(nodo: unknown): unknown[] {
			if (!nodo || typeof nodo !== "object") return [];
			const obj = nodo as Record<string, unknown>;
			if ("value" in obj) return [obj.value];
			if (Array.isArray(obj.queryChunks)) {
				return obj.queryChunks.flatMap(extraerValores);
			}
			return [];
		}
		expect(extraerValores(ultimoWherePromesas)).toContain(hoy);
	});

	test("una promesa registrada esta mañana (después de `hoy`) no aparece en el universo", async () => {
		const hoy = new Date(`${HOY_STR}T06:00:00.000Z`);
		const resultado = await obtenerColaOperacionAsesor(
			{ userId: "crm-octavio", asesorCarteraId: 8, nombre: "Octavio" },
			hoy,
		);
		// Sin SLA hoy y sin promesa admitida (excluida por createdAt >= hoy),
		// el crédito no debe aparecer en absoluto.
		expect(resultado).toEqual([]);
	});
});
