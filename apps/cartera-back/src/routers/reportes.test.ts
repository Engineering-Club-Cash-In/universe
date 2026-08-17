import { describe, expect, it, mock } from "bun:test";
import jwt from "jsonwebtoken";
import { getMoraRecoveryPeriod } from "../controllers/moraRecuperacion";

const execute = mock(() => Promise.resolve({ rows: [] }));

mock.module("../database", () => ({ db: { execute }, client: {} }));

const { reportesRouter } = await import("./reportes");

describe("GET /reportes/mora-recuperacion-por-asesor", () => {
	it("responde 400 para un ciclo futuro antes de consultar la base de datos", async () => {
		execute.mockClear();
		const token = jwt.sign({ role: "ADMIN" }, "supersecreto");
		const response = await reportesRouter.handle(
			new Request(
				"http://localhost/reportes/mora-recuperacion-por-asesor?mes=1&anio=2100",
				{ headers: { authorization: `Bearer ${token}` } },
			),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "No se puede consultar un ciclo futuro",
		});
		expect(execute).not.toHaveBeenCalled();
	});

	it("responde 500 para un error inesperado", async () => {
		execute.mockRejectedValueOnce(new Error("fallo de base de datos"));
		const token = jwt.sign({ role: "ADMIN" }, "supersecreto");
		const response = await reportesRouter.handle(
			new Request(
				"http://localhost/reportes/mora-recuperacion-por-asesor?mes=1&anio=2000",
				{ headers: { authorization: `Bearer ${token}` } },
			),
		);

		expect(response.status).toBe(500);
	});

	it("marca el ciclo futuro con una señal estable", () => {
		let error: unknown;
		try {
			getMoraRecoveryPeriod({ mes: 1, anio: 2100, hoy: "2026-07-29" });
		} catch (caughtError) {
			error = caughtError;
		}
		expect(error).toMatchObject({ name: "MoraRecoveryFuturePeriodError" });
	});
});
