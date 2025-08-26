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