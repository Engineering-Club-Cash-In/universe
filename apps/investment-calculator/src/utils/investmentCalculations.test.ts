import { describe, test, expect } from 'vitest';
import {
  calculateCompoundInvestment,
  calculateTraditionalInvestment,
  InvestmentParams
} from './investmentCalculations';

describe('Investment Calculations', () => {
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
      
      // Expected values from the requirement
      expect(result.finalCapital).toBeCloseTo(93572.68, 2);
      expect(result.grossProfit).toBeCloseTo(43572.68, 2);
      expect(result.vatPaid).toBeCloseTo(5228.72, 2);
      expect(result.netProfit).toBeCloseTo(38343.96, 2);
      expect(result.totalToReceive).toBeCloseTo(88343.96, 2);
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

    test('difference should match expected values', () => {
      const compoundResult = calculateCompoundInvestment(baseParams);
      const traditionalResult = calculateTraditionalInvestment(baseParams);
      
      const difference = compoundResult.totalToReceive - traditionalResult.totalToReceive;
      const expectedDifference = 88343.96 - 77720;
      
      expect(difference).toBeCloseTo(expectedDifference, 2);
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