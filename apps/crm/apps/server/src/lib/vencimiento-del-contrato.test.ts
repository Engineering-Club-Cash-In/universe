import { describe, expect, test } from "bun:test";
import {
	conVencimientoDelContrato,
	snapshotDeLaMismaGeneracion,
	vencimientoDelSnapshot,
	vencimientoGuardado,
} from "./vencimiento-del-contrato";

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

describe("vencimientoDelSnapshot con varias entradas", () => {
	test("prefiere la del reconocimiento de deuda", () => {
		expect(
			vencimientoDelSnapshot([
				{
					contractType: "garantia_mobiliaria",
					data: {
						diaVencimiento: "30",
						mesVencimiento: "07",
						anoVencimiento: "29",
					},
				},
				conFecha("31", "08", "29"),
			]),
		).toBe("2029-08-31");
	});
});

describe("vencimientoGuardado", () => {
	test("lee el que se guarda al enlazar o regenerar", () => {
		expect(
			vencimientoGuardado({ data: [], vencimientoDelContrato: "2029-08-31" }),
		).toBe("2029-08-31");
	});

	test("lee los campos de los contratos de la época de Documenso", () => {
		expect(
			vencimientoGuardado({
				data: [
					{
						role: "SIGNER",
						values: [
							{ field: "diaVencimiento", value: "15" },
							{ field: "mesVencimiento", value: "10" },
							{ field: "anoVencimiento", value: "31" },
						],
					},
				],
			}),
		).toBe("2031-10-15");
	});

	test("sin fecha devuelve null", () => {
		expect(vencimientoGuardado({ data: [] })).toBeNull();
		expect(vencimientoGuardado(null)).toBeNull();
		expect(
			vencimientoGuardado({ vencimientoDelContrato: "31/08/2029" }),
		).toBeNull();
	});
});

describe("conVencimientoDelContrato", () => {
	test("agrega la fecha con que se generó", () => {
		expect(
			conVencimientoDelContrato(
				{ success: true },
				{ diaVencimiento: "31", mesVencimiento: "08", anoVencimiento: "29" },
			),
		).toEqual({ success: true, vencimientoDelContrato: "2029-08-31" });
	});

	test("sin fecha o sin respuesta deja todo como estaba", () => {
		const respuesta = { success: true };
		expect(conVencimientoDelContrato(respuesta, { nombre: "X" })).toBe(
			respuesta,
		);
		expect(
			conVencimientoDelContrato(undefined, {
				diaVencimiento: "31",
				mesVencimiento: "08",
				anoVencimiento: "29",
			}),
		).toBeUndefined();
	});
});

describe("snapshotDeLaMismaGeneracion", () => {
	const contrato = new Date("2026-07-30T22:31:18Z");
	const a = (iso: string) => ({ createdAt: new Date(iso) });

	test("acepta el de minutos antes (PDF de esa generación subido aparte)", () => {
		expect(
			snapshotDeLaMismaGeneracion(contrato, [a("2026-07-30T22:27:05Z")]),
		).toEqual(a("2026-07-30T22:27:05Z"));
	});

	test("no acepta uno de horas o días antes", () => {
		expect(
			snapshotDeLaMismaGeneracion(contrato, [a("2026-07-29T10:00:00Z")]),
		).toBeUndefined();
	});

	test("no acepta uno de una generación posterior", () => {
		expect(
			snapshotDeLaMismaGeneracion(contrato, [a("2026-07-31T09:00:00Z")]),
		).toBeUndefined();
	});

	test("de los que entran, el más nuevo", () => {
		expect(
			snapshotDeLaMismaGeneracion(contrato, [
				a("2026-07-31T09:00:00Z"),
				a("2026-07-30T22:35:00Z"),
				a("2026-07-30T22:00:00Z"),
			]),
		).toEqual(a("2026-07-30T22:35:00Z"));
	});
});
