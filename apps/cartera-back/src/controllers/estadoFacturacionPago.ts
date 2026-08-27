/**
 * Estado de la facturación de un pago (migración 0014).
 *
 * Decisión de Daniel 2026-08-27: cartera NO refactura sola lo que falta —
 * ausencia en la DB no prueba ausencia en SAT, y reintentar a ciegas duplica
 * DTE. Lo que sí se hace es dejar VISIBLE qué pago quedó sin facturar o a
 * medias, y qué rubro/inversionista falló, para que conta lo resuelva.
 *
 * Vive fuera de `routers/cofidi.ts` (2.000 líneas) a propósito: es la única
 * pieza que decide el estado, y la usan la facturación, la validación del
 * pago y la reversión.
 */
import { eq } from "drizzle-orm";
import { db } from "../database";
import { pagos_credito } from "../database/db";
import type { FacturaRubro, PagoFacturaStatus } from "../database/db/schema";

/** Lo que cada rubro dejó como resultado, tal como lo arma el handler. */
export type FacturaGeneradaResumen = {
  tipo: string;
  // El handler arma objetos heterogéneos por rubro (unos traen inversionista,
  // otros no); acá solo se leen estos campos, el resto viaja y se ignora.
  concepto?: unknown;
  error?: unknown;
  inversionista?: unknown;
  inversionista_id?: unknown;
  [extra: string]: unknown;
};

export type RubroFallido = {
  rubro: string;
  inversionista?: string | null;
  inversionista_id?: number | null;
  error: string;
};

/**
 * Deriva el estado a partir de lo emitido y lo que falló.
 * Sin nada emitido ni fallado = no había DTE que emitir (solo capital).
 */
export function derivarEstadoFacturacion(
  facturasGeneradas: FacturaGeneradaResumen[],
): { estado: PagoFacturaStatus; fallidos: RubroFallido[] } {
  const fallidos: RubroFallido[] = facturasGeneradas
    .filter((f) => f.tipo === "ERROR")
    .map((f) => ({
      rubro: typeof f.concepto === "string" ? f.concepto : "DESCONOCIDO",
      inversionista: typeof f.inversionista === "string" ? f.inversionista : null,
      inversionista_id:
        typeof f.inversionista_id === "number" ? f.inversionista_id : null,
      error: typeof f.error === "string" ? f.error : "sin detalle",
    }));
  const emitidas = facturasGeneradas.filter((f) => f.tipo !== "ERROR").length;

  if (fallidos.length === 0) {
    return { estado: emitidas > 0 ? "OK" : "NO_APLICA", fallidos };
  }
  return { estado: emitidas > 0 ? "PARCIAL" : "FALLIDA", fallidos };
}

/** Escribe el estado de facturación del pago. Nunca lanza: es informativo. */
export async function registrarEstadoFacturacion(
  pagoId: number | null | undefined,
  entrada:
    | { facturasGeneradas: FacturaGeneradaResumen[] }
    | { estado: PagoFacturaStatus; motivo?: string },
): Promise<void> {
  if (!pagoId) return;
  try {
    const resultado =
      "facturasGeneradas" in entrada
        ? derivarEstadoFacturacion(entrada.facturasGeneradas)
        : {
            estado: entrada.estado,
            fallidos: entrada.motivo
              ? [{ rubro: "FACTURACION", error: entrada.motivo }]
              : [],
          };
    await db
      .update(pagos_credito)
      .set({
        factura_status: resultado.estado,
        factura_error: resultado.fallidos.length
          ? JSON.stringify(resultado.fallidos)
          : null,
        factura_at: new Date(),
      })
      .where(eq(pagos_credito.pago_id, pagoId));
  } catch (error) {
    console.error(
      `⚠️ No se pudo registrar el estado de facturación del pago ${pagoId} (NO afecta la facturación):`,
      error instanceof Error ? error.message : error,
    );
  }
}

/** Campos del pago que deciden si hay algo que facturar. */
export type MontosFacturablesPago = {
  abono_interes?: string | number | null;
  abono_interes_ci?: string | number | null;
  abono_iva_ci?: string | number | null;
  abono_seguro?: string | number | null;
  abono_gps?: string | number | null;
  membresias_pago?: string | number | null;
  mora?: string | number | null;
  otros?: string | number | null;
};

const positivo = (valor: string | number | null | undefined) =>
  Number(valor ?? 0) > 0;

/**
 * ¿Este pago genera DTE? Capital no se factura (D-48): un pago que solo abona
 * capital nace `NO_APLICA` y nunca aparece como "falta factura".
 */
export function tieneMontosFacturables(pago: MontosFacturablesPago): boolean {
  return [
    pago.abono_interes,
    pago.abono_interes_ci,
    pago.abono_iva_ci,
    pago.abono_seguro,
    pago.abono_gps,
    pago.membresias_pago,
    pago.mora,
    pago.otros,
  ].some(positivo);
}

/**
 * Al validar: el pago queda a la espera de su factura (o `NO_APLICA` si no
 * hay nada facturable). Corre dentro de la tx de validación.
 */
export async function marcarFacturacionPendiente(
  tx: { update: typeof db.update },
  pagoId: number,
  pago: MontosFacturablesPago,
): Promise<void> {
  await tx
    .update(pagos_credito)
    .set({
      factura_status: tieneMontosFacturables(pago) ? "PENDIENTE" : "NO_APLICA",
      factura_error: null,
      factura_at: null,
    })
    .where(eq(pagos_credito.pago_id, pagoId));
}
