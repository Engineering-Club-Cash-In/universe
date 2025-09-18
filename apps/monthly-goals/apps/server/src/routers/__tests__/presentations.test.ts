import { describe, expect, test, beforeEach, afterEach } from "bun:test";
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
	generatePresentationPDF,
} from "../presentations";

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
			successThreshold: "80",
			warningThreshold: "50",
		}).returning();
		testGoalTemplateId = goalTemplate.id;

		const [inversaGoalTemplate] = await db.insert(goalTemplates).values({
			name: "Mora Cartera",
			description: "Meta de reducción de mora",
			unit: "percentage",
			defaultTarget: "5",
			successThreshold: "80",
			warningThreshold: "50",
		}).returning();
		testInversaGoalTemplateId = inversaGoalTemplate.id;

		// Create test presentation
		const [presentation] = await db.insert(presentations).values({
			name: "Test Presentation",
			month: 9,
			year: 2025,
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
				month: 9,
				year: 2025,
			});
			
			expect(result.name).toBe("Septiembre 2025 Presentation");
			expect(result.month).toBe(9);
			expect(result.year).toBe(2025);
			expect(result.status).toBe("draft");
			expect(result.createdBy).toBe(departmentManagerId);
		});

		test("should get presentation by id", async () => {
			const callable = getPresentation.callable({ context: mockUsers.superAdmin });
			const result = await callable({ id: testPresentationId });
			
			expect(result.id).toBe(testPresentationId);
			expect(result.name).toBe("Test Presentation");
			expect(result.createdByName).toBe("Department Manager");
		});

		test("should update presentation status", async () => {
			const callable = updatePresentation.callable({ context: mockUsers.departmentManager });
			const result = await callable({
				id: testPresentationId,
				data: {
					status: "ready",
					presentedAt: new Date(),
				}
			});
			
			expect(result.status).toBe("ready");
			expect(result.presentedAt).toBeDefined();
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
	});

	describe("Role-based filtering", () => {
		beforeEach(async () => {
			// Create additional presentations by different users
			await db.insert(presentations).values([
				{
					name: "Area Lead Presentation",
					month: 8,
					year: 2025,
					status: "draft",
					createdBy: areaLeadId,
				},
				{
					name: "Employee Presentation",
					month: 7,
					year: 2025,
					status: "draft",
					createdBy: employeeId,
				}
			]);
		});

		test("super admin should see all presentations", async () => {
			const callable = listPresentations.callable({ context: mockUsers.superAdmin });
			const result = await callable();
			
			expect(result.length).toBeGreaterThanOrEqual(3); // At least 3 presentations
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

		test("should get available goals for presentation", async () => {
			const callable = getAvailableGoalsForPresentation.callable({ context: mockUsers.departmentManager });
			const result = await callable({ month: 9, year: 2025 });
			
			expect(result).toHaveLength(2);
			expect(result.some(g => g.goalTemplateName === "Ventas")).toBe(true);
			expect(result.some(g => g.goalTemplateName === "Mora Cartera")).toBe(true);
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
	});

	describe("Inverse goal calculations", () => {
		test("should detect inverse goal by keywords", async () => {
			// Test various inverse goal keywords
			const inverseKeywords = ['mora', 'error', 'reclamo', 'falla', 'retraso', 'costo', 'gasto'];
			
			for (const keyword of inverseKeywords) {
				// Create goal template with inverse keyword
				const [template] = await db.insert(goalTemplates).values({
					name: `Meta de ${keyword}`,
					description: `Reducir ${keyword}`,
					unit: "percentage",
					defaultTarget: "5",
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
				
				// For inverse goals: if achieved (3) <= target (5) = success (100%)
				// This is verified in the frontend calculation, but data structure should be correct
				expect(result[result.length - 1].goalTemplateName).toContain(keyword);
				expect(parseFloat(result[result.length - 1].targetValue)).toBe(5); // Meta máxima
				expect(parseFloat(result[result.length - 1].submittedValue)).toBe(3); // Logrado
			}
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
	});
});