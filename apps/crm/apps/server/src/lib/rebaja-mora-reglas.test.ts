import { describe, expect, test } from "bun:test";
import {
	aCentavos,
	clasificarErrorCartera,
	ESPERA_RECHAZO_TRAS_ERROR_MS,
	ESTADOS_SIN_REBAJA,
	esAprobacionColgada,
	PLAZO_APLICACION_REBAJA_MS,
	puedeRechazarTrasError,
	quetzalesRebaja,
	UMBRAL_APROBACION_COLGADA_MS,
} from "./rebaja-mora-reglas";

describe("montos", () => {
	test("aCentavos evita el error de flotantes", () => {
		expect(aCentavos("0.10") + aCentavos("0.20")).toBe(30);
		expect(aCentavos("1234.50")).toBe(123450);
		expect(aCentavos(0)).toBe(0);
	});

	test("quetzalesRebaja formatea con miles y dos decimales", () => {
		expect(quetzalesRebaja("1234.5")).toBe("Q1,234.50");
		expect(quetzalesRebaja("0")).toBe("Q0.00");
	});
});

describe("clasificarErrorCartera", () => {
	test("excede_mora es definitivo y muestra la mora actual", () => {
		const r = clasificarErrorCartera({
			status: 409,
			payload: { kind: "excede_mora", mora_actual: "300.00" },
		});
		expect(r.tipo).toBe("definitivo");
		expect(r.motivo).toContain("Q300.00");
	});

	test("excede_devengado y estado_no_permitido son definitivos y quitan el prefijo [ERROR]", () => {
		for (const kind of ["excede_devengado", "estado_no_permitido"]) {
			const r = clasificarErrorCartera({
				status: 409,
				payload: { kind, message: "[ERROR] Motivo de cartera." },
			});
			expect(r).toEqual({ tipo: "definitivo", motivo: "Motivo de cartera." });
		}
	});

	test("not_found (sin mora activa) es definitivo", () => {
		expect(
			clasificarErrorCartera({ status: 404, payload: { kind: "not_found" } })
				.tipo,
		).toBe("definitivo");
	});

	test("usuario_no_encontrado es transitorio: es configuración, no un rechazo", () => {
		expect(
			clasificarErrorCartera({
				status: 404,
				payload: { kind: "usuario_no_encontrado" },
			}).tipo,
		).toBe("transitorio");
	});

	test("sin respuesta (red, timeout, circuito abierto) es transitorio", () => {
		expect(clasificarErrorCartera({ status: null }).tipo).toBe("transitorio");
	});

	test("401 y 403 son transitorios: error de configuración del CRM", () => {
		for (const status of [401, 403]) {
			const r = clasificarErrorCartera({ status });
			expect(r.tipo).toBe("transitorio");
			expect(r.motivo).toContain("CRM_SERVICE_USER_ID");
		}
	});

	test("404 sin kind es un endpoint que no existe: transitorio", () => {
		expect(clasificarErrorCartera({ status: 404 }).tipo).toBe("transitorio");
	});

	test("5xx, 408 y 429 son transitorios", () => {
		for (const status of [500, 502, 503, 408, 429]) {
			expect(clasificarErrorCartera({ status }).tipo).toBe("transitorio");
		}
	});

	test("otro 4xx sin kind es definitivo, con el mensaje de cartera", () => {
		const r = clasificarErrorCartera({
			status: 400,
			payload: { message: "[ERROR] Monto inválido" },
		});
		expect(r).toEqual({ tipo: "definitivo", motivo: "Monto inválido" });
	});
});

describe("esAprobacionColgada", () => {
	const ahora = new Date("2026-10-09T12:00:00Z");

	test("una aprobación recién reclamada no está colgada", () => {
		expect(
			esAprobacionColgada(
				new Date("2026-10-09T11:59:00Z"),
				ahora,
				UMBRAL_APROBACION_COLGADA_MS,
			),
		).toBe(false);
	});

	test("una aprobación de más del umbral sí está colgada", () => {
		expect(
			esAprobacionColgada(
				new Date("2026-10-09T11:40:00Z"),
				ahora,
				UMBRAL_APROBACION_COLGADA_MS,
			),
		).toBe(true);
	});

	test("sin fecha no se considera colgada", () => {
		expect(esAprobacionColgada(null, ahora, UMBRAL_APROBACION_COLGADA_MS)).toBe(
			false,
		);
	});
});

test("ESTADOS_SIN_REBAJA incluye convenio e incobrable", () => {
	expect(ESTADOS_SIN_REBAJA).toContain("EN_CONVENIO");
	expect(ESTADOS_SIN_REBAJA).toContain("INCOBRABLE");
});

describe("plazo de la aplicación en cartera", () => {
	test("vence mucho antes de que el job de colgadas reclame la aprobación", () => {
		// La llamada tiene plazo propio (token + POST) más el timeout del fetch (30 s).
		expect(PLAZO_APLICACION_REBAJA_MS + 60_000).toBeLessThan(
			UMBRAL_APROBACION_COLGADA_MS,
		);
	});
});

describe("puedeRechazarTrasError", () => {
	const ahora = new Date("2026-10-10T12:00:00Z");

	test("no deja rechazar mientras un intento de cartera aún puede escribir", () => {
		const hace1min = new Date(ahora.getTime() - 60 * 1000);
		expect(puedeRechazarTrasError(hace1min, ahora)).toBe(false);
	});

	test("deja rechazar pasado el plazo de la llamada más el margen", () => {
		const alLimite = new Date(ahora.getTime() - ESPERA_RECHAZO_TRAS_ERROR_MS);
		expect(puedeRechazarTrasError(alLimite, ahora)).toBe(true);
	});

	test("sin instante de intento no hay nada que esperar", () => {
		expect(puedeRechazarTrasError(null, ahora)).toBe(true);
	});
});
