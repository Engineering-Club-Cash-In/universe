import { describe, expect, test } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import { quotations } from "./quotations";

describe("quotations", () => {
	test("persiste el tipo de crédito como dato obligatorio de la cotización", () => {
		const columns = getTableColumns(quotations) as Record<
			string,
			{ notNull: boolean; default: unknown }
		>;

		expect(columns.creditType).toMatchObject({
			notNull: true,
			default: "autocompra",
		});
	});
});
