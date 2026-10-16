import { describe, expect, test } from "bun:test";
import {
	normalizarDpiMatch,
	normalizarTelefonoMatch,
} from "./buro-interno-match";
import {
	coincidenciaReferencia,
	esTelefonoRelleno,
	normalizarDpiReferencia,
	telefonosDeReferencia,
} from "./referencia-normalizacion";

// CUI válidos (con dígito verificador).
const DPI_A = "2345678990101";
const DPI_B = "1234567030101";

describe("normalizarDpiReferencia", () => {
	test("13 dígitos válidos, con o sin formato", () => {
		expect(normalizarDpiReferencia(DPI_A)).toBe(DPI_A);
		expect(normalizarDpiReferencia("2345 67899 0101")).toBe(DPI_A);
		expect(normalizarDpiReferencia("2345-67899-0101")).toBe(DPI_A);
	});
	test("12 y 14 dígitos no son DPI", () => {
		expect(normalizarDpiReferencia("234567899010")).toBeNull();
		expect(normalizarDpiReferencia("23456789901011")).toBeNull();
	});
	test("13 dígitos con verificador malo o inventados no son DPI", () => {
		expect(normalizarDpiReferencia("2345678900101")).toBeNull();
		expect(normalizarDpiReferencia("0000000000000")).toBeNull();
		expect(normalizarDpiReferencia("1111111111111")).toBeNull();
	});
	test("vacío, undefined, null, basura y números", () => {
		expect(normalizarDpiReferencia("")).toBeNull();
		expect(normalizarDpiReferencia(undefined)).toBeNull();
		expect(normalizarDpiReferencia(null)).toBeNull();
		expect(normalizarDpiReferencia("abc")).toBeNull();
		expect(normalizarDpiReferencia(2345678990101)).toBe(DPI_A);
	});
});

describe("esTelefonoRelleno", () => {
	test.each([
		"00000000",
		"55555555",
		"12345678",
		"87654321",
		"23456789",
		"98765432",
		"12121212",
		"12341234",
	])("%s es relleno", (t) => expect(esTelefonoRelleno(t)).toBe(true));

	test.each([
		"55551234",
		"41234567",
		"30001000",
		"12345679",
		"50505051",
	])("%s es un teléfono normal", (t) =>
		expect(esTelefonoRelleno(t)).toBe(false));
});

describe("telefonosDeReferencia", () => {
	test("8 dígitos tal cual; ignora +502, espacios y guiones", () => {
		expect(telefonosDeReferencia("55551234")).toEqual(["55551234"]);
		expect(telefonosDeReferencia("+502 5555-1234")).toEqual(["55551234"]);
		expect(telefonosDeReferencia("(502) 5555 1234")).toEqual(["55551234"]);
	});
	test("7 dígitos o menos, vacío y basura -> ninguno", () => {
		expect(telefonosDeReferencia("5555123")).toEqual([]);
		expect(telefonosDeReferencia("")).toEqual([]);
		expect(telefonosDeReferencia(null)).toEqual([]);
		expect(telefonosDeReferencia("sin telefono")).toEqual([]);
	});
	test("números de relleno se descartan", () => {
		expect(telefonosDeReferencia("0000-0000")).toEqual([]);
		expect(telefonosDeReferencia("12345678")).toEqual([]);
	});
	test("quita extensiones", () => {
		expect(telefonosDeReferencia("2222-3333 ext. 45")).toEqual(["22223333"]);
		expect(telefonosDeReferencia("22223333 extensión 123")).toEqual([
			"22223333",
		]);
		expect(telefonosDeReferencia("22223333 x45")).toEqual(["22223333"]);
		expect(telefonosDeReferencia("22223333 Ext:9")).toEqual(["22223333"]);
	});
	test("varios números en un campo, separados por / , ; | y o", () => {
		const esperado = ["22223333", "44445555"];
		for (const campo of [
			"2222-3333 / 4444-5555",
			"22223333, 44445555",
			"22223333;44445555",
			"22223333 | 44445555",
			"2222 3333 y 4444 5555",
			"22223333 o 44445555",
			"22223333\n44445555",
		]) {
			expect(telefonosDeReferencia(campo)).toEqual(esperado);
		}
	});
	test("varios números separados solo por espacio o con etiquetas", () => {
		expect(telefonosDeReferencia("5555-1234 4444-5678")).toEqual([
			"55551234",
			"44445678",
		]);
		expect(telefonosDeReferencia("55551234 (casa) 44445678 (cel)")).toEqual([
			"55551234",
			"44445678",
		]);
		expect(telefonosDeReferencia("casa: 2298-7766 cel: 5432-1987")).toEqual([
			"22987766",
			"54321987",
		]);
	});
	test("el código de país y los grupos de dígitos no parten un número", () => {
		expect(telefonosDeReferencia("+502 5555 1234")).toEqual(["55551234"]);
		expect(telefonosDeReferencia("502 55551234")).toEqual(["55551234"]);
		expect(telefonosDeReferencia("(502) 5555-1234")).toEqual(["55551234"]);
		expect(telefonosDeReferencia("55 5555 1234")).toEqual(["55551234"]);
		expect(telefonosDeReferencia("+502 5555 1234 / +502 4444 5678")).toEqual([
			"55551234",
			"44445678",
		]);
	});
	test("prefijo de país: +502, 00502, 502 y (502), en cualquier forma de escribir el número", () => {
		for (const campo of [
			"00502 5555 1234",
			"+00502 5555-1234",
			"(502) 5555-1234",
			"502 55 55 12 34",
			"+502 5555-1234",
			"502 55551234",
			"tel: +502 5555 1234",
		]) {
			expect(telefonosDeReferencia(campo)).toEqual(["55551234"]);
		}
		expect(telefonosDeReferencia("502 5555 1234 / 4444 5678")).toEqual([
			"55551234",
			"44445678",
		]);
		expect(telefonosDeReferencia("502 5555 1234 502 4444 5678")).toEqual([
			"55551234",
			"44445678",
		]);
	});
	test("un número que empieza con 502 pegado no pierde sus dígitos", () => {
		expect(telefonosDeReferencia("5021 2345")).toEqual(["50212345"]);
		expect(telefonosDeReferencia("50212345")).toEqual(["50212345"]);
	});
	test("límite conocido: dígitos sueltos antes del número en texto libre se juntan con él", () => {
		expect(telefonosDeReferencia("desde 2019 5555 1234")).not.toContain(
			"55551234",
		);
	});
	test("bordes: sobrante de menos de 8 se descarta, grupo largo se emite directo", () => {
		expect(telefonosDeReferencia("5555-1234 44")).toEqual(["55551234"]);
		expect(telefonosDeReferencia("44 5555-1234")).toEqual(["55551234"]);
		expect(telefonosDeReferencia("50255551234")).toEqual(["55551234"]);
		expect(telefonosDeReferencia("5555 123")).toEqual([]);
	});
	test("varios con extensión y repetidos", () => {
		expect(
			telefonosDeReferencia("2222-3333 ext 1 / 2222-3333 / 4444-5555 x2"),
		).toEqual(["22223333", "44445555"]);
	});
	test("números en vez de texto (JSONB)", () => {
		expect(telefonosDeReferencia(55551234)).toEqual(["55551234"]);
	});
});

describe("coincidenciaReferencia", () => {
	test("DPI igual, teléfono distinto -> dpi", () => {
		expect(
			coincidenciaReferencia(
				{ dpi: DPI_A, telefono: "55551234" },
				{ dpi: "2345 67899 0101", telefono: "99990000" },
			),
		).toBe("dpi");
	});
	test("DPI distinto, teléfono igual -> null (no cae al teléfono)", () => {
		expect(
			coincidenciaReferencia(
				{ dpi: DPI_A, telefono: "55551234" },
				{ dpi: DPI_B, telefono: "+502 5555-1234" },
			),
		).toBeNull();
	});
	test("un lado sin DPI + teléfono igual -> telefono", () => {
		expect(
			coincidenciaReferencia(
				{ dpi: DPI_A, telefono: "55551234" },
				{ telefono: "+502 5555-1234" },
			),
		).toBe("telefono");
	});
	test("DPI inventado o inválido cuenta como sin DPI", () => {
		expect(
			coincidenciaReferencia(
				{ dpi: "0000000000000", telefono: "55551234" },
				{ dpi: "0000000000000", telefono: "5555 1234" },
			),
		).toBe("telefono");
		// dos DPI basura distintos no tapan la coincidencia por teléfono
		expect(
			coincidenciaReferencia(
				{ dpi: "1111111111111", telefono: "55551234" },
				{ dpi: "2222222222222", telefono: "55551234" },
			),
		).toBe("telefono");
		// y dos DPI basura iguales no coinciden por DPI
		expect(
			coincidenciaReferencia(
				{ dpi: "0000000000000", telefono: "55551234" },
				{ dpi: "0000000000000", telefono: "66661234" },
			),
		).toBeNull();
	});
	test("varios números y extensiones se comparan uno a uno, en los dos lados", () => {
		expect(
			coincidenciaReferencia(
				{ telefono: "2222-3333 ext 5 / 4444-5555" },
				{ telefono: "+502 4444 5555" },
			),
		).toBe("telefono");
		expect(
			coincidenciaReferencia(
				{ telefono: "44445555" },
				{ telefono: "1111-2222 y 4444-5555 x9" },
			),
		).toBe("telefono");
	});
	test("relleno, menos de 8 dígitos y sin datos -> null", () => {
		expect(
			coincidenciaReferencia(
				{ telefono: "12345678" },
				{ telefono: "12345678" },
			),
		).toBeNull();
		expect(
			coincidenciaReferencia(
				{ telefono: "00000000" },
				{ telefono: "00000000" },
			),
		).toBeNull();
		expect(
			coincidenciaReferencia({ telefono: "123" }, { telefono: "123" }),
		).toBeNull();
		expect(coincidenciaReferencia({}, {})).toBeNull();
	});
	test("teléfono numérico (JSONB) contra texto", () => {
		expect(
			coincidenciaReferencia(
				{ telefono: 55551234 },
				{ telefono: "+502 5555-1234" },
			),
		).toBe("telefono");
	});
});

// El comentario de referencia-normalizacion.ts afirma estas diferencias: acá se demuestran.
describe("diferencias con el buró interno (por qué no se reutiliza)", () => {
	test("DPI: el buró acepta 13 dígitos sin verificador; acá cuenta como sin DPI", () => {
		expect(normalizarDpiMatch("0000000000000")).toBe("0000000000000");
		expect(normalizarDpiReferencia("0000000000000")).toBeNull();
		expect(normalizarDpiMatch("1234567040101")).toBe("1234567040101");
		expect(normalizarDpiReferencia("1234567040101")).toBeNull();
	});
	test("teléfono: el buró junta los dígitos de varios números y se queda con el último", () => {
		expect(normalizarTelefonoMatch("5555-1234 4444-5678")).toBe("44445678");
		expect(telefonosDeReferencia("5555-1234 4444-5678")).toEqual([
			"55551234",
			"44445678",
		]);
	});
	test("teléfono: el buró no quita extensiones, así que el número sale corrido", () => {
		expect(normalizarTelefonoMatch("2222-3333 ext 45")).not.toBe("22223333");
		expect(telefonosDeReferencia("2222-3333 ext 45")).toEqual(["22223333"]);
	});
	test("teléfono: el buró no descarta números de relleno", () => {
		expect(normalizarTelefonoMatch("12345678")).toBe("12345678");
		expect(normalizarTelefonoMatch("00000000")).toBe("00000000");
		expect(telefonosDeReferencia("12345678")).toEqual([]);
		expect(telefonosDeReferencia("00000000")).toEqual([]);
	});
	test("en lo simple coinciden: +502 y los últimos 8 dígitos", () => {
		expect(normalizarTelefonoMatch("+502 5555-1234")).toBe("55551234");
		expect(telefonosDeReferencia("+502 5555-1234")).toEqual(["55551234"]);
	});
});
