import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// Define an interface for the quotation data
interface QuotationData {
  vehicleBrand: string | null;
  vehicleLine: string | null;
  vehicleModel: string | null;
  vehicleValue: number;
  downPayment: number;
  totalFinanced: number;
  monthlyPayment: number;
  termMonths: number;
  interestRate: number;
  amortizationTable: {
    period: number;
    initialBalance: number;
    interestPlusVAT: number;
    principal: number;
    finalBalance: number;
  }[];
}

export function generateQuotationPdf(quotation: QuotationData) {
  const doc = new jsPDF();

  // Title
  doc.setFontSize(20);
  doc.text("Cotización de Financiamiento", 105, 20, { align: "center" });

  // Vehicle Info
  doc.setFontSize(12);
  doc.text("Vehículo:", 14, 30);
  doc.text(`${quotation.vehicleBrand || ''} ${quotation.vehicleLine || ''} ${quotation.vehicleModel || ''}`, 50, 30);
  doc.text("Valor:", 14, 37);
  doc.text(`Q${quotation.vehicleValue.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 50, 37);

  // Financing Summary
  doc.setFontSize(16);
  doc.text("Resumen del Financiamiento", 14, 50);

  doc.setFontSize(12);
  doc.text("Enganche:", 14, 60);
  doc.text(`Q${quotation.downPayment.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 60, 60);

  doc.text("Monto a Financiar:", 14, 67);
  doc.text(`Q${quotation.totalFinanced.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 60, 67);

  doc.text("Cuota Mensual:", 14, 74);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(`Q${quotation.monthlyPayment.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 60, 74);
  doc.setFont("helvetica", "normal");

  doc.setFontSize(12);
  doc.text("Plazo:", 14, 81);
  doc.text(`${quotation.termMonths} meses`, 60, 81);

  doc.text("Tasa de Interés:", 14, 88);
  doc.text(`${quotation.interestRate}% mensual`, 60, 88);


  // Amortization Table
  doc.setFontSize(16);
  doc.text("Tabla de Amortización", 14, 100);

  autoTable(doc, {
    startY: 105,
    head: [["Período", "Saldo Inicial", "Interés + IVA", "Capital", "Saldo Final"]],
    body: quotation.amortizationTable.map(row => [
      row.period,
      `Q${row.initialBalance.toFixed(2)}`,
      `Q${row.interestPlusVAT.toFixed(2)}`,
      `Q${row.principal.toFixed(2)}`,
      `Q${row.finalBalance.toFixed(2)}`,
    ]),
    headStyles: { fillColor: [22, 160, 133] },
    styles: { halign: 'right' },
    columnStyles: { 0: { halign: 'center' } },
  });


    // Create a link and trigger the download.
  // Note: Some browsers (like Firefox) may be configured to open PDFs in the browser
  // instead of downloading them. This is a browser setting and cannot be controlled by code.
  // To change this in Firefox, go to about:preferences -> Applications -> Portable Document Format (PDF)
  // and set it to "Save File".
  const pdfBlob = doc.output('blob');
  const blobUrl = URL.createObjectURL(pdfBlob);

  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = `cotizacion-${quotation.vehicleBrand || 'vehiculo'}-${quotation.vehicleLine || ''}.pdf`;
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(blobUrl);
}
