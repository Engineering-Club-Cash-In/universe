import { protectedProcedure } from "../lib/orpc";
import { db } from "../db";
import { monthlyGoals } from "../db/schema/monthly-goals";
import { goalTemplates } from "../db/schema/goal-templates";
import { teamMembers } from "../db/schema/team-members";
import { user } from "../db/schema/auth";
import { areas } from "../db/schema/areas";
import { departments } from "../db/schema/departments";
import { eq, and, or } from "drizzle-orm";
import * as z from "zod";

const MonthlyGoalSchema = z.object({
	id: z.string().uuid(),
	teamMemberId: z.string().uuid(),
	goalTemplateId: z.string().uuid(),
	month: z.number().int().min(1).max(12),
	year: z.number().int().min(2020),
	targetValue: z.string(),
	achievedValue: z.string(),
	description: z.string().optional(),
	status: z.enum(["pending", "in_progress", "completed"]),
	createdAt: z.date(),
	updatedAt: z.date(),
});

const CreateMonthlyGoalSchema = MonthlyGoalSchema.omit({
	id: true,
	achievedValue: true,
	status: true,
	createdAt: true,
	updatedAt: true,
});

const UpdateMonthlyGoalSchema = z.object({
	achievedValue: z.string().optional(),
	description: z.string().optional(),
	status: z.enum(["pending", "in_progress", "completed"]).optional(),
});

const BulkCreateMonthlyGoalsSchema = z.object({
	month: z.number().int().min(1).max(12),
	year: z.number().int().min(2020),
	goals: z.array(z.object({
		teamMemberId: z.string().uuid(),
		goalTemplateId: z.string().uuid(),
		targetValue: z.string(),
		description: z.string().optional(),
	})),
});

export const listMonthlyGoals = protectedProcedure
	.input(z.object({
		month: z.number().int().min(1).max(12).optional(),
		year: z.number().int().min(2020).optional(),
	}))
	.handler(async ({ input }) => {
		let query = db
			.select({
				id: monthlyGoals.id,
				month: monthlyGoals.month,
				year: monthlyGoals.year,
				targetValue: monthlyGoals.targetValue,
				achievedValue: monthlyGoals.achievedValue,
				description: monthlyGoals.description,
				status: monthlyGoals.status,
				createdAt: monthlyGoals.createdAt,
				updatedAt: monthlyGoals.updatedAt,
				// Goal template info
				goalTemplateName: goalTemplates.name,
				goalTemplateUnit: goalTemplates.unit,
				successThreshold: goalTemplates.successThreshold,
				warningThreshold: goalTemplates.warningThreshold,
				// User and organizational info
				userName: user.name,
				userEmail: user.email,
				areaName: areas.name,
				departmentName: departments.name,
			})
			.from(monthlyGoals)
			.leftJoin(goalTemplates, eq(monthlyGoals.goalTemplateId, goalTemplates.id))
			.leftJoin(teamMembers, eq(monthlyGoals.teamMemberId, teamMembers.id))
			.leftJoin(user, eq(teamMembers.userId, user.id))
			.leftJoin(areas, eq(teamMembers.areaId, areas.id))
			.leftJoin(departments, eq(areas.departmentId, departments.id));

		if (input.month && input.year) {
			query = query.where(and(
				eq(monthlyGoals.month, input.month),
				eq(monthlyGoals.year, input.year)
			)) as typeof query;
		}

		return await query;
	});

export const getMonthlyGoal = protectedProcedure
	.input(z.object({ id: z.string().uuid() }))
	.handler(async ({ input }) => {
		const goal = await db
			.select({
				id: monthlyGoals.id,
				teamMemberId: monthlyGoals.teamMemberId,
				goalTemplateId: monthlyGoals.goalTemplateId,
				month: monthlyGoals.month,
				year: monthlyGoals.year,
				targetValue: monthlyGoals.targetValue,
				achievedValue: monthlyGoals.achievedValue,
				description: monthlyGoals.description,
				status: monthlyGoals.status,
				createdAt: monthlyGoals.createdAt,
				updatedAt: monthlyGoals.updatedAt,
				goalTemplateName: goalTemplates.name,
				userName: user.name,
			})
			.from(monthlyGoals)
			.leftJoin(goalTemplates, eq(monthlyGoals.goalTemplateId, goalTemplates.id))
			.leftJoin(teamMembers, eq(monthlyGoals.teamMemberId, teamMembers.id))
			.leftJoin(user, eq(teamMembers.userId, user.id))
			.where(eq(monthlyGoals.id, input.id))
			.limit(1);
		
		if (!goal[0]) {
			throw new Error("Monthly goal not found");
		}
		
		return goal[0];
	});

export const createMonthlyGoal = protectedProcedure
	.input(CreateMonthlyGoalSchema)
	.handler(async ({ input }) => {
		const [newGoal] = await db
			.insert(monthlyGoals)
			.values({
				...input,
			})
			.returning();
		
		return newGoal;
	});

export const bulkCreateMonthlyGoals = protectedProcedure
	.input(BulkCreateMonthlyGoalsSchema)
	.handler(async ({ input }) => {
		const goalValues = input.goals.map(goal => ({
			...goal,
			month: input.month,
			year: input.year,
		}));

		const newGoals = await db
			.insert(monthlyGoals)
			.values(goalValues)
			.returning();
		
		return newGoals;
	});

export const updateMonthlyGoal = protectedProcedure
	.input(
		z.object({
			id: z.string().uuid(),
			data: UpdateMonthlyGoalSchema,
		})
	)
	.handler(async ({ input }) => {
		const [updatedGoal] = await db
			.update(monthlyGoals)
			.set(input.data)
			.where(eq(monthlyGoals.id, input.id))
			.returning();
		
		if (!updatedGoal) {
			throw new Error("Monthly goal not found");
		}
		
		return updatedGoal;
	});

export const deleteMonthlyGoal = protectedProcedure
	.input(z.object({ id: z.string().uuid() }))
	.handler(async ({ input }) => {
		const [deletedGoal] = await db
			.delete(monthlyGoals)
			.where(eq(monthlyGoals.id, input.id))
			.returning();
		
		if (!deletedGoal) {
			throw new Error("Monthly goal not found");
		}
		
		return { success: true };
	});

// Helper function to calculate goal progress
export const calculateGoalProgress = protectedProcedure
	.input(z.object({ id: z.string().uuid() }))
	.handler(async ({ input }) => {
		const goal = await db
			.select({
				targetValue: monthlyGoals.targetValue,
				achievedValue: monthlyGoals.achievedValue,
				successThreshold: goalTemplates.successThreshold,
				warningThreshold: goalTemplates.warningThreshold,
			})
			.from(monthlyGoals)
			.leftJoin(goalTemplates, eq(monthlyGoals.goalTemplateId, goalTemplates.id))
			.where(eq(monthlyGoals.id, input.id))
			.limit(1);

		if (!goal[0]) {
			throw new Error("Goal not found");
		}

		const target = parseFloat(goal[0].targetValue);
		const achieved = parseFloat(goal[0].achievedValue);
		const percentage = target > 0 ? (achieved / target) * 100 : 0;

		const successThreshold = parseFloat(goal[0].successThreshold || "80");
		const warningThreshold = parseFloat(goal[0].warningThreshold || "50");

		let status: "success" | "warning" | "danger";
		let color: "green" | "yellow" | "red";

		if (percentage >= successThreshold) {
			status = "success";
			color = "green";
		} else if (percentage >= warningThreshold) {
			status = "warning";
			color = "yellow";
		} else {
			status = "danger";
			color = "red";
		}

		return {
			percentage: Math.round(percentage * 100) / 100,
			status,
			color,
			target,
			achieved,
		};
	});

// Get goals for current user based on their role
export const getMyGoals = protectedProcedure
	.input(z.object({
		month: z.number().int().min(1).max(12).optional(),
		year: z.number().int().min(2020).optional(),
	}))
	.handler(async ({ input, context }) => {
		if (!context.session?.user) {
			throw new Error("Unauthorized");
		}

		const currentUser = context.session.user;
		
		let query = db
			.select({
				id: monthlyGoals.id,
				month: monthlyGoals.month,
				year: monthlyGoals.year,
				targetValue: monthlyGoals.targetValue,
				achievedValue: monthlyGoals.achievedValue,
				description: monthlyGoals.description,
				status: monthlyGoals.status,
				createdAt: monthlyGoals.createdAt,
				updatedAt: monthlyGoals.updatedAt,
				// Goal template info
				goalTemplateName: goalTemplates.name,
				goalTemplateUnit: goalTemplates.unit,
				successThreshold: goalTemplates.successThreshold,
				warningThreshold: goalTemplates.warningThreshold,
				// User and organizational info
				userName: user.name,
				userEmail: user.email,
				userId: user.id,
				areaName: areas.name,
				departmentName: departments.name,
			})
			.from(monthlyGoals)
			.leftJoin(goalTemplates, eq(monthlyGoals.goalTemplateId, goalTemplates.id))
			.leftJoin(teamMembers, eq(monthlyGoals.teamMemberId, teamMembers.id))
			.leftJoin(user, eq(teamMembers.userId, user.id))
			.leftJoin(areas, eq(teamMembers.areaId, areas.id))
			.leftJoin(departments, eq(areas.departmentId, departments.id));

		// Apply role-based filtering
		if (currentUser.role === "employee") {
			// Employee: only their own goals
			query = query.where(eq(user.id, currentUser.id)) as typeof query;
		} else if (currentUser.role === "department_manager") {
			// Department manager: goals from users in departments they manage
			query = query.where(eq(departments.managerId, currentUser.id)) as typeof query;
		} else if (currentUser.role === "area_lead") {
			// Area lead: goals from users in areas they lead
			query = query.where(eq(areas.leadId, currentUser.id)) as typeof query;
		}
		// Super admin and viewer: see all goals (no additional filter)

		// Apply period filter if provided
		if (input.month && input.year) {
			query = query.where(and(
				eq(monthlyGoals.month, input.month),
				eq(monthlyGoals.year, input.year)
			)) as typeof query;
		}

		return await query;
	});