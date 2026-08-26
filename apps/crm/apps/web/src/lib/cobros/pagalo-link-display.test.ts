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
			getPagaloGroupSummary([{ status: "PAID" }, { status: "ACTIVE" }]),
		).toBe("1 de 2 pagados");
		expect(getPagaloGroupSummary([])).toBeNull();
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
