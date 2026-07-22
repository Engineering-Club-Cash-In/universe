import { DISBURSEMENT_SALE_LABEL } from "./quotation-display";

export type QuotationCreditType = "autocompra" | "sobre_vehiculo";

export type QuotationExtraCostField =
	| "royalty"
	| "freelanceCost"
	| "inspectionCost"
	| "extraGpsCost"
	| "extraInsuranceCost"
	| "extraMembershipCost"
	| "extraAdminCost"
	| "interestCost"
	| "rcdpCost"
	| "appointmentCost"
	| "finesCost"
	| "keyCopyCost"
	| "keyCopyDiffCost"
	| "addressVerificationCost"
	| "circulationTaxCost"
	| "vehicleTransferCost"
	| "mobileGuaranteeCost"
	| "licensePlatesCost"
	| "leasingContractCost"
	| "collectionAuthCost"
	| "legalCost";

type QuotationExtraCostPercentageField =
	| "royaltyPercentage"
	| "freelancePercentage";

type PdfNumericValue = number | string | null | undefined;

export type QuotationExtraCosts = Partial<
	Record<QuotationExtraCostField, PdfNumericValue>
>;

export interface ExtraCostFieldConfig {
	name: string;
	label: string;
	type: "percentage" | "fixed";
	percentageField?: QuotationExtraCostPercentageField;
	valueField: QuotationExtraCostField;
	creditType: "all" | QuotationCreditType;
	section: "comision" | "otros" | "abogado";
	computed?: boolean;
	defaultActive?: boolean;
	defaultValue?: number;
}

export const EXTRA_COST_FIELDS: ExtraCostFieldConfig[] = [
	{
		name: "royalty",
		label: "Royalty",
		type: "percentage",
		percentageField: "royaltyPercentage",
		valueField: "royalty",
		creditType: "all",
		section: "comision",
		computed: true,
	},
	{
		name: "freelance",
		label: "Free Lance",
		type: "percentage",
		percentageField: "freelancePercentage",
		valueField: "freelanceCost",
		creditType: "all",
		section: "comision",
	},
	{
		name: "inspection",
		label: DISBURSEMENT_SALE_LABEL,
		type: "fixed",
		valueField: "inspectionCost",
		creditType: "all",
		section: "comision",
	},
	{
		name: "extraGps",
		label: "GPS",
		type: "fixed",
		valueField: "extraGpsCost",
		creditType: "all",
		section: "comision",
	},
	{
		name: "extraInsurance",
		label: "Seguro INREXSA",
		type: "fixed",
		valueField: "extraInsuranceCost",
		creditType: "all",
		section: "comision",
		defaultActive: true,
	},
	{
		name: "extraMembership",
		label: "Membresía",
		type: "fixed",
		valueField: "extraMembershipCost",
		creditType: "all",
		section: "comision",
		defaultActive: true,
	},
	{
		name: "extraAdmin",
		label: "Gastos Administrativos",
		type: "fixed",
		valueField: "extraAdminCost",
		creditType: "all",
		section: "comision",
		defaultActive: true,
	},
	{
		name: "interest",
		label: "Intereses",
		type: "fixed",
		valueField: "interestCost",
		creditType: "all",
		section: "comision",
		computed: true,
	},
	{
		name: "rcdp",
		label: "RCDP 1er Trimestre",
		type: "fixed",
		valueField: "rcdpCost",
		creditType: "all",
		section: "comision",
		computed: true,
	},
	{
		name: "appointment",
		label: "Nombramiento",
		type: "fixed",
		valueField: "appointmentCost",
		creditType: "autocompra",
		section: "otros",
		defaultActive: true,
		defaultValue: 150,
	},
	{
		name: "fines",
		label: "Multas",
		type: "fixed",
		valueField: "finesCost",
		creditType: "all",
		section: "otros",
	},
	{
		name: "keyCopy",
		label: "Copia de llave",
		type: "fixed",
		valueField: "keyCopyCost",
		creditType: "all",
		section: "otros",
	},
	{
		name: "keyCopyDiff",
		label: "Diferencia copia llave",
		type: "fixed",
		valueField: "keyCopyDiffCost",
		creditType: "all",
		section: "otros",
	},
	{
		name: "addressVerification",
		label: "Verificación de dirección",
		type: "fixed",
		valueField: "addressVerificationCost",
		creditType: "all",
		section: "otros",
		defaultActive: true,
		defaultValue: 395,
	},
	{
		name: "circulationTax",
		label: "Impuesto circulación",
		type: "fixed",
		valueField: "circulationTaxCost",
		creditType: "all",
		section: "otros",
	},
	{
		name: "vehicleTransfer",
		label: "Traspaso de vehículo",
		type: "fixed",
		valueField: "vehicleTransferCost",
		creditType: "all",
		section: "otros",
	},
	{
		name: "mobileGuarantee",
		label: "Garantía mobiliaria",
		type: "fixed",
		valueField: "mobileGuaranteeCost",
		creditType: "all",
		section: "otros",
		defaultActive: true,
		defaultValue: 400,
	},
	{
		name: "licensePlates",
		label: "Placas",
		type: "fixed",
		valueField: "licensePlatesCost",
		creditType: "all",
		section: "otros",
	},
	{
		name: "leasingContract",
		label: "Contrato Leasing",
		type: "fixed",
		valueField: "leasingContractCost",
		creditType: "all",
		section: "abogado",
		defaultValue: 400,
	},
	{
		name: "collectionAuth",
		label: "Auténtica contrato cobranza",
		type: "fixed",
		valueField: "collectionAuthCost",
		creditType: "all",
		section: "abogado",
	},
	{
		name: "legal",
		label: "Gastos legales",
		type: "fixed",
		valueField: "legalCost",
		creditType: "all",
		section: "abogado",
	},
];

export function getSobreVehiculoDisbursement(
	requestedAmount: PdfNumericValue,
	costs: QuotationExtraCosts,
) {
	const additionalCosts = EXTRA_COST_FIELDS.filter(
		(field) => field.creditType !== "autocompra",
	).reduce((total, field) => total + (Number(costs[field.valueField]) || 0), 0);

	return {
		additionalCosts,
		netDisbursement: (Number(requestedAmount) || 0) - additionalCosts,
	};
}

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
