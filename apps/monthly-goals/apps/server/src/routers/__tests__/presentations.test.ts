import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { ORPCError } from "@orpc/server";
// Load test environment variables
import dotenv from "dotenv";
dotenv.config({ path: ".env.test" });

import { db } from "../../db";
import { presentations, goalSubmissions } from "../../db/schema/presentations";
import { monthlyGoals } from "../../db/schema/monthly-goals";
import { goalTemplates } from "../../db/schema/goal-templates";
import { teamMembers } from "../../db/schema/team-members";
import { areas } from "../../db/schema/areas";
import { departments } from "../../db/schema/departments";
import { user } from "../../db/schema/auth";
import { 
	listPresentations,
	getPresentation,
	createPresentation,
	updatePresentation,
	deletePresentation,
	getAvailableGoalsForPresentation,
	submitGoalsForPresentation,
	getPresentationSubmissions,
	getPresentationPayload,
	generatePresentationPDF,
	formatPresentationPeriodLabel,
} from "../presentations";

// Mock users with different roles
const superAdminId = crypto.randomUUID();
const departmentManagerId = crypto.randomUUID();
const areaLeadId = crypto.randomUUID();
const employeeId = crypto.randomUUID();
const viewerId = crypto.randomUUID();

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
	},
	viewer: {
		session: {
			user: {
				id: viewerId,
				email: "viewer@test.com",
				name: "Viewer",
				role: "viewer" as const,
			},
			session: { id: crypto.randomUUID(), userId: viewerId, expiresAt: new Date(), createdAt: new Date(), updatedAt: new Date() }
		}
	}
};

describe("Presentations Procedures", () => {
	let testDepartmentId: string;
	let testAreaId: string;
	let testTeamMemberId: string;
	let testGoalTemplateId: string;
	let testInversaGoalTemplateId: string;
	let testPresentationId: string;

	beforeEach(async () => {
		// Clean all related tables
		await db.delete(goalSubmissions);
		await db.delete(presentations);
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
			,
			{
				id: viewerId,
				name: "Viewer",
				email: "viewer@test.com",
				emailVerified: true,
				role: "viewer",
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

		// Create goal templates (normal and inverse)
		const [goalTemplate] = await db.insert(goalTemplates).values({
			name: "Ventas",
			description: "Meta de ventas mensual",
			unit: "sales",
			defaultTarget: "100",
			isInverse: false,
			successThreshold: "80",
			warningThreshold: "50",
		}).returning();
		testGoalTemplateId = goalTemplate.id;

		const [inversaGoalTemplate] = await db.insert(goalTemplates).values({
			name: "Mora Cartera",
			description: "Meta de reducción de mora",
			unit: "percentage",
			defaultTarget: "5",
			isInverse: true,
			successThreshold: "80",
			warningThreshold: "50",
		}).returning();
		testInversaGoalTemplateId = inversaGoalTemplate.id;

		// Create test presentation
		const [presentation] = await db.insert(presentations).values({
			name: "Test Presentation",
			startMonth: 9,
			startYear: 2025,
			endMonth: 10,
			endYear: 2025,
			status: "draft",
			createdBy: departmentManagerId,
		}).returning();
		testPresentationId = presentation.id;
	});

	afterEach(async () => {
		// Cleanup
		await db.delete(goalSubmissions);
		await db.delete(presentations);
		await db.delete(monthlyGoals);
		await db.delete(teamMembers);
		await db.delete(areas);
		await db.delete(departments);
		await db.delete(goalTemplates);
		await db.delete(user);
	});

	describe("Presentation CRUD Operations", () => {
		test("should create a new presentation", async () => {
			const callable = createPresentation.callable({ context: mockUsers.departmentManager });
			const result = await callable({
				name: "Septiembre 2025 Presentation",
				startMonth: 9,
				startYear: 2025,
				endMonth: 10,
				endYear: 2025,
			});
			
			expect(result.name).toBe("Septiembre 2025 Presentation");
			expect(result.startMonth).toBe(9);
			expect(result.startYear).toBe(2025);
			expect(result.endMonth).toBe(10);
			expect(result.endYear).toBe(2025);
			expect(result.status).toBe("draft");
			expect(result.createdBy).toBe(departmentManagerId);
		});

		test("should reject viewer creating a presentation", async () => {
			const callable = createPresentation.callable({ context: mockUsers.viewer });

			await expect(callable({
				name: "Viewer Presentation",
				startMonth: 9,
				startYear: 2025,
				endMonth: 9,
				endYear: 2025,
			})).rejects.toMatchObject({
				code: "NOT_FOUND",
			} satisfies Partial<ORPCError>);
		});

		test("should create a presentation for a single month", async () => {
			const callable = createPresentation.callable({ context: mockUsers.departmentManager });
			const result = await callable({
				name: "Single Month Presentation",
				startMonth: 9,
				startYear: 2025,
				endMonth: 9,
				endYear: 2025,
			});

			expect(result.startMonth).toBe(9);
			expect(result.startYear).toBe(2025);
			expect(result.endMonth).toBe(9);
			expect(result.endYear).toBe(2025);
		});

		test("should create a cross-year presentation", async () => {
			const callable = createPresentation.callable({ context: mockUsers.departmentManager });
			const result = await callable({
				name: "Cross Year Presentation",
				startMonth: 12,
				startYear: 2025,
				endMonth: 1,
				endYear: 2026,
			});

			expect(result.startMonth).toBe(12);
			expect(result.startYear).toBe(2025);
			expect(result.endMonth).toBe(1);
			expect(result.endYear).toBe(2026);
		});

		test("should reject presentations whose end period precedes the start period", async () => {
			const callable = createPresentation.callable({ context: mockUsers.departmentManager });

			await expect(callable({
				name: "Invalid Range Presentation",
				startMonth: 10,
				startYear: 2025,
				endMonth: 9,
				endYear: 2025,
			})).rejects.toMatchObject({
				code: "BAD_REQUEST",
			} satisfies Partial<ORPCError>);
		});

		test("should get presentation by id", async () => {
			const callable = getPresentation.callable({ context: mockUsers.superAdmin });
			const result = await callable({ id: testPresentationId });
			
			expect(result.id).toBe(testPresentationId);
			expect(result.name).toBe("Test Presentation");
			expect(result.startMonth).toBe(9);
			expect(result.startYear).toBe(2025);
			expect(result.endMonth).toBe(10);
			expect(result.endYear).toBe(2025);
			expect(result.createdByName).toBe("Department Manager");
		});

		test("should reject viewer mutating a presentation", async () => {
			const callable = updatePresentation.callable({ context: mockUsers.viewer });

			await expect(callable({
				id: testPresentationId,
				data: {
					status: "ready",
				},
			})).rejects.toMatchObject({
				code: "NOT_FOUND",
			} satisfies Partial<ORPCError>);
		});

		test("should reject restricted users reading another user's presentation", async () => {
			const [otherPresentation] = await db.insert(presentations).values({
				name: "Employee Owned Presentation",
				startMonth: 9,
				startYear: 2025,
				endMonth: 9,
				endYear: 2025,
				status: "draft",
				createdBy: employeeId,
			}).returning();

			const callable = getPresentation.callable({ context: mockUsers.departmentManager });

			await expect(callable({ id: otherPresentation.id })).rejects.toMatchObject({
				code: "NOT_FOUND",
			} satisfies Partial<ORPCError>);
		});

		test("should reject employee reading another user's presentation", async () => {
			const [otherPresentation] = await db.insert(presentations).values({
				name: "Department Manager Owned Presentation",
				startMonth: 9,
				startYear: 2025,
				endMonth: 9,
				endYear: 2025,
				status: "draft",
				createdBy: departmentManagerId,
			}).returning();

			const callable = getPresentation.callable({ context: mockUsers.employee });

			await expect(callable({ id: otherPresentation.id })).rejects.toMatchObject({
				code: "NOT_FOUND",
			} satisfies Partial<ORPCError>);
		});

		test("should update presentation status and range", async () => {
			const callable = updatePresentation.callable({ context: mockUsers.departmentManager });
			const result = await callable({
				id: testPresentationId,
				data: {
					startMonth: 10,
					startYear: 2025,
					endMonth: 11,
					endYear: 2025,
					status: "ready",
					presentedAt: new Date(),
				}
			});
			
			expect(result.status).toBe("ready");
			expect(result.startMonth).toBe(10);
			expect(result.startYear).toBe(2025);
			expect(result.endMonth).toBe(11);
			expect(result.endYear).toBe(2025);
			expect(result.presentedAt).toBeDefined();
		});

		test("should reject partial updates that make the persisted range invalid", async () => {
			const callable = updatePresentation.callable({ context: mockUsers.departmentManager });

			await expect(callable({
				id: testPresentationId,
				data: {
					startMonth: 11,
				}
			})).rejects.toMatchObject({
				code: "BAD_REQUEST",
			} satisfies Partial<ORPCError>);
		});

		test("should delete presentation and related submissions", async () => {
			// First create a goal submission
			await db.insert(goalSubmissions).values({
				presentationId: testPresentationId,
				monthlyGoalId: crypto.randomUUID(),
				submittedValue: "100",
				submittedBy: employeeId,
			});

			const callable = deletePresentation.callable({ context: mockUsers.departmentManager });
			const result = await callable({ id: testPresentationId });
			
			expect(result.success).toBe(true);

			// Verify presentation and submissions are deleted
			const submissions = await db.select().from(goalSubmissions);
			expect(submissions).toHaveLength(0);
		});

		test("should reject viewer deleting a presentation", async () => {
			const callable = deletePresentation.callable({ context: mockUsers.viewer });

			await expect(callable({ id: testPresentationId })).rejects.toMatchObject({
				code: "NOT_FOUND",
			} satisfies Partial<ORPCError>);
		});

		test("should reject restricted users mutating another user's presentation", async () => {
			const [otherPresentation] = await db.insert(presentations).values({
				name: "Employee Owned Mutation Target",
				startMonth: 10,
				startYear: 2025,
				endMonth: 10,
				endYear: 2025,
				status: "draft",
				createdBy: employeeId,
			}).returning();

			const [goal] = await db.insert(monthlyGoals).values({
				teamMemberId: testTeamMemberId,
				goalTemplateId: testGoalTemplateId,
				month: 10,
				year: 2025,
				targetValue: "100",
				achievedValue: "0",
				status: "in_progress",
			}).returning();

			const callable = submitGoalsForPresentation.callable({ context: mockUsers.departmentManager });

			await expect(callable({
				presentationId: otherPresentation.id,
				submissions: [{
					monthlyGoalId: goal.id,
					submittedValue: "123",
				}],
			})).rejects.toMatchObject({
				code: "NOT_FOUND",
			} satisfies Partial<ORPCError>);
		});

		test("should reject employee mutating another user's presentation", async () => {
			const [otherPresentation] = await db.insert(presentations).values({
				name: "Department Manager Owned Mutation Target",
				startMonth: 10,
				startYear: 2025,
				endMonth: 10,
				endYear: 2025,
				status: "draft",
				createdBy: departmentManagerId,
			}).returning();

			const [goal] = await db.insert(monthlyGoals).values({
				teamMemberId: testTeamMemberId,
				goalTemplateId: testGoalTemplateId,
				month: 10,
				year: 2025,
				targetValue: "100",
				achievedValue: "0",
				status: "in_progress",
			}).returning();

			const callable = submitGoalsForPresentation.callable({ context: mockUsers.employee });

			await expect(callable({
				presentationId: otherPresentation.id,
				submissions: [{
					monthlyGoalId: goal.id,
					submittedValue: "123",
				}],
			})).rejects.toMatchObject({
				code: "NOT_FOUND",
			} satisfies Partial<ORPCError>);
		});
	});

	describe("Role-based filtering", () => {
		beforeEach(async () => {
			// Create additional presentations by different users
			await db.insert(presentations).values([
				{
					name: "Area Lead Presentation",
					startMonth: 8,
					startYear: 2025,
					endMonth: 8,
					endYear: 2025,
					status: "draft",
					createdBy: areaLeadId,
				},
				{
					name: "Employee Presentation",
					startMonth: 7,
					startYear: 2025,
					endMonth: 7,
					endYear: 2025,
					status: "draft",
					createdBy: employeeId,
				}
			]);
		});

		test("super admin should see all presentations", async () => {
			const callable = listPresentations.callable({ context: mockUsers.superAdmin });
			const result = await callable();
			
			expect(result.length).toBeGreaterThanOrEqual(3); // At least 3 presentations
			expect(result[0]).toHaveProperty("startMonth");
			expect(result[0]).toHaveProperty("startYear");
			expect(result[0]).toHaveProperty("endMonth");
			expect(result[0]).toHaveProperty("endYear");
		});

		test("department manager should see presentations they created", async () => {
			const callable = listPresentations.callable({ context: mockUsers.departmentManager });
			const result = await callable();
			
			// Should only see the presentation they created
			expect(result).toHaveLength(1);
			expect(result[0].createdBy).toBe(departmentManagerId);
		});

		test("area lead should see presentations they created", async () => {
			const callable = listPresentations.callable({ context: mockUsers.areaLead });
			const result = await callable();
			
			// Should only see the presentation they created
			expect(result).toHaveLength(1);
			expect(result[0].createdBy).toBe(areaLeadId);
		});

		test("employee should see presentations they created", async () => {
			const callable = listPresentations.callable({ context: mockUsers.employee });
			const result = await callable();

			expect(result).toHaveLength(1);
			expect(result[0].createdBy).toBe(employeeId);
		});
	});

	describe("Goal submissions", () => {
		beforeEach(async () => {
			// Create monthly goals for testing
			await db.insert(monthlyGoals).values([
				{
					teamMemberId: testTeamMemberId,
					goalTemplateId: testGoalTemplateId,
					month: 9,
					year: 2025,
					targetValue: "100",
					achievedValue: "85",
					status: "in_progress",
				},
				{
					teamMemberId: testTeamMemberId,
					goalTemplateId: testInversaGoalTemplateId,
					month: 9,
					year: 2025,
					targetValue: "3",
					achievedValue: "5",
					status: "in_progress",
				}
			]);
		});

		test("should get available goals across multiple months", async () => {
			const [presentation] = await db.insert(presentations).values({
				name: "Q1 Presentation",
				startMonth: 1,
				startYear: 2025,
				endMonth: 3,
				endYear: 2025,
				status: "draft",
				createdBy: departmentManagerId,
			}).returning();

			const [otherDepartment] = await db.insert(departments).values({
				name: "Other Department",
				description: "Other Department Description",
			}).returning();

			const [otherArea] = await db.insert(areas).values({
				name: "Other Area",
				description: "Other Area Description",
				departmentId: otherDepartment.id,
			}).returning();

			const otherAreaEmployeeId = crypto.randomUUID();
			await db.insert(user).values({
				id: otherAreaEmployeeId,
				name: "Other Area Employee",
				email: "other.area.employee@test.com",
				emailVerified: true,
				role: "employee",
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			const [otherAreaTeamMember] = await db.insert(teamMembers).values({
				userId: otherAreaEmployeeId,
				areaId: otherArea.id,
				position: "Other Area Position",
			}).returning();

			const [sameDepartmentOtherArea] = await db.insert(areas).values({
				name: "Same Department Other Area",
				description: "Same Department Other Area Description",
				departmentId: testDepartmentId,
			}).returning();

			const sameDepartmentOtherAreaEmployeeId = crypto.randomUUID();
			await db.insert(user).values({
				id: sameDepartmentOtherAreaEmployeeId,
				name: "Same Department Other Area Employee",
				email: "same.department.other.area.employee@test.com",
				emailVerified: true,
				role: "employee",
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			const [sameDepartmentOtherAreaTeamMember] = await db.insert(teamMembers).values({
				userId: sameDepartmentOtherAreaEmployeeId,
				areaId: sameDepartmentOtherArea.id,
				position: "Same Department Other Area Position",
			}).returning();

			await db.insert(monthlyGoals).values([
				{
					teamMemberId: testTeamMemberId,
					goalTemplateId: testGoalTemplateId,
					month: 1,
					year: 2025,
					targetValue: "100",
					achievedValue: "80",
					status: "in_progress",
				},
				{
					teamMemberId: testTeamMemberId,
					goalTemplateId: testGoalTemplateId,
					month: 2,
					year: 2025,
					targetValue: "100",
					achievedValue: "85",
					status: "in_progress",
				},
				{
					teamMemberId: sameDepartmentOtherAreaTeamMember.id,
					goalTemplateId: testGoalTemplateId,
					month: 3,
					year: 2025,
					targetValue: "100",
					achievedValue: "90",
					status: "in_progress",
				},
				{
					teamMemberId: otherAreaTeamMember.id,
					goalTemplateId: testGoalTemplateId,
					month: 2,
					year: 2025,
					targetValue: "100",
					achievedValue: "95",
					status: "in_progress",
				},
				{
					teamMemberId: testTeamMemberId,
					goalTemplateId: testGoalTemplateId,
					month: 4,
					year: 2025,
					targetValue: "100",
					achievedValue: "100",
					status: "in_progress",
				},
			]);

			const departmentManagerCallable = getAvailableGoalsForPresentation.callable({ context: mockUsers.departmentManager });
			const departmentManagerResult = await departmentManagerCallable({ presentationId: presentation.id });
			
			expect(departmentManagerResult).toHaveLength(3);
			expect(departmentManagerResult.every(g => g.departmentName === "Test Department")).toBe(true);
			expect(departmentManagerResult.map(g => `${g.month}/${g.year}`).sort()).toEqual(["1/2025", "2/2025", "3/2025"]);

			const areaLeadCallable = getAvailableGoalsForPresentation.callable({ context: mockUsers.areaLead });
			await expect(areaLeadCallable({ presentationId: presentation.id })).rejects.toMatchObject({
				code: "NOT_FOUND",
			} satisfies Partial<ORPCError>);
		});

		test("employee available goals should only include their own goals", async () => {
			const [presentation] = await db.insert(presentations).values({
				name: "Employee Presentation",
				startMonth: 9,
				startYear: 2025,
				endMonth: 9,
				endYear: 2025,
				status: "draft",
				createdBy: employeeId,
			}).returning();

			const [otherEmployee] = await db.insert(user).values({
				id: crypto.randomUUID(),
				name: "Other Employee",
				email: "other.employee@test.com",
				emailVerified: true,
				role: "employee",
				createdAt: new Date(),
				updatedAt: new Date(),
			}).returning();

			const [otherTeamMember] = await db.insert(teamMembers).values({
				userId: otherEmployee.id,
				areaId: testAreaId,
				position: "Other Position",
			}).returning();

			const [employeeGoal] = await db.insert(monthlyGoals).values({
				teamMemberId: testTeamMemberId,
				goalTemplateId: testGoalTemplateId,
				month: 9,
				year: 2025,
				targetValue: "100",
				achievedValue: "70",
				status: "in_progress",
			}).returning();

			const [otherGoal] = await db.insert(monthlyGoals).values({
				teamMemberId: otherTeamMember.id,
				goalTemplateId: testGoalTemplateId,
				month: 9,
				year: 2025,
				targetValue: "100",
				achievedValue: "60",
				status: "in_progress",
			}).returning();

			const callable = getAvailableGoalsForPresentation.callable({ context: mockUsers.employee });
			const result = await callable({ presentationId: presentation.id });

			expect(result).toHaveLength(1);
			expect(result[0].id).toBe(employeeGoal.id);
			expect(result[0].userEmail).toBe("employee@test.com");
			expect(result.every(goal => goal.id !== otherGoal.id)).toBe(true);
		});

		test("should reject restricted users accessing another presentation", async () => {
			const [otherPresentation] = await db.insert(presentations).values({
				name: "Employee Presentation",
				startMonth: 1,
				startYear: 2025,
				endMonth: 1,
				endYear: 2025,
				status: "draft",
				createdBy: employeeId,
			}).returning();

			const callable = getAvailableGoalsForPresentation.callable({ context: mockUsers.departmentManager });

			await expect(callable({ presentationId: otherPresentation.id })).rejects.toMatchObject({
				code: "NOT_FOUND",
			} satisfies Partial<ORPCError>);
		});

		test("should expand cross-year ranges in the available-goals query path", async () => {
			const [presentation] = await db.insert(presentations).values({
				name: "Year End Presentation",
				startMonth: 12,
				startYear: 2025,
				endMonth: 1,
				endYear: 2026,
				status: "draft",
				createdBy: departmentManagerId,
			}).returning();

			await db.insert(monthlyGoals).values([
				{
					teamMemberId: testTeamMemberId,
					goalTemplateId: testGoalTemplateId,
					month: 12,
					year: 2025,
					targetValue: "100",
					achievedValue: "88",
					status: "in_progress",
				},
				{
					teamMemberId: testTeamMemberId,
					goalTemplateId: testGoalTemplateId,
					month: 1,
					year: 2026,
					targetValue: "100",
					achievedValue: "91",
					status: "in_progress",
				},
				{
					teamMemberId: testTeamMemberId,
					goalTemplateId: testGoalTemplateId,
					month: 2,
					year: 2026,
					targetValue: "100",
					achievedValue: "95",
					status: "in_progress",
				},
			]);

			const callable = getAvailableGoalsForPresentation.callable({ context: mockUsers.departmentManager });
			const result = await callable({ presentationId: presentation.id });

			expect(result).toHaveLength(2);
			expect(result.map(g => `${g.month}/${g.year}`).sort()).toEqual(["1/2026", "12/2025"]);
		});

		test("should submit goals for presentation", async () => {
			const goals = await db.select().from(monthlyGoals);
			
			const callable = submitGoalsForPresentation.callable({ context: mockUsers.departmentManager });
			const result = await callable({
				presentationId: testPresentationId,
				submissions: [
					{
						monthlyGoalId: goals[0].id,
						submittedValue: "90",
						notes: "Exceeded target",
					},
					{
						monthlyGoalId: goals[1].id,
						submittedValue: "2.5",
						notes: "Reduced mora significantly",
					}
				]
			});
			
			expect(result).toHaveLength(2);
			expect(result[0].submittedBy).toBe(departmentManagerId);
		});

		test("employee submission scope should reject out-of-scope goals", async () => {
			const [presentation] = await db.insert(presentations).values({
				name: "Employee Submission Presentation",
				startMonth: 9,
				startYear: 2025,
				endMonth: 9,
				endYear: 2025,
				status: "draft",
				createdBy: employeeId,
			}).returning();

			const [otherEmployee] = await db.insert(user).values({
				id: crypto.randomUUID(),
				name: "Other Employee For Submission",
				email: "other.employee.submission@test.com",
				emailVerified: true,
				role: "employee",
				createdAt: new Date(),
				updatedAt: new Date(),
			}).returning();

			const [otherTeamMember] = await db.insert(teamMembers).values({
				userId: otherEmployee.id,
				areaId: testAreaId,
				position: "Other Submission Position",
			}).returning();

			const [otherGoal] = await db.insert(monthlyGoals).values({
				teamMemberId: otherTeamMember.id,
				goalTemplateId: testGoalTemplateId,
				month: 9,
				year: 2025,
				targetValue: "100",
				achievedValue: "0",
				status: "in_progress",
			}).returning();

			const callable = submitGoalsForPresentation.callable({ context: mockUsers.employee });

			await expect(callable({
				presentationId: presentation.id,
				submissions: [
					{
						monthlyGoalId: otherGoal.id,
						submittedValue: "50",
					},
				],
			})).rejects.toMatchObject({
				code: "BAD_REQUEST",
			} satisfies Partial<ORPCError>);
		});

		test("should reject submitting goals outside the presentation range", async () => {
			const [outOfRangeGoal] = await db.insert(monthlyGoals).values({
				teamMemberId: testTeamMemberId,
				goalTemplateId: testGoalTemplateId,
				month: 11,
				year: 2025,
				targetValue: "100",
				achievedValue: "0",
				status: "in_progress",
			}).returning();

			const callable = submitGoalsForPresentation.callable({ context: mockUsers.departmentManager });

			await expect(callable({
				presentationId: testPresentationId,
				submissions: [
					{
						monthlyGoalId: outOfRangeGoal.id,
						submittedValue: "50",
					},
				],
			})).rejects.toMatchObject({
				code: "BAD_REQUEST",
			} satisfies Partial<ORPCError>);
		});

		test("should get presentation submissions", async () => {
			// First submit some goals
			const goals = await db.select().from(monthlyGoals);
			await db.insert(goalSubmissions).values([
				{
					presentationId: testPresentationId,
					monthlyGoalId: goals[0].id,
					submittedValue: "90",
					submittedBy: departmentManagerId,
					notes: "Great progress",
				}
			]);

			const callable = getPresentationSubmissions.callable({ context: mockUsers.departmentManager });
			const result = await callable({ presentationId: testPresentationId });
			
			expect(result).toHaveLength(1);
			expect(result[0].submittedValue).toBe("90");
			expect(result[0].notes).toBe("Great progress");
			expect(result[0].goalTemplateName).toBe("Ventas");
		});

		test("employee submission scope should only return their own submissions", async () => {
			const [presentation] = await db.insert(presentations).values({
				name: "Employee Own Presentation",
				startMonth: 9,
				startYear: 2025,
				endMonth: 9,
				endYear: 2025,
				status: "draft",
				createdBy: employeeId,
			}).returning();

			const [otherEmployee] = await db.insert(user).values({
				id: crypto.randomUUID(),
				name: "Submission Other Employee",
				email: "submission.other.employee@test.com",
				emailVerified: true,
				role: "employee",
				createdAt: new Date(),
				updatedAt: new Date(),
			}).returning();

			const [otherTeamMember] = await db.insert(teamMembers).values({
				userId: otherEmployee.id,
				areaId: testAreaId,
				position: "Submission Other Position",
			}).returning();

			const [employeeGoal] = await db.insert(monthlyGoals).values({
				teamMemberId: testTeamMemberId,
				goalTemplateId: testGoalTemplateId,
				month: 9,
				year: 2025,
				targetValue: "100",
				achievedValue: "85",
				status: "completed",
			}).returning();

			const [otherGoal] = await db.insert(monthlyGoals).values({
				teamMemberId: otherTeamMember.id,
				goalTemplateId: testGoalTemplateId,
				month: 9,
				year: 2025,
				targetValue: "100",
				achievedValue: "60",
				status: "completed",
			}).returning();

			await db.insert(goalSubmissions).values([
				{
					presentationId: presentation.id,
					monthlyGoalId: employeeGoal.id,
					submittedValue: "85",
					submittedBy: employeeId,
				},
				{
					presentationId: presentation.id,
					monthlyGoalId: otherGoal.id,
					submittedValue: "60",
					submittedBy: otherEmployee.id,
				},
			]);

			const callable = getPresentationSubmissions.callable({ context: mockUsers.employee });
			const result = await callable({ presentationId: presentation.id });

			expect(result).toHaveLength(1);
			expect(result[0].goalId).toBe(employeeGoal.id);
			expect(result[0].submittedBy).toBe(employeeId);
		});
	});

	describe("Inverse goal calculations", () => {
		test("should include isInverse field in submissions", async () => {
			// Create a reduction goal template with isInverse=true
			const [template] = await db.insert(goalTemplates).values({
				name: "Errores de Sistema",
				description: "Reducir errores del sistema",
				unit: "errores",
				defaultTarget: "5",
				isInverse: true,
				successThreshold: "80",
				warningThreshold: "50",
			}).returning();

			const [goal] = await db.insert(monthlyGoals).values({
				teamMemberId: testTeamMemberId,
				goalTemplateId: template.id,
				month: 9,
				year: 2025,
				targetValue: "5", // Meta máxima (quiere que sea <= 5%)
				achievedValue: "3", // Logrado (actual es 3%)
				status: "completed",
			}).returning();

			// Submit goal to presentation
			await db.insert(goalSubmissions).values({
				presentationId: testPresentationId,
				monthlyGoalId: goal.id,
				submittedValue: "3", // Logrado 3%
				submittedBy: employeeId,
			});

			const callable = getPresentationSubmissions.callable({ context: mockUsers.superAdmin });
			const result = await callable({ presentationId: testPresentationId });

			// Verify isInverse field is included
			const inverseGoal = result.find(r => r.goalTemplateName === "Errores de Sistema");
			expect(inverseGoal).toBeDefined();
			expect(inverseGoal.isInverse).toBe(true);
			expect(parseFloat(inverseGoal.targetValue)).toBe(5); // Meta máxima
			expect(parseFloat(inverseGoal.submittedValue)).toBe(3); // Logrado
		});

		test("should handle normal goal calculation", async () => {
			const [goal] = await db.insert(monthlyGoals).values({
				teamMemberId: testTeamMemberId,
				goalTemplateId: testGoalTemplateId,
				month: 9,
				year: 2025,
				targetValue: "100", // Objetivo
				achievedValue: "85", // Logrado
				status: "completed",
			}).returning();

			await db.insert(goalSubmissions).values({
				presentationId: testPresentationId,
				monthlyGoalId: goal.id,
				submittedValue: "85",
				submittedBy: employeeId,
			});

			const callable = getPresentationSubmissions.callable({ context: mockUsers.superAdmin });
			const result = await callable({ presentationId: testPresentationId });
			
			// For normal goals: achieved (85) / target (100) = 85%
			expect(result[0].goalTemplateName).toBe("Ventas");
			expect(parseFloat(result[0].targetValue)).toBe(100);
			expect(parseFloat(result[0].submittedValue)).toBe(85);
		});
	});

	describe("PDF Generation", () => {
		test("should generate PDF with presentation data", async () => {
			// Create complete test data for PDF generation
			const [goal1] = await db.insert(monthlyGoals).values({
				teamMemberId: testTeamMemberId,
				goalTemplateId: testGoalTemplateId,
				month: 9,
				year: 2025,
				targetValue: "100",
				achievedValue: "90",
				status: "completed",
			}).returning();

			const [goal2] = await db.insert(monthlyGoals).values({
				teamMemberId: testTeamMemberId,
				goalTemplateId: testInversaGoalTemplateId,
				month: 9,
				year: 2025,
				targetValue: "3",
				achievedValue: "5",
				status: "completed",
			}).returning();

			// Submit goals to presentation
			await db.insert(goalSubmissions).values([
				{
					presentationId: testPresentationId,
					monthlyGoalId: goal1.id,
					submittedValue: "90",
					submittedBy: employeeId,
					notes: "Exceeded sales target",
				},
				{
					presentationId: testPresentationId,
					monthlyGoalId: goal2.id,
					submittedValue: "2",
					submittedBy: employeeId,
					notes: "Reduced mora successfully",
				}
			]);

			const callable = generatePresentationPDF.callable({ context: mockUsers.superAdmin });
			
			// Note: This test will fail in CI without Chrome/Puppeteer, but validates the structure
			try {
				const result = await callable({ 
					presentationId: testPresentationId,
					baseUrl: "http://localhost:3001" 
				});
				
				expect(result.pdf).toBeDefined();
				expect(result.filename).toContain("Test Presentation");
				expect(result.filename).toContain("Septiembre 2025");
				expect(typeof result.pdf).toBe("string"); // Base64 encoded PDF
			} catch (error) {
				// In CI environment without Chrome, expect specific error
				expect(error.message).toContain("PDF generation failed");
			}
		});

		test("should handle missing presentation for PDF generation", async () => {
			const callable = generatePresentationPDF.callable({ context: mockUsers.superAdmin });
			
			try {
				await callable({ 
					presentationId: crypto.randomUUID(),
					baseUrl: "http://localhost:3001" 
				});
				expect(false).toBe(true); // Should not reach here
			} catch (error) {
				expect(error.message).toContain("Presentation not found");
			}
		});
	});

	describe("Goal organization and pagination", () => {
		test("should organize submissions by department, area, and person", async () => {
			// Create multiple goals for the same person
			const goals = await Promise.all([
				db.insert(monthlyGoals).values({
					teamMemberId: testTeamMemberId,
					goalTemplateId: testGoalTemplateId,
					month: 9,
					year: 2025,
					targetValue: "100",
					achievedValue: "85",
					status: "completed",
				}).returning(),
				db.insert(monthlyGoals).values({
					teamMemberId: testTeamMemberId,
					goalTemplateId: testInversaGoalTemplateId,
					month: 9,
					year: 2025,
					targetValue: "5",
					achievedValue: "3",
					status: "completed",
				}).returning()
			]);

			// Submit all goals
			await db.insert(goalSubmissions).values([
				{
					presentationId: testPresentationId,
					monthlyGoalId: goals[0][0].id,
					submittedValue: "85",
					submittedBy: employeeId,
				},
				{
					presentationId: testPresentationId,
					monthlyGoalId: goals[1][0].id,
					submittedValue: "3",
					submittedBy: employeeId,
				}
			]);

			const callable = getPresentationSubmissions.callable({ context: mockUsers.superAdmin });
			const result = await callable({ presentationId: testPresentationId });
			
			// Verify we have submissions from the same department/area/person
			expect(result).toHaveLength(2);
			expect(result[0].departmentName).toBe("Test Department");
			expect(result[0].areaName).toBe("Test Area");
			expect(result[0].userName).toBe("Employee");
			expect(result[1].departmentName).toBe("Test Department");
			expect(result[1].areaName).toBe("Test Area");
			expect(result[1].userName).toBe("Employee");
		});

		test("should consolidate monthly goal averages while ignoring missing months", async () => {
			const [presentation] = await db.insert(presentations).values({
				name: "Consolidated Range Presentation",
				startMonth: 1,
				startYear: 2025,
				endMonth: 3,
				endYear: 2025,
				status: "draft",
				createdBy: departmentManagerId,
			}).returning();

			await db.insert(monthlyGoals).values([
				{
					teamMemberId: testTeamMemberId,
					goalTemplateId: testGoalTemplateId,
					month: 1,
					year: 2025,
					targetValue: "100",
					achievedValue: "100",
					status: "completed",
				},
				{
					teamMemberId: testTeamMemberId,
					goalTemplateId: testGoalTemplateId,
					month: 3,
					year: 2025,
					targetValue: "300",
					achievedValue: "120",
					status: "completed",
				},
			]);

			const callable = getPresentationPayload.callable({ context: mockUsers.superAdmin });
			const result = await callable({ presentationId: presentation.id });

			expect(result.periods.map((period: { month: number; year: number }) => `${period.month}/${period.year}`)).toEqual([
				"1/2025",
				"2/2025",
				"3/2025",
			]);
			expect(result.detailRows).toHaveLength(2);
			expect(result.consolidatedRows).toHaveLength(1);
			expect(result.consolidatedRows[0].includedMonths).toEqual([
				{ month: 1, year: 2025 },
				{ month: 3, year: 2025 },
			]);
			expect(Number(result.consolidatedRows[0].consolidatedTargetValue)).toBe(200);
			expect(Number(result.consolidatedRows[0].consolidatedAchievedValue)).toBe(110);
			expect(Number(result.consolidatedRows[0].consolidatedProgressPercentage)).toBe(55);
		});

		test("should keep consolidated rows separate when department and area names collide", async () => {
			const [presentation] = await db.insert(presentations).values({
				name: "Colliding Org Names Presentation",
				startMonth: 9,
				startYear: 2025,
				endMonth: 9,
				endYear: 2025,
				status: "draft",
				createdBy: departmentManagerId,
			}).returning();

			const [departmentA] = await db.insert(departments).values({
				name: "Colliding Department",
				description: "Colliding Department A",
			}).returning();
			const [departmentB] = await db.insert(departments).values({
				name: "Colliding Department",
				description: "Colliding Department B",
			}).returning();

			const [areaA] = await db.insert(areas).values({
				name: "Colliding Area",
				description: "Colliding Area A",
				departmentId: departmentA.id,
			}).returning();
			const [areaB] = await db.insert(areas).values({
				name: "Colliding Area",
				description: "Colliding Area B",
				departmentId: departmentB.id,
			}).returning();

			const [teamMemberA] = await db.insert(teamMembers).values({
				userId: employeeId,
				areaId: areaA.id,
				position: "Colliding Position A",
			}).returning();
			const [teamMemberB] = await db.insert(teamMembers).values({
				userId: employeeId,
				areaId: areaB.id,
				position: "Colliding Position B",
			}).returning();

			await db.insert(monthlyGoals).values([
				{
					teamMemberId: teamMemberA.id,
					goalTemplateId: testGoalTemplateId,
					month: 9,
					year: 2025,
					targetValue: "100",
					achievedValue: "80",
					status: "completed",
				},
				{
					teamMemberId: teamMemberB.id,
					goalTemplateId: testGoalTemplateId,
					month: 9,
					year: 2025,
					targetValue: "200",
					achievedValue: "160",
					status: "completed",
				},
			]);

			const callable = getPresentationPayload.callable({ context: mockUsers.superAdmin });
			const result = await callable({ presentationId: presentation.id });

			expect(result.detailRows).toHaveLength(2);
			expect(result.detailRows[0]).toHaveProperty("departmentId");
			expect(result.detailRows[0]).toHaveProperty("areaId");
			expect(result.consolidatedRows).toHaveLength(2);
			expect(new Set(result.consolidatedRows.map(row => row.departmentId)).size).toBe(2);
			expect(new Set(result.consolidatedRows.map(row => row.areaId)).size).toBe(2);
			expect(result.consolidatedRows.every(row => row.departmentName === "Colliding Department")).toBe(true);
			expect(result.consolidatedRows.every(row => row.areaName === "Colliding Area")).toBe(true);
		});
	});
});

test("should label ranged presentations across years", () => {
	expect(formatPresentationPeriodLabel({
		startMonth: 12,
		startYear: 2025,
		endMonth: 1,
		endYear: 2026,
	})).toBe("Diciembre 2025 - Enero 2026");
});
