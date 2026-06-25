import Big from "big.js";

Big.DP = 20;
Big.RM = Big.roundHalfUp;

// 🆕 PRORRATEO DE INTERÉS POR COMPRA DE CARTERA (para insertPagosCreditoInversionistasV2)
// ----------------------------------------------------------------------------------------
// Calcula, por inversionista, el FACTOR (fracción del interés total del pago) que le toca
// cuando el crédito tiene una compra de cartera pendiente. Replica el mismo cálculo de
// ventanas antes/después de la facturación (ver ./prorratearIntereses.ts):
//   • fracciónAntes  = díaCorte / díasDelMes      (cómo estaba el crédito ANTES de la compra)
//   • fracciónDespués = 1 − fracciónAntes          (cómo está AHORA)
// y en cada ventana reparte por base (monto_aportado del espejo) × el % propio de cada uno
// (participación para los no-CUBE, cash_in propio para CUBE).
//
// Diferencia CLAVE vs la facturación: acá NO se redirige el cash_in de los no-CUBE a CUBE
// (no hay residuo). Cada quien recibe SOLO lo suyo. El factor se aplica igual a
// abono_interes y a abono_iva_12 (el reparto es lineal).
//
// ⚠️ TODO (cash_in residuo — DIFERIDO a futuro): como NO redirigimos el cash_in de los
//    no-CUBE a CUBE, la suma de factores es < 1 (queda un hueco = Σ cash_in de los no-CUBE).
//    Cuando se quiera que CUBE absorba ese residuo (y pci quede idéntico a la factura),
//    sumarle a CUBE: residuoCube = 1 − Σ(factores) y agregarlo a su factor antes de retornar.
export type InvProrrateoV2 = {
  inversionista_id: number;
  nombre: string;
  porcentaje_participacion: string | number;
  porcentaje_cash_in: string | number;
  monto_aportado_espejo: string | number;
  status_espejo?: string | null;
};

export function calcularFactoresProrrateoInteresV2(input: {
  inversionistas: InvProrrateoV2[];
  idComprador: number;
  montoComprado: string | number;
  fechaCorte: Date;
  banderaReinversion?: boolean;
}): Map<number, Big> {
  const {
    inversionistas: invs,
    idComprador,
    montoComprado,
    fechaCorte,
    banderaReinversion = false,
  } = input;
  const montoCompra = new Big(montoComprado);

  // UTC: la columna fecha_inicio_participacion es `date` (sin hora); usar UTC evita
  // que en TZ negativa (GT, UTC-6) "2026-06-01" se corra al día/mes anterior.
  const diaCorte = fechaCorte.getUTCDate();
  const ultimoDiaMes = new Date(
    Date.UTC(fechaCorte.getUTCFullYear(), fechaCorte.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const fraccionAntes = new Big(diaCorte).div(ultimoDiaMes);
  const fraccionDespues = new Big(1).minus(fraccionAntes);

  const cubeId =
    invs.find((i) => i.nombre.trim().toUpperCase().includes("CUBE INVESTMENTS"))
      ?.inversionista_id ?? null;

  // Base ANTES (reconstruida): CUBE recupera lo vendido, el comprador queda en su monto
  // previo (clamp a 0 si era nuevo), el resto igual. Base DESPUÉS = foto actual del espejo.
  const baseAntes = (inv: InvProrrateoV2): Big => {
    const m = new Big(inv.monto_aportado_espejo || 0);
    if (inv.inversionista_id === cubeId) return m.plus(montoCompra);
    if (inv.inversionista_id === idComprador) {
      const a = m.minus(montoCompra);
      return a.lt(0) ? new Big(0) : a;
    }
    return m;
  };
  const baseDespues = (inv: InvProrrateoV2): Big =>
    new Big(inv.monto_aportado_espejo || 0);

  const factor = new Map<number, Big>();
  for (const inv of invs) factor.set(inv.inversionista_id, new Big(0));

  const acumularVentana = (
    getBase: (i: InvProrrateoV2) => Big,
    fraccion: Big
  ) => {
    const bases = invs.map((inv) => ({ inv, base: getBase(inv) }));
    const sumaBases = bases.reduce((s, b) => s.plus(b.base), new Big(0));
    for (const { inv, base } of bases) {
      // Redirección a CUBE por reinversión: hoy se DIFIERE (no se le asigna a nadie);
      // entra en el mismo hueco/TODO del residuo de arriba.
      const redirigirACube =
        banderaReinversion &&
        (inv.status_espejo === "pendiente_reinversion" ||
          inv.status_espejo === "pendiente_compra_cartera");
      if (redirigirACube) continue;

      const participacion = sumaBases.gt(0) ? base.div(sumaBases) : new Big(0);
      const esCube = inv.inversionista_id === cubeId;
      // % propio: CUBE cobra por su cash_in; los demás por su participación.
      const pctPropio = esCube
        ? new Big(inv.porcentaje_cash_in || 0).div(100)
        : new Big(inv.porcentaje_participacion || 0).div(100);
      const aporte = fraccion.times(participacion).times(pctPropio);
      factor.set(
        inv.inversionista_id,
        (factor.get(inv.inversionista_id) ?? new Big(0)).plus(aporte)
      );
    }
  };
  acumularVentana(baseAntes, fraccionAntes);
  acumularVentana(baseDespues, fraccionDespues);
  return factor;
}
