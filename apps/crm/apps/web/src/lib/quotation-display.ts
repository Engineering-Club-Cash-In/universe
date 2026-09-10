export const DISBURSEMENT_SALE_LABEL = "Desembolso por venta";

export function formatInsuranceProviderLabel(
	provider: "universales" | "gyt",
): string {
	return provider === "gyt" ? "Seguro: GyT" : "Seguro: Universales";
}

export function getQuotationInsuranceFieldName(
	provider: "universales" | "gyt",
): "insuranceCost" | "extraInsuranceCost" {
	return provider === "gyt" ? "extraInsuranceCost" : "insuranceCost";
}

export function getQuotationInsuranceDisplay(input: {
	insuranceProvider?: string | null;
	insuranceCost?: number | string | null;
	membershipCost?: number | string | null;
	extraInsuranceCost?: number | string | null;
	extraMembershipCost?: number | string | null;
}) {
	const insuranceProvider =
		input.insuranceProvider === "gyt" ? "gyt" : "universales";
	const isGyt = insuranceProvider === "gyt";

	return {
		insuranceProvider,
		insuranceCost:
			Number(isGyt ? input.extraInsuranceCost : input.insuranceCost) || 0,
		membershipCost:
			Number(isGyt ? input.extraMembershipCost : input.membershipCost) || 0,
	};
}

export function formatQuotationClientName(input: object & {
	leadFirstName?: string | null;
	leadLastName?: string | null;
	companyName?: string | null;
}) {
	return (
		[input.leadFirstName, input.leadLastName]
			.filter((part): part is string => Boolean(part?.trim()))
			.join(" ") ||
		input.companyName?.trim() ||
		"Cliente sin nombre"
	);
}

export function formatVehicleWithClient(
	vehicleLabel: string,
	clientName?: string | null,
) {
	return clientName?.trim() ? `${vehicleLabel} - ${clientName}` : vehicleLabel;
}
