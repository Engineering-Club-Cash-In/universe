import { describe, expect, it } from "bun:test";

/**
 * "Deshacer convenio y mandar a recuperación" son dos escrituras en cartera y
 * no hay forma de unirlas en una transacción desde acá. Por eso el rango B1–B3
 * tiene que verificarse ANTES de deshacer (review de Codex, P2): después, un
 * rechazo deja el convenio deshecho y la recuperación sin hacer.
 *
 * Cartera revalida bajo sus locks —eso es lo que manda—; esto cuida que el
 * caso normal no termine en parcial. Se afirma sobre la fuente porque es un
 * orden dentro de un handler de 9k líneas que un refactor puede invertir.
 */
describe("deshacerConvenio: orden del chequeo de bucket", () => {
	it("lee el bucket antes de anular cuando se pide mandar a recuperación", async () => {
		const fuente = await Bun.file(
			new URL("./cobros.ts", import.meta.url).pathname,
		).text();
		const inicio = fuente.indexOf("deshacerConvenio:");
		expect(inicio).toBeGreaterThan(-1);
		const handler = fuente.slice(inicio);

		const chequeo = handler.indexOf("getBucketActualCredito(");
		const rango = handler.indexOf("bucket > BUCKET_MAXIMO_RECUPERACION");
		const anular = handler.indexOf("carteraBackClient.anularConvenio(");

		expect(chequeo).toBeGreaterThan(-1);
		expect(rango).toBeGreaterThan(-1);
		expect(anular).toBeGreaterThan(-1);
		expect(chequeo).toBeLessThan(anular);
		expect(rango).toBeLessThan(anular);
	});
});
