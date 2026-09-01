import { describe, expect, test } from "bun:test";
import {
	createPagaloClient,
	getPagaloSandboxConfig,
	PagaloClientError,
	sanitizePagaloPayload,
	toPagaloProviderAmount,
} from "./pagalo-client";

describe("Págalo sandbox client", () => {
	test("rechaza cualquier host fuera de staging", () => {
		expect(() =>
			getPagaloSandboxConfig({
				PAGALO_BASE_URL: "https://api.pagalo.com",
				PAGALO_AUTHORIZATION: "secret",
			}),
		).toThrow(PagaloClientError);
	});

	test("GET usa authorization sin exponerlo en respuesta", async () => {
		let received: Request | undefined;
		const client = createPagaloClient(
			getPagaloSandboxConfig({ PAGALO_AUTHORIZATION: "sandbox-secret" }),
			async (request, init) => {
				received =
					request instanceof Request ? request : new Request(request, init);
				return new Response(
					JSON.stringify({
						authorization: "echoed",
						branches: [{ name: "Central" }],
					}),
				);
			},
		);
		await expect(client.getBranches()).resolves.toEqual({
			authorization: "[REDACTED]",
			branches: [{ name: "Central" }],
		});
		expect(received?.method).toBe("GET");
		expect(received?.headers.get("authorization")).toBe("sandbox-secret");
	});

	test("crear link queda bloqueado hasta flag explícito", async () => {
		const client = createPagaloClient(
			getPagaloSandboxConfig({ PAGALO_AUTHORIZATION: "sandbox-secret" }),
			async () => new Response("{}"),
		);
		await expect(
			client.createPaymentRequest({
				total_amount: 1,
				currency: "GTQ",
				description: "Prueba",
				external_identifier: "group-capital",
				type_request: "SP",
				n_quotas: false,
				expiration: false,
				client: { first_name: "Ana", last_name: "López" },
				products: [
					{
						name: "Capital",
						product_name: "Capital",
						amount: 1,
						quantity: 1,
						subtotal: 1,
					},
				],
			}),
		).rejects.toMatchObject({ code: "PAGALO_LINK_CREATION_DISABLED" });
	});

	test("sanitiza secretos anidados", () => {
		expect(
			sanitizePagaloPayload({ transaction: { card_number: "4111", ok: true } }),
		).toEqual({ transaction: { card_number: "[REDACTED]", ok: true } });
	});

	test("rechaza monto que Págalo no puede representar sin perder centavos", () => {
		expect(() => toPagaloProviderAmount("9999999999999999.99")).toThrow(
			"no puede representar",
		);
	});

	test("rechaza monto que JSON redondea al serializar", () => {
		expect(() => toPagaloProviderAmount("90071992547409.91")).toThrow(
			"no puede representar",
		);
	});
});

describe("tope de espera de las consultas", () => {
	const config = {
		baseUrl: "https://api.pagalodev.com",
		authorization: "test",
		linkCreationEnabled: true,
	};

	test("una consulta que no responde se corta y sale como PAGALO_TIMEOUT", async () => {
		// Sin esto el poller se cuelga en silencio: reclama los links y nunca
		// escribe intento ni error (caso real en dev, 2026-09-01).
		const fetchQueNuncaResponde = (_input: any, init: any = {}) =>
			new Promise<Response>((_resolve, reject) => {
				init.signal?.addEventListener("abort", () => {
					const error = new Error("aborted");
					error.name = "TimeoutError";
					reject(error);
				});
			});
		const client = createPagaloClient(config, fetchQueNuncaResponde as any);
		const previo = process.env.PAGALO_TIMEOUT_MS;
		process.env.PAGALO_TIMEOUT_MS = "50";
		try {
			await expect(client.getRequestByUuid("uuid-1")).rejects.toMatchObject({
				code: "PAGALO_TIMEOUT",
			});
		} finally {
			process.env.PAGALO_TIMEOUT_MS = previo;
		}
	});

	test("las consultas llevan signal; la creación de links NO", async () => {
		// Abortar el POST que crea el link no diría si Págalo alcanzó a
		// crearlo, y ese link quedaría cobrable sin que lo sepamos.
		const señales: Array<AbortSignal | null | undefined> = [];
		const fetchEspia = (_input: any, init: any = {}) => {
			señales.push(init.signal);
			return Promise.resolve(
				new Response(JSON.stringify({ ok: true }), { status: 200 }),
			);
		};
		const client = createPagaloClient(config, fetchEspia as any);

		await client.getRequestByUuid("uuid-1");
		await client.getTransactionByIdExternalRaw("ext-1");
		await client.createPaymentRequest({
			total_amount: 10,
			currency: "GTQ",
			description: "Pago de prueba",
			external_identifier: "ext-1",
			type_request: "SP",
			n_quotas: false,
			expiration: false,
			client: {},
			products: [
				{
					name: "Pago",
					product_name: "Pago",
					amount: 10,
					quantity: 1,
					subtotal: 10,
				},
			],
		});

		expect(señales[0]).toBeInstanceOf(AbortSignal);
		expect(señales[1]).toBeInstanceOf(AbortSignal);
		expect(señales[2]).toBeUndefined();
	});
});
