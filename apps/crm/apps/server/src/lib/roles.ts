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
	ACCOUNTING: "accounting",
	INVESTMENT_ADVISOR_JR: "investment_advisor_jr",
	INVESTMENT_ADVISOR_SR: "investment_advisor_sr",
	INVESTMENT_MANAGER: "investment_manager",
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
	[ROLES.ACCOUNTING]: {
		label: "Contabilidad",
		color: "bg-teal-100 text-teal-800",
		icon: "Calculator" as const,
	},
	[ROLES.INVESTMENT_ADVISOR_JR]: {
		label: "Asesor de Inversiones Jr",
		color: "bg-emerald-100 text-emerald-800",
		icon: "TrendingUp" as const,
	},
	[ROLES.INVESTMENT_ADVISOR_SR]: {
		label: "Asesor de Inversiones Sr",
		color: "bg-cyan-100 text-cyan-800",
		icon: "TrendingUp" as const,
	},
	[ROLES.INVESTMENT_MANAGER]: {
		label: "Gerente de Inversiones",
		color: "bg-sky-100 text-sky-800",
		icon: "Landmark" as const,
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

	canDeleteOpportunities: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN || role === ROLES.SALES_SUPERVISOR,

	canExportReports: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN ||
		role === ROLES.ANALYST ||
		role === ROLES.SALES_SUPERVISOR,

	canAccessClosedCreditsReport: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN || role === ROLES.COBROS_SUPERVISOR,

	canAccessTiempoCierreReport: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN || role === ROLES.COBROS_SUPERVISOR,

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
		role === ROLES.ANALYST ||
		role === ROLES.ACCOUNTING,

	canCreateLegalContracts: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN || role === ROLES.JURIDICO,

	canAssignLegalContracts: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN,

	canDeleteLegalContracts: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN,

	canApproveLegalStage: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN || role === ROLES.JURIDICO,

	// Confirm contracts have been signed (85% → 90%)
	canConfirmContractsSigning: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN ||
		role === ROLES.SALES ||
		role === ROLES.SALES_SUPERVISOR ||
		role === ROLES.ANALYST ||
		role === ROLES.JURIDICO,

	// Clients Module Access
	canAccessClients: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN ||
		role === ROLES.COBROS_SUPERVISOR ||
		role === ROLES.COBROS ||
		role === ROLES.ACCOUNTING ||
		role === ROLES.JURIDICO ||
		role === ROLES.SALES ||
		role === ROLES.SALES_SUPERVISOR ||
		role === ROLES.ANALYST,

	// Vehicles Module Access - All roles can access
	canAccessVehicles: (_role: UserRole | string): boolean => true,

	// Accounting Module Access (Contabilidad)
	canAccessAccounting: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN || role === ROLES.ACCOUNTING,

	// Investment Module Access
	canAccessInvestments: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN ||
		role === ROLES.INVESTMENT_ADVISOR_JR ||
		role === ROLES.INVESTMENT_ADVISOR_SR ||
		role === ROLES.INVESTMENT_MANAGER,

	canManageInvestmentLeads: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN ||
		role === ROLES.INVESTMENT_ADVISOR_JR ||
		role === ROLES.INVESTMENT_ADVISOR_SR ||
		role === ROLES.INVESTMENT_MANAGER,

	canApproveInvestmentDocuments: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN || role === ROLES.ANALYST,

	canValidateInvestmentFunds: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN || role === ROLES.INVESTMENT_MANAGER,

	canViewFullInvestmentPipeline: (role: UserRole | string): boolean =>
		role === ROLES.ADMIN ||
		role === ROLES.INVESTMENT_ADVISOR_SR ||
		role === ROLES.INVESTMENT_MANAGER ||
		role === ROLES.ANALYST,
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
