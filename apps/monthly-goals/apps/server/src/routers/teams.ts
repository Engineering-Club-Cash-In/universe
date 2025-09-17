import { protectedProcedure } from "../lib/orpc";
import { db } from "../db";
import { teamMembers } from "../db/schema/team-members";
import { areas } from "../db/schema/areas";
import { departments } from "../db/schema/departments";
import { user } from "../db/schema/auth";
import { eq } from "drizzle-orm";
import * as z from "zod";
import { auth } from "../lib/auth";

type UserRole = "super_admin" | "department_manager" | "area_lead" | "employee" | "viewer";

const roleHierarchy: Record<UserRole, UserRole[]> = {
	super_admin: ["super_admin", "department_manager", "area_lead", "employee", "viewer"],
	department_manager: ["area_lead", "employee"],
	area_lead: ["employee"],
	employee: [],
	viewer: []
};

const TeamMemberSchema = z.object({
	id: z.string().uuid(),
	userId: z.string(),
	areaId: z.string().uuid(),
	position: z.string().optional(),
	joinedAt: z.date(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

const CreateTeamMemberSchema = TeamMemberSchema.omit({
	id: true,
	joinedAt: true,
	createdAt: true,
	updatedAt: true,
});

const UpdateTeamMemberSchema = CreateTeamMemberSchema.partial().omit({ userId: true, areaId: true });

export const listTeamMembers = protectedProcedure.handler(async () => {
	return await db
		.select({
			id: teamMembers.id,
			userId: teamMembers.userId,
			areaId: teamMembers.areaId,
			position: teamMembers.position,
			joinedAt: teamMembers.joinedAt,
			createdAt: teamMembers.createdAt,
			updatedAt: teamMembers.updatedAt,
			userName: user.name,
			userEmail: user.email,
			areaName: areas.name,
			departmentName: departments.name,
		})
		.from(teamMembers)
		.leftJoin(user, eq(teamMembers.userId, user.id))
		.leftJoin(areas, eq(teamMembers.areaId, areas.id))
		.leftJoin(departments, eq(areas.departmentId, departments.id));
});

export const getTeamMember = protectedProcedure
	.input(z.object({ id: z.string().uuid() }))
	.handler(async ({ input }) => {
		const teamMember = await db
			.select({
				id: teamMembers.id,
				userId: teamMembers.userId,
				areaId: teamMembers.areaId,
				position: teamMembers.position,
				joinedAt: teamMembers.joinedAt,
				createdAt: teamMembers.createdAt,
				updatedAt: teamMembers.updatedAt,
				userName: user.name,
				userEmail: user.email,
				areaName: areas.name,
				departmentName: departments.name,
			})
			.from(teamMembers)
			.leftJoin(user, eq(teamMembers.userId, user.id))
			.leftJoin(areas, eq(teamMembers.areaId, areas.id))
			.leftJoin(departments, eq(areas.departmentId, departments.id))
			.where(eq(teamMembers.id, input.id))
			.limit(1);
		
		if (!teamMember[0]) {
			throw new Error("Team member not found");
		}
		
		return teamMember[0];
	});

export const createTeamMember = protectedProcedure
	.input(CreateTeamMemberSchema)
	.handler(async ({ input }) => {
		const [newTeamMember] = await db
			.insert(teamMembers)
			.values({
				...input,
			})
			.returning();
		
		return newTeamMember;
	});

export const updateTeamMember = protectedProcedure
	.input(
		z.object({
			id: z.string().uuid(),
			data: UpdateTeamMemberSchema,
		})
	)
	.handler(async ({ input }) => {
		const [updatedTeamMember] = await db
			.update(teamMembers)
			.set(input.data)
			.where(eq(teamMembers.id, input.id))
			.returning();
		
		if (!updatedTeamMember) {
			throw new Error("Team member not found");
		}
		
		return updatedTeamMember;
	});

export const deleteTeamMember = protectedProcedure
	.input(z.object({ id: z.string().uuid() }))
	.handler(async ({ context, input }) => {
		const currentUser = context.session!.user;
		
		// Obtener información del team member y usuario a eliminar
		const teamMemberToDelete = await db
			.select({
				teamMemberId: teamMembers.id,
				userId: teamMembers.userId,
				userRole: user.role,
			})
			.from(teamMembers)
			.leftJoin(user, eq(teamMembers.userId, user.id))
			.where(eq(teamMembers.id, input.id))
			.limit(1);

		if (!teamMemberToDelete[0]) {
			throw new Error("Miembro del equipo no encontrado");
		}

		const targetUser = teamMemberToDelete[0];
		
		// Validar permisos jerárquicos - solo puedes eliminar usuarios de roles inferiores
		const allowedRoles = roleHierarchy[currentUser.role as UserRole];
		if (!allowedRoles.includes(targetUser.userRole as UserRole)) {
			throw new Error(`No puedes eliminar usuarios con el rol ${targetUser.userRole}`);
		}

		// No permitir eliminar super_admin (excepto otros super_admin)
		if (targetUser.userRole === "super_admin" && currentUser.role !== "super_admin") {
			throw new Error("No puedes eliminar super administradores");
		}

		// No permitir eliminarse a sí mismo
		if (currentUser.id === targetUser.userId) {
			throw new Error("No puedes eliminar tu propia cuenta");
		}

		// Eliminar usuario completo (esto también eliminará el team member por CASCADE)
		await db.delete(user).where(eq(user.id, targetUser.userId));
		
		return { success: true };
	});

// Helper to get users that can be assigned to teams
export const getAvailableUsers = protectedProcedure.handler(async () => {
	return await db.select().from(user);
});

// Get team members filtered by current user's role and permissions
export const getMyTeamMembers = protectedProcedure.handler(async ({ context }) => {
	if (!context.session?.user) {
		throw new Error("Unauthorized");
	}

	const currentUser = context.session.user;
	
	let query = db
		.select({
			id: teamMembers.id,
			userId: teamMembers.userId,
			areaId: teamMembers.areaId,
			position: teamMembers.position,
			joinedAt: teamMembers.joinedAt,
			createdAt: teamMembers.createdAt,
			updatedAt: teamMembers.updatedAt,
			userName: user.name,
			userEmail: user.email,
			areaName: areas.name,
			departmentName: departments.name,
		})
		.from(teamMembers)
		.leftJoin(user, eq(teamMembers.userId, user.id))
		.leftJoin(areas, eq(teamMembers.areaId, areas.id))
		.leftJoin(departments, eq(areas.departmentId, departments.id));

	// Apply role-based filtering
	if (currentUser.role === "department_manager") {
		// Department manager: team members from departments they manage
		query = query.where(eq(departments.managerId, currentUser.id)) as typeof query;
	} else if (currentUser.role === "area_lead") {
		// Area lead: team members from areas they lead
		query = query.where(eq(areas.leadId, currentUser.id)) as typeof query;
	}
	// Super admin: see all team members (no additional filter)
	// Employee and viewer: shouldn't access this endpoint

	return await query;
});

// Create user and assign to team in one operation
export const createUserAndAssignToTeam = protectedProcedure
	.input(z.object({
		// User data
		name: z.string().min(1),
		email: z.string().email(),
		password: z.string().min(8),
		role: z.enum(["super_admin", "department_manager", "area_lead", "employee", "viewer"]),
		// Team member data
		areaId: z.string().uuid(),
		position: z.string().optional(),
	}))
	.handler(async ({ context, input }) => {
		try {
			const currentUser = context.session!.user;
			const allowedRoles = roleHierarchy[currentUser.role as UserRole];
			
			// Validar permisos para crear usuario con ese rol
			if (!allowedRoles.includes(input.role)) {
				throw new Error(`No puedes crear usuarios con el rol ${input.role}`);
			}

			// Verificar que el email no exista
			const existingUser = await db.select().from(user).where(eq(user.email, input.email)).limit(1);
			if (existingUser.length > 0) {
				throw new Error("Ya existe un usuario con este email");
			}

			// Crear usuario usando Better Auth
			const newUser = await auth.api.signUpEmail({
				body: {
					email: input.email,
					password: input.password,
					name: input.name,
					role: input.role,
				}
			});

			if (!newUser) {
				throw new Error("Error al crear el usuario");
			}

			// Actualizar el rol del usuario explícitamente
			await db.update(user)
				.set({ role: input.role })
				.where(eq(user.id, newUser.user.id));

			// Crear la relación del team member
			const [newTeamMember] = await db
				.insert(teamMembers)
				.values({
					userId: newUser.user.id,
					areaId: input.areaId,
					position: input.position,
				})
				.returning();

			return { 
				user: {
					id: newUser.user.id,
					name: newUser.user.name,
					email: newUser.user.email,
					role: input.role,
				}, 
				teamMember: newTeamMember 
			};
		} catch (error) {
			// Detectar errores específicos y dar mensajes claros
			if (error instanceof Error) {
				if (error.message.includes("unique")) {
					throw new Error("Ya existe un usuario con este email");
				}
				if (error.message.includes("No puedes crear")) {
					throw error; // Re-lanzar errores de permisos tal como están
				}
			}
			
			console.error("Error creating user and team member:", error);
			throw new Error("Error al crear el usuario y asignarlo al equipo");
		}
	});