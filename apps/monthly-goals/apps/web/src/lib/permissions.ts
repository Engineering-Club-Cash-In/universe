import { authClient } from "@/lib/auth-client";

type UserRole = "super_admin" | "department_manager" | "area_lead" | "employee" | "viewer";

export function usePermissions() {
	const { data: session } = authClient.useSession();
	const role = session?.user?.role as UserRole;

	return {
		// Admin access levels
		hasAdminAccess: role === "super_admin" || role === "department_manager" || role === "area_lead",
		
		// Specific management permissions
		canManageDepartments: role === "super_admin",
		canManageAreas: role === "super_admin" || role === "department_manager", 
		canManageTeams: role === "super_admin" || role === "department_manager" || role === "area_lead",
		
		// Goals permissions
		canConfigureGoals: role === "super_admin" || role === "department_manager" || role === "area_lead",
		canEditGoals: role !== "viewer",
		
		// User management
		canManageUsers: role === "super_admin" || role === "department_manager" || role === "area_lead",
		canCreateUsers: role === "super_admin" || role === "department_manager" || role === "area_lead",
		canDeleteUsers: role === "super_admin",
		canCreateUserWithRole: (targetRole: string) => {
			const roleHierarchy: Record<UserRole, UserRole[]> = {
				super_admin: ["super_admin", "department_manager", "area_lead", "employee", "viewer"],
				department_manager: ["area_lead", "employee"],
				area_lead: ["employee"],
				employee: [],
				viewer: []
			};
			
			const allowedRoles = roleHierarchy[role as UserRole] || [];
			return allowedRoles.includes(targetRole as UserRole);
		},
		
		// Current user info
		currentRole: role,
		session,
	};
}