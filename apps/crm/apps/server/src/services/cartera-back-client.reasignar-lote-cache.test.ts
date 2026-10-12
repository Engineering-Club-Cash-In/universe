import { expect, test } from "bun:test";
import { CarteraBackClient } from "./cartera-back-client";

const LISTADO = {
	data: [],
	page: 1,
	perPage: 1,
	total: 0,
	totalPages: 1,
};

test("una lectura en vuelo al reasignar un lote no vuelve a llenar la caché con datos viejos", async () => {
	let lecturas = 0;
	let soltarLectura: () => void = () => {};
	const lecturaPendiente = new Promise<void>((resolver) => {
		soltarLectura = resolver;
	});
	const fetchDePrueba = (async (_url: unknown, init?: RequestInit) => {
		if (init?.method === "POST") {
			return new Response(
				JSON.stringify({
					success: true,
					asesor_nuevo: 2,
					reasignados: [],
					omitidos: [],
				}),
			);
		}
		lecturas += 1;
		// La primera lectura queda en vuelo hasta que se la suelta.
		if (lecturas === 1) await lecturaPendiente;
		return new Response(JSON.stringify(LISTADO));
	}) as unknown as typeof fetch;
	const cliente = new CarteraBackClient({
		baseUrl: "http://cartera-back.test",
		enableCache: true,
		accessTokenProvider: async () => "token-de-prueba",
		fetchTransport: fetchDePrueba,
	});
	const params = { mes: 0, anio: 0, page: 1, perPage: 1 };

	const enVuelo = cliente.getAllCreditos(params);
	await cliente.reasignarAsesorLote({
		credito_ids: [1],
		asesor_nuevo_id: 2,
		motivo: "prueba",
	});
	soltarLectura();
	await enVuelo;

	// La respuesta de la lectura que empezó antes del lote no se guardó: esta
	// segunda lectura tiene que ir a cartera.
	await cliente.getAllCreditos(params);
	expect(lecturas).toBe(2);
});

test("sin invalidaciones en el medio, la lectura sí se cachea", async () => {
	let lecturas = 0;
	const fetchDePrueba = (async () => {
		lecturas += 1;
		return new Response(JSON.stringify(LISTADO));
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
	expect(lecturas).toBe(1);
});

test("si el POST no obtiene respuesta, la caché se vuelve a invalidar más tarde", async () => {
	const temporizadores: Array<{ fn: () => void; ms: number }> = [];
	const setTimeoutOriginal = globalThis.setTimeout;
	globalThis.setTimeout = ((fn: () => void, ms?: number) => {
		temporizadores.push({ fn, ms: ms ?? 0 });
		return { unref() {} } as unknown as ReturnType<typeof setTimeout>;
	}) as unknown as typeof setTimeout;
	try {
		let lecturas = 0;
		const fetchDePrueba = (async (_url: unknown, init?: RequestInit) => {
			if (init?.method === "POST") throw new TypeError("fetch failed");
			lecturas += 1;
			return new Response(JSON.stringify(LISTADO));
		}) as unknown as typeof fetch;
		const cliente = new CarteraBackClient({
			baseUrl: "http://cartera-back.test",
			enableCache: true,
			accessTokenProvider: async () => "token-de-prueba",
			fetchTransport: fetchDePrueba,
		});
		const params = { mes: 0, anio: 0, page: 1, perPage: 1 };
		await expect(
			cliente.reasignarAsesorLote({
				credito_ids: [1],
				asesor_nuevo_id: 2,
				motivo: "prueba",
			}),
		).rejects.toBeDefined();
		// Una lectura posterior se cachea (con dueños que pueden ser viejos)...
		await cliente.getAllCreditos(params);
		await cliente.getAllCreditos(params);
		expect(lecturas).toBe(1);
		// ...pero hay invalidaciones agendadas que la limpian cuando el lote
		// pudo haber confirmado.
		const agendadas = temporizadores.filter((t) => t.ms >= 15_000);
		expect(agendadas.length).toBeGreaterThanOrEqual(3);
		for (const t of agendadas) t.fn();
		await cliente.getAllCreditos(params);
		expect(lecturas).toBe(2);
	} finally {
		globalThis.setTimeout = setTimeoutOriginal;
	}
});
