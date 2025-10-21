import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { miniagentCredentials, user } from "../db/schema";
import { encrypt } from "../lib/encryption";
import { protectedProcedure } from "../lib/orpc";

export const adminMiniagentRouter = {
	/**
	 * Listar todos los usuarios con acceso a WhatsApp y su estado de credenciales
	 */
	listUsersWithCredentials: protectedProcedure
		.output(
			z.array(
				z.object({
					userId: z.string(),
					name: z.string(),
					email: z.string(),
					role: z.string(),
					hasCredentials: z.boolean(),
				}),
			),
		)
		.handler(async ({ context }) => {
			// Solo admin puede acceder
			if (context.session.user.role !== "admin") {
				throw new Error("No autorizado");
			}

			// Obtener todos los usuarios con acceso a WhatsApp (admin y sales)
			const allUsers = await db
				.select({
					id: user.id,
					name: user.name,
					email: user.email,
					role: user.role,
				})
				.from(user)
				.where(eq(user.role, "sales"));

			// Obtener credenciales existentes
			const credentials = await db.select().from(miniagentCredentials);

			// Mapear usuarios con su estado de credenciales
			return allUsers.map((user) => ({
				userId: user.id,
				name: user.name || "",
				email: user.email,
				role: user.role,
				hasCredentials: credentials.some((c) => c.userId === user.id),
			}));
		}),

	/**
	 * Configurar credenciales de MiniAgent para un usuario
	 */
	setMiniAgentCredentials: protectedProcedure
		.input(
			z.object({
				userId: z.string(),
				email: z.string().email(),
				password: z.string().min(1),
			}),
		)
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			// Solo admin puede acceder
			if (context.session.user.role !== "admin") {
				throw new Error("No autorizado");
			}

			// Cifrar credenciales
			const encryptedEmail = encrypt(input.email);
			const encryptedPassword = encrypt(input.password);

			// Verificar si ya existen credenciales para este usuario
			const [existing] = await db
				.select()
				.from(miniagentCredentials)
				.where(eq(miniagentCredentials.userId, input.userId))
				.limit(1);

			if (existing) {
				// Actualizar
				await db
					.update(miniagentCredentials)
					.set({
						email: encryptedEmail,
						password: encryptedPassword,
						updatedAt: new Date(),
					})
					.where(eq(miniagentCredentials.userId, input.userId));
			} else {
				// Insertar
				await db.insert(miniagentCredentials).values({
					userId: input.userId,
					email: encryptedEmail,
					password: encryptedPassword,
				});
			}

			return { success: true };
		}),

	/**
	 * Eliminar credenciales de MiniAgent de un usuario
	 */
	deleteMiniAgentCredentials: protectedProcedure
		.input(z.object({ userId: z.string() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			// Solo admin puede acceder
			if (context.session.user.role !== "admin") {
				throw new Error("No autorizado");
			}

			await db
				.delete(miniagentCredentials)
				.where(eq(miniagentCredentials.userId, input.userId));

			return { success: true };
		}),
};
