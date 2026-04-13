import {
	canAccessSalesTeamActions,
	canManageAnySalesOwnedRecord,
} from "./sales-permissions";

export function canManageQuotations(role: string | null | undefined): boolean {
	return canAccessSalesTeamActions(role);
}

export function canManageAnyQuotation(role: string | null | undefined): boolean {
	return canManageAnySalesOwnedRecord(role);
}
