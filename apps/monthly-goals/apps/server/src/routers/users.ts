import { z } from "zod";
import { protectedProcedure } from "../lib/orpc";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { eq } from "drizzle-orm";
import { auth } from "../lib/auth";

type UserRole = "super_admin" | "department_manager" | "area_lead" | "employee" | "viewer";

const roleHierarchy: Record<UserRole, UserRole[]> = {
	super_admin: ["super_admin", "department_manager", "area_lead", "employee", "viewer"],
	department_manager: ["area_lead", "employee"],
	area_lead: ["employee"],
	employee: [],
	viewer: []
};

// Listar usuarios (solo para administradores)
export const listUsers = protectedProcedure
	.input(z.void())
	.output(z.array(z.object({
		id: z.string(),
		name: z.string(),
		email: z.string(),
		role: z.enum(["super_admin", "department_manager", "area_lead", "employee", "viewer"]),
		createdAt: z.date(),
	})))
	.handler(async ({ context }) => {
		const currentUser = context.session!.user;
		if (!["super_admin", "department_manager", "area_lead"].includes(currentUser.role)) {
			throw new Error("No tienes permisos para ver usuarios");
		}

		const users = await db.select({
			id: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
			createdAt: user.createdAt,
		}).from(user);

		return users;
	});

// Crear usuario
export const createUser = protectedProcedure
	.input(z.object({
		name: z.string().min(2),
		email: z.string().email(),
		password: z.string().min(8),
		role: z.enum(["super_admin", "department_manager", "area_lead", "employee", "viewer"])
	}))
	.output(z.object({
		id: z.string(),
		name: z.string(),
		email: z.string(),
		role: z.enum(["super_admin", "department_manager", "area_lead", "employee", "viewer"])
	}))
	.handler(async ({ context, input }) => {
		const currentUser = context.session!.user;
		const allowedRoles = roleHierarchy[currentUser.role as UserRole];
		
		if (!allowedRoles.includes(input.role)) {
			throw new Error(`No puedes crear usuarios con el rol ${input.role}`);
		}

		// Verificar que el email no exista
		const existingUser = await db.select().from(user).where(eq(user.email, input.email)).limit(1);
		if (existingUser.length > 0) {
			throw new Error("El email ya está en uso");
		}

		// Crear usuario usando Better Auth (rol se asignará después)
		const newUser = await auth.api.signUpEmail({
			body: {
				email: input.email,
				password: input.password,
				name: input.name,
			}
		});

		if (!newUser) {
			throw new Error("Error al crear el usuario");
		}

		// Actualizar el rol del usuario explícitamente
		await db.update(user)
			.set({ role: input.role })
			.where(eq(user.id, newUser.user.id));

		return {
			id: newUser.user.id,
			name: newUser.user.name,
			email: newUser.user.email,
			role: input.role,
		};
	});

// Actualizar rol de usuario
export const updateUserRole = protectedProcedure
	.input(z.object({
		userId: z.string(),
		newRole: z.enum(["super_admin", "department_manager", "area_lead", "employee", "viewer"])
	}))
	.output(z.object({ success: z.boolean() }))
	.handler(async ({ context, input }) => {
		const currentUser = context.session!.user;
		const allowedRoles = roleHierarchy[currentUser.role as UserRole];
		
		if (!allowedRoles.includes(input.newRole)) {
			throw new Error(`No puedes asignar el rol ${input.newRole}`);
		}

		// No permitir que se modifique a sí mismo
		if (currentUser.id === input.userId) {
			throw new Error("No puedes modificar tu propio rol");
		}

		await db.update(user)
			.set({ role: input.newRole })
			.where(eq(user.id, input.userId));

		return { success: true };
	});

// Eliminar usuario
export const deleteUser = protectedProcedure
	.input(z.object({
		userId: z.string()
	}))
	.output(z.object({ success: z.boolean() }))
	.handler(async ({ context, input }) => {
		const currentUser = context.session!.user;
		
		// Solo super_admin puede eliminar usuarios
		if (currentUser.role !== "super_admin") {
			throw new Error("Solo los super administradores pueden eliminar usuarios");
		}

		// No permitir eliminarse a sí mismo
		if (currentUser.id === input.userId) {
			throw new Error("No puedes eliminar tu propia cuenta");
		}

		await db.delete(user).where(eq(user.id, input.userId));

		return { success: true };
	});