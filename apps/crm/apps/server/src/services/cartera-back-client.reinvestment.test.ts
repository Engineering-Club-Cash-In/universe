import { expect, test } from "bun:test";
import { fetchReinvestmentLiquidaciones } from "../routers/reportes-cartera";
import type { ReinversionLiquidacionesResponse } from "./cartera-back-client";
import { CarteraBackClient } from "./cartera-back-client";

const fetchTransport = (
	handler: (
		...args: Parameters<typeof globalThis.fetch>
	) => ReturnType<typeof globalThis.fetch>,
) => Object.assign(handler, { preconnect: globalThis.fetch.preconnect });

const response = (): ReinversionLiquidacionesResponse => ({
	contrato_version: 2,
	porTipo: {
		reinversion_capital: {
			reinversion_capital: "40.00",
			reinversion_interes: "0.00",
			reinversion_total: "40.00",
			total_capital: "40.00",
			total_interes: "5.00",
			total_iva: "0.00",
			total_isr: "0.35",
			total_cuota: "4.65",
			iva_facturado: "0.00",
			total_distribuido: "44.65",
			cantidad_liquidaciones: 1,
		},
	},
	interesNeto: {
		noVerificado: { interes: "5.00" },
		cube: { interes: "0.00", iva: "0.00", neto: "0.00" },
	},
	pagosExtras: { abonos_capital: "0.00", cancelaciones: "0.00" },
	porInversionista: [
		{
			inversionista_id: 7,
			nombre: "Ana",
			tipo_reinversion: "reinversion_capital",
			reinversion_capital: "40.00",
			reinversion_interes: "0.00",
			reinversion: "40.00",
			a_recibir: "4.65",
			capital_activo: "1000.00",
		},
	],
	comprasMes: [{ tipo: "reinversion_capital", cantidad: 2, monto: "80.00" }],
	detalleInteresNeto: [
		{
			inversionista_id: 7,
			inversionista: "Ana",
			referencia: "LIQ-7",
			tratamiento_fiscal: "no_verificado",
			interes: "5.00",
			iva: "0.00",
			isr: "0.00",
		},
	],
	detallePagosExtras: [],
	detalleComprasMes: [
		{
			fecha: "2026-07-03",
			inversionista: "Ana",
			modalidad: "reinversion_capital",
			monto: "40.00",
		},
		{
			fecha: "2026-07-03",
			inversionista: "Ana",
			modalidad: "reinversion_capital",
			monto: "40.00",
		},
	],
	detalle_estado: {
		disponible: false,
		error: "Detalle temporalmente no disponible.",
	},
	cantidad_liquidaciones: 1,
});

test("cliente HTTP propaga íntegro el contrato real de reinversión sin reconstruir detalles", async () => {
	const expected = response();
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
			return Response.json(expected);
		}),
	});
	const actual = await client.getReinversionLiquidaciones({
		mes: 7,
		anio: 2026,
	});

	expect(actual).toEqual(expected);
	expect(actual.contrato_version).toBe(2);
	expect(actual.porInversionista[0]?.capital_activo).toBe("1000.00");
	expect(actual.detalle_estado).toEqual(expected.detalle_estado);
	expect(actual.detalleInteresNeto).toEqual(expected.detalleInteresNeto);
	expect(actual.detallePagosExtras).toEqual(expected.detallePagosExtras);
	expect(actual.detalleComprasMes).toEqual(expected.detalleComprasMes);
	expect(actual.porTipo.reinversion_capital.cantidad_liquidaciones).toBe(1);
	expect(requestedUrl).toBe(
		"https://cartera.test/reportes/reinversion-liquidaciones?mes=7&anio=2026",
	);
	expect(requestedMethod).toBe("GET");
	expect(authorization).toBe("Bearer test-token");
	expect(requestedBody).toBeUndefined();
});

test("router CRM devuelve sin pérdida el contrato recibido de cartera-back", async () => {
	const expected = response();
	const client = new CarteraBackClient({
		baseUrl: "https://cartera.test",
		retryAttempts: 0,
		accessTokenProvider: async () => "router-test-token",
		fetchTransport: fetchTransport(async () => Response.json(expected)),
	});
	const actual = await fetchReinvestmentLiquidaciones(
		{ mes: 7, anio: 2026 },
		client,
	);

	expect(actual).toEqual(expected);
	expect(actual.comprasMes[0]).toMatchObject({
		cantidad: 2,
		monto: "80.00",
	});
	expect(actual.detalleComprasMes).toHaveLength(2);
	expect(actual.porInversionista[0]?.capital_activo).toBe("1000.00");
	expect(actual.detalle_estado.disponible).toBe(false);
	expect(actual.porTipo.reinversion_capital.cantidad_liquidaciones).toBe(1);
});

test("error total de cartera-back se propaga y no se convierte en datos parciales", async () => {
	const client = new CarteraBackClient({
		baseUrl: "https://cartera.test",
		retryAttempts: 0,
		accessTokenProvider: async () => "error-test-token",
		fetchTransport: fetchTransport(async () =>
			Response.json(
				{ error: "No fue posible generar el reporte" },
				{ status: 503 },
			),
		),
	});

	await expect(
		fetchReinvestmentLiquidaciones({ mes: 7, anio: 2026 }, client),
	).rejects.toThrow("No fue posible generar el reporte");
});

test("cliente HTTP rechaza un contrato malformado antes de republicarlo por ORPC", async () => {
	const malformed = response() as unknown as Record<string, unknown>;
	malformed.cantidad_liquidaciones = -1;
	const client = new CarteraBackClient({
		baseUrl: "https://cartera.test",
		retryAttempts: 0,
		accessTokenProvider: async () => "test-token",
		fetchTransport: fetchTransport(async () => Response.json(malformed)),
	});

	await expect(
		client.getReinversionLiquidaciones({ mes: 7, anio: 2026 }),
	).rejects.toThrow("Contrato de reinversión inválido");
});

test("cliente HTTP rechaza categorías, ids, cantidades, montos y estados de detalle inválidos", async () => {
	const invalid = [
		(data: Record<string, unknown>) => {
			data.porTipo = { inventado: response().porTipo.reinversion_capital };
		},
		(data: Record<string, unknown>) => {
			(data.porInversionista as Record<string, unknown>[])[0].inversionista_id =
				1.5;
		},
		(data: Record<string, unknown>) => {
			(data.comprasMes as Record<string, unknown>[])[0].cantidad = -1;
		},
		(data: Record<string, unknown>) => {
			(data.pagosExtras as Record<string, unknown>).abonos_capital = "-0.01";
		},
		(data: Record<string, unknown>) => {
			(data.pagosExtras as Record<string, unknown>).abonos_capital = "1e2";
		},
		(data: Record<string, unknown>) => {
			(data.pagosExtras as Record<string, unknown>).abonos_capital = "0x10";
		},
		(data: Record<string, unknown>) => {
			data.detalle_estado = { disponible: true, error: "contradictorio" };
		},
		(data: Record<string, unknown>) => {
			data.detalle_estado = { disponible: false, error: " " };
		},
	];

	for (const mutate of invalid) {
		const malformed = response() as unknown as Record<string, unknown>;
		mutate(malformed);
		const client = new CarteraBackClient({
			baseUrl: "https://cartera.test",
			retryAttempts: 0,
			accessTokenProvider: async () => "test-token",
			fetchTransport: fetchTransport(async () => Response.json(malformed)),
		});
		await expect(
			client.getReinversionLiquidaciones({ mes: 7, anio: 2026 }),
		).rejects.toThrow("Contrato de reinversión inválido");
	}
});
