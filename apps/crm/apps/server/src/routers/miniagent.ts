import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { miniagentCredentials } from "../db/schema";
import { decrypt } from "../lib/encryption";
import { protectedProcedure } from "../lib/orpc";

export const miniagentRouter = {
	/**
	 * Obtener credenciales de MiniAgent del usuario actual
	 */
	getMiniAgentCredentials: protectedProcedure
		.output(
			z.object({
				email: z.string(),
				password: z.string(),
			}),
		)
		.handler(async ({ context }) => {
			const userId = context.session.user.id;

			// Buscar credenciales del usuario
			const [credentials] = await db
				.select()
				.from(miniagentCredentials)
				.where(eq(miniagentCredentials.userId, userId))
				.limit(1);

			if (!credentials) {
				throw new Error("No hay credenciales configuradas para este usuario");
			}

			// Descifrar y retornar
			return {
				email: decrypt(credentials.email),
				password: decrypt(credentials.password),
			};
		}),
};
