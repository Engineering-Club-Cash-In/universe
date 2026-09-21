import { describe, expect, test } from "bun:test";
import {
	buildRenapFullName,
	getMissingContractParties,
	renapGenderToVendorGender,
} from "./contract-parties";

describe("buildRenapFullName", () => {
	test("une nombres y apellidos sin dejar espacios dobles", () => {
		expect(
			buildRenapFullName({
				firstName: "CARLOS",
				secondName: "",
				thirdName: null,
				firstLastName: "DE LEÓN",
				secondLastName: "PÉREZ",
				marriedLastName: "",
			}),
		).toBe("CARLOS DE LEÓN PÉREZ");
	});

	test("antepone DE al apellido de casada", () => {
		expect(
			buildRenapFullName({
				firstName: "SONIA",
				secondName: "LETICIA",
				firstLastName: "MEJÍA",
				marriedLastName: "LEÓN",
			}),
		).toBe("SONIA LETICIA MEJÍA DE LEÓN");
	});
});

describe("renapGenderToVendorGender", () => {
	test("traduce el sexo de RENAP", () => {
		expect(renapGenderToVendorGender("M")).toBe("male");
		expect(renapGenderToVendorGender("F")).toBe("female");
		expect(renapGenderToVendorGender(null)).toBeNull();
	});
});

describe("getMissingContractParties", () => {
	const base = { vehicleId: "v1" };

	test("sin vehículo no pide nada", () => {
		expect(getMissingContractParties({ vehicleIsNew: true })).toEqual([]);
	});

	test("carro nuevo pide empresa con razón social", () => {
		expect(getMissingContractParties({ ...base, vehicleIsNew: true })).toEqual([
			"agencia",
		]);
		expect(
			getMissingContractParties({
				...base,
				vehicleIsNew: true,
				companyId: "c1",
				companyRazonSocial: "  ",
			}),
		).toEqual(["agencia"]);
		expect(
			getMissingContractParties({
				...base,
				vehicleIsNew: true,
				companyId: "c1",
				companyRazonSocial: "JAC GUATEMALA, SOCIEDAD ANÓNIMA",
			}),
		).toEqual([]);
	});

	test("carro usado (o sin marcar) pide vendedor con género", () => {
		expect(getMissingContractParties({ ...base, vehicleIsNew: null })).toEqual([
			"vendedor",
		]);
		expect(
			getMissingContractParties({ ...base, vehicleIsNew: false, vendorId: "x" }),
		).toEqual(["vendedor"]);
		expect(
			getMissingContractParties({
				...base,
				vehicleIsNew: false,
				vendorId: "x",
				vendorGender: "female",
			}),
		).toEqual([]);
	});
});
