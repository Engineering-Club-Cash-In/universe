/**
 * CB-036 · Referencias y contactos de emergencia en la Ficha 360.
 *
 * Cuando no se localiza al cliente, el asesor trabaja sus referencias: las ve
 * todas juntas (las que cargó cobros, las de la solicitud de crédito de
 * ventas, cónyuge, emergencia y cofirmantes — `lib/referencias-cobros.ts`),
 * registra cada llamada o visita, les completa teléfonos y anota la
 * información nueva del cliente que le den.
 *
 * Siempre disponible, en cualquier bucket y sin requisitos previos: decisión
 * de negocio (2026-09-25) — con condiciones para "activarla" no la iban a usar.
 *
 * Módulo aparte de cobros.ts por el mismo motivo que gps-eventos-router.ts:
 * no inflar el tipo inferido del router grande (TS7056).
 *
 * Todo entra por `casoCobroId` + `assertAccesoCasoCobro`, y el lead y la
 * oportunidad los resuelve el SERVIDOR desde el caso. Antes el CRUD de
 * referencias recibía `leadId` del cliente y no validaba nada: cualquier
 * usuario de cobros podía leer o editar las referencias de cualquier lead.
 */

import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { creditApplications } from "../db/schema/client-forms";
import { casosCobros } from "../db/schema/cobros";
import {
	coDebtors,
	opportunities,
	PARENTESCO_VALUES,
	referenciasLead,
} from "../db/schema/crm";
import {
	contactosReferenciasCobros,
	hallazgosLocalizacionCobros,
	referenciasTelefonosCobros,
} from "../db/schema/referencias-cobros";
import { cobrosProcedure } from "../lib/orpc";
import {
	agregarATelefonosDelCaso,
	claveReferencia,
	construirReferencias,
	encontrarReferencia,
	METODOS_CONTACTO_REFERENCIA,
	RESULTADOS_CONTACTO_REFERENCIA,
	referenciaDelTelefono,
	referenciaTieneTelefono,
	TIPOS_HALLAZGO,
} from "../lib/referencias-cobros";
import { assertAccesoCasoCobro } from "./cobros";

/** Tope de la bitácora que se pinta en la ficha (una ficha, un caso). */
const LIMITE_BITACORA = 200;

type ContextoCaso = {
	casoCobroId: string;
	telefonoPrincipal: string;
	telefonoAlternativo: string | null;
	leadId: string | null;
	opportunityId: string | null;
};

/**
 * Caso → SIFCO → oportunidad → lead, el puente de siempre
 * (`numero_credito_sifco = opportunities.numero_sifco`). Se prefiere la
 * oportunidad won/migrate más reciente, como `getActividadBot`; si no hay
 * ninguna se cae a cualquiera con ese SIFCO, que es lo que hacía la ficha al
 * buscar la oportunidad por texto — así ningún crédito pierde las referencias
 * que ya mostraba.
 */
async function resolverContextoCaso(
	casoCobroId: string,
): Promise<ContextoCaso> {
	const [caso] = await db
		.select({
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			telefonoPrincipal: casosCobros.telefonoPrincipal,
			telefonoAlternativo: casosCobros.telefonoAlternativo,
		})
		.from(casosCobros)
		.where(eq(casosCobros.id, casoCobroId))
		.limit(1);
	if (!caso) {
		throw new ORPCError("NOT_FOUND", {
			message: "Caso de cobro no encontrado.",
		});
	}

	const base = {
		casoCobroId,
		telefonoPrincipal: caso.telefonoPrincipal,
		telefonoAlternativo: caso.telefonoAlternativo,
	};
	if (!caso.numeroCreditoSifco) {
		return { ...base, leadId: null, opportunityId: null };
	}

	const [opp] = await db
		.select({ id: opportunities.id, leadId: opportunities.leadId })
		.from(opportunities)
		.where(eq(opportunities.numeroSifco, caso.numeroCreditoSifco))
		.orderBy(
			sql`CASE WHEN ${opportunities.status} IN ('won', 'migrate') THEN 0 ELSE 1 END`,
			desc(opportunities.createdAt),
		)
		.limit(1);

	return {
		...base,
		leadId: opp?.leadId ?? null,
		opportunityId: opp?.id ?? null,
	};
}

/** Acceso al caso + contexto resuelto, en ese orden. */
async function contextoConAcceso(
	casoCobroId: string,
	userId: string,
	userRole: string,
): Promise<ContextoCaso> {
	await assertAccesoCasoCobro(casoCobroId, userId, userRole);
	return resolverContextoCaso(casoCobroId);
}

function exigirLead(ctx: ContextoCaso): string {
	if (!ctx.leadId) {
		throw new ORPCError("BAD_REQUEST", {
			message:
				"Este crédito no está enlazado a una oportunidad del CRM: no hay a quién colgarle la referencia.",
		});
	}
	return ctx.leadId;
}

/** Carga las seis fuentes y arma la lista unificada. */
async function cargarReferencias(ctx: ContextoCaso) {
	const [
		filasReferenciasLead,
		solicitudesTitular,
		codeudores,
		telefonosAgregados,
		contactos,
	] = await Promise.all([
		ctx.leadId
			? db
					.select({
						id: referenciasLead.id,
						nombre: referenciasLead.nombre,
						telefono: referenciasLead.telefono,
						parentesco: referenciasLead.parentesco,
						notas: referenciasLead.notas,
					})
					.from(referenciasLead)
					.where(eq(referenciasLead.leadId, ctx.leadId))
					.orderBy(desc(referenciasLead.createdAt))
			: Promise.resolve([]),
		ctx.opportunityId
			? db
					.select({
						id: creditApplications.id,
						referenciasPersonales: creditApplications.referenciasPersonales,
						referenciasCrediticias: creditApplications.referenciasCrediticias,
						conyugeNombre: creditApplications.conyugeNombre,
						conyugeEmpresa: creditApplications.conyugeEmpresa,
						conyugeTelMovil: creditApplications.conyugeTelMovil,
						conyugeTelOficina: creditApplications.conyugeTelOficina,
						telEmergencia: creditApplications.telEmergencia,
					})
					.from(creditApplications)
					.where(
						and(
							eq(creditApplications.opportunityId, ctx.opportunityId),
							// Solo la solicitud del titular. NULL = solicitud anterior a
							// la migración 0015, cuando había una sola por oportunidad.
							or(
								eq(creditApplications.personType, "lead"),
								isNull(creditApplications.personType),
							),
						),
					)
					.orderBy(asc(creditApplications.createdAt))
			: Promise.resolve([]),
		ctx.opportunityId
			? db
					.select({
						id: coDebtors.id,
						fullName: coDebtors.fullName,
						phone: coDebtors.phone,
					})
					.from(coDebtors)
					.where(eq(coDebtors.opportunityId, ctx.opportunityId))
					.orderBy(asc(coDebtors.createdAt))
			: Promise.resolve([]),
		ctx.leadId
			? db
					.select({
						id: referenciasTelefonosCobros.id,
						referenciaKey: referenciasTelefonosCobros.referenciaKey,
						telefono: referenciasTelefonosCobros.telefono,
						notas: referenciasTelefonosCobros.notas,
						registradoPor: user.name,
						createdAt: referenciasTelefonosCobros.createdAt,
					})
					.from(referenciasTelefonosCobros)
					.leftJoin(user, eq(referenciasTelefonosCobros.registradoPor, user.id))
					.where(eq(referenciasTelefonosCobros.leadId, ctx.leadId))
					.orderBy(asc(referenciasTelefonosCobros.createdAt))
			: Promise.resolve([]),
		db
			.select({
				id: contactosReferenciasCobros.id,
				referenciaKey: contactosReferenciasCobros.referenciaKey,
				referenciaOrigen: contactosReferenciasCobros.referenciaOrigen,
				referenciaNombre: contactosReferenciasCobros.referenciaNombre,
				telefono: contactosReferenciasCobros.telefono,
				metodoContacto: contactosReferenciasCobros.metodoContacto,
				resultado: contactosReferenciasCobros.resultado,
				comentarios: contactosReferenciasCobros.comentarios,
				fechaContacto: contactosReferenciasCobros.fechaContacto,
				realizadoPor: user.name,
			})
			.from(contactosReferenciasCobros)
			.leftJoin(user, eq(contactosReferenciasCobros.realizadoPor, user.id))
			.where(eq(contactosReferenciasCobros.casoCobroId, ctx.casoCobroId))
			.orderBy(desc(contactosReferenciasCobros.fechaContacto))
			.limit(LIMITE_BITACORA),
	]);

	const referencias = construirReferencias({
		referenciasLead: filasReferenciasLead,
		solicitudesTitular,
		codeudores,
		telefonosAgregados,
		contactos,
	});

	return { referencias, contactos };
}

async function cargarHallazgos(casoCobroId: string) {
	return db
		.select({
			id: hallazgosLocalizacionCobros.id,
			tipo: hallazgosLocalizacionCobros.tipo,
			valor: hallazgosLocalizacionCobros.valor,
			enlaceMapa: hallazgosLocalizacionCobros.enlaceMapa,
			notas: hallazgosLocalizacionCobros.notas,
			contactoReferenciaId: hallazgosLocalizacionCobros.contactoReferenciaId,
			referenciaNombre: contactosReferenciasCobros.referenciaNombre,
			agregadoAlCasoAt: hallazgosLocalizacionCobros.agregadoAlCasoAt,
			registradoPor: user.name,
			createdAt: hallazgosLocalizacionCobros.createdAt,
		})
		.from(hallazgosLocalizacionCobros)
		.leftJoin(user, eq(hallazgosLocalizacionCobros.registradoPor, user.id))
		.leftJoin(
			contactosReferenciasCobros,
			eq(
				hallazgosLocalizacionCobros.contactoReferenciaId,
				contactosReferenciasCobros.id,
			),
		)
		.where(eq(hallazgosLocalizacionCobros.casoCobroId, casoCobroId))
		.orderBy(desc(hallazgosLocalizacionCobros.createdAt));
}

// ---------------------------------------------------------------------------
// Validaciones de entrada
// ---------------------------------------------------------------------------

const telefonoSchema = z
	.string()
	.trim()
	.min(1, "El teléfono es obligatorio")
	.max(40)
	.refine((t) => /\d/.test(t), "El teléfono tiene que traer números");

// Solo http(s): el enlace se pinta como <a href>, y `z.string().url()` acepta
// también `javascript:`.
const enlaceMapaSchema = z
	.string()
	.trim()
	.max(1000)
	.refine(
		(u) => /^https?:\/\//i.test(u),
		"El enlace tiene que empezar con http:// o https://",
	)
	.optional()
	.or(z.literal("").transform(() => undefined));

const hallazgoBaseSchema = z.object({
	tipo: z.enum(TIPOS_HALLAZGO),
	valor: z.string().trim().min(1, "Escribí el dato nuevo").max(500),
	enlaceMapa: enlaceMapaSchema,
	notas: z.string().trim().max(1000).optional(),
});

/** Un teléfono encontrado tiene que traer números (se puede sumar al caso). */
function hallazgoTelefonoValido(h: { tipo: string; valor: string }): boolean {
	return h.tipo !== "telefono" || /\d/.test(h.valor);
}
const errorHallazgoTelefono = {
	message: "El teléfono tiene que traer números",
	path: ["valor"],
};

const hallazgoSchema = hallazgoBaseSchema.refine(
	hallazgoTelefonoValido,
	errorHallazgoTelefono,
);

const referenciaCobrosSchema = z.object({
	casoCobroId: z.string().uuid(),
	nombre: z.string().trim().min(1).max(200),
	telefono: telefonoSchema,
	parentesco: z.enum(PARENTESCO_VALUES),
	notas: z.string().trim().max(1000).optional(),
});

function hallazgosAFilas(
	hallazgos: z.infer<typeof hallazgoSchema>[],
	casoCobroId: string,
	userId: string,
	contactoReferenciaId: string | null,
) {
	return hallazgos.map((h) => ({
		casoCobroId,
		contactoReferenciaId,
		tipo: h.tipo,
		valor: h.valor,
		enlaceMapa: h.enlaceMapa || null,
		notas: h.notas || null,
		registradoPor: userId,
	}));
}

export const referenciasCobrosRouter = {
	/**
	 * Todo lo que pinta la pestaña Referencias: la lista unificada (con el
	 * último intento de cada una), la bitácora de gestiones y la información
	 * nueva del cliente.
	 */
	getReferenciasCaso: cobrosProcedure
		.input(z.object({ casoCobroId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const ctx = await contextoConAcceso(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			const [{ referencias, contactos }, hallazgos] = await Promise.all([
				cargarReferencias(ctx),
				cargarHallazgos(input.casoCobroId),
			]);
			return {
				enlazado: ctx.leadId !== null,
				referencias,
				contactos,
				// Un teléfono encontrado puede haber llegado a los del caso por el
				// botón o porque el asesor lo escribió al editar el contacto: en los
				// dos casos ya no hay nada que agregar.
				hallazgos: hallazgos.map((h) => ({
					...h,
					enTelefonosDelCaso:
						h.tipo === "telefono" &&
						(h.agregadoAlCasoAt !== null ||
							agregarATelefonosDelCaso(
								ctx.telefonoPrincipal,
								ctx.telefonoAlternativo,
								h.valor,
							) === null),
				})),
			};
		}),

	// ------------------------------------------------------------------------
	// Referencias propias de cobros (referencias_lead): alta, edición y baja.
	// Las de ventas y los cofirmantes son de solo lectura.
	// ------------------------------------------------------------------------

	crearReferenciaCobros: cobrosProcedure
		.input(referenciaCobrosSchema)
		.handler(async ({ input, context }) => {
			const ctx = await contextoConAcceso(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			const leadId = exigirLead(ctx);
			const [creada] = await db
				.insert(referenciasLead)
				.values({
					leadId,
					nombre: input.nombre,
					telefono: input.telefono,
					parentesco: input.parentesco,
					notas: input.notas || null,
				})
				.returning({ id: referenciasLead.id });
			return creada;
		}),

	actualizarReferenciaCobros: cobrosProcedure
		.input(referenciaCobrosSchema.extend({ id: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const ctx = await contextoConAcceso(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			const leadId = exigirLead(ctx);
			const [actualizada] = await db
				.update(referenciasLead)
				.set({
					nombre: input.nombre,
					telefono: input.telefono,
					parentesco: input.parentesco,
					notas: input.notas || null,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(referenciasLead.id, input.id),
						eq(referenciasLead.leadId, leadId),
					),
				)
				.returning({ id: referenciasLead.id });
			if (!actualizada) {
				throw new ORPCError("NOT_FOUND", {
					message: "Referencia no encontrada",
				});
			}
			return actualizada;
		}),

	eliminarReferenciaCobros: cobrosProcedure
		.input(z.object({ casoCobroId: z.string().uuid(), id: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const ctx = await contextoConAcceso(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			const leadId = exigirLead(ctx);
			// La bitácora NO se toca: guarda nombre y teléfono copiados, así que
			// las gestiones hechas a esta referencia siguen visibles. Los
			// teléfonos agregados sí se van con ella: sin la referencia no tienen
			// dónde mostrarse.
			const eliminada = await db.transaction(async (tx) => {
				const [fila] = await tx
					.delete(referenciasLead)
					.where(
						and(
							eq(referenciasLead.id, input.id),
							eq(referenciasLead.leadId, leadId),
						),
					)
					.returning({ id: referenciasLead.id });
				if (!fila) return null;
				await tx
					.delete(referenciasTelefonosCobros)
					.where(
						and(
							eq(referenciasTelefonosCobros.leadId, leadId),
							eq(
								referenciasTelefonosCobros.referenciaKey,
								claveReferencia.cobros(fila.id),
							),
						),
					);
				return fila;
			});
			if (!eliminada) {
				throw new ORPCError("NOT_FOUND", {
					message: "Referencia no encontrada",
				});
			}
			return { success: true };
		}),

	// ------------------------------------------------------------------------
	// Teléfonos agregados a cualquier referencia (incluidas las de ventas y los
	// cofirmantes que vinieron sin número).
	// ------------------------------------------------------------------------

	agregarTelefonoReferencia: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				referenciaKey: z.string().min(1).max(200),
				telefono: telefonoSchema,
				notas: z.string().trim().max(500).optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const ctx = await contextoConAcceso(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			const leadId = exigirLead(ctx);
			const { referencias } = await cargarReferencias(ctx);
			// La llave la valida el servidor contra las referencias reales del
			// caso: no se aceptan llaves inventadas.
			const referencia = encontrarReferencia(referencias, input.referenciaKey);
			if (!referencia) {
				throw new ORPCError("NOT_FOUND", {
					message: "La referencia ya no existe. Recargá la ficha.",
				});
			}
			// Se busca en TODAS las referencias del caso, no solo en la elegida:
			// un número que ya es de otra las juntaría en la próxima lectura y
			// el agregado quedaría repetido (Codex, PR #1751).
			const duenio = referenciaDelTelefono(referencias, input.telefono);
			if (duenio) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						duenio.key === referencia.key
							? "Ese teléfono ya está en la referencia."
							: `Ese teléfono ya es de ${duenio.nombre}. Si es la misma persona, registrá la gestión desde esa referencia.`,
				});
			}
			const [creado] = await db
				.insert(referenciasTelefonosCobros)
				.values({
					leadId,
					referenciaKey: input.referenciaKey,
					telefono: input.telefono,
					notas: input.notas || null,
					registradoPor: context.userId,
				})
				.onConflictDoNothing()
				.returning({ id: referenciasTelefonosCobros.id });
			return { id: creado?.id ?? null };
		}),

	eliminarTelefonoReferencia: cobrosProcedure
		.input(z.object({ casoCobroId: z.string().uuid(), id: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const ctx = await contextoConAcceso(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			const leadId = exigirLead(ctx);
			const [eliminado] = await db
				.delete(referenciasTelefonosCobros)
				.where(
					and(
						eq(referenciasTelefonosCobros.id, input.id),
						eq(referenciasTelefonosCobros.leadId, leadId),
					),
				)
				.returning({ id: referenciasTelefonosCobros.id });
			if (!eliminado) {
				throw new ORPCError("NOT_FOUND", {
					message: "Teléfono no encontrado",
				});
			}
			return { success: true };
		}),

	// ------------------------------------------------------------------------
	// Gestiones e información nueva
	// ------------------------------------------------------------------------

	/**
	 * Registra una gestión a una referencia (append-only) y, en la misma
	 * transacción, la información nueva del cliente que haya dado.
	 *
	 * NO escribe en `contactos_cobros`: hablar con una referencia no cuenta
	 * como contactar al cliente para SLA / cola / alertas / gestión B1
	 * (decisión vigente, puede cambiar — ver el comentario de
	 * `contactosReferenciasCobros` en el schema).
	 */
	registrarContactoReferencia: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				referenciaKey: z.string().min(1).max(200),
				metodoContacto: z.enum(METODOS_CONTACTO_REFERENCIA),
				telefono: z.string().trim().max(40).optional(),
				resultado: z.enum(RESULTADOS_CONTACTO_REFERENCIA),
				comentarios: z.string().trim().max(2000).optional(),
				hallazgos: z.array(hallazgoSchema).max(10).default([]),
			}),
		)
		.handler(async ({ input, context }) => {
			const ctx = await contextoConAcceso(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			const { referencias } = await cargarReferencias(ctx);
			const referencia = encontrarReferencia(referencias, input.referenciaKey);
			if (!referencia) {
				throw new ORPCError("NOT_FOUND", {
					message: "La referencia ya no existe. Recargá la ficha.",
				});
			}

			// En una visita no se marca ningún número; en el resto el número
			// tiene que ser uno de la referencia, para que la bitácora diga a
			// qué teléfono se llamó de verdad.
			const esVisita = input.metodoContacto === "visita_domicilio";
			const telefono = esVisita ? null : input.telefono || null;
			if (!esVisita) {
				if (!telefono) {
					throw new ORPCError("BAD_REQUEST", {
						message: "Elegí a qué teléfono se contactó.",
					});
				}
				if (!referenciaTieneTelefono(referencia, telefono)) {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"Ese teléfono no es de la referencia. Agregalo primero a la referencia.",
					});
				}
			}

			const contacto = await db.transaction(async (tx) => {
				const [fila] = await tx
					.insert(contactosReferenciasCobros)
					.values({
						casoCobroId: input.casoCobroId,
						referenciaKey: input.referenciaKey,
						referenciaOrigen: referencia.origen,
						referenciaNombre: referencia.nombre,
						telefono,
						metodoContacto: input.metodoContacto,
						resultado: input.resultado,
						comentarios: input.comentarios || null,
						realizadoPor: context.userId,
					})
					.returning({ id: contactosReferenciasCobros.id });
				if (!fila) throw new Error("No se pudo registrar la gestión");
				if (input.hallazgos.length > 0) {
					await tx
						.insert(hallazgosLocalizacionCobros)
						.values(
							hallazgosAFilas(
								input.hallazgos,
								input.casoCobroId,
								context.userId,
								fila.id,
							),
						);
				}
				return fila;
			});

			return { id: contacto.id };
		}),

	/** Información nueva del cliente sin una gestión a referencia de por medio. */
	registrarHallazgoCliente: cobrosProcedure
		.input(
			hallazgoBaseSchema
				.extend({ casoCobroId: z.string().uuid() })
				.refine(hallazgoTelefonoValido, errorHallazgoTelefono),
		)
		.handler(async ({ input, context }) => {
			await assertAccesoCasoCobro(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			const [fila] = await db
				.insert(hallazgosLocalizacionCobros)
				.values(
					hallazgosAFilas([input], input.casoCobroId, context.userId, null),
				)
				.returning({ id: hallazgosLocalizacionCobros.id });
			return { id: fila?.id ?? null };
		}),

	/**
	 * Suma un teléfono encontrado a los teléfonos del caso
	 * (`telefono_alternativo`, separado por comas, como lo edita la ficha). Lo
	 * decide el asesor: un número que dio un tercero no se da por bueno solo.
	 */
	agregarHallazgoATelefonosCaso: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				hallazgoId: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context }) => {
			await assertAccesoCasoCobro(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			return db.transaction(async (tx) => {
				const [hallazgo] = await tx
					.select({
						valor: hallazgosLocalizacionCobros.valor,
						tipo: hallazgosLocalizacionCobros.tipo,
						agregadoAlCasoAt: hallazgosLocalizacionCobros.agregadoAlCasoAt,
					})
					.from(hallazgosLocalizacionCobros)
					.where(
						and(
							eq(hallazgosLocalizacionCobros.id, input.hallazgoId),
							eq(hallazgosLocalizacionCobros.casoCobroId, input.casoCobroId),
						),
					)
					.limit(1)
					.for("update");
				if (!hallazgo || hallazgo.tipo !== "telefono") {
					throw new ORPCError("NOT_FOUND", {
						message: "Teléfono encontrado no existe en este caso.",
					});
				}
				if (hallazgo.agregadoAlCasoAt) return { agregado: false };

				// FOR UPDATE también sobre el caso: dos clics seguidos (o dos
				// hallazgos a la vez) no pueden leer el mismo alternativo y pisarse.
				const [caso] = await tx
					.select({
						telefonoPrincipal: casosCobros.telefonoPrincipal,
						telefonoAlternativo: casosCobros.telefonoAlternativo,
					})
					.from(casosCobros)
					.where(eq(casosCobros.id, input.casoCobroId))
					.limit(1)
					.for("update");
				if (!caso) {
					throw new ORPCError("NOT_FOUND", {
						message: "Caso de cobro no encontrado.",
					});
				}

				const nuevoAlternativo = agregarATelefonosDelCaso(
					caso.telefonoPrincipal,
					caso.telefonoAlternativo,
					hallazgo.valor,
				);
				if (nuevoAlternativo !== null) {
					await tx
						.update(casosCobros)
						.set({
							telefonoAlternativo: nuevoAlternativo,
							updatedAt: new Date(),
						})
						.where(eq(casosCobros.id, input.casoCobroId));
				}
				await tx
					.update(hallazgosLocalizacionCobros)
					.set({
						agregadoAlCasoAt: new Date(),
						agregadoAlCasoPor: context.userId,
					})
					.where(eq(hallazgosLocalizacionCobros.id, input.hallazgoId));

				return { agregado: nuevoAlternativo !== null };
			});
		}),

	/**
	 * Guarda los teléfonos del caso en el acto, desde el editor de la tarjeta
	 * de contacto: cada número que el asesor confirma (Enter o al salir del
	 * campo) o quita se persiste sin esperar a "Guardar".
	 *
	 * Aparte de `updateContactInfoCobros` a propósito: esa escribe también el
	 * email (y lo deja en "" si no viene), así que un autoguardado de
	 * teléfonos pisaría un email a medio editar, o fallaría en los casos cuyo
	 * email no pasa `z.string().email()` ("Sin email" de los casos creados por
	 * el sync). Esta toca solo los dos campos de teléfono.
	 */
	guardarTelefonosCaso: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				telefonosPrincipales: z
					.array(telefonoSchema)
					.min(1, "El teléfono principal no puede quedar vacío")
					.max(10),
				telefonosAlternativos: z.array(telefonoSchema).max(20),
			}),
		)
		.handler(async ({ input, context }) => {
			await assertAccesoCasoCobro(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			const sinRepetir = (lista: string[]) => [...new Set(lista)];
			const principales = sinRepetir(input.telefonosPrincipales);
			const alternativos = sinRepetir(input.telefonosAlternativos).filter(
				(t) => !principales.includes(t),
			);
			// Mismo formato que edita la ficha: separados por coma.
			const [caso] = await db
				.update(casosCobros)
				.set({
					telefonoPrincipal: principales.join(", "),
					telefonoAlternativo:
						alternativos.length > 0 ? alternativos.join(", ") : null,
					updatedAt: new Date(),
				})
				.where(eq(casosCobros.id, input.casoCobroId))
				.returning({
					telefonoPrincipal: casosCobros.telefonoPrincipal,
					telefonoAlternativo: casosCobros.telefonoAlternativo,
				});
			if (!caso) {
				throw new ORPCError("NOT_FOUND", {
					message: "Caso de cobro no encontrado.",
				});
			}
			return caso;
		}),
};
