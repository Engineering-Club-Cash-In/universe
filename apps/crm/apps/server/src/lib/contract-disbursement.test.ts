import { describe, expect, test } from "bun:test";
import {
	type DisbursementCheck,
	mapChecksToDisbursementRows,
} from "./contract-disbursement";

/**
 * Los dos cheques reales de la oportunidad 717c9882-311f-4c34-921f-76a51ff04c30,
 * ambos del 17/08/2026: es el caso que obliga a desempatar por `createdAt`.
 */
const chequeCube: DisbursementCheck = {
	id: "11111111-1111-1111-1111-111111111111",
	beneficiary: "Cube Investments, S.A",
	amount: "9961.70",
	currency: "GTQ",
	checkDate: new Date("2026-08-17T11:35:56Z"),
	createdAt: new Date("2026-08-17T11:35:56Z"),
};

const chequeJunior: DisbursementCheck = {
	id: "22222222-2222-2222-2222-222222222222",
	beneficiary: "Junior Manuel Gil Duarte",
	amount: "48000.00",
	currency: "GTQ",
	checkDate: new Date("2026-08-17T11:36:52Z"),
	createdAt: new Date("2026-08-17T11:36:52Z"),
};

describe("mapChecksToDisbursementRows", () => {
	test("respeta el orden de la pantalla de Emisión de Cheques", () => {
		const { filas, sobrantes } = mapChecksToDisbursementRows([
			chequeCube,
			chequeJunior,
		]);

		expect(filas).toEqual([
			{ cuenta: "Junior Manuel Gil Duarte", valor: "48,000.00" },
			{ cuenta: "Cube Investments, S.A", valor: "9,961.70" },
		]);
		expect(sobrantes).toBe(0);
	});

	test("el orden no depende de cómo vengan los cheques", () => {
		const enOrden = mapChecksToDisbursementRows([chequeCube, chequeJunior]);
		const alReves = mapChecksToDisbursementRows([chequeJunior, chequeCube]);

		expect(alReves.filas).toEqual(enOrden.filas);
	});

	test("la celda lleva solo el beneficiario, sin número de cuenta", () => {
		// Es como jurídico lo escribió en los contratos ya generados
		const { filas } = mapChecksToDisbursementRows([chequeJunior]);

		expect(filas[0].cuenta).toBe("Junior Manuel Gil Duarte");
	});

	test("con un solo cheque no inventa la segunda fila", () => {
		const { filas, sobrantes } = mapChecksToDisbursementRows([chequeJunior]);

		// La plantilla imprime "Q. {valor2}": una fila de relleno dejaría una
		// "Q." suelta en el contrato.
		expect(filas).toHaveLength(1);
		expect(sobrantes).toBe(0);
	});

	test("sin cheques devuelve la carta vacía sin reventar", () => {
		expect(mapChecksToDisbursementRows([])).toEqual({
			filas: [],
			sobrantes: 0,
			omitidosPorMoneda: 0,
		});
	});

	test("con más de dos cheques llena los dos primeros y reporta el resto", () => {
		const tercero: DisbursementCheck = {
			...chequeCube,
			id: "33333333-3333-3333-3333-333333333333",
			beneficiary: "Tercero",
			amount: "100.00",
			checkDate: new Date("2026-08-15T09:00:00Z"),
			createdAt: new Date("2026-08-15T09:00:00Z"),
		};

		const { filas, sobrantes } = mapChecksToDisbursementRows([
			chequeCube,
			chequeJunior,
			tercero,
		]);

		expect(filas).toHaveLength(2);
		expect(filas.map((f) => f.cuenta)).not.toContain("Tercero");
		expect(sobrantes).toBe(1);
	});

	test("descarta cheques que no están en quetzales", () => {
		const enDolares: DisbursementCheck = {
			...chequeJunior,
			id: "44444444-4444-4444-4444-444444444444",
			currency: "USD",
		};

		const { filas, omitidosPorMoneda } = mapChecksToDisbursementRows([
			chequeCube,
			enDolares,
		]);

		expect(filas).toEqual([
			{ cuenta: "Cube Investments, S.A", valor: "9,961.70" },
		]);
		expect(omitidosPorMoneda).toBe(1);
	});

	test("la fecha más reciente manda sobre el orden de creación", () => {
		const viejoPeroRecienCreado: DisbursementCheck = {
			...chequeCube,
			id: "55555555-5555-5555-5555-555555555555",
			checkDate: new Date("2026-08-01T00:00:00Z"),
			createdAt: new Date("2026-09-01T00:00:00Z"),
		};

		const { filas } = mapChecksToDisbursementRows([
			viejoPeroRecienCreado,
			chequeJunior,
		]);

		expect(filas[0].cuenta).toBe("Junior Manuel Gil Duarte");
	});

	test("ignora cheques sin beneficiario o con monto inválido", () => {
		const sinBeneficiario: DisbursementCheck = {
			...chequeCube,
			id: "66666666-6666-6666-6666-666666666666",
			beneficiary: "   ",
		};
		const montoRoto: DisbursementCheck = {
			...chequeCube,
			id: "77777777-7777-7777-7777-777777777777",
			amount: "no-es-un-monto",
		};

		const { filas } = mapChecksToDisbursementRows([
			sinBeneficiario,
			montoRoto,
			chequeJunior,
		]);

		expect(filas).toHaveLength(1);
		expect(filas[0].cuenta).toBe("Junior Manuel Gil Duarte");
	});

	test("acepta fechas en string, como llegan serializadas", () => {
		const { filas } = mapChecksToDisbursementRows([
			{ ...chequeCube, checkDate: "2026-08-17T11:35:56Z" },
			{ ...chequeJunior, checkDate: "2026-08-17T11:36:52Z" },
		]);

		expect(filas[0].cuenta).toBe("Junior Manuel Gil Duarte");
	});
});
