import { expect, test } from "bun:test";
import { CarteraBackClient } from "./cartera-back-client";

const fetchTransport = (
	handler: (
		...args: Parameters<typeof globalThis.fetch>
	) => ReturnType<typeof globalThis.fetch>,
) => Object.assign(handler, { preconnect: globalThis.fetch.preconnect });

const respuesta = () => ({
	message: "Procesados 1 inversionista(s)",
	resultados: [
		{
			inversionistaId: 7,
			estado: "creada" as const,
			usuarioEmail: "ana@ejemplo.com",
			correo: {
				enviado: true,
				plantilla: "bienvenida",
				redirigido: false,
				destinatarioReal: null,
			},
			advertencias: [],
			motivo: null,
		},
	],
});

test("pega a /investor/portal-access con inversionista_ids como arreglo", async () => {
	const esperado = respuesta();
	let requestedUrl = "";
	let requestedMethod = "";
	let authorization = "";
	let requestedBody: BodyInit | null | undefined;
	const client = new CarteraBackClient({
		baseUrl: "https://cartera.test",
		retryAttempts: 0,
		accessTokenProvider: async () => "test-token",
		fetchTransport: fetchTransport(async (input, init) => {
			requestedUrl = String(input);
			requestedMethod = init?.method ?? "";
			authorization = new Headers(init?.headers).get("authorization") ?? "";
			requestedBody = init?.body;
			return Response.json(esperado);
		}),
	});

	const actual = await client.otorgarAccesoPortal([7]);

	expect(actual).toEqual(esperado);
	expect(requestedUrl).toBe("https://cartera.test/investor/portal-access");
	expect(requestedMethod).toBe("POST");
	expect(authorization).toBe("Bearer test-token");
	// El contrato de cartera es un ARREGLO (`t.Array(..., { minItems: 1 })`).
	// Mandar un escalar lo rebota con 400.
	expect(JSON.parse(String(requestedBody))).toEqual({ inversionista_ids: [7] });
});

test("un POST que manda contraseñas no se reintenta", async () => {
	let llamadas = 0;
	const client = new CarteraBackClient({
		baseUrl: "https://cartera.test",
		// Un 500 SÍ es reintentable para una lectura: si el método fuera
		// idempotente, estos 2 intentos extra ocurrirían.
		retryAttempts: 2,
		retryDelay: 1,
		accessTokenProvider: async () => "test-token",
		fetchTransport: fetchTransport(async () => {
			llamadas += 1;
			return Response.json({ error: "boom" }, { status: 500 });
		}),
	});

	await expect(client.otorgarAccesoPortal([7])).rejects.toThrow("boom");
	// Cada reintento le manda OTRA contraseña al inversionista.
	expect(llamadas).toBe(1);
});

// El 403 de cartera (no-ADMIN) no se prueba acá a propósito: `request()`
// reautentica una vez ante 401/403 y eso saldría a la red real desde la
// suite. El rechazo definitivo se prueba con el 400 de cartera.
test("un rechazo de cartera-back se propaga en vez de devolver datos vacíos", async () => {
	const client = new CarteraBackClient({
		baseUrl: "https://cartera.test",
		retryAttempts: 0,
		accessTokenProvider: async () => "test-token",
		fetchTransport: fetchTransport(async () =>
			Response.json(
				{ message: "Hay que indicar al menos un inversionista_id" },
				{ status: 400 },
			),
		),
	});

	await expect(client.otorgarAccesoPortal([7])).rejects.toThrow(
		"Hay que indicar al menos un inversionista_id",
	);
});
