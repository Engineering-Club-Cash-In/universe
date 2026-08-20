/**
 * El candado de la documentación.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SI ESTA PRUEBA FALLA, NO ES UN PROBLEMA DE LA PRUEBA: es que cambiaste los
 * endpoints del bot y no actualizaste `openapi.ts`. Documentalo y vuelve a
 * pasar.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * La spec está escrita a mano (ver el encabezado de `openapi.ts`), así que sin
 * esto se desincroniza al primer cambio y SimpleTech termina integrando contra
 * un documento que miente. Acá se compara con lo que el código realmente
 * devuelve.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codigosDocumentados, especificacionBotCobros } from "./openapi";

/** Los archivos que le responden al bot. Si aparece otro, va en esta lista. */
const FUENTES = ["../../controllers/bot-cobros.ts", "./auth.ts"];

/**
 * Rutas que cuelgan de `/api/bot/cobros/` pero **no las llama SimpleTech**.
 *
 * Comparten prefijo por comodidad de despliegue, nada más. Documentarlas en la
 * spec del bot sería entregarle a un tercero el mapa de una puerta que no le
 * corresponde — y peor: `/pagos/evento` dispara mensajes de WhatsApp a
 * clientes, así que va con otra llave (`autenticarCarteraWebhook`).
 *
 * La lista es explícita a propósito. Agregar algo acá tiene que costar la
 * molestia de escribirlo y justificarlo; si la excepción fuera un patrón, el
 * candado dejaría de servir en una semana.
 */
const RUTAS_QUE_NO_SON_DE_SIMPLETECH = new Set([
	// La llama cartera-back cuando contabilidad valida o revierte un pago (§6).
	"/api/bot/cobros/pagos/evento",
]);

/** `codigo: "LO_QUE_SEA"` — la forma en que se declara un error en el código. */
function codigosEnElCodigo(): Set<string> {
	const encontrados = new Set<string>();

	for (const relativa of FUENTES) {
		const fuente = readFileSync(join(import.meta.dir, relativa), "utf-8");

		for (const [, codigo] of fuente.matchAll(/codigo:\s*"([A-Z_]+)"/g)) {
			encontrados.add(codigo);
		}
	}

	return encontrados;
}

describe("la spec no se desincroniza del código", () => {
	test("todo error que devuelve el código está documentado", () => {
		const documentados = codigosDocumentados();
		const sinDocumentar = [...codigosEnElCodigo()]
			.filter((codigo) => !documentados.has(codigo))
			.sort();

		expect(sinDocumentar).toEqual([]);
	});

	test("no se documentan errores que ya no existen", () => {
		const enElCodigo = codigosEnElCodigo();
		const inventados = [...codigosDocumentados()]
			.filter((codigo) => !enElCodigo.has(codigo))
			.sort();

		expect(inventados).toEqual([]);
	});

	test("las rutas documentadas son las que se montan en index.ts", () => {
		const index = readFileSync(
			join(import.meta.dir, "../../index.ts"),
			"utf-8",
		);

		const montadas = [
			...index.matchAll(/app\.post\(\s*"(\/api\/bot\/cobros\/[^"]+)"/g),
		]
			.map(([, ruta]) => ruta)
			.filter((ruta) => !RUTAS_QUE_NO_SON_DE_SIMPLETECH.has(ruta));

		expect([...new Set(montadas)].sort()).toEqual(
			Object.keys(especificacionBotCobros.paths).sort(),
		);
	});
});

describe("la spec sirve para lo que se hizo", () => {
	// Es lo que reemplaza al PDF: si no se puede ejecutar desde la página, no
	// sirve de nada y volvemos a mandar curls por WhatsApp.
	test("declara el servidor y la autenticación, para poder ejecutar desde la UI", () => {
		expect(especificacionBotCobros.servers[0].url).toStartWith("https://");
		expect(
			especificacionBotCobros.components.securitySchemes.apiKey.scheme,
		).toBe("bearer");
		expect(especificacionBotCobros.security).toEqual([{ apiKey: [] }]);
	});

	// El código del modo simulado lo tiene solo el equipo de IT (D-21): la
	// documentación la ve el integrador.
	test("NO publica el código del modo simulado", () => {
		const codigoFijo = readFileSync(
			join(import.meta.dir, "otp.ts"),
			"utf-8",
		).match(/const CODIGO_FIJO_DE_PRUEBA = "(\d+)"/)?.[1];

		expect(codigoFijo).toBeTruthy();
		expect(JSON.stringify(especificacionBotCobros)).not.toContain(
			`"otp": "${codigoFijo}"`,
		);
		expect(JSON.stringify(especificacionBotCobros)).not.toContain(
			`otp: "${codigoFijo}"`,
		);
	});
});
