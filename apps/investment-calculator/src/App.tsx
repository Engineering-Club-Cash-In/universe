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

  // Calculate monthly payment using PMT formula
  const calculateMonthlyPayment = (
    principal: number,
    rate: number,
    term: number
  ) => {
    const monthlyRate = (rate * 1.12) / 100;
    const totalMonths = term * 12; // Convert years to months
    return (
      (principal * monthlyRate * Math.pow(1 + monthlyRate, totalMonths)) /
      (Math.pow(1 + monthlyRate, totalMonths) - 1)
    );
  };

  // Generate amortization schedule
  const generateAmortizationSchedule = (): AmortizationRow[] => {
    const schedule: AmortizationRow[] = [];
    const monthlyPayment = calculateMonthlyPayment(capital, interestRate, term);
    let balance = capital;

    for (let month = 1; month <= term * 12; month++) {
      const interest = balance * (interestRate / 100);
      const vat = interest * 0.12; // 12% VAT
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
        finalBalance: finalBalance < 0.01 ? 0 : finalBalance, // Handle rounding
      });

      balance = finalBalance;
    }

    return schedule;
  };

  const schedule = generateAmortizationSchedule();
  const monthlyPayment = schedule[0]?.payment || 0;
  const totalInterest = schedule.reduce((sum, row) => sum + row.interest, 0);
  const netProfit = totalInterest * (investorPercentage / 100);

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

          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Cuota mensual</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  Q {monthlyPayment.toFixed(2)}
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
                <p className="text-2xl font-bold">Q {netProfit.toFixed(2)}</p>
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

      <Card>
        <CardHeader>
          <CardTitle>Tabla de Amortización</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px] rounded-md border">
            <Table containerClassname="">
              <TableHeader>
                <TableRow>
                  <TableHead className="font-bold text-black">Mes</TableHead>
                  <TableHead className="text-right text-black font-bold">
                    Saldo inicial
                  </TableHead>
                  <TableHead className="text-right text-black font-bold">
                    Cuota
                  </TableHead>
                  <TableHead className="text-right text-black font-bold">
                    Interés + IVA
                  </TableHead>
                  <TableHead className="text-right text-black font-bold">
                    Amortización
                  </TableHead>
                  <TableHead className="text-right text-black font-bold">
                    Saldo final
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="">
                {schedule.map((row) => (
                  <TableRow key={row.month}>
                    <TableCell>{row.month}</TableCell>
                    <TableCell className="text-right">
                      Q {row.initialBalance.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      Q {row.payment.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      Q {row.interestVatPayment.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      Q {row.amortization.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      Q {row.finalBalance.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogTitle>Deposito a Plazo Fijo</DialogTitle>
          <DialogDescription>
            <div className="space-y-4 p-4  rounded-md">
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
                <span className="text-black">Al Vencimiento</span>
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
                <span className="text-black">Q{totalInterest.toFixed(2)}</span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-semibold">
                <p>Impuestos a Pagar:</p>
                <span className="text-black">
                  Q{(totalInterest * 0.12).toFixed(2)}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-semibold">
                <p>Total a Recibir:</p>
                <span className="text-black">
                  Q{(capital + totalInterest - totalInterest * 0.12).toFixed(2)}
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
