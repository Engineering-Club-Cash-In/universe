import Big from "big.js";
import {
  esInversionistaCube,
  getInversionistaFacturadorConfig,
} from "../utils/functions/const";

Big.DP = 20;
Big.RM = Big.roundHalfUp;

// ============================================================
// ¿Qué le falta facturar a un pago?
//
// Problema que resuelve:
//   /facturar-pago-completo emite hasta 5 tipos de DTE por pago (MORA,
//   OTROS_SERVICIOS, OTROS, INTERESES por inversionista, INTERESES_CUBE) y cada
//   bloque tiene su propio try/catch: si uno falla, los demás siguen. Una corrida
//   podía quedar A MEDIAS (p. ej. INTERESES certificó y MORA no) y el guard viejo
//   —todo-o-nada: "¿hay alguna factura ACTIVA? → 400"— dejaba el pago trabado sin
//   forma de emitir solo lo que faltó, salvo anular todo a mano.
//
//   Acá se calcula el DIFF entre lo ESPERADO (los DTEs que este pago debería
//   tener, con las MISMAS condiciones que usan los bloques de emisión) y lo
//   LOGRADO (las facturas ACTIVAS ya etiquetadas con su rubro), para poder
//   re-correr emitiendo únicamente lo faltante.
//
// Por qué es una función pura y separada:
//   El costo de equivocarse es sobre-facturar al cliente en SAT. Se testea sola.
// ============================================================

/** Rubros que /facturar-pago-completo etiqueta en `facturas_electronicas.rubro`. */
export const RUBROS_FACTURA = [
  "MORA",
  "OTROS_SERVICIOS",
  "OTROS",
  "INTERESES",
  "INTERESES_CUBE",
] as const;

export type RubroFactura = (typeof RUBROS_FACTURA)[number];

/**
 * Clave de un DTE dentro de un pago.
 *   - "MORA" | "OTROS_SERVICIOS" | "OTROS" | "INTERESES_CUBE": uno por pago.
 *   - "INTERESES:<inversionista_id>": uno por inversionista no-CUBE facturable.
 */
export type KeyFactura = string;

export function keyIntereses(inversionista_id: number): KeyFactura {
  return `INTERESES:${inversionista_id}`;
}

export type PagoParaDiff = {
  mora?: string | number | null;
  abono_seguro?: string | number | null;
  abono_gps?: string | number | null;
  membresias_pago?: string | number | null;
  otros?: string | number | null;
  abono_interes?: string | number | null;
  abono_iva_12?: string | number | null;
  bandera_reinversion?: boolean | null;
};

export type InversionistaParaDiff = {
  inversionista_id: number;
  nombre: string;
  emite_factura?: boolean | null;
  status_espejo?: string | null;
  porcentaje_participacion?: string | number | null;
  porcentaje_cash_in?: string | number | null;
  /** Ya calculado por el handler: (abono_interes + IVA) × participación_real. */
  interes_proporcional?: string | number | null;
};

export type FacturaActiva = {
  factura_id?: number;
  rubro?: string | null;
  inversionista_id?: number | null;
  /**
   * GranTotal del DTE (facturas_electronicas.monto_total). Si viene, el diff
   * exige que cuadre AL CENTAVO con el monto que el cálculo de HOY le asigna a
   * su rubro — es la defensa contra re-facturar sobre un pago que cambió.
   */
  monto_total?: string | number | null;
};

export type DiffFacturas =
  | { modo: "COMPLETO" }
  | { modo: "BLOQUEADO"; razon: string }
  | { modo: "FALTANTES"; faltantes: Set<KeyFactura> };

const esCubeInv = esInversionistaCube;

/**
 * Lee un monto del pago con la MISMA tolerancia que los bloques de emisión.
 *
 * ⚠️ No basta `new Big(v ?? "0")`. Varias columnas de `pagos_credito` son `text`
 * (mora, otros, abono_seguro, ...) y la mayoría de las filas traen CADENA VACÍA,
 * no NULL: en el dump de prod 108,267 de 120,764 pagos tienen `otros = ''`.
 * `??` no sustituye `''`, así que `new Big("")` lanza "[big.js] Invalid number"
 * y el try/catch del handler lo convertía en un HTTP 500 (pago 54778).
 *
 * Los bloques de emisión leen estos campos con `parseFloat(x) > 0`, que da NaN
 * (falsy) para `''` y basura, y tolera colas no numéricas ("12abc" → 12). Acá se
 * replica ese criterio: si el bloque no emitiría, el esperado tampoco lo pide.
 */
export const big = (v: string | number | null | undefined): Big => {
  if (v === null || v === undefined) return new Big(0);
  if (typeof v === "number") return Number.isFinite(v) ? new Big(v) : new Big(0);

  const s = String(v).trim();
  if (s === "") return new Big(0);

  try {
    return new Big(s);
  } catch {
    const n = parseFloat(s);
    return Number.isFinite(n) ? new Big(n) : new Big(0);
  }
};

/**
 * Lo que ESTE pago debería tener facturado, replicando las condiciones de los
 * bloques 4️⃣/5️⃣/5.5️⃣/6️⃣ de /facturar-pago-completo (flujo ESTÁNDAR de intereses).
 *
 * ⚠️ El orden de las acumulaciones importa y está copiado del loop real:
 *   totalInteresesNoCube suma ANTES del check `interesProporcional <= 0`, y
 *   cashInAcumulado suma ANTES del check de "emite su propia factura". Los dos
 *   alimentan el residuo de CUBE, así que un inversionista que NO recibe DTE
 *   igual mueve el monto de CUBE.
 */
export function calcularEsperado(args: {
  pagoData: PagoParaDiff;
  inversionistas: InversionistaParaDiff[];
}): Set<KeyFactura> {
  return new Set(calcularEsperadoDetallado(args).keys());
}

/**
 * Igual que `calcularEsperado` pero con el MONTO (GranTotal, con IVA) que
 * llevaría cada DTE, replicando el redondeo de los bloques de emisión: cada
 * bloque certifica `calcularIvaExacto(parseFloat(x.toFixed(2)))`, cuyo total es
 * el propio monto a 2 decimales. Para OTROS_SERVICIOS el GranTotal es la suma
 * de los 3 ítems redondeados por separado (seguro, gps, membresía).
 */
export function calcularEsperadoDetallado(args: {
  pagoData: PagoParaDiff;
  inversionistas: InversionistaParaDiff[];
}): Map<KeyFactura, Big> {
  const { pagoData, inversionistas } = args;
  const esperado = new Map<KeyFactura, Big>();

  // ⚠️ Los gates comparan el valor SIN redondear, igual que los `parseFloat(x) > 0`
  //    de los bloques de emisión: un monto sub-centavo (mora="0.003") SÍ produce
  //    un DTE real (de Q0.00), así que el esperado debe contemplarlo — si no, la
  //    regla (b) bloquearía para siempre un pago que nada cambió, o faltantes
  //    quedaría vacío y el rubro no se emitiría jamás. El round(2) es solo para
  //    el MONTO esperado (el GranTotal que certifica el bloque).
  const mora = big(pagoData.mora);
  if (mora.gt(0)) esperado.set("MORA", mora.round(2));

  const seguro = big(pagoData.abono_seguro);
  const gps = big(pagoData.abono_gps);
  const membresia = big(pagoData.membresias_pago);
  if (seguro.gt(0) || gps.gt(0) || membresia.gt(0)) {
    esperado.set(
      "OTROS_SERVICIOS",
      seguro.round(2).plus(gps.round(2)).plus(membresia.round(2))
    );
  }

  const otros = big(pagoData.otros);
  if (otros.gt(0)) esperado.set("OTROS", otros.round(2));

  // 🚪 Mismo guard que el handler: sin interés NI IVA no se entra a ningún flujo
  //    de intereses. IVA cuenta porque el motor cobra interés antes que IVA: un
  //    pago puede traer solo abono_iva_12 y ese IVA viaja en el DTE de intereses.
  const totalConIva = big(pagoData.abono_interes).plus(big(pagoData.abono_iva_12));
  if (!totalConIva.gt(0)) return esperado;

  let totalInteresesNoCube = new Big(0);
  let cashInAcumulado = new Big(0);

  for (const inv of inversionistas) {
    if (esCubeInv(inv.nombre)) continue;

    const redirigirACube =
      pagoData.bandera_reinversion === true &&
      (inv.status_espejo === "pendiente_reinversion" ||
        inv.status_espejo === "pendiente_compra_cartera");
    if (redirigirACube) continue;

    const interesProporcional = big(inv.interes_proporcional);
    totalInteresesNoCube = totalInteresesNoCube.plus(interesProporcional);
    if (interesProporcional.lte(0)) continue;

    const pctInversion = big(inv.porcentaje_participacion).div(100);
    const pctCashIn = big(inv.porcentaje_cash_in).div(100);
    const parteInversionista = interesProporcional.times(pctInversion).round(2);
    cashInAcumulado = cashInAcumulado.plus(interesProporcional.times(pctCashIn).round(2));

    // Emite su propia factura y no tenemos config para emitírsela → no hay DTE.
    if (inv.emite_factura && !getInversionistaFacturadorConfig(inv.nombre)) continue;
    if (parteInversionista.lte(0)) continue;

    esperado.set(keyIntereses(inv.inversionista_id), parteInversionista);
  }

  // CUBE por RESIDUO (+ el cash_in de los demás). Solo hay DTE si es > 0.
  const totalCube = totalConIva.minus(totalInteresesNoCube).plus(cashInAcumulado);
  if (totalCube.gt(0)) esperado.set("INTERESES_CUBE", totalCube.round(2));

  return esperado;
}

/**
 * Decide cómo re-facturar un pago que ya tiene facturas ACTIVAS.
 *
 *   COMPLETO  → no hay ACTIVAS: emitir todo, comportamiento idéntico al de siempre.
 *   BLOQUEADO → no se puede decidir con seguridad qué falta: 400 (como hoy).
 *   FALTANTES → emitir SOLO las keys de `faltantes`. Si el set queda vacío el pago
 *               ya está completamente facturado (el handler responde 400).
 */
export function computarDiffFacturas(args: {
  pagoData: PagoParaDiff;
  inversionistas: InversionistaParaDiff[];
  activas: FacturaActiva[];
  /** Flujo PRORRATEADO de intereses activo (compra de cartera pendiente_facturar). */
  tieneOperacionesPendientesFacturar?: boolean;
}): DiffFacturas {
  const { pagoData, inversionistas, activas, tieneOperacionesPendientesFacturar } = args;

  if (activas.length === 0) return { modo: "COMPLETO" };

  // (c) El flujo prorrateado reparte el interés por VENTANAS de fecha de corte; su
  //     esperado NO se modela acá. Con facturas activas se mantiene el 400 de hoy.
  //     PERO solo aplica si el pago TRAE interés: el handler corta con
  //     `if (!hayInteresEnPago)` ANTES del branch prorrateado (cofidi.ts ~1053),
  //     así que un pago solo-mora en un crédito con compra pendiente jamás toca
  //     el prorrateo y su re-facturación parcial es segura.
  if (
    tieneOperacionesPendientesFacturar &&
    big(pagoData.abono_interes).plus(big(pagoData.abono_iva_12)).gt(0)
  ) {
    return {
      modo: "BLOQUEADO",
      razon:
        "El crédito tiene una compra de cartera pendiente de facturar (interés prorrateado por fecha de corte). " +
        "Ese reparto no se puede diferenciar factura por factura: anule las facturas activas y vuelva a facturar el pago completo.",
    };
  }

  // (a) Facturas históricas sin etiquetar: no sabemos qué cubren → 400 conservador.
  const sinRubro = activas.filter((f) => !f.rubro);
  if (sinRubro.length > 0) {
    return {
      modo: "BLOQUEADO",
      razon:
        `${sinRubro.length} factura(s) activa(s) de este pago no tienen rubro registrado ` +
        `(se emitieron antes de que se etiquetaran, o vienen de /facturar-generico). ` +
        `No se puede saber qué rubro cubren: anule las facturas activas y vuelva a facturar el pago completo.`,
    };
  }

  // Key canónica de una ACTIVA ya validada. ÚNICA derivación: la usan el set
  // `logrado` y el check de montos (d) — si divergieran, uno compararía contra
  // la entrada equivocada del esperado.
  const keyDeActiva = (f: FacturaActiva): KeyFactura =>
    f.rubro === "INTERESES"
      ? keyIntereses(f.inversionista_id as number)
      : (f.rubro as KeyFactura);

  const logrado = new Set<KeyFactura>();
  for (const f of activas) {
    const rubro = f.rubro as RubroFactura;
    if (!(RUBROS_FACTURA as readonly string[]).includes(rubro)) {
      return {
        modo: "BLOQUEADO",
        razon: `Factura activa con rubro desconocido "${f.rubro}"${
          f.factura_id ? ` (factura_id ${f.factura_id})` : ""
        }. Anule las facturas activas y vuelva a facturar el pago completo.`,
      };
    }
    if (rubro === "INTERESES" && f.inversionista_id == null) {
      return {
        modo: "BLOQUEADO",
        razon:
          `Factura activa de INTERESES sin inversionista_id${
            f.factura_id ? ` (factura_id ${f.factura_id})` : ""
          }: no se sabe a qué inversionista corresponde. ` +
          `Anule las facturas activas y vuelva a facturar el pago completo.`,
      };
    }
    const key = keyDeActiva(f);
    // (e) Dos ACTIVAS con la MISMA key = el cliente ya tiene DTEs duplicados de
    //     ese rubro (doble-POST histórico, réplicas concurrentes, backfill).
    //     Colapsarlas en el Set las haría pasar por "cubierto" y hasta
    //     reconciliaría el pago a OK escondiendo el doble cobro → BLOQUEADO.
    if (logrado.has(key)) {
      return {
        modo: "BLOQUEADO",
        razon:
          `Hay más de una factura activa para ${key}${
            f.factura_id ? ` (la más reciente: factura_id ${f.factura_id})` : ""
          }: el pago tiene DTEs duplicados de ese rubro. ` +
          `Anule el duplicado antes de re-facturar.`,
      };
    }
    logrado.add(key);
  }

  const esperadoDetallado = calcularEsperadoDetallado({ pagoData, inversionistas });
  const esperado = new Set(esperadoDetallado.keys());

  // (b) logrado ⊄ esperado: hay un DTE vivo que el cálculo de HOY ya no produce
  //     (p. ej. cambió el roster de inversionistas desde la corrida original).
  //     Re-facturar parcial sobre un reparto distinto sobre/sub-factura → 400.
  const sobrantes = [...logrado].filter((k) => !esperado.has(k));
  if (sobrantes.length > 0) {
    return {
      modo: "BLOQUEADO",
      razon:
        `Hay factura(s) activa(s) que ya no corresponden al reparto actual del pago (${sobrantes.join(", ")}). ` +
        `El crédito cambió desde que se facturó (roster de inversionistas o montos del pago): ` +
        `emitir solo lo faltante sobre/sub-facturaría. Anule las facturas activas y vuelva a facturar el pago completo.`,
    };
  }

  // (d) Los DTEs vivos tienen que cuadrar AL CENTAVO con el cálculo de HOY.
  //     La regla (b) es ciega a los montos: si el roster CRECIÓ (entró un
  //     inversionista), lo logrado sigue siendo subconjunto de lo esperado, pero
  //     el DTE de CUBE vivo se emitió con el reparto viejo — su monto ya incluye
  //     el interés que hoy le tocaría al inversionista nuevo. Emitirle su DTE
  //     "faltante" cobraría ese interés DOS VECES ante SAT. Lo mismo si un monto
  //     del pago cambió después de facturar (sync Excel, recálculos, reversas).
  //     Un DTE cuyo monto ya no reproduce el cálculo actual = el pago cambió →
  //     no hay re-facturación parcial segura.
  for (const f of activas) {
    if (f.monto_total == null) continue; // sin monto no hay contra qué comparar
    const key = keyDeActiva(f); // validada arriba: INTERESES ya trae inversionista_id
    const montoEsperado = esperadoDetallado.get(key);
    if (montoEsperado && !big(f.monto_total).round(2).eq(montoEsperado)) {
      return {
        modo: "BLOQUEADO",
        razon:
          `La factura activa de ${key}${f.factura_id ? ` (factura_id ${f.factura_id})` : ""} ` +
          `tiene monto Q${big(f.monto_total).toFixed(2)} pero el cálculo actual del pago le asigna ` +
          `Q${montoEsperado.toFixed(2)}. El pago o el reparto cambió desde que se facturó: ` +
          `emitir solo lo faltante sobre/sub-facturaría. Anule las facturas activas y vuelva a facturar el pago completo.`,
      };
    }
  }

  const faltantes = new Set<KeyFactura>([...esperado].filter((k) => !logrado.has(k)));

  return { modo: "FALTANTES", faltantes };
}
