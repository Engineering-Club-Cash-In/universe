// Single source of truth for role definitions
export const ROLES = {
	ADMIN: "admin",
	SALES: "sales",
	SALES_SUPERVISOR: "sales_supervisor",
	ANALYST: "analyst",
	COBROS: "cobros",
	COBROS_SUPERVISOR: "cobros_supervisor",
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
	[ROLES.SALES_SUPERVISOR]: {
		label: "Supervisor de Ventas",
		color: "bg-indigo-100 text-indigo-800",
		icon: "UserCheck",
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
	[ROLES.COBROS_SUPERVISOR]: {
		label: "Supervisor de Cobros",
		color: "bg-cyan-100 text-cyan-800",
		icon: "UserCheck",
	},
	[ROLES.JURIDICO]: {
		label: "Jurídico",
		color: "bg-amber-100 text-amber-800",
		icon: "Scale",
	},
} as const;

// Permission checks - synced with server
export const PERMISSIONS = {
	// CRM Module Access
	canAccessCRM: (role: string) =>
		role === ROLES.ADMIN ||
		role === ROLES.SALES ||
		role === ROLES.SALES_SUPERVISOR ||
		role === ROLES.ANALYST,

	// Analysis Module Access
	canAccessAnalysis: (role: string) =>
		role === ROLES.ADMIN ||
		role === ROLES.ANALYST ||
		role === ROLES.SALES_SUPERVISOR,

	// Admin Module Access
	canAccessAdmin: (role: string) => role === ROLES.ADMIN,

	// Entity Permissions
	canCreateCompanies: (role: string) =>
		role === ROLES.ADMIN ||
		role === ROLES.SALES ||
		role === ROLES.SALES_SUPERVISOR,

	canCreateLeads: (role: string) =>
		role === ROLES.ADMIN ||
		role === ROLES.SALES ||
		role === ROLES.SALES_SUPERVISOR,

	canCreateOpportunities: (role: string) =>
		role === ROLES.ADMIN ||
		role === ROLES.SALES ||
		role === ROLES.SALES_SUPERVISOR,

	canApproveOpportunities: (role: string) =>
		role === ROLES.ADMIN || role === ROLES.ANALYST,

	// Cobros Module Access
	canAccessCobros: (role: string) =>
		role === ROLES.ADMIN ||
		role === ROLES.COBROS ||
		role === ROLES.COBROS_SUPERVISOR,

	// WhatsApp Module Access
	canAccessWhatsApp: (role: string) =>
		role === ROLES.ADMIN ||
		role === ROLES.SALES ||
		role === ROLES.SALES_SUPERVISOR,

	// Juridico Module Access
	canAccessJuridico: (role: string) =>
		role === ROLES.ADMIN ||
		role === ROLES.JURIDICO ||
		role === ROLES.SALES ||
		role === ROLES.SALES_SUPERVISOR ||
		role === ROLES.ANALYST,

	canCreateLegalContracts: (role: string) =>
		role === ROLES.ADMIN || role === ROLES.JURIDICO,

	canAssignLegalContracts: (role: string) =>
		role === ROLES.ADMIN || role === ROLES.JURIDICO,

	canDeleteLegalContracts: (role: string) => role === ROLES.ADMIN,
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

// Export all roles as an array for iteration
export const ALL_ROLES = Object.values(ROLES);

// Type guard
export const isValidRole = (role: string): role is UserRole => {
	return ALL_ROLES.includes(role as UserRole);
};
