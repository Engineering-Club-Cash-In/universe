/**
 * Las reglas del circuito de vuelta que se pueden probar sin base ni red.
 *
 * Son dos, y las dos deciden **qué se le dice a un cliente sobre su plata**:
 * cómo se traduce lo que cartera sabe del pago, y qué desenlace tiene una
 * boleta cuando sus pagos no dijeron todos lo mismo.
 */

import { describe, expect, test } from "bun:test";
import { eventoSegunCartera } from "../../jobs/bot-cobros-respaldo";
import type {
	EstadoPagoCartera,
	ReversionCartera,
} from "../../types/cartera-back";
import { desenlaceDeLaBoleta, type EventoPago } from "./eventos-pago";

function pago(extra: Partial<EstadoPagoCartera> = {}): EstadoPagoCartera {
	return {
		pago_id: 48213,
		credito_id: 122330,
		numero_cuota: 8,
		monto_aplicado: "500.00",
		monto_boleta: "500.00",
		validation_status: "pending",
		pagado: false,
		payment_false: false,
		reversion: null,
		...extra,
	};
}

function reversion(estado: string): ReversionCartera {
	return {
		reversion_id: 1,
		pago_id: 48213,
		estado,
		usuario_email: "conta@clubcashin.com",
		motivo: null,
		revertido_en: "2026-08-20T10:00:00.000Z",
	};
}

describe("cómo se lee lo que cartera sabe del pago (§6)", () => {
	test("validated es un pago acreditado", () => {
		expect(
			eventoSegunCartera(pago({ validation_status: "validated" }))?.evento,
		).toBe("validado");
	});

	test("capital_validated también", () => {
		expect(
			eventoSegunCartera(pago({ validation_status: "capital_validated" }))
				?.evento,
		).toBe("validado");
	});

	test("pending todavía no es nada: no se le escribe al cliente", () => {
		expect(
			eventoSegunCartera(pago({ validation_status: "pending" })),
		).toBeNull();
	});

	test("paymentFalse es marcado falso", () => {
		expect(eventoSegunCartera(pago({ payment_false: true }))?.evento).toBe(
			"marcado_falso",
		);
	});

	// ⚠️ El caso que hace falta este endpoint: `reversePayment` deja el pago en
	// `no_required`, que es un estado "aplicado". Sin mirar la reversión, un pago
	// revertido se leería como validado y el cliente recibiría "tu pago fue
	// acreditado" justo después de que se lo rechazaron.
	test("una reversión completada manda sobre el validation_status", () => {
		const resultado = eventoSegunCartera(
			pago({
				validation_status: "no_required",
				reversion: reversion("completada"),
			}),
		);

		expect(resultado?.evento).toBe("revertido");
		expect(resultado?.ocurridoEn).toBe("2026-08-20T10:00:00.000Z");
	});

	// D-36: no se le puede decir a un cliente que su pago se rechazó cuando ni
	// siquiera sabemos si se revirtió.
	test("una reversión iniciada NO es un rechazo: no produce evento", () => {
		expect(
			eventoSegunCartera(
				pago({
					validation_status: "no_required",
					reversion: reversion("iniciada"),
				}),
			),
		).toBeNull();
	});

	test("un pago que desapareció sin reversión no se interpreta", () => {
		expect(eventoSegunCartera(undefined)).toBeNull();
	});

	// La fila se borró (parcial con hermanos), pero el acta quedó.
	test("un pago borrado con su reversión aparte sí se interpreta", () => {
		expect(eventoSegunCartera(undefined, reversion("completada"))?.evento).toBe(
			"revertido",
		);
	});
});

describe("el desenlace de la boleta, no el de cada pago (§6)", () => {
	test("todos validados: se le dice que se acreditó", () => {
		expect(desenlaceDeLaBoleta(["validado", "validado", "validado"])).toBe(
			"validado",
		);
	});

	// La regla que importa: conta valida dos cuotas y revierte la tercera.
	// Decirle "acreditado" a alguien al que le rechazaron parte es peor que
	// no decirle nada.
	test("basta UNO revertido para que el conjunto sea un rechazo", () => {
		expect(desenlaceDeLaBoleta(["validado", "validado", "revertido"])).toBe(
			"rechazado",
		);
	});

	test("un marcado falso también arrastra al conjunto", () => {
		expect(desenlaceDeLaBoleta(["validado", "marcado_falso"])).toBe(
			"rechazado",
		);
	});

	test("con algo sin resolver todavía, no hay desenlace", () => {
		expect(desenlaceDeLaBoleta(["validado", "regresado_a_pendiente"])).toBe(
			"incompleto",
		);
	});

	test("sin eventos no se inventa nada", () => {
		expect(desenlaceDeLaBoleta([])).toBe("incompleto");
	});

	// ─────────────────────────────────────────────────────────────────────────
	// El mismo estado final NO puede producir dos comunicaciones distintas.
	//
	// Los eventos de una boleta con varios pagos llegan por webhooks separados y
	// el orden no está garantizado. Antes esto sí cambiaba lo que recibía el
	// cliente: `marcado_falso` cortaba el flujo, así que si llegaba último no se
	// le decía nada, y si llegaba antes de un `validado` el conjunto se resolvía
	// como rechazo y sí le llegaba el mensaje.
	// ─────────────────────────────────────────────────────────────────────────
	test("el orden en que lleguen los eventos no cambia el desenlace", () => {
		const combinaciones: EventoPago[][] = [
			["marcado_falso", "validado"],
			["validado", "marcado_falso"],
			["revertido", "validado", "validado"],
			["validado", "revertido", "validado"],
			["validado", "validado", "revertido"],
		];

		for (const eventos of combinaciones) {
			expect(desenlaceDeLaBoleta(eventos)).toBe("rechazado");
		}
	});

	test("un solo pago marcado falso también es rechazo del conjunto", () => {
		expect(desenlaceDeLaBoleta(["marcado_falso"])).toBe("rechazado");
	});
});

describe("una reversión vieja no pisa una revalidación (§6)", () => {
	const conReversion = (validation_status: string) =>
		({
			pago_id: 48213,
			credito_id: 122330,
			numero_cuota: 8,
			monto_aplicado: "500.00",
			monto_boleta: "500.00",
			validation_status,
			pagado: true,
			payment_false: false,
			reversion: {
				reversion_id: 3,
				pago_id: 48213,
				estado: "completada",
				usuario_email: "conta@clubcashin.com",
				motivo: null,
				revertido_en: "2026-08-01T10:00:00.000Z",
			},
		}) as Parameters<typeof eventoSegunCartera>[0];

	// reversePayment resetea a no_required: si hoy está validated es porque
	// alguien REVALIDÓ después. Ese es el estado vigente, no la reversión.
	test("validated con reversión completada es validado, no revertido", () => {
		expect(eventoSegunCartera(conReversion("validated"))?.evento).toBe(
			"validado",
		);
	});

	test("no_required con reversión completada sigue siendo revertido", () => {
		expect(eventoSegunCartera(conReversion("no_required"))?.evento).toBe(
			"revertido",
		);
	});
});

describe("pending puede ser una transición (§6)", () => {
	const pendiente = {
		pago_id: 48213,
		credito_id: 122330,
		numero_cuota: 8,
		monto_aplicado: "500.00",
		monto_boleta: "500.00",
		validation_status: "pending",
		pagado: false,
		payment_false: false,
	} as Parameters<typeof eventoSegunCartera>[0];

	// Lo último que supimos fue "validado" y ahora está pending: ese es el
	// webhook de revertPaymentToPending que se perdió.
	test("pending después de validado es regresado_a_pendiente", () => {
		expect(eventoSegunCartera(pendiente, null, "validado")?.evento).toBe(
			"regresado_a_pendiente",
		);
	});

	test("pending sin historia sigue siendo silencio", () => {
		expect(eventoSegunCartera(pendiente)).toBeNull();
		expect(eventoSegunCartera(pendiente, null, undefined)).toBeNull();
	});

	// Ya sabíamos que estaba pendiente: no hay transición que contar.
	test("pending después de regresado_a_pendiente no re-emite", () => {
		expect(
			eventoSegunCartera(pendiente, null, "regresado_a_pendiente"),
		).toBeNull();
	});
});
