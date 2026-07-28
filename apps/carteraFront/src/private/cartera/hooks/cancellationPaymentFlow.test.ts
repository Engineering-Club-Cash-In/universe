import { describe, expect, it } from "bun:test";
import { canEnterCancellationPaymentFlow } from "./cancellationPaymentFlow";

describe("canEnterCancellationPaymentFlow", () => {
	it("allows only pending cancellation credits", () => {
		expect(canEnterCancellationPaymentFlow("PENDIENTE_CANCELACION")).toBe(true);
		expect(canEnterCancellationPaymentFlow("CANCELADO")).toBe(false);
		expect(canEnterCancellationPaymentFlow("ACTIVO")).toBe(false);
		expect(canEnterCancellationPaymentFlow(null)).toBe(false);
		expect(canEnterCancellationPaymentFlow(undefined)).toBe(false);
	});
});
