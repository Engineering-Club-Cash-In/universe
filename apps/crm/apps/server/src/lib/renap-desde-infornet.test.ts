import { describe, expect, test } from "bun:test";
import type { FichaPrincipalPersona } from "../db/schema/buro";
import { mapearFichaInfornetARenap } from "./renap-desde-infornet";

const DPI = "3075219820602";

const fichaBase: FichaPrincipalPersona = {
	codigo: 123,
	nombres: "MARIA DE LOS ANGELES",
	apellidos: "PEREZ LOPEZ DE FIGUEROA",
	sexo: "FEMENINO",
	fechaNacimiento: "13/08/1999",
	lugarNacimiento: "MIXCO, GUATEMALA",
	pais: "GUATEMALA",
	profesion: "ESTUDIANTE",
};

describe("mapearFichaInfornetARenap", () => {
	test("llena solo los campos de RENAP que Infornet trae", () => {
		expect(mapearFichaInfornetARenap(DPI, fichaBase)).toEqual({
			dpi: DPI,
			firstName: "MARIA DE LOS ANGELES",
			firstLastName: "PEREZ LOPEZ DE FIGUEROA",
			gender: "F",
			birthDate: "1999-08-13",
			municipalityBornedIn: "MIXCO",
			departmentBornedIn: "GUATEMALA",
			bornedIn: "GUATEMALA",
			ocupation: "ESTUDIANTE",
		});
	});

	test("no inventa campos que Infornet no trae", () => {
		const persona = mapearFichaInfornetARenap(DPI, fichaBase);

		for (const campo of [
			"secondName",
			"thirdName",
			"secondLastName",
			"marriedLastName",
			"picture",
			"civilStatus",
			"nationality",
			"deathDate",
			"cedulaOrder",
			"cedulaRegister",
			"dpiExpiracyDate",
		]) {
			expect(persona).not.toHaveProperty(campo);
		}
	});

	test("sin nombres o apellidos no hay registro", () => {
		expect(
			mapearFichaInfornetARenap(DPI, { ...fichaBase, nombres: "  " }),
		).toBeNull();
		expect(
			mapearFichaInfornetARenap(DPI, { ...fichaBase, apellidos: "" }),
		).toBeNull();
	});

	test("MASCULINO es M y un sexo desconocido queda vacío", () => {
		expect(
			mapearFichaInfornetARenap(DPI, { ...fichaBase, sexo: "MASCULINO" })
				?.gender,
		).toBe("M");
		expect(
			mapearFichaInfornetARenap(DPI, { ...fichaBase, sexo: "" })?.gender,
		).toBeNull();
	});

	test("fechas aproximadas, vacías o inválidas quedan vacías", () => {
		for (const fechaNacimiento of ["APROX 12/1998", "", "31/02/1999"]) {
			expect(
				mapearFichaInfornetARenap(DPI, { ...fichaBase, fechaNacimiento })
					?.birthDate,
			).toBeNull();
		}
	});

	test("un lugar sin coma no se separa, pero el país sí se llena", () => {
		for (const lugarNacimiento of ["-NA-", "EXTRANJEROS NATURALIZADOS"]) {
			const persona = mapearFichaInfornetARenap(DPI, {
				...fichaBase,
				lugarNacimiento,
				pais: "COSTA RICA",
			});
			expect(persona?.municipalityBornedIn).toBeNull();
			expect(persona?.departmentBornedIn).toBeNull();
			expect(persona?.bornedIn).toBe("COSTA RICA");
		}
	});

	test("sin profesión la ocupación queda vacía", () => {
		expect(
			mapearFichaInfornetARenap(DPI, { ...fichaBase, profesion: undefined })
				?.ocupation,
		).toBeNull();
	});
});
