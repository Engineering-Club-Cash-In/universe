import { describe, expect, mock, test } from "bun:test";

// Caso simétrico al de agenda-cobros-source.boundary-promesa-editada.test.ts:
// una promesa creada AYER prometía pago para HOY — a las 00:00 GT, esa
// promesa SÍ calificaba como promesa_hoy. Un asesor la editó esta mañana
// (después del boundary) moviéndola a "mañana". Sin reconstrucción, el
// crédito desaparecería del snapshot de "inicio de día" porque el valor
// actual ya no es hoy — pero a las 00:00 GT sí lo era (Codex PR #1331).
const HOY_STR = "2026-02-10";
const casoId = "caso-1";
const promesaId = "promesa-1";

mock.module("../db", () => ({
	db: {
		select: (fields: Record<string, unknown>) => ({
			from: () => ({
				where: () => {
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
						// Valor ACTUAL: ya editado a "mañana" — si el pipeline lo usara
						// directo, el crédito desaparecería del universo.
						return Promise.resolve([
							{
								id: promesaId,
								casoCobroId: casoId,
								estadoPromesa: "pendiente",
								fechaProximoContacto: new Date("2026-02-11T12:00:00.000Z"),
								fechaAlerta: null,
							},
						]);
					}
					if ("editadoEn" in fields) {
						// valoresAnteriores: la fecha era HOY antes de la edición.
						return Promise.resolve([
							{
								contactoId: promesaId,
								editadoEn: new Date(`${HOY_STR}T08:00:00.000Z`),
								valoresAnteriores: {
									fechaProximoContacto: `${HOY_STR}T12:00:00.000Z`,
								},
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

describe("obtenerColaOperacionAsesor — promesa movida fuera del día tras edición post-boundary (Codex PR #1331)", () => {
	test("reconstruye promesa_hoy con la fecha ANTERIOR a la edición, el crédito no desaparece", async () => {
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
