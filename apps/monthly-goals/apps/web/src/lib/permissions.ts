import { authClient } from "@/lib/auth-client";

type UserRole = "super_admin" | "department_manager" | "area_lead" | "employee" | "viewer";

export function usePermissions() {
	const { data: session } = authClient.useSession();
	const role = session?.user.role as UserRole;

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
		canCreateUsers: role === "super_admin" || role === "department_manager" || role === "area_lead",
		
		// Current user info
		currentRole: role,
		session,
	};
}