/**
 * El recordatorio de pago no puede sonar de madrugada.
 *
 * Corría con `setInterval(..., 3h)` sin ventana horaria: la cadencia quedaba
 * con la fase del arranque y seguía disparando toda la noche. Caso real del
 * 2026-09-02: recordatorios a las 00:00 y a las 02:40 GT.
 */
import { describe, expect, test } from "bun:test";
import {
	HORAS_GT_RECORDATORIO,
	msHastaProximoRecordatorio,
} from "./pagalo-reminder";

/** Construye un instante a partir de una hora de Guatemala (UTC-6, sin DST). */
const enGT = (hora: number, minuto = 0) =>
	new Date(Date.UTC(2026, 8, 2, hora + 6, minuto, 0, 0));

const horaGTdeAhoraMas = (desde: Date, ms: number) => {
	const d = new Date(desde.getTime() + ms);
	return { hora: (d.getUTCHours() + 18) % 24, minuto: d.getUTCMinutes() };
};

describe("cadencia del recordatorio de Págalo", () => {
	test("el caso que rompía: arranque a medianoche NO recuerda a las 02:40", () => {
		const ahora = enGT(0, 0);
		const proxima = horaGTdeAhoraMas(ahora, msHastaProximoRecordatorio(ahora));
		expect(proxima).toEqual({ hora: 9, minuto: 0 });
	});

	test("ninguna hora de la lista cae de madrugada", () => {
		for (const hora of HORAS_GT_RECORDATORIO) {
			expect(hora).toBeGreaterThanOrEqual(8);
			expect(hora).toBeLessThanOrEqual(18);
		}
	});

	test("desde media mañana cae en la siguiente hora de la lista", () => {
		const ahora = enGT(10, 30);
		expect(horaGTdeAhoraMas(ahora, msHastaProximoRecordatorio(ahora))).toEqual({
			hora: 12,
			minuto: 0,
		});
	});

	test("después de la última salta a las 09:00 del día siguiente, no a las 21:00", () => {
		const ahora = enGT(18, 30);
		const ms = msHastaProximoRecordatorio(ahora);
		expect(horaGTdeAhoraMas(ahora, ms)).toEqual({ hora: 9, minuto: 0 });
		expect(ms).toBeGreaterThan(14 * 60 * 60 * 1000);
	});

	test("de madrugada espera a las 09:00, no dispara enseguida", () => {
		const ahora = enGT(2, 40);
		const ms = msHastaProximoRecordatorio(ahora);
		expect(horaGTdeAhoraMas(ahora, ms)).toEqual({ hora: 9, minuto: 0 });
		expect(ms).toBe((6 * 60 + 20) * 60 * 1000);
	});

	test("justo en una hora de la lista no se queda en cero: va a la siguiente", () => {
		const ahora = enGT(12, 0);
		expect(horaGTdeAhoraMas(ahora, msHastaProximoRecordatorio(ahora))).toEqual({
			hora: 15,
			minuto: 0,
		});
	});
});
