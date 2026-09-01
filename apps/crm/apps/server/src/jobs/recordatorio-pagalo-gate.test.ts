/**
 * El recordatorio de Págalo le escribe al CLIENTE. El despliegue documentado
 * de esta rama va con `TEST_MESSAGE=false` contra una copia de producción, así
 * que un `true` fijo le mandaría links de pago a clientes reales cada 3 horas
 * (hallazgo Codex). La compuerta tiene que FALLAR CERRADA.
 */
import { describe, expect, test } from "bun:test";
import { isTestModeEnabled } from "../lib/messaging-test-mode";

const conTestMessage = <T>(valor: string | undefined, fn: () => T): T => {
	const previo = process.env.TEST_MESSAGE;
	if (valor === undefined) delete process.env.TEST_MESSAGE;
	else process.env.TEST_MESSAGE = valor;
	try {
		return fn();
	} finally {
		if (previo === undefined) delete process.env.TEST_MESSAGE;
		else process.env.TEST_MESSAGE = previo;
	}
};

describe("compuerta del recordatorio de Págalo", () => {
	test("solo se prende con el modo prueba activo", () => {
		expect(conTestMessage("true", isTestModeEnabled)).toBe(true);
	});

	test("con TEST_MESSAGE=false queda apagado (el despliegue documentado)", () => {
		expect(conTestMessage("false", isTestModeEnabled)).toBe(false);
	});

	test("falla cerrado: sin la env, apagado", () => {
		expect(conTestMessage(undefined, isTestModeEnabled)).toBe(false);
	});

	test("falla cerrado ante un valor raro, no lo interpreta como permiso", () => {
		// El helper acepta "true" y "1"; cualquier otra cosa apaga el job.
		for (const valor of ["", "yes", "TRUE", "true ", "si", "0"]) {
			expect(conTestMessage(valor, isTestModeEnabled)).toBe(false);
		}
		expect(conTestMessage("1", isTestModeEnabled)).toBe(true);
	});
});
