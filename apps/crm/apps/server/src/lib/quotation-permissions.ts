import { ROLES } from "./roles";

export function canManageQuotations(role: string | null | undefined): boolean {
	return (
		role === ROLES.SALES ||
		role === ROLES.SALES_SUPERVISOR ||
		role === ROLES.ADMIN
	);
}

export function canManageAnyQuotation(role: string | null | undefined): boolean {
	return role === ROLES.SALES_SUPERVISOR || role === ROLES.ADMIN;
}
