import { describe, expect, test } from "bun:test";
import { memoConTtl } from "./memo-ttl";

describe("memoConTtl", () => {
	test("reutiliza el valor dentro del TTL y recalcula al vencer", async () => {
		let reloj = 0;
		let llamadas = 0;
		const memo = memoConTtl<number>(1000, () => reloj);
		const calcular = async () => ++llamadas;
		expect(await memo("a", calcular)).toBe(1);
		reloj = 999;
		expect(await memo("a", calcular)).toBe(1);
		reloj = 1000;
		expect(await memo("a", calcular)).toBe(2);
	});

	test("llamadas simultáneas comparten el mismo cálculo", async () => {
		let llamadas = 0;
		const memo = memoConTtl<number>(1000);
		const calcular = async () => {
			llamadas++;
			return 7;
		};
		await Promise.all([memo("a", calcular), memo("a", calcular)]);
		expect(llamadas).toBe(1);
	});

	test("un fallo no se queda guardado", async () => {
		const memo = memoConTtl<number>(1000);
		await expect(
			memo("a", async () => Promise.reject(new Error("x"))),
		).rejects.toThrow();
		expect(await memo("a", async () => 5)).toBe(5);
	});

	test("las claves son independientes", async () => {
		const memo = memoConTtl<string>(1000);
		expect(await memo("a", async () => "A")).toBe("A");
		expect(await memo("b", async () => "B")).toBe("B");
	});
});
