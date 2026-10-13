import { describe, expect, test } from "bun:test";
import {
	type CamposCartaPoder,
	camposVacios,
	datosDeLaCartaPoder,
	edadAl,
	vencimientoPorDefecto,
} from "./carta-poder";
import { dpiEnLetras, dpiToLegalFormat } from "./contract-utils";

const campos = (cambios: Partial<CamposCartaPoder> = {}): CamposCartaPoder => ({
	...camposVacios("2026-10-12"),
	genero: "female",
	nombreCompleto: "María José Pérez López",
	edad: "35",
	estadoCivil: "married",
	profesion: "Comerciante",
	nacionalidad: "Guatemalteco",
	dpi: "2400 50120 0101",
	marcaVehiculo: "Toyota",
	paisDestino: "El Salvador",
	edadRepresentante: "42",
	...cambios,
});

describe("datosDeLaCartaPoder", () => {
	test("aplica las reglas de jurídico: nombre en mayúsculas, lo demás en letras minúsculas", () => {
		const datos = datosDeLaCartaPoder("carta_cube_andres", campos());

		expect(datos.nombreCompleto).toBe("MARÍA JOSÉ PÉREZ LÓPEZ");
		expect(datos.edad).toBe("treinta y cinco");
		expect(datos.estadoCivil).toBe("casada");
		expect(datos.profesion).toBe("comerciante");
		expect(datos.nacionalidad).toBe("guatemalteca");
		expect(datos.dpiTexto).toBe(
			"dos mil cuatrocientos, cincuenta mil ciento veinte, cero ciento uno",
		);
		expect(datos.dpiNumero).toBe("2400 50120 0101");
		expect(datos.fechaInicioContrato).toBe(
			"doce de octubre del año dos mil veintiséis",
		);
		expect(datos.fechaVencimiento).toBe(
			"doce de octubre del año dos mil veintisiete",
		);
		expect(datos.edadAndres).toBe("cuarenta y dos");
	});

	test("la edad del representante va en la variable de cada carta", () => {
		expect(datosDeLaCartaPoder("carta_cube_don_alex", campos()).edadAlex).toBe(
			"cuarenta y dos",
		);
		expect(datosDeLaCartaPoder("carta_rdbe_don_alex", campos()).edadAlex).toBe(
			"cuarenta y dos",
		);
		const richard = datosDeLaCartaPoder("carta_rdbe_richard", campos());
		expect(richard.edadRichard).toBe("cuarenta y dos");
		expect(richard.edadAndres).toBeUndefined();
	});

	test("lo vacío va vacío para que el generador ponga su guion", () => {
		const datos = datosDeLaCartaPoder(
			"carta_cube_andres",
			camposVacios("2026-10-12"),
		);

		for (const variable of [
			"nombreCompleto",
			"edad",
			"estadoCivil",
			"profesion",
			"nacionalidad",
			"dpiTexto",
			"dpiNumero",
			"chasisVehiculo",
			"iscvVehiculo",
			"paisDestino",
			"edadAndres",
		]) {
			expect(datos[variable]).toBe("");
		}
		// Así venía en la carta de jurídico.
		expect(datos.usoVehiculo).toBe("Particular");
		expect(
			datosDeLaCartaPoder("carta_cube_andres", campos({ fechaFirma: "" }))
				.fechaInicioContrato,
		).toBe("");
	});

	test("si escriben la edad en letras o un DPI incompleto, se respeta", () => {
		const datos = datosDeLaCartaPoder(
			"carta_cube_andres",
			campos({ edad: "Treinta", dpi: "2400 501" }),
		);
		expect(datos.edad).toBe("treinta");
		expect(datos.dpiTexto).toBe("2400 501");
		expect(datos.dpiNumero).toBe("2400 501");
	});

	test("el estado civil y la nacionalidad siguen al género", () => {
		const datos = datosDeLaCartaPoder(
			"carta_cube_andres",
			campos({
				genero: "male",
				estadoCivil: "single",
				nacionalidad: "guatemalteca",
			}),
		);
		expect(datos.estadoCivil).toBe("soltero");
		expect(datos.nacionalidad).toBe("guatemalteco");
	});
});

describe("vencimientoPorDefecto", () => {
	test("vence al año de la firma", () => {
		expect(vencimientoPorDefecto("2026-10-12")).toBe("2027-10-12");
	});

	test("un 29 de febrero vence el 28", () => {
		expect(vencimientoPorDefecto("2028-02-29")).toBe("2029-02-28");
	});

	test("sin fecha no inventa una", () => {
		expect(vencimientoPorDefecto("")).toBe("");
	});
});

describe("dpiEnLetras", () => {
	test("los tres grupos en letras, separados por coma y sin el número", () => {
		expect(dpiEnLetras("2553 05052 0101")).toBe(
			"dos mil quinientos cincuenta y tres, cero cinco mil cincuenta y dos, cero ciento uno",
		);
	});

	test("el formato legal sigue igual: letras y número entre paréntesis", () => {
		expect(dpiToLegalFormat("2553050520101")).toBe(
			"dos mil quinientos cincuenta y tres, cero cinco mil cincuenta y dos, cero ciento uno (2553 05052 0101)",
		);
	});
});

describe("edad a la fecha de firma", () => {
	test("cumple antes o después de la firma", () => {
		expect(edadAl("1985-03-20", "2026-03-19")).toBe(40);
		expect(edadAl("1985-03-20", "2026-03-20")).toBe(41);
		expect(edadAl("1985-03-20", "2026-10-13")).toBe(41);
	});

	test("sin fecha válida no hay edad", () => {
		expect(edadAl("", "2026-10-13")).toBeNull();
		expect(edadAl("1985-03-20", "")).toBeNull();
	});
});
