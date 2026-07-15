import Big from "big.js";
import { calcularSplitInteresPci, type InvSplitInput } from "../cofidi/splitInteresPci";

// Inversionista CUBE (id 86). Se define local para no acoplar este módulo a
// absorberEnCube (que no vive en develop); es el mismo valor que CUBE_INVESTMENT_ID.
const CUBE_INVESTMENT_ID = 86;

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

const RUBROS = ["capital", "interes", "iva", "seguro", "gps", "membresia"] as const;

function nuevoAcc() {
  return {
    cuotas: 0,
    cobrado: { capital: new Big(0), interes: new Big(0), iva: new Big(0), seguro: new Big(0), gps: new Big(0), membresia: new Big(0) },
    restante: { capital: new Big(0), interes: new Big(0), iva: new Big(0), seguro: new Big(0), gps: new Big(0), membresia: new Big(0) },
    cubeEsp: new Big(0),
    cubeCob: new Big(0),
    mora: new Big(0),
    totalCob: new Big(0),
    totalEsp: new Big(0),
  };
}
type Acc = ReturnType<typeof nuevoAcc>;

function sumar(acc: Acc, r: CobranzaCreditoRow) {
  acc.cuotas += 1;
  for (const k of RUBROS) {
    acc.cobrado[k] = acc.cobrado[k].plus(r.cobrado[k]);
    acc.restante[k] = acc.restante[k].plus(r.restante[k]);
  }
  acc.cubeEsp = acc.cubeEsp.plus(r.cube.esperado);
  acc.cubeCob = acc.cubeCob.plus(r.cube.cobrado);
  acc.mora = acc.mora.plus(r.mora_cobrada);
  acc.totalCob = acc.totalCob.plus(r.total_cobrado);
  acc.totalEsp = acc.totalEsp.plus(r.total_esperado);
}

function materializar(asesor_id: number | null, asesor_nombre: string, acc: Acc): CobranzaAsesorRow {
  const money = (b: Big) => b.round(2).toFixed(2);
  const rubro = (o: Acc["cobrado"]): RubroMontos => ({
    capital: money(o.capital),
    interes: money(o.interes),
    iva: money(o.iva),
    seguro: money(o.seguro),
    gps: money(o.gps),
    membresia: money(o.membresia),
  });
  const programado = acc.totalCob.plus(acc.totalEsp);
  return {
    asesor_id,
    asesor_nombre,
    cuotas: acc.cuotas,
    cobrado: rubro(acc.cobrado),
    restante: rubro(acc.restante),
    cube: { esperado: money(acc.cubeEsp), cobrado: money(acc.cubeCob) },
    mora_cobrada: money(acc.mora),
    total_cobrado: money(acc.totalCob),
    total_esperado: money(acc.totalEsp),
    programado: money(programado),
    efectividad: efectividadPct(acc.totalCob, programado),
  };
}

/**
 * Agrupa las filas por crédito en filas por asesor (suma de cada rubro cobrado/restante,
 * CUBE, mora y totales) más un renglón `totalGeneral` con la suma de todos los asesores.
 */
export function agruparPorAsesor(rows: CobranzaCreditoRow[]): {
  asesores: CobranzaAsesorRow[];
  totalGeneral: CobranzaAsesorRow;
} {
  const porAsesor = new Map<number | null, { nombre: string; acc: Acc }>();
  const general = nuevoAcc();
  for (const r of rows) {
    const key = r.asesor_id;
    if (!porAsesor.has(key)) porAsesor.set(key, { nombre: r.asesor_nombre ?? "Sin asesor", acc: nuevoAcc() });
    sumar(porAsesor.get(key)!.acc, r);
    sumar(general, r);
  }
  const asesores = [...porAsesor.entries()]
    .map(([id, { nombre, acc }]) => materializar(id, nombre, acc))
    .sort((a, b) => Number(b.total_esperado) - Number(a.total_esperado));
  return { asesores, totalGeneral: materializar(null, "TOTAL", general) };
}
