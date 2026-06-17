export type MembershipAdjustmentCategory =
	| "Nuevo (sedán, SUV, pickup)"
	| "Nuevo (camión, microbus, panel, uber o similar)"
	| "Usado agencia"
	| "Rodado"
	| "Sobre vehículo (hasta 50%)";

export interface MembershipAdjustmentInput {
	creditType: "autocompra" | "sobre_vehiculo";
	insuredAmount: number;
	vehicleType: string;
	isNew: boolean;
	origin?: string | null;
}

export interface MembershipAdjustment {
	category: MembershipAdjustmentCategory;
	percentage: number;
	factor: number;
}

const RATES: Record<MembershipAdjustmentCategory, [number, number, number]> = {
	"Nuevo (sedán, SUV, pickup)": [18.75, 33.59, 35],
	"Nuevo (camión, microbus, panel, uber o similar)": [25, 44.53, 46.25],
	"Usado agencia": [31.25, 55.47, 57.5],
	Rodado: [37.5, 67.19, 70],
	"Sobre vehículo (hasta 50%)": [37.5, 67.19, 70],
};

const NEW_PERSONAL_TYPES = new Set([
	"particular",
	"nuevo",
	"sedan",
	"sedán",
	"suv",
	"pickup",
]);
const NEW_COMMERCIAL_TYPES = new Set([
	"camion",
	"camión",
	"microbus",
	"microbus_20",
	"microbus_35",
	"microbus_36plus",
	"panel",
	"uber",
]);
const RODADO_ORIGINS = ["rodado", "importado", "subasta"];

function normalize(value?: string | null): string {
	return value?.trim().toLowerCase() ?? "";
}

function getRangeIndex(insuredAmount: number): 0 | 1 | 2 {
	if (insuredAmount <= 100000) return 0;
	if (insuredAmount <= 140000) return 1;
	return 2;
}

function getCategory(input: MembershipAdjustmentInput): MembershipAdjustmentCategory {
	if (input.creditType === "sobre_vehiculo") return "Sobre vehículo (hasta 50%)";

	const vehicleType = normalize(input.vehicleType);
	if (input.isNew) {
		if (NEW_COMMERCIAL_TYPES.has(vehicleType)) {
			return "Nuevo (camión, microbus, panel, uber o similar)";
		}
		if (NEW_PERSONAL_TYPES.has(vehicleType)) return "Nuevo (sedán, SUV, pickup)";
		return "Nuevo (sedán, SUV, pickup)";
	}

	const origin = normalize(input.origin);
	if (RODADO_ORIGINS.some((keyword) => origin.includes(keyword))) {
		return "Rodado";
	}

	return "Usado agencia";
}

export function getMembershipAdjustment(
	input: MembershipAdjustmentInput,
): MembershipAdjustment {
	const category = getCategory(input);
	const percentage = RATES[category][getRangeIndex(input.insuredAmount)];

	return {
		category,
		percentage,
		factor: 1 + percentage / 100,
	};
}

export function applyMembershipAdjustment(
	membershipCost: number,
	adjustment: MembershipAdjustment,
): number {
	return Math.round(membershipCost * adjustment.factor * 100) / 100;
}
