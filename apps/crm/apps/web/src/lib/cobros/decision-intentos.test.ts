/**
 * CB-033 — el rastro que permite recuperar una decisión cuyo resultado no se
 * confirmó. Equivocarse acá borra el `operacion_id` justo cuando hace falta, o
 * deja que una pestaña mande la decisión que reservó la otra (aprobar donde el
 * usuario pidió rechazar, que además BORRA el convenio). Tres revisiones
 * seguidas encontraron un fallo distinto en este módulo, así que la tabla de
 * verdad y las carreras entre pestañas van escritas.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
	borrarIntentoPendiente,
	type ConvenioDecisionIntento,
	errorPruebaQueNoSeAplico,
	leerIntentoPendiente,
	reservarIntentoPendiente,
} from "./decision-intentos";

/** Error con la forma de un ORPCError: `code` SIEMPRE viene poblado. */
function errorOrpc(code: string, status: number) {
	return Object.assign(new Error(`falló: ${code}`), { code, status });
}

describe("errorPruebaQueNoSeAplico", () => {
	it("un 4xx de negocio prueba que no se aplicó: el intento se descarta", () => {
		expect(errorPruebaQueNoSeAplico(errorOrpc("BAD_REQUEST", 400))).toBe(true);
		expect(errorPruebaQueNoSeAplico(errorOrpc("NOT_FOUND", 404))).toBe(true);
		expect(errorPruebaQueNoSeAplico(errorOrpc("CONFLICT", 409))).toBe(true);
	});

	it("un 5xx NO prueba nada: la transacción pudo haber commiteado antes de cortarse", () => {
		expect(
			errorPruebaQueNoSeAplico(errorOrpc("INTERNAL_SERVER_ERROR", 500)),
		).toBe(false);
		expect(errorPruebaQueNoSeAplico(errorOrpc("BAD_GATEWAY", 502))).toBe(false);
		expect(errorPruebaQueNoSeAplico(errorOrpc("GATEWAY_TIMEOUT", 504))).toBe(
			false,
		);
	});

	it("401/403/429 NO prueban nada: el reenvío ni llegó a evaluarse", () => {
		// Sesión vencida, permisos cambiados o rate limit hablan del REENVÍO,
		// no de la petición original que quedó sin confirmar.
		expect(errorPruebaQueNoSeAplico(errorOrpc("UNAUTHORIZED", 401))).toBe(
			false,
		);
		expect(errorPruebaQueNoSeAplico(errorOrpc("FORBIDDEN", 403))).toBe(false);
		expect(errorPruebaQueNoSeAplico(errorOrpc("TOO_MANY_REQUESTS", 429))).toBe(
			false,
		);
		expect(errorPruebaQueNoSeAplico(errorOrpc("TIMEOUT", 408))).toBe(false);
	});

	it("sin status (red caída, request abortada) NO prueba nada", () => {
		expect(errorPruebaQueNoSeAplico(new Error("Failed to fetch"))).toBe(false);
		expect(errorPruebaQueNoSeAplico(null)).toBe(false);
		expect(errorPruebaQueNoSeAplico(undefined)).toBe(false);
	});

	it("no se guía por `code`: un ORPCError siempre lo trae, también en 5xx", () => {
		// Este era el bug original: `code !== undefined` daba true para todo.
		const error500 = errorOrpc("INTERNAL_SERVER_ERROR", 500);
		expect(error500.code).toBeDefined();
		expect(errorPruebaQueNoSeAplico(error500)).toBe(false);
	});

	// Nota: qué status le llega al cliente cuando cartera responde 429, 503 o
	// un error de permisos NO se prueba acá — depende del router, no de esta
	// función. Vive en `apps/server/src/routers/convenio-decision.errores.test.ts`,
	// que ejecuta el handler real. Una versión anterior de este archivo lo
	// simulaba construyendo un 500 a mano, y por eso no vio que el router
	// marcaba los errores de permisos como definitivos.

	it("timeout y después sesión vencida: ninguno de los dos borra el intento", () => {
		// Secuencia real: el primer envío se corta sin respuesta (sin status),
		// el usuario reenvía y para entonces la sesión caducó (401). Si
		// cualquiera de los dos descartara el intento, el `operacion_id` se
		// pierde y la decisión queda sin forma de recuperarse.
		expect(errorPruebaQueNoSeAplico(new Error("The operation timed out"))).toBe(
			false,
		);
		expect(errorPruebaQueNoSeAplico(errorOrpc("UNAUTHORIZED", 401))).toBe(
			false,
		);
	});
});

// --- Reserva y borrado (localStorage + Web Locks) ------------------------

const USER = "user-a";

function intento(
	overrides: Partial<ConvenioDecisionIntento> = {},
): ConvenioDecisionIntento {
	return {
		operacionId: "op-1",
		convenioId: 7,
		decision: "aprobado",
		motivo: null,
		creadoEn: "2026-09-11T12:00:00.000Z",
		resumen: { numeroCreditoSifco: "123" },
		...overrides,
	};
}

/**
 * `bun test` corre en un entorno sin `localStorage` ni `navigator.locks`. Se
 * montan ambos: el store para que el módulo tenga dónde escribir, y los locks
 * porque son justo lo que se está probando — serializan secciones críticas
 * que de otro modo se intercalan.
 */
function montarEntorno() {
	const store = new Map<string, string>();
	const g = globalThis as unknown as Record<string, unknown>;
	g.localStorage = {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => {
			store.set(k, v);
		},
		removeItem: (k: string) => {
			store.delete(k);
		},
		get length() {
			return store.size;
		},
		key: (i: number) => [...store.keys()][i] ?? null,
	};
	// `notificarCambio` usa window.dispatchEvent; sin window no debe romper,
	// pero acá se provee para no depender de ese catch.
	g.window = {
		dispatchEvent: () => true,
		addEventListener: () => {},
		removeEventListener: () => {},
	};
	return store;
}

/**
 * Web Locks real, en miniatura: una cola por nombre. Sin esto las dos
 * "pestañas" corren sus secciones críticas intercaladas y el test no probaría
 * nada de lo que el lock existe para evitar.
 */
function montarLocks() {
	const colas = new Map<string, Promise<unknown>>();
	(globalThis as unknown as Record<string, unknown>).navigator = {
		locks: {
			request: <T>(nombre: string, cb: () => T | Promise<T>): Promise<T> => {
				const previo = colas.get(nombre) ?? Promise.resolve();
				const actual = previo.then(() => cb());
				colas.set(
					nombre,
					actual.catch(() => undefined),
				);
				return actual;
			},
		},
	};
}

describe("reservarIntentoPendiente", () => {
	beforeEach(() => {
		montarEntorno();
		montarLocks();
	});

	it("sin intento previo reserva y persiste el payload", async () => {
		const r = await reservarIntentoPendiente(USER, intento());
		expect(r.estado).toBe("reservado");
		expect(leerIntentoPendiente(USER, 7)?.operacionId).toBe("op-1");
	});

	it("el mismo operacionId reserva de nuevo: es un reenvío, no un conflicto", async () => {
		await reservarIntentoPendiente(USER, intento());
		const r = await reservarIntentoPendiente(USER, intento());
		expect(r.estado).toBe("reservado");
	});

	it("aprobación contra un rechazo pendiente da conflicto y NO pisa el rechazo", async () => {
		// El caso peligroso: la otra pestaña dejó un rechazo esperando
		// confirmación. Si esta reserva ganara, el modal de "Aprobar" mandaría
		// el rechazo guardado y BORRARÍA el convenio sin que nadie lo pidiera.
		await reservarIntentoPendiente(
			USER,
			intento({
				operacionId: "op-rechazo",
				decision: "rechazado",
				motivo: "no cumple requisitos",
			}),
		);

		const r = await reservarIntentoPendiente(
			USER,
			intento({ operacionId: "op-aprobacion", decision: "aprobado" }),
		);

		expect(r.estado).toBe("conflicto");
		expect(r.intento.decision).toBe("rechazado");
		// El intento de la otra pestaña queda intacto.
		expect(leerIntentoPendiente(USER, 7)?.operacionId).toBe("op-rechazo");
	});

	it("dos pestañas confirmando a la vez: una reserva, la otra ve conflicto", async () => {
		const [a, b] = await Promise.all([
			reservarIntentoPendiente(USER, intento({ operacionId: "op-A" })),
			reservarIntentoPendiente(USER, intento({ operacionId: "op-B" })),
		]);

		const estados = [a.estado, b.estado].sort();
		expect(estados).toEqual(["conflicto", "reservado"]);

		// Y el ganador es el que quedó persistido: el perdedor no lo pisó.
		const ganador = a.estado === "reservado" ? a : b;
		expect(leerIntentoPendiente(USER, 7)?.operacionId).toBe(
			ganador.intento.operacionId,
		);
	});

	it("convenios distintos no se estorban", async () => {
		const a = await reservarIntentoPendiente(USER, intento({ convenioId: 7 }));
		const b = await reservarIntentoPendiente(
			USER,
			intento({ convenioId: 8, operacionId: "op-2" }),
		);
		expect(a.estado).toBe("reservado");
		expect(b.estado).toBe("reservado");
	});

	it("usuarios distintos no se ven el intento", async () => {
		await reservarIntentoPendiente(USER, intento());
		expect(leerIntentoPendiente("otro-user", 7)).toBeNull();
	});
});

describe("borrarIntentoPendiente", () => {
	beforeEach(() => {
		montarEntorno();
		montarLocks();
	});

	it("borra cuando el operacionId coincide", async () => {
		await reservarIntentoPendiente(USER, intento());
		await borrarIntentoPendiente(USER, 7, "op-1");
		expect(leerIntentoPendiente(USER, 7)).toBeNull();
	});

	it("una respuesta tardía NO borra el intento que otra pestaña reservó después", async () => {
		// Pestaña A envía op-A y su respuesta se pierde. El usuario recarga,
		// el intento se resuelve por otra vía y la pestaña B reserva op-B.
		// Cuando por fin llega la respuesta tardía de op-A, borrar sin
		// comparar el id dejaría a B sin rastro de una decisión ya enviada.
		await reservarIntentoPendiente(USER, intento({ operacionId: "op-B" }));
		await borrarIntentoPendiente(USER, 7, "op-A");
		expect(leerIntentoPendiente(USER, 7)?.operacionId).toBe("op-B");
	});

	it("sin operacionId borra lo que haya (callers sin id en mano)", async () => {
		await reservarIntentoPendiente(USER, intento({ operacionId: "op-B" }));
		await borrarIntentoPendiente(USER, 7);
		expect(leerIntentoPendiente(USER, 7)).toBeNull();
	});

	it("borrar y reservar concurrentes no dejan el intento a medias", async () => {
		await reservarIntentoPendiente(USER, intento({ operacionId: "op-A" }));

		await Promise.all([
			borrarIntentoPendiente(USER, 7, "op-A"),
			reservarIntentoPendiente(USER, intento({ operacionId: "op-C" })),
		]);

		// El lock serializa: o el borrado corre primero y op-C queda
		// reservado, o corre después y borra solo op-A (no op-C, porque el id
		// no coincide). En ambos órdenes op-C sobrevive.
		expect(leerIntentoPendiente(USER, 7)?.operacionId).toBe("op-C");
	});
});
