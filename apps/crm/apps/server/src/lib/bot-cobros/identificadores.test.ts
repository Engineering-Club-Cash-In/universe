import { describe, expect, test } from "bun:test";
import {
	aFormatoSms,
	detectarTipoBusqueda,
	elegirTelefonoParaOtp,
	enmascararTelefono,
	esMovil,
	extraerTelefonos,
	normalizarPlaca,
	normalizarTelefono,
	telefonoEstaRegistrado,
} from "./identificadores";

// Los casos de abajo salen de mirar los datos reales (2026-08-14): 1,760
// clientes con crédito, 570 con varios teléfonos en el mismo campo, 3 con
// números de 16 dígitos y 19 placas guardadas sin la letra inicial.

describe("detectarTipoBusqueda", () => {
	// CUI sintético con verificador correcto (12345678 → 9) y depto/muni 01/01.
	const DPI_VALIDO = "1234567890101";

	test("13 dígitos con CUI válido es DPI", () => {
		expect(detectarTipoBusqueda(DPI_VALIDO)).toEqual({
			tipo: "dpi",
			valor: DPI_VALIDO,
		});
	});

	test("acepta el DPI escrito con espacios", () => {
		expect(detectarTipoBusqueda("1234 56789 0101")).toEqual({
			tipo: "dpi",
			valor: DPI_VALIDO,
		});
	});

	test("13 dígitos con verificador inválido no pasa como DPI", () => {
		const resultado = detectarTipoBusqueda("1111111111111");
		expect(resultado.tipo).toBeNull();
	});

	test("lo que tiene letras es placa", () => {
		expect(detectarTipoBusqueda("P-185KKW")).toEqual({
			tipo: "placa",
			valor: "P185KKW",
		});
		expect(detectarTipoBusqueda("p 185 kkw")).toEqual({
			tipo: "placa",
			valor: "P185KKW",
		});
		expect(detectarTipoBusqueda("185KKW")).toEqual({
			tipo: "placa",
			valor: "185KKW",
		});
	});

	test("solo dígitos y no son 13 es NIT", () => {
		expect(detectarTipoBusqueda("1234567")).toEqual({
			tipo: "nit",
			valor: "1234567",
		});
		expect(detectarTipoBusqueda("1234567-8")).toEqual({
			tipo: "nit",
			valor: "12345678",
		});
	});

	test("NIT con K de dígito verificador no se confunde con placa", () => {
		expect(detectarTipoBusqueda("1234567-K")).toEqual({
			tipo: "nit",
			valor: "1234567K",
		});
	});

	test("vacío o basura no se clasifica", () => {
		expect(detectarTipoBusqueda("").tipo).toBeNull();
		expect(detectarTipoBusqueda("   ").tipo).toBeNull();
		expect(detectarTipoBusqueda("!!!").tipo).toBeNull();
	});

	test("una palabra suelta no se sale a buscar como placa", () => {
		expect(detectarTipoBusqueda("hola").tipo).toBeNull();
		expect(detectarTipoBusqueda("buenas tardes").tipo).toBeNull();
		expect(detectarTipoBusqueda("MI PLACA").tipo).toBeNull();
	});
});

describe("normalizarPlaca", () => {
	test("quita guiones, espacios y sube a mayúsculas", () => {
		expect(normalizarPlaca("P-185KKW")).toBe("P185KKW");
		expect(normalizarPlaca(" P-459LPN ")).toBe("P459LPN");
		expect(normalizarPlaca("532ltw")).toBe("532LTW");
	});
});

describe("normalizarTelefono", () => {
	test("acepta 8 dígitos", () => {
		expect(normalizarTelefono("58446376")).toBe("58446376");
	});

	test("quita el código de país", () => {
		expect(normalizarTelefono("50258446376")).toBe("58446376");
	});

	test("tolera guiones y espacios", () => {
		expect(normalizarTelefono("5844-6376")).toBe("58446376");
		expect(normalizarTelefono("+502 5844 6376")).toBe("58446376");
	});

	test("descarta lo que no es un teléfono guatemalteco", () => {
		expect(normalizarTelefono("5466680041120279")).toBeNull(); // parece tarjeta
		expect(normalizarTelefono("0")).toBeNull();
		expect(normalizarTelefono("2219552")).toBeNull(); // fijo viejo de 7
		expect(normalizarTelefono("12406753644")).toBeNull(); // 11 dígitos sin 502
		expect(normalizarTelefono("")).toBeNull();
	});
});

describe("esMovil", () => {
	test("3, 4 y 5 son móviles", () => {
		expect(esMovil("58446376")).toBe(true);
		expect(esMovil("42151234")).toBe(true);
		expect(esMovil("30412345")).toBe(true);
	});

	test("2, 6 y 7 son fijos", () => {
		expect(esMovil("22215273")).toBe(false);
		expect(esMovil("66123456")).toBe(false);
		expect(esMovil("77123456")).toBe(false);
	});
});

describe("extraerTelefonos", () => {
	test("parte por coma y por barra", () => {
		expect(extraerTelefonos("58446376, 22215273")).toEqual([
			"58446376",
			"22215273",
		]);
		expect(extraerTelefonos("58446376/42151234")).toEqual([
			"58446376",
			"42151234",
		]);
	});

	test("descarta la basura y no repite", () => {
		expect(extraerTelefonos("58446376, 0, 58446376, 5466680041120279")).toEqual(
			["58446376"],
		);
	});

	test("campo vacío o nulo devuelve lista vacía", () => {
		expect(extraerTelefonos(null)).toEqual([]);
		expect(extraerTelefonos("")).toEqual([]);
	});
});

describe("elegirTelefonoParaOtp", () => {
	test("se salta el fijo aunque venga primero", () => {
		expect(elegirTelefonoParaOtp("22215273, 58446376")).toBe("58446376");
	});

	test("toma el primer móvil cuando hay varios", () => {
		expect(elegirTelefonoParaOtp("58446376, 42151234")).toBe("58446376");
	});

	test("busca en todos los campos que se le pasen", () => {
		expect(elegirTelefonoParaOtp(null, "22215273", "42151234")).toBe(
			"42151234",
		);
	});

	test("sin móviles no hay a dónde mandar el código", () => {
		expect(elegirTelefonoParaOtp("22215273")).toBeNull();
		expect(elegirTelefonoParaOtp(null, undefined, "")).toBeNull();
	});
});

describe("telefonoEstaRegistrado", () => {
	test("compara sin importar el formato", () => {
		expect(telefonoEstaRegistrado("50258446376", "58446376, 22215273")).toBe(
			true,
		);
		expect(telefonoEstaRegistrado("5844-6376", "50258446376")).toBe(true);
	});

	test("un número ajeno no está registrado", () => {
		expect(telefonoEstaRegistrado("41112222", "58446376")).toBe(false);
	});
});

describe("presentación", () => {
	test("formato para el proveedor de SMS", () => {
		expect(aFormatoSms("58446376")).toBe("50258446376");
	});

	test("máscara para el chat", () => {
		expect(enmascararTelefono("58446376")).toBe("****6376");
	});
});
