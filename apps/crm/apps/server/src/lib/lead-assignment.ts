import { and, count, eq, gte } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { leads } from "../db/schema/crm";
import { ROLES } from "./roles";

export type LeadAssignableUser = {
	id?: string;
	role: string | null | undefined;
	assignLeads: boolean | null | undefined;
	banned: boolean | null | undefined;
};

export function canReceiveAutoAssignedLead(
	user: LeadAssignableUser | null | undefined,
): boolean {
	return (
		user?.role === ROLES.SALES &&
		user.assignLeads === true &&
		user.banned !== true
	);
}

export function getSalesUserWithLeastAutoAssignedLeads(
	salesUsers: Array<LeadAssignableUser & { id: string }>,
	leadCounts: ReadonlyMap<string, number>,
): (LeadAssignableUser & { id: string }) | null {
	let selectedUser = salesUsers[0] ?? null;
	let selectedCount = selectedUser ? (leadCounts.get(selectedUser.id) ?? 0) : 0;

	for (const salesUser of salesUsers) {
		const userCount = leadCounts.get(salesUser.id) ?? 0;
		if (selectedUser && userCount < selectedCount) {
			selectedUser = salesUser;
			selectedCount = userCount;
		}
	}

	return selectedUser;
}

export function resolveExistingLeadAssignee(
	currentOwner: LeadAssignableUser | null | undefined,
	fallbackSalesUser: LeadAssignableUser | null,
): string | null {
	if (canReceiveAutoAssignedLead(currentOwner)) {
		return currentOwner?.id ?? null;
	}

	return fallbackSalesUser?.id ?? null;
}

export async function findSalesUserWithLeastAutoAssignedLeads() {
	const salesUsers = await db
		.select({
			id: user.id,
			role: user.role,
			assignLeads: user.assignLeads,
			banned: user.banned,
		})
		.from(user)
		.where(
			and(
				eq(user.role, ROLES.SALES),
				eq(user.assignLeads, true),
				eq(user.banned, false),
			),
		);
	const startOfToday = new Date(
		new Date().toLocaleDateString("en-US", {
			timeZone: "America/Guatemala",
		}),
	);
	const leadCounts = await db
		.select({ assignedTo: leads.assignedTo, count: count(leads.id) })
		.from(leads)
		.where(
			and(eq(leads.assignmentType, "auto"), gte(leads.createdAt, startOfToday)),
		)
		.groupBy(leads.assignedTo);
	const countMap = new Map<string, number>();

	for (const leadCount of leadCounts) {
		if (leadCount.assignedTo) {
			countMap.set(leadCount.assignedTo, leadCount.count);
		}
	}

	return getSalesUserWithLeastAutoAssignedLeads(salesUsers, countMap);
}

export async function resolveExistingLeadAssigneeFromDatabase(
	existingAssignedTo?: string | null,
) {
	const [currentOwner] = existingAssignedTo
		? await db
				.select({
					id: user.id,
					role: user.role,
					assignLeads: user.assignLeads,
					banned: user.banned,
				})
				.from(user)
				.where(eq(user.id, existingAssignedTo))
				.limit(1)
		: [];

	if (canReceiveAutoAssignedLead(currentOwner)) {
		return currentOwner?.id ?? null;
	}

	return resolveExistingLeadAssignee(
		null,
		await findSalesUserWithLeastAutoAssignedLeads(),
	);
}
