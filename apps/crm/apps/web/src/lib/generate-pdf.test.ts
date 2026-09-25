import { expect, spyOn, test } from "bun:test";
import { generateQuotationPdf } from "./generate-pdf";

test("client GyT PDF shows the combined cost as Seguro GyT without internal breakdown", async () => {
	let pdf: Blob | undefined;
	const createUrl = spyOn(URL, "createObjectURL").mockImplementation((blob) => {
		if (blob instanceof Blob) pdf = blob;
		return "blob:quotation-test";
	});
	const revokeUrl = spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
	const originalDocument = globalThis.document;
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: {
			createElement: () => ({ click: () => {} }),
			body: { appendChild: () => {}, removeChild: () => {} },
		},
	});

	try {
		generateQuotationPdf(
			{
				creditType: "autocompra",
				insuranceProvider: "gyt",
				vehicleBrand: "Jetour",
				vehicleLine: "T2",
				vehicleModel: "2022",
				vehicleValue: 270000,
				downPayment: 40500,
				downPaymentPercentage: 15,
				amountToFinance: 229500,
				totalFinanced: 248679.21,
				monthlyPayment: 0,
				termMonths: 36,
				interestRate: 1.5,
				insuranceCost: 1847.01,
				gpsCost: 148.2,
				transferCost: 2195,
				adminCost: 16984.21,
				membershipCost: 1259.28,
				extraCosts: {},
				amortizationTable: [],
			},
			{ clientVersion: true },
		);
		expect(pdf).toBeDefined();
		const content = await pdf?.text();
		expect(content).toMatch(/\(Seguro GyT:\)[\s\S]{0,180}\(Q1,847.01\)/);
		expect(content).not.toContain("Q1,259.28");
		expect(content).not.toContain(" - GPS");
	} finally {
		createUrl.mockRestore();
		revokeUrl.mockRestore();
		if (originalDocument) {
			Object.defineProperty(globalThis, "document", {
				configurable: true,
				value: originalDocument,
			});
		} else {
			Reflect.deleteProperty(globalThis, "document");
		}
	}
});
