import { describe, expect, test } from "bun:test";
import { actualizarEmpresa, crearEmpresa } from "./companies";

type Llamada = { op: string; valores?: Record<string, unknown> };

function dbFalsa(filas: unknown[]) {
	const llamadas: Llamada[] = [];
	const cadena = (op: string) => ({
		values: (v: Record<string, unknown>) => {
			llamadas.push({ op, valores: v });
			return { returning: async () => filas };
		},
		set: (v: Record<string, unknown>) => {
			llamadas.push({ op, valores: v });
			return { where: () => ({ returning: async () => filas }) };
		},
	});
	return {
		llamadas,
		db: {
			insert: () => cadena("insert"),
			update: () => cadena("update"),
		} as never,
	};
}

describe("crearEmpresa", () => {
	test("rol sin permiso de alta -> FORBIDDEN", async () => {
		const { db } = dbFalsa([{ id: "e1" }]);
		await expect(
			crearEmpresa(db, { name: "X" }, { userId: "u", userRole: "cobros" }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	test("registra al creador y devuelve la fila", async () => {
		const { db, llamadas } = dbFalsa([{ id: "e1" }]);
		const r = await crearEmpresa(db, { name: "X" }, { userId: "u", userRole: "sales" });
		expect(r as unknown).toEqual({ id: "e1" });
		expect(llamadas[0]?.valores).toMatchObject({ name: "X", createdBy: "u" });
	});
});

describe("actualizarEmpresa", () => {
	test("sin filas afectadas -> NOT_FOUND", async () => {
		const { db } = dbFalsa([]);
		await expect(
			actualizarEmpresa(db, { id: "e1", name: "Y" }, { userId: "u", userRole: "sales" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	test("devuelve la fila actualizada sin el id en el SET", async () => {
		const { db, llamadas } = dbFalsa([{ id: "e1", name: "Y" }]);
		const r = await actualizarEmpresa(
			db,
			{ id: "e1", name: "Y" },
			{ userId: "u", userRole: "admin" },
		);
		expect(r as unknown).toEqual({ id: "e1", name: "Y" });
		expect(llamadas[0]?.valores).not.toHaveProperty("id");
	});
});
