import { describe, expect, it } from "bun:test";
import {
	camposAlDescartar,
	camposAlDetectar,
	claveDisparador,
	disparadorDeteccion,
	dpiConsultable,
	emailConsultable,
	type IdentidadDetectada,
} from "./deteccion-empresa";

const richard: IdentidadDetectada = {
	inversionista_id: 76,
	nombre: "Richard Kachler",
	email: "richardkachler93@gmail.com",
	dpi: "1573661970101",
	via: "directo",
	sociedad: null,
};

describe("cuándo vale la pena consultar", () => {
	it("no consulta un DPI a medio escribir", () => {
		expect(dpiConsultable("157366")).toBeNull();
	});

	it("consulta cuando ya hay 13 dígitos, ignorando separadores", () => {
		expect(dpiConsultable("1573 66197 0101")).toBe("1573661970101");
	});

	// Las cédulas viejas de producción: el inversionista 187 tiene `4036613`.
	// Con el umbral en 13 nunca se le consultaba, así que crear su empresa era
	// imposible desde que desapareció el interruptor "¿Es empresa?".
	it("consulta también las cédulas viejas de 7 y 8 dígitos", () => {
		expect(dpiConsultable("4036613")).toBe("4036613");
		expect(dpiConsultable("04036613")).toBe("04036613");
	});

	it("no consulta un correo incompleto", () => {
		expect(emailConsultable("richard@")).toBeNull();
		expect(emailConsultable("richard@gmail")).toBeNull();
	});

	it("normaliza el correo a minúsculas", () => {
		expect(emailConsultable("  Richard@Gmail.COM ")).toBe("richard@gmail.com");
	});
});

describe("qué campo dispara la búsqueda", () => {
	it("el DPI manda cuando está completo", () => {
		expect(disparadorDeteccion("1573661970101", "otro@correo.com")).toEqual({
			dpi: "1573661970101",
		});
	});

	it("el correo consulta solo si no hay DPI utilizable", () => {
		expect(disparadorDeteccion("157", "richard@gmail.com")).toEqual({
			email: "richard@gmail.com",
		});
	});

	it("sin ninguno de los dos no se consulta", () => {
		expect(disparadorDeteccion("", "")).toBeNull();
	});

	it("la clave distingue el origen", () => {
		expect(claveDisparador({ dpi: "1" })).not.toBe(claveDisparador({ email: "1" }));
	});
});

describe("qué se rellena al detectar", () => {
	it("mueve el DPI a representante y toma el correo de la persona", () => {
		expect(camposAlDetectar(richard, "")).toEqual({
			dpi: "",
			dpiRepLegal: "1573661970101",
			email: "richardkachler93@gmail.com",
		});
	});

	it("respeta el correo que conta ya escribió", () => {
		// Una sociedad puede tener correo propio; no se pisa lo tecleado.
		const campos = camposAlDetectar(richard, "cobros@cube.com");

		expect(campos.email).toBe("cobros@cube.com");
	});

	it("no toca nombre, banco ni cuenta", () => {
		// El contrato son tres llaves: si aparece una cuarta, alguien empezó a
		// autorrellenar los datos que distinguen a la empresa de su dueño.
		expect(Object.keys(camposAlDetectar(richard, "")).sort()).toEqual([
			"dpi",
			"dpiRepLegal",
			"email",
		]);
	});
});

describe("qué se deshace al descartar", () => {
	it("el DPI vuelve al campo donde se escribió", () => {
		expect(camposAlDescartar(richard, "richardkachler93@gmail.com")).toEqual({
			dpi: "1573661970101",
			dpiRepLegal: "",
			email: "",
		});
	});

	it("conserva el correo si no fue el que se autorrellenó", () => {
		const campos = camposAlDescartar(richard, "cobros@cube.com");

		expect(campos.email).toBe("cobros@cube.com");
	});
});
