// Shared role definitions - this is the single source of truth
// These are imported by both server and client code

export const ROLES = {
	ADMIN: "admin",
	SALES: "sales",
	ANALYST: "analyst",
	COBROS: "cobros",
} as const;

export type UserRole = typeof ROLES[keyof typeof ROLES];

// Role display configuration
export const ROLE_CONFIG = {
	[ROLES.ADMIN]: {
		label: "Administrador",
		color: "bg-red-100 text-red-800",
		icon: "Shield" as const,
	},
	[ROLES.SALES]: {
		label: "Ventas",
		color: "bg-blue-100 text-blue-800",
		icon: "User" as const,
	},
	[ROLES.ANALYST]: {
		label: "Analista",
		color: "bg-purple-100 text-purple-800",
		icon: "FileText" as const,
	},
	[ROLES.COBROS]: {
		label: "Cobros",
		color: "bg-green-100 text-green-800",
		icon: "DollarSign" as const,
	},
} as const;

// Permission definitions - these match the server-side access control
export const PERMISSIONS = {
	// CRM Module Access
	canAccessCRM: (role: UserRole | string): boolean => 
		(role === ROLES.ADMIN || role === ROLES.SALES),
	
	// Analysis Module Access  
	canAccessAnalysis: (role: UserRole | string): boolean => 
		(role === ROLES.ADMIN || role === ROLES.ANALYST),
	
	// Admin Module Access
	canAccessAdmin: (role: UserRole | string): boolean => 
		role === ROLES.ADMIN,
	
	// Entity Permissions
	canCreateCompanies: (role: UserRole | string): boolean => 
		(role === ROLES.ADMIN || role === ROLES.SALES),
	
	canCreateLeads: (role: UserRole | string): boolean => 
		(role === ROLES.ADMIN || role === ROLES.SALES),
	
	canUpdateLeads: (role: UserRole | string): boolean => 
		(role === ROLES.ADMIN || role === ROLES.SALES),
	
	canDeleteLeads: (role: UserRole | string): boolean => 
		role === ROLES.ADMIN,
	
	canApproveOpportunities: (role: UserRole | string): boolean => 
		(role === ROLES.ADMIN || role === ROLES.ANALYST),
	
	canExportReports: (role: UserRole | string): boolean => 
		(role === ROLES.ADMIN || role === ROLES.ANALYST),
	
	// Cobros Module Access
	canAccessCobros: (role: UserRole | string): boolean => 
		(role === ROLES.ADMIN || role === ROLES.COBROS),
	
	canManagePayments: (role: UserRole | string): boolean => 
		(role === ROLES.ADMIN || role === ROLES.COBROS),
	
	canViewPaymentReports: (role: UserRole | string): boolean =>
		(role === ROLES.ADMIN || role === ROLES.COBROS || role === ROLES.ANALYST),

	// WhatsApp Module Access
	canAccessWhatsApp: (role: UserRole | string): boolean =>
		(role === ROLES.ADMIN || role === ROLES.SALES),
} as const;

// Helper functions
export const getRoleLabel = (role: UserRole | string): string => {
	return ROLE_CONFIG[role as UserRole]?.label || role;
};

export const getRoleColor = (role: UserRole | string): string => {
	return ROLE_CONFIG[role as UserRole]?.color || "bg-gray-100 text-gray-800";
};

export const getRoleIcon = (role: UserRole | string): string => {
	return ROLE_CONFIG[role as UserRole]?.icon || "User";
};

// Export all roles as an array for iteration
export const ALL_ROLES = Object.values(ROLES);

// Type guard
export const isValidRole = (role: string): role is UserRole => {
	return ALL_ROLES.includes(role as UserRole);
};