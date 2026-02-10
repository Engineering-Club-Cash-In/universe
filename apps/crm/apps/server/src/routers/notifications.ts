import { and, count, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import type { NewNotification } from "../db/schema/notifications";
import {
	notificationDocuments,
	notifications,
} from "../db/schema/notifications";
import { adminProcedure, protectedProcedure } from "../lib/orpc";
import {
	generateUniqueFilename,
	getFileUrl,
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
			.orderBy(desc(notifications.createdAt));

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
			.orderBy(desc(notifications.createdAt));

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
			.orderBy(desc(notifications.createdAt));

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
		.handler(async ({ input }) => {
			const result = await db
				.select(notificationWithCreator)
				.from(notifications)
				.leftJoin(user, eq(notifications.createdBy, user.id))
				.where(inArray(notifications.assignedToRole, input.roles))
				.orderBy(desc(notifications.createdAt));

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
		.handler(async ({ input }) => {
			// Si se intenta resolver, verificar que no sea action_upload_files sin documentos
			if (input.status === "resolved") {
				const [notif] = await db
					.select({
						type: notifications.type,
					})
					.from(notifications)
					.where(eq(notifications.id, input.notificationId))
					.limit(1);

				if (notif?.type === "action_upload_files") {
					const docs = await db
						.select({ id: notificationDocuments.id })
						.from(notificationDocuments)
						.where(
							eq(
								notificationDocuments.notificationId,
								input.notificationId,
							),
						)
						.limit(1);

					if (docs.length === 0) {
						throw new Error(
							"No se puede resolver esta notificación sin haber subido al menos un documento.",
						);
					}
				}
			}

			const now = new Date();

			const setData: Record<string, unknown> = {
				status: input.status,
				updatedAt: now,
			};

			if (input.status === "read") {
				setData.readAt = now;
			}
			if (input.status === "resolved") {
				setData.resolvedAt = now;
			}

			const [updated] = await db
				.update(notifications)
				.set(setData)
				.where(eq(notifications.id, input.notificationId))
				.returning();

			return updated;
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
				.where(
					eq(notificationDocuments.notificationId, input.notificationId),
				)
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
				throw new Error("Notificación no encontrada");
			}

			if (notification.type !== "action_upload_files") {
				throw new Error("Esta notificación no permite subir documentos");
			}

			// Validar archivo
			const validation = validateFile({
				type: input.file.type,
				size: input.file.size,
			} as File);

			if (!validation.valid) {
				throw new Error(validation.error || "Archivo inválido");
			}

			// Subir a R2
			const fileBuffer = Buffer.from(input.file.data, "base64");
			const fileBlob = new Blob([fileBuffer], { type: input.file.type });
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
					mimeType: input.file.type,
					size: input.file.size,
					filePath: key,
					uploadedBy: userId,
				})
				.returning();

			return document;
		}),
};
