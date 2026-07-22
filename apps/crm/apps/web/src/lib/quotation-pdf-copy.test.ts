import { describe, expect, test } from "bun:test";
import {
	getQuotationPdfCopy,
	getSobreVehiculoDisbursement,
} from "./quotation-pdf-copy";

describe("getQuotationPdfCopy", () => {
	test("identifica créditos sobre vehículo y evita lenguaje de compra", () => {
		expect(getQuotationPdfCopy("sobre_vehiculo")).toEqual({
			creditTypeLabel: "Sobre Vehículo",
			downPaymentLabel: "Monto solicitado:",
			showDownPaymentPercentage: false,
		});
	});

	test("conserva el lenguaje de enganche para autocompra", () => {
		expect(getQuotationPdfCopy("autocompra")).toEqual({
			creditTypeLabel: "Autocompra",
			downPaymentLabel: "Enganche:",
			showDownPaymentPercentage: true,
		});
	});
});

describe("getSobreVehiculoDisbursement", () => {
	test("descuenta exactamente los gastos aplicables del monto solicitado", () => {
		expect(
			getSobreVehiculoDisbursement(1000, {
				royalty: 1,
				freelanceCost: 2,
				inspectionCost: 3,
				extraGpsCost: 4,
				extraInsuranceCost: "5",
				extraMembershipCost: "6",
				extraAdminCost: 7,
				interestCost: 8,
				rcdpCost: 9,
				appointmentCost: 1000,
				finesCost: 10,
				keyCopyCost: 11,
				keyCopyDiffCost: 12,
				addressVerificationCost: 13,
				circulationTaxCost: 14,
				vehicleTransferCost: 15,
				mobileGuaranteeCost: 16,
				licensePlatesCost: 17,
				leasingContractCost: 18,
				collectionAuthCost: 19,
				legalCost: 20,
			}),
		).toEqual({
			additionalCosts: 210,
			netDisbursement: 790,
		});
	});

	test("ignora ceros y valores nulos", () => {
		expect(
			getSobreVehiculoDisbursement("1000", {
				royalty: 0,
				freelanceCost: "0",
				inspectionCost: null,
			}),
		).toEqual({
			additionalCosts: 0,
			netDisbursement: 1000,
		});
	});
});
