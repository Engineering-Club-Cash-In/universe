import { describe, expect, test } from "bun:test";
import {
	copyPagaloLink,
	getPagaloGroupSummary,
	getPagaloLinkStatusInfo,
} from "./pagalo-link-display";

describe("Págalo link display", () => {
	test("keeps paid and active states independent", () => {
		expect(getPagaloLinkStatusInfo("ACTIVE")).toMatchObject({
			label: "Pendiente de pago",
			canCopy: true,
		});
		expect(getPagaloLinkStatusInfo("PAID")).toMatchObject({
			label: "Pagado",
			canCopy: false,
		});
		expect(getPagaloLinkStatusInfo("REPLACED")).toMatchObject({
			label: "Reemplazado",
			canCopy: false,
		});
		expect(
			getPagaloGroupSummary([
				{
					linkType: "CAPITAL",
					status: "PAID",
					isApplicationSource: true,
				},
				{ linkType: "MORA_INTERES", status: "ACTIVE" },
			]),
		).toBe("1 de 2 pagados");
		expect(getPagaloGroupSummary([])).toBeNull();
	});

	test("does not count replaced generations as extra obligations", () => {
		expect(
			getPagaloGroupSummary([
				{ linkType: "CAPITAL", status: "REPLACED" },
				{ linkType: "CAPITAL", status: "ACTIVE" },
				{
					linkType: "MORA_INTERES",
					status: "PAID",
					isApplicationSource: true,
				},
			]),
		).toBe("1 de 2 pagados");
	});

	test("does not treat a late payment on replaced link as obligation paid", () => {
		expect(
			getPagaloGroupSummary([
				{
					linkType: "CAPITAL",
					status: "PAID",
					isApplicationSource: false,
				},
				{
					linkType: "CAPITAL",
					status: "ACTIVE",
					isApplicationSource: false,
				},
			]),
		).toBe("0 de 1 pagados");
	});

	test("copies exact URL and returns clipboard failures", async () => {
		const writes: string[] = [];
		await copyPagaloLink("https://s.pagalodev.com/capital", {
			writeText: async (url) => void writes.push(url),
		});
		expect(writes).toEqual(["https://s.pagalodev.com/capital"]);
		await expect(
			copyPagaloLink("https://s.pagalodev.com/mora", {
				writeText: async () => {
					throw new Error("denied");
				},
			}),
		).rejects.toThrow("denied");
	});
});
