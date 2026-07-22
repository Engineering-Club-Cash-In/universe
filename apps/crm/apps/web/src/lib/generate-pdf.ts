import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
	type QuotationCreditType,
	getQuotationPdfCopy,
} from "./quotation-pdf-copy";

// Tipo para filas de la tabla de amortización
export interface AmortizationRow {
	period: number;
	initialBalance: number;
	interestPlusVAT: number;
	principal: number;
	finalBalance: number;
}

// Función para generar tabla de amortización
export function generateAmortizationTable(
	totalFinanced: number,
	monthlyRate: number,
	termMonths: number,
): AmortizationRow[] {
	const table: AmortizationRow[] = [];
	let balance = totalFinanced;
	const r = monthlyRate / 100;
	const VAT = 0.12; // 12% IVA

	// Calcular la cuota base (sin seguro ni GPS)
	const rWithVAT = r * (1 + VAT);
	const factor = (1 + rWithVAT) ** termMonths;
	const baseMonthlyPayment =
		(totalFinanced * (rWithVAT * factor)) / (factor - 1);

	// Período 0 (inicial)
	const initialInterest = balance * r;
	const initialInterestWithVAT = initialInterest * (1 + VAT);

	table.push({
		period: 0,
		initialBalance: Math.round(balance * 100) / 100,
		interestPlusVAT: Math.round(initialInterestWithVAT * 100) / 100,
		principal: 0,
		finalBalance: Math.round(balance * 100) / 100,
	});

	// Períodos 1 a termMonths
	for (let i = 1; i <= termMonths; i++) {
		const interest = balance * r;
		const interestWithVAT = interest * (1 + VAT);
		const principalPayment = baseMonthlyPayment - interestWithVAT;
		const newBalance = balance - principalPayment;

		table.push({
			period: i,
			initialBalance: Math.round(balance * 100) / 100,
			interestPlusVAT: Math.round(interestWithVAT * 100) / 100,
			principal: Math.round(principalPayment * 100) / 100,
			finalBalance: Math.round((newBalance > 0 ? newBalance : 0) * 100) / 100,
		});

		balance = newBalance;
	}

	return table;
}

// Define an interface for the quotation data
interface QuotationData {
	creditType: QuotationCreditType;
	clientName?: string | null;
	vehicleBrand: string | null;
	vehicleLine: string | null;
	vehicleModel: string | null;
	vehicleValue: number;
	downPayment: number;
	downPaymentPercentage: number;
	amountToFinance: number; // Monto base a financiar (valor - enganche)
	totalFinanced: number; // Monto total a financiar (incluye todos los costos)
	monthlyPayment: number;
	termMonths: number;
	interestRate: number;
	// Costos adicionales (únicos, no mensuales)
	insuranceCost: number; // Seguro
	gpsCost: number; // GPS
	transferCost: number; // Traspaso
	adminCost: number; // Gastos administrativos
	membershipCost: number; // Membresía
	amortizationTable: {
		period: number;
		initialBalance: number;
		interestPlusVAT: number;
		principal: number;
		finalBalance: number;
	}[];
}

export function generateQuotationPdf(
	quotation: QuotationData,
	options?: { clientVersion?: boolean },
) {
	const doc = new jsPDF();
	const copy = getQuotationPdfCopy(quotation.creditType);

	// Helper function to format currency
	const formatCurrency = (value: number) =>
		`Q${value.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	// Title
	doc.setFontSize(18);
	doc.setFont("helvetica", "bold");
	doc.text("Detalle de cuotas niveladas", 105, 20, { align: "center" });
	doc.setFontSize(11);
	doc.setFont("helvetica", "normal");
	doc.text(`Tipo de crédito: ${copy.creditTypeLabel}`, 105, 27, {
		align: "center",
	});

	// Vehicle Info Section
	doc.setFontSize(14);
	doc.text("Datos del vehículo", 14, 35);
	doc.setFont("helvetica", "normal");
	doc.setFontSize(11);

	// Vehicle details in a row
	doc.text("Marca:", 14, 45);
	doc.setFont("helvetica", "bold");
	doc.text(quotation.vehicleBrand || "", 35, 45);
	doc.setFont("helvetica", "normal");
	doc.text("Línea:", 70, 45);
	doc.setFont("helvetica", "bold");
	doc.text(quotation.vehicleLine || "", 88, 45);
	doc.setFont("helvetica", "normal");
	doc.text("Modelo:", 140, 45);
	doc.setFont("helvetica", "bold");
	doc.text(quotation.vehicleModel || "", 162, 45);
	if (quotation.clientName) {
		doc.setFont("helvetica", "normal");
		doc.text("Cliente:", 14, 53);
		doc.setFont("helvetica", "bold");
		doc.text(quotation.clientName, 35, 53);
	}

	// Financial Summary - Left Column
	doc.setFont("helvetica", "normal");
	doc.setFontSize(11);
	let y = quotation.clientName ? 68 : 60;
	const leftCol = 14;
	const leftValueCol = 70; // Increased spacing for longer labels
	const rightCol = 110;
	const rightValueCol = 165;

	// Left column items
	doc.text("Valor del vehículo:", leftCol, y);
	doc.text(formatCurrency(quotation.vehicleValue), leftValueCol, y);

	y += 7;
	doc.text(copy.downPaymentLabel, leftCol, y);
	doc.text(`${formatCurrency(quotation.downPayment)}`, leftValueCol, y);
	if (copy.showDownPaymentPercentage) {
		doc.text(
			`${quotation.downPaymentPercentage.toFixed(2)}%`,
			leftValueCol + 30,
			y,
		);
	}

	y += 7;
	doc.text("Monto a financiar:", leftCol, y);
	doc.text(formatCurrency(quotation.amountToFinance), leftValueCol, y);
	const financePercentage = 100 - quotation.downPaymentPercentage;
	doc.text(`${financePercentage.toFixed(2)}%`, leftValueCol + 30, y);

	y += 10;
	doc.text("Plazo (meses):", leftCol, y);
	doc.text(`${quotation.termMonths}`, leftValueCol, y);

	y += 7;
	doc.text("Tasa de interés:", leftCol, y);
	doc.text(`${quotation.interestRate}%`, leftValueCol, y);

	// Additional costs section
	y += 10;
	doc.setFont("helvetica", "bold");
	doc.text("Costos adicionales:", leftCol, y);
	doc.setFont("helvetica", "normal");

	y += 7;
	doc.text("Seguro:", leftCol, y);
	doc.text(formatCurrency(quotation.insuranceCost), leftValueCol, y);

	y += 7;
	doc.text("GPS:", leftCol, y);
	doc.text(formatCurrency(quotation.gpsCost), leftValueCol, y);

	y += 7;
	doc.text("Traspaso:", leftCol, y);
	doc.text(formatCurrency(quotation.transferCost), leftValueCol, y);

	y += 7;
	doc.text("Gastos administrativos:", leftCol, y);
	doc.text(formatCurrency(quotation.adminCost), leftValueCol, y);

	if (!options?.clientVersion) {
		y += 7;
		doc.text("Membresía:", leftCol, y);
		doc.text(formatCurrency(quotation.membershipCost), leftValueCol, y);
	}

	// Total financed and monthly payment - highlighted
	y += 12;
	doc.setDrawColor(100);
	doc.line(leftCol, y, 115, y);

	y += 8;
	doc.setFont("helvetica", "bold");
	doc.text("Monto total a financiar:", leftCol, y);
	doc.text(formatCurrency(quotation.totalFinanced), leftValueCol, y);

	y += 10;
	doc.setFontSize(14);
	doc.setTextColor(0, 100, 0); // Dark green
	doc.text("Cuota mensual:", leftCol, y);
	doc.text(formatCurrency(quotation.monthlyPayment), leftValueCol, y);
	doc.setTextColor(0, 0, 0); // Reset to black

	// Amortization Table
	doc.setFont("helvetica", "bold");
	doc.setFontSize(14);
	doc.text("Tabla de Amortización", 14, y + 20);

	autoTable(doc, {
		startY: y + 25,
		head: [
			[
				"Cuota",
				"Saldo inicial",
				"Interés + IVA",
				"Amortización",
				"Saldo final",
			],
		],
		body: quotation.amortizationTable
			.filter((row) => row.period !== 0)
			.map((row) => [
				row.period,
				formatCurrency(row.initialBalance),
				formatCurrency(row.interestPlusVAT),
				formatCurrency(row.principal),
				formatCurrency(row.finalBalance),
			]),
		headStyles: { fillColor: [22, 160, 133] },
		styles: { halign: "right", fontSize: 9 },
		columnStyles: { 0: { halign: "center" } },
	});

	// Create a link and trigger the download.
	// Note: Some browsers (like Firefox) may be configured to open PDFs in the browser
	// instead of downloading them. This is a browser setting and cannot be controlled by code.
	// To change this in Firefox, go to about:preferences -> Applications -> Portable Document Format (PDF)
	// and set it to "Save File".
	const pdfBlob = doc.output("blob");
	const blobUrl = URL.createObjectURL(pdfBlob);

	const link = document.createElement("a");
	link.href = blobUrl;
	link.download = `cotizacion-${quotation.vehicleBrand || "vehiculo"}-${quotation.vehicleLine || ""}.pdf`;

	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);

	URL.revokeObjectURL(blobUrl);
}
