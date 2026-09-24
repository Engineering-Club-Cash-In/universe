import { beforeEach, describe, expect, mock, test } from "bun:test";

/** La batería que devuelve la base. */
let bateria: Record<string, unknown> | undefined;
/** Los contratos vigentes de esa batería. */
let contratos: Array<{ status: string }> = [];
/** Lo que se le escribió a la batería, si se le escribió algo. */
let guardado: Record<string, unknown> | undefined;

mock.module("../db", () => ({
	db: {
		select: (campos?: Record<string, unknown>) => ({
			from: () => ({
				where: () => {
					// La batería se lee con `.limit(1)`; los contratos, sin límite. Y la
					// consulta que sólo pide `batchId` es la que resuelve de qué batería
					// es un contrato.
					const esDelContrato = campos && "batchId" in campos;
					const filas = esDelContrato
						? [{ batchId: bateria ? "bateria-1" : null }]
						: contratos;
					return Object.assign(Promise.resolve(filas), {
						limit: async () =>
							esDelContrato
								? filas
								: bateria
									? [bateria]
									: ([] as Record<string, unknown>[]),
					});
				},
			}),
		}),
		update: () => ({
			set: (valores: Record<string, unknown>) => {
				guardado = valores;
				return { where: async () => undefined };
			},
		}),
	},
}));

const { recalcularEstadoDeLaBateria } = await import("./bateria-de-contratos");

const BATERIA = {
	id: "bateria-1",
	status: "pendiente",
	startedAt: null,
	startedBy: null,
	completedAt: null,
	completedBy: null,
};

beforeEach(() => {
	bateria = { ...BATERIA };
	contratos = [];
	guardado = undefined;
});

describe("el estado de la batería lo marcan sus documentos", () => {
	test("antes del Listo sigue pendiente, aunque ya tenga contratos", async () => {
		contratos = [{ status: "pending" }, { status: "signed" }];

		expect(await recalcularEstadoDeLaBateria("bateria-1", "juan")).toBe(
			"pendiente",
		);
		expect(guardado).toBeUndefined();
	});

	test("ni con todo firmado: sin Listo no salió el correo", async () => {
		contratos = [{ status: "signed" }];

		expect(await recalcularEstadoDeLaBateria("bateria-1")).toBe("pendiente");
		expect(guardado).toBeUndefined();
	});

	test("después del Listo, con firmas pendientes, queda por firmar", async () => {
		bateria = { ...BATERIA, status: "en_proceso", startedAt: new Date() };
		contratos = [{ status: "pending" }, { status: "signed" }];

		expect(await recalcularEstadoDeLaBateria("bateria-1")).toBe("en_proceso");
		expect(guardado).toBeUndefined();
	});

	test("firmados todos, se cierra", async () => {
		bateria = { ...BATERIA, status: "en_proceso", startedAt: new Date() };
		contratos = [{ status: "signed" }, { status: "signed" }];

		expect(await recalcularEstadoDeLaBateria("bateria-1", "juan")).toBe(
			"completada",
		);
		expect(guardado).toMatchObject({
			status: "completada",
			completedBy: "juan",
		});
	});

	test("sin contratos vigentes vuelve a pendiente y se le borra el cierre", async () => {
		bateria = { ...BATERIA, status: "completada", completedAt: new Date() };
		contratos = [];

		expect(await recalcularEstadoDeLaBateria("bateria-1")).toBe("pendiente");
		expect(guardado).toMatchObject({
			status: "pendiente",
			completedAt: null,
			completedBy: null,
		});
	});

	test("cerrada es sólo con todo firmado: una cerrada a mano con firmas pendientes vuelve a en firma", async () => {
		// Las que cerró el "Listo" que había antes, con firmas trabadas.
		bateria = { ...BATERIA, status: "completada", completedAt: new Date() };
		contratos = [{ status: "pending" }, { status: "signed" }];

		expect(await recalcularEstadoDeLaBateria("bateria-1")).toBe("en_proceso");
		expect(guardado).toMatchObject({
			status: "en_proceso",
			completedAt: null,
			completedBy: null,
		});
	});

	test("una descartada no se recalcula", async () => {
		bateria = { ...BATERIA, status: "descartada" };
		contratos = [{ status: "pending" }];

		expect(await recalcularEstadoDeLaBateria("bateria-1")).toBeNull();
		expect(guardado).toBeUndefined();
	});

	test("si el estado no cambia, no se escribe nada", async () => {
		bateria = { ...BATERIA, status: "en_proceso", startedAt: new Date() };
		contratos = [{ status: "pending" }];

		expect(await recalcularEstadoDeLaBateria("bateria-1")).toBe("en_proceso");
		expect(guardado).toBeUndefined();
	});
});
