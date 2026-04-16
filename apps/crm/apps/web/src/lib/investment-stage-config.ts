const INVESTMENT_ACTIVE_STAGE_DEFINITIONS = [
	{
		id: "data_collection",
		name: "Levantamiento de Datos",
		color: "#2563eb",
		kind: "active",
	},
	{
		id: "basic_profile_validation",
		name: "Contactado / Validación de Perfil Básico",
		color: "#4f46e5",
		kind: "active",
	},
	{
		id: "profiling_and_qualification",
		name: "Perfilado y Calificación",
		color: "#7c3aed",
		kind: "active",
	},
	{
		id: "model_presentation",
		name: "Presentación del Modelo",
		color: "#0f766e",
		kind: "active",
	},
	{
		id: "active_follow_up",
		name: "Seguimiento Activo",
		color: "#d97706",
		kind: "active",
	},
	{
		id: "verbal_commitment_contract_sent",
		name: "Compromiso Verbal y Envío de Contrato",
		color: "#dc2626",
		kind: "active",
	},
	{
		id: "ticket_closure_transfer_activation",
		name: "Cierre del Ticket",
		color: "#059669",
		kind: "active",
	},
	{
		id: "initial_onboarding_senior_handoff",
		name: "Onboarding Inicial y Transferencia al Senior",
		color: "#16a34a",
		kind: "active",
	},
] as const;

export const INVESTMENT_LOST_STAGE = {
	id: "lost",
	name: "Perdida",
	color: "#dc2626",
	kind: "terminal",
} as const;

export const INVESTMENT_STAGE_CATALOG = [
	...INVESTMENT_ACTIVE_STAGE_DEFINITIONS,
	INVESTMENT_LOST_STAGE,
] as const;

export type InvestmentStageId = (typeof INVESTMENT_STAGE_CATALOG)[number]["id"];

export type InvestmentStageKind =
	(typeof INVESTMENT_STAGE_CATALOG)[number]["kind"];

export type InvestmentStageConfig = {
	id: InvestmentStageId;
	name: string;
	color: string;
	kind: InvestmentStageKind;
};

export const INVESTMENT_ACTIVE_STAGES =
	INVESTMENT_ACTIVE_STAGE_DEFINITIONS satisfies readonly InvestmentStageConfig[];

export const INVESTMENT_STAGES =
	INVESTMENT_STAGE_CATALOG satisfies readonly InvestmentStageConfig[];
