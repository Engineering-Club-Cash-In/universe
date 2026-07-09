import Big from "big.js";
import { calcularSplitInteresPci, type InvSplitInput } from "../cofidi/splitInteresPci";
import { CUBE_INVESTMENT_ID } from "./absorberEnCube";

Big.DP = 20;
Big.RM = Big.roundHalfUp;

export type RubroMontos = {
  capital: string;
  interes: string;
  iva: string;
  seguro: string;
  gps: string;
  membresia: string;
};

export type CobranzaCreditoRow = {
  credito_id: number;
  numero_credito_sifco: string;
  cliente_nombre: string;
  asesor_id: number | null;
  asesor_nombre: string | null;
  cobrado: RubroMontos;
  restante: RubroMontos;
  cube: { esperado: string; cobrado: string };
  mora_cobrada: string;
  total_cobrado: string;
  total_esperado: string;
};

export type CobranzaAsesorRow = {
  asesor_id: number | null;
  asesor_nombre: string;
  cuotas: number;
  cobrado: RubroMontos;
  restante: RubroMontos;
  cube: { esperado: string; cobrado: string };
  mora_cobrada: string;
  total_cobrado: string;
  total_esperado: string;
  programado: string;
  efectividad: number;
};

/**
 * Interés de CUBE como RESIDUO (igual que COFIDI): total menos la parte que se
 * quedan los inversionistas REALES (no-CUBE). Reusa calcularSplitInteresPci para
 * la distribución por inversionista y suma los que NO son id 86.
 */
export function interesCubeResidual(totalInteres: Big, inversionistas: InvSplitInput[]): Big {
  if (inversionistas.length === 0 || totalInteres.lte(0)) return new Big(0);
  const split = calcularSplitInteresPci({
    inversionistas,
    pagoAbonoInteres: totalInteres,
    pagoAbonoIva: new Big(0),
  });
  const sumaNoCube = split
    .filter((r) => r.inversionista_id !== CUBE_INVESTMENT_ID)
    .reduce((acc, r) => acc.plus(r.abono_interes), new Big(0));
  const cube = totalInteres.minus(sumaNoCube);
  return cube.lt(0) ? new Big(0) : cube;
}

export function efectividadPct(cobrado: Big, programado: Big): number {
  if (programado.lte(0)) return 0;
  return Number(cobrado.div(programado).round(4).toString());
}
