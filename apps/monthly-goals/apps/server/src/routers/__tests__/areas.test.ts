import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import dotenv from "dotenv";
dotenv.config({ path: ".env.test" });

import { db } from "../../db";
import { areas } from "../../db/schema/areas";
import { departments } from "../../db/schema/departments";
import { user } from "../../db/schema/auth";
import { 
	listAreas, 
	createArea, 
	getArea, 
	updateArea, 
	deleteArea 
} from "../areas";

const mockUserId = crypto.randomUUID();
const mockContext = {
	session: {
		user: {
			id: mockUserId,
			email: "test@company.com",
			name: "Test User",
			role: "super_admin" as const,
		},
		session: {
			id: crypto.randomUUID(),
			userId: mockUserId,
			expiresAt: new Date(),
			createdAt: new Date(),
			updatedAt: new Date(),
		}
	}
};

describe("Areas Procedures", () => {
	let testDepartmentId: string;

	beforeEach(async () => {
		await db.delete(areas);
		await db.delete(departments);
		await db.delete(user);
		
		// Create test user
		await db.insert(user).values({
			id: mockUserId,
			name: mockContext.session.user.name,
			email: mockContext.session.user.email,
			emailVerified: true,
			role: mockContext.session.user.role,
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		// Create test department
		const [dept] = await db.insert(departments).values({
			name: "Test Department",
			description: "Test Description",
			managerId: mockUserId,
		}).returning();
		testDepartmentId = dept.id;
	});

	afterEach(async () => {
		await db.delete(areas);
		await db.delete(departments);
		await db.delete(user);
	});

	describe("createArea", () => {
		test("should create area with valid data", async () => {
			const input = {
				name: "New Area",
				description: "New Area Description",
				departmentId: testDepartmentId,
				leadId: mockUserId,
			};

			const callable = createArea.callable({ context: mockContext });
			const result = await callable(input);
			
			expect(result.name).toBe(input.name);
			expect(result.description).toBe(input.description);
			expect(result.departmentId).toBe(input.departmentId);
			expect(result.leadId).toBe(input.leadId);
		});

		test("should create area without lead", async () => {
			const input = {
				name: "Area No Lead",
				description: "Area without lead",
				departmentId: testDepartmentId,
			};

			const callable = createArea.callable({ context: mockContext });
			const result = await callable(input);
			
			expect(result.name).toBe(input.name);
			expect(result.leadId).toBeNull();
		});
	});

	describe("listAreas", () => {
		test("should return areas with department information", async () => {
			await db.insert(areas).values({
				name: "Test Area",
				description: "Test Description",
				departmentId: testDepartmentId,
			});

			const callable = listAreas.callable({ context: mockContext });
			const result = await callable();
			
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("Test Area");
			expect(result[0].departmentName).toBe("Test Department");
		});
	});

	describe("updateArea", () => {
		test("should update area data", async () => {
			const [area] = await db.insert(areas).values({
				name: "Original Area",
				description: "Original Description",
				departmentId: testDepartmentId,
			}).returning();

			const callable = updateArea.callable({ context: mockContext });
			const result = await callable({
				id: area.id,
				data: {
					name: "Updated Area",
					description: "Updated Description",
				}
			});
			
			expect(result.name).toBe("Updated Area");
			expect(result.description).toBe("Updated Description");
		});
	});

	describe("deleteArea", () => {
		test("should delete area", async () => {
			const [area] = await db.insert(areas).values({
				name: "To Delete",
				description: "Will be deleted",
				departmentId: testDepartmentId,
			}).returning();

			const callable = deleteArea.callable({ context: mockContext });
			const result = await callable({ id: area.id });
			
			expect(result.success).toBe(true);

			const remaining = await db.select().from(areas);
			expect(remaining).toHaveLength(0);
		});
	});
});