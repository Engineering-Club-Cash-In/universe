import { protectedProcedure } from "../lib/orpc";
import { db } from "../db";
import { teamMembers } from "../db/schema/team-members";
import { areas } from "../db/schema/areas";
import { departments } from "../db/schema/departments";
import { user } from "../db/schema/auth";
import { eq } from "drizzle-orm";
import * as z from "zod";

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
	.handler(async ({ input }) => {
		const [deletedTeamMember] = await db
			.delete(teamMembers)
			.where(eq(teamMembers.id, input.id))
			.returning();
		
		if (!deletedTeamMember) {
			throw new Error("Team member not found");
		}
		
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
		role: z.enum(["super_admin", "department_manager", "area_lead", "employee", "viewer"]).default("employee"),
		// Team member data
		areaId: z.string().uuid(),
		position: z.string().optional(),
	}))
	.handler(async ({ input }) => {
		// First create the user
		const [newUser] = await db
			.insert(user)
			.values({
				id: crypto.randomUUID(),
				name: input.name,
				email: input.email,
				emailVerified: false,
				role: input.role as "super_admin" | "department_manager" | "area_lead" | "employee" | "viewer",
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.returning();

		// Then create the team member relationship
		const [newTeamMember] = await db
			.insert(teamMembers)
			.values({
				userId: newUser.id,
				areaId: input.areaId,
				position: input.position,
			})
			.returning();

		return { user: newUser, teamMember: newTeamMember };
	});