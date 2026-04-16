import { ROLES } from "./roles";

export function canAccessSalesTeamActions(
	role: string | null | undefined,
): boolean {
	return (
		role === ROLES.SALES ||
		role === ROLES.SALES_SUPERVISOR ||
		role === ROLES.ADMIN
	);
}

export function canManageAnySalesOwnedRecord(
	role: string | null | undefined,
): boolean {
	return role === ROLES.SALES_SUPERVISOR || role === ROLES.ADMIN;
}
