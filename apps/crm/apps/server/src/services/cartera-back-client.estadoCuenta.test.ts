import { describe, expect, test } from "bun:test";
import { CarteraBackClient, CarteraBackHttpError } from "./cartera-back-client";

/**
 * `fetchTransport` y `accessTokenProvider` son overrides explícitos del
 * constructor: evita depender de `globalThis.fetch` global (que
 * `CarteraBackClient` captura como default en tiempo de import del módulo,
 * antes de que un test pueda reemplazarlo) y del flujo real de
 * `/auth/login`, que no es lo que este test verifica.
 */
function buildClient(respond: (url: string) => Response | Promise<Response>): {
	client: CarteraBackClient;
	requests: string[];
} {
	const requests: string[] = [];
	const fetchTransport = (async (input: RequestInfo | URL) => {
		const url = String(input);
		requests.push(url);
		return respond(url);
	}) as typeof globalThis.fetch;

	const client = new CarteraBackClient({
		baseUrl: "http://cartera.test",
		retryAttempts: 0,
		accessTokenProvider: async () => "test-token",
		fetchTransport,
	});

	return { client, requests };
}

describe("CarteraBackClient.getEstadoCuentaUrl", () => {
	test("construye la URL exacta con el SIFCO URL-encodeado", async () => {
		const { client, requests } = buildClient(() =>
			Response.json({ excelUrl: "https://r2.example.com/estado.pdf" }),
		);

		await client.getEstadoCuentaUrl("SIFCO/2026 001");

		expect(requests).toEqual([
			"http://cartera.test/paymentByCredit?numero_credito_sifco=SIFCO%2F2026%20001&excel=true",
		]);
	});

	test("404 con codigo SIN_MOVIMIENTOS: motivo SIN_MOVIMIENTOS", async () => {
		const { client } = buildClient(() =>
			Response.json(
				{ message: "No hay pagos", codigo: "SIN_MOVIMIENTOS" },
				{ status: 404 },
			),
		);

		const r = await client.getEstadoCuentaUrl("SIFCO-001");
		expect(r).toEqual({ ok: false, motivo: "SIN_MOVIMIENTOS" });
	});

	test("404 con codigo CREDITO_NO_ENCONTRADO: motivo CREDITO_NO_ESTA_EN_CARTERA", async () => {
		const { client } = buildClient(() =>
			Response.json(
				{ message: "No existe", codigo: "CREDITO_NO_ENCONTRADO" },
				{ status: 404 },
			),
		);

		const r = await client.getEstadoCuentaUrl("SIFCO-001");
		expect(r).toEqual({ ok: false, motivo: "CREDITO_NO_ESTA_EN_CARTERA" });
	});

	test("404 pelado (sin codigo, error NOT_FOUND): lanza en vez de degradar a SIN_MOVIMIENTOS", async () => {
		const { client } = buildClient(() =>
			Response.json({ error: "NOT_FOUND" }, { status: 404 }),
		);

		await expect(client.getEstadoCuentaUrl("SIFCO-001")).rejects.toBeInstanceOf(
			CarteraBackHttpError,
		);
	});

	test("200 sin excelUrl: motivo CREDITO_NO_ESTA_EN_CARTERA", async () => {
		const { client } = buildClient(() => Response.json({}));

		const r = await client.getEstadoCuentaUrl("SIFCO-001");
		expect(r).toEqual({ ok: false, motivo: "CREDITO_NO_ESTA_EN_CARTERA" });
	});
});

describe("CarteraBackClient.getAsesorCredito", () => {
	test("consulta el resumen y devuelve únicamente contacto de asesor", async () => {
		const { client, requests } = buildClient(() =>
			Response.json({
				asesor: { nombre: "Carlos Ruiz", telefono: "41234567" },
			}),
		);

		const asesor = await client.getAsesorCredito("SIFCO/2026 001");

		expect(asesor).toEqual({ nombre: "Carlos Ruiz", telefono: "41234567" });
		expect(requests).toEqual([
			"http://cartera.test/credito/resumen?numero_credito_sifco=SIFCO%2F2026%20001",
		]);
	});

	test("falla opcional: no reintenta ni abre circuit breaker", async () => {
		const requests: string[] = [];
		const fetchTransport = (async (input: RequestInfo | URL) => {
			const url = String(input);
			requests.push(url);
			return url.endsWith("/health")
				? Response.json({})
				: Response.json({ error: "cartera caída" }, { status: 503 });
		}) as typeof globalThis.fetch;
		const client = new CarteraBackClient({
			baseUrl: "http://cartera.test",
			retryAttempts: 3,
			circuitBreakerThreshold: 1,
			accessTokenProvider: async () => "test-token",
			fetchTransport,
		});

		await expect(client.getAsesorCredito("SIFCO-001")).resolves.toBeNull();
		await expect(client.healthCheck()).resolves.toEqual({
			status: "healthy",
			circuitBreaker: "CLOSED",
		});
		expect(requests).toHaveLength(2);
	});
});
