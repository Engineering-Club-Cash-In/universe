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

// Una lista larga por query string produce una URL de ~17 KB (1000 SIFCOs de 14
// dígitos con las comas como %2C), sobre el límite de 8 KB de la mayoría de los
// servidores. El 414 lo absorbe el catch de la bandeja, así que el síntoma no
// sería un error sino la columna Asesor vacía en todo el reporte.
test("getAsesorPorSifco usa POST con listas largas para no romper la URL", async () => {
	let metodo = "";
	let urlSolicitada = "";
	let cuerpo: unknown = null;
	const fetchDePrueba = (async (url: string, init?: RequestInit) => {
		urlSolicitada = url;
		metodo = init?.method ?? "GET";
		cuerpo = init?.body ? JSON.parse(String(init.body)) : null;
		return new Response(JSON.stringify({ success: true, data: [] }));
	}) as unknown as typeof fetch;
	const cliente = new CarteraBackClient({
		baseUrl: "http://cartera-back.test",
		enableCache: false,
		accessTokenProvider: async () => "token-de-prueba",
		fetchTransport: fetchDePrueba,
	});
	const sifcos = Array.from({ length: 300 }, (_, i) => `0101021410${i}`);

	await cliente.getAsesorPorSifco({ sifcos });

	expect(metodo).toBe("POST");
	expect(urlSolicitada).not.toContain("?");
	expect(urlSolicitada.length).toBeLessThan(200);
	expect(cuerpo).toEqual({ sifcos });
});

test("getAsesorPorSifco mantiene GET con listas cortas", async () => {
	let metodo = "";
	let urlSolicitada = "";
	const fetchDePrueba = (async (url: string, init?: RequestInit) => {
		urlSolicitada = url;
		metodo = init?.method ?? "GET";
		return new Response(JSON.stringify({ success: true, data: [] }));
	}) as unknown as typeof fetch;
	const cliente = new CarteraBackClient({
		baseUrl: "http://cartera-back.test",
		enableCache: false,
		accessTokenProvider: async () => "token-de-prueba",
		fetchTransport: fetchDePrueba,
	});

	await cliente.getAsesorPorSifco({ sifcos: ["SIFCO-1", "SIFCO-2"] });

	expect(metodo).toBe("GET");
	expect(urlSolicitada).toContain("/buckets/asesor-por-sifco?sifcos=SIFCO-1%2CSIFCO-2");
});

// El enriquecimiento de nombres de cliente en la bandeja cruza a POST cuando la
// página del export trae más de 50 SIFCOs. Ese POST no debe inventar un
// `estado`: la bandeja necesita el nombre de cualquier crédito, sin importar en
// qué estado esté, y filtrarlo dejaría la columna Cliente vacía para el resto.
test("getAllCreditos por POST no acota por estado cuando no se pidió", async () => {
	let metodo = "";
	const capturado: { cuerpo: Record<string, unknown> | null } = { cuerpo: null };
	const fetchDePrueba = (async (_url: string, init?: RequestInit) => {
		metodo = init?.method ?? "GET";
		capturado.cuerpo = init?.body ? JSON.parse(String(init.body)) : null;
		return new Response(
			JSON.stringify({ data: [], page: 1, perPage: 1, total: 0, totalPages: 1 }),
		);
	}) as unknown as typeof fetch;
	const cliente = new CarteraBackClient({
		baseUrl: "http://cartera-back.test",
		enableCache: false,
		accessTokenProvider: async () => "token-de-prueba",
		fetchTransport: fetchDePrueba,
	});
	const sifcos = Array.from({ length: 120 }, (_, i) => `0101021410${i}`);

	await cliente.getAllCreditos({
		mes: 0,
		anio: 2026,
		numeros_credito_sifco: sifcos,
		page: 1,
		perPage: sifcos.length,
	});

	expect(metodo).toBe("POST");
	expect(capturado.cuerpo).not.toBeNull();
	expect(capturado.cuerpo).not.toHaveProperty("estado");
	expect(capturado.cuerpo?.numeros_credito_sifco).toHaveLength(120);
});
