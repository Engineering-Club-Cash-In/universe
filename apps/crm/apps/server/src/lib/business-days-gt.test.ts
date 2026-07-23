import { describe, expect, it } from "bun:test";
import {
	contarDiasHabilesGT,
	esDiaHabilGT,
	siguienteDiaGT,
} from "./business-days-gt";

const gtDay = (d: Date) =>
	new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Guatemala",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(d);

// Fechas ancla (verificadas): 2025-01-01 = miércoles.
//   2025-02-01 = sábado; por tanto 2025-02-15 = sábado (quincena en finde).
//   2025-05-31 = sábado (fin de mes en finde).
// Se usa mediodía UTC ("...T12:00:00Z") = 6am GT → mismo día calendario GT.
const gt = (isoDay: string) => new Date(`${isoDay}T12:00:00Z`);

describe("esDiaHabilGT", () => {
	it("Lun–Vie son hábiles", () => {
		expect(esDiaHabilGT(gt("2025-02-10"))).toBe(true); // lunes
		expect(esDiaHabilGT(gt("2025-02-14"))).toBe(true); // viernes
	});

	it("sábado/domingo normales NO son hábiles", () => {
		expect(esDiaHabilGT(gt("2025-02-08"))).toBe(false); // sábado, día 8
		expect(esDiaHabilGT(gt("2025-02-09"))).toBe(false); // domingo, día 9
	});

	it("regla de oro: quincena (15) en fin de semana SÍ es hábil", () => {
		const d = gt("2025-02-15");
		expect(d.getUTCDay()).toBe(6); // sábado (auto-documenta la fecha)
		expect(esDiaHabilGT(d)).toBe(true);
	});

	it("regla de oro: fin de mes en fin de semana SÍ es hábil", () => {
		const d = gt("2025-05-31");
		expect(d.getUTCDay()).toBe(6); // sábado
		expect(esDiaHabilGT(d)).toBe(true);
	});
});

describe("contarDiasHabilesGT (intervalo [inicio, fin))", () => {
	it("cuenta Lun→Jue como 3 (lun, mar, mié; jue excluido)", () => {
		expect(contarDiasHabilesGT(gt("2025-02-10"), gt("2025-02-13"))).toBe(3);
	});

	it("salta el fin de semana normal", () => {
		// [vie 07, mar 11) = {vie, sáb(no), dom(no), lun} = 2
		expect(contarDiasHabilesGT(gt("2025-02-07"), gt("2025-02-11"))).toBe(2);
	});

	it("la regla de oro suma la quincena que cae en sábado", () => {
		// [jue 13, lun 17) = {jue, vie, sáb-15(regla→sí), dom-16(no)} = 3
		expect(contarDiasHabilesGT(gt("2025-02-13"), gt("2025-02-17"))).toBe(3);
	});

	it("intervalo vacío o invertido = 0", () => {
		expect(contarDiasHabilesGT(gt("2025-02-10"), gt("2025-02-10"))).toBe(0);
		expect(contarDiasHabilesGT(gt("2025-02-13"), gt("2025-02-10"))).toBe(0);
	});
});

describe("siguienteDiaGT + SLA de subida sellada 23:59 GT (Codex P2)", () => {
	// Subida del motor: lunes 2025-02-10 23:59 GT = 2025-02-11 05:59 UTC.
	const subidaLun2359 = new Date("2025-02-11T05:59:00Z");

	it("ancla al día GT siguiente (martes 11), no al lunes", () => {
		expect(gtDay(subidaLun2359)).toBe("2025-02-10"); // auto-documenta: es lunes GT
		expect(gtDay(siguienteDiaGT(subidaLun2359))).toBe("2025-02-11");
	});

	it("NO escala el jueves: solo mar+mié = 2 hábiles (antes contaba lun→3)", () => {
		expect(
			contarDiasHabilesGT(siguienteDiaGT(subidaLun2359), gt("2025-02-13")),
		).toBe(2);
	});

	it("escala el viernes: mar+mié+jue = 3 hábiles", () => {
		expect(
			contarDiasHabilesGT(siguienteDiaGT(subidaLun2359), gt("2025-02-14")),
		).toBe(3);
	});
});
