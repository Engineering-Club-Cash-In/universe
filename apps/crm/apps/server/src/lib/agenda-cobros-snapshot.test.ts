import { describe, expect, test } from "bun:test";
import {
	type AgendaSnapshotItemFuente,
	type AgendaSnapshotRepository,
	capturarSnapshots,
	cerrarItemsAgenda,
	deduplicarAgenda,
	fechaAnteriorGuatemala,
	ventanaDiaGuatemala,
} from "./agenda-cobros-snapshot";

const item = (
	overrides: Partial<AgendaSnapshotItemFuente> = {},
): AgendaSnapshotItemFuente => ({
	asesorId: "asesor-jose",
	asesorNombre: "José",
	numeroCreditoSifco: "SIFCO-1",
	casoCobroId: "caso-1",
	bucketSnapshot: 2,
	motivoAgenda: "sla_hoy",
	...overrides,
});

describe("deduplicarAgenda", () => {
	test("conserva un crédito por asesor/SIFCO y prioriza D-0", () => {
		const resultado = deduplicarAgenda([
			item({ motivoAgenda: "promesa_hoy" }),
			item({ motivoAgenda: "D-0", bucketSnapshot: 1 }),
			item({ asesorId: "asesor-ana", motivoAgenda: "sla_hoy" }),
		]);

		expect(resultado).toHaveLength(2);
		expect(resultado[0]?.motivoAgenda).toBe("D-0");
		expect(resultado[0]?.bucketSnapshot).toBe(1);
	});
});

describe("capturarSnapshots", () => {
	test("crea un snapshot único por asesor/día y reintentar no duplica", async () => {
		const guardados = new Map<string, ReturnType<typeof item>[]>();
		const repo: AgendaSnapshotRepository = {
			crearSiAusente: async (fecha, asesorId, items) => {
				const llave = `${fecha}:${asesorId}`;
				if (guardados.has(llave)) return false;
				guardados.set(llave, [...items] as ReturnType<typeof item>[]);
				return true;
			},
		};

		await capturarSnapshots("2026-08-17", [item()], repo);
		await capturarSnapshots("2026-08-17", [item()], repo);

		expect(guardados).toHaveLength(1);
		expect(guardados.get("2026-08-17:asesor-jose")).toHaveLength(1);
	});

	test("cambios posteriores de agenda no alteran snapshot congelado", async () => {
		const guardados = new Map<string, readonly ReturnType<typeof item>[]>();
		const repo: AgendaSnapshotRepository = {
			crearSiAusente: async (fecha, asesorId, items) => {
				const llave = `${fecha}:${asesorId}`;
				if (guardados.has(llave)) return false;
				guardados.set(
					llave,
					structuredClone(items) as ReturnType<typeof item>[],
				);
				return true;
			},
		};

		await capturarSnapshots("2026-08-17", [item()], repo);
		await capturarSnapshots(
			"2026-08-17",
			[item({ numeroCreditoSifco: "SIFCO-NUEVO" })],
			repo,
		);

		expect(
			guardados.get("2026-08-17:asesor-jose")?.map((x) => x.numeroCreditoSifco),
		).toEqual(["SIFCO-1"]);
	});
});

describe("cerrarItemsAgenda", () => {
	const fecha = "2026-08-17";
	const baseContacto = {
		id: "contacto-1",
		casoCobroId: "caso-1",
		numeroCreditoSifco: "SIFCO-1",
		realizadoPor: "asesor-jose",
		fechaContacto: new Date("2026-08-17T12:00:00.000Z"),
		estadoContacto: "contactado",
		comentarios: "Gestión manual",
	};

	test.each([
		"contactado",
		"acuerdo_parcial",
		"rechaza_pagar",
		"promesa_pago",
	])("%s propio cumple", (estadoContacto) => {
		const [cerrado] = cerrarItemsAgenda(
			fecha,
			[item()],
			[{ ...baseContacto, estadoContacto }],
		);
		expect(cerrado?.atendido).toBe(true);
		expect(cerrado?.resultadoContacto).toBe(estadoContacto);
	});

	test.each([
		"no_contesta",
		"numero_equivocado",
	])("%s no cumple", (estadoContacto) => {
		const [cerrado] = cerrarItemsAgenda(
			fecha,
			[item()],
			[{ ...baseContacto, estadoContacto }],
		);
		expect(cerrado?.atendido).toBe(false);
	});

	test.each([
		"Recordatorio automático premora",
		"Recordatorio automático Convenio próximo",
		"Envío masivo de WhatsApp campaña",
	])("automático no cumple: %s", (comentarios) => {
		const [cerrado] = cerrarItemsAgenda(
			fecha,
			[item()],
			[{ ...baseContacto, comentarios }],
		);
		expect(cerrado?.atendido).toBe(false);
	});

	test("contacto de otro asesor no cumple", () => {
		const [cerrado] = cerrarItemsAgenda(
			fecha,
			[item()],
			[{ ...baseContacto, realizadoPor: "asesor-ana" }],
		);
		expect(cerrado?.atendido).toBe(false);
	});

	test("primer contacto efectivo cronológico gana", () => {
		const [cerrado] = cerrarItemsAgenda(
			fecha,
			[item()],
			[
				{
					...baseContacto,
					id: "tarde",
					fechaContacto: new Date("2026-08-17T20:00:00.000Z"),
				},
				{
					...baseContacto,
					id: "temprano",
					fechaContacto: new Date("2026-08-17T07:00:00.000Z"),
					estadoContacto: "promesa_pago",
				},
			],
		);
		expect(cerrado?.contactoCobroId).toBe("temprano");
		expect(cerrado?.resultadoContacto).toBe("promesa_pago");
	});

	test("día Guatemala incluye 06:00Z y excluye 06:00Z del día siguiente", () => {
		const [dentro, fuera] = cerrarItemsAgenda(
			fecha,
			[item(), item({ numeroCreditoSifco: "SIFCO-2", casoCobroId: "caso-2" })],
			[
				{
					...baseContacto,
					fechaContacto: new Date("2026-08-17T06:00:00.000Z"),
				},
				{
					...baseContacto,
					id: "fuera",
					casoCobroId: "caso-2",
					numeroCreditoSifco: "SIFCO-2",
					fechaContacto: new Date("2026-08-18T06:00:00.000Z"),
				},
			],
		);
		expect(dentro?.atendido).toBe(true);
		expect(fuera?.atendido).toBe(false);
		expect(ventanaDiaGuatemala(fecha)).toEqual({
			desde: new Date("2026-08-17T06:00:00.000Z"),
			hasta: new Date("2026-08-18T06:00:00.000Z"),
		});
	});
});

test("fecha anterior Guatemala cruza mes correctamente", () => {
	expect(fechaAnteriorGuatemala("2026-09-01")).toBe("2026-08-31");
});
