import { eq, and } from "drizzle-orm";
import { db } from "../database";
import {
  creditos,
  creditos_inversionistas,
  pagos_credito,
  moras_credito,
  credit_cancelations,
  montos_adicionales,
  credit_reset_snapshots,
} from "../database/db/schema";

export const SNAPSHOT_VERSION = 1;

type SnapshotExecutor = Pick<typeof db, "select" | "insert" | "update">;

/** Fila de un pago que resetCredit va a anular, con los valores que pisa. */
export interface SnapshotPagoAnulado {
  pago_id: number;
  paymentFalse: boolean | null;
  capital_restante: string | null;
  interes_restante: string | null;
  iva_12_restante: string | null;
  seguro_restante: string | null;
  gps_restante: string | null;
  total_restante: string | null;
  mora: string | null;
}

/** Foto de lo que existía ANTES de que resetCredit mute nada. */
export interface SnapshotPayloadV1 {
  version: number;
  capturado_at: string;
  status_previo: string;
  credito: Record<string, unknown>;
  creditos_inversionistas: Record<string, unknown>[];
  pagos_a_anular: SnapshotPagoAnulado[];
  mora_activa: Record<string, unknown> | null;
  credit_cancelation: Record<string, unknown> | null;
  montos_adicionales: Record<string, unknown>[];
}

/** IDs de todo lo que el cierre CREÓ, para que la reversa borre por ID. */
export interface SnapshotArtefactos {
  pago_cierre_id: number;
  cuota_cierre_ids: number[];
  abonos_capital_ids: number[];
  pagos_credito_inversionistas_ids: number[];
  boleta_ids: number[];
  bad_debt_id: number | null;
  pago_incobrable_placeholder_id: number | null;
}

/**
 * Captura el snapshot de reversa. Debe llamarse dentro de la transacción de
 * resetCredit ANTES de la primera escritura (la liquidación muta
 * creditos_inversionistas y luego se zerea; la foto tiene que ser previa).
 * Devuelve el id del snapshot para registrar los artefactos al final.
 */
export async function capturarSnapshotResetCredit(
  tx: SnapshotExecutor,
  creditoRow: typeof creditos.$inferSelect,
  createdBy?: string
): Promise<number> {
  const credito_id = creditoRow.credito_id;

  const inversionistasRows = await tx
    .select()
    .from(creditos_inversionistas)
    .where(eq(creditos_inversionistas.credito_id, credito_id));

  const pagosAAnular = await tx
    .select({
      pago_id: pagos_credito.pago_id,
      paymentFalse: pagos_credito.paymentFalse,
      capital_restante: pagos_credito.capital_restante,
      interes_restante: pagos_credito.interes_restante,
      iva_12_restante: pagos_credito.iva_12_restante,
      seguro_restante: pagos_credito.seguro_restante,
      gps_restante: pagos_credito.gps_restante,
      total_restante: pagos_credito.total_restante,
      mora: pagos_credito.mora,
    })
    .from(pagos_credito)
    .where(
      and(
        eq(pagos_credito.credito_id, credito_id),
        eq(pagos_credito.pagado, false)
      )
    );

  const [moraActiva] = await tx
    .select()
    .from(moras_credito)
    .where(
      and(
        eq(moras_credito.credito_id, credito_id),
        eq(moras_credito.activa, true)
      )
    );

  const [cancelacion] = await tx
    .select()
    .from(credit_cancelations)
    .where(eq(credit_cancelations.credit_id, credito_id));

  const extras = await tx
    .select()
    .from(montos_adicionales)
    .where(eq(montos_adicionales.credit_id, credito_id));

  const payload: SnapshotPayloadV1 = {
    version: SNAPSHOT_VERSION,
    capturado_at: new Date().toISOString(),
    status_previo: creditoRow.statusCredit,
    credito: creditoRow as unknown as Record<string, unknown>,
    creditos_inversionistas: inversionistasRows as unknown as Record<
      string,
      unknown
    >[],
    pagos_a_anular: pagosAAnular,
    mora_activa: (moraActiva as unknown as Record<string, unknown>) ?? null,
    credit_cancelation:
      (cancelacion as unknown as Record<string, unknown>) ?? null,
    montos_adicionales: extras as unknown as Record<string, unknown>[],
  };

  // Cadena cancelación → incobrable → nuevo reset: el snapshot previo queda
  // SUPERSEDED para respetar el único VIVO por crédito.
  await tx
    .update(credit_reset_snapshots)
    .set({ estado: "SUPERSEDED" })
    .where(
      and(
        eq(credit_reset_snapshots.credito_id, credito_id),
        eq(credit_reset_snapshots.estado, "VIVO")
      )
    );

  const [snap] = await tx
    .insert(credit_reset_snapshots)
    .values({
      credito_id,
      version: SNAPSHOT_VERSION,
      payload,
      created_by: createdBy ?? null,
    })
    .returning({ id: credit_reset_snapshots.id });

  return snap.id;
}

/** Registra los artefactos creados por el cierre; última escritura de la tx de resetCredit. */
export async function registrarArtefactosSnapshot(
  tx: SnapshotExecutor,
  snapshotId: number,
  artefactos: SnapshotArtefactos
): Promise<void> {
  await tx
    .update(credit_reset_snapshots)
    .set({
      artefactos_creados: artefactos,
      pago_cierre_id: artefactos.pago_cierre_id,
    })
    .where(eq(credit_reset_snapshots.id, snapshotId));
}
