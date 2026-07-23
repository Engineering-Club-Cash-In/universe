import { describe, expect, it } from "bun:test";
import { contarDiasHabilesGT, esDiaHabilGT } from "./business-days-gt";

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
