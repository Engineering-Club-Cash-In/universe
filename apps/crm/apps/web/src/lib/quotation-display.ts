export const DISBURSEMENT_SALE_LABEL = "Desembolso por venta";

export function formatQuotationClientName(input: {
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
