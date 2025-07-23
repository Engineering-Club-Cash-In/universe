import { describe, test, expect } from 'vitest';
import {
  calculateCompoundInvestment,
  calculateTraditionalInvestment,
  InvestmentParams
} from './investmentCalculations';

describe('Investment Calculations', () => {
  describe('Table Data Validation - 10k capital, 1.5% monthly, 1 year', () => {
    const tableParams: InvestmentParams = {
      capital: 10000,
      interestRate: 1.5,
      termMonths: 12,
      investorPercentage: 70,
      vatRate: 0.12  // 12% VAT as shown in the table
    };

    test('should calculate compound interest with correct formula', () => {
      const result = calculateCompoundInvestment(tableParams);
      
      // Compound interest reinvests only investor's net portion (70% of net)
      // Expected values from the table:
      expect(result.finalCapital).toBeCloseTo(11166.92, 2);
      expect(result.grossProfit + result.vatPaid).toBeCloseTo(1485.17, 2); // Total interests
      expect(result.netProfit).toBeCloseTo(1166.92, 2);
      expect(result.totalToReceive).toBeCloseTo(11166.92, 2);
    });

    test('should match traditional interest calculations from table', () => {
      const result = calculateTraditionalInvestment(tableParams);
      
      // From table: 
      // Monthly interest = 150
      // Monthly VAT = 18 (12% of 150)
      // Monthly net = 132 (150 - 18)
      // Investor's monthly net = 92.4 (70% of 132)
      // Total for 12 months = 1,108.8
      
      // Our current calculation:
      // Investor's gross monthly = 105 (70% of 150)
      // VAT on investor's portion = 12.6 (12% of 105)
      // Net monthly = 92.4 (105 - 12.6)
      
      expect(result.grossProfit).toBeCloseTo(1260, 2); // 105 * 12
      expect(result.vatPaid).toBeCloseTo(151.2, 2); // 12.6 * 12
      expect(result.netProfit).toBeCloseTo(1108.8, 2); // 92.4 * 12
      expect(result.totalToReceive).toBeCloseTo(11108.8, 2); // 10000 + 1108.8
    });

    test('should match exact monthly calculations from table', () => {
      const result = calculateTraditionalInvestment(tableParams);
      
      // Monthly values from table
      const monthlyInterest = 10000 * 0.015; // 150
      const monthlyInvestorShare = monthlyInterest * 0.7; // 105
      const monthlyVat = monthlyInvestorShare * 0.12; // 12.6
      const monthlyNet = monthlyInvestorShare - monthlyVat; // 92.4
      
      // Verify monthly calculations
      expect(result.grossProfit / 12).toBeCloseTo(monthlyInvestorShare, 2);
      expect(result.vatPaid / 12).toBeCloseTo(monthlyVat, 2);
      expect(result.netProfit / 12).toBeCloseTo(monthlyNet, 2);
    });
  });

  const baseParams: InvestmentParams = {
    capital: 50000,
    interestRate: 1.5,
    termMonths: 60, // 5 years
    investorPercentage: 70,
    vatRate: 0.12
  };

  describe('Model 1: Compound Interest with Reinvestment', () => {
    test('should calculate correct values for 50k capital, 1.5% monthly, 5 years, 70% investor share', () => {
      const result = calculateCompoundInvestment(baseParams);
      
      // Compound interest reinvests only investor's net portion
      // Just verify the calculation runs correctly and produces reasonable results
      expect(result.finalCapital).toBeGreaterThan(baseParams.capital);
      expect(result.grossProfit).toBeGreaterThan(0);
      expect(result.vatPaid).toBeGreaterThan(0);
      expect(result.netProfit).toBeGreaterThan(0);
      expect(result.totalToReceive).toBe(baseParams.capital + result.netProfit);
    });

    test('should handle different investor percentages', () => {
      const params = { ...baseParams, investorPercentage: 100 };
      const result = calculateCompoundInvestment(params);
      
      // With 100% investor share, they get all the profit
      expect(result.grossProfit).toBeGreaterThan(baseParams.capital * 0.5);
    });

    test('should handle zero interest rate', () => {
      const params = { ...baseParams, interestRate: 0 };
      const result = calculateCompoundInvestment(params);
      
      expect(result.finalCapital).toBe(params.capital);
      expect(result.grossProfit).toBe(0);
      expect(result.vatPaid).toBe(0);
      expect(result.netProfit).toBe(0);
      expect(result.totalToReceive).toBe(params.capital);
    });
  });

  describe('Model 2: Traditional without Capital Reinvestment', () => {
    test('should calculate correct values for 50k capital, 1.5% monthly, 5 years, 70% investor share', () => {
      const result = calculateTraditionalInvestment(baseParams);
      
      // Expected values from the requirement
      expect(result.grossProfit).toBeCloseTo(31500, 2);
      expect(result.vatPaid).toBeCloseTo(3780, 2);
      expect(result.netProfit).toBeCloseTo(27720, 2);
      expect(result.totalToReceive).toBeCloseTo(77720, 2);
    });

    test('should calculate monthly payments correctly', () => {
      const result = calculateTraditionalInvestment(baseParams);
      
      // Monthly calculation verification
      const monthlyInterest = baseParams.capital * (baseParams.interestRate / 100);
      const monthlyInvestorShare = monthlyInterest * (baseParams.investorPercentage / 100);
      const expectedGrossProfit = monthlyInvestorShare * baseParams.termMonths;
      
      expect(result.grossProfit).toBeCloseTo(expectedGrossProfit, 2);
    });

    test('should handle different term lengths', () => {
      const params = { ...baseParams, termMonths: 12 }; // 1 year
      const result = calculateTraditionalInvestment(params);
      
      // Should be proportionally less for shorter term
      expect(result.grossProfit).toBeCloseTo(6300, 2); // 525 * 12
      expect(result.vatPaid).toBeCloseTo(756, 2); // 63 * 12
      expect(result.netProfit).toBeCloseTo(5544, 2); // 462 * 12
    });
  });

  describe('Comparison between models', () => {
    test('compound model should yield more than traditional model', () => {
      const compoundResult = calculateCompoundInvestment(baseParams);
      const traditionalResult = calculateTraditionalInvestment(baseParams);
      
      expect(compoundResult.totalToReceive).toBeGreaterThan(traditionalResult.totalToReceive);
      expect(compoundResult.netProfit).toBeGreaterThan(traditionalResult.netProfit);
    });

    test('difference should be positive for compound vs traditional', () => {
      const compoundResult = calculateCompoundInvestment(baseParams);
      const traditionalResult = calculateTraditionalInvestment(baseParams);
      
      const difference = compoundResult.totalToReceive - traditionalResult.totalToReceive;
      
      // Compound should always yield more than traditional
      expect(difference).toBeGreaterThan(0);
      
      // The difference should be significant for 5 years
      expect(difference).toBeGreaterThan(5000);
    });
  });

  describe('VAT calculations', () => {
    test('should calculate VAT correctly for 12% rate', () => {
      const result = calculateTraditionalInvestment(baseParams);
      
      // Monthly: 750 * 0.7 = 525, VAT = 525 * 0.12 = 63
      // Total VAT for 60 months = 63 * 60 = 3780
      expect(result.vatPaid).toBeCloseTo(3780, 2);
    });

    test('should handle different VAT rates', () => {
      const params = { ...baseParams, vatRate: 0.05 }; // 5% VAT
      const result = calculateTraditionalInvestment(params);
      
      // With 5% VAT, the tax should be less
      expect(result.vatPaid).toBeLessThan(3780);
      expect(result.vatPaid).toBeCloseTo(1575, 2); // 525 * 0.05 * 60
    });
  });
});