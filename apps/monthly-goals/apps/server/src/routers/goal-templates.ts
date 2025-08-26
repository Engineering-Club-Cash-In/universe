import { protectedProcedure } from "../lib/orpc";
import { db } from "../db";
import { goalTemplates } from "../db/schema/goal-templates";
import { eq } from "drizzle-orm";
import * as z from "zod";

const GoalTemplateSchema = z.object({
	id: z.string().uuid(),
	name: z.string().min(1, "Name is required"),
	description: z.string().optional(),
	defaultTarget: z.string().optional(),
	unit: z.string().optional(),
	successThreshold: z.string(),
	warningThreshold: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

const CreateGoalTemplateSchema = GoalTemplateSchema.omit({
	id: true,
	createdAt: true,
	updatedAt: true,
});

const UpdateGoalTemplateSchema = CreateGoalTemplateSchema.partial();

export const listGoalTemplates = protectedProcedure.handler(async () => {
	return await db.select().from(goalTemplates);
});

export const getGoalTemplate = protectedProcedure
	.input(z.object({ id: z.string().uuid() }))
	.handler(async ({ input }) => {
		const goalTemplate = await db
			.select()
			.from(goalTemplates)
			.where(eq(goalTemplates.id, input.id))
			.limit(1);
		
		if (!goalTemplate[0]) {
			throw new Error("Goal template not found");
		}
		
		return goalTemplate[0];
	});

export const createGoalTemplate = protectedProcedure
	.input(CreateGoalTemplateSchema)
	.handler(async ({ input }) => {
		const [newGoalTemplate] = await db
			.insert(goalTemplates)
			.values({
				...input,
			})
			.returning();
		
		return newGoalTemplate;
	});

export const updateGoalTemplate = protectedProcedure
	.input(
		z.object({
			id: z.string().uuid(),
			data: UpdateGoalTemplateSchema,
		})
	)
	.handler(async ({ input }) => {
		const [updatedGoalTemplate] = await db
			.update(goalTemplates)
			.set(input.data)
			.where(eq(goalTemplates.id, input.id))
			.returning();
		
		if (!updatedGoalTemplate) {
			throw new Error("Goal template not found");
		}
		
		return updatedGoalTemplate;
	});

export const deleteGoalTemplate = protectedProcedure
	.input(z.object({ id: z.string().uuid() }))
	.handler(async ({ input }) => {
		const [deletedGoalTemplate] = await db
			.delete(goalTemplates)
			.where(eq(goalTemplates.id, input.id))
			.returning();
		
		if (!deletedGoalTemplate) {
			throw new Error("Goal template not found");
		}
		
		return { success: true };
	});