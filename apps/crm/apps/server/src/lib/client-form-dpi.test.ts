import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	MENSAJE_DPI_NO_COINCIDE,
	verificarDpiDelFormulario,
} from "./client-form-dpi";

/**
 * 🔴 Los formularios de `routers/client-forms.ts` son públicos: la única
 * credencial es el token del enlace, que identifica a UNA persona. El `dpi` del
 * cuerpo se guardaba tal cual, así que con un enlace vigente se podía firmar
 * una solicitud de crédito a nombre de otro DPI — puenteando de paso el
 * invariante del candado, que existe para que la identidad de un expediente no
 * se mueva después del 30%.
 */
const DPI_DEL_PARTICIPANTE = "3460666380101";
const OTRO_DPI = "1234567890101";

describe("DPI del formulario público contra el participante del token", () => {
	test("🔴 un DPI distinto al del participante se rechaza", () => {
		const resultado = verificarDpiDelFormulario(DPI_DEL_PARTICIPANTE, OTRO_DPI);

		expect(resultado.coincide).toBe(false);
		expect(resultado).toEqual({
			coincide: false,
			mensaje: MENSAJE_DPI_NO_COINCIDE,
		});
	});

	test("el mensaje dice qué pasó y a quién recurrir, en español", () => {
		expect(MENSAJE_DPI_NO_COINCIDE).toContain("no coincide");
		expect(MENSAJE_DPI_NO_COINCIDE).toContain("asesor");
	});

	test("el mismo DPI pasa", () => {
		expect(
			verificarDpiDelFormulario(DPI_DEL_PARTICIPANTE, DPI_DEL_PARTICIPANTE),
		).toEqual({ coincide: true });
	});

	test("compara normalizado: los DPI viejos quedaron guardados con espacios", () => {
		// Un `===` crudo rechazaría a la persona correcta. Se usa `normalizarDpi`,
		// el mismo criterio que el candado y el gate: quita espacios, nada más.
		expect(
			verificarDpiDelFormulario("3460 66638 0101", "3460666380101"),
		).toEqual({ coincide: true });
	});

	test("si el participante NO tiene DPI guardado, se acepta: es la captura", () => {
		// El caso legítimo y frecuente: el formulario es justamente donde se
		// captura el DPI por primera vez.
		expect(verificarDpiDelFormulario(null, OTRO_DPI)).toEqual({
			coincide: true,
		});
		expect(verificarDpiDelFormulario("", OTRO_DPI)).toEqual({
			coincide: true,
		});
		expect(verificarDpiDelFormulario("   ", OTRO_DPI)).toEqual({
			coincide: true,
		});
	});

	test("si el formulario no manda DPI, no hay identidad que contrastar", () => {
		expect(verificarDpiDelFormulario(DPI_DEL_PARTICIPANTE, undefined)).toEqual({
			coincide: true,
		});
		expect(verificarDpiDelFormulario(DPI_DEL_PARTICIPANTE, "")).toEqual({
			coincide: true,
		});
	});
});

/**
 * La regla de arriba pasa entera aunque nadie la llame. Los DOS submit tienen
 * que cruzarla: `submitFinancialStatement` escribe `dpi` igual que
 * `submitCreditApplication`, y dejar uno sin cruzar deja el agujero abierto por
 * la otra puerta.
 */
describe("los dos submit públicos cruzan el DPI contra el participante", () => {
	const fuente = readFileSync(
		join(dirname(import.meta.dir), "routers/client-forms.ts"),
		"utf8",
	);

	test("cada submit llama a la verificación antes de armar los valores", () => {
		for (const submit of [
			"submitCreditApplication",
			"submitFinancialStatement",
		]) {
			const desde = fuente.indexOf(`${submit}: publicProcedure`);
			expect(desde, `no se encontró ${submit}`).toBeGreaterThan(-1);

			// El handler termina donde arranca el siguiente procedure público. Se
			// busca DESPUÉS del `publicProcedure` de este mismo, que está en `desde`.
			const siguiente = fuente.indexOf(
				"publicProcedure",
				desde + `${submit}: publicProcedure`.length,
			);
			const bloque = fuente.slice(
				desde,
				siguiente === -1 ? undefined : siguiente,
			);

			const posVerificacion = bloque.indexOf("exigirDpiDelParticipante(");
			const posValores = bloque.indexOf("const values = {");

			expect(
				posVerificacion,
				`${submit} debería cruzar el DPI del formulario contra el participante ` +
					"del token: es una ruta pública y el token identifica a UNA persona.",
			).toBeGreaterThan(-1);
			expect(
				posVerificacion,
				`${submit} debería verificar ANTES de armar los valores que se escriben`,
			).toBeLessThan(posValores);
		}
	});
});
