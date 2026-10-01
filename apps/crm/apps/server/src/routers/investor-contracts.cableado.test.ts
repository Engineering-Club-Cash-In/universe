import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Cada procedure del router de inversiones tiene que estar cableada en
 * `routers/index.ts`.
 *
 * El router de la app no hace spread: enumera procedure por procedure. Una
 * nueva que no se agregue ahí compila, pasa el `tsc` y se ve bien en el
 * cliente, pero el servidor contesta "Not Found" al llamarla — que es
 * exactamente lo que pasó con anular, subir y avisar.
 *
 * Se compara el texto de los dos archivos a propósito: importar el router de
 * la app levanta medio servidor (base, auth, R2) para responder algo que se
 * puede leer.
 */
const raiz = path.join(import.meta.dir);

function leer(archivo: string): string {
	return fs.readFileSync(path.join(raiz, archivo), "utf8");
}

describe("cableado del router de contratos de inversión", () => {
	test("todas las procedures están enumeradas en el router de la app", () => {
		const definidas = [
			...leer("investor-contracts.ts").matchAll(
				/^\t([a-zA-Z]+): (?:juridicoProcedure|viewInvestorContractsProcedure|protectedProcedure)/gm,
			),
		].map((m) => m[1]);

		// Si esto falla, el archivo cambió de forma y el test dejó de mirar lo que
		// dice mirar.
		expect(definidas.length).toBeGreaterThan(10);

		const index = leer("index.ts");
		const sinCablear = definidas.filter(
			(nombre) => !index.includes(`investorContractsRouter.${nombre}`),
		);

		expect(sinCablear).toEqual([]);
	});
});
