import { describe, expect, mock, test } from "bun:test";

// Crédito SIN SLA hoy. Una promesa creada AYER (createdAt < hoy, pasa el
// filtro existente) prometía pago para MAÑANA — pero un asesor la editó
// esta mañana (después del boundary 00:00 GT, antes del catch-up tardío)
// moviendo fechaProximoContacto a HOY. Leer el valor actual la clasificaría
// como promesa_hoy, cuando a las 00:00 GT esa promesa NO vencía hoy — el
// snapshot de "inicio de día" debe reconstruir el valor de ANTES de la
// edición, vía contactos_cobros_audit (Codex PR #1331).
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
						// Valor ACTUAL: ya editado a "hoy" — si el pipeline lo usara
						// directo, clasificaría como promesa_hoy incorrectamente.
						return Promise.resolve([
							{
								id: promesaId,
								casoCobroId: casoId,
								estadoPromesa: "pendiente",
								fechaProximoContacto: new Date(`${HOY_STR}T12:00:00.000Z`),
								fechaAlerta: null,
							},
						]);
					}
					if ("editadoEn" in fields) {
						// Auditoría: la única edición posterior al boundary, con el
						// valor ANTERIOR (mañana, no hoy) en valoresAnteriores.
						return Promise.resolve([
							{
								contactoId: promesaId,
								editadoEn: new Date(`${HOY_STR}T08:00:00.000Z`),
								valoresAnteriores: {
									fechaProximoContacto: "2026-02-11T12:00:00.000Z",
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

describe("obtenerColaOperacionAsesor — promesa editada después del boundary (Codex PR #1331)", () => {
	test("usa fechaProximoContacto ANTERIOR a la edición, no el valor actual", async () => {
		const hoy = new Date(`${HOY_STR}T06:00:00.000Z`);
		const resultado = await obtenerColaOperacionAsesor(
			{ userId: "crm-octavio", asesorCarteraId: 8, nombre: "Octavio" },
			hoy,
		);
		// A las 00:00 GT la promesa vencía mañana, no hoy — sin SLA hoy y sin
		// promesa_hoy reconstruida correctamente, el crédito no debe aparecer.
		expect(resultado).toEqual([]);
	});
});
