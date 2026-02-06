import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import type { NewNotification } from "../db/schema/notifications";
import {
	notificationDocuments,
	notifications,
} from "../db/schema/notifications";
import { adminProcedure, protectedProcedure } from "../lib/orpc";

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
	// Obtener todas las notificaciones (solo admin)
	getAllNotifications: adminProcedure.handler(async () => {
		const result = await db
			.select()
			.from(notifications)
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
			.select()
			.from(notifications)
			.where(eq(notifications.assignedToRole, userData.role))
			.orderBy(desc(notifications.createdAt));

		return result;
	}),

	// Obtener notificaciones asignadas directamente al usuario autenticado
	getNotificationsByAssign: protectedProcedure.handler(async ({ context }) => {
		const userId = context.session.user.id;

		const result = await db
			.select()
			.from(notifications)
			.where(eq(notifications.assignedTo, userId))
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

	// Agregar documento a una notificación
	addDocumentToNotification: protectedProcedure
		.input(
			z.object({
				notificationId: z.string().uuid(),
				filename: z.string().min(1),
				originalName: z.string().min(1),
				mimeType: z.string().min(1),
				size: z.number().int().positive(),
				filePath: z.string().min(1),
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

			const [document] = await db
				.insert(notificationDocuments)
				.values({
					notificationId: input.notificationId,
					filename: input.filename,
					originalName: input.originalName,
					mimeType: input.mimeType,
					size: input.size,
					filePath: input.filePath,
					uploadedBy: userId,
				})
				.returning();

			return document;
		}),
};
