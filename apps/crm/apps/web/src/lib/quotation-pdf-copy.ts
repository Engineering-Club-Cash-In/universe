export {
	EXTRA_COST_FIELDS,
	getSobreVehiculoDisbursement,
	type ExtraCostFieldConfig,
	type QuotationCreditType,
	type QuotationExtraCostField,
	type QuotationExtraCosts,
} from "server/src/lib/quotation-extra-costs";
import type { QuotationCreditType } from "server/src/lib/quotation-extra-costs";

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
