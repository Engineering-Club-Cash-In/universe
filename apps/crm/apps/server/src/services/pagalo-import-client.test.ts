import { describe, expect, test } from "bun:test";
import {
	type PagaloImportCommand,
	prepararPagaloImportParaEnvio,
} from "./pagalo-import-client";

const command = (otrosTotal: string): PagaloImportCommand => ({
	crm_group_id: "d3100ac5-9e91-4f74-b513-9e8f394df37a",
	credito_id: 1234,
	numero_credito_sifco: "01010214108330",
	currency: "GTQ",
	capital_total: "5000.00",
	facturable_total: "850.00",
	otros_total: otrosTotal,
	total_amount: "5850.00",
	cuota_inicial: 3,
	allocations: [],
	capital: null,
	facturable: null,
	payload_hash: "a".repeat(64),
});

describe("prepararPagaloImportParaEnvio", () => {
	test("omite Otros en cero para cartera-back anterior", () => {
		expect(prepararPagaloImportParaEnvio(command("0.00"))).not.toHaveProperty(
			"otros_total",
		);
	});

	test("conserva Otros positivo para cartera-back actualizado", () => {
		expect(prepararPagaloImportParaEnvio(command("12.34"))).toMatchObject({
			otros_total: "12.34",
		});
	});
});
