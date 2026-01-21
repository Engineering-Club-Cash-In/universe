// Shared role definitions - this is the single source of truth
// These are imported by both server and client code

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
		icon: "Shield" as const,
	},
	[ROLES.SALES]: {
		label: "Ventas",
		color: "bg-blue-100 text-blue-800",
		icon: "User" as const,
	},
	[ROLES.SALES_SUPERVISOR]: {
		label: "Supervisor de Ventas",
		color: "bg-indigo-100 text-indigo-800",
		icon: "UserCheck" as const,
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
	[ROLES.COBROS_SUPERVISOR]: {
		label: "Supervisor de Cobros",
		color: "bg-orange-100 text-orange-800",
		icon: "UserCheck" as const,
	},
	[ROLES.JURIDICO]: {
		label: "Jurídico",
		color: "bg-amber-100 text-amber-800",
		icon: "Scale" as const,
	},
} as const;

// Permission definitions - these match the server-side access control
export const PERMISSIONS = {
	// CRM Module Access (analyst can view but not create/edit)
	canAccessCRM: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN ||
		role === ROLES.SALES ||
		role === ROLES.SALES_SUPERVISOR ||
		role === ROLES.ANALYST ||
		role === ROLES.JURIDICO,

	// Analysis Module Access
	canAccessAnalysis: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN ||
		role === ROLES.ANALYST ||
		role === ROLES.SALES_SUPERVISOR,

	// Admin Module Access
	canAccessAdmin: (role: UserRole | string): boolean => role === ROLES.ADMIN,

	// Entity Permissions
	canCreateCompanies: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN ||
		role === ROLES.SALES ||
		role === ROLES.SALES_SUPERVISOR,

	canCreateLeads: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN ||
		role === ROLES.SALES ||
		role === ROLES.SALES_SUPERVISOR,

	canUpdateLeads: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN ||
		role === ROLES.SALES ||
		role === ROLES.SALES_SUPERVISOR ||
		role === ROLES.ANALYST,

	canDeleteLeads: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN || role === ROLES.SALES_SUPERVISOR,

	canCreateOpportunities: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN ||
		role === ROLES.SALES ||
		role === ROLES.SALES_SUPERVISOR,

	canApproveOpportunities: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN || role === ROLES.ANALYST,

	canExportReports: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN ||
		role === ROLES.ANALYST ||
		role === ROLES.SALES_SUPERVISOR,

	// Credit Detail Approval (40% → 50%)
	canApproveCreditDetail: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN || role === ROLES.SALES_SUPERVISOR,

	// Cobros Module Access
	canAccessCobros: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN ||
		role === ROLES.COBROS ||
		role === ROLES.COBROS_SUPERVISOR,

	canManagePayments: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN ||
		role === ROLES.COBROS ||
		role === ROLES.COBROS_SUPERVISOR,

	canViewPaymentReports: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN ||
		role === ROLES.COBROS ||
		role === ROLES.COBROS_SUPERVISOR ||
		role === ROLES.ANALYST,

	canAssignCobros: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN || role === ROLES.COBROS_SUPERVISOR,

	canViewAllCasosCobros: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN || role === ROLES.COBROS_SUPERVISOR,

	// WhatsApp Module Access
	canAccessWhatsApp: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN ||
		role === ROLES.SALES ||
		role === ROLES.SALES_SUPERVISOR,

	// Juridico Module Access
	canAccessJuridico: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN || role === ROLES.JURIDICO,

	// View contracts in opportunities (for sales to see contract status)
	canViewOpportunityContracts: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN ||
		role === ROLES.JURIDICO ||
		role === ROLES.SALES ||
		role === ROLES.SALES_SUPERVISOR ||
		role === ROLES.ANALYST,

	canCreateLegalContracts: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN || role === ROLES.JURIDICO,

	canAssignLegalContracts: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN,

	canDeleteLegalContracts: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN,

	canApproveLegalStage: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN || role === ROLES.JURIDICO,

	// Vehicles Module Access - All roles can access
	canAccessVehicles: (_role: UserRole | string): boolean => true,
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
