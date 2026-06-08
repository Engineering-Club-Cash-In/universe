import Big from "big.js";

Big.DP = 20;
Big.RM = Big.roundHalfUp;

export type InversionistaParaProrrateo = {
  inversionista_id: number;
  nombre: string;
  porcentaje_participacion: string | number;
  porcentaje_cash_in: string | number;
  monto_aportado_espejo: string | number;
  status_espejo?: string | null;
};

export type ProrratearInput = {
  inversionistas: InversionistaParaProrrateo[];
  totalInteresesConIva: string | number;
  idComprador: number;
  montoComprado: string | number;
  fechaCorte: Date;
  banderaReinversion?: boolean;
};

export type ReparticionInversionista = {
  parteAntes: string;
  parteDespues: string;
  total: string;
};

export type ProrratearOutput = {
  porInversionista: Map<number, ReparticionInversionista>;
  cube: ReparticionInversionista;
  fraccionAntes: string;
  fraccionDespues: string;
  diaCorte: number;
  ultimoDiaMes: number;
};

export function prorratearIntereses(input: ProrratearInput): ProrratearOutput {
  const {
    inversionistas,
    totalInteresesConIva,
    idComprador,
    montoComprado,
    fechaCorte,
    banderaReinversion = false,
  } = input;

  const total = new Big(totalInteresesConIva);
  const montoCompra = new Big(montoComprado);

  const diaCorte = fechaCorte.getUTCDate();
  const ultimoDiaMes = new Date(
    Date.UTC(fechaCorte.getUTCFullYear(), fechaCorte.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const fraccionAntes = new Big(diaCorte).div(ultimoDiaMes);
  const fraccionDespues = new Big(1).minus(fraccionAntes);

  const invCube = inversionistas.find((i) =>
    i.nombre.trim().toUpperCase().includes("CUBE INVESTMENTS")
  );
  const cubeId = invCube?.inversionista_id ?? null;

  const baseAntes = (inv: InversionistaParaProrrateo): Big => {
    const m = new Big(inv.monto_aportado_espejo || 0);
    if (inv.inversionista_id === cubeId) return m.plus(montoCompra);
    if (inv.inversionista_id === idComprador) {
      const a = m.minus(montoCompra);
      return a.lt(0) ? new Big(0) : a;
    }
    return m;
  };

  const baseDespues = (inv: InversionistaParaProrrateo): Big =>
    new Big(inv.monto_aportado_espejo || 0);

  const calcularReparto = (
    getBase: (inv: InversionistaParaProrrateo) => Big,
    fraccion: Big
  ) => {
    const interesParcial = total.times(fraccion);
    const bases = inversionistas.map((inv) => ({ inv, base: getBase(inv) }));
    const sumaBases = bases.reduce((s, b) => s.plus(b.base), new Big(0));

    const parteInvPorId = new Map<number, Big>();
    let cashInAcum = new Big(0);
    let totalNoCube = new Big(0);

    for (const { inv, base } of bases) {
      if (inv.inversionista_id === cubeId) continue;

      const participacion = sumaBases.gt(0) ? base.div(sumaBases) : new Big(0);
      const interesProporcional = interesParcial.times(participacion);

      const redirigirACube =
        banderaReinversion &&
        (inv.status_espejo === "pendiente_reinversion" ||
          inv.status_espejo === "pendiente_compra_cartera");

      if (redirigirACube) continue;

      totalNoCube = totalNoCube.plus(interesProporcional);

      const pctInv = new Big(inv.porcentaje_participacion || 0).div(100);
      const pctCashIn = new Big(inv.porcentaje_cash_in || 0).div(100);
      const parteInv = interesProporcional.times(pctInv);
      const parteCashIn = interesProporcional.times(pctCashIn);

      cashInAcum = cashInAcum.plus(parteCashIn);
      parteInvPorId.set(
        inv.inversionista_id,
        (parteInvPorId.get(inv.inversionista_id) ?? new Big(0)).plus(parteInv)
      );
    }

    const cubePropio = interesParcial.minus(totalNoCube);
    const totalCubeParcial = cubePropio.plus(cashInAcum);
    return { parteInvPorId, totalCubeParcial };
  };

  const repartoAntes = calcularReparto(baseAntes, fraccionAntes);
  const repartoDespues = calcularReparto(baseDespues, fraccionDespues);

  const porInversionista = new Map<number, ReparticionInversionista>();
  const ids = new Set<number>([
    ...repartoAntes.parteInvPorId.keys(),
    ...repartoDespues.parteInvPorId.keys(),
  ]);

  for (const id of ids) {
    const a = repartoAntes.parteInvPorId.get(id) ?? new Big(0);
    const d = repartoDespues.parteInvPorId.get(id) ?? new Big(0);
    porInversionista.set(id, {
      parteAntes: a.toFixed(2),
      parteDespues: d.toFixed(2),
      total: a.plus(d).toFixed(2),
    });
  }

  return {
    porInversionista,
    cube: {
      parteAntes: repartoAntes.totalCubeParcial.toFixed(2),
      parteDespues: repartoDespues.totalCubeParcial.toFixed(2),
      total: repartoAntes.totalCubeParcial
        .plus(repartoDespues.totalCubeParcial)
        .toFixed(2),
    },
    fraccionAntes: fraccionAntes.toFixed(6),
    fraccionDespues: fraccionDespues.toFixed(6),
    diaCorte,
    ultimoDiaMes,
  };
}
