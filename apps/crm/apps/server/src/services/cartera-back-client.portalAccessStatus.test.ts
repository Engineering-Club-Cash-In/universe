import { expect, test } from "bun:test";
import { CarteraBackClient } from "./cartera-back-client";

const fetchTransport = (
	handler: (
		...args: Parameters<typeof globalThis.fetch>
	) => ReturnType<typeof globalThis.fetch>,
) => Object.assign(handler, { preconnect: globalThis.fetch.preconnect });

const respuesta = () => ({
	estado: "ya_tenia" as const,
	usuarioEmail: "ana@ejemplo.com",
	resueltoPor: "dpi" as const,
	advertencias: [] as string[],
	motivo: null,
});

test("pega con GET a /investor/portal-access-status con el id en el query", async () => {
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

	const actual = await client.consultarAccesoPortal(7);

	expect(actual).toEqual(esperado);
	expect(requestedUrl).toBe(
		"https://cartera.test/investor/portal-access-status?inversionista_id=7",
	);
	expect(requestedMethod).toBe("GET");
	expect(authorization).toBe("Bearer test-token");
	// Una consulta no lleva cuerpo.
	expect(requestedBody).toBeUndefined();
	// El nombre de la ruta es parte del candado: `carteraProxySuperficie.test.ts`
	// prohíbe la subcadena `portal-access` en el proxy de auth-google, así que
	// llamarla así la deja cubierta por esa misma prueba.
	expect(requestedUrl).toContain("portal-access");
});

test("un tropiezo de red SÍ se reintenta: es una lectura sin efectos", async () => {
	let llamadas = 0;
	const client = new CarteraBackClient({
		baseUrl: "https://cartera.test",
		retryAttempts: 2,
		retryDelay: 1,
		accessTokenProvider: async () => "test-token",
		fetchTransport: fetchTransport(async () => {
			llamadas += 1;
			return Response.json({ error: "boom" }, { status: 500 });
		}),
	});

	await expect(client.consultarAccesoPortal(7)).rejects.toThrow("boom");
	// A diferencia de `otorgarAccesoPortal`, repetir esto no le manda a nadie
	// otra contraseña: no hay nada que duplicar.
	expect(llamadas).toBe(3);
});

test("un rechazo de cartera-back se propaga en vez de devolver datos vacíos", async () => {
	// Un 404 o un 400 que se tragara y devolviera `{}` haría que el CRM
	// calculara `tieneCuentaSana: false` sobre nada, que se ve igual que una
	// respuesta legítima.
	const client = new CarteraBackClient({
		baseUrl: "https://cartera.test",
		retryAttempts: 0,
		accessTokenProvider: async () => "test-token",
		fetchTransport: fetchTransport(async () =>
			Response.json(
				{ message: "Inversionista no encontrado" },
				{ status: 404 },
			),
		),
	});

	await expect(client.consultarAccesoPortal(7)).rejects.toThrow(
		"Inversionista no encontrado",
	);
});
