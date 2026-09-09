import { ORPCError } from "@orpc/server";
import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { coberturasAgendaCobros } from "../db/schema/cobros";
import { ventanaDiaGuatemala } from "../lib/agenda-cobros-snapshot";
import { toDateStrGT } from "../lib/guatemala-month-window";
import { cobrosSupervisorProcedure } from "../lib/orpc";
import {
	CarteraBackHttpError,
	carteraBackClient,
} from "../services/cartera-back-client";

/**
 * cartera-back devuelve 400 (validación) o 409 (`TrasladoConflict`) para
 * previsualizar/confirmar — nunca 500 en el camino esperado. Sin traducir
 * eso acá, `CarteraBackHttpError` sube como excepción no controlada y ORPC
 * la expone como error interno genérico en vez de un conflicto accionable.
 */
function traducirErrorTraslado(error: unknown): never {
	if (
		error instanceof CarteraBackHttpError &&
		(error.status === 400 || error.status === 409)
	) {
		throw new ORPCError(error.status === 400 ? "BAD_REQUEST" : "CONFLICT", {
			message: error.message,
		});
	}
	throw error;
}

const fecha = z.string().refine((v) => {
	try {
		ventanaDiaGuatemala(v);
		return true;
	} catch {
		return false;
	}
}, "Fecha de calendario inválida");

/** CB-114: cobertura se persiste, no cambia `creditos.asesor_id`. */
export const trasladosCobrosRouter = {
	getAsesoresTraslados: cobrosSupervisorProcedure.handler(async () => {
		const [pool, usuarios] = await Promise.all([
			carteraBackClient.getPoolPorAsesor({ useCache: false }),
			db
				.select({
					id: user.id,
					name: user.name,
					email: user.email,
					role: user.role,
					banned: user.banned,
				})
				.from(user),
		]);
		return pool.map((a) => {
			const crm = usuarios.find(
				(u) =>
					u.email.trim().toLowerCase() ===
					a.email_cash_in?.trim().toLowerCase(),
			);
			return {
				...a,
				userId: crm?.id ?? null,
				usuarioHabilitado:
					!!crm &&
					!crm.banned &&
					["admin", "cobros", "cobros_supervisor"].includes(crm.role),
			};
		});
	}),
	previsualizarTraslado: cobrosSupervisorProcedure
		.input(
			z
				.object({
					asesorOrigenId: z.number().int().positive(),
					asesorDestinoId: z.number().int().positive().optional(),
					asesorDestinoEspecialId: z.number().int().positive().optional(),
					destinosPorBucket: z
						.record(z.string().regex(/^\d+$/), z.number().int().positive())
						.optional(),
					modo: z.enum([
						"traslado_completo",
						"redistribucion",
						"destino_por_bucket",
					]),
					motivo: z.string().trim().min(1).max(1000),
				})
				.superRefine((value, ctx) => {
					if (
						value.modo === "destino_por_bucket" &&
						(!value.destinosPorBucket ||
							!Object.keys(value.destinosPorBucket).length)
					)
						ctx.addIssue({
							code: "custom",
							message: "Selecciona destinos por bucket",
						});
				}),
		)
		.handler(async ({ input, context }) => {
			try {
				return await carteraBackClient.previsualizarTrasladoCartera({
					...input,
					actorEmail: context.user.email,
				});
			} catch (error) {
				traducirErrorTraslado(error);
			}
		}),
	confirmarTraslado: cobrosSupervisorProcedure
		.input(
			z.object({
				previewId: z.string().uuid(),
				idempotencyKey: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				return await carteraBackClient.confirmarTrasladoCartera({
					...input,
					actorEmail: context.user.email,
				});
			} catch (error) {
				traducirErrorTraslado(error);
			}
		}),
	listarTraslados: cobrosSupervisorProcedure
		.input(z.object({ page: z.number().int().min(1).default(1) }))
		.handler(async ({ input }) =>
			carteraBackClient.listarTrasladosCartera(input.page),
		),
	crearCobertura: cobrosSupervisorProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				titularId: z.string().min(1),
				suplenteId: z.string().min(1),
				motivo: z.enum(["vacaciones", "permiso"]),
				desde: fecha,
				hasta: fecha,
			}),
		)
		.handler(async ({ input, context }) => {
			if (input.desde > input.hasta)
				throw new ORPCError("BAD_REQUEST", {
					message: "La fecha inicial no puede ser posterior a la final",
				});
			if (input.titularId === input.suplenteId)
				throw new ORPCError("BAD_REQUEST", {
					message: "Titular y suplente deben ser distintos",
				});
			const pool = await carteraBackClient.getPoolPorAsesor({
				useCache: false,
			});
			// Locks por PARTICIPANTE, no uno global: con una sola constante
			// (114, 1) toda la feature quedaba serializada y dos supervisores
			// registrando coberturas de equipos distintos se bloqueaban entre sí
			// sin compartir ninguna fila.
			//
			// Van los DOS (titular y suplente) porque la validación de solape de
			// abajo cruza ambos roles: sin el lock del suplente, dos
			// transacciones concurrentes con las personas invertidas
			// (A→B y B→A) podrían no verse y crear el solape que ese chequeo
			// existe para impedir.
			//
			// Ordenados: dos transacciones que tocan al mismo par toman los locks
			// en el mismo orden y se serializan; tomarlos en orden distinto sería
			// un deadlock clásico. hashtext() los mapea al int4 que pide la
			// variante de dos argumentos (los ids son text).
			const claves = [input.titularId, input.suplenteId].sort();
			return db.transaction(async (tx) => {
				// Sin llamadas HTTP bajo lock (el pool se resolvió arriba).
				for (const clave of claves) {
					await tx.execute(
						sql`SELECT pg_advisory_xact_lock(114, hashtext(${clave}))`,
					);
				}
				const [previa] = await tx
					.select()
					.from(coberturasAgendaCobros)
					.where(eq(coberturasAgendaCobros.id, input.id));
				if (previa) {
					if (
						previa.creadaPor !== context.userId ||
						previa.titularId !== input.titularId ||
						previa.suplenteId !== input.suplenteId ||
						previa.desde !== input.desde ||
						previa.hasta !== input.hasta ||
						previa.motivo !== input.motivo
					)
						throw new ORPCError("CONFLICT", {
							message: "La solicitud ya se usó con otros datos",
						});
					return previa;
				}
				if (input.desde < toDateStrGT(new Date()))
					throw new ORPCError("BAD_REQUEST", {
						message: "La cobertura no puede comenzar en el pasado",
					});
				const usuarios = await tx
					.select()
					.from(user)
					.where(
						or(eq(user.id, input.titularId), eq(user.id, input.suplenteId)),
					);
				const vinculado = (id: string) => {
					const u = usuarios.find(
						(u) =>
							u.id === id &&
							!u.banned &&
							["admin", "cobros", "cobros_supervisor"].includes(u.role),
					);
					return (
						u &&
						pool.find(
							(a) =>
								a.activo &&
								a.email_cash_in?.trim().toLowerCase() ===
									u.email.trim().toLowerCase(),
						)
					);
				};
				const origen = vinculado(input.titularId);
				const suplente = vinculado(input.suplenteId);
				if (
					!origen?.buckets.length ||
					!suplente ||
					!origen.buckets.every((b) => suplente.buckets.includes(b))
				)
					throw new ORPCError("BAD_REQUEST", {
						message:
							"Titular y suplente deben estar habilitados; el suplente debe cubrir los buckets del titular",
					});
				const [solapada] = await tx
					.select({ id: coberturasAgendaCobros.id })
					.from(coberturasAgendaCobros)
					.where(
						and(
							or(
								eq(coberturasAgendaCobros.titularId, input.titularId),
								eq(coberturasAgendaCobros.titularId, input.suplenteId),
								eq(coberturasAgendaCobros.suplenteId, input.titularId),
								eq(coberturasAgendaCobros.suplenteId, input.suplenteId),
							),
							isNull(coberturasAgendaCobros.canceladaEn),
							lte(coberturasAgendaCobros.desde, input.hasta),
							gte(coberturasAgendaCobros.hasta, input.desde),
						),
					)
					.limit(1);
				if (solapada)
					throw new ORPCError("CONFLICT", {
						message:
							"Existe una ausencia o cobertura incompatible en estas fechas",
					});
				const [cobertura] = await tx
					.insert(coberturasAgendaCobros)
					.values({ ...input, creadaPor: context.userId })
					.returning();
				return cobertura;
			});
		}),
	listarCoberturas: cobrosSupervisorProcedure
		.input(
			z
				.object({ desde: fecha, hasta: fecha })
				.refine((v) => v.desde <= v.hasta, "Rango inválido"),
		)
		.handler(async ({ input }) =>
			db
				.select()
				.from(coberturasAgendaCobros)
				.where(
					and(
						lte(coberturasAgendaCobros.desde, input.hasta),
						gte(coberturasAgendaCobros.hasta, input.desde),
					),
				)
				.orderBy(desc(coberturasAgendaCobros.createdAt)),
		),
	cancelarCobertura: cobrosSupervisorProcedure
		.input(z.object({ id: z.string().uuid() }))
		.handler(async ({ input }) => {
			return db.transaction(async (tx) => {
				// Los participantes no vienen en el input (solo el id), así que la
				// fila se lee ANTES de tomar los locks —con FOR UPDATE, para que
				// dos cancelaciones de la misma cobertura se serialicen igual— y
				// después se toman las MISMAS claves por participante que usa
				// `crearCobertura`. Con la constante global de antes, crear y
				// cancelar vivían en namespaces distintos: no se excluían entre sí,
				// que es justo lo que el lock tenía que garantizar.
				const [cobertura] = await tx
					.select()
					.from(coberturasAgendaCobros)
					.where(eq(coberturasAgendaCobros.id, input.id))
					.for("update");
				if (!cobertura)
					throw new ORPCError("NOT_FOUND", {
						message: "Cobertura no encontrada",
					});
				if (cobertura.canceladaEn) return cobertura;
				// Mismo orden (sort) que al crear: dos transacciones sobre el mismo
				// par toman los locks en la misma secuencia y no se traban entre sí.
				for (const clave of [
					cobertura.titularId,
					cobertura.suplenteId,
				].sort()) {
					await tx.execute(
						sql`SELECT pg_advisory_xact_lock(114, hashtext(${clave}))`,
					);
				}
				const [cancelada] = await tx
					.update(coberturasAgendaCobros)
					.set({ canceladaEn: new Date() })
					.where(eq(coberturasAgendaCobros.id, input.id))
					.returning();
				return cancelada;
			});
		}),
};
