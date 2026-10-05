import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import type { CreditoDirectoResponse } from "../types/cartera-back";
import { buildCasoFromCartera } from "./build-caso-from-cartera";
import { calcularDiasMoraExactos } from "./mora-utils";

/**
 * Construir el objeto de caso que se devuelve en la API del CRM.
 * El defecto que se arregla: moraPagada no se pasaba aunque cartera-back
 * lo devolviera en la respuesta.
 */

describe("buildCasoFromCartera: construir objeto caso con moraPagada", () => {
	// Helper para crear datos mínimos de cartera válidos
	const creditoDataBase: CreditoDirectoResponse = {
		credito: {
			credito_id: 1001,
			usuario_id: 101,
			numero_credito_sifco: "2024-0001",
			fecha_creacion: "2024-01-15",
			capital: "10000.00",
			porcentaje_interes: "12.00",
			deudatotal: "12000.00",
			cuota_interes: "100.00",
			cuota: "1000.00",
			iva_12: "0.00",
			seguro_10_cuotas: "0.00",
			gps: "0.00",
			plazo: 12,
			asesor_id: 1,
			membresias: "0.00",
			membresias_pago: "0.00",
			formato_credito: null,
			porcentaje_royalti: "0.00",
			tipoCredito: null,
			royalti: "0.00",
			statusCredit: "ACTIVO",
			otros: "0.00",
			observaciones: null,
			no_poliza: null,
		},
		usuario: {
			usuario_id: 101,
			nombre: "Cliente Test",
			nit: "1234567890101",
			categoria: null,
			saldo_a_favor: "0.00",
			como_se_entero: null,
		},
		asesor: {
			asesor_id: 1,
			nombre: "Asesor Test",
			telefono: null,
			activo: true,
			emailCashIn: null,
		},
		cuotasPagadas: [],
		cuotasPendientes: [],
		cuotasAtrasadas: [],
		moraActual: "0.00",
	};

	test("caso 1: con moraPagada en la respuesta de cartera → llega al objeto de la ficha", () => {
		const creditoData: CreditoDirectoResponse = {
			...creditoDataBase,
			moraActual: "250.50",
			moraPagada: "150.25",
			diasAtrasoMoraMaximo: 5,
			cuotasAtrasadas: [
				{
					cuota_id: 1,
					credito_id: 1001,
					numero_cuota: 1,
					fecha_vencimiento: "2024-02-01",
					pagado: false,
					createdAt: "2024-01-01T00:00:00Z",
				},
			],
		};

		const caso = buildCasoFromCartera(creditoData);

		expect(caso.moraPagada).toBe("150.25");
	});

	test("caso 2: sin moraPagada en la respuesta de cartera → el objeto lo tiene undefined", () => {
		const creditoData: CreditoDirectoResponse = {
			...creditoDataBase,
			moraActual: "0.00",
			// moraPagada no se envía deliberadamente
			diasAtrasoMoraMaximo: 0,
		};

		const caso = buildCasoFromCartera(creditoData);

		expect(caso.moraPagada).toBeUndefined();
	});

	test("moraPagada es string, no número ni número cero", () => {
		const creditoData: CreditoDirectoResponse = {
			...creditoDataBase,
			moraActual: "0.00",
			moraPagada: "0.00",
			diasAtrasoMoraMaximo: 0,
		};

		const caso = buildCasoFromCartera(creditoData);

		// Debe ser el string "0.00", no undefined
		expect(caso.moraPagada).toBe("0.00");
		expect(typeof caso.moraPagada).toBe("string");
	});

	test("otros campos se construyen correctamente", () => {
		const creditoData: CreditoDirectoResponse = {
			...creditoDataBase,
			moraActual: "100.00",
			moraPagada: "50.00",
			diasAtrasoMoraMaximo: 10,
			cuotasAtrasadas: [
				{
					cuota_id: 1,
					credito_id: 1001,
					numero_cuota: 1,
					fecha_vencimiento: "2024-02-01",
					pagado: false,
					createdAt: "2024-01-01T00:00:00Z",
				},
			],
		};

		const caso = buildCasoFromCartera(creditoData);

		expect(caso.creditoId).toBe(1001);
		expect(caso.numeroSifco).toBe("2024-0001");
		expect(caso.usuario.nombre).toBe("Cliente Test");
		expect(caso.montoMora).toBe("100.00");
		expect(caso.moraPagada).toBe("50.00");
		expect(caso.diasMora).toBe(10);
		expect(caso.cuotasAtrasadas).toBe(1);
	});

	test("caso 3: con moraCondonada en la respuesta de cartera → llega al objeto de la ficha", () => {
		const creditoData: CreditoDirectoResponse = {
			...creditoDataBase,
			moraActual: "250.50",
			moraPagada: "150.25",
			moraCondonada: "100.00",
			diasAtrasoMoraMaximo: 5,
			cuotasAtrasadas: [
				{
					cuota_id: 1,
					credito_id: 1001,
					numero_cuota: 1,
					fecha_vencimiento: "2024-02-01",
					pagado: false,
					createdAt: "2024-01-01T00:00:00Z",
				},
			],
		};

		const caso = buildCasoFromCartera(creditoData);

		expect(caso.moraPagada).toBe("150.25");
		expect(caso.moraCondonada).toBe("100.00");
	});

	test("caso 4: sin moraCondonada en la respuesta de cartera → el objeto lo tiene undefined", () => {
		const creditoData: CreditoDirectoResponse = {
			...creditoDataBase,
			moraActual: "0.00",
			moraPagada: "50.00",
			// moraCondonada no se envía deliberadamente
			diasAtrasoMoraMaximo: 0,
		};

		const caso = buildCasoFromCartera(creditoData);

		expect(caso.moraCondonada).toBeUndefined();
	});

	test("moraCondonada es string, no número", () => {
		const creditoData: CreditoDirectoResponse = {
			...creditoDataBase,
			moraActual: "0.00",
			moraPagada: "0.00",
			moraCondonada: "0.00",
			diasAtrasoMoraMaximo: 0,
		};

		const caso = buildCasoFromCartera(creditoData);

		// Debe ser el string "0.00"
		expect(caso.moraCondonada).toBe("0.00");
		expect(typeof caso.moraCondonada).toBe("string");
	});
});

describe("guarda: el detalle del caso (getDetallesCreditoCarteraBack) pasa lo abonado a mora", () => {
	// La pantalla cobros/$id lee caso.moraPagada / caso.moraCondonada de ESTE
	// endpoint, que arma su respuesta a mano (no pasa por buildCasoFromCartera).
	test("la respuesta lleva moraPagada y moraCondonada del crédito", () => {
		const fuente = readFileSync(new URL("../routers/cobros.ts", import.meta.url), "utf8");
		const inicio = fuente.indexOf("getDetallesCreditoCarteraBack: cobrosProcedure");
		const fin = fuente.indexOf(": cobrosProcedure", inicio + 50);
		const cuerpo = fuente.slice(inicio, fin);
		expect(cuerpo).toContain("moraPagada: creditoCompleto.moraPagada");
		expect(cuerpo).toContain("moraCondonada: creditoCompleto.moraCondonada");
	});
});
