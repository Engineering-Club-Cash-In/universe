import { afterEach, describe, expect, test } from "bun:test";
import { clearCarteraTokens } from "./cartera-auth.service";
import { CarteraBackClient } from "./cartera-back-client";

const originalFetch = globalThis.fetch;
const originalCarteraUser = process.env.CARTERA_USER;
const originalCarteraPassword = process.env.CARTERA_PASSWORD;

afterEach(() => {
	globalThis.fetch = originalFetch;
	clearCarteraTokens();
	process.env.CARTERA_USER = originalCarteraUser;
	process.env.CARTERA_PASSWORD = originalCarteraPassword;
});

describe("CarteraBackClient.getMoraRecuperacionPorAsesor", () => {
	test("serializa el ciclo y filtros del reporte antes del límite de red", async () => {
		const requests: string[] = [];
		globalThis.fetch = Object.assign(
			async (input: RequestInfo | URL) => {
				const url = String(input);
				requests.push(url);
				if (url.endsWith("/auth/login")) {
					return Response.json({
						data: { accessToken: "test-token", refreshToken: "test-refresh" },
					});
				}
				return Response.json({
					periodo: { inicio: "2026-06-06", fin: "2026-07-06" },
					metadata: { alcance: "historico", atribucionAsesor: "actual" },
					totales: {
						esperado: "0.00",
						cobradoEnSnapshot: "0.00",
						cobradoFueraSnapshot: "0.00",
						excedenteEnSnapshot: "0.00",
						pendiente: "0.00",
					},
					porAsesor: [],
				});
			},
			{ preconnect: originalFetch.preconnect },
		);
		process.env.CARTERA_USER = "test@example.com";
		process.env.CARTERA_PASSWORD = "secret";

		await new CarteraBackClient({
			baseUrl: "http://cartera.test",
			retryAttempts: 0,
		}).getMoraRecuperacionPorAsesor({
			mes: 6,
			anio: 2026,
			asesores: [7, 8],
			emailCobrador: "cashin@example.com",
		});

		expect(requests).toEqual([
			"http://localhost:7000/auth/login",
			"http://cartera.test/reportes/mora-recuperacion-por-asesor?mes=6&anio=2026&asesores=7%2C8&email_cobrador=cashin%40example.com",
		]);
	});
});
