import { expect, test } from "bun:test";
import { CarteraBackClient } from "./cartera-back-client";

test("getAllCreditos permite desactivar caché para validar acceso Págalo", async () => {
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
	const params = {
		mes: 0,
		anio: 0,
		page: 1,
		perPage: 1,
		numeros_credito_sifco: ["01010214103540"],
	};

	await cliente.getAllCreditos(params, { useCache: false });
	await cliente.getAllCreditos(params, { useCache: false });

	expect(llamadas).toBe(2);
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
