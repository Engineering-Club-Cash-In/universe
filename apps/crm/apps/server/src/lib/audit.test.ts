import { describe, expect, test } from "bun:test";
import {
	describeAuditError,
	prepareAuditInput,
	redactAuditInput,
	resolveAuditEntityId,
} from "./audit";

describe("redactAuditInput", () => {
	test("keeps small form-like inputs intact", () => {
		const input = {
			id: "opp-1",
			title: "Crédito",
			probability: 25,
			active: true,
			tags: ["a", "b"],
			nested: { leadId: "lead-1", note: null },
		};
		expect(redactAuditInput(input)).toEqual(input);
	});

	test("hides base64 payloads and secrets by key name", () => {
		expect(
			redactAuditInput({
				vehicleId: "v-1",
				imageBase64: "AAAA",
				fileBase64: "BBBB",
				password: "x",
				otpCode: "123456",
			}),
		).toEqual({
			vehicleId: "v-1",
			imageBase64: "<omitido>",
			fileBase64: "<omitido>",
			password: "<omitido>",
			otpCode: "<omitido>",
		});
	});

	test("truncates long strings even when the key looks harmless", () => {
		const long = "x".repeat(5_000);
		expect(redactAuditInput({ notes: long })).toEqual({
			notes: "<omitido: 5000 chars>",
		});
	});

	test("serializes dates, drops undefined and caps arrays", () => {
		const date = new Date("2026-08-27T12:00:00.000Z");
		const result = redactAuditInput({
			when: date,
			missing: undefined,
			items: Array.from({ length: 150 }, (_, i) => i),
		}) as Record<string, unknown>;
		expect(result.when).toBe("2026-08-27T12:00:00.000Z");
		expect("missing" in result).toBe(false);
		expect((result.items as unknown[]).length).toBe(101);
		expect((result.items as unknown[])[100]).toBe("<omitidos: 50 items>");
	});

	test("replaces binary payloads", () => {
		expect(redactAuditInput({ file: new Uint8Array([1, 2, 3]) })).toEqual({
			file: "<omitido: binario 3 bytes>",
		});
	});
});

describe("prepareAuditInput", () => {
	test("collapses to the key list when the redacted body is still too big", () => {
		const input: Record<string, string> = {};
		for (let i = 0; i < 100; i++) input[`field${i}`] = "y".repeat(1_500);
		const result = prepareAuditInput(input) as {
			_truncated: boolean;
			keys: string[];
		};
		expect(result._truncated).toBe(true);
		expect(result.keys.length).toBe(100);
	});
});

describe("resolveAuditEntityId", () => {
	test("defaults to input.id", () => {
		expect(resolveAuditEntityId(undefined, { id: "lead-1" }, undefined)).toBe(
			"lead-1",
		);
	});

	test("reads nested input paths and output paths", () => {
		expect(
			resolveAuditEntityId(
				"input.vehicle.id",
				{ vehicle: { id: "v-1" } },
				undefined,
			),
		).toBe("v-1");
		expect(
			resolveAuditEntityId("output.vehicleId", {}, { vehicleId: "v-2" }),
		).toBe("v-2");
	});

	test("returns null when the path is missing (e.g. failed create)", () => {
		expect(resolveAuditEntityId("output.id", { title: "x" }, undefined)).toBe(
			null,
		);
		expect(resolveAuditEntityId("input.id", null, undefined)).toBe(null);
	});
});

describe("describeAuditError", () => {
	test("uses the error name for plain errors", () => {
		expect(describeAuditError(new TypeError("boom"))).toBe("TypeError");
		expect(describeAuditError("what")).toBe("UNKNOWN");
	});
});
