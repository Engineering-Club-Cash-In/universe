import { describe, expect, it } from "bun:test";
import {
	armarSemillas,
	consolidarCreditosRelacionados,
	type FilaPersonaEnCredito,
	filtrarPorAccesoYTopar,
	normalizarNombre,
	resolverCreditosCanonicos,
} from "./creditos-relacionados";

const semillas = armarSemillas({
	titular: {
		nombre: "Luis Fernando  Aguilar",
		telefonos: ["5555-1234 / 4444-0000", null],
	},
	codeudores: [{ nombre: "Ana Gómez", telefonos: ["3333-2222"] }],
	referencias: [
		{ nombre: "Pedro Ruiz", telefonos: ["7777-8888"] },
		// Mismo número que el titular: se queda con el titular.
		{ nombre: "Otra referencia", telefonos: ["55551234"] },
	],
});

function fila(parcial: Partial<FilaPersonaEnCredito>): FilaPersonaEnCredito {
	return {
		numeroSifco: "100",
		rol: "titular",
		personaNombre: "Alguien Más",
		personaTelefono: null,
		titularNombre: "Alguien Más",
		vehiculo: null,
		...parcial,
	};
}

describe("normalizarNombre", () => {
	it("quita tildes, mayúsculas y espacios de más", () => {
		expect(normalizarNombre("  Ána  GÓMEZ Núñez ")).toBe("ana gomez nunez");
	});

	it("trata igual la tilde pegada y la tilde como carácter aparte", () => {
		expect(normalizarNombre("Jose\u0301 Nu\u0303n\u0303ez")).toBe(
			normalizarNombre("José Ñúñez"),
		);
	});
});

describe("armarSemillas", () => {
	it("normaliza teléfonos y el primero que trae el número se lo queda", () => {
		expect(semillas.telefonos).toEqual([
			{
				telefono: "55551234",
				origen: "titular",
				persona: "Luis Fernando Aguilar",
			},
			{
				telefono: "44440000",
				origen: "titular",
				persona: "Luis Fernando Aguilar",
			},
			{ telefono: "33332222", origen: "codeudor", persona: "Ana Gómez" },
			{ telefono: "77778888", origen: "referencia", persona: "Pedro Ruiz" },
		]);
	});

	it("solo titular y codeudores aportan nombre, y de dos palabras o más", () => {
		const s = armarSemillas({
			titular: { nombre: "Luis", telefonos: [] },
			codeudores: [{ nombre: "Ana Gómez", telefonos: [] }],
			referencias: [{ nombre: "Pedro Ruiz", telefonos: [] }],
		});
		expect(s.nombres.map((n) => n.nombre)).toEqual(["ana gomez"]);
	});
});

describe("consolidarCreditosRelacionados", () => {
	it("excluye el crédito del propio caso", () => {
		const r = consolidarCreditosRelacionados({
			semillas,
			sifcoActual: "48215",
			filas: [fila({ numeroSifco: "48215", personaTelefono: "55551234" })],
		});
		expect(r).toEqual([]);
	});

	it("descarta un LIKE que no es el mismo número", () => {
		const r = consolidarCreditosRelacionados({
			semillas,
			sifcoActual: null,
			filas: [fila({ personaTelefono: "1555512349" })],
		});
		expect(r).toEqual([]);
	});

	it("agrupa por SIFCO y junta motivos y personas", () => {
		const r = consolidarCreditosRelacionados({
			semillas,
			sifcoActual: null,
			filas: [
				fila({
					numeroSifco: "46330",
					rol: "codeudor",
					personaNombre: "Luis Fernando Aguilar",
					personaTelefono: "5555-1234",
				}),
				fila({
					numeroSifco: "46330",
					rol: "titular",
					personaNombre: "Pedro Ruiz",
					personaTelefono: "7777 8888",
				}),
			],
		});
		expect(r).toHaveLength(1);
		expect(r[0].personas).toEqual([
			{
				nombre: "Luis Fernando Aguilar",
				rolAqui: "titular",
				nombreAlla: "Luis Fernando Aguilar",
				rolAlla: "codeudor",
			},
			{
				nombre: "Pedro Ruiz",
				rolAqui: "referencia",
				nombreAlla: "Pedro Ruiz",
				rolAlla: "titular",
			},
		]);
		expect(r[0].motivos.map((m) => `${m.tipo}:${m.origen}`)).toEqual([
			"telefono:titular",
			"nombre:titular",
			"telefono:referencia",
		]);
		expect(r[0].soloPorNombre).toBe(false);
	});

	it("marca solo por nombre y lo ordena después", () => {
		const r = consolidarCreditosRelacionados({
			semillas,
			sifcoActual: null,
			filas: [
				fila({ numeroSifco: "1", personaNombre: "Ana Gomez" }),
				fila({ numeroSifco: "2", personaTelefono: "33332222" }),
			],
		});
		expect(r.map((c) => [c.numeroSifco, c.soloPorNombre])).toEqual([
			["2", false],
			["1", true],
		]);
	});

	it("separa el papel en este caso del papel en el otro crédito", () => {
		const r = consolidarCreditosRelacionados({
			semillas,
			sifcoActual: null,
			filas: [
				// El codeudor del caso es titular del otro crédito.
				fila({
					numeroSifco: "300",
					rol: "titular",
					personaNombre: "Ana Gómez",
					personaTelefono: "3333-2222",
				}),
			],
		});
		expect(r[0].personas).toEqual([
			{
				nombre: "Ana Gómez",
				rolAqui: "codeudor",
				nombreAlla: "Ana Gómez",
				rolAlla: "titular",
			},
		]);
	});

	it("con match por teléfono, el nombre de aquí es el de la semilla", () => {
		const r = consolidarCreditosRelacionados({
			semillas,
			sifcoActual: null,
			filas: [
				// La referencia «Pedro Ruiz» tiene el número del deudor «Juan Pérez».
				fila({
					numeroSifco: "500",
					rol: "titular",
					personaNombre: "Juan Pérez",
					personaTelefono: "7777-8888",
				}),
			],
		});
		expect(r[0].personas).toEqual([
			{
				nombre: "Pedro Ruiz",
				rolAqui: "referencia",
				nombreAlla: "Juan Pérez",
				rolAlla: "titular",
			},
		]);
	});

	it("con varias coincidencias se queda con el papel más fuerte aquí", () => {
		const r = consolidarCreditosRelacionados({
			semillas: armarSemillas({
				titular: { nombre: "Luis Aguilar", telefonos: [] },
				codeudores: [],
				referencias: [{ nombre: "Tío Luis", telefonos: ["5555-1234"] }],
			}),
			sifcoActual: null,
			filas: [
				fila({
					numeroSifco: "400",
					rol: "codeudor",
					personaNombre: "Luis Aguilar",
					personaTelefono: "5555-1234",
				}),
			],
		});
		expect(r[0].personas[0]).toMatchObject({
			rolAqui: "titular",
			rolAlla: "codeudor",
		});
	});
});

describe("resolverCreditosCanonicos", () => {
	const viejo = new Date("2026-01-01");
	const nuevo = new Date("2026-06-01");
	const caso = (
		p: Partial<
			Parameters<typeof resolverCreditosCanonicos>[0]["casos"][number]
		>,
	) => ({
		numeroCreditoSifco: "1",
		activo: true,
		updatedAt: viejo,
		contratoOpportunityId: null,
		contratoLeadId: null,
		contratoVehicleId: null,
		tieneContrato: false,
		...p,
	});
	const opp = (
		p: Partial<
			Parameters<typeof resolverCreditosCanonicos>[0]["oportunidades"][number]
		>,
	) => ({
		id: "opp",
		sifco: "1",
		status: "won",
		leadId: "lead-opp",
		vehicleId: "veh-opp",
		...p,
	});

	it("el contrato del caso activo le gana a un caso inactivo más nuevo", () => {
		const r = resolverCreditosCanonicos({
			casos: [
				caso({
					activo: false,
					updatedAt: nuevo,
					contratoOpportunityId: "opp-obsoleta",
					tieneContrato: true,
				}),
				caso({ contratoOpportunityId: "opp-vigente", tieneContrato: true }),
			],
			oportunidades: [
				opp({ id: "opp-reciente" }),
				opp({ id: "opp-obsoleta" }),
				opp({ id: "opp-vigente" }),
			],
		});
		expect(r.get("1")?.opportunityId).toBe("opp-vigente");
	});

	it("si el caso vigente no tiene contrato no se usa el de un caso inactivo", () => {
		const r = resolverCreditosCanonicos({
			casos: [
				caso({
					activo: false,
					updatedAt: nuevo,
					contratoOpportunityId: "opp-obsoleta",
					tieneContrato: true,
				}),
				caso({}),
			],
			oportunidades: [
				opp({ id: "opp-ganada-reciente" }),
				opp({ id: "opp-obsoleta" }),
			],
		});
		expect(r.get("1")?.opportunityId).toBe("opp-ganada-reciente");
	});

	it("sin caso, la primera oportunidad del orden", () => {
		const r = resolverCreditosCanonicos({
			casos: [],
			oportunidades: [
				opp({ id: "a", sifco: "2" }),
				opp({ id: "b", sifco: "2" }),
			],
		});
		expect(r.get("2")?.opportunityId).toBe("a");
	});

	it("con contrato, el titular cae al lead del cliente si la oportunidad no tiene", () => {
		const r = resolverCreditosCanonicos({
			casos: [
				caso({
					contratoOpportunityId: "opp-c",
					contratoLeadId: "lead-cliente",
					tieneContrato: true,
				}),
			],
			oportunidades: [opp({ id: "opp-c", leadId: null })],
		});
		expect(r.get("1")?.leadId).toBe("lead-cliente");
	});

	it("el vehículo del contrato le gana al de la oportunidad", () => {
		const r = resolverCreditosCanonicos({
			casos: [
				caso({
					contratoOpportunityId: "opp-c",
					contratoVehicleId: "veh-contrato",
					tieneContrato: true,
				}),
			],
			oportunidades: [opp({ id: "opp-c", vehicleId: "veh-opp" })],
		});
		expect(r.get("1")?.vehicleId).toBe("veh-contrato");
	});
});

describe("filtrarPorAccesoYTopar", () => {
	it("no corta un homónimo abrible detrás de 20 que no se pueden abrir", () => {
		const ajenos = Array.from({ length: 25 }, (_, i) => ({
			id: `ajeno-${i}`,
			soloPorNombre: true,
			puedeAbrir: false,
		}));
		const r = filtrarPorAccesoYTopar([
			...ajenos,
			{ id: "propio", soloPorNombre: true, puedeAbrir: true },
		]);
		expect(r.map((c) => c.id)).toEqual(["propio"]);
	});

	it("los de teléfono pasan siempre y el tope es 20", () => {
		const r = filtrarPorAccesoYTopar(
			Array.from({ length: 30 }, (_, i) => ({
				id: i,
				soloPorNombre: false,
				puedeAbrir: false,
			})),
		);
		expect(r).toHaveLength(20);
	});
});
