/**
 * Contrapropuesta de convenio (tarea M4 de
 * docs/features/cobros-02/18-equipo-solicitudes-backend.md).
 *
 * El supervisor revisa un convenio pendiente y, en vez de aprobarlo o
 * rechazarlo, se lo devuelve al asesor con otro número de cuotas y otra fecha
 * de primer pago (el total no cambia). Mientras la contrapropuesta espera
 * respuesta, el convenio no se puede decidir. El asesor la acepta (cartera
 * reescribe el plan y el convenio sigue pendiente, listo para aprobarse) o la
 * descarta (el supervisor decide el plan original). Reglas puras en
 * lib/contrapropuesta-convenio.ts.
 */

import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	casosCobros,
	contrapropuestasConvenioCobros,
} from "../db/schema/cobros";
import { notifications } from "../db/schema/notifications";
import {
	cuotaMensualDe,
	motivoContrapropuestaInvalida,
	puedeResponderContrapropuesta,
} from "../lib/contrapropuesta-convenio";
import { leerMaxMesesConvenio } from "../lib/convenio-desde-ficha";
import { toDateStrGT } from "../lib/guatemala-month-window";
import type { CarteraConvenioPlan } from "../types/cartera-back";
import { CarteraBackHttpError, carteraBackClient } from "./cartera-back-client";
import { obtenerSupervisoresCobros } from "./cobros-notif-helpers";

type RolNotificacion = (typeof notifications.createdByRole.enumValues)[number];

const ESTADOS_ABIERTOS = ["pending", "read", "in_progress"] as const;

export type ContrapropuestaConvenio =
	typeof contrapropuestasConvenioCobros.$inferSelect;

/** El convenio, su crédito, el caso vigente y el asesor que lleva el crédito AHORA. */
async function contextoDelConvenio(
	plan: CarteraConvenioPlan,
	ejecutor: Pick<typeof db, "select"> = db,
) {
	const sifco = plan.numero_credito_sifco;
	if (!sifco) {
		throw new ORPCError("CONFLICT", {
			message: "No se pudo identificar el crédito del convenio.",
		});
	}
	const [caso, credito] = await Promise.all([
		// Un SIFCO puede tener casos viejos inactivos: se prefiere el vigente.
		ejecutor
			.select({ id: casosCobros.id })
			.from(casosCobros)
			.where(eq(casosCobros.numeroCreditoSifco, sifco))
			.orderBy(
				desc(sql`${casosCobros.activo} IS TRUE`),
				desc(casosCobros.createdAt),
			)
			.limit(1)
			.then((r) => r[0]),
		carteraBackClient.getCredito(sifco, false, false).catch(() => null),
	]);
	if (!caso) {
		throw new ORPCError("NOT_FOUND", {
			message: "No se encontró el caso de cobro de este convenio.",
		});
	}
	const emailAsesor =
		credito?.asesor?.emailCashIn?.trim().toLowerCase() ?? null;
	const asesorUserId = emailAsesor
		? await ejecutor
				.select({ id: user.id })
				.from(user)
				.where(eq(sql`lower(btrim(${user.email}))`, emailAsesor))
				.limit(1)
				.then((r) => r[0]?.id ?? null)
		: null;
	return { sifco, casoCobroId: caso.id, emailAsesor, asesorUserId };
}

async function leerPlanOFallar(
	convenioId: number,
): Promise<CarteraConvenioPlan> {
	try {
		return await carteraBackClient.getPlanConvenio(convenioId);
	} catch (error) {
		// Solo el código de negocio es terminal. Un 404 de ruta (cartera en
		// despliegue o desordenada, sin la ruta del plan) no dice nada del
		// convenio y no puede dar por muerta la contrapropuesta.
		if (
			error instanceof CarteraBackHttpError &&
			error.status === 404 &&
			error.payload?.error === "convenio_no_existe"
		) {
			throw new ORPCError("NOT_FOUND", {
				message: "El convenio ya no existe (se rechazó o se deshizo).",
			});
		}
		console.error("[contrapropuesta] No se pudo leer el plan:", error);
		throw new ORPCError("SERVICE_UNAVAILABLE", {
			message:
				"No se pudo leer el plan del convenio en cartera. Intente de nuevo en un momento.",
		});
	}
}

type Ejecutor = Pick<typeof db, "select" | "update" | "insert" | "transaction">;

/** Espacio de nombres del candado, para no chocar con otros advisory locks. */
const CANDADO_CONVENIO_CONTRAPROPUESTA = 24_001;

/**
 * Serializa por convenio lo que decide su suerte: crear una contrapropuesta,
 * responderla y decidir el convenio. Es un candado de transacción de Postgres
 * (se libera al terminar, también entre instancias del servidor), así que la
 * lectura de «¿hay una pendiente?» y la escritura que sigue no se pisan con la
 * de otro supervisor o del asesor. Lo de adentro debe usar el `tx` que recibe
 * para sus lecturas y escrituras en la BD: otra conexión del pool podría no
 * conseguirla si hay varias esperando el candado.
 */
export async function conBloqueoDeConvenio<T>(
	convenioId: number,
	fn: (tx: Ejecutor) => Promise<T>,
): Promise<T> {
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(${CANDADO_CONVENIO_CONTRAPROPUESTA}, ${convenioId})`,
		);
		return fn(tx);
	});
}

/** ¿Hay una contrapropuesta esperando respuesta del asesor? Frena `decidirConvenio`. */
export async function contrapropuestaPendienteDe(
	convenioId: number,
	ejecutor: Ejecutor = db,
) {
	const [fila] = await ejecutor
		.select()
		.from(contrapropuestasConvenioCobros)
		.where(
			and(
				eq(contrapropuestasConvenioCobros.convenioId, convenioId),
				eq(contrapropuestasConvenioCobros.estado, "pendiente"),
			),
		)
		.limit(1);
	return fila ?? null;
}

export async function crearContrapropuesta(params: {
	convenioId: number;
	numeroMeses: number;
	primerPago: string;
	nota: string;
	supervisorId: string;
	supervisorRole: RolNotificacion;
}) {
	const plan = await leerPlanOFallar(params.convenioId);
	if (plan.estado !== "pendiente") {
		throw new ORPCError("CONFLICT", {
			message:
				"Solo se puede contraproponer un convenio pendiente de aprobación.",
		});
	}
	const motivo = motivoContrapropuestaInvalida({
		numeroMeses: params.numeroMeses,
		primerPago: params.primerPago,
		hoy: toDateStrGT(new Date()),
		maxMeses: leerMaxMesesConvenio(),
		actual: { numeroMeses: plan.numero_meses, primerPago: plan.primer_pago },
		diaConvenio: toDateStrGT(new Date(plan.fecha_convenio)),
	});
	if (motivo) throw new ORPCError("BAD_REQUEST", { message: motivo });

	const creada = await conBloqueoDeConvenio(params.convenioId, async (tx) => {
		// Bajo el candado se vuelve a mirar el convenio: si se decidió mientras se
		// validaba, no se le deja una contrapropuesta pendiente a algo ya resuelto.
		const vigente = await leerPlanOFallar(params.convenioId);
		if (vigente.estado !== "pendiente") {
			throw new ORPCError("CONFLICT", {
				message:
					"Solo se puede contraproponer un convenio pendiente de aprobación.",
			});
		}
		// El asesor que cuenta también es el de bajo el candado: si el crédito se
		// reasignó mientras tanto, el aviso (y la contrapropuesta) son del nuevo.
		const ctxActual = await contextoDelConvenio(vigente, tx);
		// El plan que cuenta es el de bajo el candado: si el asesor aceptó otra
		// contrapropuesta mientras tanto, `plan` (leído antes) ya quedó viejo. Se
		// valida de nuevo y el «original» que verá el asesor sale de este.
		const motivoVigente = motivoContrapropuestaInvalida({
			numeroMeses: params.numeroMeses,
			primerPago: params.primerPago,
			hoy: toDateStrGT(new Date()),
			maxMeses: leerMaxMesesConvenio(),
			actual: {
				numeroMeses: vigente.numero_meses,
				primerPago: vigente.primer_pago,
			},
			diaConvenio: toDateStrGT(new Date(vigente.fecha_convenio)),
		});
		if (motivoVigente) {
			throw new ORPCError("BAD_REQUEST", { message: motivoVigente });
		}
		const total = Number(vigente.monto_total_convenio);
		const cuota = cuotaMensualDe(total, params.numeroMeses);
		// Una nueva reemplaza a la que siga esperando: el supervisor cambió de idea.
		await tx
			.update(contrapropuestasConvenioCobros)
			.set({ estado: "sin_efecto", resueltaEn: new Date() })
			.where(
				and(
					eq(contrapropuestasConvenioCobros.convenioId, params.convenioId),
					eq(contrapropuestasConvenioCobros.estado, "pendiente"),
				),
			);
		const [fila] = await tx
			.insert(contrapropuestasConvenioCobros)
			.values({
				casoCobroId: ctxActual.casoCobroId,
				convenioId: params.convenioId,
				numeroCreditoSifco: ctxActual.sifco,
				montoTotal: total.toFixed(2),
				numeroMesesOriginal: vigente.numero_meses,
				cuotaMensualOriginal: Number(vigente.cuota_mensual).toFixed(2),
				primerPagoOriginal: vigente.primer_pago,
				numeroMeses: params.numeroMeses,
				cuotaMensual: cuota.toFixed(2),
				primerPago: params.primerPago,
				nota: params.nota,
				creadaPor: params.supervisorId,
			})
			.returning();
		// Última mirada antes de confirmar: una decisión que llegó directo a
		// cartera (carteraFront no pasa por este candado) y se aplicó mientras
		// se escribía deshace la contrapropuesta en vez de dejarla pendiente.
		const despues = await leerPlanOFallar(params.convenioId);
		if (despues.estado !== "pendiente") {
			throw new ORPCError("CONFLICT", {
				message:
					"El convenio se decidió mientras se registraba la contrapropuesta.",
			});
		}
		// Los avisos van dentro del candado, en el orden de las contrapropuestas:
		// si salieran después, una solicitud retrasada podía cerrar el aviso de
		// la más nueva o dejar abierto el de la reemplazada. Best-effort en un
		// savepoint, para que un fallo del aviso no tire la contrapropuesta.
		try {
			await tx.transaction(async (aviso) => {
				await cerrarAvisos(
					aviso,
					params.convenioId,
					"convenio_contrapropuesta",
				);
				// Un ciclo nuevo deja obsoletos los avisos a supervisores de las
				// respuestas anteriores.
				await cerrarAvisos(
					aviso,
					params.convenioId,
					"convenio_contrapropuesta_respondida",
				);
				if (!ctxActual.asesorUserId) return;
				await aviso.insert(notifications).values({
					titulo: "Contrapropuesta de convenio",
					descripcion: `El supervisor devolvió el convenio del crédito ${ctxActual.sifco} con otro plan: ${params.numeroMeses} cuotas de Q${cuota.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, primer pago el ${params.primerPago}. Acéptela o descártela.`,
					type: "action_required",
					status: "pending",
					cobrosTipo: "convenio_contrapropuesta",
					relatedEntityType: "collection_case",
					relatedEntityId: ctxActual.casoCobroId,
					convenioId: params.convenioId,
					redirectPage: "cobros_detail",
					createdBy: params.supervisorId,
					createdByRole: params.supervisorRole,
					assignedToRole: "cobros",
					assignedTo: ctxActual.asesorUserId,
				});
			});
		} catch (error) {
			console.warn(
				"[contrapropuesta] No se pudo avisar al asesor (best-effort):",
				error instanceof Error ? error.message : error,
			);
		}
		return fila;
	});
	return creada;
}

export async function responderContrapropuesta(params: {
	id: string;
	accion: "aceptar" | "descartar";
	nota?: string;
	userId: string;
	userRole: RolNotificacion;
	email: string;
	esSupervisor: boolean;
}) {
	const [fila] = await db
		.select()
		.from(contrapropuestasConvenioCobros)
		.where(eq(contrapropuestasConvenioCobros.id, params.id))
		.limit(1);
	if (!fila) {
		throw new ORPCError("NOT_FOUND", {
			message: "No se encontró la contrapropuesta.",
		});
	}
	if (fila.estado !== "pendiente") {
		throw new ORPCError("CONFLICT", {
			message:
				"Esta contrapropuesta ya no está esperando respuesta. Actualice la vista.",
		});
	}
	let plan: CarteraConvenioPlan;
	try {
		plan = await leerPlanOFallar(fila.convenioId);
	} catch (error) {
		// El convenio ya no existe (se decidió o se deshizo fuera del CRM, p. ej.
		// en carteraFront): la contrapropuesta no se puede aceptar ni retirar y se
		// quedaría pendiente para siempre. Se cierra como sin efecto.
		if (error instanceof ORPCError && error.code === "NOT_FOUND") {
			// Con el aviso al asesor: si no, la tarea quedaría abierta para siempre.
			await conBloqueoDeConvenio(fila.convenioId, async (tx) => {
				await tx
					.update(contrapropuestasConvenioCobros)
					.set({ estado: "sin_efecto", resueltaEn: new Date() })
					.where(
						and(
							eq(contrapropuestasConvenioCobros.id, params.id),
							eq(contrapropuestasConvenioCobros.estado, "pendiente"),
						),
					);
				await cerrarAvisosDelAsesor(tx, fila.convenioId);
			});
			throw new ORPCError("NOT_FOUND", {
				message:
					"El convenio ya no existe (se rechazó o se deshizo): la contrapropuesta quedó sin efecto.",
			});
		}
		throw error;
	}
	const ctx = await contextoDelConvenio(plan);
	if (
		!puedeResponderContrapropuesta({
			accion: params.accion,
			esSupervisor: params.esSupervisor,
			emailSesion: params.email,
			emailAsesorDelCredito: ctx.emailAsesor,
		})
	) {
		throw new ORPCError("FORBIDDEN", {
			message:
				params.accion === "aceptar"
					? "Solo el asesor que lleva el crédito puede aceptar la contrapropuesta."
					: "Solo el asesor que lleva el crédito o un supervisor puede descartarla.",
		});
	}

	const cerrar = async (
		ejecutor: Ejecutor,
		estado: "aceptada" | "descartada" | "sin_efecto",
	) => {
		const [cerrada] = await ejecutor
			.update(contrapropuestasConvenioCobros)
			.set({
				estado,
				resueltaPor: params.userId,
				resueltaEn: new Date(),
				notaRespuesta: params.nota || null,
			})
			.where(
				and(
					eq(contrapropuestasConvenioCobros.id, params.id),
					eq(contrapropuestasConvenioCobros.estado, "pendiente"),
				),
			)
			.returning();
		return cerrada ?? null;
	};

	// Todo lo que cambia la suerte de la contrapropuesta va bajo el candado del
	// convenio, incluida la llamada a cartera: así una respuesta concurrente
	// (o la decisión del convenio) no puede ganar mientras cartera reescribe el
	// plan, ni una aceptación contarse como éxito si otra respuesta ya cerró la
	// contrapropuesta (review de Codex, PR #1963). Los errores se devuelven y se
	// lanzan al salir: lanzarlos adentro revertiría el cierre como `sin_efecto`.
	// Quién recibe el aviso de la respuesta se resuelve antes de tomar el candado
	// (es una lectura aparte); el aviso en sí se inserta DENTRO, ver `avisos`.
	const supervisores = await obtenerSupervisoresCobros().catch(() => []);
	const aceptada = params.accion === "aceptar";
	const retirada = !aceptada && params.esSupervisor;
	const sifco = fila.numeroCreditoSifco;
	const tituloAviso = aceptada
		? "Contrapropuesta aceptada"
		: retirada
			? "Contrapropuesta retirada"
			: "Contrapropuesta descartada";
	const descripcionAviso = aceptada
		? `El asesor aceptó la contrapropuesta del convenio del crédito ${sifco}: el plan quedó en ${fila.numeroMeses} cuotas y el convenio espera su aprobación.`
		: retirada
			? `Un supervisor retiró la contrapropuesta del convenio del crédito ${sifco}: el convenio sigue con el plan original, pendiente de decisión.`
			: `El asesor descartó la contrapropuesta del convenio del crédito ${sifco}: el convenio sigue con el plan original, pendiente de su decisión.`;
	// Quien retiró ya lo sabe: el aviso es para el resto del equipo.
	const destinatarios = retirada
		? supervisores.filter((id) => id !== params.userId)
		: supervisores;
	/**
	 * Avisos de la respuesta, bajo el candado y en el orden de las
	 * contrapropuestas: si salieran después, una contrapropuesta nueva podía
	 * cerrar los avisos viejos y el de esta respuesta aparecer luego, obsoleto.
	 * Best-effort en un savepoint: un fallo del aviso no revierte la respuesta.
	 */
	const avisos = async (tx: Ejecutor) => {
		await cerrarAvisosDelAsesor(tx, fila.convenioId);
		if (destinatarios.length === 0) return;
		try {
			await tx.transaction(async (aviso) => {
				await aviso.insert(notifications).values(
					destinatarios.map((supervisorId) => ({
						titulo: tituloAviso,
						descripcion: descripcionAviso,
						type: "action_required" as const,
						status: "pending" as const,
						cobrosTipo: "convenio_contrapropuesta_respondida" as const,
						relatedEntityType: "collection_case" as const,
						relatedEntityId: fila.casoCobroId,
						convenioId: fila.convenioId,
						redirectPage: "cobros_detail" as const,
						createdBy: params.userId,
						createdByRole: params.userRole,
						assignedToRole: "cobros_supervisor" as const,
						assignedTo: supervisorId,
					})),
				);
			});
		} catch (error) {
			console.warn(
				"[contrapropuesta] No se pudo avisar a los supervisores (best-effort):",
				error instanceof Error ? error.message : error,
			);
		}
	};

	type Salida =
		| { tipo: "ok"; resultado: ContrapropuestaConvenio }
		| { tipo: "yaRespondida" }
		| { tipo: "sinEfecto"; error: ORPCError<string, unknown> }
		| { tipo: "falla"; error: ORPCError<string, unknown> };
	const salida = await conBloqueoDeConvenio(
		fila.convenioId,
		async (tx): Promise<Salida> => {
			const [vigente] = await tx
				.select({ estado: contrapropuestasConvenioCobros.estado })
				.from(contrapropuestasConvenioCobros)
				.where(eq(contrapropuestasConvenioCobros.id, params.id))
				.limit(1);
			if (vigente?.estado !== "pendiente") return { tipo: "yaRespondida" };

			// El convenio y el asesor del crédito también se confirman bajo el
			// candado. Si el convenio ya no está pendiente (lo aprobó o lo deshizo
			// una decisión directa en cartera) la contrapropuesta quedó sin efecto,
			// aunque se vaya a descartar: no se registra como una respuesta.
			let planActual: CarteraConvenioPlan | null = null;
			try {
				planActual = await leerPlanOFallar(fila.convenioId);
			} catch (error) {
				if (!(error instanceof ORPCError && error.code === "NOT_FOUND")) {
					if (error instanceof ORPCError) return { tipo: "falla", error };
					throw error;
				}
			}
			// Si se reasignó después de autorizar, el asesor anterior ya no puede
			// responder (ni descartar). Aceptar además lo vuelve a comprobar cartera
			// al aplicar, bajo el candado del crédito.
			if (planActual && !params.esSupervisor) {
				let actual: Awaited<ReturnType<typeof contextoDelConvenio>>;
				try {
					actual = await contextoDelConvenio(planActual, tx);
				} catch (error) {
					if (error instanceof ORPCError) return { tipo: "falla", error };
					throw error;
				}
				if (
					!puedeResponderContrapropuesta({
						accion: params.accion,
						esSupervisor: false,
						emailSesion: params.email,
						emailAsesorDelCredito: actual.emailAsesor,
					})
				) {
					return {
						tipo: "falla",
						error: new ORPCError("FORBIDDEN", {
							message:
								"El crédito ya no lo lleva usted: la contrapropuesta le corresponde al nuevo asesor.",
						}),
					};
				}
			}

			// Reconciliación: si cartera ya aplicó este plan (la respuesta de una
			// aceptación anterior se perdió o venció y la fila quedó pendiente), no
			// se vuelve a reprogramar ni se anota dos veces: se cierra como aceptada.
			// Pasa también si el convenio ya se aprobó con ese plan.
			const yaAplicada =
				planActual !== null &&
				planActual.numero_meses === fila.numeroMeses &&
				planActual.primer_pago === fila.primerPago &&
				(fila.numeroMesesOriginal !== fila.numeroMeses ||
					fila.primerPagoOriginal !== fila.primerPago);
			if (yaAplicada) {
				const cerrada = await cerrar(tx, "aceptada");
				if (!cerrada) return { tipo: "yaRespondida" };
				await cerrarAvisosDelAsesor(tx, fila.convenioId);
				if (params.accion === "aceptar") {
					// El aviso a supervisores dice que el convenio espera su
					// aprobación: si ya se decidió, nadie lo cerraría después.
					if (planActual?.estado === "pendiente") await avisos(tx);
					return { tipo: "ok", resultado: cerrada };
				}
				return {
					tipo: "falla",
					error: new ORPCError("CONFLICT", {
						message:
							"La contrapropuesta ya se había aplicado al plan del convenio: quedó aceptada.",
					}),
				};
			}
			if (!planActual || planActual.estado !== "pendiente") {
				await cerrar(tx, "sin_efecto");
				await cerrarAvisosDelAsesor(tx, fila.convenioId);
				return {
					tipo: "sinEfecto",
					error: new ORPCError("CONFLICT", {
						message:
							"El convenio ya no está pendiente (se decidió o se deshizo): la contrapropuesta quedó sin efecto.",
					}),
				};
			}
			// Si alguien cambió el plan por fuera (un ADMIN en cartera) y ya no es ni
			// el original de esta contrapropuesta ni su destino, aplicar el destino
			// pisaría ese cambio, y descartarla diría que sigue el plan original
			// cuando no es cierto: queda sin efecto y el supervisor vuelve a proponer.
			const sigueElOriginal =
				planActual.numero_meses === fila.numeroMesesOriginal &&
				(fila.primerPagoOriginal == null ||
					planActual.primer_pago === fila.primerPagoOriginal);
			if (!sigueElOriginal) {
				await cerrar(tx, "sin_efecto");
				await cerrarAvisosDelAsesor(tx, fila.convenioId);
				return {
					tipo: "sinEfecto",
					error: new ORPCError("CONFLICT", {
						message:
							"El plan del convenio cambió desde que se hizo la contrapropuesta: quedó sin efecto. Pida al supervisor una nueva.",
					}),
				};
			}
			if (params.accion === "descartar") {
				const cerrada = await cerrar(tx, "descartada");
				if (!cerrada) return { tipo: "yaRespondida" };
				await avisos(tx);
				return { tipo: "ok", resultado: cerrada };
			}

			try {
				await carteraBackClient.reprogramarConvenioPendiente(fila.convenioId, {
					numero_meses: fila.numeroMeses,
					primer_pago: fila.primerPago,
					actor_email: params.email.trim().toLowerCase(),
					// Cartera confirma, al aplicar, que el crédito sigue siendo de este asesor.
					asesor_email: params.email.trim().toLowerCase(),
				});
			} catch (error) {
				const codigo =
					error instanceof CarteraBackHttpError
						? error.payload?.error
						: undefined;
				if (
					codigo === "convenio_no_pendiente" ||
					codigo === "convenio_no_existe"
				) {
					await cerrar(tx, "sin_efecto");
					await cerrarAvisosDelAsesor(tx, fila.convenioId);
					return {
						tipo: "sinEfecto",
						error: new ORPCError("CONFLICT", {
							message:
								"El convenio ya no está pendiente (se decidió o se deshizo): la contrapropuesta quedó sin efecto.",
						}),
					};
				}
				if (codigo === "asesor_no_coincide") {
					// El crédito se reasignó después de autorizar: no se aplica y la
					// contrapropuesta sigue pendiente para quien lo lleva ahora.
					return {
						tipo: "falla",
						error: new ORPCError("FORBIDDEN", {
							message:
								"El crédito ya no lo lleva usted: la contrapropuesta le corresponde al nuevo asesor.",
						}),
					};
				}
				if (codigo === "plan_invalido") {
					await cerrar(tx, "sin_efecto");
					await cerrarAvisosDelAsesor(tx, fila.convenioId);
					return {
						tipo: "sinEfecto",
						error: new ORPCError("BAD_REQUEST", {
							message:
								"La contrapropuesta ya no es válida (por ejemplo, la fecha del primer pago ya pasó). Pida al supervisor una nueva.",
						}),
					};
				}
				console.error(
					"[contrapropuesta] Cartera no reprogramó el convenio:",
					error,
				);
				return {
					tipo: "falla",
					error: new ORPCError("SERVICE_UNAVAILABLE", {
						message:
							"No se pudo aplicar el nuevo plan en cartera. Intente de nuevo en un momento.",
					}),
				};
			}
			// Bajo el candado nadie más pudo cerrarla: si no se actualiza, algo
			// ajeno a este flujo la tocó y no se puede dar por aceptada.
			const cerrada = await cerrar(tx, "aceptada");
			if (!cerrada) return { tipo: "yaRespondida" };
			await avisos(tx);
			return { tipo: "ok", resultado: cerrada };
		},
	);
	if (salida.tipo === "yaRespondida") {
		throw new ORPCError("CONFLICT", {
			message: "La contrapropuesta ya fue respondida. Actualice la vista.",
		});
	}
	if (salida.tipo !== "ok") throw salida.error;
	const resultado = salida.resultado;

	return resultado;
}

/** Cierra el aviso al asesor bajo el candado (best-effort, en un savepoint). */
async function cerrarAvisosDelAsesor(ejecutor: Ejecutor, convenioId: number) {
	try {
		await ejecutor.transaction((aviso) =>
			cerrarAvisos(aviso, convenioId, "convenio_contrapropuesta"),
		);
	} catch (error) {
		console.warn(
			"[contrapropuesta] No se pudo cerrar el aviso al asesor (best-effort):",
			error instanceof Error ? error.message : error,
		);
	}
}

/** Cierra los avisos abiertos de ese tipo para el convenio. */
async function cerrarAvisos(
	ejecutor: Ejecutor,
	convenioId: number,
	tipo: "convenio_contrapropuesta" | "convenio_contrapropuesta_respondida",
) {
	await ejecutor
		.update(notifications)
		.set({ status: "resolved", resolvedAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(notifications.cobrosTipo, tipo),
				eq(notifications.convenioId, convenioId),
				inArray(notifications.status, [...ESTADOS_ABIERTOS]),
			),
		);
}

/**
 * Contrapropuestas del convenio, la más reciente primero. La ve un supervisor o
 * el asesor que lleva el crédito.
 */
export async function contrapropuestasDelConvenio(params: {
	convenioId: number;
	esSupervisor: boolean;
	email: string;
}) {
	if (!params.esSupervisor) {
		const plan = await leerPlanOFallar(params.convenioId);
		const ctx = await contextoDelConvenio(plan);
		if (
			!puedeResponderContrapropuesta({
				accion: "aceptar",
				esSupervisor: false,
				emailSesion: params.email,
				emailAsesorDelCredito: ctx.emailAsesor,
			})
		) {
			throw new ORPCError("FORBIDDEN", {
				message: "No tiene acceso a las contrapropuestas de este convenio.",
			});
		}
	}
	return db
		.select()
		.from(contrapropuestasConvenioCobros)
		.where(eq(contrapropuestasConvenioCobros.convenioId, params.convenioId))
		.orderBy(desc(contrapropuestasConvenioCobros.creadaEn));
}
