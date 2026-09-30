/**
 * CB-043 · El ciclo de la solicitud de recuperación forzosa: crearla,
 * aprobarla (y recién ahí trasladar), rechazarla, cancelarla o darla por sin
 * efecto. Las reglas puras viven en lib/recuperacion-solicitud.ts; el envío a
 * cartera y el registro, en services/recuperacion-vehiculo.ts.
 *
 * La solicitud es la MISMA fila de `recuperaciones_vehiculo` que después ve el
 * asesor de B4: nace `pendiente`, sin traslado, y al aprobarse se completa con
 * los buckets, el asesor de B4 y la foto del saldo del momento del traslado.
 *
 * Al aprobar, la transacción que bloquea la solicitud queda abierta mientras
 * cartera traslada. Es una acción puntual de un supervisor y es lo que
 * garantiza que dos supervisores no la aprueben a la vez. Si cartera trasladó
 * pero la respuesta se perdió, la solicitud sigue pendiente, y el próximo
 * intento encuentra la huella del traslado en cartera y la da por aprobada sin
 * volver a mover nada.
 */

import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { recuperacionesVehiculo } from "../db/schema/cobros";
import {
	type PasoChecklist,
	resumenChecklist,
} from "../lib/recuperacion-solicitud";
import {
	type DetalleRecuperacion,
	falloDefinitivoDeCartera,
	MENSAJE_TRASLADO_INCIERTO,
	referenciaDelRegistro,
	textoMotivoCartera,
} from "../lib/recuperacion-vehiculo";
import { carteraBackClient } from "./cartera-back-client";
import {
	avisarDecisionSolicitud,
	avisarSolicitudPendiente,
} from "./recuperacion-solicitud-avisos";
import {
	avisarRecuperacion,
	buscarTrasladoPorHuella,
	columnasFotoSaldo,
	insertarRegistro,
	leerContextoCartera,
	type TrasladoConfirmado,
	tomarCandadoRecuperacion,
	usuarioDeAsesorCartera,
	valoresRegistro,
} from "./recuperacion-vehiculo";

/** ¿El error es la violación del índice único de "una pendiente por caso"? */
function esSolicitudDuplicada(error: unknown): boolean {
	const e = error as { code?: string; cause?: { code?: string } } | null;
	return e?.code === "23505" || e?.cause?.code === "23505";
}

/**
 * El asesor pide la recuperación: se guarda la solicitud con su checklist y se
 * avisa a los supervisores. Cartera NO se toca todavía. El bucket (B2–B3) y el
 * acceso ya los validó el router.
 */
export async function crearSolicitudRecuperacion(params: {
	casoCobroId: string;
	numeroSifco: string;
	bucket: number;
	detalle: DetalleRecuperacion;
	checklist: PasoChecklist[];
	registradoPor: string;
}): Promise<{ registroId: string }> {
	const contexto = await leerContextoCartera(params.numeroSifco);
	let registroId: string;
	try {
		registroId = await insertarRegistro(
			valoresRegistro({
				casoCobroId: params.casoCobroId,
				tipo: "tomado",
				detalle: params.detalle,
				trasladado: false,
				registradoPor: params.registradoPor,
				foto: contexto.foto,
				bucketOrigen: params.bucket,
				solicitud: { estado: "pendiente", checklist: params.checklist },
			}),
		);
	} catch (error) {
		if (esSolicitudDuplicada(error)) {
			throw new ORPCError("CONFLICT", {
				message:
					"Ya hay una solicitud de recuperación esperando aprobación para este caso.",
			});
		}
		throw error;
	}
	await avisarSolicitudPendiente({
		registroId,
		casoCobroId: params.casoCobroId,
		bucket: params.bucket,
		solicitanteId: params.registradoPor,
		resumen: resumenChecklist(params.checklist).texto,
	});
	return { registroId };
}

type SolicitudLeida = {
	id: string;
	casoCobroId: string;
	estadoSolicitud: string | null;
	motivos: string[];
	motivoDetalle: string | null;
	registradoPor: string | null;
};

export async function leerSolicitud(
	registroId: string,
): Promise<SolicitudLeida | null> {
	const [fila] = await db
		.select({
			id: recuperacionesVehiculo.id,
			casoCobroId: recuperacionesVehiculo.casoCobroId,
			estadoSolicitud: recuperacionesVehiculo.estadoSolicitud,
			motivos: recuperacionesVehiculo.motivos,
			motivoDetalle: recuperacionesVehiculo.motivoDetalle,
			registradoPor: recuperacionesVehiculo.registradoPor,
		})
		.from(recuperacionesVehiculo)
		.where(eq(recuperacionesVehiculo.id, registroId))
		.limit(1);
	return fila ?? null;
}

const yaNoPendiente = () =>
	new ORPCError("CONFLICT", {
		message:
			"Esta solicitud ya no está esperando aprobación: alguien la decidió o se canceló. Actualizá la vista.",
	});

/**
 * La solicitud ya no aplica (el crédito salió de B2–B3 antes de que alguien
 * decidiera). Se cierra y se le avisa a quien la pidió.
 */
export async function marcarSolicitudSinEfecto(params: {
	solicitud: SolicitudLeida;
	motivo: string;
	actorId: string;
}): Promise<void> {
	const [fila] = await db
		.update(recuperacionesVehiculo)
		.set({
			estadoSolicitud: "sin_efecto",
			motivoDecision: params.motivo,
			decididoPor: params.actorId,
			decididoAt: new Date(),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(recuperacionesVehiculo.id, params.solicitud.id),
				eq(recuperacionesVehiculo.estadoSolicitud, "pendiente"),
			),
		)
		.returning({ id: recuperacionesVehiculo.id });
	if (!fila) return;
	await avisarDecisionSolicitud({
		registroId: params.solicitud.id,
		casoCobroId: params.solicitud.casoCobroId,
		decision: "sin_efecto",
		solicitanteId: params.solicitud.registradoPor,
		decidioPorId: params.actorId,
		motivo: params.motivo,
	});
}

/**
 * El supervisor aprueba: cartera traslada a B4 y la solicitud queda aprobada
 * con los buckets, el asesor de B4 y la foto del saldo de ese momento. Rango,
 * acceso y rol ya los validó el router; cartera los vuelve a validar bajo sus
 * locks.
 */
export async function aprobarSolicitudRecuperacion(params: {
	solicitud: SolicitudLeida;
	numeroSifco: string;
	creditoId: number;
	supervisorId: string;
	supervisorEmail: string;
}): Promise<TrasladoConfirmado> {
	const { solicitud } = params;
	const referencia = referenciaDelRegistro(solicitud.id);
	const motivoCartera = `${textoMotivoCartera("tomado", {
		motivos: solicitud.motivos,
		motivoDetalle: solicitud.motivoDetalle ?? undefined,
	})} (aprobada por ${params.supervisorEmail}) ${referencia}`;

	const traslado = await db.transaction(async (tx) => {
		await tomarCandadoRecuperacion(tx, solicitud.casoCobroId);
		const [fila] = await tx
			.select({ estado: recuperacionesVehiculo.estadoSolicitud })
			.from(recuperacionesVehiculo)
			.where(eq(recuperacionesVehiculo.id, solicitud.id))
			.for("update")
			.limit(1);
		if (fila?.estado !== "pendiente") throw yaNoPendiente();

		let res: TrasladoConfirmado;
		try {
			res = await carteraBackClient.enviarARecuperacionVehiculo({
				credito_id: params.creditoId,
				motivo: motivoCartera,
				usuario_email: params.supervisorEmail,
				// Supervisor: ve toda la cartera, no hay dueño que exigir.
			});
		} catch (error) {
			// Antes de dar el error por bueno se busca la huella: un intento
			// anterior pudo haber trasladado con la respuesta perdida, y entonces
			// este segundo intento recibe "ya está en B4" (un 4xx) aunque el
			// traslado sea de esta misma solicitud.
			let previo: TrasladoConfirmado | null = null;
			try {
				previo = await buscarTrasladoPorHuella({
					creditoId: params.creditoId,
					numeroSifco: params.numeroSifco,
					referencia,
				});
			} catch (consulta) {
				console.error(
					`[recuperacion-solicitud] No se pudo leer el historial de ${params.numeroSifco} tras un fallo al aprobar ${solicitud.id}:`,
					consulta,
				);
				throw new ORPCError("CONFLICT", { message: MENSAJE_TRASLADO_INCIERTO });
			}
			if (!previo) {
				throw falloDefinitivoDeCartera(error)
					? new ORPCError("BAD_REQUEST", {
							message:
								error instanceof Error
									? error.message
									: "Cartera no trasladó el crédito.",
						})
					: new ORPCError("CONFLICT", { message: MENSAJE_TRASLADO_INCIERTO });
			}
			res = previo;
		}

		await tx
			.update(recuperacionesVehiculo)
			.set({
				estadoSolicitud: "aprobada",
				trasladado: true,
				decididoPor: params.supervisorId,
				decididoAt: new Date(),
				bucketOrigen: res.bucket_anterior,
				bucketDestino: res.bucket_nuevo,
				updatedAt: new Date(),
			})
			.where(eq(recuperacionesVehiculo.id, solicitud.id));
		return res;
	});

	// Ya trasladado y aprobado. Lo que sigue es informativo o avisos: nada de
	// esto puede devolver un error por algo que ya ocurrió.
	const [asesorUserId, contexto] = await Promise.all([
		usuarioDeAsesorCartera(traslado.asesor_nuevo),
		leerContextoCartera(params.numeroSifco),
	]);
	try {
		await db
			.update(recuperacionesVehiculo)
			.set({
				responsableRecuperacion: asesorUserId,
				// La foto del saldo es la del traslado, no la de cuando se pidió.
				...columnasFotoSaldo(contexto.foto),
				updatedAt: new Date(),
			})
			.where(eq(recuperacionesVehiculo.id, solicitud.id));
	} catch (error) {
		console.error(
			`[recuperacion-solicitud] No se pudo completar la solicitud aprobada ${solicitud.id}:`,
			error,
		);
	}
	await avisarDecisionSolicitud({
		registroId: solicitud.id,
		casoCobroId: solicitud.casoCobroId,
		decision: "aprobada",
		solicitanteId: solicitud.registradoPor,
		decidioPorId: params.supervisorId,
		motivo: null,
	});
	await avisarRecuperacion({
		registroId: solicitud.id,
		casoCobroId: solicitud.casoCobroId,
		tipo: "tomado",
		trasladado: true,
		numeroSifco: params.numeroSifco,
		cliente: contexto.cliente,
		detalle: {
			motivos: solicitud.motivos,
			motivoDetalle: solicitud.motivoDetalle ?? undefined,
		},
		asesorUserId,
		actorId: params.supervisorId,
	});
	return traslado;
}

export async function rechazarSolicitudRecuperacion(params: {
	solicitud: SolicitudLeida;
	supervisorId: string;
	motivo: string;
}): Promise<void> {
	const [fila] = await db
		.update(recuperacionesVehiculo)
		.set({
			estadoSolicitud: "rechazada",
			motivoDecision: params.motivo,
			decididoPor: params.supervisorId,
			decididoAt: new Date(),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(recuperacionesVehiculo.id, params.solicitud.id),
				eq(recuperacionesVehiculo.estadoSolicitud, "pendiente"),
			),
		)
		.returning({ id: recuperacionesVehiculo.id });
	if (!fila) throw yaNoPendiente();
	await avisarDecisionSolicitud({
		registroId: params.solicitud.id,
		casoCobroId: params.solicitud.casoCobroId,
		decision: "rechazada",
		solicitanteId: params.solicitud.registradoPor,
		decidioPorId: params.supervisorId,
		motivo: params.motivo,
	});
}

/** Quien pidió la retira, mientras siga pendiente. */
export async function cancelarSolicitudRecuperacion(params: {
	registroId: string;
	usuarioId: string;
}): Promise<{ casoCobroId: string }> {
	const [fila] = await db
		.update(recuperacionesVehiculo)
		.set({
			estadoSolicitud: "cancelada",
			motivoDecision: "La retiró quien la pidió.",
			decididoPor: params.usuarioId,
			decididoAt: new Date(),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(recuperacionesVehiculo.id, params.registroId),
				eq(recuperacionesVehiculo.registradoPor, params.usuarioId),
				eq(recuperacionesVehiculo.estadoSolicitud, "pendiente"),
			),
		)
		.returning({ casoCobroId: recuperacionesVehiculo.casoCobroId });
	if (!fila) {
		throw new ORPCError("CONFLICT", {
			message:
				"La solicitud ya no está esperando aprobación, o la pidió otra persona.",
		});
	}
	await avisarDecisionSolicitud({
		registroId: params.registroId,
		casoCobroId: fila.casoCobroId,
		decision: "sin_efecto",
		solicitanteId: params.usuarioId,
		decidioPorId: params.usuarioId,
		motivo: null,
	});
	return fila;
}
