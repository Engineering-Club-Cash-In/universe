import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { coDebtors, leads, opportunities } from "../db/schema/crm";
import { notifications } from "../db/schema/notifications";
import { vehicles } from "../db/schema/vehicles";
import { protectedProcedure } from "../lib/orpc";
import { PERMISSIONS } from "../lib/roles";
import {
	buildUploadPrefix,
	generatePresignedUploadUrl,
	generateUniqueFilename,
	MAX_FILE_SIZE,
	UPLOAD_RESOURCE_TYPES,
	validateResolvedMimeType,
} from "../lib/storage";

const MAX_BANK_STATEMENT_SIZE = 15 * 1024 * 1024;

async function getCurrentUser(userId: string) {
	const [currentUser] = await db
		.select({
			id: user.id,
			role: user.role,
		})
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);

	if (!currentUser) {
		throw new ORPCError("UNAUTHORIZED");
	}

	return currentUser;
}

async function assertCanUploadToResource(params: {
	userId: string;
	userRole: string;
	resourceType: (typeof UPLOAD_RESOURCE_TYPES)[number];
	resourceId: string;
}) {
	const { userId, userRole, resourceType, resourceId } = params;

	switch (resourceType) {
		case "opportunity_document": {
			if (
				!["admin", "sales", "sales_supervisor", "analyst"].includes(userRole)
			) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permiso para subir documentos",
				});
			}

			const [opportunity] = await db
				.select({
					id: opportunities.id,
					assignedTo: opportunities.assignedTo,
				})
				.from(opportunities)
				.where(eq(opportunities.id, resourceId))
				.limit(1);

			if (!opportunity) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			if (userRole === "sales" && opportunity.assignedTo !== userId) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permiso para subir documentos a esta oportunidad",
				});
			}
			return;
		}

		case "vehicle_document": {
			if (
				!["admin", "sales", "sales_supervisor", "analyst"].includes(userRole)
			) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permiso para subir documentos",
				});
			}

			const [vehicle] = await db
				.select({ id: vehicles.id })
				.from(vehicles)
				.where(eq(vehicles.id, resourceId))
				.limit(1);

			if (!vehicle) {
				throw new ORPCError("NOT_FOUND", {
					message: "Vehículo no encontrado",
				});
			}
			return;
		}

		case "notification_document": {
			const [notification] = await db
				.select({
					id: notifications.id,
					type: notifications.type,
					assignedToRole: notifications.assignedToRole,
					assignedTo: notifications.assignedTo,
				})
				.from(notifications)
				.where(eq(notifications.id, resourceId))
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

			const isAdmin = userRole === "admin";
			const roleMatches = userRole === notification.assignedToRole;
			const isDirectlyAssigned = notification.assignedTo === userId;
			const isSupervisorWithAccess =
				userRole === "sales_supervisor" &&
				["sales_supervisor", "analyst"].includes(notification.assignedToRole);

			if (
				!isAdmin &&
				!roleMatches &&
				!isDirectlyAssigned &&
				!isSupervisorWithAccess
			) {
				throw new ORPCError("FORBIDDEN", {
					message:
						"No tienes permiso para subir documentos a esta notificación",
				});
			}
			return;
		}

		case "bank_statement": {
			if (!PERMISSIONS.canAccessClients(userRole)) {
				throw new ORPCError("FORBIDDEN", {
					message: "CRM access role required",
				});
			}

			const [opportunity] = await db
				.select({
					id: opportunities.id,
					assignedTo: opportunities.assignedTo,
				})
				.from(opportunities)
				.where(eq(opportunities.id, resourceId))
				.limit(1);

			if (opportunity) {
				if (userRole === "sales" && opportunity.assignedTo !== userId) {
					throw new ORPCError("FORBIDDEN", {
						message: "No tienes permiso para analizar esta oportunidad",
					});
				}
				return;
			}

			const [coDebtor] = await db
				.select({ id: coDebtors.id })
				.from(coDebtors)
				.where(eq(coDebtors.id, resourceId))
				.limit(1);

			if (!coDebtor) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad o co-deudor no encontrado",
				});
			}
			return;
		}

		case "legal_contract_pdf": {
			if (!PERMISSIONS.canCreateLegalContracts(userRole)) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permisos para crear contratos",
				});
			}

			const [opportunity] = await db
				.select({ id: opportunities.id })
				.from(opportunities)
				.where(eq(opportunities.id, resourceId))
				.limit(1);

			if (opportunity) {
				return;
			}

			const [lead] = await db
				.select({ id: leads.id })
				.from(leads)
				.where(eq(leads.id, resourceId))
				.limit(1);

			if (!lead) {
				throw new ORPCError("NOT_FOUND", {
					message: "Lead u oportunidad no encontrada",
				});
			}
			return;
		}

		case "investment_document": {
			if (!PERMISSIONS.canAccessInvestments(userRole)) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permiso para subir documentos de inversión",
				});
			}
			return;
		}
	}
}

export const uploadRouter = {
	getUploadPresignedUrl: protectedProcedure
		.input(
			z.object({
				filename: z.string().min(1),
				mimeType: z.string().optional(),
				size: z.number().int().positive(),
				resourceType: z.enum(UPLOAD_RESOURCE_TYPES),
				resourceId: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context }) => {
			const currentUser = await getCurrentUser(context.session.user.id);

			await assertCanUploadToResource({
				userId: currentUser.id,
				userRole: currentUser.role,
				resourceType: input.resourceType,
				resourceId: input.resourceId,
			});

			const resolvedMime = validateResolvedMimeType({
				name: input.filename,
				type: input.mimeType,
			});

			if (!resolvedMime.valid || !resolvedMime.mimeType) {
				throw new ORPCError("BAD_REQUEST", {
					message: resolvedMime.error || "Tipo de archivo no permitido",
				});
			}

			const maxSizeBytes =
				input.resourceType === "bank_statement"
					? MAX_BANK_STATEMENT_SIZE
					: MAX_FILE_SIZE;

			if (input.size > maxSizeBytes) {
				throw new ORPCError("BAD_REQUEST", {
					message: `El archivo es demasiado grande. El tamaño máximo permitido es ${Math.round(maxSizeBytes / (1024 * 1024))}MB.`,
				});
			}

			if (
				input.resourceType === "bank_statement" &&
				resolvedMime.mimeType !== "application/pdf"
			) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Los estados de cuenta deben subirse en formato PDF.",
				});
			}

			const prefix = buildUploadPrefix(input.resourceType, input.resourceId);
			const uniqueFilename = generateUniqueFilename(input.filename);
			const key = `${prefix}/${uniqueFilename}`;
			const url = await generatePresignedUploadUrl(key, resolvedMime.mimeType);

			return { url, key, resolvedMimeType: resolvedMime.mimeType };
		}),
};
