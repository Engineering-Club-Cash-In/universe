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

/**
 * Archivos que pueden cambiar el DPI de un lead o un co-deudor, y cuántas veces
 * llaman al candado.
 *
 * Cada punto de control cuenta DOS veces: el chequeo previo y la relectura que
 * arma el mensaje cuando el UPDATE no afecta ninguna fila. Esa segunda llamada
 * no es un control nuevo — la condición del candado viaja dentro del WHERE del
 * UPDATE para cerrar la carrera con una aprobación de análisis simultánea, y al
 * volver con cero filas hay que distinguir "el candado se cerró en el medio" de
 * un NOT_FOUND. Ver `noExisteOportunidadCandante*`.
 *
 * - `portal-lead.ts`: 1 punto (la edición del portal) × 2.
 * - `crm.ts`: 2 puntos (updateLead y updateCoDebtor) × 2.
 */
const CABLEADO_ESPERADO: Record<string, number> = {
	"controllers/portal-lead.ts": 2,
	"routers/crm.ts": 4,
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

	/**
	 * 🔴 El chequeo previo y el UPDATE no son atómicos: entre los dos, otra
	 * transacción puede aprobar el análisis (30 → 40) y el DPI se escribe igual
	 * sobre un expediente que acaba de quedar atado a la identidad vieja.
	 *
	 * La condición tiene que viajar DENTRO de la sentencia —Postgres la
	 * re-evalúa tras esperar a la escritura rival—, y eso no lo nota ningún test
	 * de la regla: el candado en memoria sigue decidiendo igual de bien.
	 */
	test("los tres puntos meten la condición del candado en el WHERE del UPDATE", () => {
		for (const archivo of Object.keys(CABLEADO_ESPERADO)) {
			const texto = readFileSync(join(SRC, archivo), "utf8");

			expect(
				texto.includes("noExisteOportunidadCandanteDelLead") ||
					texto.includes("noExisteOportunidadCandantePorId"),
				`${archivo} debería condicionar el UPDATE que escribe el dpi a que no exista ` +
					"oportunidad candante. Sin eso, una aprobación de análisis simultánea deja " +
					"pasar el cambio de DPI aunque el candado haya dicho que no.",
			).toBe(true);
		}
	});

	/**
	 * 🔴 `deleteCoDebtor` entra al cableado del candado aunque no escriba ningún
	 * DPI: borrar al co-deudor y crear otro con otro DPI reemplaza la identidad
	 * que respalda el crédito sin tocar una sola columna `dpi`. Los tests que
	 * miran `update(...)` con `dpi:` no lo ven, y por eso se declara acá.
	 *
	 * `createCoDebtor` queda FUERA a propósito: agregar un co-deudor tarde es un
	 * flujo legítimo. El reemplazo exige borrar primero, y eso ya está cerrado.
	 */
	test("deleteCoDebtor pasa por el candado; createCoDebtor no, a propósito", () => {
		const texto = readFileSync(join(SRC, "routers/crm.ts"), "utf8");

		const desdeDelete = texto.indexOf("deleteCoDebtor: crmProcedure");
		expect(desdeDelete).toBeGreaterThan(-1);
		const bloqueDelete = texto.slice(desdeDelete, desdeDelete + 3000);

		expect(
			bloqueDelete.includes("evaluarCandadoBorradoCoDeudor("),
			"deleteCoDebtor debería candar: borrarlo y crear otro con otro DPI cambia " +
				"al responsable del crédito por la puerta de atrás.",
		).toBe(true);

		const desdeCreate = texto.indexOf("createCoDebtor: crmProcedure");
		expect(desdeCreate).toBeGreaterThan(-1);
		const bloqueCreate = texto.slice(
			desdeCreate,
			texto.indexOf("updateCoDebtor: crmProcedure"),
		);

		expect(
			bloqueCreate.includes("evaluarCandadoBorradoCoDeudor("),
			"createCoDebtor NO debe candar: agregar un co-deudor tarde es legítimo. " +
				"Si se cierra acá, se rompe el flujo bueno sin cerrar nada que el " +
				"borrado candado no cierre ya.",
		).toBe(false);
	});

	/**
	 * 🔴 El borrado del co-deudor tenía el mismo agujero que el UPDATE del DPI, y
	 * uno peor encima: la evidencia (análisis y QR) se borraba sin transacción, así
	 * que una aprobación concurrente entre el chequeo y los deletes dejaba al
	 * co-deudor borrado pese al candado —o vivo pero sin su análisis—.
	 */
	test("el borrado del co-deudor es atómico y no deja el expediente a medias", () => {
		const texto = readFileSync(join(SRC, "routers/crm.ts"), "utf8");

		const desdeDelete = texto.indexOf("deleteCoDebtor: crmProcedure");
		expect(desdeDelete).toBeGreaterThan(-1);
		const bloqueDelete = texto.slice(desdeDelete, desdeDelete + 6000);

		expect(
			bloqueDelete.includes("auditedTransaction("),
			"los tres deletes tienen que viajar en una transacción: si el candado " +
				"corta el del co-deudor, la evidencia ya borrada tiene que volver. " +
				"Y tiene que ser `auditedTransaction`, no `db.transaction`: ahora se " +
				"anota DENTRO de la transacción (el override del admin y su " +
				"revalidación), así que lo que revierta la escritura tiene que " +
				"llevarse también esas anotaciones.",
		).toBe(true);

		expect(
			bloqueDelete.includes("noExisteOportunidadCandantePorId("),
			"el candado del borrado tiene que ir DENTRO del WHERE, no solo antes: " +
				"entre el chequeo y el delete cabe una aprobación de análisis.",
		).toBe(true);
	});

	/**
	 * Borrar al co-deudor analizado cuesta lo mismo que cambiarle el DPI: la
	 * oportunidad vuelve a análisis. Sin esto, tras el override solo quedaba la
	 * bitácora y la solicitud seguía aprobada sobre un respaldo que ya no existe.
	 */
	test("el override del admin sobre el borrado también revalida", () => {
		const texto = readFileSync(join(SRC, "routers/crm.ts"), "utf8");

		const desdeDelete = texto.indexOf("deleteCoDebtor: crmProcedure");
		const bloqueDelete = texto.slice(desdeDelete, desdeDelete + 6000);

		expect(bloqueDelete).toContain("revalidarOportunidades(");
	});

	test("en el portal el candado NO vive dentro de la guarda que descarta los vacíos", () => {
		const texto = readFileSync(join(SRC, "controllers/portal-lead.ts"), "utf8");

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
