import { describe, expect, it } from "bun:test";
import {
	dedupKeyTareaB3,
	dedupKeyVencidaB3,
	type EntradaEstadoTareaB3,
	esIngresoB3,
	estadoPlazoTarea,
	estadoTareaB3,
	fechaVencimientoB3,
	historialIdDeDedupKeyB3,
} from "./b3-llamada";

const gtDay = (d: Date) =>
	new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Guatemala",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(d);

// La subida la sella procesarMoras a las 23:59 GT (= 05:59 UTC del día siguiente).
// Lunes 2025-02-10 23:59 GT.
const SUBIDA_LUN = new Date("2025-02-11T05:59:00.000Z");

describe("esIngresoB3", () => {
	it("SUBIDA a B3 es ingreso", () => {
		expect(esIngresoB3({ tipo_evento: "SUBIDA", bucket_nuevo: 3 })).toBe(true);
	});

	it("SUBIDA a otro bucket no lo es", () => {
		expect(esIngresoB3({ tipo_evento: "SUBIDA", bucket_nuevo: 2 })).toBe(false);
		expect(esIngresoB3({ tipo_evento: "SUBIDA", bucket_nuevo: 4 })).toBe(false);
	});

	it("BAJADA B4→B3 no es ingreso", () => {
		expect(esIngresoB3({ tipo_evento: "BAJADA", bucket_nuevo: 3 })).toBe(false);
	});

	it("INICIAL en B3 no es ingreso", () => {
		expect(esIngresoB3({ tipo_evento: "INICIAL", bucket_nuevo: 3 })).toBe(
			false,
		);
	});
});

describe("fechaVencimientoB3", () => {
	it("subida el lunes noche: cuenta mar+mié+jue y vence el jueves 23:59:59 GT", () => {
		const v = fechaVencimientoB3(SUBIDA_LUN);
		expect(gtDay(v)).toBe("2025-02-13");
		expect(v.toISOString()).toBe("2025-02-14T05:59:59.999Z");
	});

	it("el día de la subida no cuenta aunque sea hábil", () => {
		expect(gtDay(fechaVencimientoB3(SUBIDA_LUN))).not.toBe("2025-02-12");
	});

	it("subida el jueves: el finde sin quincena se salta", () => {
		// jue 2025-02-20 23:59 GT → vie 21, lun 24, mar 25.
		const v = fechaVencimientoB3(new Date("2025-02-21T05:59:00.000Z"));
		expect(gtDay(v)).toBe("2025-02-25");
	});

	it("la quincena en sábado cuenta como hábil", () => {
		// jue 2025-02-13 23:59 GT → vie 14, sáb 15 (quincena), lun 17.
		const v = fechaVencimientoB3(new Date("2025-02-14T05:59:00.000Z"));
		expect(gtDay(v)).toBe("2025-02-17");
	});
});

describe("dedup keys", () => {
	it("la llave de la tarea se puede leer de vuelta", () => {
		expect(historialIdDeDedupKeyB3(dedupKeyTareaB3(4821))).toBe(4821);
	});

	it("ignora llaves de otro formato o nulas", () => {
		expect(historialIdDeDedupKeyB3(null)).toBeNull();
		expect(historialIdDeDedupKeyB3("convenio:1:venc:x")).toBeNull();
		expect(historialIdDeDedupKeyB3("vencida:b3:9")).toBeNull();
	});

	it("la alerta de vencimiento no choca con la llave de la tarea", () => {
		const tarea = dedupKeyTareaB3(7);
		expect(dedupKeyVencidaB3(tarea)).not.toBe(tarea);
	});
});

describe("estadoTareaB3", () => {
	const AHORA = new Date("2025-02-14T14:00:00.000Z"); // vie 08:00 GT
	const base = (
		over: Partial<EntradaEstadoTareaB3> = {},
	): EntradaEstadoTareaB3 => ({
		ahora: AHORA,
		fechaVencimiento: fechaVencimientoB3(SUBIDA_LUN), // jue 23:59:59 GT
		fechaIngreso: SUBIDA_LUN,
		ingresoEsUltimoEvento: true,
		ultimaLlamada: null,
		...over,
	});

	it("vencida: pasó el plazo sin llamada", () => {
		expect(estadoTareaB3(base())).toBe("vencida");
	});

	it("abierta: sigue en plazo", () => {
		expect(
			estadoTareaB3(base({ ahora: new Date("2025-02-12T14:00:00.000Z") })),
		).toBe("abierta");
	});

	it("cumplida: llamada posterior a la subida", () => {
		expect(
			estadoTareaB3(
				base({ ultimaLlamada: new Date("2025-02-12T16:00:00.000Z") }),
			),
		).toBe("cumplida");
	});

	it("cumplida aunque ya venciera el plazo (llamó tarde)", () => {
		expect(
			estadoTareaB3(
				base({ ultimaLlamada: new Date("2025-02-14T13:00:00.000Z") }),
			),
		).toBe("cumplida");
	});

	it("una llamada ANTERIOR a la subida no cumple la tarea", () => {
		expect(
			estadoTareaB3(
				base({ ultimaLlamada: new Date("2025-02-01T16:00:00.000Z") }),
			),
		).toBe("vencida");
	});

	it("obsoleta: hubo otro evento de bucket después del ingreso", () => {
		expect(estadoTareaB3(base({ ingresoEsUltimoEvento: false }))).toBe(
			"obsoleta",
		);
	});

	it("obsoleta: el evento de ingreso salió de la ventana del historial", () => {
		expect(
			estadoTareaB3(base({ fechaIngreso: null, ingresoEsUltimoEvento: null })),
		).toBe("obsoleta");
	});

	it("la llamada gana sobre lo obsoleto (el supervisor sí cumplió)", () => {
		expect(
			estadoTareaB3(
				base({
					ingresoEsUltimoEvento: false,
					ultimaLlamada: new Date("2025-02-12T16:00:00.000Z"),
				}),
			),
		).toBe("cumplida");
	});
});

describe("estadoPlazoTarea", () => {
	// Vence el jueves 2025-02-13 23:59:59.999 GT.
	const VENCE = new Date("2025-02-14T05:59:59.999Z");

	it("días antes del límite: en plazo", () => {
		expect(estadoPlazoTarea(VENCE, new Date("2025-02-12T14:00:00.000Z"))).toBe(
			"en_plazo",
		);
	});

	it("el día límite (cualquier hora): vence hoy", () => {
		expect(estadoPlazoTarea(VENCE, new Date("2025-02-13T12:00:00.000Z"))).toBe(
			"vence_hoy",
		);
		expect(estadoPlazoTarea(VENCE, new Date("2025-02-14T05:59:00.000Z"))).toBe(
			"vence_hoy",
		);
	});

	it("al día siguiente a las 00:00 GT: vencida", () => {
		expect(estadoPlazoTarea(VENCE, new Date("2025-02-14T06:00:00.000Z"))).toBe(
			"vencida",
		);
		expect(estadoPlazoTarea(VENCE, new Date("2025-02-20T14:00:00.000Z"))).toBe(
			"vencida",
		);
	});
});
