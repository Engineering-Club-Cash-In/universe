import { describe, it, expect } from "vitest";
import {
  calculateMonthlyPayment,
  generateAmortizationSchedule,
  generateInterestOnlySchedule,
  generateCompoundSchedule,
  calculateSummary,
  calculateRequiredCapitalForMonthly,
  calculateRequiredCapitalForCompound,
  calculateRequiredCapitalForInterestOnly,
  type CalculationParams,
} from "./calculations";

describe("Investment Calculations", () => {
  const baseParams: CalculationParams = {
    principal: 50000,
    interestRate: 1.5,
    termMonths: 12,
    investorPercentage: 70,
    vatRate: 0.12,
  };

  describe("Standard Amortization", () => {
    it("should calculate correct monthly payment", () => {
      const payment = calculateMonthlyPayment(
        baseParams.principal,
        baseParams.interestRate,
        baseParams.termMonths,
        baseParams.vatRate,
      );

      // Monthly payment should be around Q4,635.55
      expect(payment).toBeCloseTo(4635.55, 2);
    });

    it("should generate correct amortization schedule", () => {
      const schedule = generateAmortizationSchedule(baseParams);

      expect(schedule).toHaveLength(12);

      // First month
      expect(schedule[0].month).toBe(1);
      expect(schedule[0].initialBalance).toBe(50000);
      expect(schedule[0].interest).toBeCloseTo(750, 2);
      expect(schedule[0].vat).toBeCloseTo(90, 2);
      expect(schedule[0].interestPlusVat).toBeCloseTo(840, 2);
      expect(schedule[0].interestVatPayment).toBeCloseTo(588, 2); // 70% of 840
      expect(schedule[0].payment).toBeCloseTo(4635.55, 2);
      expect(schedule[0].amortization).toBeCloseTo(3795.55, 2);

      // Last month should have zero balance
      expect(schedule[11].finalBalance).toBe(0);
    });

    it("should calculate correct summary for standard amortization", () => {
      const schedule = generateAmortizationSchedule(baseParams);
      const summary = calculateSummary(
        schedule,
        baseParams.principal,
        baseParams.investorPercentage,
        baseParams.vatRate,
        "standard",
      );

      // Total interest should be around Q5,626.66
      expect(summary.totalInterest).toBeCloseTo(5626.66, 2);
      // Net profit (70%) should be around Q3,938.66
      expect(summary.netProfit).toBeCloseTo(3938.66, 2);
      // Total to receive after taxes
      expect(summary.totalToReceive).toBeCloseTo(53516.66, 2);
    });
  });

  describe("Interest-Only Schedule", () => {
    it("should generate correct interest-only schedule", () => {
      const schedule = generateInterestOnlySchedule(baseParams);

      expect(schedule).toHaveLength(12);

      // All months except last should have same balance
      for (let i = 0; i < 11; i++) {
        expect(schedule[i].initialBalance).toBe(50000);
        expect(schedule[i].finalBalance).toBe(50000);
        expect(schedule[i].amortization).toBe(0);
        // Investor gets 70% of interest (525) + VAT on that (63) = 588
        expect(schedule[i].payment).toBeCloseTo(588, 2);
      }

      // Last month should include principal
      expect(schedule[11].payment).toBeCloseTo(50588, 2); // Principal + investor's monthly payment
      expect(schedule[11].amortization).toBe(50000);
      expect(schedule[11].finalBalance).toBe(0);
    });

    it("should calculate correct summary for interest-only", () => {
      const schedule = generateInterestOnlySchedule(baseParams);
      const summary = calculateSummary(
        schedule,
        baseParams.principal,
        baseParams.investorPercentage,
        baseParams.vatRate,
        "interest-only",
      );

      // Total interest: 840 * 12 = 10,080
      expect(summary.totalInterest).toBeCloseTo(10080, 2);
      // Net profit (70%): 7,056
      expect(summary.netProfit).toBeCloseTo(7056, 2);
      // Total to receive: 588 * 12 + 50000 = 57056
      expect(summary.totalToReceive).toBeCloseTo(57056, 2);
    });
  });

  describe("Compound Interest Schedule", () => {
    it("should generate correct compound interest schedule", () => {
      const schedule = generateCompoundSchedule(baseParams);

      expect(schedule).toHaveLength(12);

      // First month
      expect(schedule[0].initialBalance).toBe(50000);
      expect(schedule[0].interest).toBeCloseTo(750, 2);
      expect(schedule[0].vat).toBeCloseTo(90, 2);

      // Gross interest: 750
      // Investor's share (70%): 525 + VAT (63) = 588
      expect(schedule[0].finalBalance).toBeCloseTo(50588, 2);

      // Second month should start with previous final balance
      expect(schedule[1].initialBalance).toBeCloseTo(50588, 2);

      // Final balance should be compounded
      const finalBalance = schedule[11].finalBalance;
      expect(finalBalance).toBeGreaterThan(baseParams.principal);
    });

    it("should calculate correct summary for compound interest", () => {
      const schedule = generateCompoundSchedule(baseParams);
      const summary = calculateSummary(
        schedule,
        baseParams.principal,
        baseParams.investorPercentage,
        baseParams.vatRate,
        "compound",
      );

      // Total compound taxes should be zero (VAT paid by borrower)
      expect(summary.totalCompoundTaxes).toBe(0);

      // Total to receive should be final balance
      const finalBalance = schedule[11].finalBalance;
      expect(summary.totalToReceive).toBeCloseTo(finalBalance, 2);
    });

    it("should correctly compound with 70% investor share", () => {
      const schedule = generateCompoundSchedule(baseParams);

      // Manual calculation for verification
      let balance = 50000;
      for (let i = 0; i < 12; i++) {
        const interest = balance * 0.015; // 1.5%
        const investorInterest = interest * 0.7; // 70% share
        const investorVat = investorInterest * 0.12; // VAT on investor's share
        const investorGross = investorInterest + investorVat;
        balance += investorGross;
      }

      expect(schedule[11].finalBalance).toBeCloseTo(balance, 2);
    });
  });

  describe("VAT Calculations", () => {
    it("should handle small taxpayer VAT rate (5%)", () => {
      const smallTaxpayerParams = { ...baseParams, vatRate: 0.05 };

      const schedule = generateAmortizationSchedule(smallTaxpayerParams);

      // First month VAT should be 5% of interest
      expect(schedule[0].vat).toBeCloseTo(37.5, 2); // 750 * 0.05
      expect(schedule[0].interestPlusVat).toBeCloseTo(787.5, 2);
    });

    it("should handle normal taxpayer VAT rate (12%)", () => {
      const schedule = generateAmortizationSchedule(baseParams);

      // First month VAT should be 12% of interest
      expect(schedule[0].vat).toBeCloseTo(90, 2); // 750 * 0.12
      expect(schedule[0].interestPlusVat).toBeCloseTo(840, 2);
    });
  });

  describe("Inverse Calculations (Goal Mode)", () => {
    it("should calculate required capital for monthly payments", () => {
      const desiredAmount = 588; // Monthly payment desired
      const capital = calculateRequiredCapitalForMonthly(
        desiredAmount,
        baseParams.interestRate,
        baseParams.investorPercentage,
        baseParams.vatRate,
      );

      // Should be around Q50,000
      expect(capital).toBeCloseTo(50000, 2);
    });

    it("should calculate required capital for compound interest", () => {
      // First calculate what we get from 50,000
      const schedule = generateCompoundSchedule(baseParams);
      const summary = calculateSummary(
        schedule,
        baseParams.principal,
        baseParams.investorPercentage,
        baseParams.vatRate,
        "compound",
      );

      // Now use the net amount (after taxes) as desired amount
      const capital = calculateRequiredCapitalForCompound(
        summary.totalToReceive,
        baseParams.interestRate,
        baseParams.termMonths,
        baseParams.investorPercentage,
        baseParams.vatRate,
      );

      // Should get back to Q50,000
      expect(capital).toBeCloseTo(50000, 2);
    });
    it("should calculate required capital for interest-only", () => {
      const desiredAmount = 50588; // Final payment desired
      const capital = calculateRequiredCapitalForInterestOnly(
        desiredAmount,
        baseParams.interestRate,
        baseParams.investorPercentage,
        baseParams.vatRate,
      );

      // Should be around Q50,000
      expect(capital).toBeCloseTo(50000, 100);
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero principal", () => {
      const zeroParams = { ...baseParams, principal: 0 };
      const schedule = generateAmortizationSchedule(zeroParams);

      expect(schedule).toHaveLength(12);
      schedule.forEach((row) => {
        expect(row.interest).toBe(0);
        expect(row.vat).toBe(0);
        expect(row.payment).toBe(0);
      });
    });

    it("should handle very short terms", () => {
      const shortParams = { ...baseParams, termMonths: 1 };
      const schedule = generateAmortizationSchedule(shortParams);

      expect(schedule).toHaveLength(1);
      expect(schedule[0].finalBalance).toBe(0);
    });

    it("should handle 100% investor percentage", () => {
      const fullParams = { ...baseParams, investorPercentage: 100 };
      const schedule = generateCompoundSchedule(fullParams);

      // Should compound faster with 100% reinvestment
      expect(schedule[11].finalBalance).toBeGreaterThan(
        generateCompoundSchedule(baseParams)[11].finalBalance,
      );
    });
  });

  describe("Precision and Rounding", () => {
    it("should handle rounding correctly in final payment", () => {
      const schedule = generateAmortizationSchedule(baseParams);

      // Sum of all amortizations should equal principal
      const totalAmortization = schedule.reduce(
        (sum, row) => sum + row.amortization,
        0,
      );

      expect(Math.abs(totalAmortization - baseParams.principal)).toBeLessThan(
        1,
      );
    });

    it("should ensure final balance is exactly zero", () => {
      const schedule = generateAmortizationSchedule(baseParams);
      expect(schedule[11].finalBalance).toBe(0);

      const interestOnlySchedule = generateInterestOnlySchedule(baseParams);
      expect(interestOnlySchedule[11].finalBalance).toBe(0);
    });
  });
});
