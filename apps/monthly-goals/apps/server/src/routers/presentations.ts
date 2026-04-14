import { protectedProcedure } from "../lib/orpc";
import { ORPCError } from "@orpc/server";
import { db } from "../db";
import { presentations, goalSubmissions } from "../db/schema/presentations";
import { monthlyGoals } from "../db/schema/monthly-goals";
import { goalTemplates } from "../db/schema/goal-templates";
import { teamMembers } from "../db/schema/team-members";
import { user } from "../db/schema/auth";
import { areas } from "../db/schema/areas";
import { departments } from "../db/schema/departments";
import { eq, and, or } from "drizzle-orm";
import * as z from "zod";
import puppeteer from "puppeteer";

const PresentationPeriodSchema = z.object({
	startMonth: z.number().int().min(1).max(12),
	startYear: z.number().int().min(2020),
	endMonth: z.number().int().min(1).max(12),
	endYear: z.number().int().min(2020),
});

const CreatePresentationSchema = z.object({
	name: z.string().min(1, "Name is required"),
	...PresentationPeriodSchema.shape,
});

const UpdatePresentationSchema = z.object({
	name: z.string().min(1).optional(),
	status: z.enum(["draft", "ready", "presented"]).optional(),
	presentedAt: z.date().optional(),
	startMonth: z.number().int().min(1).max(12).optional(),
	startYear: z.number().int().min(2020).optional(),
	endMonth: z.number().int().min(1).max(12).optional(),
	endYear: z.number().int().min(2020).optional(),
});

type PresentationPeriod = z.infer<typeof PresentationPeriodSchema>;

const INVALID_RANGE_MESSAGE = "End period must be greater than or equal to start period";
const MONTH_NAMES = [
	"", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
	"Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

function isPresentationRangeValid(period: PresentationPeriod) {
	return period.startYear < period.endYear
		|| (period.startYear === period.endYear && period.startMonth <= period.endMonth);
}

function assertPresentationRangeValid(period: PresentationPeriod) {
	if (!isPresentationRangeValid(period)) {
		throw new ORPCError("BAD_REQUEST", { message: INVALID_RANGE_MESSAGE });
	}
}

function expandPresentationRange(period: PresentationPeriod) {
	const periods = [];
	let currentMonth = period.startMonth;
	let currentYear = period.startYear;

	while (currentYear < period.endYear || (currentYear === period.endYear && currentMonth <= period.endMonth)) {
		periods.push({ month: currentMonth, year: currentYear });

		if (currentMonth === 12) {
			currentMonth = 1;
			currentYear += 1;
		} else {
			currentMonth += 1;
		}
	}

	return periods;
}

function buildPresentationPeriodCondition(periods: Array<{ month: number; year: number }>) {
	const periodConditions = periods.map(period =>
		and(eq(monthlyGoals.month, period.month), eq(monthlyGoals.year, period.year))
	);

	if (periodConditions.length === 1) {
		return periodConditions[0];
	}

	return or(...periodConditions);
}

type CurrentUser = { id: string; role: string };

type PresentationGoalScope = {
	presentationId: string;
	currentUser: CurrentUser;
};

function canReadPresentation(currentUser: CurrentUser, presentationCreatedBy: string) {
	switch (currentUser.role) {
		case "super_admin":
		case "viewer":
			return true;
		case "department_manager":
		case "area_lead":
		case "employee":
			return presentationCreatedBy === currentUser.id;
		default:
			return false;
	}
}

function canWritePresentation(currentUser: CurrentUser, presentationCreatedBy: string) {
	switch (currentUser.role) {
		case "super_admin":
			return true;
		case "department_manager":
		case "area_lead":
		case "employee":
			return presentationCreatedBy === currentUser.id;
		case "viewer":
		default:
			return false;
	}
}

async function assertPresentationAccess(
	presentationId: string,
	currentUser: CurrentUser,
) {
	const presentation = await db
		.select({
			id: presentations.id,
			name: presentations.name,
			startMonth: presentations.startMonth,
			startYear: presentations.startYear,
			endMonth: presentations.endMonth,
			endYear: presentations.endYear,
			status: presentations.status,
			createdBy: presentations.createdBy,
		})
		.from(presentations)
		.where(eq(presentations.id, presentationId))
		.limit(1);

	if (!presentation[0] || !canReadPresentation(currentUser, presentation[0].createdBy)) {
		throw new ORPCError("NOT_FOUND", { message: "Presentation not found" });
	}

	return presentation[0];
}

async function assertPresentationWriteAccess(
	presentationId: string,
	currentUser: CurrentUser,
) {
	const presentation = await db
		.select({
			id: presentations.id,
			createdBy: presentations.createdBy,
		})
		.from(presentations)
		.where(eq(presentations.id, presentationId))
		.limit(1);

	if (!presentation[0] || !canWritePresentation(currentUser, presentation[0].createdBy)) {
		throw new ORPCError("NOT_FOUND", { message: "Presentation not found" });
	}

	return presentation[0];
}

async function getPresentationGoalScope({ presentationId, currentUser }: PresentationGoalScope) {
	const presentation = await assertPresentationAccess(presentationId, currentUser);
	const periodCondition = buildPresentationPeriodCondition(
		expandPresentationRange({
			startMonth: presentation.startMonth,
			startYear: presentation.startYear,
			endMonth: presentation.endMonth,
			endYear: presentation.endYear,
		}),
	);

	const whereConditions = [periodCondition];

	if (currentUser.role === "department_manager") {
		whereConditions.push(eq(departments.managerId, currentUser.id));
	} else if (currentUser.role === "area_lead") {
		whereConditions.push(eq(areas.leadId, currentUser.id));
	} else if (currentUser.role === "employee") {
		whereConditions.push(eq(teamMembers.userId, currentUser.id));
	}

	return await db
		.select({
			id: monthlyGoals.id,
			monthlyGoalId: monthlyGoals.id,
			goalTemplateId: monthlyGoals.goalTemplateId,
			userId: teamMembers.userId,
			month: monthlyGoals.month,
			year: monthlyGoals.year,
			targetValue: monthlyGoals.targetValue,
			achievedValue: monthlyGoals.achievedValue,
			description: monthlyGoals.description,
			status: monthlyGoals.status,
			goalTemplateName: goalTemplates.name,
			goalTemplateUnit: goalTemplates.unit,
			isInverse: goalTemplates.isInverse,
			userName: user.name,
			userEmail: user.email,
			areaId: areas.id,
			areaName: areas.name,
			departmentId: departments.id,
			departmentName: departments.name,
		})
		.from(monthlyGoals)
		.leftJoin(goalTemplates, eq(monthlyGoals.goalTemplateId, goalTemplates.id))
		.leftJoin(teamMembers, eq(monthlyGoals.teamMemberId, teamMembers.id))
		.leftJoin(user, eq(teamMembers.userId, user.id))
		.leftJoin(areas, eq(teamMembers.areaId, areas.id))
		.leftJoin(departments, eq(areas.departmentId, departments.id))
		.where(and(...whereConditions));
}

type PresentationGoalScopeRow = {
	id: string;
	monthlyGoalId: string;
	goalTemplateId: string;
	userId: string | null;
	month: number;
	year: number;
	targetValue: string;
	achievedValue: string;
	description: string | null;
	status: "pending" | "in_progress" | "completed";
	goalTemplateName: string | null;
	goalTemplateUnit: string | null;
	isInverse: boolean | null;
	userName: string | null;
	userEmail: string | null;
	areaId: string | null;
	areaName: string | null;
	departmentId: string | null;
	departmentName: string | null;
};

type PresentationDetailRow = PresentationGoalScopeRow & {
	periodLabel: string;
	progressPercentage: number;
};

type PresentationConsolidatedRow = {
	departmentId: string;
	departmentName: string;
	areaId: string;
	areaName: string;
	userId: string;
	goalTemplateId: string;
	userName: string | null;
	userEmail: string | null;
	goalTemplateName: string | null;
	goalTemplateUnit: string | null;
	isInverse: boolean | null;
	includedMonths: Array<{ month: number; year: number }>;
	monthlyRows: PresentationDetailRow[];
	consolidatedTargetValue: string;
	consolidatedAchievedValue: string;
	consolidatedProgressPercentage: number;
};

type PresentationConsolidatedAccumulator = PresentationConsolidatedRow & {
	targetTotal: number;
	achievedTotal: number;
};

type PresentationPayload = {
	presentation: Awaited<ReturnType<typeof assertPresentationAccess>>;
	periods: Array<{ month: number; year: number; label: string }>;
	detailRows: PresentationDetailRow[];
	consolidatedRows: PresentationConsolidatedRow[];
};

function formatMonthPeriodLabel(month: number, year: number) {
	return `${MONTH_NAMES[month]} ${year}`;
}

function formatAverageValue(total: number, count: number) {
	return count > 0 ? (total / count).toFixed(2) : "0.00";
}

function buildPresentationDetailRow(row: PresentationGoalScopeRow): PresentationDetailRow {
	return {
		...row,
		periodLabel: formatMonthPeriodLabel(row.month, row.year),
		progressPercentage: getProgressPercentage(row.targetValue, row.achievedValue, row.isInverse ?? undefined),
	};
}

function groupPresentationRows(rows: PresentationDetailRow[]) {
	const groupedRows = new Map<string, PresentationConsolidatedAccumulator>();

	for (const row of rows) {
		const departmentId = row.departmentId ?? "Sin Departamento";
		const departmentName = row.departmentName ?? "Sin Departamento";
		const areaId = row.areaId ?? "Sin Área";
		const areaName = row.areaName ?? "Sin Área";
		const userId = row.userId ?? "Sin Usuario";
		const goalTemplateId = row.goalTemplateId ?? "Sin Meta";
		const key = [departmentId, areaId, userId, goalTemplateId].join("::");

		const existingGroup = groupedRows.get(key);
		if (!existingGroup) {
			groupedRows.set(key, {
				departmentId,
				departmentName,
				areaId,
				areaName,
				userId,
				goalTemplateId,
				userName: row.userName,
				userEmail: row.userEmail,
				goalTemplateName: row.goalTemplateName,
				goalTemplateUnit: row.goalTemplateUnit,
				isInverse: row.isInverse,
				includedMonths: [{ month: row.month, year: row.year }],
				monthlyRows: [row],
				consolidatedTargetValue: row.targetValue,
				consolidatedAchievedValue: row.achievedValue,
				consolidatedProgressPercentage: row.progressPercentage,
				targetTotal: parseFloat(row.targetValue),
				achievedTotal: parseFloat(row.achievedValue),
			});
			continue;
		}

		existingGroup.includedMonths.push({ month: row.month, year: row.year });
		existingGroup.monthlyRows.push(row);

		existingGroup.targetTotal += parseFloat(row.targetValue);
		existingGroup.achievedTotal += parseFloat(row.achievedValue);
		const rowCount = existingGroup.monthlyRows.length;

		existingGroup.consolidatedTargetValue = formatAverageValue(existingGroup.targetTotal, rowCount);
		existingGroup.consolidatedAchievedValue = formatAverageValue(existingGroup.achievedTotal, rowCount);
		existingGroup.consolidatedProgressPercentage = getProgressPercentage(
			existingGroup.consolidatedTargetValue,
			existingGroup.consolidatedAchievedValue,
			existingGroup.isInverse ?? undefined,
		);
	}

	return [...groupedRows.values()].map(group => ({
		...group,
		includedMonths: group.includedMonths.sort((left, right) =>
			left.year === right.year ? left.month - right.month : left.year - right.year
		),
		monthlyRows: group.monthlyRows.sort((left, right) =>
			left.year === right.year ? left.month - right.month : left.year - right.year
		),
	}));
}

async function getPresentationPayloadData(
	presentationId: string,
	currentUser: CurrentUser,
): Promise<PresentationPayload> {
	const presentation = await assertPresentationAccess(presentationId, currentUser);
	const periods = expandPresentationRange({
		startMonth: presentation.startMonth,
		startYear: presentation.startYear,
		endMonth: presentation.endMonth,
		endYear: presentation.endYear,
	}).map(period => ({
		...period,
		label: formatMonthPeriodLabel(period.month, period.year),
	}));

	const rows = await getPresentationGoalScope({ presentationId, currentUser }) as PresentationGoalScopeRow[];
	const detailRows = rows
		.map(buildPresentationDetailRow)
		.sort((left, right) => (
			left.departmentName ?? ""
		).localeCompare(right.departmentName ?? "")
			|| (left.areaName ?? "").localeCompare(right.areaName ?? "")
			|| (left.userName ?? "").localeCompare(right.userName ?? "")
			|| (left.goalTemplateName ?? "").localeCompare(right.goalTemplateName ?? "")
			|| left.year - right.year
			|| left.month - right.month
		);

	return {
		presentation,
		periods,
		detailRows,
		consolidatedRows: groupPresentationRows(detailRows),
	};
}

export function formatPresentationPeriodLabel(period: PresentationPeriod) {
	const startLabel = `${MONTH_NAMES[period.startMonth]} ${period.startYear}`;
	const endLabel = `${MONTH_NAMES[period.endMonth]} ${period.endYear}`;

	return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
}

const GoalSubmissionSchema = z.object({
	monthlyGoalId: z.string().uuid(),
	submittedValue: z.string(),
	notes: z.string().optional(),
});

const BulkSubmitGoalsSchema = z.object({
	presentationId: z.string().uuid(),
	submissions: z.array(GoalSubmissionSchema),
});

export const listPresentations = protectedProcedure.handler(async ({ context }) => {
	if (!context.session?.user) {
		throw new Error("Unauthorized");
	}

	const currentUser = context.session.user;
	
		let query = db
		.select({
			id: presentations.id,
			name: presentations.name,
			startMonth: presentations.startMonth,
			startYear: presentations.startYear,
			endMonth: presentations.endMonth,
			endYear: presentations.endYear,
			status: presentations.status,
			createdBy: presentations.createdBy,
			presentedAt: presentations.presentedAt,
			createdAt: presentations.createdAt,
			updatedAt: presentations.updatedAt,
			createdByName: user.name,
			createdByEmail: user.email,
		})
		.from(presentations)
		.leftJoin(user, eq(presentations.createdBy, user.id));

	// Apply role-based filtering
	switch (currentUser.role) {
		case "super_admin":
		case "viewer":
			break;
		case "department_manager":
		case "area_lead":
		case "employee":
			query = query.where(eq(presentations.createdBy, currentUser.id)) as typeof query;
			break;
		default:
			query = query.where(eq(presentations.createdBy, currentUser.id)) as typeof query;
			break;
	}

	return await query;
});

export const getPresentation = protectedProcedure
	.input(z.object({ id: z.string().uuid() }))
	.handler(async ({ input, context }) => {
		if (!context.session?.user) {
			throw new Error("Unauthorized");
		}

		await assertPresentationAccess(input.id, context.session.user);

		const presentation = await db
			.select({
				id: presentations.id,
				name: presentations.name,
				startMonth: presentations.startMonth,
				startYear: presentations.startYear,
				endMonth: presentations.endMonth,
				endYear: presentations.endYear,
				status: presentations.status,
				createdBy: presentations.createdBy,
				presentedAt: presentations.presentedAt,
				createdAt: presentations.createdAt,
				updatedAt: presentations.updatedAt,
				createdByName: user.name,
				createdByEmail: user.email,
			})
			.from(presentations)
			.leftJoin(user, eq(presentations.createdBy, user.id))
			.where(eq(presentations.id, input.id))
			.limit(1);
		
		if (!presentation[0]) {
			throw new Error("Presentation not found");
		}
		
		return presentation[0];
	});

export const createPresentation = protectedProcedure
	.input(CreatePresentationSchema)
	.handler(async ({ input, context }) => {
		if (!context.session?.user) {
			throw new Error("Unauthorized");
		}

		if (context.session.user.role === "viewer") {
			throw new ORPCError("NOT_FOUND", { message: "Presentation not found" });
		}

		assertPresentationRangeValid(input);

		const [newPresentation] = await db
			.insert(presentations)
			.values({
				...input,
				createdBy: context.session.user.id,
				status: "draft",
			})
			.returning();
		
		return newPresentation;
	});

export const updatePresentation = protectedProcedure
	.input(
		z.object({
			id: z.string().uuid(),
			data: UpdatePresentationSchema,
		})
	)
	.handler(async ({ input, context }) => {
		if (!context.session?.user) {
			throw new Error("Unauthorized");
		}

		const currentUser = context.session.user;

		const currentPresentation = await db
			.select({
				createdBy: presentations.createdBy,
				startMonth: presentations.startMonth,
				startYear: presentations.startYear,
				endMonth: presentations.endMonth,
				endYear: presentations.endYear,
			})
			.from(presentations)
			.where(eq(presentations.id, input.id))
			.limit(1);

		if (!currentPresentation[0]) {
			throw new Error("Presentation not found");
		}

		if (!canWritePresentation(currentUser, currentPresentation[0].createdBy)) {
			throw new ORPCError("NOT_FOUND", { message: "Presentation not found" });
		}

		const mergedPeriod = {
			startMonth: input.data.startMonth ?? currentPresentation[0].startMonth,
			startYear: input.data.startYear ?? currentPresentation[0].startYear,
			endMonth: input.data.endMonth ?? currentPresentation[0].endMonth,
			endYear: input.data.endYear ?? currentPresentation[0].endYear,
		};

		assertPresentationRangeValid(mergedPeriod);

		const [updatedPresentation] = await db
			.update(presentations)
			.set(input.data)
			.where(eq(presentations.id, input.id))
			.returning();
		
		if (!updatedPresentation) {
			throw new Error("Presentation not found");
		}
		
		return updatedPresentation;
	});

export const deletePresentation = protectedProcedure
	.input(z.object({ id: z.string().uuid() }))
	.handler(async ({ input, context }) => {
		if (!context.session?.user) {
			throw new Error("Unauthorized");
		}

		await assertPresentationWriteAccess(input.id, context.session.user);

		// First delete related goal submissions
		await db.delete(goalSubmissions).where(eq(goalSubmissions.presentationId, input.id));
		
		// Then delete the presentation
		const [deletedPresentation] = await db
			.delete(presentations)
			.where(eq(presentations.id, input.id))
			.returning();
		
		if (!deletedPresentation) {
			throw new Error("Presentation not found");
		}
		
		return { success: true };
	});

// Get monthly goals available for a presentation (filtered by user role)
export const getAvailableGoalsForPresentation = protectedProcedure
	.input(z.object({
		presentationId: z.string().uuid(),
	}))
	.handler(async ({ input, context }) => {
		if (!context.session?.user) {
			throw new Error("Unauthorized");
		}

		return await getPresentationGoalScope({
			presentationId: input.presentationId,
			currentUser: context.session.user,
		});
	});

// Submit goals for a presentation
export const submitGoalsForPresentation = protectedProcedure
	.input(BulkSubmitGoalsSchema)
	.handler(async ({ input, context }) => {
		if (!context.session?.user) {
			throw new Error("Unauthorized");
		}

		await assertPresentationWriteAccess(input.presentationId, context.session.user);

		const accessibleGoals = await getPresentationGoalScope({
			presentationId: input.presentationId,
			currentUser: context.session.user,
		});
		const accessibleGoalIds = new Set(accessibleGoals.map(goal => goal.id));
		const invalidGoalIds = input.submissions
			.map(submission => submission.monthlyGoalId)
			.filter(monthlyGoalId => !accessibleGoalIds.has(monthlyGoalId));

		if (invalidGoalIds.length > 0) {
			throw new ORPCError("BAD_REQUEST", {
				message: `Invalid or out-of-scope monthlyGoalId(s): ${[...new Set(invalidGoalIds)].join(", ")}`,
			});
		}

		const goalSubmissionValues = input.submissions.map(submission => ({
			...submission,
			presentationId: input.presentationId,
			submittedBy: context.session.user.id,
		}));

		const newSubmissions = await db
			.insert(goalSubmissions)
			.values(goalSubmissionValues)
			.returning();

		// Update the monthly goals with the submitted values
		for (const submission of input.submissions) {
			await db
				.update(monthlyGoals)
				.set({ 
					achievedValue: submission.submittedValue,
					status: "completed",
				})
				.where(eq(monthlyGoals.id, submission.monthlyGoalId));
		}
		
		return newSubmissions;
	});

// Get goal submissions for a presentation
export const getPresentationSubmissions = protectedProcedure
	.input(z.object({ presentationId: z.string().uuid() }))
	.handler(async ({ input, context }) => {
		if (!context.session?.user) {
			throw new Error("Unauthorized");
		}

		const accessibleGoals = await getPresentationGoalScope({
			presentationId: input.presentationId,
			currentUser: context.session.user,
		});
		const accessibleGoalIds = new Set(accessibleGoals.map(goal => goal.id));

		const submissions = await db
			.select({
				id: goalSubmissions.id,
				submittedValue: goalSubmissions.submittedValue,
				submittedBy: goalSubmissions.submittedBy,
				submittedAt: goalSubmissions.submittedAt,
				notes: goalSubmissions.notes,
				// Monthly goal info
				goalId: monthlyGoals.id,
				targetValue: monthlyGoals.targetValue,
				goalDescription: monthlyGoals.description,
				// Goal template info
				goalTemplateName: goalTemplates.name,
				goalTemplateUnit: goalTemplates.unit,
				isInverse: goalTemplates.isInverse,
				// User info
				userName: user.name,
				userEmail: user.email,
				areaName: areas.name,
				departmentName: departments.name,
			})
			.from(goalSubmissions)
			.leftJoin(monthlyGoals, eq(goalSubmissions.monthlyGoalId, monthlyGoals.id))
			.leftJoin(goalTemplates, eq(monthlyGoals.goalTemplateId, goalTemplates.id))
			.leftJoin(teamMembers, eq(monthlyGoals.teamMemberId, teamMembers.id))
			.leftJoin(user, eq(teamMembers.userId, user.id))
			.leftJoin(areas, eq(teamMembers.areaId, areas.id))
			.leftJoin(departments, eq(areas.departmentId, departments.id))
			.where(eq(goalSubmissions.presentationId, input.presentationId));

		return submissions.filter(submission => submission.goalId !== null && accessibleGoalIds.has(submission.goalId));
	});

export const getPresentationPayload = protectedProcedure
	.input(z.object({ presentationId: z.string().uuid() }))
	.handler(async ({ input, context }) => {
		if (!context.session?.user) {
			throw new Error("Unauthorized");
		}

		return await getPresentationPayloadData(input.presentationId, context.session.user);
	});

// Helper function to calculate progress percentage
function getProgressPercentage(target: string, achieved: string, isInverse?: boolean) {
	const targetNum = parseFloat(target);
	const achievedNum = parseFloat(achieved);

	if (targetNum <= 0) return 0;

	if (isInverse) {
		// Para metas inversas (reducción): menor valor logrado = mejor progreso
		// Si logrado <= objetivo = 100%, si logrado > objetivo = porcentaje reducido
		if (achievedNum <= targetNum) {
			return 100; // Cumplió o superó la meta de reducción
		} else {
			// Si excede el objetivo, calcular qué porcentaje representa
			return Math.max((targetNum / achievedNum) * 100, 0);
		}
	} else {
		// Para metas normales: mayor valor logrado = mejor progreso
		return (achievedNum / targetNum) * 100;
	}
}

function chunkGoals<T>(goals: T[], maxPerSlide = 4) {
	const chunks: T[][] = [];
	for (let i = 0; i < goals.length; i += maxPerSlide) {
		chunks.push(goals.slice(i, i + maxPerSlide));
	}
	return chunks;
}

function escapeHtml(value: string | number | null | undefined) {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function formatPdfNumber(value: string | number | null | undefined) {
	const numericValue = typeof value === "number" ? value : Number.parseFloat(value ?? "0");
	if (Number.isNaN(numericValue)) {
		return "0";
	}

	return numericValue.toLocaleString(undefined, {
		maximumFractionDigits: 2,
	});
}

function getProgressStatus(percentage: number) {
	if (percentage >= 80) {
		return { label: "Exitoso", badgeClass: "badge-green", textClass: "text-green-600" };
	}

	if (percentage >= 50) {
		return { label: "En Progreso", badgeClass: "badge-yellow", textClass: "text-yellow-600" };
	}

	return { label: "Necesita Atención", badgeClass: "badge-red", textClass: "text-red-600" };
}

function organizeDetailRowsForPDF(rows: PresentationDetailRow[]) {
	return rows.reduce<Record<string, Record<string, Record<string, PresentationDetailRow[]>>>>((accumulator, row) => {
		const departmentName = row.departmentName ?? "Sin Departamento";
		const areaName = row.areaName ?? "Sin Área";
		const userName = row.userName ?? "Sin Usuario";

		accumulator[departmentName] ??= {};
		accumulator[departmentName][areaName] ??= {};
		accumulator[departmentName][areaName][userName] ??= [];
		accumulator[departmentName][areaName][userName].push(row);

		return accumulator;
	}, {});
}

function organizeConsolidatedRowsForPDF(rows: PresentationConsolidatedRow[]) {
	return rows.reduce<Record<string, Record<string, PresentationConsolidatedRow[]>>>((accumulator, row) => {
		const departmentName = row.departmentName || "Sin Departamento";
		const areaName = row.areaName || "Sin Área";

		accumulator[departmentName] ??= {};
		accumulator[departmentName][areaName] ??= [];
		accumulator[departmentName][areaName].push(row);

		return accumulator;
	}, {});
}

function generatePresentationHTML(payload: PresentationPayload) {
	const { presentation, periods, detailRows, consolidatedRows } = payload;
	const periodLabel = formatPresentationPeriodLabel(presentation);
	const successfulGoals = detailRows.filter((row) => row.progressPercentage >= 80).length;
	const inProgressGoals = detailRows.filter((row) => row.progressPercentage >= 50 && row.progressPercentage < 80).length;
	const needsAttentionGoals = detailRows.filter((row) => row.progressPercentage < 50).length;
	const organizedConsolidated = organizeConsolidatedRowsForPDF(consolidatedRows);
	const organizedDetail = periods.map((period) => ({
		...period,
		rows: detailRows.filter((row) => row.month === period.month && row.year === period.year),
	}));

	const coverPage = `
		<section class="page cover-page">
			<div class="hero-card">
				<div class="eyebrow">CCI Sync</div>
				<h1 class="hero-title">${escapeHtml(presentation.name)}</h1>
				<p class="hero-subtitle">${escapeHtml(periodLabel)}</p>
				<div class="stats-grid">
					<div class="stat-card">
						<div class="stat-value text-blue-600">${detailRows.length}</div>
						<div class="stat-label">Metas en el rango</div>
					</div>
					<div class="stat-card">
						<div class="stat-value text-green-600">${consolidatedRows.length}</div>
						<div class="stat-label">Grupos consolidados</div>
					</div>
					<div class="stat-card">
						<div class="stat-value text-purple-600">${periods.length}</div>
						<div class="stat-label">Meses incluidos</div>
					</div>
				</div>
			</div>
		</section>
	`;

	const summaryPage = `
		<section class="page">
			<div class="section-header">
				<div>
					<div class="eyebrow">Resumen Ejecutivo</div>
					<h2 class="section-title">Consolidado y detalle mensual</h2>
					<p class="section-subtitle">${escapeHtml(periodLabel)}</p>
				</div>
				<div class="pill-row">
					<span class="pill">${periods.length} meses</span>
					<span class="pill">${consolidatedRows.length} grupos</span>
					<span class="pill">${detailRows.length} filas detalle</span>
				</div>
			</div>

			<div class="stats-grid">
				<div class="stat-card">
					<div class="stat-value text-green-600">${successfulGoals}</div>
					<div class="stat-label">Metas exitosas</div>
					<div class="stat-caption">Cumplimiento de 80% o más</div>
				</div>
				<div class="stat-card">
					<div class="stat-value text-yellow-600">${inProgressGoals}</div>
					<div class="stat-label">En progreso</div>
					<div class="stat-caption">Cumplimiento entre 50% y 79%</div>
				</div>
				<div class="stat-card">
					<div class="stat-value text-red-600">${needsAttentionGoals}</div>
					<div class="stat-label">Necesitan atención</div>
					<div class="stat-caption">Cumplimiento menor a 50%</div>
				</div>
			</div>

			<div class="callout">
				<p>
					El consolidado promedia objetivo y logro usando únicamente los meses existentes para cada meta.
					Luego se incluye el detalle mensual completo del mismo rango.
				</p>
			</div>
		</section>
	`;

	const consolidatedPages = Object.entries(organizedConsolidated)
		.flatMap(([departmentName, areasByDepartment]) =>
			Object.entries(areasByDepartment).map(([areaName, rows]) => {
				const tableRows = rows
					.sort((left, right) =>
						(left.userName ?? "").localeCompare(right.userName ?? "")
						|| (left.goalTemplateName ?? "").localeCompare(right.goalTemplateName ?? "")
					)
					.map((row) => {
						const status = getProgressStatus(row.consolidatedProgressPercentage);
						const includedMonths = row.includedMonths
							.map((period) => formatMonthPeriodLabel(period.month, period.year))
							.join(", ");

						return `
							<tr>
								<td>
									<div class="table-primary">${escapeHtml(row.userName ?? "Sin Usuario")}</div>
									<div class="table-secondary">${escapeHtml(row.userEmail ?? "")}</div>
								</td>
								<td>
									<div class="table-primary">${escapeHtml(row.goalTemplateName ?? "Sin Meta")}</div>
									<div class="table-secondary">${escapeHtml(row.goalTemplateUnit ?? "")}</div>
								</td>
								<td class="wrap-cell">${escapeHtml(includedMonths)}</td>
								<td class="text-right">${formatPdfNumber(row.consolidatedTargetValue)}</td>
								<td class="text-right">${formatPdfNumber(row.consolidatedAchievedValue)}</td>
								<td class="text-right">
									<div class="progress-cell">
										<div class="table-primary ${status.textClass}">${Math.round(row.consolidatedProgressPercentage)}%</div>
										<div class="progress-bar compact">
											<div class="progress-fill" style="width: ${Math.min(Math.max(row.consolidatedProgressPercentage, 0), 100)}%"></div>
										</div>
										<span class="badge ${status.badgeClass}">${status.label}</span>
									</div>
								</td>
							</tr>
						`;
					})
					.join("");

				return `
					<section class="page">
						<div class="section-header">
							<div>
								<div class="eyebrow">Vista Consolidada</div>
								<h2 class="section-title">${escapeHtml(departmentName)}</h2>
								<p class="section-subtitle">${escapeHtml(areaName)} · ${escapeHtml(periodLabel)}</p>
							</div>
							<div class="pill-row">
								<span class="pill">${rows.length} metas consolidadas</span>
							</div>
						</div>

						<table class="report-table">
							<thead>
								<tr>
									<th>Persona</th>
									<th>Meta</th>
									<th>Meses incluidos</th>
									<th class="text-right">Promedio objetivo</th>
									<th class="text-right">Promedio logrado</th>
									<th class="text-right">Promedio progreso</th>
								</tr>
							</thead>
							<tbody>
								${tableRows}
							</tbody>
						</table>
					</section>
				`;
			})
		)
		.join("");

	const detailPages = organizedDetail
		.map((period) => {
			const detailContent = organizeDetailRowsForPDF(period.rows);
			const sectionPages = Object.entries(detailContent)
				.flatMap(([departmentName, areasByDepartment]) =>
					Object.entries(areasByDepartment).flatMap(([areaName, people]) =>
						Object.entries(people).flatMap(([userName, goals]) => {
							const goalChunks = chunkGoals(
								goals.sort((left, right) => (left.goalTemplateName ?? "").localeCompare(right.goalTemplateName ?? "")),
								4,
							);

							return goalChunks.map((goalChunk, chunkIndex) => {
								const goalsHtml = goalChunk
									.map((goal) => {
										const status = getProgressStatus(goal.progressPercentage);
										return `
											<div class="goal-card">
												<div>
													<div class="goal-title">${escapeHtml(goal.goalTemplateName ?? "Sin Meta")}</div>
													<div class="goal-unit">${escapeHtml(goal.goalTemplateUnit ?? "")}</div>
												</div>
												<div class="goal-metrics">
													<div>
														<div class="metric-value text-blue-600">${formatPdfNumber(goal.achievedValue)}</div>
														<div class="metric-label">Logrado</div>
													</div>
													<div>
														<div class="metric-value text-gray-700">${formatPdfNumber(goal.targetValue)}</div>
														<div class="metric-label">${goal.isInverse ? "Meta (máx)" : "Objetivo"}</div>
													</div>
												</div>
												<div class="space-y-2">
													<div class="progress-meta">
														<span>Progreso</span>
														<span class="table-primary">${Math.round(goal.progressPercentage)}%</span>
													</div>
													<div class="progress-bar">
														<div class="progress-fill" style="width: ${Math.min(Math.max(goal.progressPercentage, 0), 100)}%"></div>
													</div>
													<span class="badge ${status.badgeClass}">${status.label}</span>
												</div>
												${goal.description ? `<div class="goal-note">${escapeHtml(goal.description)}</div>` : ""}
											</div>
										`;
									})
									.join("");

								return `
									<section class="page">
										<div class="section-header">
											<div>
												<div class="eyebrow">Detalle Mensual</div>
												<h2 class="section-title">${escapeHtml(period.label)}</h2>
												<p class="section-subtitle">${escapeHtml(departmentName)} · ${escapeHtml(areaName)} · ${escapeHtml(userName)}</p>
											</div>
											<div class="pill-row">
												<span class="pill">Slide ${chunkIndex + 1} de ${goalChunks.length}</span>
												<span class="pill">${goals.length} metas del mes</span>
											</div>
										</div>
										<div class="goal-grid goal-grid-${Math.min(goalChunk.length, 4)}">
											${goalsHtml}
										</div>
									</section>
								`;
							});
						})
					)
				)
				.join("");

			return `
				<section class="page month-cover">
					<div class="hero-card">
						<div class="eyebrow">Detalle Mensual</div>
						<h2 class="hero-title">${escapeHtml(period.label)}</h2>
						<p class="hero-subtitle">${period.rows.length} metas registradas en este mes</p>
					</div>
				</section>
				${sectionPages}
			`;
		})
		.join("");

	return `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="utf-8">
			<title>${presentation.name} - ${periodLabel}</title>
			<style>
				@page {
					margin: 1cm;
					size: A4 landscape;
				}
				* {
					box-sizing: border-box;
				}
				body {
					font-family: system-ui, -apple-system, sans-serif;
					margin: 0;
					padding: 0;
					line-height: 1.6;
					background: white;
				}
				.page {
					page-break-after: always;
					page-break-inside: avoid;
					min-height: 100vh;
					padding: 2.25rem;
					background: white;
				}
				.page:last-child {
					page-break-after: avoid;
				}
				.cover-page, .month-cover {
					display: flex;
					align-items: center;
					justify-content: center;
				}
				.text-center { text-align: center; }
				.text-right { text-align: right; }
				.font-bold { font-weight: bold; }
				.text-6xl { font-size: 3.75rem; line-height: 1; }
				.text-5xl { font-size: 3rem; line-height: 1; }
				.text-4xl { font-size: 2.25rem; line-height: 1; }
				.text-3xl { font-size: 1.875rem; line-height: 1; }
				.text-2xl { font-size: 1.5rem; line-height: 1; }
				.text-xl { font-size: 1.25rem; line-height: 1; }
				.text-lg { font-size: 1.125rem; line-height: 1; }
				.gradient-blue { color: #2563eb; }
				.gradient-green { color: #059669; }
				.gradient-purple { color: #7c3aed; }
				.text-gray-600 { color: #4b5563; }
				.text-blue-600 { color: #2563eb; }
				.text-green-600 { color: #059669; }
				.text-yellow-600 { color: #d97706; }
				.text-red-600 { color: #dc2626; }
				.text-purple-600 { color: #7c3aed; }
				.grid { display: grid; }
				.grid-cols-1 { grid-template-columns: repeat(1, 1fr); }
				.grid-cols-2 { grid-template-columns: repeat(2, 1fr); }
				.grid-cols-3 { grid-template-columns: repeat(3, 1fr); }
				.grid-cols-4 { grid-template-columns: repeat(4, 1fr); }
				.flex { display: flex; }
				.flex-col { flex-direction: column; }
				.justify-between { justify-content: space-between; }
				.justify-center { justify-content: center; }
				.align-center { align-items: center; }
				.min-h-[200px] { min-height: 200px; }
				.min-h-[220px] { min-height: 220px; }
				.min-h-[280px] { min-height: 280px; }
				.min-w-[280px] { min-width: 280px; }
				.max-w-5xl { max-width: 64rem; }
				.gap-6 { gap: 1.5rem; }
				.gap-4 { gap: 1rem; }
				.gap-8 { gap: 2rem; }
				.space-y-2 > * + * { margin-top: 0.5rem; }
				.space-y-3 > * + * { margin-top: 0.75rem; }
				.space-y-4 > * + * { margin-top: 1rem; }
				.space-y-6 > * + * { margin-top: 1.5rem; }
				.space-y-8 > * + * { margin-top: 2rem; }
				.break-all { word-break: break-all; }
				.break-words { word-break: break-word; }
				.leading-tight { line-height: 1.25; }
				.text-base { font-size: 1rem; line-height: 1.5rem; }
				.mb-2 { margin-bottom: 0.5rem; }
				.mb-3 { margin-bottom: 0.75rem; }
				.mb-4 { margin-bottom: 1rem; }
				.mb-6 { margin-bottom: 1.5rem; }
				.mb-8 { margin-bottom: 2rem; }
				.gap-3 { gap: 0.75rem; }
				.mt-6 { margin-top: 1.5rem; }
				.mt-12 { margin-top: 3rem; }
				.mx-auto { margin-left: auto; margin-right: auto; }
				.p-4 { padding: 1rem; }
				.p-6 { padding: 1.5rem; }
				.pt-6 { padding-top: 1.5rem; }
				.px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
				.py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
				.rounded-lg { border-radius: 0.5rem; }
				.bg-gray-50 { background-color: #f9fafb; }
				.bg-gray-100 { background-color: #f3f4f6; }
				.border { border: 1px solid #e5e7eb; }
				.card { background: white; border: 1px solid #e5e7eb; border-radius: 0.5rem; }
				.badge { display: inline-flex; align-items: center; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 500; }
				.badge-green { background-color: #dcfce7; color: #166534; }
				.badge-yellow { background-color: #fef3c7; color: #92400e; }
				.badge-red { background-color: #fee2e2; color: #991b1b; }
				.progress-bar { width: 100%; height: 1rem; background-color: #e5e7eb; border-radius: 0.5rem; overflow: hidden; }
				.progress-fill { height: 100%; background-color: #3b82f6; transition: width 0.3s ease; }
				.max-w-md { max-width: 28rem; }
				.max-w-2xl { max-width: 42rem; }
				.max-w-4xl { max-width: 56rem; }
				.max-w-6xl { max-width: 72rem; }
				.w-full { width: 100%; }
				.text-xs { font-size: 0.75rem; line-height: 1rem; }
				.text-sm { font-size: 0.875rem; line-height: 1.25rem; }
				.mt-2 { margin-top: 0.5rem; }
				.mb-3 { margin-bottom: 0.75rem; }
				.hero-card {
					width: 100%;
					max-width: 72rem;
					padding: 3rem;
					border: 1px solid #e5e7eb;
					border-radius: 1rem;
					background: linear-gradient(135deg, #eff6ff 0%, #ffffff 55%, #f5f3ff 100%);
					text-align: center;
				}
				.eyebrow {
					font-size: 0.75rem;
					font-weight: 700;
					letter-spacing: 0.12em;
					text-transform: uppercase;
					color: #6366f1;
					margin-bottom: 0.75rem;
				}
				.hero-title, .section-title {
					font-size: 2.5rem;
					line-height: 1.1;
					margin: 0;
					color: #111827;
				}
				.hero-subtitle, .section-subtitle {
					font-size: 1.1rem;
					color: #4b5563;
					margin-top: 0.5rem;
				}
				.section-header {
					display: flex;
					justify-content: space-between;
					align-items: flex-start;
					gap: 1rem;
					margin-bottom: 1.5rem;
				}
				.pill-row {
					display: flex;
					flex-wrap: wrap;
					gap: 0.5rem;
					justify-content: flex-end;
				}
				.pill {
					display: inline-flex;
					align-items: center;
					padding: 0.35rem 0.75rem;
					border-radius: 9999px;
					background: #f3f4f6;
					color: #374151;
					font-size: 0.8rem;
					font-weight: 600;
				}
				.stats-grid {
					display: grid;
					grid-template-columns: repeat(3, minmax(0, 1fr));
					gap: 1rem;
					margin-top: 2rem;
				}
				.stat-card {
					padding: 1.25rem;
					border-radius: 0.75rem;
					border: 1px solid #e5e7eb;
					background: rgba(255, 255, 255, 0.88);
				}
				.stat-value {
					font-size: 2rem;
					font-weight: 800;
				}
				.stat-label {
					font-size: 0.95rem;
					font-weight: 700;
					color: #111827;
					margin-top: 0.35rem;
				}
				.stat-caption {
					font-size: 0.8rem;
					color: #6b7280;
					margin-top: 0.25rem;
				}
				.callout {
					margin-top: 1.5rem;
					padding: 1rem 1.25rem;
					border-left: 4px solid #2563eb;
					background: #eff6ff;
					color: #1e3a8a;
					border-radius: 0.5rem;
				}
				.report-table {
					width: 100%;
					border-collapse: collapse;
					border: 1px solid #e5e7eb;
					border-radius: 0.75rem;
					overflow: hidden;
				}
				.report-table thead th {
					background: #f9fafb;
					color: #4b5563;
					font-size: 0.8rem;
					font-weight: 700;
					text-transform: uppercase;
					letter-spacing: 0.04em;
					padding: 0.85rem 0.9rem;
					border-bottom: 1px solid #e5e7eb;
				}
				.report-table tbody td {
					padding: 0.9rem;
					border-bottom: 1px solid #f3f4f6;
					vertical-align: top;
				}
				.report-table tbody tr:last-child td {
					border-bottom: none;
				}
				.table-primary {
					font-size: 0.92rem;
					font-weight: 700;
					color: #111827;
				}
				.table-secondary {
					font-size: 0.74rem;
					color: #6b7280;
					margin-top: 0.15rem;
				}
				.wrap-cell {
					font-size: 0.82rem;
					color: #374151;
					max-width: 13rem;
					line-height: 1.45;
				}
				.progress-cell {
					display: flex;
					flex-direction: column;
					align-items: flex-end;
					gap: 0.35rem;
				}
				.progress-bar.compact {
					height: 0.5rem;
					width: 7rem;
				}
				.goal-grid {
					display: grid;
					gap: 1rem;
				}
				.goal-grid-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
				.goal-grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
				.goal-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
				.goal-grid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
				.goal-card {
					display: flex;
					flex-direction: column;
					justify-content: space-between;
					min-height: 18rem;
					padding: 1.25rem;
					border: 1px solid #e5e7eb;
					border-radius: 0.9rem;
					background: white;
				}
				.goal-title {
					font-size: 1rem;
					font-weight: 700;
					color: #111827;
					line-height: 1.35;
				}
				.goal-unit {
					font-size: 0.8rem;
					color: #6b7280;
					margin-top: 0.25rem;
				}
				.goal-metrics {
					display: grid;
					grid-template-columns: repeat(2, minmax(0, 1fr));
					gap: 0.75rem;
					text-align: center;
					margin: 1rem 0;
				}
				.metric-value {
					font-size: 1.2rem;
					font-weight: 800;
				}
				.metric-label {
					font-size: 0.75rem;
					color: #6b7280;
					margin-top: 0.15rem;
				}
				.progress-meta {
					display: flex;
					justify-content: space-between;
					font-size: 0.82rem;
					color: #374151;
				}
				.goal-note {
					margin-top: 0.8rem;
					padding: 0.75rem;
					border-radius: 0.65rem;
					background: #f9fafb;
					font-size: 0.78rem;
					color: #4b5563;
				}
			</style>
		</head>
		<body>
			${coverPage}
			${summaryPage}
			${consolidatedPages}
			${detailPages}
		</body>
		</html>
	`;
}

// Utility function for PDF generation
export async function generatePDF(
	presentationId: string,
	baseUrl: string = "http://localhost:3001",
	currentUser: { id: string; role: string },
) {
	let browser;
	
	try {
		console.log(`Starting PDF generation for presentation ${presentationId}`);
		
		const payload = await getPresentationPayloadData(presentationId, currentUser);
		console.log(`Found presentation: ${payload.presentation.name} with ${payload.detailRows.length} detail rows`);
		
		const htmlContent = generatePresentationHTML(payload);
		
		browser = await puppeteer.launch({
			headless: true,
			executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
			args: [
				'--no-sandbox',
				'--disable-setuid-sandbox',
				'--disable-dev-shm-usage',
				'--disable-gpu',
				'--disable-web-security',
				'--disable-features=VizDisplayCompositor'
			]
		});
		
		console.log('Browser launched successfully');
		
		const page = await browser.newPage();
		
		// Set viewport for consistent rendering
		await page.setViewport({ width: 1920, height: 1080 });
		
		// Set the HTML content directly
		await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
		console.log('HTML content set successfully');
		
		// Generate PDF
		console.log('Generating PDF...');
		const pdfBuffer = await page.pdf({
			format: 'A4',
			landscape: true,
			margin: {
				top: '1cm',
				right: '1cm',
				bottom: '1cm',
				left: '1cm'
			},
			printBackground: true,
			preferCSSPageSize: true
		});
		
		console.log(`PDF generated successfully. Size: ${pdfBuffer.length} bytes`);
		
		// Convert to base64 for ORPC transport
		const base64PDF = Buffer.from(pdfBuffer).toString('base64');
		console.log(`PDF converted to base64. Size: ${base64PDF.length} characters`);
		
		return {
			pdf: base64PDF,
			filename: `${payload.presentation.name} - ${formatPresentationPeriodLabel(payload.presentation)} - Consolidado y Detalle.pdf`
		};
		
	} catch (error) {
		console.error('Error in PDF generation:', error);
		
		if (error instanceof ORPCError) {
			throw error;
		}
		
		throw new ORPCError("INTERNAL_SERVER_ERROR", { 
			message: `PDF generation failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
		});
	} finally {
		if (browser) {
			await browser.close();
			console.log('Browser closed');
		}
	}
}

// Generate PDF for presentation
export const generatePresentationPDF = protectedProcedure
	.input(z.object({ 
		presentationId: z.string().uuid(),
		baseUrl: z.string().url().optional().default("http://localhost:3001")
	}))
	.handler(async ({ input, context }) => {
		if (!context.session?.user) {
			throw new Error("Unauthorized");
		}

		return await generatePDF(input.presentationId, input.baseUrl, context.session.user);
	});
