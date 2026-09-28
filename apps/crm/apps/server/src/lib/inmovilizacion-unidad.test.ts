import { describe, expect, it } from "bun:test";
import {
	BUCKETS_INMOVILIZACION,
	estadoUnidad,
	puedeSolicitar,
	siguienteEstado,
	transicionValida,
} from "./inmovilizacion-unidad";

describe("transicionValida / siguienteEstado", () => {
	it("pendiente_aprobacion acepta aprobar, rechazar y cancelar", () => {
		expect(transicionValida("pendiente_aprobacion", "aprobar")).toBe(true);
		expect(transicionValida("pendiente_aprobacion", "rechazar")).toBe(true);
		expect(transicionValida("pendiente_aprobacion", "cancelar")).toBe(true);
		expect(siguienteEstado("pendiente_aprobacion", "aprobar")).toBe("aprobada");
		expect(siguienteEstado("pendiente_aprobacion", "rechazar")).toBe(
			"rechazada",
		);
		expect(siguienteEstado("pendiente_aprobacion", "cancelar")).toBe(
			"cancelada",
		);
	});

	it("pendiente_aprobacion NO acepta marcar_ejecutada", () => {
		expect(transicionValida("pendiente_aprobacion", "marcar_ejecutada")).toBe(
			false,
		);
		expect(siguienteEstado("pendiente_aprobacion", "marcar_ejecutada")).toBe(
			null,
		);
	});

	it("aprobada solo acepta marcar_ejecutada", () => {
		expect(transicionValida("aprobada", "marcar_ejecutada")).toBe(true);
		expect(siguienteEstado("aprobada", "marcar_ejecutada")).toBe("ejecutada");
		expect(transicionValida("aprobada", "aprobar")).toBe(false);
		expect(transicionValida("aprobada", "rechazar")).toBe(false);
		expect(transicionValida("aprobada", "cancelar")).toBe(false);
	});

	it("rechazada, ejecutada y cancelada son estados terminales", () => {
		for (const estado of ["rechazada", "ejecutada", "cancelada"] as const) {
			for (const evento of [
				"aprobar",
				"rechazar",
				"marcar_ejecutada",
				"cancelar",
			] as const) {
				expect(transicionValida(estado, evento)).toBe(false);
			}
		}
	});
});

describe("estadoUnidad", () => {
	it("sin historial ejecutado, la unidad está activa", () => {
		expect(estadoUnidad([])).toBe("activa");
		expect(
			estadoUnidad([
				{
					accion: "apagado",
					estado: "pendiente_aprobacion",
					ejecutadoAt: null,
				},
				{ accion: "apagado", estado: "rechazada", ejecutadoAt: null },
			]),
		).toBe("activa");
	});

	it("último ejecutado es apagado → inmovilizada", () => {
		expect(
			estadoUnidad([
				{
					accion: "apagado",
					estado: "ejecutada",
					ejecutadoAt: new Date("2026-01-01"),
				},
			]),
		).toBe("inmovilizada");
	});

	it("último ejecutado es reactivacion → activa", () => {
		expect(
			estadoUnidad([
				{
					accion: "apagado",
					estado: "ejecutada",
					ejecutadoAt: new Date("2026-01-01"),
				},
				{
					accion: "reactivacion",
					estado: "ejecutada",
					ejecutadoAt: new Date("2026-01-05"),
				},
			]),
		).toBe("activa");
	});

	it("usa ejecutadoAt real, no el orden del arreglo", () => {
		// La reactivación es CRONOLÓGICAMENTE más vieja aunque venga después en
		// el arreglo — no debe confundirse con la más reciente.
		expect(
			estadoUnidad([
				{
					accion: "reactivacion",
					estado: "ejecutada",
					ejecutadoAt: new Date("2026-01-01"),
				},
				{
					accion: "apagado",
					estado: "ejecutada",
					ejecutadoAt: new Date("2026-01-10"),
				},
			]),
		).toBe("inmovilizada");
	});

	it("ignora filas no ejecutadas al calcular la última", () => {
		expect(
			estadoUnidad([
				{
					accion: "apagado",
					estado: "ejecutada",
					ejecutadoAt: new Date("2026-01-01"),
				},
				{
					accion: "reactivacion",
					estado: "pendiente_aprobacion",
					ejecutadoAt: null,
				},
			]),
		).toBe("inmovilizada");
	});
});

describe("puedeSolicitar", () => {
	it("apagado requiere unidad activa y bucket habilitado", () => {
		expect(puedeSolicitar("apagado", "activa", 2)).toBe(true);
		expect(puedeSolicitar("apagado", "activa", 3)).toBe(true);
		expect(puedeSolicitar("apagado", "inmovilizada", 2)).toBe(false);
	});

	it("reactivacion requiere unidad inmovilizada", () => {
		expect(puedeSolicitar("reactivacion", "inmovilizada", 2)).toBe(true);
		expect(puedeSolicitar("reactivacion", "activa", 2)).toBe(false);
	});

	it("reactivacion NO depende del bucket: el cliente que pagó bajó a B0/B1 o salió del funnel", () => {
		expect(puedeSolicitar("reactivacion", "inmovilizada", 0)).toBe(true);
		expect(puedeSolicitar("reactivacion", "inmovilizada", 1)).toBe(true);
		expect(puedeSolicitar("reactivacion", "inmovilizada", null)).toBe(true);
		expect(puedeSolicitar("reactivacion", "inmovilizada", undefined)).toBe(
			true,
		);
	});

	it("bucket fuera de BUCKETS_INMOVILIZACION rechaza, aun con estado correcto", () => {
		expect(puedeSolicitar("apagado", "activa", 1)).toBe(false);
		expect(puedeSolicitar("apagado", "activa", 4)).toBe(false);
	});

	it("bucket null o undefined rechaza (fail closed)", () => {
		expect(puedeSolicitar("apagado", "activa", null)).toBe(false);
		expect(puedeSolicitar("apagado", "activa", undefined)).toBe(false);
	});

	it("BUCKETS_INMOVILIZACION es exactamente [2, 3] en CB-041", () => {
		expect(BUCKETS_INMOVILIZACION).toEqual([2, 3]);
	});
});
