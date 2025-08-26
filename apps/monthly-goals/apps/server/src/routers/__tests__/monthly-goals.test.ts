import { describe, expect, test, beforeEach, afterEach } from "bun:test";
// Load test environment variables
import dotenv from "dotenv";
dotenv.config({ path: ".env.test" });

import { db } from "../../db";
import { monthlyGoals } from "../../db/schema/monthly-goals";
import { goalTemplates } from "../../db/schema/goal-templates";
import { teamMembers } from "../../db/schema/team-members";
import { areas } from "../../db/schema/areas";
import { departments } from "../../db/schema/departments";
import { user } from "../../db/schema/auth";
import { 
	listMonthlyGoals,
	getMyGoals,
	createMonthlyGoal,
	updateMonthlyGoal,
	calculateGoalProgress,
} from "../monthly-goals";

// Mock users with different roles
const superAdminId = crypto.randomUUID();
const departmentManagerId = crypto.randomUUID();
const areaLeadId = crypto.randomUUID();
const employeeId = crypto.randomUUID();

const mockUsers = {
	superAdmin: {
		session: {
			user: {
				id: superAdminId,
				email: "admin@test.com",
				name: "Super Admin",
				role: "super_admin" as const,
			},
			session: { id: crypto.randomUUID(), userId: superAdminId, expiresAt: new Date(), createdAt: new Date(), updatedAt: new Date() }
		}
	},
	departmentManager: {
		session: {
			user: {
				id: departmentManagerId,
				email: "dept.manager@test.com", 
				name: "Department Manager",
				role: "department_manager" as const,
			},
			session: { id: crypto.randomUUID(), userId: departmentManagerId, expiresAt: new Date(), createdAt: new Date(), updatedAt: new Date() }
		}
	},
	areaLead: {
		session: {
			user: {
				id: areaLeadId,
				email: "area.lead@test.com",
				name: "Area Lead", 
				role: "area_lead" as const,
			},
			session: { id: crypto.randomUUID(), userId: areaLeadId, expiresAt: new Date(), createdAt: new Date(), updatedAt: new Date() }
		}
	},
	employee: {
		session: {
			user: {
				id: employeeId,
				email: "employee@test.com",
				name: "Employee",
				role: "employee" as const,
			},
			session: { id: crypto.randomUUID(), userId: employeeId, expiresAt: new Date(), createdAt: new Date(), updatedAt: new Date() }
		}
	}
};

describe("Monthly Goals Procedures", () => {
	let testDepartmentId: string;
	let testAreaId: string;
	let testTeamMemberId: string;
	let testGoalTemplateId: string;

	beforeEach(async () => {
		// Clean all related tables
		await db.delete(monthlyGoals);
		await db.delete(teamMembers);
		await db.delete(areas);
		await db.delete(departments);
		await db.delete(goalTemplates);
		await db.delete(user);

		// Create test users
		await db.insert(user).values([
			{
				id: superAdminId,
				name: "Super Admin",
				email: "admin@test.com",
				emailVerified: true,
				role: "super_admin",
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			{
				id: departmentManagerId,
				name: "Department Manager",
				email: "dept.manager@test.com",
				emailVerified: true,
				role: "department_manager",
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			{
				id: areaLeadId,
				name: "Area Lead",
				email: "area.lead@test.com",
				emailVerified: true,
				role: "area_lead",
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			{
				id: employeeId,
				name: "Employee",
				email: "employee@test.com",
				emailVerified: true,
				role: "employee",
				createdAt: new Date(),
				updatedAt: new Date(),
			}
		]);

		// Create organizational structure
		const [dept] = await db.insert(departments).values({
			name: "Test Department",
			description: "Test Department Description",
			managerId: departmentManagerId,
		}).returning();
		testDepartmentId = dept.id;

		const [area] = await db.insert(areas).values({
			name: "Test Area",
			description: "Test Area Description", 
			departmentId: testDepartmentId,
			leadId: areaLeadId,
		}).returning();
		testAreaId = area.id;

		const [teamMember] = await db.insert(teamMembers).values({
			userId: employeeId,
			areaId: testAreaId,
			position: "Test Position",
		}).returning();
		testTeamMemberId = teamMember.id;

		const [goalTemplate] = await db.insert(goalTemplates).values({
			name: "Test Goal Template",
			description: "Test Goal Description",
			unit: "sales",
			defaultTarget: "100",
			successThreshold: "80",
			warningThreshold: "50",
		}).returning();
		testGoalTemplateId = goalTemplate.id;
	});

	afterEach(async () => {
		// Cleanup
		await db.delete(monthlyGoals);
		await db.delete(teamMembers);
		await db.delete(areas);
		await db.delete(departments);
		await db.delete(goalTemplates);
		await db.delete(user);
	});

	describe("Role-based filtering", () => {
		test("super admin should see all goals", async () => {
			// Create a monthly goal
			await db.insert(monthlyGoals).values({
				teamMemberId: testTeamMemberId,
				goalTemplateId: testGoalTemplateId,
				month: 8,
				year: 2025,
				targetValue: "100",
				achievedValue: "75",
			});

			const callable = getMyGoals.callable({ context: mockUsers.superAdmin });
			const result = await callable({ month: 8, year: 2025 });
			
			expect(result).toHaveLength(1);
			expect(result[0].userName).toBe("Employee");
		});

		test("department manager should see goals from their department", async () => {
			// Create a monthly goal
			await db.insert(monthlyGoals).values({
				teamMemberId: testTeamMemberId,
				goalTemplateId: testGoalTemplateId,
				month: 8,
				year: 2025,
				targetValue: "100",
				achievedValue: "75",
			});

			const callable = getMyGoals.callable({ context: mockUsers.departmentManager });
			const result = await callable({ month: 8, year: 2025 });
			
			expect(result).toHaveLength(1);
			expect(result[0].departmentName).toBe("Test Department");
		});

		test("area lead should see goals only from their area", async () => {
			// Create a monthly goal
			await db.insert(monthlyGoals).values({
				teamMemberId: testTeamMemberId,
				goalTemplateId: testGoalTemplateId,
				month: 8,
				year: 2025,
				targetValue: "100",
				achievedValue: "75",
			});

			const callable = getMyGoals.callable({ context: mockUsers.areaLead });
			const result = await callable({ month: 8, year: 2025 });
			
			expect(result).toHaveLength(1);
			expect(result[0].areaName).toBe("Test Area");
		});

		test("employee should see only their own goals", async () => {
			// Create a monthly goal for the employee
			await db.insert(monthlyGoals).values({
				teamMemberId: testTeamMemberId,
				goalTemplateId: testGoalTemplateId,
				month: 8,
				year: 2025,
				targetValue: "100",
				achievedValue: "75",
			});

			const callable = getMyGoals.callable({ context: mockUsers.employee });
			const result = await callable({ month: 8, year: 2025 });
			
			expect(result).toHaveLength(1);
			expect(result[0].userEmail).toBe("employee@test.com");
		});
	});

	describe("calculateGoalProgress", () => {
		test("should calculate progress percentage correctly", async () => {
			// Create a monthly goal
			const [goal] = await db.insert(monthlyGoals).values({
				teamMemberId: testTeamMemberId,
				goalTemplateId: testGoalTemplateId,
				month: 8,
				year: 2025,
				targetValue: "100",
				achievedValue: "75", // 75% achievement
			}).returning();

			const callable = calculateGoalProgress.callable({ context: mockUsers.superAdmin });
			const result = await callable({ id: goal.id });
			
			expect(result.percentage).toBe(75);
			expect(result.status).toBe("warning"); // 75% is between 50-80%
			expect(result.color).toBe("yellow");
			expect(result.target).toBe(100);
			expect(result.achieved).toBe(75);
		});

		test("should return success status for goals above success threshold", async () => {
			// Create a monthly goal with 90% achievement
			const [goal] = await db.insert(monthlyGoals).values({
				teamMemberId: testTeamMemberId,
				goalTemplateId: testGoalTemplateId,
				month: 8,
				year: 2025,
				targetValue: "100",
				achievedValue: "90", // 90% achievement
			}).returning();

			const callable = calculateGoalProgress.callable({ context: mockUsers.superAdmin });
			const result = await callable({ id: goal.id });
			
			expect(result.percentage).toBe(90);
			expect(result.status).toBe("success");
			expect(result.color).toBe("green");
		});

		test("should return danger status for goals below warning threshold", async () => {
			// Create a monthly goal with 30% achievement
			const [goal] = await db.insert(monthlyGoals).values({
				teamMemberId: testTeamMemberId,
				goalTemplateId: testGoalTemplateId,
				month: 8,
				year: 2025,
				targetValue: "100",
				achievedValue: "30", // 30% achievement
			}).returning();

			const callable = calculateGoalProgress.callable({ context: mockUsers.superAdmin });
			const result = await callable({ id: goal.id });
			
			expect(result.percentage).toBe(30);
			expect(result.status).toBe("danger");
			expect(result.color).toBe("red");
		});
	});

	describe("updateMonthlyGoal", () => {
		test("should update achieved value and status", async () => {
			// Create a monthly goal
			const [goal] = await db.insert(monthlyGoals).values({
				teamMemberId: testTeamMemberId,
				goalTemplateId: testGoalTemplateId,
				month: 8,
				year: 2025,
				targetValue: "100",
				achievedValue: "50",
				status: "in_progress",
			}).returning();

			const callable = updateMonthlyGoal.callable({ context: mockUsers.employee });
			const result = await callable({
				id: goal.id,
				data: {
					achievedValue: "85",
					status: "completed" as const,
					description: "Goal completed successfully"
				}
			});
			
			expect(result.achievedValue).toBe("85.00");
			expect(result.status).toBe("completed");
			expect(result.description).toBe("Goal completed successfully");
		});
	});
});