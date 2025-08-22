import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { auth } from "../lib/auth";
import { adminProcedure } from "../lib/orpc";

export const adminRouter = {
	getStats: adminProcedure.handler(async ({ context: _ }) => {
		const totalUsers = await db.select().from(user);

		return {
			message: "This is admin-only data",
			adminStats: {
				totalUsers: totalUsers.length,
				totalSales: 150,
				revenue: "$50,000",
			},
		};
	}),

	// User CRUD operations
	getAllUsers: adminProcedure.handler(async ({ context: _ }) => {
		const users = await db
			.select({
				id: user.id,
				name: user.name,
				email: user.email,
				role: user.role,
				emailVerified: user.emailVerified,
				createdAt: user.createdAt,
				updatedAt: user.updatedAt,
			})
			.from(user);

		return users;
	}),

	updateUserRole: adminProcedure
		.input(
			z.object({
				userId: z.string(),
				role: z.enum(["admin", "sales", "analyst"]),
			}),
		)
		.handler(async ({ input, context }) => {
			// Prevent changing own role
			if (input.userId === context.session?.user?.id) {
				throw new Error("Cannot change your own role");
			}

			const updatedUser = await db
				.update(user)
				.set({
					role: input.role,
					updatedAt: new Date(),
				})
				.where(eq(user.id, input.userId))
				.returning();

			if (updatedUser.length === 0) {
				throw new Error("User not found");
			}

			return updatedUser[0];
		}),

	deleteUser: adminProcedure
		.input(
			z.object({
				userId: z.string(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Prevent deleting own account
			if (input.userId === context.session?.user?.id) {
				throw new Error("Cannot delete your own account");
			}

			const deletedUser = await db
				.delete(user)
				.where(eq(user.id, input.userId))
				.returning();

			if (deletedUser.length === 0) {
				throw new Error("User not found");
			}

			return { success: true, deletedUser: deletedUser[0] };
		}),

	createUser: adminProcedure
		.input(
			z.object({
				name: z.string().min(1, "Name is required"),
				email: z.string().email("Invalid email address"),
				password: z.string().min(8, "Password must be at least 8 characters"),
				role: z.enum(["admin", "sales", "analyst"]).default("sales"),
			}),
		)
		.handler(async ({ input, context: _ }) => {
			// Check if email is from clubcashin.com domain
			if (!input.email.endsWith("@clubcashin.com")) {
				throw new Error("Only @clubcashin.com email addresses are allowed");
			}

			// Use Better Auth's admin createUser API
			const result = await auth.api.createUser({
				body: {
					name: input.name,
					email: input.email,
					password: input.password,
					role: input.role,
				},
			});

			if (!result.user) {
				throw new Error("Failed to create user");
			}

			return result.user;
		}),
};
