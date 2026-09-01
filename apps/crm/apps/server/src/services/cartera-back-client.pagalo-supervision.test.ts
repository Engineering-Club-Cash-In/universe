import { expect, test } from "bun:test";
import { CarteraBackClient } from "./cartera-back-client";

test("getAllCreditos cachea lecturas GET repetidas", async () => {
	let llamadas = 0;
	const fetchDePrueba = (async () => {
		llamadas += 1;
		return new Response(
			JSON.stringify({
				data: [],
				page: 1,
				perPage: 1,
				total: 0,
				totalPages: 1,
			}),
		);
	}) as unknown as typeof fetch;
	const cliente = new CarteraBackClient({
		baseUrl: "http://cartera-back.test",
		enableCache: true,
		accessTokenProvider: async () => "token-de-prueba",
		fetchTransport: fetchDePrueba,
	});
	const params = { mes: 0, anio: 0, page: 1, perPage: 1 };

	await cliente.getAllCreditos(params);
	await cliente.getAllCreditos(params);

	expect(llamadas).toBe(1);
});

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

test("getSifcosPoolAutoritativos obtiene scope completo en una petición", async () => {
	let urlSolicitada = "";
	const fetchDePrueba = (async (input: RequestInfo | URL) => {
		urlSolicitada = String(input);
		return new Response(
			JSON.stringify({
				success: true,
				data: ["01010214103540"],
			}),
		);
	}) as unknown as typeof fetch;
	const cliente = new CarteraBackClient({
		baseUrl: "http://cartera-back.test",
		enableCache: true,
		accessTokenProvider: async () => "token-de-prueba",
		fetchTransport: fetchDePrueba,
	});

	const respuesta = await cliente.getSifcosPoolAutoritativos({ asesorId: 7 });

	expect(urlSolicitada).toContain("/buckets/pool-sifcos?asesor_id=7");
	expect(respuesta.data).toEqual(["01010214103540"]);
});

test("getAsignacionesPoolPorSifco envía una sola consulta bulk acotada a página", async () => {
	let urlSolicitada = "";
	const fetchDePrueba = (async (input: RequestInfo | URL) => {
		urlSolicitada = String(input);
		return new Response(
			JSON.stringify({
				success: true,
				data: [{ numero_credito_sifco: "SIFCO-1", asesor_id: 7 }],
			}),
		);
	}) as unknown as typeof fetch;
	const cliente = new CarteraBackClient({
		baseUrl: "http://cartera-back.test",
		enableCache: true,
		accessTokenProvider: async () => "token-de-prueba",
		fetchTransport: fetchDePrueba,
	});

	const respuesta = await cliente.getAsignacionesPoolPorSifco({
		sifcos: ["SIFCO-1", "SIFCO-2"],
	});

	expect(urlSolicitada).toContain("/buckets/pool-asignaciones?sifcos=SIFCO-1%2CSIFCO-2");
	expect(respuesta.data).toEqual([
		{ numero_credito_sifco: "SIFCO-1", asesor_id: 7 },
	]);
});
