import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import Logo from "@/assets/logo.png";
import { Button } from "@/components/ui/button";
import { Download, Settings } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

interface AmortizationRow {
  month: number;
  initialBalance: number;
  interest: number;
  vat: number;
  interestPlusVat: number;
  payment: number;
  interestVatPayment: number;
  amortization: number;
  finalBalance: number;
}

export default function InvestmentCalculator() {
  const [mainTab, setMainTab] = useState("calculator"); // 'calculator' or 'goal'
  const [capital, setCapital] = useState<string>("7591.11");
  const [interestRate, setInterestRate] = useState<number>(1.5);
  const [term, setTerm] = useState<number>(1);
  const [investorPercentage, setInvestorPercentage] = useState<number>(70);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // New state for term unit
  const [termUnit, setTermUnit] = useState<"months" | "years">("years");

  // Small taxpayer state
  const [isSmallTaxpayer, setIsSmallTaxpayer] = useState<boolean>(false);

  // Admin related state
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [isLoginDialogOpen, setIsLoginDialogOpen] = useState(false);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [adminInterestRate, setAdminInterestRate] = useState<number>(1.5);
  const [adminInvestorPercentage, setAdminInvestorPercentage] =
    useState<number>(70);

  // Admin small taxpayer state
  const [adminIsSmallTaxpayer, setAdminIsSmallTaxpayer] =
    useState<boolean>(false);

  // --- Inverse Calculator State ---
  const [desiredAmount, setDesiredAmount] = useState<string>("1000");
  const [inverseMode, setInverseMode] = useState<"monthly" | "lumpSum">(
    "monthly"
  );
  const [lumpSumType, setLumpSumType] = useState<"compound" | "interest-only">(
    "compound"
  );
  const [requiredCapital, setRequiredCapital] = useState<number | null>(null);
  // --- End of Inverse Calculator State ---

  // New shared state for the selected schedule type
  const [activeTab, setActiveTab] = useState("standard");

  const getCapitalAsNumber = () => {
    return parseInt(capital.replace(/,/g, ""), 10);
  };

  // Helper function to get term in months
  const getTermInMonths = () => {
    return termUnit === "years" ? term * 12 : term;
  };

  // Helper function to get VAT rate
  const getVatRate = () => {
    return isSmallTaxpayer ? 0.05 : 0.12;
  };

  // Standard amortization schedule (capital returned monthly)
  const calculateMonthlyPayment = (principal: number, rate: number) => {
    const monthlyRate = (rate * (1 + getVatRate())) / 100;
    const totalMonths = getTermInMonths();
    return (
      (principal * monthlyRate * Math.pow(1 + monthlyRate, totalMonths)) /
      (Math.pow(1 + monthlyRate, totalMonths) - 1)
    );
  };

  const generateAmortizationSchedule = (
    principal: number
  ): AmortizationRow[] => {
    const schedule: AmortizationRow[] = [];
    const monthlyPayment = calculateMonthlyPayment(principal, interestRate);
    let balance = principal;
    const totalMonths = getTermInMonths();
    const vatRate = getVatRate();
    for (let month = 1; month <= totalMonths; month++) {
      const interest = balance * (interestRate / 100);
      const vat = interest * vatRate;
      const interestPlusVat = interest + vat;
      const amortization = monthlyPayment - interestPlusVat;
      const finalBalance = balance - amortization;
      schedule.push({
        month,
        initialBalance: balance,
        interest,
        vat,
        interestPlusVat,
        payment: monthlyPayment,
        interestVatPayment: interestPlusVat * (investorPercentage / 100),
        amortization,
        finalBalance: finalBalance < 0.01 ? 0 : finalBalance,
      });
      balance = finalBalance;
    }
    return schedule;
  };

  // Interest-only schedule (capital remains constant until the final month)
  const generateInterestOnlySchedule = (
    principal: number
  ): AmortizationRow[] => {
    const schedule: AmortizationRow[] = [];
    const totalMonths = getTermInMonths();
    const vatRate = getVatRate();
    for (let month = 1; month <= totalMonths; month++) {
      const interest = principal * (interestRate / 100);
      const vat = interest * vatRate;
      const interestPlusVat = interest + vat;
      if (month < totalMonths) {
        schedule.push({
          month,
          initialBalance: principal,
          interest,
          vat,
          interestPlusVat,
          payment: interestPlusVat,
          interestVatPayment: interestPlusVat * (investorPercentage / 100),
          amortization: 0,
          finalBalance: principal,
        });
      } else {
        schedule.push({
          month,
          initialBalance: principal,
          interest,
          vat,
          interestPlusVat,
          payment: interestPlusVat + principal, // add capital on final month
          interestVatPayment: interestPlusVat * (investorPercentage / 100),
          amortization: principal,
          finalBalance: 0,
        });
      }
    }
    return schedule;
  };

  // Compound interest schedule (net interest is reinvested)
  const generateCompoundSchedule = (principal: number): AmortizationRow[] => {
    const schedule: AmortizationRow[] = [];
    const totalMonths = getTermInMonths();
    const vatRate = getVatRate();
    let balance = principal;
    for (let month = 1; month <= totalMonths; month++) {
      const interest = balance * (interestRate / 100);
      const vat = interest * vatRate;
      const netInterest = interest - vat; // reinvest net interest
      const finalBalance = balance + netInterest;
      schedule.push({
        month,
        initialBalance: balance,
        interest,
        vat,
        interestPlusVat: interest + vat,
        payment: month === totalMonths ? finalBalance : 0, // Show total at the end
        interestVatPayment: (interest + vat) * (investorPercentage / 100),
        amortization: month === totalMonths ? balance : 0, // Show original capital at the end
        finalBalance: finalBalance,
      });
      balance = finalBalance;
    }
    return schedule;
  };

  const displayCapital =
    mainTab === "goal" && requiredCapital
      ? requiredCapital
      : getCapitalAsNumber();

  const standardSchedule = generateAmortizationSchedule(displayCapital);
  const interestOnlySchedule = generateInterestOnlySchedule(displayCapital);
  const compoundScheduleArr = generateCompoundSchedule(displayCapital);

  // Determine which schedule to use based on the selected tab
  const scheduleForActiveTab =
    activeTab === "standard"
      ? standardSchedule
      : activeTab === "interest-only"
        ? interestOnlySchedule
        : compoundScheduleArr;

  // Compute summary values from the selected schedule.
  const summaryTotalInterest = scheduleForActiveTab.reduce(
    (sum, row) => sum + row.interestPlusVat,
    0
  );
  const summaryNetProfit = summaryTotalInterest * (investorPercentage / 100);

  // Calculate total to receive - different logic for compound interest
  let totalToReceive;
  if (activeTab === "compound") {
    // For compound interest, use the final accumulated balance
    const finalBalance =
      compoundScheduleArr[compoundScheduleArr.length - 1]?.finalBalance ||
      displayCapital;
    totalToReceive = finalBalance;
  } else {
    // For standard and interest-only, use the traditional formula
    totalToReceive = displayCapital + summaryNetProfit;
  }

  const handleDownload = () => {
    // Crear un elemento div temporal para contener nuestro contenido
    const printContent = document.createElement("div");
    printContent.style.padding = "20px";
    printContent.style.fontFamily = "Arial, sans-serif";
    printContent.style.width = "1200px"; // Aumentar el ancho para mejor calidad

    // Agregar el título y logo
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.marginBottom = "20px";

    const title = document.createElement("h1");
    title.textContent = "Calculadora de Inversión";
    title.style.fontSize = "28px"; // Aumentar tamaño de fuente
    header.appendChild(title);

    // Agregar el resumen
    const summary = document.createElement("div");
    summary.style.marginBottom = "30px";
    summary.style.border = "1px solid #ddd";
    summary.style.borderRadius = "5px";
    summary.style.padding = "15px";
    summary.style.display = "grid";
    summary.style.gridTemplateColumns = "repeat(2, 1fr)";
    summary.style.fontSize = "14px"; // Especificar tamaño de fuente

    const createSummaryRow = (label: string, value: string) => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.justifyContent = "space-between";
      row.style.padding = "10px 0"; // Aumentar padding
      row.style.borderBottom = "1px solid #eee";
      row.style.margin = "0 10px";

      const labelSpan = document.createElement("span");
      labelSpan.textContent = label;
      labelSpan.style.fontWeight = "bold";

      const valueSpan = document.createElement("span");
      valueSpan.textContent = value;

      row.appendChild(labelSpan);
      row.appendChild(valueSpan);
      return row;
    };

    summary.appendChild(
      createSummaryRow(
        "Monto a Invertir:",
        `Q ${displayCapital.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      )
    );

    summary.appendChild(
      createSummaryRow("Plazo:", `${getTermInMonths()} Meses`)
    );

    summary.appendChild(
      createSummaryRow(
        "Tasa de Interés Mensual:",
        `${interestRate.toFixed(1)}%`
      )
    );

    summary.appendChild(
      createSummaryRow(
        "Tipo de Pago:",
        activeTab === "compound"
          ? "Interés Compuesto"
          : activeTab === "interest-only"
            ? "Sin devolución mensual"
            : "Estándar"
      )
    );

    summary.appendChild(
      createSummaryRow(
        "Fecha de Vencimiento:",
        new Date(
          Date.now() + getTermInMonths() * 30 * 24 * 60 * 60 * 1000
        ).toLocaleDateString()
      )
    );

    summary.appendChild(
      createSummaryRow(
        "Intereses Ganados:",
        `Q ${
          activeTab === "compound"
            ? (totalToReceive - displayCapital).toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            : summaryNetProfit.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
        }`
      )
    );

    summary.appendChild(
      createSummaryRow(
        "Impuestos a Pagar:",
        `Q ${
          activeTab === "compound"
            ? (summaryTotalInterest * getVatRate()).toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            : (
                summaryTotalInterest *
                getVatRate() *
                (investorPercentage / 100)
              ).toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
        }`
      )
    );

    summary.appendChild(
      createSummaryRow(
        "Total a Recibir:",
        `Q ${
          activeTab === "compound"
            ? totalToReceive.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            : (
                totalToReceive -
                summaryTotalInterest * getVatRate() * (investorPercentage / 100)
              ).toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
        }`
      )
    );

    // Agregar la tabla de amortización
    const tableTitle = document.createElement("h2");
    tableTitle.textContent = "Tabla de Amortización";
    tableTitle.style.fontSize = "22px"; // Aumentar tamaño
    tableTitle.style.marginTop = "20px";
    tableTitle.style.marginBottom = "15px";

    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    table.style.marginBottom = "20px";
    table.style.fontSize = "13px"; // Especificar tamaño de fuente para la tabla

    // Crear encabezado de tabla
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");

    const createHeaderCell = (text: string) => {
      const th = document.createElement("th");
      th.textContent = text;
      th.style.padding = "8px";
      th.style.backgroundColor = "#f2f2f2";
      th.style.border = "1px solid #ddd";
      th.style.textAlign = "right";
      return th;
    };

    headerRow.appendChild(createHeaderCell("Mes"));
    headerRow.appendChild(createHeaderCell("Saldo inicial"));
    headerRow.appendChild(createHeaderCell("Interés + IVA"));
    headerRow.appendChild(createHeaderCell("Amortización"));
    headerRow.appendChild(createHeaderCell("Total a Recibir"));

    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Crear cuerpo de tabla
    const tbody = document.createElement("tbody");

    const createTableCell = (text: string, align = "right") => {
      const td = document.createElement("td");
      td.textContent = text;
      td.style.padding = "8px";
      td.style.border = "1px solid #ddd";
      td.style.textAlign = align;
      return td;
    };

    // Agregar filas de datos
    scheduleForActiveTab.forEach((row) => {
      const tr = document.createElement("tr");

      tr.appendChild(createTableCell(row.month.toString(), "center"));
      tr.appendChild(
        createTableCell(
          `Q ${row.initialBalance.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`
        )
      );
      tr.appendChild(
        createTableCell(
          `Q ${row.interestVatPayment.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`
        )
      );
      tr.appendChild(
        createTableCell(
          `Q ${row.amortization.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`
        )
      );
      tr.appendChild(
        createTableCell(
          `Q ${(row.amortization + row.interestVatPayment).toLocaleString(
            "en-US",
            {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }
          )}`
        )
      );

      tbody.appendChild(tr);
    });

    // Agregar fila de resumen
    const summaryRow = document.createElement("tr");
    summaryRow.style.backgroundColor = "#f2f2f2";
    summaryRow.style.fontWeight = "bold";

    const summaryCell1 = document.createElement("td");
    summaryCell1.textContent = `Monto a Invertir: Q ${displayCapital.toLocaleString(
      "en-US",
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }
    )}`;
    summaryCell1.style.padding = "8px";
    summaryCell1.style.border = "1px solid #ddd";
    summaryCell1.colSpan = 2;

    const summaryCell2 = document.createElement("td");
    summaryCell2.textContent = `Total Intereses: Q ${
      activeTab === "compound"
        ? (totalToReceive - displayCapital).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : summaryNetProfit.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
    }`;
    summaryCell2.style.padding = "8px";
    summaryCell2.style.border = "1px solid #ddd";
    summaryCell2.style.textAlign = "right";

    const summaryCell3 = document.createElement("td");
    summaryCell3.textContent = `Total a Recibir: Q ${
      activeTab === "compound"
        ? totalToReceive.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : (
            totalToReceive -
            summaryTotalInterest * getVatRate() * (investorPercentage / 100)
          ).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
    }`;
    summaryCell3.style.padding = "8px";
    summaryCell3.style.border = "1px solid #ddd";
    summaryCell3.style.textAlign = "right";
    summaryCell3.colSpan = 2;

    summaryRow.appendChild(summaryCell1);
    summaryRow.appendChild(summaryCell2);
    summaryRow.appendChild(summaryCell3);

    tbody.appendChild(summaryRow);
    table.appendChild(tbody);

    // Agregar todo al contenedor principal
    printContent.appendChild(header);
    printContent.appendChild(summary);
    printContent.appendChild(tableTitle);
    printContent.appendChild(table);

    // Agregar el contenedor al documento
    document.body.appendChild(printContent);

    // Usar html2canvas con configuración mejorada para calidad
    html2canvas(printContent, {
      scale: 2, // Aumentar escala para mejor resolución
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff", // Asegurar fondo blanco
      allowTaint: true,
    }).then((canvas) => {
      // Crear PDF en formato landscape con mejor calidad
      const imgData = canvas.toDataURL("image/png", 1.0); // Calidad máxima
      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
        compress: false, // Desactivar compresión para mejor calidad
      });

      // Calcular dimensiones para ajustar al tamaño A4 landscape
      const imgWidth = 297; // A4 landscape width in mm
      const pageHeight = 210; // A4 landscape height in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      // Agregar primera página con mejor calidad
      pdf.addImage(
        imgData,
        "PNG",
        0,
        position,
        imgWidth,
        imgHeight,
        undefined,
        "FAST"
      );
      heightLeft -= pageHeight;

      // Agregar páginas adicionales si es necesario
      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(
          imgData,
          "PNG",
          0,
          position,
          imgWidth,
          imgHeight,
          undefined,
          "FAST"
        );
        heightLeft -= pageHeight;
      }

      // Descargar PDF
      pdf.save("calculadora-inversion.pdf");

      // Eliminar el contenedor temporal
      document.body.removeChild(printContent);
    });
  };

  const handleOpenDialog = () => {
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
  };

  // Admin login functionality
  const handleLogin = () => {
    // Simple hardcoded credentials for demo purposes
    if (username === "admin" && password === "admin") {
      setIsAdminLoggedIn(true);
      setIsLoginDialogOpen(false);
      setUsername("");
      setPassword("");
      // Initialize admin settings with current values
      setAdminInterestRate(interestRate);
      setAdminInvestorPercentage(investorPercentage);
      // Open admin panel after successful login
      setIsAdminPanelOpen(true);
    } else {
      alert("Invalid credentials. Try admin/admin");
    }
  };

  const handleSaveAdminSettings = () => {
    // Apply the admin settings to the actual calculator with validation
    setInterestRate(adminInterestRate);

    // Ensure investor percentage is within range before saving
    const validPercentage = Math.min(Math.max(adminInvestorPercentage, 70), 90);
    setInvestorPercentage(validPercentage);

    setIsSmallTaxpayer(adminIsSmallTaxpayer);

    setIsAdminPanelOpen(false);
    toast.success("Settings updated successfully!");
  };

  // --- Inverse Calculation Logic ---
  useEffect(() => {
    if (mainTab !== "goal") {
      setRequiredCapital(null);
      return;
    }

    const D = parseFloat(desiredAmount.replace(/,/g, ""));
    if (isNaN(D) || D <= 0) {
      setRequiredCapital(null);
      return;
    }

    const totalMonths = getTermInMonths();
    const monthlyInterestRate = interestRate / 100;
    const investorShare = investorPercentage / 100;
    const vatRate = getVatRate();
    let capital = 0;

    if (inverseMode === "monthly") {
      // Corresponds to interest-only payments
      const interestPlusVat = D / investorShare;
      const interest = interestPlusVat / (1 + vatRate);
      capital = interest / monthlyInterestRate;
    } else {
      // lumpSum
      if (lumpSumType === "compound") {
        const netMonthlyRate = monthlyInterestRate * (1 - vatRate); // interest - VAT
        capital = D / Math.pow(1 + netMonthlyRate, totalMonths);
      } else {
        // interest-only final payment (capital + last interest)
        const finalPaymentFactor =
          1 + monthlyInterestRate * (1 + vatRate) * investorShare;
        capital = D / finalPaymentFactor;
      }
    }

    setRequiredCapital(capital > 0 ? capital : null);
  }, [
    desiredAmount,
    inverseMode,
    lumpSumType,
    term,
    interestRate,
    investorPercentage,
    mainTab,
    termUnit,
    isSmallTaxpayer,
  ]);

  return (
    <div className="container mx-auto py-8">
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-4xl font-bold flex justify-between items-center gap-4">
            Calculadora de Inversión
            <div className="flex items-center gap-4">
              <img
                src={Logo}
                alt="Club Cash In Logo"
                className="w-full max-w-xs h-auto"
              />
              {isAdminLoggedIn ? (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setIsAdminPanelOpen(true)}
                  title="Admin Panel"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setIsLoginDialogOpen(true)}
                  title="Admin Login"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              )}
            </div>
          </CardTitle>
          <CardDescription>
            *El interés siempre es calculado sobre saldo
            <br />
            *No hay penalización por cancelación anticipada de créditos
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={mainTab} onValueChange={setMainTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="calculator">Calcular Rendimiento</TabsTrigger>
              <TabsTrigger value="goal">Calcular Objetivo</TabsTrigger>
            </TabsList>
            <TabsContent value="calculator">
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="capital">Monto a Invertir (Q)</Label>
                  <Input
                    id="capital"
                    type="text"
                    value={capital}
                    onChange={(e) => setCapital(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="interest">Tasa de interés mensual (%)</Label>
                  <Input
                    id="interest"
                    type="number"
                    value={interestRate}
                    onChange={(e) => setInterestRate(Number(e.target.value))}
                    step="0.1"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="term">Plazo</Label>
                  <div className="flex gap-2">
                    <Input
                      id="term"
                      type="number"
                      value={term}
                      onChange={(e) => setTerm(Number(e.target.value))}
                      min="1"
                      className="flex-1"
                    />
                    <Select
                      value={termUnit}
                      onValueChange={(value) =>
                        setTermUnit(value as "months" | "years")
                      }
                    >
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="months">Meses</SelectItem>
                        <SelectItem value="years">Años</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="smallTaxpayer"
                      checked={isSmallTaxpayer}
                      onChange={(e) => setIsSmallTaxpayer(e.target.checked)}
                      className="rounded"
                    />
                    <Label htmlFor="smallTaxpayer">
                      Pequeño Contribuyente (IVA 5%)
                    </Label>
                  </div>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="goal">
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="desiredAmount">Monto Deseado (Q)</Label>
                  <Input
                    id="desiredAmount"
                    type="text"
                    value={desiredAmount}
                    onChange={(e) => setDesiredAmount(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Frecuencia</Label>
                  <Select
                    value={inverseMode}
                    onValueChange={(v) =>
                      setInverseMode(v as "monthly" | "lumpSum")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Mensual</SelectItem>
                      <SelectItem value="lumpSum">
                        Al final del plazo
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {inverseMode === "lumpSum" && (
                  <div className="space-y-2">
                    <Label>Tipo de Inversión</Label>
                    <Select
                      value={lumpSumType}
                      onValueChange={(v) =>
                        setLumpSumType(v as "compound" | "interest-only")
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="compound">
                          Interés Compuesto
                        </SelectItem>
                        <SelectItem value="interest-only">
                          Al Vencimiento
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="term-goal">Plazo</Label>
                  <div className="flex gap-2">
                    <Input
                      id="term-goal"
                      type="number"
                      value={term}
                      onChange={(e) => setTerm(Number(e.target.value))}
                      min="1"
                      className="flex-1"
                    />
                    <Select
                      value={termUnit}
                      onValueChange={(value) =>
                        setTermUnit(value as "months" | "years")
                      }
                    >
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="months">Meses</SelectItem>
                        <SelectItem value="years">Años</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="smallTaxpayerGoal"
                    checked={isSmallTaxpayer}
                    onChange={(e) => setIsSmallTaxpayer(e.target.checked)}
                    className="rounded"
                  />
                  <Label htmlFor="smallTaxpayerGoal">
                    Pequeño Contribuyente (IVA 5%)
                  </Label>
                </div>
              </div>
              {requiredCapital && (
                <Card className="mt-6">
                  <CardHeader>
                    <CardTitle>Capital Requerido</CardTitle>
                    <CardDescription>
                      Para alcanzar tu objetivo, necesitas invertir:
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">
                      Q{" "}
                      {requiredCapital.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>

          {/* Summary Tabs for the summary cards */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="my-4">
              <TabsTrigger value="standard">Tradicional</TabsTrigger>
              <TabsTrigger value="interest-only">Al vencimiento</TabsTrigger>
              <TabsTrigger value="compound">Interés Compuesto</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Total Intereses</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  Q{" "}
                  {activeTab === "compound"
                    ? (totalToReceive - displayCapital).toLocaleString(
                        "en-US",
                        {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }
                      )
                    : summaryNetProfit.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                </p>
                <p className="text-sm text-gray-500">* Incluye impuestos</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Total a Recibir</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  Q{" "}
                  {activeTab === "compound"
                    ? totalToReceive.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : (
                        totalToReceive -
                        summaryTotalInterest *
                          getVatRate() *
                          (investorPercentage / 100)
                      ).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Descargar Resumen</CardTitle>
              </CardHeader>
              <CardContent>
                <Button
                  className="flex justify-center items-center cursor-pointer"
                  onClick={handleOpenDialog}
                >
                  <Download className="w-4 h-4" />
                </Button>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      {/* Amortization Schedule Table with Tabs */}
      <Card>
        <CardHeader>
          <CardTitle>Tabla de Amortización</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="standard">Tradicional</TabsTrigger>
              <TabsTrigger value="interest-only">Al vencimiento</TabsTrigger>
              <TabsTrigger value="compound">Interés Compuesto</TabsTrigger>
            </TabsList>
            <TabsContent value="standard">
              <ScrollArea className="h-[500px] rounded-md border">
                <Table containerClassname="">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mes</TableHead>
                      <TableHead className="text-right">
                        Saldo inicial
                      </TableHead>
                      <TableHead className="text-right">
                        Interés + IVA
                      </TableHead>
                      <TableHead className="text-right">Amortización</TableHead>
                      <TableHead className="text-right">
                        Total a Recibir
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      let accumulatedInterestVatPayment = 0;
                      return standardSchedule.map((row, _index) => {
                        accumulatedInterestVatPayment += row.interestVatPayment;
                        return (
                          <TableRow key={row.month}>
                            <TableCell>{row.month}</TableCell>
                            <TableCell className="text-right">
                              Q{" "}
                              {row.initialBalance.toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </TableCell>
                            <TableCell className="text-right">
                              Q{" "}
                              {row.interestVatPayment.toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </TableCell>
                            <TableCell className="text-right">
                              Q{" "}
                              {row.amortization.toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </TableCell>
                            <TableCell className="text-right">
                              Q{" "}
                              {(
                                row.amortization + row.interestVatPayment
                              ).toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </TableCell>
                          </TableRow>
                        );
                      });
                    })()}
                  </TableBody>
                  <TableRow className="bg-gray-100 font-semibold">
                    <TableCell colSpan={2}>
                      Monto a Invertir: Q{" "}
                      {displayCapital.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      Total Intereses: Q{" "}
                      {activeTab === "compound"
                        ? (totalToReceive - displayCapital).toLocaleString(
                            "en-US",
                            {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            }
                          )
                        : summaryNetProfit.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                    </TableCell>
                    <TableCell colSpan={2} className="text-right">
                      Total a Recibir: Q{" "}
                      {activeTab === "compound"
                        ? totalToReceive.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                        : (
                            totalToReceive -
                            summaryTotalInterest *
                              getVatRate() *
                              (investorPercentage / 100)
                          ).toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                    </TableCell>
                  </TableRow>
                </Table>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </TabsContent>

            <TabsContent value="interest-only">
              <ScrollArea className="h-[500px] rounded-md border">
                <Table containerClassname="">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mes</TableHead>
                      <TableHead className="text-right">
                        Saldo inicial
                      </TableHead>
                      <TableHead className="text-right">
                        Interés + IVA
                      </TableHead>
                      <TableHead className="text-right">Amortización</TableHead>
                      <TableHead className="text-right">
                        Total a Recibir
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      let accumulatedInterestVatPaymentInterestOnly = 0;
                      return interestOnlySchedule.map((row) => {
                        accumulatedInterestVatPaymentInterestOnly +=
                          row.interestVatPayment;
                        return (
                          <TableRow key={row.month}>
                            <TableCell>{row.month}</TableCell>
                            <TableCell className="text-right">
                              Q{" "}
                              {row.initialBalance.toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </TableCell>
                            <TableCell className="text-right">
                              Q{" "}
                              {row.interestVatPayment.toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </TableCell>
                            <TableCell className="text-right">
                              Q{" "}
                              {row.amortization.toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </TableCell>
                            <TableCell className="text-right">
                              Q{" "}
                              {(
                                row.amortization + row.interestVatPayment
                              ).toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </TableCell>
                          </TableRow>
                        );
                      });
                    })()}
                  </TableBody>
                  <TableRow className="bg-gray-100 font-semibold">
                    <TableCell colSpan={2}>
                      Monto a Invertir: Q{" "}
                      {displayCapital.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      Total Intereses: Q{" "}
                      {activeTab === "compound"
                        ? (totalToReceive - displayCapital).toLocaleString(
                            "en-US",
                            {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            }
                          )
                        : summaryNetProfit.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                    </TableCell>
                    <TableCell colSpan={2} className="text-right">
                      Total a Recibir: Q{" "}
                      {activeTab === "compound"
                        ? totalToReceive.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                        : (
                            totalToReceive -
                            summaryTotalInterest *
                              getVatRate() *
                              (investorPercentage / 100)
                          ).toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                    </TableCell>
                  </TableRow>
                </Table>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </TabsContent>

            <TabsContent value="compound">
              <ScrollArea className="h-[500px] rounded-md border">
                <Table containerClassname="">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mes</TableHead>
                      <TableHead className="text-right">
                        Saldo inicial
                      </TableHead>
                      <TableHead className="text-right">
                        Interés + IVA
                      </TableHead>
                      <TableHead className="text-right">Amortización</TableHead>
                      <TableHead className="text-right">
                        Total Acumulado
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      let accumulatedInterestVatPaymentCompound = 0;
                      return compoundScheduleArr.map((row) => {
                        accumulatedInterestVatPaymentCompound +=
                          row.interestVatPayment;
                        return (
                          <TableRow key={row.month}>
                            <TableCell>{row.month}</TableCell>
                            <TableCell className="text-right">
                              Q{" "}
                              {row.initialBalance.toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </TableCell>
                            <TableCell className="text-right">
                              Q{" "}
                              {row.interestVatPayment.toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </TableCell>
                            <TableCell className="text-right">
                              Q{" "}
                              {row.amortization.toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </TableCell>
                            <TableCell className="text-right">
                              Q{" "}
                              {row.finalBalance.toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </TableCell>
                          </TableRow>
                        );
                      });
                    })()}
                  </TableBody>
                  <TableRow className="bg-gray-100 font-semibold">
                    <TableCell colSpan={2}>
                      Monto a Invertir: Q{" "}
                      {displayCapital.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      Total Intereses: Q{" "}
                      {activeTab === "compound"
                        ? (totalToReceive - displayCapital).toLocaleString(
                            "en-US",
                            {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            }
                          )
                        : summaryNetProfit.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                    </TableCell>
                    <TableCell colSpan={2} className="text-right">
                      Total Final: Q{" "}
                      {(
                        compoundScheduleArr[compoundScheduleArr.length - 1]
                          ?.finalBalance || 0
                      ).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                  </TableRow>
                </Table>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogTitle>Inversión con Club Cash In</DialogTitle>
          <DialogDescription>
            <div className="space-y-4 p-4 rounded-md">
              <div className="flex justify-between text-lg font-semibold">
                <p>Monto a Invertir:</p>
                <span className="text-black">
                  Q
                  {displayCapital.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-semibold">
                <p>Plazo:</p>
                <span className="text-black">{getTermInMonths()} Meses</span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-semibold">
                <p>Tasa de Interés Mensual:</p>
                <span className="text-black">
                  {(interestRate * (investorPercentage / 100)).toFixed(2)}%
                </span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-semibold">
                <p>Tipo de Pago:</p>
                <span className="text-black">
                  {activeTab === "compound"
                    ? "Interés Compuesto"
                    : activeTab === "interest-only"
                      ? "Al vencimiento"
                      : "Estándar"}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-semibold">
                <p>Fecha de Vencimiento:</p>
                <span className="text-black">
                  {new Date(
                    Date.now() + getTermInMonths() * 30 * 24 * 60 * 60 * 1000
                  ).toLocaleDateString()}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-semibold">
                <p>Intereses Ganados:</p>
                <span className="text-black">
                  Q
                  {activeTab === "compound"
                    ? (totalToReceive - displayCapital).toLocaleString(
                        "en-US",
                        {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }
                      )
                    : summaryNetProfit.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-semibold">
                <p>Impuestos a Pagar:</p>
                <span className="text-black">
                  Q
                  {activeTab === "compound"
                    ? (summaryTotalInterest * getVatRate()).toLocaleString(
                        "en-US",
                        {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }
                      )
                    : (
                        summaryTotalInterest *
                        getVatRate() *
                        (investorPercentage / 100)
                      ).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-semibold">
                <p>Total a Recibir:</p>
                <span className="text-black">
                  Q
                  {activeTab === "compound"
                    ? totalToReceive.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : (
                        totalToReceive -
                        summaryTotalInterest *
                          getVatRate() *
                          (investorPercentage / 100)
                      ).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-semibold">
                <p>Tipo de Contribuyente:</p>
                <span className="text-black">
                  {isSmallTaxpayer
                    ? "Pequeño Contribuyente (IVA 5%)"
                    : "Contribuyente Normal (IVA 12%)"}
                </span>
              </div>
            </div>
          </DialogDescription>
          <Button
            className="bg-gray-100 text-black hover:bg-gray-200 cursor-pointer"
            onClick={handleDownload}
          >
            Descargar
          </Button>
          <Button onClick={handleCloseDialog}>Cerrar</Button>
        </DialogContent>
      </Dialog>

      {/* Admin Login Dialog */}
      <Dialog open={isLoginDialogOpen} onOpenChange={setIsLoginDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Admin Login</DialogTitle>
          <DialogDescription>
            Ingrese sus credenciales de administrador
          </DialogDescription>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="username" className="text-right">
                Usuario
              </Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="password" className="text-right">
                Contraseña
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="col-span-3"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" onClick={handleLogin}>
              Ingresar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admin Settings Panel */}
      <Dialog open={isAdminPanelOpen} onOpenChange={setIsAdminPanelOpen}>
        <DialogContent className="z-[100]">
          <DialogTitle>Configuración de Administrador</DialogTitle>
          <DialogDescription>
            Ajuste los parámetros de la calculadora
          </DialogDescription>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="adminInterestRate" className="text-right">
                Tasa de interés (%)
              </Label>
              <Input
                id="adminInterestRate"
                type="number"
                value={adminInterestRate}
                onChange={(e) => setAdminInterestRate(Number(e.target.value))}
                step="0.1"
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="adminInvestorPercentage" className="text-right">
                Porcentaje del inversionista (%)
              </Label>
              <Input
                id="adminInvestorPercentage"
                type="number"
                value={adminInvestorPercentage}
                onChange={(e) => {
                  // Allow typing any value temporarily
                  setAdminInvestorPercentage(Number(e.target.value));
                }}
                onBlur={(e) => {
                  // Enforce the range when the input loses focus
                  const value = Number(e.target.value);
                  if (value < 70) {
                    setAdminInvestorPercentage(70);
                  } else if (value > 90) {
                    setAdminInvestorPercentage(90);
                  }
                }}
                min="70"
                max="90"
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="adminSmallTaxpayer" className="text-right">
                Pequeño Contribuyente
              </Label>
              <div className="col-span-3">
                <input
                  type="checkbox"
                  id="adminSmallTaxpayer"
                  checked={adminIsSmallTaxpayer}
                  onChange={(e) => setAdminIsSmallTaxpayer(e.target.checked)}
                  className="rounded"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" onClick={handleSaveAdminSettings}>
              Guardar Cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Toaster />
    </div>
  );
}
