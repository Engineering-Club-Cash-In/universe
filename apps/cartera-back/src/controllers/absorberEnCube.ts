import Big from "big.js";

export const CUBE_INVESTMENT_ID = 86;

// Deriva cuota + montos + IVAs para un row CUBE-puro (cash_in=100, part=0)
// a partir del monto_aportado final y la tasa del crédito. Idéntica a la
// fórmula que usaba exitInvestor (consistente con processAndReplaceCreditInvestors).
export function calcDerivadosCubePuro(montoAportado: Big, porcentajeInteres: string | number) {
  const cuota = montoAportado.times(porcentajeInteres).div(100).round(2);
  const montoInversionista = new Big(0);        // participacion = 0
  const montoCashIn = cuota;                     // cash_in = 100
  const ivaInversionista = new Big(0);
  const ivaCashIn = montoCashIn.gt(0) ? montoCashIn.times(0.12).round(2) : new Big(0);
  return {
    cuota_inversionista: cuota.toFixed(2),
    monto_inversionista: montoInversionista.toFixed(2),
    monto_cash_in: montoCashIn.toFixed(2),
    iva_inversionista: ivaInversionista.toFixed(2),
    iva_cash_in: ivaCashIn.toFixed(2),
  };
}
