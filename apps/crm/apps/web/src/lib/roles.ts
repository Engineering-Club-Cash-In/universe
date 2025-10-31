// Single source of truth for role definitions
export const ROLES = {
	ADMIN: "admin",
	SALES: "sales",
	ANALYST: "analyst",
	COBROS: "cobros",
	JURIDICO: "juridico",
} as const;

export type UserRole = (typeof ROLES)[keyof typeof ROLES];

// Role display configuration
export const ROLE_CONFIG = {
	[ROLES.ADMIN]: {
		label: "Administrador",
		color: "bg-red-100 text-red-800",
		icon: "Shield",
	},
	[ROLES.SALES]: {
		label: "Ventas",
		color: "bg-blue-100 text-blue-800",
		icon: "User",
	},
	[ROLES.ANALYST]: {
		label: "Analista",
		color: "bg-purple-100 text-purple-800",
		icon: "FileText",
	},
	[ROLES.COBROS]: {
		label: "Cobros",
		color: "bg-green-100 text-green-800",
		icon: "DollarSign",
	},
	[ROLES.JURIDICO]: {
		label: "Jurídico",
		color: "bg-amber-100 text-amber-800",
		icon: "Scale",
	},
} as const;

// Permission checks
export const PERMISSIONS = {
	canAccessCRM: (role: string) => role === ROLES.ADMIN || role === ROLES.SALES,
	canAccessAnalysis: (role: string) =>
		role === ROLES.ADMIN || role === ROLES.ANALYST,
	canAccessAdmin: (role: string) => role === ROLES.ADMIN,
	canCreateCompanies: (role: string) =>
		role === ROLES.ADMIN || role === ROLES.SALES,
	canCreateLeads: (role: string) =>
		role === ROLES.ADMIN || role === ROLES.SALES,
	canApproveOpportunities: (role: string) =>
		role === ROLES.ADMIN || role === ROLES.ANALYST,
	canAccessCobros: (role: string) =>
		role === ROLES.ADMIN || role === ROLES.COBROS,
	canAccessWhatsApp: (role: string) =>
		role === ROLES.ADMIN || role === ROLES.SALES,
	canAccessJuridico: (role: string) =>
		role === ROLES.ADMIN || role === ROLES.JURIDICO || role === ROLES.SALES || role === ROLES.ANALYST,
	canCreateLegalContracts: (role: string) =>
		role === ROLES.ADMIN || role === ROLES.JURIDICO,
	canAssignLegalContracts: (role: string) =>
		role === ROLES.ADMIN || role === ROLES.JURIDICO,
	canDeleteLegalContracts: (role: string) =>
		role === ROLES.ADMIN,
} as const;

// Helper functions
export const getRoleLabel = (role: string): string => {
	return ROLE_CONFIG[role as UserRole]?.label || role;
};

export const getRoleColor = (role: string): string => {
	return ROLE_CONFIG[role as UserRole]?.color || "bg-gray-100 text-gray-800";
};

export const getRoleIcon = (role: string): string => {
	return ROLE_CONFIG[role as UserRole]?.icon || "User";
};
