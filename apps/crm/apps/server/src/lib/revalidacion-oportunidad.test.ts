import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { opportunities } from "../db/schema";
import type { AuditEntry } from "./audit";
import {
	decidirRevalidacion,
	documentosDeIdentidadVigentes,
	ErrorRevalidacionIncompleta,
	faltaPorIdentidadRevalidada,
	MENSAJE_DPI_DESACTUALIZADO,
	MOTIVO_AVISO,
	MOTIVO_SALVAGUARDA,
	PORCENTAJE_ETAPA_ANALISIS,
	PORCENTAJE_SIN_RETROCESO,
	parcheDeRevalidacion,
	RAZON_TRANSICION_REVALIDACION,
	revalidarOportunidades,
	saleDeLaPerdida,
	separarPorSalvaguarda,
	sqlResetPermitido,
} from "./revalidacion-oportunidad";

/** El router, leído una sola vez: varios bloques revisan su cableado. */
const crmFuente = readFileSync(
	join(dirname(import.meta.dir), "routers/crm.ts"),
	"utf8",
);

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

/**
 * 🔴 La escapatoria se rearmaba en dos saltos. Mirando solo `lost → open`, el
 * camino `lost → on_hold → open` no disparaba la revalidación NUNCA: el primer
 * salto no va a "open" y el segundo ya no sale de "lost". El expediente volvía
 * a estar vivo con la evidencia de la identidad vieja.
 */
describe("salir de una perdida: cualquier destino cuesta revalidar", () => {
	test("la transición directa sigue contando", () => {
		expect(saleDeLaPerdida("lost", "open")).toBe(true);
	});

	test("🔴 el primer salto del rodeo de dos pasos también cuenta", () => {
		expect(saleDeLaPerdida("lost", "on_hold")).toBe(true);
	});

	test("el segundo salto ya no: la oportunidad salió de lost en el primero", () => {
		// Y ahí está el punto: con el primero cubierto, el rodeo no gana nada.
		expect(saleDeLaPerdida("on_hold", "open")).toBe(false);
	});

	test("ganarla directo desde perdida también sale de lost", () => {
		// Las salvaguardas de `decidirRevalidacion` deciden después que a una won
		// no se la toca, pero la maniobra queda avisada en la bitácora.
		expect(saleDeLaPerdida("lost", "won")).toBe(true);
		expect(
			decidirRevalidacion({ status: "won", closurePercentage: 40 }),
		).toEqual({ tipo: "solo_aviso", razon: "won" });
	});

	test("quedarse en lost, o no mandar status, no saca a nadie", () => {
		expect(saleDeLaPerdida("lost", "lost")).toBe(false);
		expect(saleDeLaPerdida("lost", undefined)).toBe(false);
		expect(saleDeLaPerdida("lost", null)).toBe(false);
	});

	test("la que nunca estuvo perdida no revalida por cambiar de estado", () => {
		// Si no, toda edición de status pagaría un reset y las solicitudes vivas
		// quedarían rebotando a análisis sin que nadie haya tocado una identidad.
		expect(saleDeLaPerdida("open", "on_hold")).toBe(false);
		expect(saleDeLaPerdida("open", "won")).toBe(false);
		expect(saleDeLaPerdida(null, "open")).toBe(false);
		expect(saleDeLaPerdida(undefined, "open")).toBe(false);
	});
});

describe("qué se le toca a la que se resetea", () => {
	test("vuelve a análisis, pendiente y con el detalle de crédito sin aprobar", () => {
		const cuando = new Date("2026-09-18T10:00:00.000Z");

		expect(parcheDeRevalidacion("etapa-30", cuando)).toEqual({
			stageId: "etapa-30",
			analysisStatus: "pending",
			creditDetailApproved: false,
			// La marca viaja en el mismo parche: sin ella el DPI escaneado de la
			// identidad vieja seguiría alcanzando para volver a aprobar.
			identityRevalidatedAt: cuando,
		});
	});

	test("🔴 sin fecha explícita, la marca la pone el servidor al ejecutar el UPDATE", () => {
		// Tomarla de este lado antes de entrar a la transacción abría una
		// ventana: un documento de identidad subido mientras el reset esperaba
		// el candado quedaba con fecha POSTERIOR a la marca y pasaba por
		// evidencia de la identidad nueva siendo de la vieja.
		const marca = parcheDeRevalidacion("etapa-30").identityRevalidatedAt;

		expect(marca).not.toBeInstanceOf(Date);
		expect(JSON.stringify(marca)).toContain("clock_timestamp()");
	});

	test("la etapa de análisis es la del 30%, el mismo umbral del candado", () => {
		expect(PORCENTAJE_ETAPA_ANALISIS).toBe(30);
	});
});

/**
 * 🔴 El reset mandaba el expediente de vuelta a análisis, pero los DOCUMENTOS de
 * la identidad vieja seguían satisfaciendo el requisito: bastaba con volver a
 * aprobar, con el DPI escaneado de otra persona en el expediente.
 */
describe("el documento de identidad tiene que ser posterior a la revalidación", () => {
	const REVALIDADA = new Date("2026-09-18T12:00:00.000Z");
	const doc = (documentType: string, iso: string) => ({
		documentType,
		uploadedAt: new Date(iso),
	});

	test("sin marca no cambia nada: pasa todo lo subido", () => {
		const documentos = [doc("dpi", "2026-01-01T00:00:00.000Z")];

		expect(documentosDeIdentidadVigentes(documentos, null)).toEqual(documentos);
		expect(documentosDeIdentidadVigentes(documentos, undefined)).toEqual(
			documentos,
		);
	});

	test("el DPI anterior a la marca deja de contar", () => {
		expect(
			documentosDeIdentidadVigentes(
				[doc("dpi", "2026-09-18T11:59:59.000Z")],
				REVALIDADA,
			),
		).toEqual([]);
	});

	test("el DPI posterior a la marca sí cuenta", () => {
		const nuevo = doc("dpi", "2026-09-18T12:00:01.000Z");

		expect(documentosDeIdentidadVigentes([nuevo], REVALIDADA)).toEqual([nuevo]);
	});

	test("también cae la categoría heredada `identification`", () => {
		expect(
			documentosDeIdentidadVigentes(
				[doc("identification", "2026-01-01T00:00:00.000Z")],
				REVALIDADA,
			),
		).toEqual([]);
	});

	test("los demás documentos no se re-piden: no dicen quién es el solicitante", () => {
		const otros = [
			doc("recibo_luz", "2026-01-01T00:00:00.000Z"),
			doc("estados_cuenta_1", "2026-01-01T00:00:00.000Z"),
		];

		expect(documentosDeIdentidadVigentes(otros, REVALIDADA)).toEqual(otros);
	});

	test("distingue 'quedó viejo' de 'nunca se subió' para elegir el mensaje", () => {
		// Hay dpi subido y igual falta → quedó viejo: mandar al analista a buscar
		// un archivo que está ahí sería el peor de los mensajes.
		expect(faltaPorIdentidadRevalidada(["dpi"], ["dpi", "licencia"])).toBe(
			true,
		);
		// Falta el dpi y no hay ninguno → nunca se subió: mensaje de siempre.
		expect(faltaPorIdentidadRevalidada(["dpi"], ["licencia"])).toBe(false);
		// Falta otra cosa → no es asunto de la identidad.
		expect(faltaPorIdentidadRevalidada(["recibo_luz"], ["dpi"])).toBe(false);
	});

	test("el mensaje dice qué pasó y qué hacer", () => {
		expect(MENSAJE_DPI_DESACTUALIZADO).toContain("revalidada");
		expect(MENSAJE_DPI_DESACTUALIZADO).toContain("Subí el DPI actualizado");
	});

	test("el chequeo está cableado en approveOpportunityAnalysis", () => {
		const desde = crmFuente.indexOf(
			"approveOpportunityAnalysis: analystProcedure",
		);
		expect(desde).toBeGreaterThan(-1);
		const bloque = crmFuente.slice(desde, desde + 12000);

		expect(bloque).toContain("documentosDeIdentidadVigentes(");
		expect(bloque).toContain("MENSAJE_DPI_DESACTUALIZADO");
	});
});

/**
 * Banco de pruebas: una base falsa que registra el UPDATE que recibió.
 *
 * `devuelve` son los ids que el UPDATE reporta como escritos. Es lo que permite
 * simular la carrera: el predicado del UPDATE excluye una fila y esa fila no
 * vuelve, aunque el snapshot la diera por reseteable.
 */
/** Quien responde por el retroceso: va a `opportunityStageHistory.changedBy`. */
const USUARIO = "usr-admin-1";

/**
 * `etapasPrevias` es de dónde venía cada oportunidad: la lectura que se hace
 * ANTES del UPDATE, porque `RETURNING` devuelve la fila NUEVA y después del
 * reset ya no hay forma de saber de qué etapa salió.
 */
function banco(
	etapa: { id: string } | null,
	devuelve: string[] = [],
	etapasPrevias: Array<{ id: string; stageId: string | null }> = [],
) {
	const actualizados: unknown[] = [];
	const anotaciones: AuditEntry[] = [];
	const transiciones: unknown[] = [];

	const database = {
		// Dos consultas pasan por acá: la de la etapa de análisis termina en
		// `.limit(1)` y la de las etapas previas se espera directo sobre el
		// `.where()`. El doble devuelve un thenable con `.limit()` encima, así cada
		// una se queda con lo suyo sin tener que mirar la tabla.
		select: () => ({
			from: () => ({
				where: () =>
					Object.assign(Promise.resolve(etapasPrevias), {
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
		insert: () => ({
			values: async (filas: unknown) => {
				transiciones.push(filas);
			},
		}),
	} as never;

	return {
		actualizados,
		anotaciones,
		transiciones,
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
			cambiadaPor: USUARIO,
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

	/**
	 * 🔴 El reset cambiaba `stageId` sin insertar la transición. Para los
	 * timelines y para `latestStageChangedAt` la oportunidad seguía en la etapa
	 * avanzada: el retroceso era invisible —la pantalla mostraba una historia que
	 * termina en el 40% con la solicitud parada en el 30%— y el tiempo en etapa
	 * se seguía contando desde una transición que ya no era la real.
	 */
	test("🔴 el retroceso deja su fila en el historial de etapas", async () => {
		const b = banco(
			{ id: "etapa-30" },
			["op-40"],
			[{ id: "op-40", stageId: "etapa-40" }],
		);

		await revalidarOportunidades({
			oportunidades: [RESETEABLE],
			accion: "candado_override_revalidacion",
			detalle: "porque sí",
			anotar: b.anotar,
			cambiadaPor: USUARIO,
			database: b.database,
		});

		expect(b.transiciones).toHaveLength(1);
		expect((b.transiciones[0] as unknown[])[0]).toMatchObject({
			opportunityId: "op-40",
			// De dónde salía, leído ANTES del UPDATE: `RETURNING` da la fila nueva.
			fromStageId: "etapa-40",
			toStageId: "etapa-30",
			changedBy: USUARIO,
			// `isOverride` es del flujo ventas-vs-análisis, no de este retroceso.
			isOverride: false,
		});
	});

	test("la fila dice por qué, para que el retroceso no parezca un error de alguien", () => {
		expect(RAZON_TRANSICION_REVALIDACION).toContain(
			"Revalidación de identidad",
		);
	});

	test("la que la salvaguarda dejó intacta NO estrena transición", async () => {
		// Una fila de transición de una oportunidad que nunca se movió es una fila
		// que miente, y el timeline es justo donde eso se nota.
		const b = banco(
			{ id: "etapa-30" },
			[],
			[{ id: "op-40", stageId: "etapa-40" }],
		);

		await revalidarOportunidades({
			oportunidades: [RESETEABLE],
			accion: "candado_override_revalidacion",
			detalle: "porque sí",
			anotar: b.anotar,
			cambiadaPor: USUARIO,
			database: b.database,
		});

		expect(b.transiciones).toEqual([]);
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
			cambiadaPor: USUARIO,
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
			cambiadaPor: USUARIO,
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
			cambiadaPor: USUARIO,
			database: b.database,
		});

		expect(resultado.reseteadas).toEqual(["op-40"]);
		expect(resultado.avisadas).toEqual([{ id: "op-won", razon: "won" }]);
		// Un solo UPDATE para todas las reseteables: no hay N+1.
		expect(b.actualizados).toHaveLength(1);
		expect(b.anotaciones).toHaveLength(2);
	});

	/**
	 * 🔴 Sin etapa de análisis no hay a dónde mandarlas, y eso es un FALLO, no un
	 * aviso. Antes se anotaba y se devolvía "no se revalidó nada": el llamador
	 * seguía su curso y commiteaba igual el cambio de identidad, con la
	 * oportunidad viva y aprobada contra la identidad VIEJA. El agujero entero,
	 * con una fila de bitácora que nadie mira en el momento.
	 *
	 * Ahora lanza, y como corre dentro de la transacción que cambia la identidad,
	 * el throw se lleva puesto ese cambio: o se revalida, o no se cambia.
	 */
	test("🔴 sin etapa de análisis falla y no deja escribir nada", async () => {
		const b = banco(null);

		await expect(
			revalidarOportunidades({
				oportunidades: [RESETEABLE],
				accion: "candado_override_revalidacion",
				detalle: "porque sí",
				anotar: b.anotar,
				cambiadaPor: USUARIO,
				database: b.database,
			}),
		).rejects.toBeInstanceOf(ErrorRevalidacionIncompleta);

		// Dejar `analysisStatus: pending` con la etapa al 40% sería un estado que
		// ninguna pantalla sabe leer: no se escribió nada.
		expect(b.actualizados).toEqual([]);
	});

	test("el mensaje del fallo dice que el cambio se revirtió", async () => {
		// Quien lo lea tiene que saber que el DPI NO quedó cambiado; si no, va a
		// creer que el cambio pasó y solo falló el reset.
		const b = banco(null);

		await expect(
			revalidarOportunidades({
				oportunidades: [RESETEABLE],
				accion: "candado_override_revalidacion",
				detalle: "porque sí",
				anotar: b.anotar,
				cambiadaPor: USUARIO,
				database: b.database,
			}),
		).rejects.toThrow("se revirtió");
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
			cambiadaPor: USUARIO,
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
			cambiadaPor: USUARIO,
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
	const crm = crmFuente;

	test("la reapertura de una perdida dispara la revalidación", () => {
		expect(crm).toContain("reabrir_oportunidad_revalidacion");
		expect(
			crm,
			"updateOpportunity debería detectar CUALQUIER salida de lost con `saleDeLaPerdida`, " +
				"no solo la transición a open: con `lost → on_hold → open` la revalidación no se disparaba.",
		).toContain("saleDeLaPerdida(");
	});

	test("la decisión se toma sobre el status al que la oportunidad VUELVE", () => {
		// Con un "open" fijo, un `lost → won` se evaluaba como si volviera a open y
		// la salvaguarda de las ganadas —contratos ya firmados— no lo reconocía.
		expect(crm).toContain("status: updateData.status ?? comoEsta.status");
	});

	test("la reapertura también deja su transición, en la misma transacción", () => {
		// Sin la fila, el timeline sigue mostrando la etapa avanzada y
		// `latestStageChangedAt` sigue contando desde una transición que ya no fue.
		expect(crm).toContain("RAZON_TRANSICION_REVALIDACION");
		expect(
			crm,
			"la fila de la etapa pedida no puede escribirse cuando la revalidación se llevó " +
				"puesto ese stageId: diría que la oportunidad fue a una etapa a la que nunca llegó.",
		).toContain("isStageChange && input.stageId && !parcheRevalidacion");
	});

	test("el reset de la reapertura viaja en el MISMO UPDATE que el status", () => {
		// En dos sentencias quedaría una ventana con la oportunidad ya reabierta y
		// todavía marcada como validada.
		expect(crm).toContain("...(parcheRevalidacion ?? {})");
	});

	/**
	 * 🔴 La mutación de identidad y su revalidación corrían en transacciones
	 * SEPARADAS: si la revalidación fallaba, el DPI nuevo quedaba commiteado con
	 * la oportunidad todavía aprobada contra la identidad vieja — el expediente
	 * sobreviviente afirmando cosas de una persona que ya no es la del DPI.
	 * Ahora entran las dos o no entra ninguna.
	 */
	test("los tres sitios revalidan DENTRO de la transacción que cambia la identidad", () => {
		// `updateLead`, `updateCoDebtor` y `deleteCoDebtor`: cada uno le pasa su
		// propio `tx` a `revalidarOportunidades`.
		expect(
			crm.split("database: tx,").length - 1,
			"updateLead, updateCoDebtor y deleteCoDebtor tienen que revalidar con su " +
				"propio tx; si un sitio vuelve a usar la conexión suelta, una " +
				"revalidación caída deja el DPI nuevo commiteado.",
		).toBe(3);
	});

	test("el override del admin sobre el candado dispara la revalidación", () => {
		expect(crm).toContain("candado_override_revalidacion");
		// Tres puntos de override: el DPI del lead, el DPI del co-deudor y el
		// BORRADO del co-deudor. El tercero se sumó al decidir que borrar al
		// co-deudor analizado cuesta lo mismo que cambiarle el DPI: si no
		// revalidara, la oportunidad seguiría aprobada sobre un respaldo que ya no
		// existe.
		expect(crm.split("candado_override_revalidacion").length - 1).toBe(3);
	});
});
