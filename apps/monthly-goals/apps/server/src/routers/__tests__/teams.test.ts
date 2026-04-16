import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import dotenv from "dotenv";
dotenv.config({ path: ".env.test" });

import { db } from "../../db";
import { createMockContext } from "../../__tests__/test-helpers";
import { createUserAndAssignToTeam } from "../teams";
import { user } from "../../db/schema/auth";
import { departments } from "../../db/schema/departments";
import { areas } from "../../db/schema/areas";
import { teamMembers } from "../../db/schema/team-members";
import { auth } from "../../lib/auth";
import { eq } from "drizzle-orm";

describe("Teams Procedures", () => {
	const managerId = crypto.randomUUID();
	const createdUserId = crypto.randomUUID();
	const mockContext = createMockContext("department_manager", managerId);

	beforeEach(async () => {
		await db.delete(teamMembers);
		await db.delete(areas);
		await db.delete(departments);
		await db.delete(user);

		await db.insert(user).values({
			id: managerId,
			name: mockContext.session.user.name,
			email: "leonardo.m@test.com",
			emailVerified: true,
			role: "department_manager",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
	});

	afterEach(async () => {
		mock.restore();
		await db.delete(teamMembers);
		await db.delete(areas);
		await db.delete(departments);
		await db.delete(user);
	});

	test("should create user without sending role to signUpEmail and then assign team membership", async () => {
		const [department] = await db.insert(departments).values({
			name: "Marketing",
			managerId,
		}).returning();

		const [area] = await db.insert(areas).values({
			name: "Marketing",
			departmentId: department.id,
		}).returning();

		const signUpEmailMock = mock(async ({ body }: { body: Record<string, string> }) => {
			expect(body.role).toBeUndefined();
			return {
				user: {
					id: createdUserId,
					name: body.name,
					email: body.email,
				},
			};
		});

		auth.api.signUpEmail = signUpEmailMock as typeof auth.api.signUpEmail;

		const callable = createUserAndAssignToTeam.callable({ context: mockContext });
		const result = await callable({
			name: "Mariana L",
			email: "mariana.l@clubcashin.com",
			password: "Employee123!",
			role: "employee",
			areaId: area.id,
			position: "Diseñadora Gráfica Sr",
		});

		expect(signUpEmailMock).toHaveBeenCalledTimes(1);
		expect(result.user.email).toBe("mariana.l@clubcashin.com");
		expect(result.user.role).toBe("employee");

		const [storedUser] = await db.select().from(user).where(eq(user.id, createdUserId));
		expect(storedUser.role).toBe("employee");

		const [storedTeamMember] = await db.select().from(teamMembers).where(eq(teamMembers.userId, createdUserId));
		expect(storedTeamMember.areaId).toBe(area.id);
		expect(storedTeamMember.position).toBe("Diseñadora Gráfica Sr");
	});
});
