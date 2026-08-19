import { describe, expect, mock, test } from "bun:test";

// Verifica que la query de ultimosContactos DENTRO de
// obtenerColaOperacionAsesor recibe un filtro de fecha (lt(fechaContacto,
// hoy)) — captura el objeto `where` construido por drizzle-orm y confirma
// que contiene el boundary inyectado, en vez de solo filtrar por
// casoCobroId. Sin este filtro, un contacto registrado esta mañana (después
// del boundary 00:00 GT, antes de un catch-up tardío) contaría como
// "contactado hoy" y suprimiría slaHoy — perdiendo el crédito del snapshot
// de inicio de día (Codex PR #1330).
const HOY_STR = "2026-02-10";
const casoId = "caso-1";

let ultimoWhereContactos: unknown;

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
						return Promise.resolve([]);
					}
					// ultimosContactos
					ultimoWhereContactos = condicion;
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
					fecha_entrada_bucket: "2026-02-06",
					fecha_limite_sla: HOY_STR,
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

describe("obtenerColaOperacionAsesor — boundary de captura, contacto post-medianoche (Codex PR #1330)", () => {
	test("la query de ultimosContactos acota por el boundary `hoy`, no solo por casoCobroId", async () => {
		const hoy = new Date(`${HOY_STR}T06:00:00.000Z`);
		await obtenerColaOperacionAsesor(
			{ userId: "crm-octavio", asesorCarteraId: 8, nombre: "Octavio" },
			hoy,
		);

		// El SQL generado por `and(inArray(...), lt(fechaContacto, hoy))`
		// incluye el valor `hoy` como parámetro — confirma que la condición de
		// boundary viaja en el WHERE, no solo el filtro por caso. `and()`
		// anida sub-SQLs dentro de queryChunks, así que se recorre a mano (el
		// objeto SQL completo tiene referencias cíclicas y no serializa con
		// JSON.stringify).
		function extraerValores(nodo: unknown): unknown[] {
			if (!nodo || typeof nodo !== "object") return [];
			const obj = nodo as Record<string, unknown>;
			if ("value" in obj) return [obj.value];
			if (Array.isArray(obj.queryChunks)) {
				return obj.queryChunks.flatMap(extraerValores);
			}
			return [];
		}
		expect(extraerValores(ultimoWhereContactos)).toContain(hoy);
	});

	test("sin contacto previo al boundary, el crédito sigue clasificando slaHoy (no desaparece)", async () => {
		const hoy = new Date(`${HOY_STR}T06:00:00.000Z`);
		const resultado = await obtenerColaOperacionAsesor(
			{ userId: "crm-octavio", asesorCarteraId: 8, nombre: "Octavio" },
			hoy,
		);
		expect(resultado).toEqual([
			{
				asesorId: "crm-octavio",
				asesorNombre: "Octavio",
				numeroCreditoSifco: "SIFCO-1",
				casoCobroId: casoId,
				bucketSnapshot: 1,
				motivoAgenda: "sla_hoy",
			},
		]);
	});
});
