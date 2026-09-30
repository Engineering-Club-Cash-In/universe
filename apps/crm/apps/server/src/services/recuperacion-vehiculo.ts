/**
 * CB-042 · La parte con efectos de los envíos a recuperación de vehículo: la
 * foto del saldo (cartera), el registro en el CRM y el aviso al asesor de B4 y
 * a los supervisores. Las reglas puras viven en lib/recuperacion-vehiculo.ts.
 *
 * El orden del envío con traslado importa, y es este:
 *
 *   1. se guarda el registro (el formulario) en el CRM;
 *   2. cartera traslada el crédito a B4 (valida rango, dueño y locks);
 *   3a. si cartera rechaza → se descarta el registro y se propaga el error;
 *   3b. si cartera traslada → se completa el registro (buckets, asesor de B4)
 *       y se avisa;
 *   3c. si no se sabe (timeout, corte de red, 5xx) → se le pregunta a cartera
 *       dónde quedó el crédito: en B4, se sigue como 3b; en otro bucket, como
 *       3a; y si tampoco contesta, el formulario se queda (review de Codex, P1).
 *
 * Al revés (trasladar y después guardar), un fallo al guardar dejaba el
 * crédito en B4 sin nada que le dijera al asesor de B4 por qué llegó ni dónde
 * está la unidad — justo lo que esta historia viene a resolver. Son dos bases
 * distintas y no hay transacción que las una; lo que queda es elegir cuál de
 * los dos fallos es recuperable, y un registro de más se borra, un traslado
 * sin formulario no se explica solo.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { recuperacionesVehiculo } from "../db/schema/cobros";
import { notifications } from "../db/schema/notifications";
import type {
	EstadoSolicitudRecuperacion,
	PasoChecklist,
} from "../lib/recuperacion-solicitud";
import {
	calcularFotoSaldo,
	type DetalleRecuperacion,
	type FotoSaldo,
	falloDefinitivoDeCartera,
	referenciaDelRegistro,
	type TipoEnvioRecuperacion,
	textoAvisoRecuperacion,
	textoMotivoCartera,
} from "../lib/recuperacion-vehiculo";
import { carteraBackClient } from "./cartera-back-client";
import {
	construirMapaAsesorUsuario,
	filasNotificacionCobros,
	obtenerSupervisoresCobros,
} from "./cobros-notif-helpers";
import { cerrarSolicitudesPendientesDelCaso } from "./recuperacion-solicitud-avisos";
import { vincularRecuperacionAVisita } from "./visitas-cobros";

type RespuestaCartera = Awaited<
	ReturnType<typeof carteraBackClient.enviarARecuperacionVehiculo>
>;

/**
 * Lo que se sabe del traslado: la respuesta de cartera, o lo reconstruido
 * cuando la respuesta se perdió. En ese caso el bucket de origen es el que se
 * leyó antes de llamar (null si esa lectura también falló).
 */
export type TrasladoConfirmado = Omit<RespuestaCartera, "bucket_anterior"> & {
	bucket_anterior: number | null;
	/** true = la respuesta se perdió y el traslado se confirmó preguntando. */
	reconciliado?: boolean;
};

export type ResolucionFallo =
	| { estado: "trasladado"; traslado: TrasladoConfirmado }
	| { estado: "descartado" }
	| { estado: "incierto" };

/**
 * Candado por caso para los registros de recuperación. Lo toman el alta de un
 * registro y la confirmación de recepción, así "cuál es el registro vigente"
 * no cambia entre que se revisa y se confirma (review de Codex, P2).
 */
const RECUPERACION_LOCK_NAMESPACE = 42042; // CB-042

export async function tomarCandadoRecuperacion(
	tx: Pick<typeof db, "execute">,
	casoCobroId: string,
): Promise<void> {
	await tx.execute(
		sql`select pg_advisory_xact_lock(${RECUPERACION_LOCK_NAMESPACE}, hashtext(${casoCobroId}))`,
	);
}

/**
 * `visitaId`: la entrega sale de una visita (CB-037/038). El vínculo se anota
 * en la misma transacción, así un doble clic no deja dos entregas para la
 * misma visita. Si cartera rechaza el traslado y el registro se borra, el
 * vínculo se limpia solo (FK con ON DELETE SET NULL).
 */
export async function insertarRegistro(
	valores: typeof recuperacionesVehiculo.$inferInsert,
	visitaId?: string,
): Promise<string> {
	return db.transaction(async (tx) => {
		await tomarCandadoRecuperacion(tx, valores.casoCobroId);
		const [registro] = await tx
			.insert(recuperacionesVehiculo)
			.values(valores)
			.returning({ id: recuperacionesVehiculo.id });
		if (visitaId) await vincularRecuperacionAVisita(tx, visitaId, registro.id);
		return registro.id;
	});
}

/** Lo que el registro necesita saber de cartera, leído al momento de registrar. */
export type ContextoCartera = {
	cliente: string | null;
	/** Correo de cash-in del asesor que lleva el crédito HOY (antes del traslado). */
	asesorEmail: string | null;
	foto: FotoSaldo | null;
};

/**
 * Best-effort y SIN cache: la foto del saldo tiene que ser la del momento del
 * registro, y que cartera no responda no puede frenar el envío (el traslado
 * igual pasa por cartera y ahí sí falla fuerte si está caída). Sin circuit
 * breaker por lo mismo: no comparte contador con las operaciones que importan.
 */
export async function leerContextoCartera(
	numeroSifco: string,
): Promise<ContextoCartera> {
	try {
		const r = await carteraBackClient.getCredito(numeroSifco, false, false);
		return {
			cliente: r.usuario?.nombre?.trim() || null,
			asesorEmail: r.asesor?.emailCashIn?.trim().toLowerCase() || null,
			foto: calcularFotoSaldo({
				deudaTotal: r.credito?.deudatotal,
				cuota: r.credito?.cuota,
				cuotasVencidas:
					r.mora?.cuotas_atrasadas ?? r.cuotasAtrasadas?.length ?? 0,
				mora: r.moraActual,
			}),
		};
	} catch (error) {
		console.error(
			`[recuperacion-vehiculo] No se pudo leer el crédito ${numeroSifco} de cartera para la foto del saldo:`,
			error,
		);
		return { cliente: null, asesorEmail: null, foto: null };
	}
}

/** Las columnas del registro, a partir del formulario. */
export function valoresRegistro(params: {
	casoCobroId: string;
	tipo: TipoEnvioRecuperacion;
	detalle: DetalleRecuperacion;
	trasladado: boolean;
	registradoPor: string;
	foto: FotoSaldo | null;
	responsable?: string | null;
	bucketOrigen?: number | null;
	bucketDestino?: number | null;
	/**
	 * CB-043: la forzosa entra como solicitud (`pendiente`) y la aprueba otra
	 * persona. Sin esto, el registro no pasa por aprobación (entrega voluntaria).
	 */
	solicitud?: {
		estado: EstadoSolicitudRecuperacion;
		checklist: PasoChecklist[] | null;
	};
}): typeof recuperacionesVehiculo.$inferInsert {
	const { detalle, foto, solicitud } = params;
	const u = detalle.ubicacion;
	const e = params.tipo === "entrega_voluntaria" ? detalle.entrega : undefined;
	return {
		casoCobroId: params.casoCobroId,
		tipoRecuperacion: params.tipo,
		motivos: detalle.motivos,
		motivoDetalle: detalle.motivoDetalle ?? null,
		observaciones: detalle.observaciones ?? null,
		trasladado: params.trasladado,
		bucketOrigen: params.bucketOrigen ?? null,
		bucketDestino: params.bucketDestino ?? null,
		responsableRecuperacion: params.responsable ?? null,
		ubicacionDireccion: u?.direccion ?? null,
		ubicacionEnlace: u?.enlace ?? null,
		ubicacionLat: u?.lat !== undefined ? String(u.lat) : null,
		ubicacionLng: u?.lng !== undefined ? String(u.lng) : null,
		ubicacionFuente: u ? u.fuente : null,
		gpsUnidad: u?.fuente === "gps" ? (u.gpsUnidad ?? null) : null,
		gpsSenalAt: u?.fuente === "gps" ? (u.gpsSenalAt ?? null) : null,
		estadoVehiculo: detalle.estadoVehiculo ?? null,
		estadoVehiculoDetalle: detalle.estadoVehiculoDetalle ?? null,
		kilometraje: detalle.kilometraje ?? null,
		fechaEntrega: e?.fecha ?? null,
		lugarEntrega: e?.lugar ?? null,
		entregaPersona: e?.persona ?? null,
		entregaRelacion: e?.relacion ?? null,
		documentos: e?.documentos ?? [],
		documentosOtros: e?.documentosOtros ?? null,
		saldoPendiente: foto ? foto.saldoPendiente.toFixed(2) : null,
		cuotasVencidas: foto ? foto.cuotasVencidas : null,
		montoVencido: foto ? foto.montoVencido.toFixed(2) : null,
		montoMora: foto ? foto.montoMora.toFixed(2) : null,
		totalParaPonerseAlDia: foto ? foto.totalParaPonerseAlDia.toFixed(2) : null,
		saldoTomadoAt: foto ? new Date() : null,
		registradoPor: params.registradoPor,
		estadoSolicitud: solicitud?.estado ?? null,
		checklist: solicitud?.checklist ?? null,
	};
}

/** Las columnas de la foto del saldo, para refrescarla al aprobar (CB-043). */
export function columnasFotoSaldo(
	foto: FotoSaldo | null,
): Partial<typeof recuperacionesVehiculo.$inferInsert> {
	if (!foto) return {};
	return {
		saldoPendiente: foto.saldoPendiente.toFixed(2),
		cuotasVencidas: foto.cuotasVencidas,
		montoVencido: foto.montoVencido.toFixed(2),
		montoMora: foto.montoMora.toFixed(2),
		totalParaPonerseAlDia: foto.totalParaPonerseAlDia.toFixed(2),
		saldoTomadoAt: new Date(),
	};
}

/** user.id del CRM de un correo (el puente de siempre: email_cash_in == user.email). */
async function usuarioPorEmail(email: string | null): Promise<string | null> {
	if (!email) return null;
	const usuarios = await db
		.select({ id: user.id, email: user.email })
		.from(user);
	return (
		usuarios.find((u) => u.email.trim().toLowerCase() === email)?.id ?? null
	);
}

/** user.id del CRM del asesor de cartera que quedó con el crédito. */
export async function usuarioDeAsesorCartera(
	asesorId: number | null,
): Promise<string | null> {
	if (asesorId === null) return null;
	try {
		const mapa = await construirMapaAsesorUsuario({ useCircuitBreaker: false });
		return mapa.get(asesorId) ?? null;
	} catch (error) {
		console.error(
			`[recuperacion-vehiculo] No se pudo resolver el usuario del asesor ${asesorId}:`,
			error,
		);
		return null;
	}
}

/**
 * Aviso al asesor de B4 y a los cobros_supervisor (decisión del 2026-09-28).
 * Quien registró no se avisa a sí mismo. Best-effort: un aviso que no sale no
 * deshace un envío que ya ocurrió. Dedup por registro: un reintento no duplica.
 */
export async function avisarRecuperacion(params: {
	registroId: string;
	casoCobroId: string;
	tipo: TipoEnvioRecuperacion;
	trasladado: boolean;
	numeroSifco: string;
	cliente: string | null;
	detalle: DetalleRecuperacion;
	asesorUserId: string | null;
	actorId: string;
}): Promise<void> {
	try {
		const [actor] = await db
			.select({ name: user.name })
			.from(user)
			.where(eq(user.id, params.actorId))
			.limit(1);
		const { titulo, descripcion } = textoAvisoRecuperacion({
			tipo: params.tipo,
			trasladado: params.trasladado,
			cliente: params.cliente,
			numeroSifco: params.numeroSifco,
			registradoPor: actor?.name ?? null,
			detalle: params.detalle,
		});
		const asesor =
			params.asesorUserId && params.asesorUserId !== params.actorId
				? params.asesorUserId
				: null;
		const supervisores = (await obtenerSupervisoresCobros()).filter(
			(id) => id !== params.actorId && id !== asesor,
		);
		const filas = filasNotificacionCobros({
			casoId: params.casoCobroId,
			cobrosTipo: "recuperacion_vehiculo",
			titulo,
			descripcion,
			asesorUserId: asesor,
			supervisores,
			usuarioSistema: params.actorId,
			dedupKey: `recuperacion:${params.registroId}`,
		});
		if (filas.length > 0) {
			await db.insert(notifications).values(filas).onConflictDoNothing();
		}
	} catch (error) {
		console.error(
			`[recuperacion-vehiculo] No se pudo avisar la recuperación ${params.registroId}:`,
			error,
		);
	}
}

/**
 * ¿El traslado lo hizo ESTA solicitud? Se busca su huella (`[ref CRM <id>]`)
 * en el historial de buckets de cartera, que la guarda en la misma transacción
 * que el traslado. Que el crédito esté en B4 no prueba nada: lo pudo mover otro
 * actor o el motor. `null` = no está la huella; lanza si el historial no se
 * puede leer.
 */
export async function buscarTrasladoPorHuella(params: {
	creditoId: number;
	numeroSifco: string;
	referencia: string;
}): Promise<TrasladoConfirmado | null> {
	const eventos = await carteraBackClient.getBucketsHistorialCredito(
		params.creditoId,
	);
	const evento = eventos.find((e) => e.motivo?.includes(params.referencia));
	if (!evento) return null;
	const asesorNuevo = await carteraBackClient
		.getAsesorPorSifco({ sifcos: [params.numeroSifco] })
		.then((r) => r.data?.[0]?.asesor_id ?? null)
		.catch(() => null);
	return {
		success: true,
		credito_id: params.creditoId,
		bucket_anterior: evento.bucket_anterior,
		bucket_nuevo: evento.bucket_nuevo,
		tipo_evento: "SUBIDA",
		asesor_anterior: null,
		asesor_nuevo: asesorNuevo,
		asesor_sin_cambio: false,
		reconciliado: true,
	};
}

/**
 * Envío CON traslado (B2–B3): guarda el registro antes de llamar a cartera y
 * devuelve con qué seguir según lo que responda. Ver el orden en el encabezado.
 * Desde CB-043 solo lo usa la entrega voluntaria: la forzosa se solicita y la
 * traslada `aprobarSolicitudRecuperacion` (services/recuperacion-solicitud.ts).
 */
export async function prepararEnvioRecuperacion(params: {
	casoCobroId: string;
	numeroSifco: string;
	/** `credito_id` de cartera, para reconstruir el resultado si se pierde la respuesta. */
	creditoId: number;
	tipo: TipoEnvioRecuperacion;
	detalle: DetalleRecuperacion;
	registradoPor: string;
	/** La visita de la que sale la entrega (CB-037/038), ya validada. */
	visitaId?: string;
}) {
	const contexto = await leerContextoCartera(params.numeroSifco);
	const registroId = await insertarRegistro(
		valoresRegistro({
			casoCobroId: params.casoCobroId,
			tipo: params.tipo,
			detalle: params.detalle,
			trasladado: true,
			registradoPor: params.registradoPor,
			foto: contexto.foto,
		}),
		params.visitaId,
	);

	const descartar = async (): Promise<void> => {
		try {
			await db
				.delete(recuperacionesVehiculo)
				.where(eq(recuperacionesVehiculo.id, registroId));
		} catch (error) {
			// Queda un registro de un traslado que no ocurrió. Se loguea con el
			// id para poder borrarlo a mano; no tapa el error original.
			console.error(
				`[recuperacion-vehiculo] No se pudo descartar el registro ${registroId} tras un traslado fallido:`,
				error,
			);
		}
	};

	// La huella de ESTA solicitud en cartera: viaja dentro del motivo y cartera
	// la guarda en `buckets_historial` en la misma transacción que el traslado.
	// Es lo que permite, si la respuesta se pierde, saber si el traslado lo hizo
	// este envío y no otro actor (review de Codex, P2, PR #1762).
	const referenciaCartera = referenciaDelRegistro(registroId);

	return {
		registroId,
		/** Va al final de cualquier motivo que se le mande a cartera. */
		referenciaCartera,
		/** El motivo para `buckets_historial`, con el tipo adelante y la huella. */
		motivoCartera: `${textoMotivoCartera(params.tipo, params.detalle)} ${referenciaCartera}`,

		/**
		 * La llamada a cartera lanzó. Decide qué pasó antes de tocar el registro:
		 * solo se borra si cartera respondió que no, o si su historial prueba que
		 * esta solicitud no trasladó. Si no hay forma de saberlo, se conserva.
		 */
		async resolverFallo(error: unknown): Promise<ResolucionFallo> {
			if (falloDefinitivoDeCartera(error)) {
				await descartar();
				return { estado: "descartado" };
			}
			console.warn(
				`[recuperacion-vehiculo] Resultado incierto del traslado de ${params.numeroSifco}; se busca la huella en cartera:`,
				error,
			);
			let traslado: TrasladoConfirmado | null;
			try {
				traslado = await buscarTrasladoPorHuella({
					creditoId: params.creditoId,
					numeroSifco: params.numeroSifco,
					referencia: referenciaCartera,
				});
			} catch (consulta) {
				console.error(
					`[recuperacion-vehiculo] Tampoco se pudo leer el historial de ${params.numeroSifco}; el registro ${registroId} se conserva:`,
					consulta,
				);
				return { estado: "incierto" };
			}
			if (!traslado) {
				await descartar();
				return { estado: "descartado" };
			}
			return { estado: "trasladado", traslado };
		},

		/** Cartera no trasladó: el registro no describe nada que haya pasado. */
		descartar,

		/** Cartera trasladó: se anotan los buckets y el asesor de B4, y se avisa. */
		async confirmarTraslado(res: TrasladoConfirmado): Promise<void> {
			const asesorUserId = await usuarioDeAsesorCartera(res.asesor_nuevo);
			try {
				await db
					.update(recuperacionesVehiculo)
					.set({
						bucketOrigen: res.bucket_anterior,
						bucketDestino: res.bucket_nuevo,
						responsableRecuperacion: asesorUserId,
						updatedAt: new Date(),
					})
					.where(eq(recuperacionesVehiculo.id, registroId));
			} catch (error) {
				// El traslado y el formulario ya están; lo que falta es informativo.
				console.error(
					`[recuperacion-vehiculo] No se pudieron anotar los buckets del registro ${registroId}:`,
					error,
				);
			}
			await avisarRecuperacion({
				registroId,
				casoCobroId: params.casoCobroId,
				tipo: params.tipo,
				trasladado: true,
				numeroSifco: params.numeroSifco,
				cliente: contexto.cliente,
				detalle: params.detalle,
				asesorUserId,
				actorId: params.registradoPor,
			});
			// CB-043: si había una solicitud de recuperación esperando
			// aprobación, el crédito ya llegó a B4 por la entrega voluntaria.
			await cerrarSolicitudesPendientesDelCaso({
				casoCobroId: params.casoCobroId,
				exceptoId: registroId,
				motivo: "Se registró una entrega voluntaria y el crédito ya pasó a B4.",
				actorId: params.registradoPor,
			});
		},
	};
}

/**
 * Entrega voluntaria con el crédito YA en B4: solo el registro, sin traslado.
 * El bucket ya lo validó el caller; el responsable es quien lleva hoy el
 * crédito en cartera (el asesor de B4).
 */
export async function registrarEntregaSinTraslado(params: {
	casoCobroId: string;
	numeroSifco: string;
	bucket: number;
	detalle: DetalleRecuperacion;
	registradoPor: string;
	/** La visita de la que sale la entrega (CB-037/038), ya validada. */
	visitaId?: string;
}): Promise<{ registroId: string }> {
	const contexto = await leerContextoCartera(params.numeroSifco);
	const responsable = await usuarioPorEmail(contexto.asesorEmail);
	const registro = {
		id: await insertarRegistro(
			valoresRegistro({
				casoCobroId: params.casoCobroId,
				tipo: "entrega_voluntaria",
				detalle: params.detalle,
				trasladado: false,
				registradoPor: params.registradoPor,
				foto: contexto.foto,
				responsable,
				bucketOrigen: params.bucket,
				bucketDestino: params.bucket,
			}),
			params.visitaId,
		),
	};
	await avisarRecuperacion({
		registroId: registro.id,
		casoCobroId: params.casoCobroId,
		tipo: "entrega_voluntaria",
		trasladado: false,
		numeroSifco: params.numeroSifco,
		cliente: contexto.cliente,
		detalle: params.detalle,
		asesorUserId: responsable,
		actorId: params.registradoPor,
	});
	// CB-043: una solicitud de recuperación pedida en B2–B3 puede seguir
	// pendiente con el crédito ya en B4 (llegó solo, por cuotas). Si el
	// cliente entrega la unidad, la solicitud ya no tiene nada que decidir: se
	// cierra igual que cuando la entrega traslada (review de Codex, PR #1806).
	await cerrarSolicitudesPendientesDelCaso({
		casoCobroId: params.casoCobroId,
		exceptoId: registro.id,
		motivo: "Se registró una entrega voluntaria con el crédito ya en B4.",
		actorId: params.registradoPor,
	});
	return { registroId: registro.id };
}
