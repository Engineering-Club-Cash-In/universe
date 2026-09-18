import { describe, expect, test } from "bun:test";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { opportunities } from "../db/schema";
import {
	dpiCambia,
	existeOportunidadCandanteDelLead,
	existeOportunidadCandantePorId,
	MENSAJE_CANDADO_DPI_PORTAL,
	mensajeCandadoBorradoCoDeudor,
	noExisteOportunidadCandanteDelLead,
	noExisteOportunidadCandantePorId,
	type OportunidadParaCandadoDpi,
	PORCENTAJE_CANDADO_DPI,
	resolverCandadoDpi,
} from "./lead-dpi-lock";

const base = drizzle.mock();

const DPI_ACTUAL = "1234567890101";
const DPI_NUEVO = "2345678901202";

function oportunidad(
	closurePercentage: number,
	status = "open",
	stageName = "Análisis de Crédito",
): OportunidadParaCandadoDpi {
	return { closurePercentage, status, stageName };
}

describe("dpiCambia", () => {
	test("el mismo DPI con espacios no cuenta como cambio", () => {
		expect(dpiCambia("1234 56789 0101", DPI_ACTUAL)).toBe(false);
	});

	test("un DPI distinto cuenta como cambio", () => {
		expect(dpiCambia(DPI_ACTUAL, DPI_NUEVO)).toBe(true);
	});

	test("no cuenta como cambio si el campo no vino", () => {
		expect(dpiCambia(DPI_ACTUAL, undefined)).toBe(false);
		expect(dpiCambia(DPI_ACTUAL, null)).toBe(false);
	});

	test("borrar el DPI cuenta como cambio", () => {
		expect(dpiCambia(DPI_ACTUAL, "")).toBe(true);
		expect(dpiCambia(DPI_ACTUAL, "   ")).toBe(true);
	});

	test("no cuenta como cambio si el registro no tenía DPI", () => {
		expect(dpiCambia(null, DPI_NUEVO)).toBe(false);
		expect(dpiCambia("", DPI_NUEVO)).toBe(false);
	});
});

describe("resolverCandadoDpi", () => {
	test("no bloquea si el DPI no cambia, aunque la solicitud esté avanzada", () => {
		expect(
			resolverCandadoDpi({
				dpiActual: DPI_ACTUAL,
				dpiNuevo: "1234 56789 0101",
				oportunidades: [oportunidad(80)],
				sujeto: "lead",
			}),
		).toEqual({ bloqueado: false });
	});

	test("bloquea si el DPI cambia y hay una oportunidad al 40%", () => {
		const resultado = resolverCandadoDpi({
			dpiActual: DPI_ACTUAL,
			dpiNuevo: DPI_NUEVO,
			oportunidades: [oportunidad(40, "open", "Análisis de Crédito")],
			sujeto: "lead",
		});

		expect(resultado.bloqueado).toBe(true);
		expect(resultado.message).toContain("Análisis de Crédito (40%)");
		expect(resultado.message).toContain("administrador");
	});

	test("no bloquea si la única oportunidad avanzada está perdida", () => {
		expect(
			resolverCandadoDpi({
				dpiActual: DPI_ACTUAL,
				dpiNuevo: DPI_NUEVO,
				oportunidades: [oportunidad(80, "lost")],
				sujeto: "lead",
			}),
		).toEqual({ bloqueado: false });
	});

	test("no bloquea con una oportunidad justo en el 30%", () => {
		expect(
			resolverCandadoDpi({
				dpiActual: DPI_ACTUAL,
				dpiNuevo: DPI_NUEVO,
				oportunidades: [oportunidad(30)],
				sujeto: "lead",
			}),
		).toEqual({ bloqueado: false });
	});

	test("basta una oportunidad viva avanzada entre varias", () => {
		const resultado = resolverCandadoDpi({
			dpiActual: DPI_ACTUAL,
			dpiNuevo: DPI_NUEVO,
			oportunidades: [
				oportunidad(10, "open", "Contacto"),
				oportunidad(90, "lost", "Jurídico"),
				oportunidad(40, "open", "Análisis de Crédito"),
			],
			sujeto: "lead",
		});

		expect(resultado.bloqueado).toBe(true);
		expect(resultado.message).toContain("Análisis de Crédito (40%)");
	});

	test("el mensaje del co-deudor dice que el DPI es del co-deudor", () => {
		const resultado = resolverCandadoDpi({
			dpiActual: DPI_ACTUAL,
			dpiNuevo: DPI_NUEVO,
			oportunidades: [oportunidad(40)],
			sujeto: "codeudor",
		});

		expect(resultado.bloqueado).toBe(true);
		expect(resultado.message).toContain("el DPI del co-deudor");
	});

	test("el admin sí puede cambiar el DPI en el CRM, pero el paso sale marcado", () => {
		// 🔴 `overrideAdmin` distingue "pasó porque no candaba" de "pasó por ser
		// admin". Sin esa marca el llamador no puede cobrar el costo del override
		// —mandar las candantes de vuelta a análisis—, porque la evidencia de
		// identidad que tienen se validó contra el DPI viejo.
		const comoLead = resolverCandadoDpi({
			dpiActual: DPI_ACTUAL,
			dpiNuevo: DPI_NUEVO,
			oportunidades: [oportunidad(90)],
			sujeto: "lead",
			esAdmin: true,
		});

		expect(comoLead.bloqueado).toBe(false);
		expect(comoLead.overrideAdmin).toBe(true);
		expect(comoLead.candantes).toHaveLength(1);

		const comoCoDeudor = resolverCandadoDpi({
			dpiActual: DPI_ACTUAL,
			dpiNuevo: DPI_NUEVO,
			oportunidades: [oportunidad(90)],
			sujeto: "codeudor",
			esAdmin: true,
		});

		expect(comoCoDeudor.bloqueado).toBe(false);
		expect(comoCoDeudor.overrideAdmin).toBe(true);
	});

	test("sin candado que abrir, el admin NO queda marcado como override", () => {
		// La diferencia que importa: acá no hay nada que revalidar, así que
		// marcarlo mandaría a análisis a una oportunidad que nunca se validó.
		const resultado = resolverCandadoDpi({
			dpiActual: DPI_ACTUAL,
			dpiNuevo: DPI_NUEVO,
			oportunidades: [oportunidad(20)],
			sujeto: "lead",
			esAdmin: true,
		});

		expect(resultado).toEqual({ bloqueado: false });
	});

	test("el portal nunca deja cambiar el DPI, ni siquiera como admin", () => {
		expect(
			resolverCandadoDpi({
				dpiActual: DPI_ACTUAL,
				dpiNuevo: DPI_NUEVO,
				oportunidades: [oportunidad(40)],
				sujeto: "portal",
				esAdmin: true,
			}),
		).toEqual({ bloqueado: true, message: MENSAJE_CANDADO_DPI_PORTAL });
	});

	test("bloquea el borrado del DPI sobre una oportunidad al 40%", () => {
		const resultado = resolverCandadoDpi({
			dpiActual: DPI_ACTUAL,
			dpiNuevo: "",
			oportunidades: [oportunidad(40)],
			sujeto: "lead",
		});

		expect(resultado.bloqueado).toBe(true);
	});

	test("regresión: el bypass de dos pasos (borrar y luego escribir otro DPI)", () => {
		const oportunidades = [oportunidad(40)];

		// Paso 1: borrar el DPI. Si esto pasara, el guardado quedaría vacío y el
		// paso 2 entraría por la puerta de "no había DPI que cambiar".
		const paso1 = resolverCandadoDpi({
			dpiActual: DPI_ACTUAL,
			dpiNuevo: "",
			oportunidades,
			sujeto: "portal",
		});
		expect(paso1.bloqueado).toBe(true);

		const paso2 = resolverCandadoDpi({
			dpiActual: DPI_ACTUAL,
			dpiNuevo: DPI_NUEVO,
			oportunidades,
			sujeto: "portal",
		});
		expect(paso2.bloqueado).toBe(true);
	});

	test("el mensaje del portal no menciona roles internos", () => {
		expect(MENSAJE_CANDADO_DPI_PORTAL).not.toContain("administrador");
	});
});

/**
 * 🔴 La maniobra que este bloque cierra: retroceder la oportunidad de 40% a
 * 30 o 20 —`updateOpportunity` lo permite por debajo del 90— descandaba el DPI
 * con RENAP, buró y documentos ya atados a la identidad vieja. Bajar, cambiar
 * el DPI, volver a subir, sin que nada avisara.
 */
describe("el candado mira si ALGUNA VEZ cruzó el 30%, no solo dónde está hoy", () => {
	test("retroceder de 40 a 20 sigue candado", () => {
		const resultado = resolverCandadoDpi({
			dpiActual: DPI_ACTUAL,
			dpiNuevo: DPI_NUEVO,
			oportunidades: [
				{
					status: "open",
					stageName: "Solución y propuesta",
					closurePercentage: 20,
					maxHistoricoClosurePercentage: 40,
				},
			],
			sujeto: "lead",
		});

		expect(resultado.bloqueado).toBe(true);
		// El mensaje nombra el punto por el que pasó: decir "ya avanzó a Solución
		// y propuesta (20%)" sería incomprensible, porque el 20% no canda nada.
		expect(resultado.message).toContain("ya pasó por el 40%");
		expect(resultado.message).toContain("Solución y propuesta");
	});

	test("una oportunidad recién creada al 40% canda aunque no tenga historial", () => {
		// La etapa actual sigue contando aparte justamente por este caso: todavía
		// no registró ningún movimiento en `opportunityStageHistory`.
		const resultado = resolverCandadoDpi({
			dpiActual: DPI_ACTUAL,
			dpiNuevo: DPI_NUEVO,
			oportunidades: [
				{
					status: "open",
					stageName: "Cierre de propuesta",
					closurePercentage: 40,
					maxHistoricoClosurePercentage: null,
				},
			],
			sujeto: "lead",
		});

		expect(resultado.bloqueado).toBe(true);
		expect(resultado.message).toContain("Cierre de propuesta (40%)");
	});

	test("la que nunca pasó del 30 no canda, ni por historial ni por etapa", () => {
		expect(
			resolverCandadoDpi({
				dpiActual: DPI_ACTUAL,
				dpiNuevo: DPI_NUEVO,
				oportunidades: [
					{
						status: "open",
						stageName: "Recepción de documentación",
						closurePercentage: 30,
						maxHistoricoClosurePercentage: 30,
					},
				],
				sujeto: "lead",
			}),
		).toEqual({ bloqueado: false });
	});

	test("la regla de `lost` NO cambia: una perdida con historial alto sigue sin candar", () => {
		// Decisión de producto vigente. El costo de reabrirla se cobra al
		// reabrirla, no acá.
		expect(
			resolverCandadoDpi({
				dpiActual: DPI_ACTUAL,
				dpiNuevo: DPI_NUEVO,
				oportunidades: [
					{
						status: "lost",
						stageName: "Solución y propuesta",
						closurePercentage: 20,
						maxHistoricoClosurePercentage: 90,
					},
				],
				sujeto: "lead",
			}),
		).toEqual({ bloqueado: false });
	});

	test("entre varias, se reporta la que llegó más alto (hoy o alguna vez)", () => {
		const resultado = resolverCandadoDpi({
			dpiActual: DPI_ACTUAL,
			dpiNuevo: DPI_NUEVO,
			oportunidades: [
				{
					status: "open",
					stageName: "Cierre de propuesta",
					closurePercentage: 40,
					maxHistoricoClosurePercentage: 40,
				},
				{
					status: "open",
					stageName: "Solución y propuesta",
					closurePercentage: 20,
					maxHistoricoClosurePercentage: 80,
				},
			],
			sujeto: "lead",
		});

		expect(resultado.bloqueado).toBe(true);
		expect(resultado.message).toContain("ya pasó por el 80%");
	});
});

/**
 * 🔴 Borrar al co-deudor es la otra forma de reemplazar una identidad candada:
 * el candado de `updateCoDebtor` impide cambiarle el DPI, pero borrarlo y crear
 * otro con otro DPI dejaba el expediente respaldado por alguien distinto de
 * quien pasó por RENAP, buró y documentos.
 *
 * `createCoDebtor` NO se canda a propósito: agregar un co-deudor tarde es un
 * flujo legítimo. El reemplazo exige borrar primero, y eso ya queda cerrado.
 */
describe("mensaje del candado al borrar un co-deudor", () => {
	test("dice por qué no se puede y quién sí puede", () => {
		const mensaje = mensajeCandadoBorradoCoDeudor({
			status: "open",
			stageName: "Cierre de propuesta",
			closurePercentage: 40,
			maxHistoricoClosurePercentage: 40,
		});

		expect(mensaje).toContain("No se puede eliminar al co-deudor");
		expect(mensaje).toContain("40%");
		expect(mensaje).toContain("administrador");
	});

	test("nombra lo más alto que alcanzó, aunque hoy esté más abajo", () => {
		// Mismo criterio que el candado del DPI: el retroceso no borra el pasado.
		const mensaje = mensajeCandadoBorradoCoDeudor({
			status: "open",
			stageName: "Solución y propuesta",
			closurePercentage: 20,
			maxHistoricoClosurePercentage: 80,
		});

		expect(mensaje).toContain("80%");
	});
});

/**
 * 🔴 El chequeo en memoria y el `UPDATE` no son atómicos: entre que el candado
 * dice "abierto" y la escritura ocurre, otra transacción puede aprobar el
 * análisis (30 → 40) y el DPI se escribe igual. Por eso la misma señal viaja
 * también como subconsulta en el WHERE.
 *
 * Las dos formas tienen que decir lo mismo; este bloque existe para que no se
 * separen en silencio.
 */
describe("las dos formas de la señal dicen lo mismo", () => {
	const sqlDelLead = existeOportunidadCandanteDelLead(
		"8f14e45f-ceea-467a-9f07-6c0b6e0a1c33",
	);

	function sqlComoTexto(fragmento: SQL): string {
		return base
			.select({ x: sql`1` })
			.from(opportunities)
			.where(fragmento)
			.toSQL()
			.sql.replace(/\s+/g, " ")
			.toLowerCase();
	}

	test("el SQL excluye las perdidas, igual que la regla en memoria", () => {
		expect(sqlComoTexto(sqlDelLead)).toContain("<> 'lost'");
	});

	test("el SQL mira la etapa actual Y el historial, en OR", () => {
		const texto = sqlComoTexto(sqlDelLead);

		expect(texto).toContain("closure_percentage");
		expect(texto).toContain("opportunity_stage_history");
		expect(texto).toContain(" or exists");
	});

	test("el SQL usa el MISMO umbral que la regla, y no un 30 suelto", () => {
		const { params } = base
			.select({ x: sql`1` })
			.from(opportunities)
			.where(sqlDelLead)
			.toSQL();

		// Dos veces: una por la etapa actual y otra por el historial.
		expect(params.filter((p) => p === PORCENTAJE_CANDADO_DPI)).toHaveLength(2);
	});

	test("la versión por oportunidad filtra por id y no por lead", () => {
		const texto = sqlComoTexto(
			existeOportunidadCandantePorId("8f14e45f-ceea-467a-9f07-6c0b6e0a1c33"),
		);

		expect(texto).toContain('"opportunities"."id" =');
		expect(texto).not.toContain('"opportunities"."lead_id" =');
	});

	test("la negada es la negación de la afirmativa", () => {
		expect(sqlComoTexto(noExisteOportunidadCandanteDelLead("x"))).toContain(
			"not exists",
		);
		expect(sqlComoTexto(noExisteOportunidadCandantePorId("x"))).toContain(
			"not exists",
		);
	});
});
