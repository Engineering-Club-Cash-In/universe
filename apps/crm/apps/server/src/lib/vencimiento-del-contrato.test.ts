import { describe, expect, test } from "bun:test";
import { vencimientoDelSnapshot } from "./vencimiento-del-contrato";

const conFecha = (dia: string, mes: string, ano: string) => ({
	contractType: "reconocimiento_deuda_feb_2025",
	data: { diaVencimiento: dia, mesVencimiento: mes, anoVencimiento: ano },
});

describe("vencimientoDelSnapshot", () => {
	test("arma la fecha del contrato con el año de dos cifras", () => {
		expect(vencimientoDelSnapshot([conFecha("31", "08", "29")])).toBe(
			"2029-08-31",
		);
	});

	test("acepta el año con cuatro cifras", () => {
		expect(vencimientoDelSnapshot([conFecha("15", "10", "2031")])).toBe(
			"2031-10-15",
		);
	});

	test("salta las entradas sin fecha y usa la primera que la tiene", () => {
		expect(
			vencimientoDelSnapshot([
				{ contractType: "declaracion_vendedor", data: { nombre: "X" } },
				conFecha("15", "04", "30"),
			]),
		).toBe("2030-04-15");
	});

	test("una fecha que no existe no se usa", () => {
		expect(vencimientoDelSnapshot([conFecha("31", "02", "29")])).toBeNull();
	});

	test("sin datos devuelve null y se queda lo de cartera", () => {
		expect(vencimientoDelSnapshot([])).toBeNull();
		expect(vencimientoDelSnapshot(null)).toBeNull();
		expect(vencimientoDelSnapshot([conFecha("", "08", "29")])).toBeNull();
	});
});
