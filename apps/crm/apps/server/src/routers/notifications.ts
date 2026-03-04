import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { opportunities } from "../db/schema/crm";
import type { NewNotification } from "../db/schema/notifications";
import {
	notificationDocuments,
	notifications,
} from "../db/schema/notifications";
import { adminProcedure, protectedProcedure } from "../lib/orpc";
import {
	deleteFileFromR2,
	generateUniqueFilename,
	getFileUrl,
	resolveMimeType,
	uploadFileToR2,
	validateFile,
} from "../lib/storage";

// Campos de selección con join al creador
const notificationWithCreator = {
	id: notifications.id,
	titulo: notifications.titulo,
	descripcion: notifications.descripcion,
	status: notifications.status,
	type: notifications.type,
	createdBy: notifications.createdBy,
	createdByRole: notifications.createdByRole,
	createdByName: user.name,
	assignedToRole: notifications.assignedToRole,
	assignedTo: notifications.assignedTo,
	relatedEntityType: notifications.relatedEntityType,
	relatedEntityId: notifications.relatedEntityId,
	redirectPage: notifications.redirectPage,
	readAt: notifications.readAt,
	resolvedAt: notifications.resolvedAt,
	createdAt: notifications.createdAt,
	updatedAt: notifications.updatedAt,
};

// Función interna para crear notificaciones (no es endpoint ORPC)
export async function createNotification(
	data: Omit<NewNotification, "id" | "createdAt" | "updatedAt" | "status">,
) {
	const [notification] = await db
		.insert(notifications)
		.values({
			...data,
			status: "pending",
		})
		.returning();

	return notification;
}

export const notificationsRouter = {
	// Conteo de notificaciones pendientes para el usuario autenticado
	getUnreadNotificationCount: protectedProcedure.handler(
		async ({ context }) => {
			const userId = context.session.user.id;

			const [userData] = await db
				.select({ role: user.role })
				.from(user)
				.where(eq(user.id, userId))
				.limit(1);

			if (!userData) {
				return { count: 0 };
			}

			const isAdmin = userData.role === "admin";
			const isSalesSupervisor = userData.role === "sales_supervisor";

			// Supervisor de ventas ve sus notificaciones + analyst + juridico
			const roleFilter = isSalesSupervisor
				? inArray(notifications.assignedToRole, [
						"sales_supervisor",
						"analyst",
						"juridico",
					])
				: eq(notifications.assignedToRole, userData.role);

			const conditions = isAdmin
				? eq(notifications.status, "pending")
				: and(
						eq(notifications.status, "pending"),
						or(roleFilter, eq(notifications.assignedTo, userId)),
					);

			const [result] = await db
				.select({ count: count() })
				.from(notifications)
				.where(conditions);

			return { count: result?.count ?? 0 };
		},
	),

	// Obtener todas las notificaciones (solo admin)
	getAllNotifications: adminProcedure.handler(async () => {
		const result = await db
			.select(notificationWithCreator)
			.from(notifications)
			.leftJoin(user, eq(notifications.createdBy, user.id))
			.orderBy(desc(notifications.createdAt))
			.limit(500);

		return result;
	}),

	// Obtener notificaciones por rol del usuario autenticado
	getNotificationsByRole: protectedProcedure.handler(async ({ context }) => {
		const userId = context.session.user.id;

		const [userData] = await db
			.select({ role: user.role })
			.from(user)
			.where(eq(user.id, userId))
			.limit(1);

		if (!userData) {
			return [];
		}

		const result = await db
			.select(notificationWithCreator)
			.from(notifications)
			.leftJoin(user, eq(notifications.createdBy, user.id))
			.where(
				and(
					eq(notifications.assignedToRole, userData.role),
					isNull(notifications.assignedTo),
				),
			)
			.orderBy(desc(notifications.createdAt))
			.limit(500);

		return result;
	}),

	// Obtener notificaciones asignadas directamente al usuario autenticado
	getNotificationsByAssign: protectedProcedure.handler(async ({ context }) => {
		const userId = context.session.user.id;

		const result = await db
			.select(notificationWithCreator)
			.from(notifications)
			.leftJoin(user, eq(notifications.createdBy, user.id))
			.where(eq(notifications.assignedTo, userId))
			.orderBy(desc(notifications.createdAt))
			.limit(500);

		return result;
	}),

	// Obtener notificaciones por múltiples roles
	getNotificationsByRoles: protectedProcedure
		.input(
			z.object({
				roles: z
					.array(
						z.enum([
							"admin",
							"sales",
							"sales_supervisor",
							"analyst",
							"cobros",
							"cobros_supervisor",
							"juridico",
							"accounting",
						]),
					)
					.min(1),
			}),
		)
		.handler(async ({ input, context }) => {
			const userId = context.session.user.id;

			const [userData] = await db
				.select({ role: user.role })
				.from(user)
				.where(eq(user.id, userId))
				.limit(1);

			if (!userData) return [];

			// Admin puede consultar cualquier rol; otros solo los que les corresponden
			const isAdmin = userData.role === "admin";
			let allowedRoles = input.roles;
			if (!isAdmin) {
				const visibleRoles: Record<string, string[]> = {
					sales_supervisor: ["sales_supervisor", "analyst", "juridico"],
				};
				const allowed = visibleRoles[userData.role] ?? [userData.role];
				allowedRoles = input.roles.filter((r) => allowed.includes(r));
				if (allowedRoles.length === 0) return [];
			}

			const result = await db
				.select(notificationWithCreator)
				.from(notifications)
				.leftJoin(user, eq(notifications.createdBy, user.id))
				.where(inArray(notifications.assignedToRole, allowedRoles))
				.orderBy(desc(notifications.createdAt))
				.limit(500);

			return result;
		}),

	// Cambiar el status de una notificación
	changeNotificationStatus: protectedProcedure
		.input(
			z.object({
				notificationId: z.string().uuid(),
				status: z.enum([
					"pending",
					"read",
					"in_progress",
					"resolved",
					"dismissed",
				]),
			}),
		)
		.handler(async ({ input, context }) => {
			const userId = context.session.user.id;

			// Obtener datos del usuario y la notificación
			const [userData] = await db
				.select({ role: user.role })
				.from(user)
				.where(eq(user.id, userId))
				.limit(1);

			const [notif] = await db
				.select({
					type: notifications.type,
					assignedToRole: notifications.assignedToRole,
					assignedTo: notifications.assignedTo,
				})
				.from(notifications)
				.where(eq(notifications.id, input.notificationId))
				.limit(1);

			if (!notif) {
				throw new ORPCError("NOT_FOUND", {
					message: "Notificación no encontrada",
				});
			}

			// Verificar autorización: admin, rol coincide, asignación directa, o supervisor con visibilidad expandida
			const isAdmin = userData?.role === "admin";
			const roleMatches = userData?.role === notif.assignedToRole;
			const isDirectlyAssigned = notif.assignedTo === userId;
			const isSupervisorWithAccess =
				userData?.role === "sales_supervisor" &&
				["sales_supervisor", "analyst"].includes(notif.assignedToRole);

			if (
				!isAdmin &&
				!roleMatches &&
				!isDirectlyAssigned &&
				!isSupervisorWithAccess
			) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permiso para modificar esta notificación",
				});
			}

			// Si se intenta resolver, verificar que no sea action_upload_files sin documentos
			if (input.status === "resolved" && notif.type === "action_upload_files") {
				const docs = await db
					.select({ id: notificationDocuments.id })
					.from(notificationDocuments)
					.where(eq(notificationDocuments.notificationId, input.notificationId))
					.limit(1);

				if (docs.length === 0) {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"No se puede resolver esta notificación sin haber subido al menos un documento.",
					});
				}
			}

			const now = new Date();

			const [updated] = await db
				.update(notifications)
				.set({
					status: input.status,
					updatedAt: now,
					...(input.status === "read" ? { readAt: now } : {}),
					...(input.status === "resolved" ? { resolvedAt: now } : {}),
				})
				.where(eq(notifications.id, input.notificationId))
				.returning();

			return updated;
		}),

	// Marcar todas las notificaciones pendientes del admin como leídas
	markAllNotificationsAsRead: adminProcedure.handler(async ({ context }) => {
		const userId = context.session.user.id;
		const now = new Date();
		const updated = await db
			.update(notifications)
			.set({
				status: "read",
				readAt: now,
				updatedAt: now,
			})
			.where(
				and(
					eq(notifications.status, "pending"),
					or(
						eq(notifications.assignedToRole, "admin"),
						eq(notifications.assignedTo, userId),
					),
				),
			)
			.returning({ id: notifications.id });

		return { count: updated.length };
	}),

	// Obtener documentos de una notificación
	getNotificationDocuments: protectedProcedure
		.input(
			z.object({
				notificationId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			const docs = await db
				.select()
				.from(notificationDocuments)
				.where(eq(notificationDocuments.notificationId, input.notificationId))
				.orderBy(desc(notificationDocuments.uploadedAt));

			// Generar URLs firmadas para cada documento
			const docsWithUrls = await Promise.all(
				docs.map(async (doc) => ({
					...doc,
					url: await getFileUrl(doc.filePath),
				})),
			);

			return docsWithUrls;
		}),

	// Obtener documentos de contabilidad por oportunidades
	getAccountDocumentsByOpportunities: protectedProcedure
		.input(
			z.object({
				opportunityIds: z.array(z.string().uuid()).min(1),
			}),
		)
		.handler(async ({ input }) => {
			// Buscar notificaciones de contabilidad relacionadas a oportunidades
			const notifs = await db
				.select({
					id: notifications.id,
					titulo: notifications.titulo,
					relatedEntityId: notifications.relatedEntityId,
					status: notifications.status,
					createdAt: notifications.createdAt,
				})
				.from(notifications)
				.where(
					and(
						eq(notifications.assignedToRole, "accounting"),
						eq(notifications.type, "action_upload_files"),
						eq(notifications.relatedEntityType, "opportunity"),
						inArray(notifications.relatedEntityId, input.opportunityIds),
					),
				);

			if (notifs.length === 0) {
				return [];
			}

			const notifIds = notifs.map((n) => n.id);

			// Obtener documentos de esas notificaciones
			const docs = await db
				.select()
				.from(notificationDocuments)
				.where(inArray(notificationDocuments.notificationId, notifIds))
				.orderBy(desc(notificationDocuments.uploadedAt));

			if (docs.length === 0) {
				return [];
			}

			// Generar URLs firmadas
			const docsWithUrls = await Promise.all(
				docs.map(async (doc) => {
					const notif = notifs.find((n) => n.id === doc.notificationId);
					return {
						...doc,
						url: await getFileUrl(doc.filePath),
						notificationTitulo: notif?.titulo ?? null,
						opportunityId: notif?.relatedEntityId ?? null,
					};
				}),
			);

			return docsWithUrls;
		}),

	// Obtener info de desembolso para una oportunidad (notificación + documentos)
	getDisbursementForOpportunity: protectedProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			// Buscar notificación de contabilidad para desembolso
			const [notif] = await db
				.select({
					id: notifications.id,
					titulo: notifications.titulo,
					status: notifications.status,
					createdAt: notifications.createdAt,
				})
				.from(notifications)
				.where(
					and(
						eq(notifications.assignedToRole, "accounting"),
						eq(notifications.type, "action_upload_files"),
						inArray(notifications.relatedEntityType, [
							"opportunity",
							"opportunity_client",
						]),
						eq(notifications.relatedEntityId, input.opportunityId),
					),
				)
				.limit(1);

			if (!notif) {
				return { notificationId: null, documents: [] };
			}

			// Obtener documentos de esa notificación
			const docs = await db
				.select()
				.from(notificationDocuments)
				.where(eq(notificationDocuments.notificationId, notif.id))
				.orderBy(desc(notificationDocuments.uploadedAt));

			const docsWithUrls = await Promise.all(
				docs.map(async (doc) => ({
					...doc,
					url: await getFileUrl(doc.filePath),
				})),
			);

			return {
				notificationId: notif.id,
				documents: docsWithUrls,
			};
		}),

	// Agregar documento a una notificación (sube a R2)
	addDocumentToNotification: protectedProcedure
		.input(
			z.object({
				notificationId: z.string().uuid(),
				file: z.object({
					name: z.string(),
					type: z.string(),
					size: z.number(),
					data: z.string(), // Base64
				}),
			}),
		)
		.handler(async ({ input, context }) => {
			const userId = context.session.user.id;

			// Verificar que la notificación existe y es de tipo action_upload_files
			const [notification] = await db
				.select({
					id: notifications.id,
					type: notifications.type,
				})
				.from(notifications)
				.where(eq(notifications.id, input.notificationId))
				.limit(1);

			if (!notification) {
				throw new ORPCError("NOT_FOUND", {
					message: "Notificación no encontrada",
				});
			}

			if (notification.type !== "action_upload_files") {
				throw new ORPCError("BAD_REQUEST", {
					message: "Esta notificación no permite subir documentos",
				});
			}

			// Resolver MIME type (fallback por extensión)
			const resolvedMimeType = resolveMimeType({
				type: input.file.type,
				name: input.file.name,
			} as File);

			// Validar archivo
			const validation = validateFile({
				type: resolvedMimeType,
				size: input.file.size,
				name: input.file.name,
			} as File);

			if (!validation.valid) {
				throw new ORPCError("BAD_REQUEST", {
					message: validation.error || "Archivo inválido",
				});
			}

			// Subir a R2
			const fileBuffer = Buffer.from(input.file.data, "base64");
			const fileBlob = new Blob([fileBuffer], { type: resolvedMimeType });
			const uniqueFilename = generateUniqueFilename(input.file.name);

			const { key } = await uploadFileToR2(
				fileBlob,
				uniqueFilename,
				`notifications/${input.notificationId}`,
			);

			// Guardar registro en la base de datos
			const [document] = await db
				.insert(notificationDocuments)
				.values({
					notificationId: input.notificationId,
					filename: uniqueFilename,
					originalName: input.file.name,
					mimeType: resolvedMimeType,
					size: input.file.size,
					filePath: key,
					uploadedBy: userId,
				})
				.returning();

			return document;
		}),

	// Eliminar documento de una notificación
	deleteNotificationDocument: protectedProcedure
		.input(
			z.object({
				documentId: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context }) => {
			const [document] = await db
				.select()
				.from(notificationDocuments)
				.where(eq(notificationDocuments.id, input.documentId))
				.limit(1);

			if (!document) {
				throw new ORPCError("NOT_FOUND", {
					message: "Documento no encontrado",
				});
			}

			// Solo el que subió o admin puede borrar
			const userRole = context.session.user.role;
			if (
				document.uploadedBy !== context.session.user.id &&
				userRole !== "admin"
			) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permisos para eliminar este documento",
				});
			}

			// Eliminar de R2
			await deleteFileFromR2(document.filePath);

			// Eliminar de la base de datos
			await db
				.delete(notificationDocuments)
				.where(eq(notificationDocuments.id, input.documentId));

			return { success: true };
		}),

	// Notificar al asesor de ventas que el desembolso fue completado
	notifyDisbursementCompleted: protectedProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context }) => {
			const userId = context.session.user.id;
			const [userData] = await db
				.select({ role: user.role })
				.from(user)
				.where(eq(user.id, userId))
				.limit(1);

			// Obtener la oportunidad para saber el asesor asignado y el título
			const [opportunity] = await db
				.select({
					id: opportunities.id,
					title: opportunities.title,
					assignedTo: opportunities.assignedTo,
				})
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			if (!opportunity.assignedTo) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"La oportunidad no tiene un asesor de ventas asignado",
				});
			}

			await createNotification({
				titulo: `Desembolso completado - ${opportunity.title}`,
				descripcion: `El desembolso de la oportunidad "${opportunity.title}" ha sido completado. Las boletas ya fueron subidas.`,
				type: "aviso",
				createdBy: userId,
				createdByRole: userData?.role ?? "accounting",
				assignedToRole: "sales",
				assignedTo: opportunity.assignedTo,
				redirectPage: "client_details_disbursement",
				relatedEntityType: "opportunity_client",
				relatedEntityId: input.opportunityId,
			});

			return { success: true };
		}),
};
