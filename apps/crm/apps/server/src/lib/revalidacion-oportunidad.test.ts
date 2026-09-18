import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { opportunities } from "../db/schema";
import type { AuditEntry } from "./audit";
import {
	decidirRevalidacion,
	MOTIVO_AVISO,
	MOTIVO_SALVAGUARDA,
	PORCENTAJE_ETAPA_ANALISIS,
	PORCENTAJE_SIN_RETROCESO,
	parcheDeRevalidacion,
	revalidarOportunidades,
	separarPorSalvaguarda,
	sqlResetPermitido,
} from "./revalidacion-oportunidad";

/**
 * 🔴 La evidencia de identidad de un expediente —RENAP, buró, documentos— se
 * produjo contra UN DPI. Dos maniobras legítimas la dejan pegada a una
 * identidad que ya no es la vigente:
 *
 * 1. Reabrir una perdida: las `lost` no candan a propósito, así que mientras
 *    estuvo perdida el DPI se pudo cambiar.
 * 2. El override del admin sobre el candado.
 *
 * Ninguna se prohíbe; a las dos se les pone precio, y el precio es re-validar.
 */
describe("a quién hay que revalidar", () => {
	test("la que cruzó el 30% y está por debajo del 90% se resetea", () => {
		expect(
			decidirRevalidacion({
				status: "open",
				closurePercentage: 40,
				maxHistoricoClosurePercentage: 40,
			}),
		).toEqual({ tipo: "resetear" });
	});

	test("cuenta el historial: la que retrocedió también se resetea", () => {
		// Misma señal que el candado: el retroceso no borra el pasado.
		expect(
			decidirRevalidacion({
				status: "open",
				closurePercentage: 20,
				maxHistoricoClosurePercentage: 40,
			}),
		).toEqual({ tipo: "resetear" });
	});

	test("la que nunca cruzó el 30% no se toca ni se avisa", () => {
		// No hubo análisis, así que no hay validación que invalidar.
		expect(
			decidirRevalidacion({
				status: "open",
				closurePercentage: 30,
				maxHistoricoClosurePercentage: 30,
			}),
		).toEqual({ tipo: "nada" });

		expect(
			decidirRevalidacion({
				status: "open",
				closurePercentage: 20,
				maxHistoricoClosurePercentage: null,
			}),
		).toEqual({ tipo: "nada" });
	});

	/**
	 * ⚠️ La asimetría: hay dos clases de oportunidad que NO se resetean, y por
	 * razones distintas. En las dos, la maniobra igual queda anotada.
	 */
	test("una ganada no se resetea: sus datos se firmaron en contratos", () => {
		expect(
			decidirRevalidacion({
				status: "won",
				closurePercentage: 90,
				maxHistoricoClosurePercentage: 90,
			}),
		).toEqual({ tipo: "solo_aviso", razon: "won" });
	});

	test("de 90% en adelante tampoco: el repo no deja retroceder desde ahí", () => {
		expect(
			decidirRevalidacion({
				status: "open",
				closurePercentage: PORCENTAJE_SIN_RETROCESO,
				maxHistoricoClosurePercentage: 90,
			}),
		).toEqual({ tipo: "solo_aviso", razon: "formalizacion_final" });

		expect(
			decidirRevalidacion({
				status: "open",
				closurePercentage: 100,
				maxHistoricoClosurePercentage: 100,
			}),
		).toEqual({ tipo: "solo_aviso", razon: "formalizacion_final" });
	});

	test("una won al 100% cae por las dos, y se reporta la razón más informativa", () => {
		// "won" habla de contratos firmados; "≥90%" solo de una regla de etapas.
		expect(
			decidirRevalidacion({
				status: "won",
				closurePercentage: 100,
				maxHistoricoClosurePercentage: 100,
			}),
		).toEqual({ tipo: "solo_aviso", razon: "won" });
	});

	test("el 89% todavía se resetea: el corte es en 90", () => {
		expect(
			decidirRevalidacion({
				status: "open",
				closurePercentage: 89,
				maxHistoricoClosurePercentage: 89,
			}),
		).toEqual({ tipo: "resetear" });
	});
});

describe("qué se le toca a la que se resetea", () => {
	test("vuelve a análisis, pendiente y con el detalle de crédito sin aprobar", () => {
		expect(parcheDeRevalidacion("etapa-30")).toEqual({
			stageId: "etapa-30",
			analysisStatus: "pending",
			creditDetailApproved: false,
		});
	});

	test("la etapa de análisis es la del 30%, el mismo umbral del candado", () => {
		expect(PORCENTAJE_ETAPA_ANALISIS).toBe(30);
	});
});

/**
 * Banco de pruebas: una base falsa que registra el UPDATE que recibió.
 *
 * `devuelve` son los ids que el UPDATE reporta como escritos. Es lo que permite
 * simular la carrera: el predicado del UPDATE excluye una fila y esa fila no
 * vuelve, aunque el snapshot la diera por reseteable.
 */
function banco(etapa: { id: string } | null, devuelve: string[] = []) {
	const actualizados: unknown[] = [];
	const anotaciones: AuditEntry[] = [];

	const database = {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: async () => (etapa ? [etapa] : []),
				}),
			}),
		}),
		update: () => ({
			set: (valores: unknown) => ({
				where: () => ({
					returning: async () => {
						actualizados.push(valores);
						return devuelve.map((id) => ({ id }));
					},
				}),
			}),
		}),
	} as never;

	return {
		actualizados,
		anotaciones,
		database,
		anotar: (entrada: AuditEntry) => {
			anotaciones.push(entrada);
		},
	};
}

describe("aplicar la revalidación", () => {
	const RESETEABLE = {
		id: "op-40",
		status: "open",
		closurePercentage: 40,
		maxHistoricoClosurePercentage: 40,
	};
	const GANADA = {
		id: "op-won",
		status: "won",
		closurePercentage: 90,
		maxHistoricoClosurePercentage: 90,
	};
	const INTOCADA = {
		id: "op-20",
		status: "open",
		closurePercentage: 20,
		maxHistoricoClosurePercentage: null,
	};

	test("resetea las que corresponde y las anota", async () => {
		const b = banco({ id: "etapa-30" }, ["op-40"]);

		const resultado = await revalidarOportunidades({
			oportunidades: [RESETEABLE],
			accion: "candado_override_revalidacion",
			detalle: "porque sí",
			anotar: b.anotar,
			database: b.database,
		});

		expect(resultado.reseteadas).toEqual(["op-40"]);
		expect(b.actualizados).toHaveLength(1);
		expect(b.actualizados[0]).toMatchObject({
			stageId: "etapa-30",
			analysisStatus: "pending",
			creditDetailApproved: false,
		});
		expect(b.anotaciones).toHaveLength(1);
		expect(b.anotaciones[0]?.action).toBe("candado_override_revalidacion");
		expect(b.anotaciones[0]?.id).toBe("op-40");
		expect(b.anotaciones[0]?.ok).toBeUndefined();
	});

	test("🔴 la ganada NO se toca, pero sí queda el aviso", async () => {
		// El aviso es lo único que deja rastro de que la validación quedó vieja y
		// nadie la rehizo. Preferimos eso a romper contratos ya firmados.
		const b = banco({ id: "etapa-30" });

		const resultado = await revalidarOportunidades({
			oportunidades: [GANADA],
			accion: "candado_override_revalidacion",
			detalle: "porque sí",
			anotar: b.anotar,
			database: b.database,
		});

		expect(resultado.reseteadas).toEqual([]);
		expect(b.actualizados).toEqual([]);
		expect(b.anotaciones).toHaveLength(1);
		expect(b.anotaciones[0]?.ok).toBe(false);
		expect(String(b.anotaciones[0]?.data)).toBeDefined();
		expect(
			(b.anotaciones[0]?.data as { resultado: string }).resultado,
		).toContain(MOTIVO_AVISO.won);
	});

	test("la que nunca cruzó el 30% no se toca ni deja fila", async () => {
		const b = banco({ id: "etapa-30" });

		const resultado = await revalidarOportunidades({
			oportunidades: [INTOCADA],
			accion: "candado_override_revalidacion",
			detalle: "porque sí",
			anotar: b.anotar,
			database: b.database,
		});

		expect(resultado).toEqual({
			reseteadas: [],
			avisadas: [],
			bloqueadasPorSalvaguarda: [],
		});
		expect(b.actualizados).toEqual([]);
		expect(b.anotaciones).toEqual([]);
	});

	test("mezcladas: resetea unas, avisa por otras, ignora el resto", async () => {
		const b = banco({ id: "etapa-30" }, ["op-40"]);

		const resultado = await revalidarOportunidades({
			oportunidades: [RESETEABLE, GANADA, INTOCADA],
			accion: "candado_override_revalidacion",
			detalle: "porque sí",
			anotar: b.anotar,
			database: b.database,
		});

		expect(resultado.reseteadas).toEqual(["op-40"]);
		expect(resultado.avisadas).toEqual([{ id: "op-won", razon: "won" }]);
		// Un solo UPDATE para todas las reseteables: no hay N+1.
		expect(b.actualizados).toHaveLength(1);
		expect(b.anotaciones).toHaveLength(2);
	});

	test("🔴 sin etapa de análisis no se escribe a medias", async () => {
		// Dejar `analysisStatus: pending` con la etapa al 40% sería un estado que
		// ninguna pantalla sabe leer.
		const b = banco(null);

		const resultado = await revalidarOportunidades({
			oportunidades: [RESETEABLE],
			accion: "candado_override_revalidacion",
			detalle: "porque sí",
			anotar: b.anotar,
			database: b.database,
		});

		expect(resultado.reseteadas).toEqual([]);
		expect(b.actualizados).toEqual([]);
		expect(b.anotaciones).toHaveLength(1);
		expect(b.anotaciones[0]?.ok).toBe(false);
	});
});

/**
 * 🔴 El snapshot decidía y el UPDATE escribía sin condiciones: una oportunidad
 * que llegó a `won` o al 90% ENTRE la lectura y la escritura volvía al 30%
 * igual, y quedaba ganada-en-análisis o retrocedida desde donde el repo no
 * permite retroceder. Las salvaguardas viajan ahora dentro del predicado.
 */
describe("la carrera entre el snapshot y el UPDATE", () => {
	const RESETEABLE = {
		id: "op-40",
		status: "open",
		closurePercentage: 40,
		maxHistoricoClosurePercentage: 40,
	};
	const OTRA = {
		id: "op-50",
		status: "open",
		closurePercentage: 50,
		maxHistoricoClosurePercentage: 50,
	};

	test("las dos formas de la salvaguarda nombran las mismas condiciones", () => {
		// `decidirRevalidacion` exceptúa `won` y ≥90; el SQL tiene que decir lo
		// mismo o la carrera se cierra a medias.
		const texto = drizzle
			.mock()
			.select({ x: sql`1` })
			.from(opportunities)
			.where(sqlResetPermitido())
			.toSQL()
			.sql.replace(/\s+/g, " ")
			.toLowerCase();

		expect(texto).toContain("<> 'won'");
		expect(texto).toContain("closure_percentage <");
		expect(texto).toContain("sales_stages");
	});

	test("la fila que el predicado excluye NO se cuenta como reseteada", async () => {
		const b = banco({ id: "etapa-30" }, ["op-50"]);

		const resultado = await revalidarOportunidades({
			oportunidades: [RESETEABLE, OTRA],
			accion: "candado_override_revalidacion",
			detalle: "porque sí",
			anotar: b.anotar,
			database: b.database,
		});

		expect(resultado.reseteadas).toEqual(["op-50"]);
		expect(resultado.bloqueadasPorSalvaguarda).toEqual(["op-40"]);
	});

	test("la excluida queda en la bitácora, no desaparece", async () => {
		const b = banco({ id: "etapa-30" }, []);

		await revalidarOportunidades({
			oportunidades: [RESETEABLE],
			accion: "candado_override_revalidacion",
			detalle: "porque sí",
			anotar: b.anotar,
			database: b.database,
		});

		expect(b.anotaciones).toHaveLength(1);
		expect(b.anotaciones[0]?.id).toBe("op-40");
		expect(b.anotaciones[0]?.ok).toBe(false);
		expect((b.anotaciones[0]?.data as { resultado: string }).resultado).toBe(
			MOTIVO_SALVAGUARDA,
		);
	});

	test("separar por salvaguarda conserva el orden y no inventa ids", () => {
		expect(separarPorSalvaguarda(["a", "b", "c"], ["c", "a"])).toEqual({
			aplicadas: ["a", "c"],
			bloqueadas: ["b"],
		});
		expect(separarPorSalvaguarda([], ["a"])).toEqual({
			aplicadas: [],
			bloqueadas: [],
		});
	});
});

/**
 * La receta pasa entera aunque nadie la llame. Los dos caminos que la disparan
 * —la reapertura y el override del candado— tienen que estar cableados.
 */
describe("cableado de la revalidación", () => {
	const crm = readFileSync(
		join(dirname(import.meta.dir), "routers/crm.ts"),
		"utf8",
	);

	test("la reapertura de una perdida dispara la revalidación", () => {
		expect(crm).toContain("reabrir_oportunidad_revalidacion");
		expect(
			crm,
			"updateOpportunity debería detectar la transición lost → open",
		).toContain('currentOpportunity[0].status === "lost"');
	});

	test("el reset de la reapertura viaja en el MISMO UPDATE que el status", () => {
		// En dos sentencias quedaría una ventana con la oportunidad ya reabierta y
		// todavía marcada como validada.
		expect(crm).toContain("...(parcheRevalidacion ?? {})");
	});

	test("el override del admin sobre el candado dispara la revalidación", () => {
		expect(crm).toContain("candado_override_revalidacion");
		// Los dos sujetos del candado en el CRM: lead y co-deudor.
		expect(crm.split("candado_override_revalidacion").length - 1).toBe(2);
	});
});
