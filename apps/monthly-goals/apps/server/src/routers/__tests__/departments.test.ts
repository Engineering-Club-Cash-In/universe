import { describe, expect, test, beforeEach, afterEach } from "bun:test";
// Load test environment variables
import dotenv from "dotenv";
dotenv.config({ path: ".env.test" });

import { db } from "../../db";
import { departments } from "../../db/schema/departments";
import { user } from "../../db/schema/auth";
import { 
	listDepartments, 
	createDepartment, 
	getDepartment, 
	updateDepartment, 
	deleteDepartment 
} from "../departments";
import { createMockContext } from "../../__tests__/test-helpers";

const mockUserId = crypto.randomUUID();
const mockContext = createMockContext("super_admin", mockUserId);

describe("Departments Procedures", () => {
	beforeEach(async () => {
		// Clean departments table before each test
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
	});

	afterEach(async () => {
		// Cleanup after each test
		await db.delete(departments);
		await db.delete(user);
	});

	describe("listDepartments", () => {
		test("should return empty array when no departments exist", async () => {
			const callable = listDepartments.callable({ context: mockContext });
			const result = await callable();
			
			expect(result).toEqual([]);
		});

		test("should return list of departments", async () => {
			// Create test department
			await db.insert(departments).values({
				name: "Test Department",
				description: "Test Description",
			});

			const callable = listDepartments.callable({ context: mockContext });
			const result = await callable();
			
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("Test Department");
			expect(result[0].description).toBe("Test Description");
		});
	});

	describe("createDepartment", () => {
		test("should create department with valid data", async () => {
			const input = {
				name: "New Department",
				description: "New Description",
				managerId: mockUserId,
			};

			const callable = createDepartment.callable({ context: mockContext });
			const result = await callable(input);
			
			expect(result.name).toBe(input.name);
			expect(result.description).toBe(input.description);
			expect(result.managerId).toBe(input.managerId);
			expect(result.id).toBeDefined();
		});

		test("should create department without manager", async () => {
			const input = {
				name: "Department No Manager",
				description: "No manager assigned",
			};

			const callable = createDepartment.callable({ context: mockContext });
			const result = await callable(input);
			
			expect(result.name).toBe(input.name);
			expect(result.managerId).toBeNull();
		});
	});

	describe("getDepartment", () => {
		test("should return department by id", async () => {
			// Create test department
			const [dept] = await db.insert(departments).values({
				name: "Test Department",
				description: "Test Description",
			}).returning();

			const callable = getDepartment.callable({ context: mockContext });
			const result = await callable({ id: dept.id });
			
			expect(result.id).toBe(dept.id);
			expect(result.name).toBe("Test Department");
		});

		test("should throw error for non-existent department", async () => {
			const callable = getDepartment.callable({ context: mockContext });
			
			try {
				await callable({ id: crypto.randomUUID() });
				expect(true).toBe(false); // Should not reach here
			} catch (error) {
				expect((error as Error).message).toBe("Department not found");
			}
		});
	});

	describe("updateDepartment", () => {
		test("should update department data", async () => {
			// Create test department
			const [dept] = await db.insert(departments).values({
				name: "Original Name",
				description: "Original Description",
			}).returning();

			const input = {
				id: dept.id,
				data: {
					name: "Updated Name",
					description: "Updated Description",
				}
			};

			const callable = updateDepartment.callable({ context: mockContext });
			const result = await callable(input);
			
			expect(result.name).toBe("Updated Name");
			expect(result.description).toBe("Updated Description");
		});
	});

	describe("deleteDepartment", () => {
		test("should delete department", async () => {
			// Create test department
			const [dept] = await db.insert(departments).values({
				name: "To Delete",
				description: "Will be deleted",
			}).returning();

			const callable = deleteDepartment.callable({ context: mockContext });
			const result = await callable({ id: dept.id });
			
			expect(result.success).toBe(true);

			// Verify department is deleted
			const remaining = await db.select().from(departments);
			expect(remaining).toHaveLength(0);
		});
	});
});