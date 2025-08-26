import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import dotenv from "dotenv";
dotenv.config({ path: ".env.test" });

import { db } from "../../db";
import { goalTemplates } from "../../db/schema/goal-templates";
import { user } from "../../db/schema/auth";
import { 
	listGoalTemplates, 
	createGoalTemplate, 
	getGoalTemplate, 
	updateGoalTemplate, 
	deleteGoalTemplate 
} from "../goal-templates";

const mockUserId = crypto.randomUUID();
const mockContext = {
	session: {
		user: {
			id: mockUserId,
			email: "admin@company.com",
			name: "Admin User",
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

describe("Goal Templates Procedures", () => {
	beforeEach(async () => {
		await db.delete(goalTemplates);
		await db.delete(user);
		
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
		await db.delete(goalTemplates);
		await db.delete(user);
	});

	describe("createGoalTemplate", () => {
		test("should create goal template with custom thresholds", async () => {
			const input = {
				name: "Sales Target",
				description: "Monthly sales goal",
				unit: "sales",
				defaultTarget: "100",
				successThreshold: "90",
				warningThreshold: "60",
			};

			const callable = createGoalTemplate.callable({ context: mockContext });
			const result = await callable(input);
			
			expect(result.name).toBe(input.name);
			expect(result.description).toBe(input.description);
			expect(result.unit).toBe(input.unit);
			expect(result.defaultTarget).toBe("100.00");
			expect(result.successThreshold).toBe("90.00");
			expect(result.warningThreshold).toBe("60.00");
		});

		test("should create goal template with default thresholds", async () => {
			const input = {
				name: "Simple Goal",
				description: "Basic goal template",
			};

			const callable = createGoalTemplate.callable({ context: mockContext });
			const result = await callable(input);
			
			expect(result.name).toBe(input.name);
			expect(result.successThreshold).toBe("80.00"); // Default
			expect(result.warningThreshold).toBe("50.00"); // Default
		});
	});

	describe("listGoalTemplates", () => {
		test("should return all goal templates", async () => {
			await db.insert(goalTemplates).values([
				{
					name: "Template 1",
					description: "First template",
					unit: "tasks",
				},
				{
					name: "Template 2", 
					description: "Second template",
					unit: "sales",
				}
			]);

			const callable = listGoalTemplates.callable({ context: mockContext });
			const result = await callable();
			
			expect(result).toHaveLength(2);
			expect(result[0].name).toBe("Template 1");
			expect(result[1].name).toBe("Template 2");
		});
	});

	describe("updateGoalTemplate", () => {
		test("should update template thresholds", async () => {
			const [template] = await db.insert(goalTemplates).values({
				name: "Original Template",
				description: "Original description",
				successThreshold: "80",
				warningThreshold: "50",
			}).returning();

			const callable = updateGoalTemplate.callable({ context: mockContext });
			const result = await callable({
				id: template.id,
				data: {
					name: "Updated Template",
					successThreshold: "85",
					warningThreshold: "60",
				}
			});
			
			expect(result.name).toBe("Updated Template");
			expect(result.successThreshold).toBe("85.00");
			expect(result.warningThreshold).toBe("60.00");
		});
	});

	describe("deleteGoalTemplate", () => {
		test("should delete goal template", async () => {
			const [template] = await db.insert(goalTemplates).values({
				name: "To Delete",
				description: "Will be deleted",
			}).returning();

			const callable = deleteGoalTemplate.callable({ context: mockContext });
			const result = await callable({ id: template.id });
			
			expect(result.success).toBe(true);

			const remaining = await db.select().from(goalTemplates);
			expect(remaining).toHaveLength(0);
		});
	});
});