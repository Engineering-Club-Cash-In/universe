/**
 * CB-042 · El registro de recuperación de vehículo en la Ficha 360: lo que ve
 * el asesor de B4 y lo que hace con él.
 *
 *  · `getRecuperacionesVehiculoCaso`  — los registros del caso, el vigente primero.
 *  · `registrarEntregaVoluntariaEnB4` — entrega voluntaria con el crédito YA en
 *    B4: solo el formulario, sin traslado (de B1 a B3 va por
 *    `enviarCreditoARecuperacion`, que traslada y registra en el mismo gesto).
 *  · `confirmarRecepcionUnidad`       — la unidad ya se recibió. Solo en B4.
 *
 * Archivo aparte de cobros.ts por TS7056 (el tipo inferido del router grande
 * ya está en el límite); se monta dentro de `recuperacionVehiculoRouter`.
 *
 * Autorización: la misma cadena que el envío a recuperación, también para
 * LEER — el caso da el acceso (`assertAccesoCasoCobro`) y cartera la verdad de
 * quién lleva el crédito, leída sin cache (`assertCreditoAsignadoEnCarteraPorSifco`).
 * El bucket se exige en el servidor y falla cerrado: si cartera no responde,
 * no se registra nada (mismo criterio que la inmovilización de CB-041).
 */

import { ORPCError } from "@orpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { casosCobros, recuperacionesVehiculo } from "../db/schema/cobros";
import { assertCreditoAsignadoEnCarteraPorSifco } from "../lib/credito-cartera-ownership";
import { cobrosProcedure } from "../lib/orpc";
import {
	BUCKET_RECUPERACION,
	detalleRecuperacionSchema,
	erroresRecepcionUnidad,
	recepcionUnidadSchema,
	validarDetalleRecuperacion,
} from "../lib/recuperacion-vehiculo";
import { carteraBackClient } from "../services/cartera-back-client";
import { isCarteraBackEnabled } from "../services/cartera-back-integration";
import {
	registrarEntregaSinTraslado,
	tomarCandadoRecuperacion,
} from "../services/recuperacion-vehiculo";
import { assertAccesoCasoCobro } from "./cobros";

type ContextoProcedure = {
	userId: string;
	userRole: string;
	session: { user: { email: string } };
};

/**
 * Caso → SIFCO → dueño en cartera → bucket de hoy. Lanza si algo no cuadra.
 * `accion` completa el mensaje de "este crédito no es tuyo".
 */
/**
 * Caso → SIFCO → dueño en cartera. Lanza si no hay acceso; devuelve null si el
 * caso no tiene crédito de cartera (entonces tampoco puede tener registros de
 * recuperación: el envío exige SIFCO).
 *
 * El caso solo NO alcanza, ni para leer: `getDetallesCreditoCarteraBack`
 * auto-crea casos, y cuando cartera reasigna el crédito el caso del CRM sigue
 * a nombre del dueño anterior. Estos registros traen la ubicación de la unidad,
 * la entrega y el saldo, así que se pide la misma verdad que para escribir: el
 * dueño en cartera, leído sin cache (review de Codex, P1, PR #1762). Mismo
 * criterio que `getGpsEventosCaso`.
 */
async function resolverCreditoDelCaso(
	casoCobroId: string,
	context: ContextoProcedure,
	accion: string,
): Promise<string | null> {
	await assertAccesoCasoCobro(casoCobroId, context.userId, context.userRole);
	const [caso] = await db
		.select({ numeroCreditoSifco: casosCobros.numeroCreditoSifco })
		.from(casosCobros)
		.where(eq(casosCobros.id, casoCobroId))
		.limit(1);
	const numeroSifco = caso?.numeroCreditoSifco?.trim();
	if (!numeroSifco) return null;
	await assertCreditoAsignadoEnCarteraPorSifco({
		numeroSifco,
		emailUsuario: context.session.user.email,
		userRole: context.userRole,
		accion,
	});
	return numeroSifco;
}

async function resolverCreditoEnB4(
	casoCobroId: string,
	context: ContextoProcedure,
	accion: string,
): Promise<{ numeroSifco: string; bucket: number }> {
	const numeroSifco = await resolverCreditoDelCaso(
		casoCobroId,
		context,
		accion,
	);
	if (!numeroSifco) {
		throw new ORPCError("BAD_REQUEST", {
			message: "El caso no tiene crédito de cartera asociado.",
		});
	}
	if (!isCarteraBackEnabled()) {
		throw new ORPCError("SERVICE_UNAVAILABLE", {
			message: "Cartera no está disponible: no se puede confirmar el bucket.",
		});
	}
	let bucket: number | null = null;
	try {
		bucket =
			(await carteraBackClient.getBucketActualCredito(numeroSifco))?.bucket ??
			null;
	} catch (error) {
		console.error(
			`[recuperacion-vehiculo] No se pudo leer el bucket de ${numeroSifco}:`,
			error,
		);
		throw new ORPCError("SERVICE_UNAVAILABLE", {
			message: "No se pudo confirmar el bucket del crédito. Intentá de nuevo.",
		});
	}
	if (bucket !== BUCKET_RECUPERACION) {
		throw new ORPCError("BAD_REQUEST", {
			message: `Solo con el crédito en B${BUCKET_RECUPERACION}. Este está en ${bucket === null ? "ningún bucket" : `B${bucket}`}.`,
		});
	}
	return { numeroSifco, bucket };
}

const registrador = alias(user, "registrador");
const responsable = alias(user, "responsable");
const receptor = alias(user, "receptor");

export const recuperacionVehiculoRegistroRouter = {
	getRecuperacionesVehiculoCaso: cobrosProcedure
		.input(z.object({ casoCobroId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const numeroSifco = await resolverCreditoDelCaso(
				input.casoCobroId,
				context,
				"ver el registro de recuperación de este vehículo",
			);
			if (!numeroSifco) return [];
			const filas = await db
				.select({
					id: recuperacionesVehiculo.id,
					tipo: recuperacionesVehiculo.tipoRecuperacion,
					motivos: recuperacionesVehiculo.motivos,
					motivoDetalle: recuperacionesVehiculo.motivoDetalle,
					observaciones: recuperacionesVehiculo.observaciones,
					trasladado: recuperacionesVehiculo.trasladado,
					bucketOrigen: recuperacionesVehiculo.bucketOrigen,
					bucketDestino: recuperacionesVehiculo.bucketDestino,
					ubicacionDireccion: recuperacionesVehiculo.ubicacionDireccion,
					ubicacionEnlace: recuperacionesVehiculo.ubicacionEnlace,
					ubicacionLat: recuperacionesVehiculo.ubicacionLat,
					ubicacionLng: recuperacionesVehiculo.ubicacionLng,
					ubicacionFuente: recuperacionesVehiculo.ubicacionFuente,
					gpsUnidad: recuperacionesVehiculo.gpsUnidad,
					gpsSenalAt: recuperacionesVehiculo.gpsSenalAt,
					estadoVehiculo: recuperacionesVehiculo.estadoVehiculo,
					estadoVehiculoDetalle: recuperacionesVehiculo.estadoVehiculoDetalle,
					kilometraje: recuperacionesVehiculo.kilometraje,
					fechaEntrega: recuperacionesVehiculo.fechaEntrega,
					lugarEntrega: recuperacionesVehiculo.lugarEntrega,
					entregaPersona: recuperacionesVehiculo.entregaPersona,
					entregaRelacion: recuperacionesVehiculo.entregaRelacion,
					documentos: recuperacionesVehiculo.documentos,
					documentosOtros: recuperacionesVehiculo.documentosOtros,
					saldoPendiente: recuperacionesVehiculo.saldoPendiente,
					cuotasVencidas: recuperacionesVehiculo.cuotasVencidas,
					montoVencido: recuperacionesVehiculo.montoVencido,
					montoMora: recuperacionesVehiculo.montoMora,
					totalParaPonerseAlDia: recuperacionesVehiculo.totalParaPonerseAlDia,
					saldoTomadoAt: recuperacionesVehiculo.saldoTomadoAt,
					registradoPor: registrador.name,
					responsable: responsable.name,
					completada: recuperacionesVehiculo.completada,
					fechaRecepcion: recuperacionesVehiculo.fechaRecuperacion,
					recepcionLugar: recuperacionesVehiculo.recepcionLugar,
					recepcionEstadoVehiculo:
						recuperacionesVehiculo.recepcionEstadoVehiculo,
					recepcionEstadoDetalle: recuperacionesVehiculo.recepcionEstadoDetalle,
					recepcionKilometraje: recuperacionesVehiculo.recepcionKilometraje,
					recepcionDocumentos: recuperacionesVehiculo.recepcionDocumentos,
					recepcionDocumentosOtros:
						recuperacionesVehiculo.recepcionDocumentosOtros,
					recepcionNotas: recuperacionesVehiculo.recepcionNotas,
					recepcionRegistradaPor: receptor.name,
					recepcionRegistradaAt: recuperacionesVehiculo.recepcionRegistradaAt,
					createdAt: recuperacionesVehiculo.createdAt,
				})
				.from(recuperacionesVehiculo)
				.leftJoin(
					registrador,
					eq(recuperacionesVehiculo.registradoPor, registrador.id),
				)
				.leftJoin(
					responsable,
					eq(recuperacionesVehiculo.responsableRecuperacion, responsable.id),
				)
				.leftJoin(
					receptor,
					eq(recuperacionesVehiculo.recepcionRegistradaPor, receptor.id),
				)
				.where(eq(recuperacionesVehiculo.casoCobroId, input.casoCobroId))
				.orderBy(
					desc(recuperacionesVehiculo.createdAt),
					desc(recuperacionesVehiculo.id),
				)
				.limit(20);
			return filas.map((f) => ({ ...f, completada: f.completada === true }));
		}),

	registrarEntregaVoluntariaEnB4: cobrosProcedure
		.input(
			z
				.object({
					casoCobroId: z.string().uuid(),
					detalle: detalleRecuperacionSchema,
				})
				.superRefine((v, ctx) =>
					validarDetalleRecuperacion("entrega_voluntaria", v.detalle, ctx),
				),
		)
		.handler(async ({ input, context }) => {
			const { numeroSifco, bucket } = await resolverCreditoEnB4(
				input.casoCobroId,
				context,
				"registrar la entrega voluntaria",
			);
			return registrarEntregaSinTraslado({
				casoCobroId: input.casoCobroId,
				numeroSifco,
				bucket,
				detalle: input.detalle,
				registradoPor: context.userId,
			});
		}),

	confirmarRecepcionUnidad: cobrosProcedure
		.input(
			z
				.object({
					recuperacionId: z.string().uuid(),
					recepcion: recepcionUnidadSchema,
				})
				.superRefine((v, ctx) => {
					const error = erroresRecepcionUnidad(v.recepcion);
					if (error) {
						ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
					}
				}),
		)
		.handler(async ({ input, context }) => {
			const [registro] = await db
				.select({ casoCobroId: recuperacionesVehiculo.casoCobroId })
				.from(recuperacionesVehiculo)
				.where(eq(recuperacionesVehiculo.id, input.recuperacionId))
				.limit(1);
			// Sin registro o sin acceso al caso responden igual: no se confirma la
			// existencia de un registro ajeno.
			if (!registro) {
				throw new ORPCError("NOT_FOUND", {
					message: "No se encontró el registro de recuperación.",
				});
			}
			await resolverCreditoEnB4(
				registro.casoCobroId,
				context,
				"registrar la recepción de la unidad",
			);

			// Se confirma sobre el registro VIGENTE: si después se registró otro
			// (p. ej. una entrega voluntaria sobre una forzosa), el viejo ya no
			// describe lo que está pasando. Revisar y confirmar van en UNA
			// transacción con el candado del caso, el mismo que toma el alta de
			// un registro: así nadie inserta uno más nuevo entre la revisión y el
			// UPDATE (review de Codex, P2). La fecha se compara en SQL y no con el
			// `Date` leído: Postgres guarda microsegundos y JS milisegundos.
			const r = input.recepcion;
			const resultado = await db.transaction(async (tx) => {
				await tomarCandadoRecuperacion(tx, registro.casoCobroId);
				const [masNuevo] = await tx
					.select({ id: recuperacionesVehiculo.id })
					.from(recuperacionesVehiculo)
					.where(
						and(
							eq(recuperacionesVehiculo.casoCobroId, registro.casoCobroId),
							sql`${recuperacionesVehiculo.createdAt} > (select r.created_at from recuperaciones_vehiculo r where r.id = ${input.recuperacionId})`,
						),
					)
					.limit(1);
				if (masNuevo) return { conflicto: "mas_nuevo" as const };

				// El WHERE sobre `completada` es la garantía bajo doble clic o dos
				// asesores a la vez: solo uno encuentra la fila sin confirmar.
				const [fila] = await tx
					.update(recuperacionesVehiculo)
					.set({
						completada: true,
						fechaRecuperacion: r.fechaRecepcion,
						recepcionLugar: r.lugar,
						recepcionEstadoVehiculo: r.estadoVehiculo,
						recepcionEstadoDetalle: r.estadoVehiculoDetalle ?? null,
						recepcionKilometraje: r.kilometraje ?? null,
						recepcionDocumentos: r.documentos,
						recepcionDocumentosOtros: r.documentosOtros ?? null,
						recepcionNotas: r.notas ?? null,
						recepcionRegistradaPor: context.userId,
						recepcionRegistradaAt: new Date(),
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(recuperacionesVehiculo.id, input.recuperacionId),
							// IS NOT TRUE y no `= false`: la columna vieja admite NULL.
							sql`${recuperacionesVehiculo.completada} IS NOT TRUE`,
						),
					)
					.returning({ id: recuperacionesVehiculo.id });
				return fila
					? { actualizado: fila }
					: { conflicto: "ya_recibida" as const };
			});
			if ("conflicto" in resultado) {
				throw new ORPCError("CONFLICT", {
					message:
						resultado.conflicto === "mas_nuevo"
							? "Hay un registro de recuperación más reciente. Confirmá la recepción sobre ese."
							: "La recepción de esta unidad ya estaba registrada.",
				});
			}
			const actualizado = resultado.actualizado;
			return { recuperacionId: actualizado.id };
		}),
};
