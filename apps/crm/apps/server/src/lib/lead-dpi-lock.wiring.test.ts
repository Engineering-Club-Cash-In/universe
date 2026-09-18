import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/**
 * Inventario del cableado del candado de DPI.
 *
 * `lead-dpi-lock.test.ts` prueba que la REGLA decide bien. Este prueba que
 * alguien la LLAME, que es lo que faltaba: una verificación adversarial borró
 * el bloque entero del candado en `portal-lead.ts` y la suite completa siguió
 * en verde, o sea que el bypass que ya se coló una vez podía volver a entrar
 * en cualquier refactor sin que nada avisara.
 *
 * El bug original fue exactamente eso: el candado quedó anidado dentro del
 * `if (dpi !== undefined && dpi.trim() !== "")`, que descarta los vacíos,
 * mientras la escritura de `updateData.dpi` vivía fuera. Un `dpi: ""` entraba
 * por el hueco, borraba el DPI del expediente y la llamada siguiente escribía
 * el que quisiera, desde el portal público y sin ser admin.
 */

const SRC = join(dirname(import.meta.dir), "");
const LLAMADA_CANDADO = "evaluarCandadoDpi(";

/** Archivos que pueden cambiar el DPI de un lead o un co-deudor, y cuántas veces llaman al candado. */
const CABLEADO_ESPERADO: Record<string, number> = {
	"controllers/portal-lead.ts": 1,
	"routers/crm.ts": 2,
};

function archivosTs(dir: string): string[] {
	const salida: string[] = [];
	for (const entrada of readdirSync(dir)) {
		if (entrada === "node_modules" || entrada === "dist") continue;
		const ruta = join(dir, entrada);
		if (statSync(ruta).isDirectory()) {
			salida.push(...archivosTs(ruta));
		} else if (entrada.endsWith(".ts") && !entrada.endsWith(".test.ts")) {
			salida.push(ruta);
		}
	}
	return salida;
}

function contar(texto: string, aguja: string): number {
	return texto.split(aguja).length - 1;
}

describe("cableado del candado de DPI", () => {
	test("los archivos declarados siguen llamando al candado la cantidad de veces declarada", () => {
		const real: Record<string, number> = {};
		for (const [archivo, esperadas] of Object.entries(CABLEADO_ESPERADO)) {
			const texto = readFileSync(join(SRC, archivo), "utf8");
			real[archivo] = contar(texto, LLAMADA_CANDADO);
			expect(esperadas).toBeGreaterThan(0);
		}
		expect(real).toEqual(CABLEADO_ESPERADO);
	});

	test("ningún otro archivo cambia el DPI de un lead o co-deudor por su cuenta", () => {
		const sospechosos: string[] = [];

		for (const ruta of archivosTs(SRC)) {
			const relativa = relative(SRC, ruta);
			if (relativa in CABLEADO_ESPERADO) continue;
			if (relativa.startsWith("lib/lead-dpi-lock")) continue;

			const texto = readFileSync(ruta, "utf8");
			for (const tabla of ["update(leads)", "update(coDebtors)"]) {
				let desde = texto.indexOf(tabla);
				while (desde !== -1) {
					// El `.set({...})` de un update de Drizzle viene pegado a la llamada;
					// con mirar el bloque siguiente alcanza para ver si asigna el DPI.
					const bloque = texto.slice(desde, desde + 900);
					const fin = bloque.indexOf("where(");
					const asignacion = /\bdpi\s*:/.test(
						fin === -1 ? bloque : bloque.slice(0, fin),
					);
					if (asignacion) {
						sospechosos.push(`${relativa} (${tabla})`);
					}
					desde = texto.indexOf(tabla, desde + 1);
				}
			}
		}

		// Si esto falla, apareció una puerta nueva: o la candás, o la declarás
		// arriba explicando por qué no necesita candado (por ejemplo, un alta).
		expect(sospechosos).toEqual([]);
	});

	test("en el portal el candado NO vive dentro de la guarda que descarta los vacíos", () => {
		const texto = readFileSync(
			join(SRC, "controllers/portal-lead.ts"),
			"utf8",
		);

		const posCandado = texto.indexOf(LLAMADA_CANDADO);
		expect(posCandado).toBeGreaterThan(-1);

		// La guarda que abre el bloque del candado es la última que se abre antes
		// de la llamada. Si vuelve a ser la del `trim()`, el bypass está de regreso.
		const guardaQueLoEnvuelve = texto
			.slice(0, posCandado)
			.split("\n")
			.reverse()
			.find((linea) => linea.trimStart().startsWith("if ("));

		expect(guardaQueLoEnvuelve).toBeDefined();
		expect(guardaQueLoEnvuelve).not.toContain("trim()");
		expect(guardaQueLoEnvuelve).toContain("dpi !== undefined");
	});
});
