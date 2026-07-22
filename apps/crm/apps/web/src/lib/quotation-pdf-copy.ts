export type QuotationCreditType = "autocompra" | "sobre_vehiculo";

export function getQuotationPdfCopy(creditType: QuotationCreditType) {
	if (creditType === "sobre_vehiculo") {
		return {
			creditTypeLabel: "Sobre Vehículo",
			downPaymentLabel: "Monto solicitado:",
			showDownPaymentPercentage: false,
		} as const;
	}

	return {
		creditTypeLabel: "Autocompra",
		downPaymentLabel: "Enganche:",
		showDownPaymentPercentage: true,
	} as const;
}
