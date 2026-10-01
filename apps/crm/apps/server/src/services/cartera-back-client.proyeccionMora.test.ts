import { describe, expect, test } from "bun:test";
import { CarteraBackClient } from "./cartera-back-client";

const proyeccion = {
	mes: "2026-10",
	hoy: "2026-10-30",
	cargoDiario: "3.73",
	moraInicioMes: "18.67",
	moraHoy: "70.00",
	moraFinMes: "77.07",
	dias: [
		{
			fecha: "2026-10-30",
			mora: "73.33",
			incremento: "3.33",
			acumuladoMes: "54.66",
			cuotasSumando: 1,
			tipo: "hoy" as const,
		},
	],
};

function clienteQueResponde(
	respuesta: () => Response,
	requests: string[] = [],
) {
	return new CarteraBackClient({
		baseUrl: "https://cartera.test",
		retryAttempts: 0,
		retryDelay: 0,
		enableCache: true,
		accessTokenProvider: async () => "test-token",
		fetchTransport: Object.assign(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				requests.push(
					`${init?.method} ${String(input)} ${new Headers(init?.headers).get("Authorization")}`,
				);
				return respuesta();
			},
			{ preconnect: globalThis.fetch.preconnect },
		),
	});
}

describe("CarteraBackClient.getProyeccionMora", () => {
	test("pide la proyección por número SIFCO, con el token de cartera", async () => {
		const requests: string[] = [];
		const cliente = clienteQueResponde(
			() => Response.json(proyeccion),
			requests,
		);

		expect(await cliente.getProyeccionMora("01 02/3")).toEqual(proyeccion);
		expect(requests).toEqual([
			"GET https://cartera.test/credito/mora/proyeccion?numero_credito_sifco=01%2002%2F3 Bearer test-token",
		]);
	});

	test("no se cachea: un pago recién registrado tiene que verse", async () => {
		const requests: string[] = [];
		const cliente = clienteQueResponde(
			() => Response.json(proyeccion),
			requests,
		);

		await cliente.getProyeccionMora("123");
		await cliente.getProyeccionMora("123");
		expect(requests.length).toBe(2);
	});

	test("un 200 sin días no pasa como proyección: falla DENTRO del breaker y el GET se reintenta", async () => {
		const requests: string[] = [];
		const cliente = new CarteraBackClient({
			baseUrl: "https://cartera.test",
			retryAttempts: 1,
			retryDelay: 0,
			// Umbral 2: los dos intentos malformados tienen que ABRIR el breaker. Si
			// la validación corriera después de `request()`, cada 200 contaría como
			// éxito, no habría reintento y el breaker seguiría cerrado.
			circuitBreakerThreshold: 2,
			accessTokenProvider: async () => "test-token",
			fetchTransport: Object.assign(
				async (input: RequestInfo | URL) => {
					requests.push(String(input));
					return Response.json({ message: "?" });
				},
				{ preconnect: globalThis.fetch.preconnect },
			),
		});

		await expect(cliente.getProyeccionMora("X")).rejects.toThrow(
			"Proyección de mora inválida para X",
		);
		expect(requests.length).toBe(2);
		await expect(cliente.getProyeccionMora("X")).rejects.toThrow(
			"Circuit breaker is OPEN",
		);
		expect(requests.length).toBe(2);
	});

	test("el 404 de cartera-back (crédito no encontrado) llega como error", async () => {
		const cliente = clienteQueResponde(() =>
			Response.json({ message: "Crédito no encontrado" }, { status: 404 }),
		);

		await expect(cliente.getProyeccionMora("X")).rejects.toThrow();
	});
});
