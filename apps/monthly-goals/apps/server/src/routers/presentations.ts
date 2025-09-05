import { protectedProcedure } from "../lib/orpc";
import { db } from "../db";
import { presentations, goalSubmissions } from "../db/schema/presentations";
import { monthlyGoals } from "../db/schema/monthly-goals";
import { goalTemplates } from "../db/schema/goal-templates";
import { teamMembers } from "../db/schema/team-members";
import { user } from "../db/schema/auth";
import { areas } from "../db/schema/areas";
import { departments } from "../db/schema/departments";
import { eq, and, or } from "drizzle-orm";
import * as z from "zod";

const PresentationSchema = z.object({
	id: z.string().uuid(),
	name: z.string().min(1, "Name is required"),
	month: z.number().int().min(1).max(12),
	year: z.number().int().min(2020),
	status: z.enum(["draft", "ready", "presented"]),
	createdBy: z.string(),
	presentedAt: z.date().optional(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

const CreatePresentationSchema = PresentationSchema.omit({
	id: true,
	createdBy: true,
	presentedAt: true,
	createdAt: true,
	updatedAt: true,
	status: true,
});

const UpdatePresentationSchema = z.object({
	name: z.string().min(1).optional(),
	status: z.enum(["draft", "ready", "presented"]).optional(),
	presentedAt: z.date().optional(),
});

const GoalSubmissionSchema = z.object({
	monthlyGoalId: z.string().uuid(),
	submittedValue: z.string(),
	notes: z.string().optional(),
});

const BulkSubmitGoalsSchema = z.object({
	presentationId: z.string().uuid(),
	submissions: z.array(GoalSubmissionSchema),
});

export const listPresentations = protectedProcedure.handler(async ({ context }) => {
	if (!context.session?.user) {
		throw new Error("Unauthorized");
	}

	const currentUser = context.session.user;
	
	let query = db
		.select({
			id: presentations.id,
			name: presentations.name,
			month: presentations.month,
			year: presentations.year,
			status: presentations.status,
			createdBy: presentations.createdBy,
			presentedAt: presentations.presentedAt,
			createdAt: presentations.createdAt,
			updatedAt: presentations.updatedAt,
			createdByName: user.name,
			createdByEmail: user.email,
		})
		.from(presentations)
		.leftJoin(user, eq(presentations.createdBy, user.id));

	// Apply role-based filtering
	if (currentUser.role === "department_manager" || currentUser.role === "area_lead") {
		// Only see presentations they created or are relevant to their area/dept
		query = query.where(eq(presentations.createdBy, currentUser.id)) as typeof query;
	}
	// Super admin and viewer see all presentations

	return await query;
});

export const getPresentation = protectedProcedure
	.input(z.object({ id: z.string().uuid() }))
	.handler(async ({ input }) => {
		const presentation = await db
			.select({
				id: presentations.id,
				name: presentations.name,
				month: presentations.month,
				year: presentations.year,
				status: presentations.status,
				createdBy: presentations.createdBy,
				presentedAt: presentations.presentedAt,
				createdAt: presentations.createdAt,
				updatedAt: presentations.updatedAt,
				createdByName: user.name,
				createdByEmail: user.email,
			})
			.from(presentations)
			.leftJoin(user, eq(presentations.createdBy, user.id))
			.where(eq(presentations.id, input.id))
			.limit(1);
		
		if (!presentation[0]) {
			throw new Error("Presentation not found");
		}
		
		return presentation[0];
	});

export const createPresentation = protectedProcedure
	.input(CreatePresentationSchema)
	.handler(async ({ input, context }) => {
		if (!context.session?.user) {
			throw new Error("Unauthorized");
		}

		const [newPresentation] = await db
			.insert(presentations)
			.values({
				...input,
				createdBy: context.session.user.id,
				status: "draft",
			})
			.returning();
		
		return newPresentation;
	});

export const updatePresentation = protectedProcedure
	.input(
		z.object({
			id: z.string().uuid(),
			data: UpdatePresentationSchema,
		})
	)
	.handler(async ({ input }) => {
		const [updatedPresentation] = await db
			.update(presentations)
			.set(input.data)
			.where(eq(presentations.id, input.id))
			.returning();
		
		if (!updatedPresentation) {
			throw new Error("Presentation not found");
		}
		
		return updatedPresentation;
	});

export const deletePresentation = protectedProcedure
	.input(z.object({ id: z.string().uuid() }))
	.handler(async ({ input }) => {
		// First delete related goal submissions
		await db.delete(goalSubmissions).where(eq(goalSubmissions.presentationId, input.id));
		
		// Then delete the presentation
		const [deletedPresentation] = await db
			.delete(presentations)
			.where(eq(presentations.id, input.id))
			.returning();
		
		if (!deletedPresentation) {
			throw new Error("Presentation not found");
		}
		
		return { success: true };
	});

// Get monthly goals available for a presentation (filtered by user role)
export const getAvailableGoalsForPresentation = protectedProcedure
	.input(z.object({ 
		month: z.number().int().min(1).max(12),
		year: z.number().int().min(2020),
	}))
	.handler(async ({ input, context }) => {
		if (!context.session?.user) {
			throw new Error("Unauthorized");
		}

		const currentUser = context.session.user;
		
		// Build where conditions with role-based filtering
		let whereConditions = [
			eq(monthlyGoals.month, input.month),
			eq(monthlyGoals.year, input.year)
		];

		// Apply role-based filtering
		if (currentUser.role === "department_manager") {
			whereConditions.push(eq(departments.managerId, currentUser.id));
		} else if (currentUser.role === "area_lead") {
			whereConditions.push(eq(areas.leadId, currentUser.id));
		}

		// Execute query with combined conditions
		return await db
			.select({
				id: monthlyGoals.id,
				month: monthlyGoals.month,
				year: monthlyGoals.year,
				targetValue: monthlyGoals.targetValue,
				achievedValue: monthlyGoals.achievedValue,
				description: monthlyGoals.description,
				status: monthlyGoals.status,
				// Goal template info
				goalTemplateName: goalTemplates.name,
				goalTemplateUnit: goalTemplates.unit,
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
			.leftJoin(departments, eq(areas.departmentId, departments.id))
			.where(and(...whereConditions));
	});

// Submit goals for a presentation
export const submitGoalsForPresentation = protectedProcedure
	.input(BulkSubmitGoalsSchema)
	.handler(async ({ input, context }) => {
		if (!context.session?.user) {
			throw new Error("Unauthorized");
		}

		const goalSubmissionValues = input.submissions.map(submission => ({
			...submission,
			presentationId: input.presentationId,
			submittedBy: context.session.user.id,
		}));

		const newSubmissions = await db
			.insert(goalSubmissions)
			.values(goalSubmissionValues)
			.returning();

		// Update the monthly goals with the submitted values
		for (const submission of input.submissions) {
			await db
				.update(monthlyGoals)
				.set({ 
					achievedValue: submission.submittedValue,
					status: "completed",
				})
				.where(eq(monthlyGoals.id, submission.monthlyGoalId));
		}
		
		return newSubmissions;
	});

// Get goal submissions for a presentation
export const getPresentationSubmissions = protectedProcedure
	.input(z.object({ presentationId: z.string().uuid() }))
	.handler(async ({ input }) => {
		return await db
			.select({
				id: goalSubmissions.id,
				submittedValue: goalSubmissions.submittedValue,
				submittedBy: goalSubmissions.submittedBy,
				submittedAt: goalSubmissions.submittedAt,
				notes: goalSubmissions.notes,
				// Monthly goal info
				goalId: monthlyGoals.id,
				targetValue: monthlyGoals.targetValue,
				goalDescription: monthlyGoals.description,
				// Goal template info
				goalTemplateName: goalTemplates.name,
				goalTemplateUnit: goalTemplates.unit,
				// User info
				userName: user.name,
				userEmail: user.email,
				areaName: areas.name,
				departmentName: departments.name,
			})
			.from(goalSubmissions)
			.leftJoin(monthlyGoals, eq(goalSubmissions.monthlyGoalId, monthlyGoals.id))
			.leftJoin(goalTemplates, eq(monthlyGoals.goalTemplateId, goalTemplates.id))
			.leftJoin(teamMembers, eq(monthlyGoals.teamMemberId, teamMembers.id))
			.leftJoin(user, eq(teamMembers.userId, user.id))
			.leftJoin(areas, eq(teamMembers.areaId, areas.id))
			.leftJoin(departments, eq(areas.departmentId, departments.id))
			.where(eq(goalSubmissions.presentationId, input.presentationId));
	});