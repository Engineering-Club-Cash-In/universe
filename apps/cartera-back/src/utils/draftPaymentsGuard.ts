import { and, eq, ne } from "drizzle-orm";
import { db } from "../database";
import {
  creditos,
  inversionistas,
  pagos_credito_inversionistas_espejo,
} from "../database/db/schema";

// Tope de nombres/SIFCOs que se listan en el mensaje antes de resumir con
// "y N más" — un crédito o inversionista con decenas de filas bloqueantes no
// debe producir un toast ilegible.
const MAX_NOMBRES_EN_MENSAJE = 5;

export const UNLIQUIDATED_DRAFTS_CODE = "UNLIQUIDATED_DRAFT_PAYMENTS" as const;

export type DraftBlockingInvestor = {
  inversionista_id: number;
  nombre: string;
};

export type DraftBlockingCredit = {
  credito_id: number;
  numero_credito_sifco: string;
};

export type UnliquidatedDraftsWarning = {
  warning: true;
  code: typeof UNLIQUIDATED_DRAFTS_CODE;
  message: string;
  inversionistas_bloqueantes?: DraftBlockingInvestor[];
  creditos_bloqueantes?: DraftBlockingCredit[];
};

export class UnliquidatedDraftPaymentsError extends Error {
  readonly warning = true as const;
  readonly code = UNLIQUIDATED_DRAFTS_CODE;
  readonly inversionistas_bloqueantes?: DraftBlockingInvestor[];
  readonly creditos_bloqueantes?: DraftBlockingCredit[];

  constructor(warning: UnliquidatedDraftsWarning) {
    super(warning.message);
    this.name = "UnliquidatedDraftPaymentsError";
    this.inversionistas_bloqueantes = warning.inversionistas_bloqueantes;
    this.creditos_bloqueantes = warning.creditos_bloqueantes;
  }
}

function formatearLista(nombres: string[]): string {
  if (nombres.length <= MAX_NOMBRES_EN_MENSAJE) return nombres.join(", ");
  const visibles = nombres.slice(0, MAX_NOMBRES_EN_MENSAJE);
  const restantes = nombres.length - MAX_NOMBRES_EN_MENSAJE;
  return `${visibles.join(", ")} y ${restantes} más`;
}

export function buildCreditUnliquidatedDraftsWarning(
  bloqueantes: DraftBlockingInvestor[],
): UnliquidatedDraftsWarning | null {
  if (bloqueantes.length === 0) return null;

  const nombres = formatearLista(bloqueantes.map((b) => b.nombre));

  return {
    warning: true,
    code: UNLIQUIDATED_DRAFTS_CODE,
    message: `No se puede solicitar la devolución: este crédito tiene pagos sin liquidar de ${nombres}. Liquidalos antes de enviarlo a devolución.`,
    inversionistas_bloqueantes: bloqueantes,
  };
}

export function buildInvestorUnliquidatedDraftsWarning(
  bloqueantes: DraftBlockingCredit[],
): UnliquidatedDraftsWarning | null {
  if (bloqueantes.length === 0) return null;

  const sifcos = formatearLista(bloqueantes.map((b) => b.numero_credito_sifco));

  return {
    warning: true,
    code: UNLIQUIDATED_DRAFTS_CODE,
    message: `No se puede marcar al inversionista para devolución: tiene pagos sin liquidar en los créditos ${sifcos}. Liquidalos primero.`,
    creditos_bloqueantes: bloqueantes,
  };
}

/**
 * Guard A (crédito). null = el crédito no tiene pagos espejo sin liquidar
 * (estado_liquidacion != 'LIQUIDADO') para ninguno de sus inversionistas.
 * `conn` permite correr dentro de la transacción/lock de updateCredit.
 */
export async function checkCreditHasUnliquidatedDrafts(
  creditoId: number,
  conn: typeof db = db,
): Promise<UnliquidatedDraftsWarning | null> {
  const bloqueantes = await conn
    .selectDistinct({
      inversionista_id: pagos_credito_inversionistas_espejo.inversionista_id,
      nombre: inversionistas.nombre,
    })
    .from(pagos_credito_inversionistas_espejo)
    .innerJoin(
      inversionistas,
      eq(
        pagos_credito_inversionistas_espejo.inversionista_id,
        inversionistas.inversionista_id,
      ),
    )
    .where(
      and(
        eq(pagos_credito_inversionistas_espejo.credito_id, creditoId),
        ne(pagos_credito_inversionistas_espejo.estado_liquidacion, "LIQUIDADO"),
      ),
    );

  return buildCreditUnliquidatedDraftsWarning(bloqueantes);
}

/**
 * Guard B (inversionista). null = el inversionista no tiene pagos espejo sin
 * liquidar en ningún crédito.
 */
export async function checkInvestorHasUnliquidatedDrafts(
  inversionistaId: number,
  conn: typeof db = db,
): Promise<UnliquidatedDraftsWarning | null> {
  const bloqueantes = await conn
    .selectDistinct({
      credito_id: pagos_credito_inversionistas_espejo.credito_id,
      numero_credito_sifco: creditos.numero_credito_sifco,
    })
    .from(pagos_credito_inversionistas_espejo)
    .innerJoin(
      creditos,
      eq(pagos_credito_inversionistas_espejo.credito_id, creditos.credito_id),
    )
    .where(
      and(
        eq(
          pagos_credito_inversionistas_espejo.inversionista_id,
          inversionistaId,
        ),
        ne(pagos_credito_inversionistas_espejo.estado_liquidacion, "LIQUIDADO"),
      ),
    );

  return buildInvestorUnliquidatedDraftsWarning(bloqueantes);
}
