import { expect, test } from "bun:test";
import { deduplicarCuotasPagalo } from "./pagalo-installments";

test("Págalo conserva cuota duplicada con mayor cuota_id", () => {
	expect(
		deduplicarCuotasPagalo([
			{ numero_cuota: 10, cuota_id: 20 },
			{ numero_cuota: 10, cuota_id: 21 },
			{ numero_cuota: 11, cuota_id: 22 },
		]),
	).toEqual([
		{ numero_cuota: 10, cuota_id: 21 },
		{ numero_cuota: 11, cuota_id: 22 },
	]);
});
