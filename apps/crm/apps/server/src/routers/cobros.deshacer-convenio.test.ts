import { describe, expect, it } from "bun:test";

/**
 * CB-043: nada llega a B4 por recuperación forzosa sin una solicitud que
 * apruebe otra persona. Antes había dos caminos directos, "deshacer convenio
 * y mandar a recuperación" y la forzosa pedida por un supervisor o admin, y
 * cualquiera de los dos se saltaba la aprobación.
 *
 * Se afirma sobre la fuente porque son órdenes y ausencias dentro de handlers
 * de un router de 9k líneas, que un refactor puede reintroducir sin que ningún
 * test de comportamiento lo note.
 */
async function handler(nombre: string, siguiente: string): Promise<string> {
	const fuente = await Bun.file(
		new URL("./cobros.ts", import.meta.url).pathname,
	).text();
	const inicio = fuente.indexOf(`${nombre}:`);
	expect(inicio).toBeGreaterThan(-1);
	const fin = fuente.indexOf(`${siguiente}:`, inicio);
	expect(fin).toBeGreaterThan(inicio);
	return fuente.slice(inicio, fin);
}

describe("CB-043: ningún camino a B4 sin solicitud", () => {
	it("deshacerConvenio solo deshace: no manda a recuperación", async () => {
		const deshacer = await handler(
			"deshacerConvenio",
			"getHistorialReasignaciones",
		);
		expect(deshacer).toContain("carteraBackClient.anularConvenio(");
		expect(deshacer).not.toContain("enviarARecuperacionVehiculo(");
		expect(deshacer).not.toContain("prepararEnvioRecuperacion(");
		expect(deshacer).not.toContain("mandarARecuperacion");
	});

	it("la forzosa siempre crea una solicitud, sin excepción por rol, antes de cualquier traslado", async () => {
		const envio = await handler(
			"enviarCreditoARecuperacion",
			"getAlertaConvenioDelCaso",
		);
		const ramaForzosa = envio.indexOf('if (input.tipo === "tomado")');
		const solicitud = envio.indexOf("crearSolicitudRecuperacion(");
		const retorno = envio.indexOf('return { modo: "solicitud" as const');
		const traslado = envio.indexOf("prepararEnvioRecuperacion(");
		expect(ramaForzosa).toBeGreaterThan(-1);
		expect(ramaForzosa).toBeLessThan(solicitud);
		expect(solicitud).toBeLessThan(retorno);
		expect(retorno).toBeLessThan(traslado);
		expect(envio.slice(ramaForzosa, retorno)).not.toContain("canAssignCobros");
	});
});
