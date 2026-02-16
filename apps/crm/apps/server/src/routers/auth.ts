import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { protectedProcedure } from "../lib/orpc";

export const authRouter = {
	getUserProfile: protectedProcedure.handler(async ({ context }) => {
		const userId = context.session?.user?.id;
		if (!userId) {
			throw new ORPCError("NOT_FOUND", {
				message: "Usuario no encontrado",
			});
		}

		const userData = await db
			.select()
			.from(user)
			.where(eq(user.id, userId))
			.limit(1);
		return userData[0] || null;
	}),

	privateData: protectedProcedure.handler(({ context }) => {
		return {
			message: "This is private",
			user: context.session?.user,
		};
	}),
};
