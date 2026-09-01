import { describe, expect, test } from "bun:test";
import {
	MINUTOS_PRIMERA_REVISION,
	primeraRevisionPoll,
	proximoIntentoPoll,
} from "./pagalo-poll-cadencia";

const ahora = new Date("2026-09-01T12:00:00.000Z");
const minutosDesdeAhora = (d: Date) =>
	Math.round((d.getTime() - ahora.getTime()) / 60_000);

describe("cadencia del poll de Págalo", () => {
	test("la primera revisión espera 5 minutos, no es inmediata", () => {
		// Preguntar al segundo de crear el link gasta una llamada garantizada a
		// fallar y además arranca el backoff antes de tiempo.
		expect(MINUTOS_PRIMERA_REVISION).toBe(5);
		expect(minutosDesdeAhora(primeraRevisionPoll(ahora))).toBe(5);
	});

	test("el backoff sube 5 → 10 → 15 y ahí se queda", () => {
		expect(minutosDesdeAhora(proximoIntentoPoll(1, ahora))).toBe(5);
		expect(minutosDesdeAhora(proximoIntentoPoll(2, ahora))).toBe(10);
		expect(minutosDesdeAhora(proximoIntentoPoll(3, ahora))).toBe(15);
	});

	test("nunca pasa de 15 minutos por más intentos que lleve", () => {
		for (const intentos of [4, 5, 10, 50]) {
			expect(minutosDesdeAhora(proximoIntentoPoll(intentos, ahora))).toBe(15);
		}
	});
});
