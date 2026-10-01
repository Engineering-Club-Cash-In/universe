/**
 * CB-037 / CB-038 · Reglas de las visitas de cobros (lib pura): en qué
 * buckets se puede, qué exige cada resultado, el pago (total o parcial por
 * porcentaje) y lo que queda en el historial de contactos.
 */
import { describe, expect, it } from "bun:test";
import {
	deudaVencida,
	erroresProgramacionVisita,
	erroresRegistroVisita,
	estadoContactoDeResultado,
	metodoContactoDeVisita,
	montoPagoParcial,
	motivoBloqueoVisita,
	programarVisitaSchema,
	type RegistrarVisitaInput,
	registrarVisitaSchema,
	siguientesPasos,
	textoAvisoVisitaProgramada,
	textoGestionVisita,
	visitaPermitidaEnBucket,
} from "./visitas-cobros";

const AHORA = new Date("2026-09-29T16:00:00.000Z");
const CASO = "71af2e4d-22c1-4aa8-869d-be4d56675e2a";

const registro = (extra: Partial<RegistrarVisitaInput> = {}) =>
	registrarVisitaSchema.parse({
		casoCobroId: CASO,
		tipo: "residencia",
		direccion: "23 Avenida 12-13 zona 18",
		responsableId: "u-erik",
		fechaVisita: new Date(AHORA.getTime() - 30 * 60_000),
		resultado: "promesa",
		comentarios: "Atendió la esposa, dice que paga el viernes",
		...extra,
	});

describe("buckets", () => {
	it("de B2 a B4", () => {
		expect([0, 1, 2, 3, 4, 5].map(visitaPermitidaEnBucket)).toEqual([
			false,
			false,
			true,
			true,
			true,
			false,
		]);
		expect(visitaPermitidaEnBucket(null)).toBe(false);
	});

	it("el motivo dice dónde está el caso", () => {
		expect(motivoBloqueoVisita(2)).toBeNull();
		expect(motivoBloqueoVisita(1, "B1")).toBe(
			"Disponible de B2 a B4. Este caso está en B1.",
		);
		expect(motivoBloqueoVisita(null)).toContain("no tiene bucket");
	});
});

describe("resultado → gestión y siguientes pasos", () => {
	it("cada tipo tiene su canal en el historial", () => {
		expect(metodoContactoDeVisita("residencia")).toBe("visita_domicilio");
		expect(metodoContactoDeVisita("trabajo")).toBe("visita_trabajo");
	});

	it("la promesa NO se marca promesa_pago acá: esa fila la crea el modal de promesa", () => {
		expect(estadoContactoDeResultado("promesa")).toBe("contactado");
		expect(estadoContactoDeResultado("pago_parcial_promesa")).toBe(
			"acuerdo_parcial",
		);
		expect(estadoContactoDeResultado("sin_contacto")).toBe("no_contesta");
		expect(estadoContactoDeResultado("entrega_voluntaria")).toBe("contactado");
	});

	it("pago parcial + promesa abre las dos cosas; convenio y entrega, su formulario", () => {
		expect(siguientesPasos("pago_parcial_promesa")).toEqual({
			pago: true,
			promesa: true,
			convenio: false,
			entrega: false,
		});
		expect(siguientesPasos("convenio")).toEqual({
			pago: false,
			promesa: false,
			convenio: true,
			entrega: false,
		});
		expect(siguientesPasos("entrega_voluntaria")).toEqual({
			pago: false,
			promesa: false,
			convenio: false,
			entrega: true,
		});
		expect(siguientesPasos("sin_contacto")).toEqual({
			pago: false,
			promesa: false,
			convenio: false,
			entrega: false,
		});
	});
});

describe("monto del pago", () => {
	it("la base es cuotas vencidas × cuota + mora; el parcial, un porcentaje de ella", () => {
		expect(
			deudaVencida({ cuotasVencidas: 3, cuota: "2043.30", mora: "515.02" }),
		).toBe(6644.92);
		expect(montoPagoParcial(6644.92, 50)).toBe(3322.46);
		expect(montoPagoParcial(10_000, 60)).toBe(6000);
		expect(montoPagoParcial(6644.92, 33)).toBe(2192.82);
	});

	it("datos basura no inventan deuda", () => {
		expect(deudaVencida({ cuotasVencidas: null, cuota: "x", mora: -5 })).toBe(
			0,
		);
	});
});

describe("erroresRegistroVisita", () => {
	it("un registro completo pasa", () => {
		expect(erroresRegistroVisita(registro(), AHORA)).toBeNull();
	});

	it("la visita no puede ser futura ni de hace más de 30 días", () => {
		expect(
			erroresRegistroVisita(
				registro({ fechaVisita: new Date(AHORA.getTime() + 3_600_000) }),
				AHORA,
			),
		).toContain("no puede ser futura");
		expect(
			erroresRegistroVisita(
				registro({
					fechaVisita: new Date(AHORA.getTime() - 31 * 86_400_000),
				}),
				AHORA,
			),
		).toContain("más de 30 días");
	});

	it("sin contacto exige el motivo", () => {
		expect(
			erroresRegistroVisita(registro({ resultado: "sin_contacto" }), AHORA),
		).toBe("Seleccione el motivo por el que no hubo contacto.");
		expect(
			erroresRegistroVisita(
				registro({ resultado: "sin_contacto", motivoSinContacto: "otro" }),
				AHORA,
			),
		).toBeNull();
		expect(
			erroresRegistroVisita(
				registro({
					resultado: "pago",
					montoRecibido: 100,
					motivoSinContacto: "no_estaba",
				}),
				AHORA,
			),
		).toContain("no aplica");
	});

	it("el pago exige el monto; el parcial, además, el porcentaje", () => {
		expect(erroresRegistroVisita(registro({ resultado: "pago" }), AHORA)).toBe(
			"Falta el monto que pagó el cliente.",
		);
		expect(
			erroresRegistroVisita(
				registro({ resultado: "pago", montoRecibido: 6644.92 }),
				AHORA,
			),
		).toBeNull();
		expect(
			erroresRegistroVisita(
				registro({ resultado: "pago_parcial_promesa", montoRecibido: 100 }),
				AHORA,
			),
		).toContain("porcentaje");
		expect(
			erroresRegistroVisita(
				registro({
					resultado: "pago_parcial_promesa",
					montoRecibido: 6000,
					porcentajePagado: 60,
				}),
				AHORA,
			),
		).toBeNull();
	});

	it("monto y porcentaje no aplican a los demás resultados", () => {
		expect(
			erroresRegistroVisita(
				registro({ resultado: "promesa", montoRecibido: 100 }),
				AHORA,
			),
		).toContain("solo aplica");
		expect(
			erroresRegistroVisita(
				registro({
					resultado: "pago",
					montoRecibido: 100,
					porcentajePagado: 50,
				}),
				AHORA,
			),
		).toContain("solo aplica");
		expect(
			erroresRegistroVisita(registro({ resultado: "convenio" }), AHORA),
		).toBeNull();
	});

	it("el porcentaje va de 1 a 99: el 100% es «Pago total»", () => {
		expect(
			registrarVisitaSchema.safeParse({
				...registro(),
				resultado: "pago_parcial_promesa",
				montoRecibido: 100,
				porcentajePagado: 100,
			}).success,
		).toBe(false);
	});

	it("fotos repetidas no pasan, y el máximo lo pone zod", () => {
		const foto = {
			key: `cobros/visitas/${CASO}/a.jpg`,
			nombreArchivo: "a.jpg",
		};
		expect(
			erroresRegistroVisita(registro({ evidencias: [foto, foto] }), AHORA),
		).toBe("Hay fotos repetidas.");
		expect(
			registrarVisitaSchema.safeParse({
				casoCobroId: CASO,
				tipo: "residencia",
				direccion: "23 Avenida 12-13 zona 18",
				responsableId: "u",
				fechaVisita: AHORA,
				resultado: "pago",
				comentarios: "Pagó en efectivo",
				evidencias: Array.from({ length: 6 }, (_, i) => ({
					key: `k${i}`,
					nombreArchivo: `f${i}.jpg`,
				})),
			}).success,
		).toBe(false);
	});

	it("los comentarios son obligatorios", () => {
		expect(
			registrarVisitaSchema.safeParse({ ...registro(), comentarios: "   " })
				.success,
		).toBe(false);
		expect(
			registrarVisitaSchema.safeParse({ ...registro(), comentarios: "No" })
				.success,
		).toBe(false);
	});
});

describe("erroresProgramacionVisita", () => {
	const programar = (fechaProgramada: Date) =>
		programarVisitaSchema.parse({
			casoCobroId: CASO,
			tipo: "trabajo",
			direccion: "Oficinas centrales, zona 10",
			responsableId: "u-erik",
			fechaProgramada,
		});

	it("no se programa en el pasado ni a más de 60 días", () => {
		expect(
			erroresProgramacionVisita(
				programar(new Date(AHORA.getTime() + 86_400_000)),
				AHORA,
			),
		).toBeNull();
		expect(
			erroresProgramacionVisita(
				programar(new Date(AHORA.getTime() - 3_600_000)),
				AHORA,
			),
		).toContain("ya pasó");
		expect(
			erroresProgramacionVisita(
				programar(new Date(AHORA.getTime() + 61 * 86_400_000)),
				AHORA,
			),
		).toContain("60 días");
	});
});

describe("textoGestionVisita", () => {
	it("explica la visita sola en el historial", () => {
		expect(
			textoGestionVisita(
				registro({
					tipo: "trabajo",
					resultado: "pago_parcial_promesa",
					montoRecibido: 1250,
					porcentajePagado: 40,
					comentarios: "Pagó en efectivo en la garita",
				}),
			),
		).toBe(
			"Visita al lugar de trabajo — Pago parcial + promesa (pagó el 40% de lo vencido: Q1,250.00). Dirección: 23 Avenida 12-13 zona 18. Pagó en efectivo en la garita",
		);
		expect(
			textoGestionVisita(
				registro({
					resultado: "sin_contacto",
					motivoSinContacto: "ya_no_vive_o_trabaja",
					comentarios: "La vecina dice que se mudó",
				}),
			),
		).toBe(
			"Visita a residencia — Sin contacto: Ya no vive o trabaja ahí. Dirección: 23 Avenida 12-13 zona 18. La vecina dice que se mudó",
		);
	});
});

describe("textoAvisoVisitaProgramada", () => {
	const base = {
		tipo: "residencia" as const,
		cliente: "Susset Archila",
		numeroSifco: "0101",
		fechaProgramada: new Date("2026-09-30T15:00:00.000Z"),
		direccion: "Zona 18, casa 5",
		programadaPor: null,
		esHoy: true,
	};

	it("al responsable: «Hoy tiene una visita»", () => {
		expect(textoAvisoVisitaProgramada(base).titulo).toBe(
			"Hoy tiene una visita a residencia",
		);
	});

	it("redirigido porque cartera reasignó el crédito: dice de quién era", () => {
		const t = textoAvisoVisitaProgramada({
			...base,
			reasignadaDe: "Samuel Gamboa",
		});
		expect(t.titulo).toBe("Hoy hay una visita a residencia pendiente");
		expect(t.descripcion).toContain(
			"Estaba asignada a Samuel Gamboa, que ya no lleva el crédito",
		);
	});
});
