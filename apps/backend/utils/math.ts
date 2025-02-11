export function PV(
  rate: number,
  nper: number,
  pmt: number,
  fv: number = 0,
  type: 0 | 1 = 0
): number {
  // Validate inputs
  if (rate === -1) throw new Error("Rate cannot be -100%");
  if (nper <= 0) throw new Error("Number of periods must be positive");

  // If rate is 0, use simple calculation
  if (rate === 0) {
    return -pmt * nper - fv;
  }

  // Calculate present value
  const pvif = Math.pow(1 + rate, -nper); // Discount factor
  let pv: number;

  if (type === 1) {
    // Payment at beginning of period
    pv = (-pmt * (1 + rate) * (1 - pvif)) / rate - fv * pvif;
  } else {
    // Payment at end of period
    pv = (-pmt * (1 - pvif)) / rate - fv * pvif;
  }

  return pv;
}

/**
 * Calculates the payment for a loan based on constant payments and a constant interest rate
 * @param rate - Interest rate per period (annual rate / 12 for monthly payments)
 * @param nper - Total number of payments
 * @param pv - Present value (loan amount)
 * @param fv - Future value (default is 0)
 * @param type - When payments are due: 0 = end of period (default), 1 = beginning of period
 * @returns The payment amount (negative if paying out)
 */
export function PMT(
  rate: number,
  nper: number,
  pv: number,
  fv: number = 0,
  type: 0 | 1 = 0
): number {
  // Validate inputs
  if (rate === -1) throw new Error("Rate cannot be -100%");
  if (nper <= 0) throw new Error("Number of periods must be positive");

  // If rate is 0, use simple calculation
  if (rate === 0) {
    return -(pv + fv) / nper;
  }

  // Calculate payment
  const pvif = Math.pow(1 + rate, -nper); // Discount factor
  let pmt: number;

  if (type === 1) {
    // Payment at beginning of period
    pmt =
      (-rate * pv) / ((1 + rate) * (1 - pvif)) -
      (fv * rate) / ((1 + rate) * (pvif - 1));
  } else {
    // Payment at end of period
    pmt = (-rate * pv) / (1 - pvif) - (fv * rate) / (pvif - 1);
  }

  return pmt;
}
