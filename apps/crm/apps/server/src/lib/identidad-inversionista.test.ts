import { describe, expect, test } from "bun:test";
import {
	conMarcaDeIdentificacion,
	esPrimeraCompra,
	IDENTIFICACION_COMPRA_SIGUIENTE,
	IDENTIFICACION_PRIMERA_COMPRA,
	identificacionDelContrato,
	identificacionParaLaCompra,
} from "./identidad-inversionista";

describe("identidad del inversionista por compra", () => {
	test("sin nada aportado antes es su primera compra: selfie y DPI", () => {
		expect(esPrimeraCompra("0.00")).toBe(true);
		expect(identificacionParaLaCompra("0")).toBe(IDENTIFICACION_PRIMERA_COMPRA);
		expect(IDENTIFICACION_PRIMERA_COMPRA).toBe("face");
	});

	test("con monto aportado antes, las siguientes van sólo con firma", () => {
		expect(esPrimeraCompra("15000.00")).toBe(false);
		expect(identificacionParaLaCompra(15000)).toBe(
			IDENTIFICACION_COMPRA_SIGUIENTE,
		);
		expect(IDENTIFICACION_COMPRA_SIGUIENTE).toBe("none");
	});

	test("un residuo de redondeo no cuenta como monto aportado", () => {
		expect(esPrimeraCompra("0.00000001")).toBe(true);
		expect(esPrimeraCompra("0.01")).toBe(false);
	});

	test("sin el dato se pide lo de siempre, no menos", () => {
		expect(identificacionParaLaCompra(null)).toBe("face");
		expect(identificacionParaLaCompra(undefined)).toBe("face");
		expect(identificacionParaLaCompra("no es un número")).toBe("face");
	});

	test("el contrato recuerda con qué se emitió", () => {
		const respuesta = conMarcaDeIdentificacion({ r2Key: "x.pdf" }, "none");
		expect(respuesta.r2Key).toBe("x.pdf");
		expect(identificacionDelContrato(respuesta)).toBe("none");
		expect(identificacionDelContrato({ r2Key: "x.pdf" })).toBeNull();
		expect(
			identificacionDelContrato({ identificacionDelInversionista: "selfie" }),
		).toBeNull();
		expect(identificacionDelContrato(null)).toBeNull();
	});
});
