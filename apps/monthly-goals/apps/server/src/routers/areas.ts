import { protectedProcedure } from "../lib/orpc";
import { db } from "../db";
import { areas } from "../db/schema/areas";
import { departments } from "../db/schema/departments";
import { eq } from "drizzle-orm";
import * as z from "zod";

const AreaSchema = z.object({
	id: z.string().uuid(),
	name: z.string().min(1, "Name is required"),
	description: z.string().optional(),
	departmentId: z.string().uuid(),
	leadId: z.string().uuid().optional(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

const CreateAreaSchema = AreaSchema.omit({
	id: true,
	createdAt: true,
	updatedAt: true,
});

const UpdateAreaSchema = CreateAreaSchema.partial().omit({ departmentId: true });

export const listAreas = protectedProcedure.handler(async () => {
	return await db
		.select({
			id: areas.id,
			name: areas.name,
			description: areas.description,
			departmentId: areas.departmentId,
			leadId: areas.leadId,
			createdAt: areas.createdAt,
			updatedAt: areas.updatedAt,
			departmentName: departments.name,
		})
		.from(areas)
		.leftJoin(departments, eq(areas.departmentId, departments.id));
});

export const getArea = protectedProcedure
	.input(z.object({ id: z.string().uuid() }))
	.handler(async ({ input }) => {
		const area = await db
			.select({
				id: areas.id,
				name: areas.name,
				description: areas.description,
				departmentId: areas.departmentId,
				leadId: areas.leadId,
				createdAt: areas.createdAt,
				updatedAt: areas.updatedAt,
				departmentName: departments.name,
			})
			.from(areas)
			.leftJoin(departments, eq(areas.departmentId, departments.id))
			.where(eq(areas.id, input.id))
			.limit(1);
		
		if (!area[0]) {
			throw new Error("Area not found");
		}
		
		return area[0];
	});

export const createArea = protectedProcedure
	.input(CreateAreaSchema)
	.handler(async ({ input }) => {
		const [newArea] = await db
			.insert(areas)
			.values({
				...input,
			})
			.returning();
		
		return newArea;
	});

export const updateArea = protectedProcedure
	.input(
		z.object({
			id: z.string().uuid(),
			data: UpdateAreaSchema,
		})
	)
	.handler(async ({ input }) => {
		const [updatedArea] = await db
			.update(areas)
			.set(input.data)
			.where(eq(areas.id, input.id))
			.returning();
		
		if (!updatedArea) {
			throw new Error("Area not found");
		}
		
		return updatedArea;
	});

export const deleteArea = protectedProcedure
	.input(z.object({ id: z.string().uuid() }))
	.handler(async ({ input }) => {
		const [deletedArea] = await db
			.delete(areas)
			.where(eq(areas.id, input.id))
			.returning();
		
		if (!deletedArea) {
			throw new Error("Area not found");
		}
		
		return { success: true };
	});