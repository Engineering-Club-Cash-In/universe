/**
 * CB-033 — clasificación de errores de `decidirConvenio`, ejecutando el
 * handler REAL contra un cartera-back simulado.
 *
 * Qué se juega acá: el status que sale de este handler decide si el cliente
 * CONSERVA o DESCARTA el `operacion_id` con el que se recupera una decisión
 * cuyo resultado no se confirmó. Un rechazo confirmado en cartera borra el
 * convenio; si además se pierde el id, no queda nada — ni fila que abrir ni
 * forma de averiguar qué pasó.
 *
 * La regla no es "4xx = definitivo". Es: **¿cartera llegó a consultar la
 * operación?** Solo entonces el error habla de la petición original. Los
 * errores de puerta (permisos, atribución) se devuelven ANTES de mirar
 * `convenio_operaciones`, así que solo describen el reenvío.
 *
 * Se prueba el handler y no una función suelta a propósito: una versión
 * anterior de este test construía el error final a mano y por eso no vio que
 * el router marcaba los errores de permisos como definitivos.
 */

import { describe, expect, mock, test } from "bun:test";
import { os } from "@orpc/server";

const procedure = os.$context<Record<string, never>>();

/** Réplica de `CarteraBackHttpError` (el módulo real se mockea abajo). */
class CarteraBackHttpError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly payload: { error?: string; message?: string } = {},
	) {
		super(message);
		this.name = "CarteraBackHttpError";
	}
}

const decidirConvenio = mock(async () => {
	throw new Error("sin configurar");
});

mock.module("@cci/email", () => ({ sendPlainEmail: mock() }));
mock.module("@repo/sms", () => ({ SMSClient: class {} }));
mock.module("../lib/orpc", () => ({
	adminProcedure: procedure,
	cobrosProcedure: procedure,
	cobrosSupervisorProcedure: procedure,
	protectedProcedure: procedure,
	publicProcedure: procedure,
}));
mock.module("../db", () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({ limit: async () => [] }),
			}),
		}),
	},
}));
mock.module("../services/cartera-back-client", () => ({
	CarteraBackHttpError,
	carteraBackClient: { decidirConvenio, getCredito: mock(async () => null) },
}));
/** Se apaga en el test de integración deshabilitada. */
let integracionHabilitada = true;
mock.module("../services/cartera-back-integration", () => ({
	isCarteraBackEnabled: () => integracionHabilitada,
}));
mock.module("../services/convenio-decision-notif", () => ({
	notificarConvenioResuelto: mock(),
}));
mock.module("./cobros", () => ({
	assertAccesoCasoCobro: mock(),
	cobrosRouter: {},
}));

const { call } = await import("@orpc/server");
const { convenioDecisionRouter } = await import("./convenio-decision");

const INPUT = {
	convenioId: 42,
	decision: "rechazado" as const,
	motivo: "no cumple los requisitos",
	operacionId: "11111111-2222-3333-4444-555555555555",
};

const CONTEXT = {
	context: {
		headers: new Headers(),
		session: { user: { email: "supervisor@clubcashin.com" } },
		userId: "u-1",
		userRole: "COBROS_SUPERVISOR",
	},
};

/** Ejecuta el handler tal cual y devuelve el error que sale. */
async function errorDelHandler(
	context: unknown = CONTEXT,
): Promise<{ code: string; message: string }> {
	try {
		// biome-ignore lint/suspicious/noExplicitAny: el context real lo arma el middleware
		await call(convenioDecisionRouter.decidirConvenio, INPUT, context as any);
	} catch (error) {
		const e = error as { code?: string; message?: string };
		return { code: e.code ?? "SIN_CODE", message: e.message ?? "" };
	}
	throw new Error("se esperaba que el handler lanzara");
}

/** Ejecuta el handler con cartera fallando así, y devuelve el error que sale. */
async function statusQueSaleDelCRM(
	fallo: CarteraBackHttpError | Error,
): Promise<{ code: string; message: string }> {
	decidirConvenio.mockImplementationOnce(async () => {
		throw fallo;
	});
	return errorDelHandler();
}

describe("decidirConvenio — qué errores permiten descartar el intento", () => {
	test("cartera consultó la operación y la rechazó → BAD_REQUEST (definitivo)", async () => {
		// Estos SÍ prueban que la decisión no se aplicó: para producirlos,
		// cartera tuvo que mirar `convenio_operaciones` / el convenio.
		for (const codigo of [
			"convenio_no_pendiente",
			"fingerprint_no_coincide",
			"motivo_requerido",
			"convenio_id_invalido",
		]) {
			const r = await statusQueSaleDelCRM(
				new CarteraBackHttpError(codigo, 409, { error: codigo }),
			);
			expect(r.code).toBe("BAD_REQUEST");
		}
	});

	test("errores de PUERTA (permisos/atribución) → 5xx: el intento sobrevive", async () => {
		// Caso real: un rechazo quedó confirmado en cartera y la respuesta se
		// perdió. Antes del reenvío cambia la configuración —el rol del
		// supervisor, o CRM_SERVICE_USER_ID en un redeploy—. El reenvío choca
		// contra el gate ANTES de que cartera mire la operación. Tratarlo como
		// definitivo borraba el operacion_id de una decisión YA EJECUTADA.
		for (const codigo of [
			"convenio_decision_no_autorizado",
			"decidido_por_email_requerido",
			"decidido_por_email_no_permitido",
		]) {
			const r = await statusQueSaleDelCRM(
				new CarteraBackHttpError(codigo, 403, { error: codigo }),
			);
			expect(r.code).toBe("INTERNAL_SERVER_ERROR");
			// El mensaje sigue siendo el real y accionable: el problema se
			// arregla con permisos o configuración, no reintentando a ciegas.
			expect(r.message).not.toContain("No se pudo confirmar el resultado");
			expect(r.message.length).toBeGreaterThan(0);
		}
	});

	test("429 de cartera atravesando el CRM → 5xx: el intento sobrevive", async () => {
		// Rate limit del proxy: <500, pero no dice nada de la petición
		// original. Va sin `error` en el payload, como lo manda un proxy.
		const r = await statusQueSaleDelCRM(
			new CarteraBackHttpError("Too Many Requests", 429),
		);
		expect(r.code).toBe("INTERNAL_SERVER_ERROR");
	});

	test("503 de cartera → 5xx: el intento sobrevive", async () => {
		const r = await statusQueSaleDelCRM(
			new CarteraBackHttpError("Service Unavailable", 503),
		);
		expect(r.code).toBe("INTERNAL_SERVER_ERROR");
	});

	test("código desconocido → 5xx: incierto por defecto", async () => {
		// Un código nuevo en cartera no puede volverse definitivo solo, o un
		// deploy de cartera empieza a borrar intentos recuperables acá.
		const r = await statusQueSaleDelCRM(
			new CarteraBackHttpError("algo nuevo", 400, {
				error: "codigo_que_no_existia_ayer",
			}),
		);
		expect(r.code).toBe("INTERNAL_SERVER_ERROR");
	});

	test("red caída (sin respuesta HTTP) → 5xx: el intento sobrevive", async () => {
		const r = await statusQueSaleDelCRM(new Error("fetch failed"));
		expect(r.code).toBe("INTERNAL_SERVER_ERROR");
	});
});

describe("decidirConvenio — guards de puerta del propio CRM", () => {
	test("integración deshabilitada → 503, sin llamar a cartera, intento conservado", async () => {
		// Mismo problema que los errores de puerta de cartera, pero del lado
		// del CRM: si una decisión quedó confirmada sin respuesta y después se
		// apaga la integración, un 400 acá borraba el operacion_id de algo ya
		// ejecutado. 503 lo conserva hasta que se reactive.
		decidirConvenio.mockClear();
		integracionHabilitada = false;
		try {
			const r = await errorDelHandler();
			expect(r.code).toBe("SERVICE_UNAVAILABLE");
			// No se consultó cartera: por eso este error no puede probar nada
			// sobre la petición original.
			expect(decidirConvenio).not.toHaveBeenCalled();
		} finally {
			integracionHabilitada = true;
		}
	});

	test("sesión sin email → UNAUTHORIZED (401): el intento sobrevive", async () => {
		// 401 está en ESTADOS_4XX_QUE_NO_PRUEBAN_NADA del cliente: habla del
		// reenvío (sesión vencida), no de la decisión anterior.
		decidirConvenio.mockClear();
		const r = await errorDelHandler({
			...CONTEXT.context,
			session: { user: { email: "   " } },
		});
		expect(r.code).toBe("UNAUTHORIZED");
		expect(decidirConvenio).not.toHaveBeenCalled();
	});

	test("rechazo sin motivo → BAD_REQUEST: definitivo de verdad", async () => {
		// Este sí es definitivo y debe seguir siéndolo: el reenvío manda el
		// payload CONGELADO del intento original, así que un motivo ausente no
		// puede aparecer después. Ningún reintento lo arreglaría.
		decidirConvenio.mockClear();
		let code = "";
		try {
			await call(
				convenioDecisionRouter.decidirConvenio,
				{ ...INPUT, motivo: undefined },
				// biome-ignore lint/suspicious/noExplicitAny: el context real lo arma el middleware
				CONTEXT as any,
			);
		} catch (error) {
			code = (error as { code?: string }).code ?? "";
		}
		expect(code).toBe("BAD_REQUEST");
		expect(decidirConvenio).not.toHaveBeenCalled();
	});
});
