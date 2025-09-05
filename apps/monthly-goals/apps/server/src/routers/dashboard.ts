import { protectedProcedure } from "../lib/orpc";
import { db } from "../db";
import { monthlyGoals } from "../db/schema/monthly-goals";
import { goalTemplates } from "../db/schema/goal-templates";
import { teamMembers } from "../db/schema/team-members";
import { user } from "../db/schema/auth";
import { areas } from "../db/schema/areas";
import { departments } from "../db/schema/departments";
import { eq, and, count, avg, sql } from "drizzle-orm";
import * as z from "zod";

export const getDashboardMetrics = protectedProcedure
	.input(z.object({
		month: z.number().int().min(1).max(12).optional().default(new Date().getMonth() + 1),
		year: z.number().int().min(2020).optional().default(new Date().getFullYear()),
	}))
	.handler(async ({ input, context }) => {
		if (!context.session?.user) {
			throw new Error("Unauthorized");
		}

		const currentUser = context.session.user;
		const { month, year } = input;

		// Build where conditions
		let whereConditions = [
			eq(monthlyGoals.month, month),
			eq(monthlyGoals.year, year)
		];

		// Apply role-based filtering
		if (currentUser.role === "employee") {
			whereConditions.push(eq(user.id, currentUser.id));
		} else if (currentUser.role === "department_manager") {
			whereConditions.push(eq(departments.managerId, currentUser.id));
		} else if (currentUser.role === "area_lead") {
			whereConditions.push(eq(areas.leadId, currentUser.id));
		}

		// Build and execute query
		const allGoals = await db
			.select()
			.from(monthlyGoals)
			.leftJoin(goalTemplates, eq(monthlyGoals.goalTemplateId, goalTemplates.id))
			.leftJoin(teamMembers, eq(monthlyGoals.teamMemberId, teamMembers.id))
			.leftJoin(user, eq(teamMembers.userId, user.id))
			.leftJoin(areas, eq(teamMembers.areaId, areas.id))
			.leftJoin(departments, eq(areas.departmentId, departments.id))
			.where(and(...whereConditions));

		// Calculate metrics
		const totalGoals = allGoals.length;
		
		let completedGoals = 0;
		let successfulGoals = 0; // Goals achieving >80%
		let warningGoals = 0; // Goals achieving 50-80%
		let dangerGoals = 0; // Goals achieving <50%
		let totalProgress = 0;

		allGoals.forEach((goal) => {
			const target = parseFloat(goal.monthly_goals.targetValue);
			const achieved = parseFloat(goal.monthly_goals.achievedValue);
			const percentage = target > 0 ? (achieved / target) * 100 : 0;
			
			totalProgress += percentage;

			const successThreshold = parseFloat(goal.goal_templates?.successThreshold || "80");
			const warningThreshold = parseFloat(goal.goal_templates?.warningThreshold || "50");

			if (goal.monthly_goals.status === "completed") completedGoals++;

			if (percentage >= successThreshold) {
				successfulGoals++;
			} else if (percentage >= warningThreshold) {
				warningGoals++;
			} else {
				dangerGoals++;
			}
		});

		const avgProgress = totalGoals > 0 ? totalProgress / totalGoals : 0;

		// Top performers (employees with best average performance)
		const performanceMap = new Map();
		allGoals.forEach((goal) => {
			const userEmail = goal.user?.email;
			const userName = goal.user?.name;
			if (!userEmail || !userName) return;

			const target = parseFloat(goal.monthly_goals.targetValue);
			const achieved = parseFloat(goal.monthly_goals.achievedValue);
			const percentage = target > 0 ? (achieved / target) * 100 : 0;

			if (!performanceMap.has(userEmail)) {
				performanceMap.set(userEmail, {
					name: userName,
					email: userEmail,
					totalPercentage: 0,
					goalCount: 0,
					areaName: goal.areas?.name,
					departmentName: goal.departments?.name,
				});
			}

			const userPerf = performanceMap.get(userEmail);
			userPerf.totalPercentage += percentage;
			userPerf.goalCount += 1;
		});

		const topPerformers = Array.from(performanceMap.values())
			.map(perf => ({
				...perf,
				avgPercentage: perf.goalCount > 0 ? perf.totalPercentage / perf.goalCount : 0,
			}))
			.sort((a, b) => b.avgPercentage - a.avgPercentage)
			.slice(0, 5); // Top 5

		// Department/Area summary
		const departmentMap = new Map();
		allGoals.forEach((goal) => {
			const deptName = goal.departments?.name;
			if (!deptName) return;

			const target = parseFloat(goal.monthly_goals.targetValue);
			const achieved = parseFloat(goal.monthly_goals.achievedValue);
			const percentage = target > 0 ? (achieved / target) * 100 : 0;

			if (!departmentMap.has(deptName)) {
				departmentMap.set(deptName, {
					name: deptName,
					totalPercentage: 0,
					goalCount: 0,
					successCount: 0,
				});
			}

			const deptPerf = departmentMap.get(deptName);
			deptPerf.totalPercentage += percentage;
			deptPerf.goalCount += 1;

			const successThreshold = parseFloat(goal.goal_templates?.successThreshold || "80");
			if (percentage >= successThreshold) {
				deptPerf.successCount += 1;
			}
		});

		const departmentSummary = Array.from(departmentMap.values())
			.map(dept => ({
				...dept,
				avgPercentage: dept.goalCount > 0 ? dept.totalPercentage / dept.goalCount : 0,
				successRate: dept.goalCount > 0 ? (dept.successCount / dept.goalCount) * 100 : 0,
			}));

		return {
			period: { month, year },
			overview: {
				totalGoals,
				completedGoals,
				avgProgress: Math.round(avgProgress * 100) / 100,
				completionRate: totalGoals > 0 ? Math.round((completedGoals / totalGoals) * 100) : 0,
			},
			goalsByStatus: {
				successful: successfulGoals,
				warning: warningGoals,
				danger: dangerGoals,
			},
			topPerformers,
			departmentSummary,
		};
	});

export const getHealthStatus = protectedProcedure.handler(async () => {
	// Check database connectivity and basic system health
	try {
		const [userCount] = await db.select({ count: count() }).from(user);
		const [deptCount] = await db.select({ count: count() }).from(departments);
		const [goalCount] = await db.select({ count: count() }).from(monthlyGoals);

		return {
			database: "connected",
			users: userCount.count,
			departments: deptCount.count,
			monthlyGoals: goalCount.count,
			timestamp: new Date(),
			status: "healthy",
		};
	} catch (error) {
		return {
			database: "error",
			error: error instanceof Error ? error.message : "Unknown error",
			timestamp: new Date(),
			status: "unhealthy",
		};
	}
});