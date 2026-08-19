import { expect, mock, test } from "bun:test";
import { reintentarCapturaAgenda } from "./agenda-cobros-snapshots";

test("reintenta captura completa con backoff y no espera tras éxito", async () => {
	const ejecutar = mock(async () => {
		if (ejecutar.mock.calls.length < 3) throw new Error("cartera caída");
	});
	const esperar = mock(async (_ms: number) => {});

	await reintentarCapturaAgenda(ejecutar, esperar);

	expect(ejecutar).toHaveBeenCalledTimes(3);
	expect(esperar).toHaveBeenNthCalledWith(1, 5 * 60_000);
	expect(esperar).toHaveBeenNthCalledWith(2, 15 * 60_000);
	expect(esperar).toHaveBeenCalledTimes(2);
});
