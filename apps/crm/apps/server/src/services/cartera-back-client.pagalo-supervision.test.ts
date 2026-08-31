import { expect, test } from "bun:test";
import { CarteraBackClient } from "./cartera-back-client";

test("getPoolPorAsesor permite desactivar caché para validar acceso Págalo", async () => {
	let llamadas = 0;
	const fetchDePrueba = (async () => {
		llamadas += 1;
		return new Response(JSON.stringify({ success: true, data: [] }));
	}) as unknown as typeof fetch;
	const cliente = new CarteraBackClient({
		baseUrl: "http://cartera-back.test",
		enableCache: true,
		accessTokenProvider: async () => "token-de-prueba",
		fetchTransport: fetchDePrueba,
	});

	await cliente.getPoolPorAsesor({ useCache: false });
	await cliente.getPoolPorAsesor({ useCache: false });

	expect(llamadas).toBe(2);
});

test("getSifcosPoolAutoritativos consulta solo créditos vigentes del pool", async () => {
	let urlSolicitada = "";
	const fetchDePrueba = (async (input: RequestInfo | URL) => {
		urlSolicitada = String(input);
		return new Response(
			JSON.stringify({
				success: true,
				data: ["01010214103540"],
				page: 2,
				perPage: 500,
				total: 501,
				totalPages: 2,
			}),
		);
	}) as unknown as typeof fetch;
	const cliente = new CarteraBackClient({
		baseUrl: "http://cartera-back.test",
		enableCache: true,
		accessTokenProvider: async () => "token-de-prueba",
		fetchTransport: fetchDePrueba,
	});

	const respuesta = await cliente.getSifcosPoolAutoritativos({
		asesorId: 7,
		page: 2,
		perPage: 500,
	});

	expect(urlSolicitada).toContain("/buckets/pool-sifcos?asesor_id=7&page=2&perPage=500");
	expect(respuesta.data).toEqual(["01010214103540"]);
	expect(respuesta.totalPages).toBe(2);
});
