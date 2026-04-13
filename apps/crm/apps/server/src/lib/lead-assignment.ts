import { ROLES } from "./roles";

type LeadAssignableUser = {
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
