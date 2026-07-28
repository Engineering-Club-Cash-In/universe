import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { canEnterCancellationPaymentFlow } from "./cancellationPaymentFlow";

function finalizedGuard(source: string): string | undefined {
	return source.match(
		/result\.flujo === "CANCELADO"[\s\S]*?!canEnterCancellationPaymentFlow[\s\S]*?\) \{([\s\S]*?)\n\s*return;/,
	)?.[1];
}

describe("canEnterCancellationPaymentFlow", () => {
	it("allows only pending cancellation credits", () => {
		expect(canEnterCancellationPaymentFlow("PENDIENTE_CANCELACION")).toBe(true);
		expect(canEnterCancellationPaymentFlow("CANCELADO")).toBe(false);
		expect(canEnterCancellationPaymentFlow("ACTIVO")).toBe(false);
		expect(canEnterCancellationPaymentFlow(null)).toBe(false);
		expect(canEnterCancellationPaymentFlow(undefined)).toBe(false);
	});
});

describe("finalized credit form reset wiring", () => {
	it("resets Formik and the search field before returning", async () => {
		const source = await Bun.file(
			resolve(import.meta.dir, "registerPayment.ts"),
		).text();
		const guard = finalizedGuard(source);

		expect(guard).toContain("formik.resetForm();");
		expect(guard).toContain("setResetBuscador(true);");
	});
});
