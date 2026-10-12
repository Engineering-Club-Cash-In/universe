import { describe, expect, test } from "bun:test";
import { gtDateStrToDate } from "./guatemala-month-window";
import {
	diasHabilesSinContacto,
	estaSinContacto,
	inicioVentanaConContacto,
} from "./sin-contacto";

// 2026-10-12 es lunes.
const gt = (fecha: string, hora = "10:00:00") =>
	new Date(`${fecha}T${hora}-06:00`);

describe("sin-contacto", () => {
	test("cuenta días hábiles completos desde el día siguiente a la gestión", () => {
		// Gestión el lunes 5; hoy jueves 8: martes y miércoles completos = 2.
		expect(diasHabilesSinContacto(gt("2026-10-05"), gt("2026-10-08"))).toBe(2);
		// Hoy viernes 9: martes, miércoles y jueves = 3.
		expect(diasHabilesSinContacto(gt("2026-10-05"), gt("2026-10-09"))).toBe(3);
	});

	test("el fin de semana no cuenta, salvo quincena y fin de mes", () => {
		// Gestión viernes 9; hoy lunes 12: sáb y dom no cuentan = 0.
		expect(diasHabilesSinContacto(gt("2026-10-09"), gt("2026-10-12"))).toBe(0);
		// Gestión viernes 9; hoy jueves 15 (quincena): lun, mar, mié = 3.
		expect(diasHabilesSinContacto(gt("2026-10-09"), gt("2026-10-15"))).toBe(3);
	});

	test("la gestión de hoy no suma días", () => {
		expect(
			diasHabilesSinContacto(gt("2026-10-12"), gt("2026-10-12", "18:00:00")),
		).toBe(0);
	});

	test("estaSinContacto: null no califica y 3 sí", () => {
		expect(estaSinContacto(null)).toBe(false);
		expect(estaSinContacto(2)).toBe(false);
		expect(estaSinContacto(3)).toBe(true);
	});

	test("la ventana reciente coincide con el conteo de días", () => {
		const ahora = gt("2026-10-12");
		const inicio = inicioVentanaConContacto(ahora);
		// Lunes 12: ayer dom no cuenta; sáb no; vie 9, jue 8, mié 7 = 3 hábiles.
		// Una gestión del miércoles 7 todavía es reciente (2 completos); la del
		// martes 6 ya lleva 3.
		expect(inicio.getTime()).toBe(gtDateStrToDate("2026-10-07").getTime());
		expect(diasHabilesSinContacto(gt("2026-10-07", "23:00:00"), ahora)).toBe(2);
		expect(diasHabilesSinContacto(gt("2026-10-06", "23:00:00"), ahora)).toBe(3);
	});
});
