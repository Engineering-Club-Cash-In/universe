import { describe, expect, test } from "bun:test";
import { tomarCandadoBuroSiLibre } from "./candado-consulta-buro";

type Transaction = Parameters<typeof tomarCandadoBuroSiLibre>[0];

describe("candado de Buró durante una consulta", () => {
	test("permite continuar si el candado está libre", async () => {
		const tx = {
			execute: async () => ({ rows: [{ tomado: true }] }),
		} as unknown as Transaction;
		await expect(
			tomarCandadoBuroSiLibre(tx, "oportunidad"),
		).resolves.toBeUndefined();
	});

	test("rechaza de inmediato si Infornet retiene el candado", async () => {
		const tx = {
			execute: async () => ({ rows: [{ tomado: false }] }),
		} as unknown as Transaction;
		await expect(tomarCandadoBuroSiLibre(tx, "oportunidad")).rejects.toThrow(
			/consulta de Buró sigue en curso/,
		);
	});
});
