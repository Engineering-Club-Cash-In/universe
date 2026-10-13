import Big from "big.js";
import { z } from "zod";

// ================================================================
// Estado de cuenta para solicitud de cancelación — cálculo puro.
//
// Reproduce EXACTAMENTE la fórmula que hoy usa `ModalCancelCredit`:
//
//   capital + n × (interés + membresías + seguro + IVA + GPS)
//           + mora + traspaso + garantía mobiliaria + otros + montos adicionales
//
// pero con `Big` en vez de floats. No introduce rubros nuevos ni suma otros
// cargos por su cuenta. Los valores del crédito (capital, por cuota, mora) los
// relee el backend; del navegador solo se aceptan los campos manuales.
//
// Los montos manuales se usan TAL CUAL los escribe el operador (sin redondear).
// Solo el total final se lleva a centavos, porque es lo que guarda
// `numeric(18,2)` (aquí y en `credit_cancelations`); `Big.roundHalfUp` redondea
// igual que Postgres al castear a numeric (mitad lejos de cero).
// ================================================================

const montoManual = z
  .number({ invalid_type_error: "debe ser numérico" })
  .finite("debe ser un número finito");

/**
 * Body de `POST /credit/:creditId/cancelacion/estado-cuenta/preview`.
 * `.strict()`: capital, mora, interés, IVA, seguro, GPS, membresías o
 * monto_cancelacion del navegador NO son fuente de verdad, así que se rechazan.
 */
export const PreviewEstadoCuentaBodySchema = z
  .object({
    cuotasRestantes: z.number().int().min(0),
    traspaso: montoManual,
    garantiaMobiliaria: montoManual,
    otros: montoManual,
    montosAdicionales: z.array(
      z
        .object({
          concepto: z.string().trim().min(1, "concepto requerido"),
          monto: montoManual,
        })
        .strict()
    ),
    motivo: z.string().trim().min(1, "motivo requerido"),
    observaciones: z.string().optional(),
  })
  .strict();

export type PreviewEstadoCuentaBody = z.infer<typeof PreviewEstadoCuentaBodySchema>;

/** Valores del crédito tal como los devuelve la BD (numeric → string). */
export interface MontosCreditoCancelacion {
  capital: string | null;
  interes: string | null;
  iva: string | null;
  membresias: string | null;
  seguro: string | null;
  gps: string | null;
  /** Mora activa (`moras_credito.activa = true`); null si no hay. */
  mora: string | null;
}

/** Entrada manual normalizada (se guarda en `entrada_json`). Montos en texto, tal cual. */
export interface EntradaEstadoCuentaCancelacion {
  cuotasRestantes: number;
  traspaso: string;
  garantiaMobiliaria: string;
  otros: string;
  montosAdicionales: { concepto: string; monto: string }[];
  motivo: string;
  observaciones: string | null;
}

/** Foto del cálculo (se guarda en `desglose_json` y se devuelve al front). */
export interface DesgloseEstadoCuentaCancelacion {
  moneda: "GTQ";
  capital: string;
  cuotasRestantes: number;
  porCuota: {
    interes: string;
    iva: string;
    seguro: string;
    gps: string;
    membresias: string;
  };
  totalesCuotas: {
    interes: string;
    iva: string;
    seguro: string;
    gps: string;
    membresias: string;
    subtotal: string;
  };
  mora: string;
  traspaso: string;
  garantiaMobiliaria: string;
  otros: string;
  montosAdicionales: { concepto: string; monto: string }[];
  totalMontosAdicionales: string;
  montoCancelacion: string;
}

const big = (v: string | number | null | undefined) =>
  new Big(v === null || v === undefined || v === "" ? "0" : String(v));

/** Texto de un monto tal cual (sin redondear), con al menos 2 decimales. */
export const montoTalCual = (v: Big): string => {
  const s = v.toFixed();
  const [, dec = ""] = s.split(".");
  return dec.length >= 2 ? s : v.toFixed(2);
};

export function normalizarEntradaEstadoCuenta(
  body: PreviewEstadoCuentaBody
): EntradaEstadoCuentaCancelacion {
  const observaciones = body.observaciones?.trim();
  return {
    cuotasRestantes: body.cuotasRestantes,
    traspaso: montoTalCual(big(body.traspaso)),
    garantiaMobiliaria: montoTalCual(big(body.garantiaMobiliaria)),
    otros: montoTalCual(big(body.otros)),
    montosAdicionales: body.montosAdicionales.map((m) => ({
      concepto: m.concepto.trim(),
      monto: montoTalCual(big(m.monto)),
    })),
    motivo: body.motivo.trim(),
    observaciones: observaciones ? observaciones : null,
  };
}

export function calcularDesgloseCancelacion(
  credito: MontosCreditoCancelacion,
  entrada: EntradaEstadoCuentaCancelacion
): DesgloseEstadoCuentaCancelacion {
  const n = entrada.cuotasRestantes;

  const capital = big(credito.capital);
  const mora = big(credito.mora);
  const unit = {
    interes: big(credito.interes),
    iva: big(credito.iva),
    seguro: big(credito.seguro),
    gps: big(credito.gps),
    membresias: big(credito.membresias),
  };
  const tot = {
    interes: unit.interes.times(n),
    iva: unit.iva.times(n),
    seguro: unit.seguro.times(n),
    gps: unit.gps.times(n),
    membresias: unit.membresias.times(n),
  };
  const subtotalCuotas = tot.interes
    .plus(tot.iva)
    .plus(tot.seguro)
    .plus(tot.gps)
    .plus(tot.membresias);

  const traspaso = big(entrada.traspaso);
  const garantia = big(entrada.garantiaMobiliaria);
  const otros = big(entrada.otros);
  const totalMontosAdicionales = entrada.montosAdicionales.reduce(
    (acc, m) => acc.plus(big(m.monto)),
    new Big(0)
  );

  const total = capital
    .plus(subtotalCuotas)
    .plus(mora)
    .plus(totalMontosAdicionales)
    .plus(traspaso)
    .plus(garantia)
    .plus(otros);

  return {
    moneda: "GTQ",
    capital: montoTalCual(capital),
    cuotasRestantes: n,
    porCuota: {
      interes: montoTalCual(unit.interes),
      iva: montoTalCual(unit.iva),
      seguro: montoTalCual(unit.seguro),
      gps: montoTalCual(unit.gps),
      membresias: montoTalCual(unit.membresias),
    },
    totalesCuotas: {
      interes: montoTalCual(tot.interes),
      iva: montoTalCual(tot.iva),
      seguro: montoTalCual(tot.seguro),
      gps: montoTalCual(tot.gps),
      membresias: montoTalCual(tot.membresias),
      subtotal: montoTalCual(subtotalCuotas),
    },
    mora: montoTalCual(mora),
    traspaso: montoTalCual(traspaso),
    garantiaMobiliaria: montoTalCual(garantia),
    otros: montoTalCual(otros),
    montosAdicionales: entrada.montosAdicionales.map((m) => ({
      concepto: m.concepto,
      monto: montoTalCual(big(m.monto)),
    })),
    totalMontosAdicionales: montoTalCual(totalMontosAdicionales),
    montoCancelacion: total.round(2, Big.roundHalfUp).toFixed(2),
  };
}

/** Día de Guatemala (YYYY-MM-DD) de un instante. */
export const fechaCorteGuatemala = (instante: Date): string =>
  instante.toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
