import { describe, expect, mock, test } from "bun:test";

// Un solo crédito, con SLA venciendo "ayer real" (según el reloj del
// sistema) pero que sí vence en la fecha GT que se le inyecta como `hoy` a
// la función — así el test distingue entre "usa new Date() real" (fallaría,
// slaHoy quedaría false) y "usa el hoy inyectado" (pasa, slaHoy true).
const HOY_INYECTADO_STR = "2026-01-15";
const FECHA_LIMITE_SLA = "2026-01-15";

// where() sirve tanto para queries que se awaitean directo (casos, promesas)
// como para la de ultimosContactos, que encadena .groupBy() antes de
// resolver — el objeto retornado por where() es awaitable (thenable) Y
// expone groupBy() como una promesa vacía, cubriendo ambos casos.
function whereVacio() {
	const promesaVacia = Promise.resolve([]);
	return Object.assign(promesaVacia, { groupBy: () => Promise.resolve([]) });
}

mock.module("../db", () => ({
	db: {
		select: () => ({
			from: () => ({
				where: whereVacio,
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
					fecha_entrada_bucket: "2026-01-11",
					fecha_limite_sla: FECHA_LIMITE_SLA,
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

describe("obtenerColaOperacionAsesor — hoy inyectado (catch-up de boot)", () => {
	test("usa el `hoy` inyectado para clasificar slaHoy, no new Date() real", async () => {
		// Instante 00:00 GT del día capturado — lo que ejecutarAgendaCobrosDiaria
		// pasa vía obtenerAgendaTodosAsesores, sin importar la hora real en que
		// corre el catch-up (podría ser horas después, mismo día GT).
		const hoyInyectado = new Date(`${HOY_INYECTADO_STR}T06:00:00.000Z`);

		const resultado = await obtenerColaOperacionAsesor(
			{ userId: "crm-octavio", asesorCarteraId: 8, nombre: "Octavio" },
			hoyInyectado,
		);

		expect(resultado).toEqual([
			{
				asesorId: "crm-octavio",
				asesorNombre: "Octavio",
				numeroCreditoSifco: "SIFCO-1",
				casoCobroId: null,
				bucketSnapshot: 1,
				motivoAgenda: "sla_hoy",
			},
		]);
	});

	test("sin hoy inyectado, default a new Date() real (comportamiento previo intacto)", async () => {
		// No pasar `hoy` no debe romper — sigue siendo new Date() por default.
		// No se puede asertar el mismo resultado (depende del reloj real del
		// sistema al correr el test), solo que la llamada no explota.
		const resultado = await obtenerColaOperacionAsesor({
			userId: "crm-octavio",
			asesorCarteraId: 8,
			nombre: "Octavio",
		});
		expect(Array.isArray(resultado)).toBe(true);
	});
});
