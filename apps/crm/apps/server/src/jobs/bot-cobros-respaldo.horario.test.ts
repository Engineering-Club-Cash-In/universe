/**
 * La cadencia del respaldo de rechazos no puede depender de a qué hora se
 * desplegó: con `setInterval` cada 3 h y una ventana de 08:00–17:00, un
 * arranque a las 15:01 GT dispara 18:01, 21:01, 00:01… y no vuelve a caer
 * dentro de la ventana hasta las 09:01 del día siguiente (hallazgo Codex).
 */
import { describe, expect, test } from "bun:test";
import {
	enVentanaDeRespaldo,
	msHastaProximoRespaldo,
} from "./bot-cobros-respaldo";

/** Construye un instante a partir de una hora de Guatemala (UTC-6, sin DST). */
const enGT = (hora: number, minuto = 0) =>
	new Date(Date.UTC(2026, 8, 1, hora + 6, minuto, 0, 0));

const horaGTdeAhoraMas = (desde: Date, ms: number) => {
	const d = new Date(desde.getTime() + ms);
	return { hora: (d.getUTCHours() + 18) % 24, minuto: d.getUTCMinutes() };
};

describe("cadencia del respaldo de rechazos", () => {
	test("desde media mañana cae en la siguiente hora de la lista", () => {
		const ahora = enGT(9, 30);
		expect(horaGTdeAhoraMas(ahora, msHastaProximoRespaldo(ahora))).toEqual({
			hora: 11,
			minuto: 0,
		});
	});

	test("el caso que rompía: arranque a las 15:01 barre a las 17:00, no al día siguiente", () => {
		const ahora = enGT(15, 1);
		const proxima = horaGTdeAhoraMas(ahora, msHastaProximoRespaldo(ahora));
		expect(proxima).toEqual({ hora: 17, minuto: 0 });
		// Menos de dos horas, no dieciocho.
		expect(msHastaProximoRespaldo(ahora)).toBeLessThan(2 * 60 * 60 * 1000);
	});

	test("después de la última hora salta a las 08:00 del día siguiente", () => {
		const ahora = enGT(17, 30);
		const ms = msHastaProximoRespaldo(ahora);
		expect(horaGTdeAhoraMas(ahora, ms)).toEqual({ hora: 8, minuto: 0 });
		expect(ms).toBeGreaterThan(14 * 60 * 60 * 1000);
	});

	test("de madrugada espera a las 08:00 del mismo día, no del siguiente", () => {
		const ahora = enGT(3, 0);
		const ms = msHastaProximoRespaldo(ahora);
		expect(horaGTdeAhoraMas(ahora, ms)).toEqual({ hora: 8, minuto: 0 });
		expect(ms).toBe(5 * 60 * 60 * 1000);
	});

	test("justo en una hora de la lista no se queda en cero: va a la siguiente", () => {
		const ahora = enGT(11, 0);
		expect(horaGTdeAhoraMas(ahora, msHastaProximoRespaldo(ahora))).toEqual({
			hora: 14,
			minuto: 0,
		});
	});
});

/**
 * La corrida de arranque decide con la hora del ARRANQUE, no con la de 35 s
 * después: si no, un deploy a las 17:59:40 —dentro de la ventana— evaluaría
 * las 18:00:15 y se saltaría el barrido, dejando los avisos fallidos para las
 * 08:00 del día siguiente (hallazgo Codex).
 */
describe("ventana de la corrida de arranque", () => {
	const RETRASO_MS = 35_000;

	test("el borde que rompía: arranque 17:59:40 está dentro, aunque el callback caiga en las 18:00", () => {
		const arranque = new Date(enGT(17, 59).getTime() + 40_000);
		expect(enVentanaDeRespaldo(arranque)).toBe(true);
		// Y la prueba de que el retraso es lo que importaba: preguntando tarde
		// daba lo contrario.
		expect(enVentanaDeRespaldo(new Date(arranque.getTime() + RETRASO_MS))).toBe(
			false,
		);
	});

	test("17:59 sigue siendo la ventana: la última hora de la lista cuenta entera", () => {
		expect(enVentanaDeRespaldo(enGT(17, 59))).toBe(true);
	});

	test("las horas laborales están dentro", () => {
		for (const hora of [8, 11, 14, 17]) {
			expect(enVentanaDeRespaldo(enGT(hora))).toBe(true);
		}
	});

	test("fuera de horario no barre al arrancar", () => {
		for (const hora of [0, 3, 7, 18, 21, 23]) {
			expect(enVentanaDeRespaldo(enGT(hora))).toBe(false);
		}
	});

	test("07:59:40 no entra, aunque 35 s después ya sean las 08:00", () => {
		// El espejo del caso de arriba: acá evaluar tarde habría barrido de más.
		// Es inofensivo, pero la regla es la misma — manda la hora del arranque.
		const arranque = new Date(enGT(7, 59).getTime() + 40_000);
		expect(enVentanaDeRespaldo(arranque)).toBe(false);
		expect(enVentanaDeRespaldo(new Date(arranque.getTime() + RETRASO_MS))).toBe(
			true,
		);
	});
});
