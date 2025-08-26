import { protectedProcedure, publicProcedure } from "../lib/orpc";
import type { RouterClient } from "@orpc/server";
import {
	listDepartments,
	getDepartment,
	createDepartment,
	updateDepartment,
	deleteDepartment,
} from "./departments";
import {
	listAreas,
	getArea,
	createArea,
	updateArea,
	deleteArea,
} from "./areas";
import {
	listTeamMembers,
	getTeamMember,
	createTeamMember,
	updateTeamMember,
	deleteTeamMember,
	getAvailableUsers,
	createUserAndAssignToTeam,
	getMyTeamMembers,
} from "./teams";
import {
	listGoalTemplates,
	getGoalTemplate,
	createGoalTemplate,
	updateGoalTemplate,
	deleteGoalTemplate,
} from "./goal-templates";
import {
	listMonthlyGoals,
	getMonthlyGoal,
	createMonthlyGoal,
	bulkCreateMonthlyGoals,
	updateMonthlyGoal,
	deleteMonthlyGoal,
	calculateGoalProgress,
	getMyGoals,
} from "./monthly-goals";

export const appRouter = {
	healthCheck: publicProcedure.handler(() => {
		return "OK";
	}),
	privateData: protectedProcedure.handler(({ context }) => {
		return {
			message: "This is private",
			user: context.session?.user,
		};
	}),
	departments: {
		list: listDepartments,
		get: getDepartment,
		create: createDepartment,
		update: updateDepartment,
		delete: deleteDepartment,
	},
	areas: {
		list: listAreas,
		get: getArea,
		create: createArea,
		update: updateArea,
		delete: deleteArea,
	},
	teams: {
		list: listTeamMembers,
		get: getTeamMember,
		create: createTeamMember,
		update: updateTeamMember,
		delete: deleteTeamMember,
		availableUsers: getAvailableUsers,
		createUserAndAssign: createUserAndAssignToTeam,
		my: getMyTeamMembers,
	},
	goalTemplates: {
		list: listGoalTemplates,
		get: getGoalTemplate,
		create: createGoalTemplate,
		update: updateGoalTemplate,
		delete: deleteGoalTemplate,
	},
	monthlyGoals: {
		list: listMonthlyGoals,
		get: getMonthlyGoal,
		create: createMonthlyGoal,
		bulkCreate: bulkCreateMonthlyGoals,
		update: updateMonthlyGoal,
		delete: deleteMonthlyGoal,
		calculateProgress: calculateGoalProgress,
		my: getMyGoals,
	},
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
