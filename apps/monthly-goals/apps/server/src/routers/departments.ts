import { protectedProcedure } from "../lib/orpc";
import { db } from "../db";
import { departments } from "../db/schema/departments";
import { eq } from "drizzle-orm";
import * as z from "zod";
import { ORPCError } from "@orpc/server";

const DepartmentSchema = z.object({
	id: z.string().uuid(),
	name: z.string().min(1, "Name is required"),
	description: z.string().optional(),
	managerId: z.string().optional(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

const CreateDepartmentSchema = DepartmentSchema.omit({
	id: true,
	createdAt: true,
	updatedAt: true,
});

const UpdateDepartmentSchema = CreateDepartmentSchema.partial();

export const listDepartments = protectedProcedure.handler(async () => {
	return await db.select().from(departments);
});

export const getDepartment = protectedProcedure
	.input(z.object({ id: z.string().uuid() }))
	.handler(async ({ input }) => {
		const department = await db
			.select()
			.from(departments)
			.where(eq(departments.id, input.id))
			.limit(1);
		
		if (!department[0]) {
			throw new ORPCError("NOT_FOUND", { message: "Department not found" });
		}
		
		return department[0];
	});

export const createDepartment = protectedProcedure
	.input(CreateDepartmentSchema)
	.handler(async ({ input }) => {
		const [newDepartment] = await db
			.insert(departments)
			.values({
				...input,
			})
			.returning();
		
		return newDepartment;
	});

export const updateDepartment = protectedProcedure
	.input(
		z.object({
			id: z.string().uuid(),
			data: UpdateDepartmentSchema,
		})
	)
	.handler(async ({ input }) => {
		const [updatedDepartment] = await db
			.update(departments)
			.set(input.data)
			.where(eq(departments.id, input.id))
			.returning();
		
		if (!updatedDepartment) {
			throw new ORPCError("NOT_FOUND", { message: "Department not found" });
		}
		
		return updatedDepartment;
	});

export const deleteDepartment = protectedProcedure
	.input(z.object({ id: z.string().uuid() }))
	.handler(async ({ input }) => {
		const [deletedDepartment] = await db
			.delete(departments)
			.where(eq(departments.id, input.id))
			.returning();
		
		if (!deletedDepartment) {
			throw new ORPCError("NOT_FOUND", { message: "Department not found" });
		}
		
		return { success: true };
	});