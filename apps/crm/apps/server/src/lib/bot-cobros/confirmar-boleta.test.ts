/**
 * La tabla de §4.1 y las reglas que se pueden probar sin base ni red.
 *
 * Lo que NO se prueba acá —la máquina de estados contra Postgres, el `UPDATE`
 * condicional, el orden de las escrituras— necesita base y va en la prueba
 * end-to-end contra la instancia de dev.
 */

import { describe, expect, test } from "bun:test";
import {
	decidirDestino,
	sePuedeReabrir,
} from "../../jobs/bot-cobros-reconciliacion";
import { esRechazoDefinitivo } from "../../services/cartera-back-client";
import { nombreDeBanco } from "./bancos-boleta";
import { armarObservaciones } from "./confirmar-boleta";

/** Una fila de pago viva, con lo mínimo que mira `decidirDestino`. */
function pago(extra: Record<string, unknown> = {}) {
	return {
		pago_id: 48213,
		credito_id: 122330,
		numero_cuota: 8,
		monto_aplicado: "500.00",
		monto_boleta: "500.00",
		validation_status: "pending",
		pagado: false,
		payment_false: false,
		...extra,
	};
}

function reversion(estado: string) {
	return {
		reversion_id: 1,
		pago_id: 48213,
		estado,
		usuario_email: "conta@clubcashin.com",
		motivo: null,
		revertido_en: "2026-08-20T10:00:00.000Z",
	};
}

describe("las cuatro respuestas de la reconciliación (§4.1)", () => {
	test("hay filas vivas: se registró, pero puede estar incompleto", () => {
		const r = decidirDestino({ pagos: [pago()], reversiones: [] });

		// A verificar y NO "confirmada": `insertPayment` no es transaccional, así
		// que encontrar filas prueba que ALGO se escribió, no que se escribió todo.
		expect(r.estado).toBe("confirmada_a_verificar");
	});

	test("nada vivo y una reversión completada: lo rechazaron", () => {
		const r = decidirDestino({
			pagos: [],
			reversiones: [reversion("completada")],
		});

		expect(r.estado).toBe("rechazada");
	});

	// La regla dura de D-36: `iniciada` NO es un rechazo. No se le puede decir a
	// un cliente que su pago se rechazó cuando ni sabemos si se revirtió.
	test("solo una reversión iniciada: nadie decide esto solo", () => {
		const r = decidirDestino({
			pagos: [],
			reversiones: [reversion("iniciada")],
		});

		expect(r.estado).toBe("revision_manual");
	});

	test("nada de nada: no se registró, el cliente puede confirmar de nuevo", () => {
		const r = decidirDestino({ pagos: [], reversiones: [] });

		expect(r.estado).toBe("leida");
		expect(r.motivo).toBe("");
	});

	// Si un intento falló y el reintento salió bien, el mismo pago queda con dos
	// filas. Manda la `completada`: la reversión terminó.
	test("con una completada y una iniciada, manda la completada", () => {
		const r = decidirDestino({
			pagos: [],
			reversiones: [reversion("iniciada"), reversion("completada")],
		});

		expect(r.estado).toBe("rechazada");
	});

	test("una fila anulada no cuenta como pago vivo", () => {
		const r = decidirDestino({
			pagos: [pago({ payment_false: true })],
			reversiones: [reversion("completada")],
		});

		expect(r.estado).toBe("rechazada");
	});
});

// Que el CRM se haya cansado de esperar no cancela nada del lado de cartera:
// `insertPayment` puede estar minutos esperando el advisory lock del crédito y
// va a escribir cuando le toque. Reabrir en esa duda son dos pagos reales.
describe("cuándo se puede reabrir un borrador colgado", () => {
	test("solo con un 'no hay nada en vuelo' explícito", () => {
		expect(sePuedeReabrir(false)).toBe(true);
	});

	test("con una operación en vuelo, no se reabre", () => {
		expect(sePuedeReabrir(true)).toBe(false);
	});

	// Cartera vieja, o no se preguntó. La duda vale lo mismo que un sí.
	test("sin respuesta al respecto, tampoco", () => {
		expect(sePuedeReabrir(null)).toBe(false);
		expect(sePuedeReabrir(undefined)).toBe(false);
	});
});

describe("lo que ve contabilidad en la observación", () => {
	const base = {
		fechaBoleta: "2026-08-18",
		cuentaDestino: "3394002346",
		cuentaEstado: "reconocida" as const,
		numeroAutorizacion: "524075550",
		hoy: "2026-08-20",
	};

	test("siempre dice de dónde vino", () => {
		expect(armarObservaciones(base)).toContain(
			"Boleta cargada por el cliente vía WhatsApp",
		);
	});

	test("una cuenta que no es nuestra se reporta", () => {
		const obs = armarObservaciones({
			...base,
			cuentaDestino: "9999999999",
			cuentaEstado: "no_reconocida",
		});

		expect(obs).toContain("NO coincide");
		expect(obs).toContain("9999999999");
	});

	// §13: "no se pudo verificar" no es "está mal". Anotarlo llenaría las
	// observaciones de ruido que conta tendría que ignorar todos los días.
	test("una cuenta ilegible NO se reporta", () => {
		const obs = armarObservaciones({
			...base,
			cuentaDestino: "123",
			cuentaEstado: "ilegible",
		});

		expect(obs).not.toContain("NO coincide");
	});

	test("una boleta vieja se lo dice a conta", () => {
		const obs = armarObservaciones({ ...base, fechaBoleta: "2026-01-10" });

		expect(obs).toContain("días de antigüedad");
	});

	test("una boleta reciente no dice nada de antigüedad", () => {
		expect(armarObservaciones(base)).not.toContain("antigüedad");
	});

	test("sin autorización se deja constancia, no se calla", () => {
		const obs = armarObservaciones({ ...base, numeroAutorizacion: null });

		expect(obs).toContain("Sin número de autorización");
	});
});

describe("el banco que se le repite al cliente", () => {
	test("sale del catálogo, no de lo que leyó el modelo", () => {
		expect(nombreDeBanco(2)).toBe("Banrural");
	});

	test("un id que no existe da null en vez de un nombre inventado", () => {
		expect(nombreDeBanco(9999)).toBeNull();
		expect(nombreDeBanco(null)).toBeNull();
	});
});

describe("qué respuesta de cartera prueba que el pago no existe", () => {
	// Las validaciones que devuelven 4xx corren antes de la primera escritura.
	test("un 4xx es un no firme: el borrador puede volver a `leida`", () => {
		expect(esRechazoDefinitivo(400)).toBe(true); // schema inválido
		expect(esRechazoDefinitivo(404)).toBe(true); // crédito inexistente
		expect(esRechazoDefinitivo(409)).toBe(true); // boleta duplicada
	});

	// El caso que costaba un pago de más: `insertPayment` no es transaccional y
	// su catch responde 500 después de cualquier excepción, así que el 500 puede
	// llegar con filas ya escritas. Reabrir el borrador ahí crea un segundo pago
	// real.
	test("un 5xx NO prueba nada: se queda en `confirmando`", () => {
		expect(esRechazoDefinitivo(500)).toBe(false);
		expect(esRechazoDefinitivo(502)).toBe(false); // el proxy de Coolify
		expect(esRechazoDefinitivo(503)).toBe(false);
		expect(esRechazoDefinitivo(504)).toBe(false); // timeout del gateway
	});

	// Un 2xx/3xx no llega a este camino, pero si llegara tampoco es un rechazo.
	test("nada por debajo de 400 es un rechazo", () => {
		expect(esRechazoDefinitivo(200)).toBe(false);
		expect(esRechazoDefinitivo(302)).toBe(false);
	});

	// No es un rango de 400 a 499: un intermediario puede cortar con 408 o 499
	// DESPUÉS de haber despachado el request, y cartera escribir el pago igual.
	test("un 4xx que cartera no emite tampoco prueba nada", () => {
		expect(esRechazoDefinitivo(408)).toBe(false); // timeout de un proxy
		expect(esRechazoDefinitivo(499)).toBe(false); // el cliente cortó
		expect(esRechazoDefinitivo(429)).toBe(false); // rate limit del borde
		expect(esRechazoDefinitivo(413)).toBe(false);
	});
});

describe("un vacío no siempre significa que no hay pago", () => {
	// El hueco concreto: `insertPayment` escribe `pagos_credito` y después
	// `boletas`. Si revienta en el medio, el pago existe y su URL no, así que
	// buscar por r2_key devuelve vacío sobre un pago que SÍ está.
	test("con un pago del bot sin boleta, no se reabre: va a revisión manual", () => {
		expect(
			decidirDestino({
				pagos: [],
				reversiones: [],
				huerfanos: [pago({ pago_id: 91111 })],
			}).estado,
		).toBe("revision_manual");
	});

	test("el motivo nombra el pago, para que quien lo revise sepa cuál mirar", () => {
		expect(
			decidirDestino({
				pagos: [],
				reversiones: [],
				huerfanos: [pago({ pago_id: 91111 })],
			}).motivo,
		).toContain("91111");
	});

	// Una fila anulada no es un pago vivo: no puede bloquear el reintento.
	test("un huérfano marcado falso no cuenta", () => {
		expect(
			decidirDestino({
				pagos: [],
				reversiones: [],
				huerfanos: [pago({ payment_false: true })],
			}).estado,
		).toBe("leida");
	});

	// Contra una instancia de cartera que todavía no manda el campo, el
	// comportamiento no cambia: lo que frena ahí es `operacion_en_curso`.
	test("sin el campo, se sigue decidiendo como antes", () => {
		expect(decidirDestino({ pagos: [], reversiones: [] }).estado).toBe("leida");
	});
});
