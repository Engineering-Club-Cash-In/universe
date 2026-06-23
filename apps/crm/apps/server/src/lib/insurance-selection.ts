export type InsuranceProvider = "universales" | "gyt";

export interface InsuranceSelectionInput {
	insuredAmount: number;
	vehicleType: string;
	universalesCost: number;
	gytCost: number | null;
	membershipCost: number;
}

export interface InsuranceSelectionResult {
	provider: InsuranceProvider;
	customerInsuranceCost: number;
	internalInsuranceCost: number;
	insuranceSavingsToMembership: number;
	effectiveMembershipCost: number;
}

export interface InsurancePersistenceInput extends InsuranceSelectionInput {
	customerInsuranceCost?: number;
	clientBreakdown?: {
		insuranceProvider?: string;
		customerInsuranceCost?: number;
		internalInsuranceCost?: number;
		insuranceSavingsToMembership?: number;
	};
}

export interface NormalizedInsuranceBreakdown {
	insuranceProvider: InsuranceProvider;
	seguro: string;
	membresiaPago: string;
	customerInsuranceCost: string;
	internalInsuranceCost: string;
	insuranceSavingsToMembership: string;
}

const VEHICLE_GYT_TYPES = new Set(["particular", "uber", "nuevo"]);
const MICROBUS_GYT_TYPES = new Set([
	"microbus",
	"microbus_20",
	"microbus_35",
	"microbus_36plus",
]);

export function roundMoney(value: number): number {
	return Math.round(value * 100) / 100;
}

function toMoneyString(value: number): string {
	return roundMoney(value).toFixed(2);
}

function normalizeVehicleType(vehicleType: string): string {
	return vehicleType.trim().toLowerCase();
}

function qualifiesForGyt(insuredAmount: number, vehicleType: string): boolean {
	const normalizedType = normalizeVehicleType(vehicleType);

	if (VEHICLE_GYT_TYPES.has(normalizedType)) return insuredAmount >= 189000;
	if (MICROBUS_GYT_TYPES.has(normalizedType)) return insuredAmount >= 125000;

	return false;
}

export function selectInsuranceProvider(
	input: InsuranceSelectionInput,
): InsuranceSelectionResult {
	const universalesCost = roundMoney(input.universalesCost);
	const gytCost = input.gytCost == null ? null : roundMoney(input.gytCost);

	if (
		gytCost != null &&
		gytCost < universalesCost &&
		qualifiesForGyt(input.insuredAmount, input.vehicleType)
	) {
		const savings = roundMoney(Math.max(universalesCost - gytCost, 0));

		return {
			provider: "gyt",
			customerInsuranceCost: universalesCost,
			internalInsuranceCost: gytCost,
			insuranceSavingsToMembership: savings,
			effectiveMembershipCost: roundMoney(input.membershipCost + savings),
		};
	}

	return {
		provider: "universales",
		customerInsuranceCost: universalesCost,
		internalInsuranceCost: universalesCost,
		insuranceSavingsToMembership: 0,
		effectiveMembershipCost: roundMoney(input.membershipCost),
	};
}

export function normalizeInsuranceBreakdown({
	selection,
}: {
	selection: InsuranceSelectionResult;
}): NormalizedInsuranceBreakdown {
	return {
		insuranceProvider: selection.provider,
		seguro: toMoneyString(selection.customerInsuranceCost),
		membresiaPago: toMoneyString(selection.effectiveMembershipCost),
		customerInsuranceCost: toMoneyString(selection.customerInsuranceCost),
		internalInsuranceCost: toMoneyString(selection.internalInsuranceCost),
		insuranceSavingsToMembership: toMoneyString(
			selection.insuranceSavingsToMembership,
		),
	};
}

export function buildServerInsurancePersistence(
	input: InsurancePersistenceInput,
): NormalizedInsuranceBreakdown {
	void input.clientBreakdown;
	const selection = selectInsuranceProvider(input);
	const customerInsuranceCost = roundMoney(
		input.customerInsuranceCost ?? selection.customerInsuranceCost,
	);

	return normalizeInsuranceBreakdown({
		selection: {
			provider: selection.provider,
			customerInsuranceCost,
			internalInsuranceCost: selection.internalInsuranceCost,
			// El ahorro sale de los precios de seguro (universales - gyt), NO del
			// monto bundle del cotizador (que ya incluye la membresía).
			insuranceSavingsToMembership: selection.insuranceSavingsToMembership,
			// La membresía ya trae el ahorro incorporado desde el front
			// (getInsuranceCost). No lo volvemos a sumar para no contarlo dos veces.
			effectiveMembershipCost: roundMoney(input.membershipCost),
		},
	});
}
