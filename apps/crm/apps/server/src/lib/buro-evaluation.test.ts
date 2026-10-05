import { describe, expect, test } from "bun:test";
import { type AnalisisRiesgoBuro, evaluarBuro } from "./buro-evaluation";

const analisisBase: AnalisisRiesgoBuro = {
	scoreRiesgo: 100,
	nivelRiesgo: "BAJO",
	alertas: [],
	detalles: {
		tieneDelitosPenales: false,
		tieneMorosidad: false,
		esPEP: false,
		tienePatrimonio: true,
	},
};

describe("evaluarBuro", () => {
	test("aprueba cuando no hay delitos penales ni morosidad", () => {
		const resultado = evaluarBuro(analisisBase);

		expect(resultado.pasoBuro).toBe(true);
		expect(resultado.motivosRechazo).toEqual([]);
		expect(resultado.mensajeBuro).toBe("Aprobado");
	});

	test("rechaza cuando solo hay delitos penales", () => {
		const resultado = evaluarBuro({
			...analisisBase,
			detalles: {
				...analisisBase.detalles,
				tieneDelitosPenales: true,
			},
		});

		expect(resultado.pasoBuro).toBe(false);
		expect(resultado.motivosRechazo).toEqual(["Tiene antecedentes penales"]);
		expect(resultado.mensajeBuro).toBe("Rechazado: Tiene antecedentes penales");
	});

	test("rechaza cuando solo hay morosidad", () => {
		const resultado = evaluarBuro({
			...analisisBase,
			detalles: {
				...analisisBase.detalles,
				tieneMorosidad: true,
			},
		});

		expect(resultado.pasoBuro).toBe(false);
		expect(resultado.motivosRechazo).toEqual(["Tiene historial de morosidad"]);
		expect(resultado.mensajeBuro).toBe(
			"Rechazado: Tiene historial de morosidad",
		);
	});

	test("rechaza con ambos motivos y los lista en orden", () => {
		const resultado = evaluarBuro({
			...analisisBase,
			detalles: {
				...analisisBase.detalles,
				tieneDelitosPenales: true,
				tieneMorosidad: true,
			},
		});

		expect(resultado.pasoBuro).toBe(false);
		expect(resultado.motivosRechazo).toEqual([
			"Tiene antecedentes penales",
			"Tiene historial de morosidad",
		]);
		expect(resultado.mensajeBuro).toBe(
			"Rechazado: Tiene antecedentes penales, Tiene historial de morosidad",
		);
	});

	test("PEP y falta de patrimonio no rechazan por sí solos", () => {
		const resultado = evaluarBuro({
			scoreRiesgo: 70,
			nivelRiesgo: "MEDIO",
			alertas: ["PEP", "SIN_PATRIMONIO"],
			detalles: {
				tieneDelitosPenales: false,
				tieneMorosidad: false,
				esPEP: true,
				tienePatrimonio: false,
			},
		});

		expect(resultado.pasoBuro).toBe(true);
		expect(resultado.mensajeBuro).toBe("Aprobado");
	});

	test("sin análisis de riesgo devuelve sinVeredicto y no aprueba", () => {
		const resultado = evaluarBuro(null);

		expect(resultado.sinVeredicto).toBe(true);
		expect(resultado.pasoBuro).toBe(false);
		expect(resultado.motivosRechazo).toEqual([]);
		expect(resultado.mensajeBuro).toBe(
			"No se pudo obtener el análisis de riesgo de Infornet",
		);
	});

	test("un veredicto real nunca se marca como sinVeredicto", () => {
		expect(evaluarBuro(analisisBase).sinVeredicto).toBe(false);
		expect(
			evaluarBuro({
				...analisisBase,
				detalles: { ...analisisBase.detalles, tieneMorosidad: true },
			}).sinVeredicto,
		).toBe(false);
	});
});
