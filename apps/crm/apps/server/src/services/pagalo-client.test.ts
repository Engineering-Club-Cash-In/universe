import { describe, expect, test } from "bun:test";
import {
	PagaloClientError,
	createPagaloClient,
	getPagaloSandboxConfig,
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
				received = request instanceof Request ? request : new Request(request, init);
				return new Response(
					JSON.stringify({ authorization: "echoed", branches: [{ name: "Central" }] }),
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
