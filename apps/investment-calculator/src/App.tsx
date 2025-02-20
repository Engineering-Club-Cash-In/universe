"use client";

import { useState } from "react";
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
import { Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  const [capital, setCapital] = useState<number>(7591.11);
  const [interestRate, setInterestRate] = useState<number>(1.5);
  const [term, setTerm] = useState<number>(1);
  const [investorPercentage, setInvestorPercentage] = useState<number>(70);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // New shared state for the selected schedule type
  const [activeTab, setActiveTab] = useState("standard");

  // Standard amortization schedule (capital returned monthly)
  const calculateMonthlyPayment = (
    principal: number,
    rate: number,
    term: number
  ) => {
    const monthlyRate = (rate * 1.12) / 100;
    const totalMonths = term * 12;
    return (
      (principal * monthlyRate * Math.pow(1 + monthlyRate, totalMonths)) /
      (Math.pow(1 + monthlyRate, totalMonths) - 1)
    );
  };

  const generateAmortizationSchedule = (): AmortizationRow[] => {
    const schedule: AmortizationRow[] = [];
    const monthlyPayment = calculateMonthlyPayment(capital, interestRate, term);
    let balance = capital;
    for (let month = 1; month <= term * 12; month++) {
      const interest = balance * (interestRate / 100);
      const vat = interest * 0.12;
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
  const generateInterestOnlySchedule = (): AmortizationRow[] => {
    const schedule: AmortizationRow[] = [];
    const totalMonths = term * 12;
    for (let month = 1; month <= totalMonths; month++) {
      const interest = capital * (interestRate / 100);
      const vat = interest * 0.12;
      const interestPlusVat = interest + vat;
      if (month < totalMonths) {
        schedule.push({
          month,
          initialBalance: capital,
          interest,
          vat,
          interestPlusVat,
          payment: interestPlusVat,
          interestVatPayment: interestPlusVat * (investorPercentage / 100),
          amortization: 0,
          finalBalance: capital,
        });
      } else {
        schedule.push({
          month,
          initialBalance: capital,
          interest,
          vat,
          interestPlusVat,
          payment: interestPlusVat + capital, // add capital on final month
          interestVatPayment: interestPlusVat * (investorPercentage / 100),
          amortization: capital,
          finalBalance: 0,
        });
      }
    }
    return schedule;
  };

  // Compound interest schedule (net interest is reinvested)
  const generateCompoundSchedule = (): AmortizationRow[] => {
    const schedule: AmortizationRow[] = [];
    const totalMonths = term * 12;
    let balance = capital;
    for (let month = 1; month <= totalMonths; month++) {
      const interest = balance * (interestRate / 100);
      const vat = interest * 0.12;
      const netInterest = interest - vat; // reinvest net interest
      schedule.push({
        month,
        initialBalance: balance,
        interest,
        vat,
        interestPlusVat: interest + vat,
        payment: netInterest,
        interestVatPayment: (interest + vat) * (investorPercentage / 100),
        amortization: 0,
        finalBalance: balance + netInterest,
      });
      balance = balance + netInterest;
    }
    return schedule;
  };

  const standardSchedule = generateAmortizationSchedule();
  const interestOnlySchedule = generateInterestOnlySchedule();
  const compoundScheduleArr = generateCompoundSchedule();

  // Determine which schedule to use based on the selected tab
  const scheduleForActiveTab =
    activeTab === "standard"
      ? standardSchedule
      : activeTab === "interest-only"
      ? interestOnlySchedule
      : compoundScheduleArr;

  // Compute summary values from the selected schedule.
  const summaryMonthlyPayment = scheduleForActiveTab[0]?.payment || 0;
  const summaryTotalInterest = scheduleForActiveTab.reduce(
    (sum, row) => sum + row.interest,
    0
  );
  const summaryNetProfit = summaryTotalInterest * (investorPercentage / 100);

  const handleDownload = () => {
    const input = document.querySelector(".container") as HTMLElement;
    if (input) {
      html2canvas(input).then((canvas) => {
        const imgData = canvas.toDataURL("image/png");
        const pdf = new jsPDF({
          orientation: "portrait",
          unit: "px",
          format: [canvas.width, canvas.height],
        });
        pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
        pdf.save("calculadora-inversion.pdf");
      });
    }
  };

  const handleOpenDialog = () => {
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
  };

  return (
    <div className="container mx-auto py-8">
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-4xl font-bold flex justify-between items-center gap-4">
            Calculadora de Inversión
            <img src={Logo} alt="Club Cash In Logo" width={250} height={64} />
          </CardTitle>
          <CardDescription>
            *El interés siempre es calculado sobre saldo
            <br />
            *No hay penalización por cancelación anticipada de créditos
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="capital">Capital (Q)</Label>
              <Input
                id="capital"
                type="number"
                value={capital}
                onChange={(e) => setCapital(Number(e.target.value))}
                step="0.01"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="interest">Tasa de interés (%)</Label>
              <Input
                id="interest"
                type="number"
                value={interestRate}
                onChange={(e) => setInterestRate(Number(e.target.value))}
                step="0.1"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="term">Plazo (Años)</Label>
              <Select
                value={term.toString()}
                onValueChange={(value) => setTerm(Number(value))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="3">3</SelectItem>
                  <SelectItem value="4">4</SelectItem>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="6">6</SelectItem>
                  <SelectItem value="7">7</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cashIn">Cash-in (%)</Label>
              <Input
                id="cashIn"
                type="number"
                value={100 - investorPercentage}
                onChange={(e) =>
                  setInvestorPercentage(100 - Number(e.target.value))
                }
              />
            </div>
          </div>

          {/* Summary Tabs for the summary cards */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="my-4">
              <TabsTrigger value="standard">Estándar</TabsTrigger>
              <TabsTrigger value="interest-only">
                Sin devolución mensual
              </TabsTrigger>
              <TabsTrigger value="compound">Interés Compuesto</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>
                  {activeTab === "compound"
                    ? "Crecimiento Mensual Promedio"
                    : "Cuota mensual"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  Q{" "}
                  {activeTab === "compound"
                    ? (
                        compoundScheduleArr.reduce(
                          (acc, row) => acc + row.payment,
                          0
                        ) / compoundScheduleArr.length
                      ).toFixed(2)
                    : summaryMonthlyPayment.toFixed(2)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Inversionista</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{investorPercentage}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Utilidad Neta Inversor</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  Q {summaryNetProfit.toFixed(2)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Exportar Resumen</CardTitle>
              </CardHeader>
              <CardContent>
                <Button
                  className="flex justify-center items-center gap-2 cursor-pointer"
                  onClick={handleOpenDialog}
                >
                  <Download className="w-4 h-4 mr-2" />
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
              <TabsTrigger value="standard">Estándar</TabsTrigger>
              <TabsTrigger value="interest-only">
                Sin devolución mensual
              </TabsTrigger>
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
                      <TableHead className="text-right">Cuota</TableHead>
                      <TableHead className="text-right">
                        Interés + IVA
                      </TableHead>
                      <TableHead className="text-right">Amortización</TableHead>
                      <TableHead className="text-right">Saldo final</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {standardSchedule.map((row) => (
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
                          {row.payment.toLocaleString("en-US", {
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
                    ))}
                  </TableBody>
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
                      <TableHead className="text-right">Cuota</TableHead>
                      <TableHead className="text-right">
                        Interés + IVA
                      </TableHead>
                      <TableHead className="text-right">Saldo final</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {interestOnlySchedule.map((row) => (
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
                          {row.payment.toLocaleString("en-US", {
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
                          {row.finalBalance.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
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
                      <TableHead className="text-right">Cuota</TableHead>
                      <TableHead className="text-right">
                        Interés + IVA
                      </TableHead>
                      <TableHead className="text-right">Saldo final</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {compoundScheduleArr.map((row) => (
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
                          {row.payment.toLocaleString("en-US", {
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
                          {row.finalBalance.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogTitle>Depósito a Plazo Fijo</DialogTitle>
          <DialogDescription>
            <div className="space-y-4 p-4 rounded-md">
              <div className="flex justify-between text-lg font-semibold">
                <p>Monto a Invertir:</p>
                <span className="text-black">Q{capital.toFixed(2)}</span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-semibold">
                <p>Plazo:</p>
                <span className="text-black">{term * 12} Meses</span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-semibold">
                <p>Tasa de Interés:</p>
                <span className="text-black">{interestRate.toFixed(1)}%</span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-semibold">
                <p>Tipo de Pago:</p>
                <span className="text-black">
                  {activeTab === "compound"
                    ? "Interés Compuesto"
                    : activeTab === "interest-only"
                    ? "Sin devolución mensual"
                    : "Estándar"}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-semibold">
                <p>Fecha de Vencimiento:</p>
                <span className="text-black">
                  {new Date(
                    Date.now() + term * 365 * 24 * 60 * 60 * 1000
                  ).toLocaleDateString()}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-semibold">
                <p>Intereses Ganados:</p>
                <span className="text-black">
                  Q{summaryTotalInterest.toFixed(2)}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-semibold">
                <p>Impuestos a Pagar:</p>
                <span className="text-black">
                  Q{(summaryTotalInterest * 0.12).toFixed(2)}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-semibold">
                <p>Total a Recibir:</p>
                <span className="text-black">
                  Q
                  {(
                    capital +
                    summaryTotalInterest -
                    summaryTotalInterest * 0.12
                  ).toFixed(2)}
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
    </div>
  );
}
