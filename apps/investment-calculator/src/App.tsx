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
  const [term, setTerm] = useState<number>(12);
  const [investorPercentage, setInvestorPercentage] = useState<number>(70);

  // Calculate monthly payment using PMT formula
  const calculateMonthlyPayment = (
    principal: number,
    rate: number,
    term: number
  ) => {
    const monthlyRate = (rate * 1.12) / 100;
    return (
      (principal * monthlyRate * Math.pow(1 + monthlyRate, term)) /
      (Math.pow(1 + monthlyRate, term) - 1)
    );
  };

  // Generate amortization schedule
  const generateAmortizationSchedule = (): AmortizationRow[] => {
    const schedule: AmortizationRow[] = [];
    const monthlyPayment = calculateMonthlyPayment(capital, interestRate, term);
    let balance = capital;

    for (let month = 1; month <= term; month++) {
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

  return (
    <div className="container mx-auto py-8">
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-4xl font-bold">
            Detalle de Inversionista
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
              <Label htmlFor="term">Plazo (Meses)</Label>
              <Select
                value={term.toString()}
                onValueChange={(value) => setTerm(Number(value))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="12">12</SelectItem>
                  <SelectItem value="24">24</SelectItem>
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
                  <TableHead>Mes</TableHead>
                  <TableHead className="text-right">Saldo inicial</TableHead>
                  <TableHead className="text-right">Intereses</TableHead>
                  <TableHead className="text-right">IVA</TableHead>
                  <TableHead className="text-right">Interés + IVA</TableHead>
                  <TableHead className="text-right">Cuota</TableHead>
                  <TableHead className="text-right">Interés + IVA</TableHead>
                  <TableHead className="text-right">Amortización</TableHead>
                  <TableHead className="text-right">Saldo final</TableHead>
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
                      Q {row.interest.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      Q {row.vat.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      Q {row.interestPlusVat.toFixed(2)}
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
    </div>
  );
}
