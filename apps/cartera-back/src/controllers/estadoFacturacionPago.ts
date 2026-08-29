/**
 * Estado de la facturación de un pago (migración 0014 en COBROS-02 / 0031 en
 * develop — unificadas).
 *
 * Decisión de Daniel 2026-08-27: cartera NO refactura A CIEGAS lo que falta —
 * ausencia en la DB no prueba ausencia en SAT, y reintentar sin más duplica
 * DTE. Este módulo deja VISIBLE qué pago quedó sin facturar o a medias, y qué
 * rubro/inversionista falló, para que conta lo resuelva.
 *
 * El complemento (unificación con la re-facturación parcial): un re-run de
 * /facturar-pago-completo NO es a ciegas — emite solo los rubros faltantes y
 * únicamente cuando el diff de src/cofidi/facturasFaltantes.ts puede probar con
 * los DTEs vivos etiquetados + montos al centavo que es seguro; ante cualquier
 * duda responde 400 y el pago sigue en esta bandeja para resolución manual.
 *
 * Vive fuera de `routers/cofidi.ts` a propósito: es la única pieza que decide
 * el estado, y la usan la facturación, la validación del pago y la reversión.
 */
import { eq, sql } from "drizzle-orm";
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
 * Fallos que NO son de certificación: el DTE sí salió, lo que falló fue una
 * escritura nuestra (p. ej. marcar `pendiente_facturar=false`). No pueden
 * volver el pago PARCIAL ni aparecer como "falta emitir": mandarían a conta a
 * buscar en SAT una factura que ya existe (hallazgo Codex). Se corrigen en BD.
 */
const CONCEPTOS_NO_CERTIFICACION = new Set(["MARCAR_PENDIENTE_FACTURAR"]);

/**
 * Deriva el estado a partir de lo emitido y lo que falló.
 * Sin nada emitido ni fallado = no había DTE que emitir (solo capital).
 */
export function derivarEstadoFacturacion(
  facturasGeneradas: FacturaGeneradaResumen[],
): { estado: PagoFacturaStatus; fallidos: RubroFallido[] } {
  const fallidos: RubroFallido[] = facturasGeneradas
    .filter(
      (f) =>
        f.tipo === "ERROR" &&
        !(
          typeof f.concepto === "string" &&
          CONCEPTOS_NO_CERTIFICACION.has(f.concepto)
        ),
    )
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
    | {
        facturasGeneradas: FacturaGeneradaResumen[];
        /**
         * Re-corrida PARCIAL (modo FALTANTES): facturasGeneradas trae SOLO lo
         * intentado en esta corrida. Si todo eso falla, derivar daría FALLIDA
         * — pero el pago SÍ tiene DTEs activos de la corrida original, así que
         * el piso es PARCIAL (FALLIDA mandaría a conta a "anular todo y
         * refacturar" facturas que siguen siendo válidas).
         */
        minimoParcial?: boolean;
      }
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
    if (
      "facturasGeneradas" in entrada &&
      entrada.minimoParcial &&
      resultado.estado === "FALLIDA"
    ) {
      resultado.estado = "PARCIAL";
    }
    // La rama {estado, motivo} FUSIONA con la evidencia existente (Codex P2
    // r19): un bloqueo transitorio (sin NIT, porcentajes) no puede destruir el
    // INTERESES:<inv> fallido que autoriza el retry por la regla (f). La rama
    // facturasGeneradas sigue REEMPLAZANDO a propósito: una corrida intenta
    // TODAS las keys faltantes, así que sus fallidos son el estado completo.
    let facturaError: string | null = resultado.fallidos.length
      ? JSON.stringify(resultado.fallidos)
      : null;
    if (!("facturasGeneradas" in entrada) && entrada.motivo) {
      const [previa] = await db
        .select({ factura_error: pagos_credito.factura_error })
        .from(pagos_credito)
        .where(eq(pagos_credito.pago_id, pagoId));
      facturaError = fusionarFacturaError(previa?.factura_error, resultado.fallidos);
    }
    await db
      .update(pagos_credito)
      .set({
        factura_status: resultado.estado,
        factura_error: facturaError,
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
  /** El motor cobra interés antes que IVA: un pago puede traer solo esto. */
  abono_iva_12?: string | number | null;
  abono_iva_ci?: string | number | null;
  abono_seguro?: string | number | null;
  abono_gps?: string | number | null;
  membresias_pago?: string | number | null;
  mora?: string | number | null;
  otros?: string | number | null;
};

// Semántica parseFloat, la MISMA de los bloques de emisión y del diff: un
// `otros = "12abc"` legado vale Q12 al emitir (parseFloat), pero Number() lo
// haría NaN y este clasificador diría NO_APLICA mientras la emisión SÍ factura
// — estado y realidad divergirían. (Codex P2 del PR)
const positivo = (valor: string | number | null | undefined) => {
  if (valor === null || valor === undefined) return false;
  const n = typeof valor === "number" ? valor : parseFloat(String(valor));
  return Number.isFinite(n) && n > 0;
};

/**
 * ¿Este pago genera DTE? Capital no se factura (D-48): un pago que solo abona
 * capital nace `NO_APLICA` y nunca aparece como "falta factura".
 */
export function tieneMontosFacturables(pago: MontosFacturablesPago): boolean {
  return [
    pago.abono_interes,
    pago.abono_iva_12,
    // ⚠️ Los *_ci NO cuentan (divergencia deliberada con la versión COBROS-02):
    //    /facturar-pago-completo en develop no lee esas columnas ni las incluye
    //    en hayInteresEnPago — clasificarlas como facturables dejaba 305 pagos
    //    solo-CI de prod como PENDIENTE eternos que el endpoint luego pisaba a
    //    NO_APLICA sin emitir nada. Si el negocio decide que el CI se factura,
    //    hay que agregarlo PRIMERO a la emisión y al esperado del diff, y
    //    recién entonces acá. (Codex P2 del PR #1493)
    pago.abono_seguro,
    pago.abono_gps,
    pago.membresias_pago,
    pago.mora,
    pago.otros,
  ].some(positivo);
}

export type IntentoCertificacionHuerfano = {
  intento_id: number;
  rubro: string;
  inversionista_id: number | null;
  id_interno: string;
  created_at: unknown;
};

/**
 * Reconcilia y devuelve los intentos de certificación HUÉRFANOS de un pago
 * (write-ahead `facturacion_intentos`): primero borra los que ya tienen fila
 * en facturas_electronicas — match por (pago_id, id_interno); el id no es
 * único global — y devuelve los restantes. Un huérfano = "SAT pudo certificar
 * y no hay fila": la facturación, la reversa y el revert-a-pending deben
 * NEGARSE a proceder mientras exista (bajo el lock por crédito). Se resuelven
 * con consultarPorIdInterno (COFIDI): si el DTE existe → recuperar la fila
 * (el intento se limpia solo al aparecer); si no existe → borrar el intento.
 */
export async function intentosCertificacionHuerfanos(
  pagoId: number,
): Promise<IntentoCertificacionHuerfano[]> {
  await db.execute(sql`
    DELETE FROM cartera.facturacion_intentos fi
    WHERE fi.pago_id = ${pagoId}
      AND EXISTS (
        SELECT 1 FROM cartera.facturas_electronicas f
        WHERE f.pago_id = fi.pago_id
          AND f.id_interno = fi.id_interno
      )
  `);
  const res = await db.execute(sql`
    SELECT intento_id, rubro, inversionista_id, id_interno, created_at
    FROM cartera.facturacion_intentos
    WHERE pago_id = ${pagoId}
    ORDER BY intento_id
  `);
  return (((res as any).rows ?? []) as IntentoCertificacionHuerfano[]);
}

/**
 * Fusiona entradas nuevas al JSON de factura_error PRESERVANDO la evidencia
 * previa. La regla (f) del diff exige que un INTERESES:<inv> faltante esté
 * respaldado por su entrada de fallo original — un reopen lateral (sync de
 * Excel, razón de bloqueo, anulación manual) que REEMPLACE el JSON la
 * destruiría y dejaría el pago BLOQUEADO permanente (Codex P2 r17). Regla:
 * se conservan todas las entradas previas cuya (rubro, inversionista_id) no
 * venga en las nuevas; las nuevas se agregan al final.
 */
export function fusionarFacturaError(
  existente: string | null | undefined,
  nuevos: RubroFallido[],
): string {
  let previos: RubroFallido[] = [];
  if (typeof existente === "string" && existente) {
    try {
      const parsed = JSON.parse(existente);
      if (Array.isArray(parsed)) previos = parsed;
    } catch {
      // texto no-JSON legado: no hay evidencia estructurada que preservar
    }
  }
  const clave = (f: { rubro?: string | null; inversionista_id?: number | null }) =>
    `${f?.rubro ?? ""}:${f?.inversionista_id ?? ""}`;
  const nuevasClaves = new Set(nuevos.map(clave));
  return JSON.stringify([
    ...previos.filter((f) => !nuevasClaves.has(clave(f))),
    ...nuevos,
  ]);
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
