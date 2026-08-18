import { describe, expect, mock, test } from "bun:test";

// Mismo crédito SIFCO-1 en B1, pero SIN SLA hoy (fecha_limite_sla ayer) —
// así el único motivo posible de que aparezca en el resultado es la promesa,
// aislando lo que este test quiere probar.
const HOY_STR = "2026-02-10";
const casoId = "caso-1";

mock.module("../db", () => ({
	db: {
		select: (fields: Record<string, unknown>) => ({
			from: () => ({
				where: () => {
					// Distingue la query por las columnas pedidas: casosCobros trae
					// `activo`, promesas trae `estadoPromesa`, contactos trae
					// `ultimaFecha` (max agregado, encadena .groupBy()).
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
						// Promesa marcada 'cumplida' con updatedAt DESPUÉS de `hoy` — el
						// pago llegó horas después de medianoche, antes de que este
						// catch-up corriera.
						return Promise.resolve([
							{
								casoCobroId: casoId,
								estadoPromesa: "cumplida",
								fechaProximoContacto: new Date(`${HOY_STR}T06:00:00.000Z`),
								fechaAlerta: null,
								updatedAt: new Date(`${HOY_STR}T14:00:00.000Z`),
							},
						]);
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

describe("obtenerColaOperacionAsesor — boundary de captura (Codex PR #1330)", () => {
	test("promesa cumplida DESPUÉS del boundary se reconstruye como pendiente, el crédito no desaparece", async () => {
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
				motivoAgenda: "promesa_hoy",
			},
		]);
	});
});
