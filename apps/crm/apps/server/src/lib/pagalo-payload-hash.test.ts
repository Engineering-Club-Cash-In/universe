import { describe, expect, test } from "bun:test";
import {
	calcularPagaloPayloadHash,
	type PagaloCommandForHash,
} from "./pagalo-payload-hash";

const baseCommand = (): PagaloCommandForHash => ({
	crm_group_id: "d3100ac5-9e91-4f74-b513-9a8f394df37a",
	credito_id: 1234,
	numero_credito_sifco: "01010214108330",
	currency: "GTQ",
	capital_total: "5000.00",
	facturable_total: "850.00",
	total_amount: "5850.00",
	cuota_inicial: 3,
	allocations: [
		{ link_type: "CAPITAL", cartera_cuota_id: 301, numero_cuota: 3, rubro: "CAPITAL", amount: "5000.00", facturable: false },
		{ link_type: "MORA_INTERES", cartera_cuota_id: 301, numero_cuota: 3, rubro: "INTERES", amount: "850.00", facturable: true },
	],
	capital: {
		transaction_uuid: "7c9e8dc3-e8dc-4a90-8afb-0f74f7419712",
		external_identifier: "CB028-CAPITAL",
		paid_at: "2026-08-24T18:00:00.000Z",
		voucher_storage_key: "pagalo/d3100ac5/capital.pdf",
	},
	facturable: {
		transaction_uuid: "96ea928a-93e5-44d5-b9b3-c88fa1e57e82",
		external_identifier: "CB028-MORA-INTERES",
		paid_at: "2026-08-24T18:02:00.000Z",
		voucher_storage_key: "pagalo/d3100ac5/mora-interes.pdf",
	},
});

describe("calcularPagaloPayloadHash", () => {
	test("determinístico: mismo comando produce siempre el mismo hash", () => {
		const a = calcularPagaloPayloadHash(baseCommand());
		const b = calcularPagaloPayloadHash(baseCommand());
		expect(a).toBe(b);
	});

	test("pasa el regex que exige cartera-back", () => {
		const hash = calcularPagaloPayloadHash(baseCommand());
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});

	test("orden distinto de allocations en el input da el mismo hash", () => {
		const command = baseCommand();
		const invertido: PagaloCommandForHash = {
			...command,
			allocations: [...command.allocations].reverse(),
		};
		expect(calcularPagaloPayloadHash(command)).toBe(
			calcularPagaloPayloadHash(invertido),
		);
	});

	test("cambiar un monto cambia el hash", () => {
		const command = baseCommand();
		const distinto: PagaloCommandForHash = {
			...command,
			total_amount: "5851.00",
		};
		expect(calcularPagaloPayloadHash(command)).not.toBe(
			calcularPagaloPayloadHash(distinto),
		);
	});

	test("capital null (Q0, D-48) se distingue de tenerlo presente", () => {
		const conCapital = baseCommand();
		const sinCapital: PagaloCommandForHash = { ...conCapital, capital: null };
		expect(calcularPagaloPayloadHash(conCapital)).not.toBe(
			calcularPagaloPayloadHash(sinCapital),
		);
	});

	test("request_id/request_auth ausentes vs presentes cambian el hash", () => {
		const command = baseCommand();
		const conRequestId: PagaloCommandForHash = {
			...command,
			capital: { ...command.capital!, request_id: "148600", request_auth: "977076" },
		};
		expect(calcularPagaloPayloadHash(command)).not.toBe(
			calcularPagaloPayloadHash(conRequestId),
		);
	});
});
