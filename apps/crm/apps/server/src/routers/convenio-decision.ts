/**
 * CB-033 — Aprobar/rechazar un convenio de pago pendiente, y su historial.
 *
 * Módulo aparte, no en cobros.ts: mismo motivo que pagalo-grupo-activo.ts /
 * pagalo-supervision.ts — cobrosAppRouter ya está en el límite donde TS7056
 * trunca el tipo inferido en el web (ver el comentario de esos archivos y
 * https://orpc.dev/docs/advanced/exceeds-the-maximum-length-problem).
 */

import { ORPCError } from "@orpc/server";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { casosCobros } from "../db/schema/cobros";
import { cobrosProcedure, cobrosSupervisorProcedure } from "../lib/orpc";
import {
	CarteraBackHttpError,
	carteraBackClient,
} from "../services/cartera-back-client";
import { isCarteraBackEnabled } from "../services/cartera-back-integration";
import {
	notificarConvenioResuelto,
	resolverPendientesDeAprobacion,
} from "../services/convenio-decision-notif";
import { assertAccesoCasoCobro } from "./cobros";

/**
 * Códigos de negocio de cartera que prueban que la decisión NO se ejecutó:
 * cartera **llegó a evaluar la operación** y la rechazó. Solo estos son
 * "definitivos" y permiten al cliente descartar el intento pendiente.
 *
 * Es una ALLOWLIST a propósito, no un rango de status: un 401/403/429 de
 * cartera (sesión del CRM vencida, rate limit del proxy) también es <500 y
 * no prueba nada sobre la petición original — clasificarlo por rango hacía
 * que el cliente borrara el `operacion_id` con el que podía recuperarse.
 * Un código que no esté acá se trata como incierto por definición.
 *
 * El criterio para entrar NO es "es un 4xx" ni "es un error de negocio",
 * sino: **¿el error depende del contenido de ESTA petición, de modo que
 * reenviarla idéntica volvería a fallar igual?** Si sí, la decisión no se
 * aplicó y no se va a aplicar: el intento ya no sirve.
 *
 * Eso incluye validaciones que corren ANTES de tocar la transacción
 * (`motivo_requerido`, `convenio_id_invalido`): el reenvío manda el payload
 * congelado, así que un motivo ausente o un id inválido no cambian solos.
 * Y excluye todo lo que depende del ENTORNO —permisos, configuración, estado
 * de otra operación en vuelo—, que puede resolverse y volver a intentarse.
 */
const CODIGOS_NEGOCIO_DEFINITIVOS: Record<string, string> = {
	convenio_no_pendiente:
		"Otro supervisor ya decidió este convenio, o ya está completado.",
	fingerprint_no_coincide:
		"Ese identificador de operación ya se usó para otra decisión. Recargá e intentá de nuevo.",
	motivo_requerido: "El rechazo requiere un motivo de al menos 5 caracteres.",
	convenio_id_invalido: "El convenio indicado no es válido.",
};

/**
 * Códigos que cartera devuelve en la **puerta**, antes de tocar la operación
 * (`requireConvenioDecisionRole` y las validaciones de atribución de
 * `paymentAgree.ts`). Describen el REENVÍO, no la petición original.
 *
 * Por qué no van en la allowlist de arriba, aunque sean 4xx de negocio: si un
 * rechazo quedó confirmado en cartera y la respuesta se perdió, y entremedio
 * cambia la configuración —`CRM_SERVICE_USER_ID` se desconfigura en un
 * redeploy, al supervisor le cambian el rol—, el reenvío choca contra este
 * gate. Tratarlo como definitivo borraba el `operacion_id` de una decisión
 * **ya ejecutada**, que es justo lo que el intento existe para recuperar.
 *
 * Se le muestra al usuario el mensaje real (el problema es accionable: hay
 * que arreglar permisos o configuración), pero como error INCIERTO: el
 * intento sobrevive y se puede reenviar cuando eso se corrija.
 */
/**
 * La operación está en vuelo o chocó con otra sobre el MISMO `operacion_id`.
 * No se decidió nada, pero tampoco es definitivo: la guía correcta es esperar
 * unos segundos, no "reenviar para verificar". Son los dos códigos que
 * aparecen justo cuando dos supervisores tocan el mismo id, que es cuando el
 * mensaje más importa.
 *
 * Salen como 5xx igual que los de puerta —el intento sobrevive— pero con su
 * texto propio.
 */
const CODIGOS_DE_REINTENTO: Record<string, string> = {
	operacion_en_curso:
		"Esta decisión ya se está procesando. Esperá unos segundos y volvé a consultar antes de reenviar.",
	operacion_en_conflicto:
		"La operación chocó con otra sobre el mismo identificador. Esperá unos segundos y reintentá.",
};

const CODIGOS_DE_PUERTA: Record<string, string> = {
	convenio_decision_no_autorizado:
		"No tenés permiso para decidir convenios en cartera. La decisión anterior puede haberse aplicado igual: el aviso de decisiones por confirmar sigue disponible para verificarlo.",
	decidido_por_email_requerido:
		"Falta identificar al supervisor que decide (configuración del CRM). Reportalo a soporte: el aviso de decisiones por confirmar se mantiene.",
	decidido_por_email_no_permitido:
		"No se puede atribuir la decisión a otra persona desde este origen (configuración del CRM). Reportalo a soporte: el aviso de decisiones por confirmar se mantiene.",
};

export const convenioDecisionRouter = {
	// CB-033 — Aprobar/rechazar un convenio pendiente. `cobrosSupervisorProcedure`:
	// la decisión se reserva a supervisores/admin, no a cualquier asesor con
	// acceso a cobros. El endpoint de cartera valida el rol otra vez del lado
	// de cartera (defensa en profundidad, ver 06-ficha-360.md §3.5).
	decidirConvenio: cobrosSupervisorProcedure
		.input(
			z.object({
				convenioId: z.number().int().positive(),
				decision: z.enum(["aprobado", "rechazado"]),
				// El .trim() importa: sin él, "     " pasa esta validación y
				// recién lo frena el CHECK de la DB en cartera — la regla tiene
				// que decir lo mismo en los dos lados.
				motivo: z.string().trim().min(5).max(1000).optional(),
				// Lo genera EL CLIENTE (no acá): es la clave de la idempotencia.
				// Un reintento reenvía el mismo id y cartera responde
				// idempotente en vez de duplicar el efecto.
				operacionId: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Guard de PUERTA, no de negocio: la integración deshabilitada es
			// configuración del CRM y no dice nada sobre la petición original.
			// Si una decisión quedó confirmada sin respuesta y después se apaga
			// la integración, un 400 acá le haría descartar al cliente el
			// `operacion_id` de algo YA EJECUTADO. 503 lo conserva, que es lo
			// correcto: el reenvío vuelve a ser posible al reactivarla.
			if (!isCarteraBackEnabled()) {
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					message:
						"La integración con cartera no está habilitada. Si ya habías enviado una decisión, " +
						"el aviso de decisiones por confirmar se mantiene para verificarla cuando se reactive.",
				});
			}
			// Este SÍ es definitivo: el reenvío manda el payload congelado del
			// intento original, así que un motivo ausente no puede aparecer
			// después. Ningún reintento lo arreglaría.
			if (input.decision === "rechazado" && !input.motivo) {
				throw new ORPCError("BAD_REQUEST", {
					message: "El rechazo requiere un motivo de al menos 5 caracteres.",
				});
			}
			// De puerta otra vez: una sesión sin email habla del reenvío (igual
			// que un 401), no de lo que pasó con la decisión anterior.
			const email = context.session?.user?.email?.trim().toLowerCase();
			if (!email) {
				throw new ORPCError("UNAUTHORIZED", {
					message:
						"Usuario no autenticado. Si ya habías enviado una decisión, el aviso de " +
						"decisiones por confirmar se mantiene: volvé a iniciar sesión para verificarla.",
				});
			}

			let resultado: Awaited<
				ReturnType<typeof carteraBackClient.decidirConvenio>
			>;
			try {
				resultado = await carteraBackClient.decidirConvenio(input.convenioId, {
					decision: input.decision,
					motivo: input.motivo,
					operacion_id: input.operacionId,
					// El procedure ya validó el rol (cobrosSupervisorProcedure);
					// cartera acepta esta atribución SOLO porque el llamante es la
					// cuenta de servicio del CRM (CRM_SERVICE_USER_ID).
					decidido_por_email: email,
				});
			} catch (error) {
				// Lo que se propaga al cliente decide si conserva o descarta el
				// rastro para recuperarse, así que se clasifica por CÓDIGO DE
				// NEGOCIO, no por rango HTTP: un 401/403/429 de cartera es <500
				// pero no prueba nada sobre si la decisión se ejecutó.
				const codigo =
					error instanceof CarteraBackHttpError
						? error.payload?.error
						: undefined;
				const mensajeDefinitivo = codigo
					? CODIGOS_NEGOCIO_DEFINITIVOS[codigo]
					: undefined;

				if (mensajeDefinitivo) {
					// Cartera consultó la operación y la rechazó: la decisión NO
					// se aplicó.
					throw new ORPCError("BAD_REQUEST", { message: mensajeDefinitivo });
				}

				console.error("[decidirConvenio] Error de cartera-back:", error);

				// Error de puerta (permisos, atribución): cartera ni llegó a mirar
				// la operación, así que no dice nada de la petición original. Se
				// propaga como INCIERTO —el cliente conserva el intento— pero con
				// el mensaje real, porque el usuario puede hacer algo al respecto
				// (pedir permisos, avisar a soporte).
				// Puerta y reintento comparten desenlace (5xx, el intento
				// sobrevive) pero no mensaje: uno pide arreglar permisos o
				// configuración, el otro simplemente esperar.
				const mensajeAccionable = codigo
					? (CODIGOS_DE_PUERTA[codigo] ?? CODIGOS_DE_REINTENTO[codigo])
					: undefined;
				if (mensajeAccionable) {
					throw new ORPCError("INTERNAL_SERVER_ERROR", {
						message: mensajeAccionable,
					});
				}

				// Todo lo demás —5xx, 401/403/429, timeout, red caída, código
				// desconocido— deja el resultado INCIERTO: se propaga como 5xx
				// para que el cliente conserve el intento y pueda reenviarlo
				// con el mismo operacion_id.
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message:
						"No se pudo confirmar el resultado de la decisión en cartera. " +
						'Usá "Reenviar" en el aviso de decisiones por confirmar para verificar si se aplicó.',
				});
			}

			// Best-effort: avisar al asesor. Nunca falla la decisión por esto —
			// ya está commiteada en cartera y es irreversible desde acá. El
			// snapshot trae numero_credito_sifco; desde ahí se resuelve el caso
			// (para relatedEntityId) y el asesor (para saber a quién avisar).
			try {
				const numeroSifco = resultado.snapshot.numero_credito_sifco;
				if (numeroSifco) {
					const [caso, credito] = await Promise.all([
						// `numero_credito_sifco` NO es único en casos_cobros, y
						// `getDetallesCreditoCarteraBack` crea un caso nuevo cuando no
						// hay uno activo — así que un SIFCO puede tener casos viejos
						// inactivos además del vigente. Un `limit(1)` sin filtro ni
						// orden podía colgar el aviso del caso viejo, y como
						// `getAlertasCaso` compara `relatedEntityId` exacto, el asesor
						// no vería la resolución en el caso donde gestionó el convenio.
						// Se prefiere el activo y, a igualdad, el más reciente.
						db
							.select({ id: casosCobros.id })
							.from(casosCobros)
							.where(eq(casosCobros.numeroCreditoSifco, numeroSifco))
							.orderBy(
								desc(sql`${casosCobros.activo} IS TRUE`),
								desc(casosCobros.createdAt),
							)
							.limit(1)
							.then((rows) => rows[0]),
						carteraBackClient
							.getCredito(numeroSifco, false, false)
							.catch(() => null),
					]);
					const emailAsesor = credito?.asesor?.emailCashIn
						?.trim()
						.toLowerCase();
					// El destinatario es el asesor que lleva el crédito AHORA, no el
					// que creó el convenio (el snapshot trae `created_by`, se usa a
					// propósito el actual): si el crédito se reasignó entre la
					// creación y la decisión, quien tiene que enterarse del resultado
					// es quien va a gestionarlo de acá en adelante.
					//
					// Se normalizan LOS DOS lados: el CRM no normaliza el email al
					// crear el usuario, así que uno guardado con mayúsculas o espacios
					// no casaría contra el de cartera ya normalizado, y el aviso se
					// saltaría en silencio. Mismo criterio que
					// `construirMapaAsesorUsuario` en cobros-notif-helpers.ts.
					const asesorUserId = emailAsesor
						? await db
								.select({ id: user.id })
								.from(user)
								.where(eq(sql`lower(btrim(${user.email}))`, emailAsesor))
								.limit(1)
								.then((rows) => rows[0]?.id ?? null)
						: null;

					if (caso?.id) {
						await notificarConvenioResuelto({
							casoCobroId: caso.id,
							// El de la respuesta, no el del input: en una respuesta
							// idempotente es el de la decisión ORIGINAL, que es
							// justo el convenio cuyos avisos hay que cerrar.
							convenioId: resultado.convenioId,
							asesorUserId,
							decisionId: resultado.decisionId,
							decision: resultado.decision,
							motivo: input.motivo,
							creadoPorUserId: context.userId,
							// El rol REAL de quien decidió: cobrosSupervisorProcedure
							// admite ADMIN además de COBROS_SUPERVISOR, y la UI
							// muestra este rol junto al nombre.
							creadoPorRole: context.userRole,
						});
					}
				}
			} catch (error) {
				console.warn(
					"[decidirConvenio] No se pudo notificar al asesor (best-effort):",
					error instanceof Error ? error.message : error,
				);
			}

			// Red de seguridad INCONDICIONAL: el bloque de arriba cierra los
			// avisos, pero solo si llegó hasta `notificarConvenioResuelto` —
			// cuelga de `if (numeroSifco)` y `if (caso?.id)`, y un snapshot sin
			// SIFCO o un fallo leyendo `casos_cobros` dejaba a todos los
			// supervisores con el aviso abierto para siempre. Acá solo hace
			// falta `resultado.convenioId`, que siempre viene.
			//
			// Va al final, no antes del bloque: la señal `convenio_resuelto` que
			// usa `reconciliarSiYaSeDecidio` se escribe ahí dentro, y cerrar
			// antes de que exista deja una ventana en la que un aviso que llegue
			// tarde no encuentra con qué repararse. Repetir el cierre es
			// inocuo: el UPDATE no encuentra filas abiertas la segunda vez.
			try {
				await resolverPendientesDeAprobacion(resultado.convenioId);
			} catch (error) {
				console.warn(
					"[decidirConvenio] No se pudieron cerrar los avisos de aprobación (best-effort):",
					error instanceof Error ? error.message : error,
				);
			}

			return resultado;
		}),

	// CB-033 — Historial de decisiones de convenio POR CASO (no por convenio:
	// el rechazo borra la fila del convenio en cartera). Autorización por
	// caso, no solo por rol: `assertAccesoCasoCobro` es el mismo gate que usa
	// `crearConvenioDesdeFicha` — `cobrosProcedure` solo dejaría a cualquier
	// asesor leer decisiones de créditos ajenos.
	getDecisionesConvenio: cobrosProcedure
		.input(z.object({ casoCobroId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			await assertAccesoCasoCobro(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);

			const [caso] = await db
				.select({ numeroCreditoSifco: casosCobros.numeroCreditoSifco })
				.from(casosCobros)
				.where(eq(casosCobros.id, input.casoCobroId))
				.limit(1);
			if (!caso?.numeroCreditoSifco) return [];

			// Un fallo de cartera NO se traduce a lista vacía: en una pantalla
			// de auditoría, "no hay decisiones" y "no pude consultarlas" son
			// cosas distintas y el usuario tiene que poder distinguirlas. Se
			// propaga el error para que la UI ofrezca reintentar.
			let credito: Awaited<ReturnType<typeof carteraBackClient.getCredito>>;
			try {
				credito = await carteraBackClient.getCredito(
					caso.numeroCreditoSifco,
					true,
				);
			} catch (error) {
				console.error(
					"[getDecisionesConvenio] No se pudo resolver el crédito en cartera:",
					error,
				);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "No se pudo cargar el historial de decisiones del convenio",
				});
			}

			try {
				return await carteraBackClient.getDecisionesConvenio(
					credito.credito.credito_id,
				);
			} catch (error) {
				console.error("[getDecisionesConvenio] Error:", error);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "No se pudo cargar el historial de decisiones del convenio",
				});
			}
		}),
};
