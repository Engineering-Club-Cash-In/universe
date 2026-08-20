/**
 * El candado de las cuentas de pago.
 *
 * La primera prueba es la que importa: fija **carácter por carácter** la línea
 * que los recordatorios de cobros ya le mandan al cliente. Los números se
 * movieron a `cuentas-pago.ts` para que el bot y las plantillas lean lo mismo,
 * y ese refactor no puede cambiar ni una coma de un mensaje que ya salió a
 * producción miles de veces.
 *
 * Si esta prueba falla después de tocar `CUENTAS_PAGO`, la pregunta no es cómo
 * arreglar la prueba: es si de verdad se quiso cambiar el texto que le llega al
 * cliente.
 */

import { describe, expect, test } from "bun:test";
import { COBROS_CUENTAS_PAGO } from "./cobros-plantillas";
import {
	CUENTAS_PAGO,
	cuentasParaBot,
	normalizarCuenta,
	reconocerCuenta,
	textoCuentasWhatsapp,
} from "./cuentas-pago";

/** Copiado del código anterior al refactor, a mano y a propósito. */
const TEXTO_HISTORICO =
	"A continuación, le compartimos los números de cuenta para realizar su depósito o transferencia: - CUBE INVESTMENTS, S.A. (monetaria) No. 5520029876 BANCO INDUSTRIAL (BI) / CUBE INVESTMENTS, S.A. (monetaria) No. 3020123033 BANCO AGROMERCANTIL (BAM) / CUBE INVESTMENTS, S.A. (monetaria) No. 01300039945 BANCO GyT CONTINENTAL / CUBE INVESTMENTS, S.A. (monetaria) No. 3394002346 BANRURAL";

describe("las plantillas de cobros siguen diciendo exactamente lo mismo", () => {
	test("la línea de cuentas no cambió ni un carácter", () => {
		expect(COBROS_CUENTAS_PAGO).toBe(TEXTO_HISTORICO);
	});

	test("las cuatro cuentas están en el texto", () => {
		for (const cuenta of CUENTAS_PAGO) {
			expect(COBROS_CUENTAS_PAGO).toContain(cuenta.numero);
		}
	});
});

describe("el texto del bot", () => {
	test("usa la negrita de WhatsApp, que es UN asterisco", () => {
		expect(textoCuentasWhatsapp()).not.toContain("**");
	});

	test("lista las cuatro cuentas, una por línea", () => {
		const texto = textoCuentasWhatsapp();
		for (const cuenta of CUENTAS_PAGO) {
			expect(texto).toContain(`*${cuenta.banco}* — ${cuenta.numero}`);
		}
	});

	test("dice a nombre de quién están", () => {
		expect(textoCuentasWhatsapp()).toContain("CUBE INVESTMENTS, S.A.");
	});
});

describe("lo que viaja al bot", () => {
	test("trae el texto listo y las cuatro cuentas en estructura", () => {
		const { texto, cuentas } = cuentasParaBot();

		expect(texto).toBe(textoCuentasWhatsapp());
		expect(cuentas).toHaveLength(4);
		expect(cuentas[0]).toEqual({
			banco: "Banco Industrial",
			bancoId: 1,
			numero: "5520029876",
			titular: "CUBE INVESTMENTS, S.A.",
			tipo: "monetaria",
		});
	});

	test("no filtra la etiqueta interna de las plantillas", () => {
		for (const cuenta of cuentasParaBot().cuentas) {
			expect(cuenta).not.toHaveProperty("etiquetaPlantilla");
		}
	});
});

describe("reconocer la cuenta destino de una boleta", () => {
	test("la boleta de Banrural que usamos de ejemplo cae en la nuestra", () => {
		const resultado = reconocerCuenta("3394002346");

		expect(resultado.estado).toBe("reconocida");
		if (resultado.estado === "reconocida") {
			expect(resultado.cuenta.bancoId).toBe(2);
		}
	});

	test("aguanta espacios y guiones", () => {
		expect(reconocerCuenta("3394-002 346").estado).toBe("reconocida");
	});

	test("el cero inicial de G&T no rompe nada", () => {
		// El modelo se come el cero de `01300039945` bastante seguido.
		const conCero = reconocerCuenta("01300039945");
		const sinCero = reconocerCuenta("1300039945");

		expect(conCero.estado).toBe("reconocida");
		expect(sinCero.estado).toBe("reconocida");
	});

	test("una cuenta recortada coincide por el final", () => {
		expect(reconocerCuenta("029876").estado).toBe("reconocida");
	});

	test("una cuenta ajena no se reconoce", () => {
		expect(reconocerCuenta("9999999999").estado).toBe("no_reconocida");
	});

	test("pocos dígitos es ilegible, NO 'no es nuestra'", () => {
		// La diferencia decide si el asesor recibe una alerta o no.
		expect(reconocerCuenta("2346").estado).toBe("ilegible");
		expect(reconocerCuenta("").estado).toBe("ilegible");
		expect(reconocerCuenta(null).estado).toBe("ilegible");
		expect(reconocerCuenta("***4587").estado).toBe("ilegible");
	});

	test("normalizar deja solo dígitos", () => {
		expect(normalizarCuenta("No. 3394-002.346 ")).toBe("3394002346");
	});
});
