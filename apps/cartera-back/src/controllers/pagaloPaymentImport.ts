import {
  PAGALO_IMPORT_ERROR_CODES,
  validatePagaloImportCommand,
  verificarPagaloPayloadHash,
  type PagaloImportCommand,
} from "./pagaloPaymentImportPolicy";
import Big from "big.js";
import { and, eq, or } from "drizzle-orm";
import { db } from "../database";
import {
  creditos,
  moras_credito,
  pagalo_payment_imports,
  pagos_credito,
} from "../database/db";
import { updateMoraEnTx } from "./latefee";
import { procesarRegistroPago } from "./registerPayment";
import type { PagaloComponentes } from "./registerPayment";
import { CREDIT_PENDING_CANCELLATION_ERROR } from "./registerPaymentPolicy";
import { withPaymentAdvisoryLock } from "../utils/paymentAdvisoryLock";

export type PagaloImportLedger = {
  id: number;
  status: "APPLIED" | "REVIEW_REQUIRED" | string;
  payload_hash: string;
  payment_ids: number[];
};

export type PagaloImportServiceDependencies = {
  findByGroup: (crmGroupId: string) => Promise<PagaloImportLedger | undefined>;
  markReviewRequired: (
    importId: number,
    code: "PAGALO_PAYLOAD_HASH_CONFLICT",
  ) => Promise<void>;
  registrarPago: (command: PagaloImportCommand) => Promise<unknown>;
};

export type PagaloRegistroInput = {
  credito_id: number;
  monto_boleta: number;
  fecha_pago: string;
  fecha_boleta: string;
  cuotaApagar: number;
  url_boletas: string[];
  registerBy: "pagalo@clubcashin.com";
  origen_pago: "pagalo";
  pagalo_import_id: number;
  pagalo_componentes: PagaloComponentes;
  banco_id: number;
};

// Banco dedicado para pagos Págalo (bancos.banco_id = 28, nombre "PAGALO") —
// evita el default banco_id=0 que procesarRegistroPago usaría si no viniera
// (no existe en `bancos`, violaría pagos_credito_banco_id_fkey).
const PAGALO_BANCO_ID = 28;

const fechaGuatemala = (instant: Date) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Guatemala",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
};

/**
 * Maps only audited Págalo evidence. capital y facturable siguen siendo dos
 * LINKS de cobro distintos hacia el cliente (D-48: capital no se factura, el
 * resto sí) — pero de cara a cartera-back se registran como UN solo pago con
 * el total combinado (decisión de negocio, Daniel, 2026-08-26): ya no se
 * manda abono_directo_capital por separado. monto_boleta = total_amount deja
 * que el motor reparta el efectivo completo (mora → interés → iva → seguro →
 * gps → membresías → capital) exactamente como una boleta manual normal.
 */
export function mapPagaloImportToRegistro(
  command: PagaloImportCommand,
  pagaloImportId: number,
): PagaloRegistroInput {
  const sources = [command.capital, command.facturable].filter(
    (source): source is NonNullable<typeof source> => source !== null,
  );
  const paidAt = sources
    .map((source) => new Date(source.paid_at))
    .reduce((latest, current) =>
      current.getTime() > latest.getTime() ? current : latest,
    );
  const fechaPago = fechaGuatemala(paidAt);
  const capital = command.capital
    ? ({
        disponible: command.capital_total,
        allocations: command.allocations.filter((a) => a.link_type === "CAPITAL"),
        voucher_storage_key: command.capital.voucher_storage_key,
      } as NonNullable<PagaloComponentes["capital"]>)
    : undefined;
  const facturable = command.facturable
    ? ({
        disponible: command.facturable_total,
        allocations: command.allocations.filter(
          (a) => a.link_type === "MORA_INTERES",
        ),
        voucher_storage_key: command.facturable.voucher_storage_key,
      } as NonNullable<PagaloComponentes["facturable"]>)
    : undefined;

  return {
    credito_id: command.credito_id,
    monto_boleta: Number(command.total_amount),
    fecha_pago: fechaPago,
    fecha_boleta: fechaPago,
    cuotaApagar: command.cuota_inicial,
    url_boletas: sources.map((source) => source.voucher_storage_key),
    registerBy: "pagalo@clubcashin.com",
    origen_pago: "pagalo",
    pagalo_import_id: pagaloImportId,
    pagalo_componentes: {
      ...(capital ? { capital } : {}),
      ...(facturable ? { facturable } : {}),
    },
    banco_id: PAGALO_BANCO_ID,
  };
}

export function createPagaloImportService(deps: PagaloImportServiceDependencies) {
  return {
    async import(input: unknown) {
      const validated = validatePagaloImportCommand(input);
      if (!validated.success) {
        return {
          success: false as const,
          status: "INVALID_COMMAND" as const,
          code: validated.errors[0]?.code,
          errors: validated.errors,
        };
      }

      if (!verificarPagaloPayloadHash(validated.data)) {
        return {
          success: false as const,
          status: "INVALID_COMMAND" as const,
          code: PAGALO_IMPORT_ERROR_CODES.PAGALO_PAYLOAD_HASH_MISMATCH,
          errors: [{
            code: PAGALO_IMPORT_ERROR_CODES.PAGALO_PAYLOAD_HASH_MISMATCH,
            message: "El payload_hash no corresponde al contenido del comando Págalo.",
          }],
        };
      }

      const existing = await deps.findByGroup(validated.data.crm_group_id);
      if (existing) {
        if (existing.payload_hash === validated.data.payload_hash) {
          return {
            success: true as const,
            status: existing.status,
            import_id: existing.id,
            payment_ids: existing.payment_ids,
            idempotent_replay: true as const,
          };
        }

        await deps.markReviewRequired(
          existing.id,
          "PAGALO_PAYLOAD_HASH_CONFLICT",
        );
        return {
          success: false as const,
          status: "REVIEW_REQUIRED" as const,
          code: "PAGALO_PAYLOAD_HASH_CONFLICT" as const,
          import_id: existing.id,
        };
      }

      return deps.registrarPago(validated.data);
    },
  };
}

/**
 * Mora que el cliente VIO al generar los links: la suma del rubro MORA del
 * snapshot (Q0 si el grupo se armó al día y no lleva ese rubro).
 */
export const moraDelSnapshot = (command: PagaloImportCommand): string =>
  command.allocations
    .filter((a) => a.rubro === "MORA")
    .reduce((n, a) => n.plus(a.amount), new Big(0))
    .toFixed(2);

/**
 * Ajuste de mora al aplicar un pago Págalo (D-52, ajuste 2026-08-26, Daniel).
 *
 * El motor de `procesarRegistroPago` consume PRIMERO la mora viva de
 * `moras_credito`. Si esa mora creció (o nació) después de generar los links
 * — corrió el job de las 23:59 — se tragaría parte del dinero de la cuota y
 * el cliente, que pagó exactamente lo que le dijimos, quedaría con la cuota
 * abierta. Lo justo: el pago cubre la mora que el cliente vio; la diferencia
 * sigue debiéndose como mora.
 *
 * Devuelve la diferencia (viva − snapshot) solo cuando la mora viva es MAYOR.
 * Si la mora viva es menor (condonación o pago por otro canal entre medio)
 * no se sube: sería cobrar mora que ya no debe; el sobrante cascadea como
 * boleta manual (D-52.2).
 */
export function calcularAjusteMoraPagalo(
  moraViva: string | number | null | undefined,
  moraSnapshot: string,
): string | null {
  const viva = new Big(moraViva ?? 0);
  const snapshot = new Big(moraSnapshot);
  return viva.gt(snapshot) ? viva.minus(snapshot).toFixed(2) : null;
}

/**
 * Deja la mora viva igual al snapshot ANTES de registrar el pago, y devuelve
 * el callback que la repone DESPUÉS. La reposición existe para que el crédito
 * no amanezca ACTIVO unas horas: `procesarMoras` (23:59) recalcula la mora
 * desde cero (capital × 1.12% × cuotas vencidas), así que a la noche queda
 * la mora justa según las cuotas que sigan abiertas tras este pago.
 *
 * DEPENDE de que el pago quede VALIDADO en esta misma transacción: el cron
 * solo cuenta una cuota como cubierta con pago `validated`/`no_required`, así
 * que un pago `pending` que cruce las 23:59 hace que reponga la mora completa
 * (la misma ventana que hoy tiene cualquier boleta manual con mora entre
 * registrar y validar). Hasta que el import valide de una vez (siguiente
 * slice, decisión de Daniel), el ajuste solo es exacto si conta valida antes
 * del cron.
 */
async function igualarMoraAlSnapshot(
  tx: any,
  command: PagaloImportCommand,
): Promise<null | (() => Promise<void>)> {
  const snapshot = moraDelSnapshot(command);
  const [moraViva] = await tx
    .select({ monto_mora: moras_credito.monto_mora })
    .from(moras_credito)
    .where(
      and(
        eq(moras_credito.credito_id, command.credito_id),
        eq(moras_credito.activa, true),
      ),
    )
    .limit(1)
    .for("update");
  const diferencia = calcularAjusteMoraPagalo(moraViva?.monto_mora, snapshot);
  if (diferencia === null) return null;

  const motivo = `Ajuste Págalo grupo ${command.crm_group_id}: mora viva Q${new Big(moraViva?.monto_mora ?? 0).toFixed(2)} vs mora del link Q${snapshot}; diferencia Q${diferencia} sigue pendiente`;
  const bajar = await updateMoraEnTx(
    { credito_id: command.credito_id, tipo: "DECREMENTO", monto_cambio: Number(diferencia) },
    tx,
    { motivo },
  );
  if (!bajar.success) {
    throw new Error(`${REVIEW_REQUIRED_PREFIX} No se pudo igualar la mora al snapshot Págalo: ${bajar.message}`);
  }
  return async () => {
    // `activa: true` reactiva la fila aunque el pago la haya dejado en Q0.
    const subir = await updateMoraEnTx(
      {
        credito_id: command.credito_id,
        tipo: "INCREMENTO",
        monto_cambio: Number(diferencia),
        activa: true,
      },
      tx,
      { motivo },
    );
    if (!subir.success) {
      throw new Error(`${REVIEW_REQUIRED_PREFIX} No se pudo reponer la diferencia de mora Págalo: ${subir.message}`);
    }
  };
}

const REVIEW_REQUIRED_PREFIX = "PAGALO_REVIEW_REQUIRED:";
const CUOTA_INTEGRITY_ERROR_PREFIX = "Inconsistencia de integridad:";
const DETERMINISTIC_PAYMENT_REJECT_PREFIXES = [
  "Credit not found",
  "User not found",
  "Pago rechazado:",
];

/** Replay no aplicado nunca debe parecer entrega exitosa al dispatcher CRM. */
export const getPagaloImportReplayHttpStatus = (status: string) =>
  status === "APPLIED" ? 200 : 409;

const PAGALO_SAME_ROLE_EVIDENCE_CONSTRAINTS = new Set([
  "pagalo_payment_imports_capital_tx_uq",
  "pagalo_payment_imports_facturable_tx_uq",
  "pagalo_payment_imports_capital_external_uq",
  "pagalo_payment_imports_facturable_external_uq",
]);

/** Solo mismas columnas/rol; cruce CAPITAL↔MORA_INTERES sigue hardening D-13. */
export function isPagaloSameRoleEvidenceConflict(error: unknown): boolean {
  const dbError = error as { code?: unknown; constraint?: unknown; cause?: unknown } | null;
  if (!dbError || typeof dbError !== "object") return false;
  if (
    dbError.code === "23505" &&
    typeof dbError.constraint === "string" &&
    PAGALO_SAME_ROLE_EVIDENCE_CONSTRAINTS.has(dbError.constraint)
  )
    return true;
  return isPagaloSameRoleEvidenceConflict(dbError.cause);
}

/** Errores de negocio recuperables: se auditan sin reintentar motor normal. */
export function getPagaloReviewRequiredReason(error: unknown) {
  const message = error instanceof Error ? error.message :
    typeof error === "object" && error !== null && "message" in error &&
      typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : undefined;
  if (message?.startsWith(REVIEW_REQUIRED_PREFIX))
    return message.slice(REVIEW_REQUIRED_PREFIX.length).trim();
  if (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === CREDIT_PENDING_CANCELLATION_ERROR.code
  )
    return message ?? CREDIT_PENDING_CANCELLATION_ERROR.message;
  if (message?.startsWith(CUOTA_INTEGRITY_ERROR_PREFIX)) return message;
  if (
    message &&
    DETERMINISTIC_PAYMENT_REJECT_PREFIXES.some((prefix) => message.startsWith(prefix))
  )
    return message;
  return undefined;
}

const paymentIdsForImport = async (
  executor: any,
  importId: number,
) =>
  (
    await executor
      .select({ pago_id: pagos_credito.pago_id })
      .from(pagos_credito)
      .where(eq(pagos_credito.pagalo_import_id, importId))
  ).map((row: { pago_id: number }) => row.pago_id);

type PagaloLedgerCreditIdentity = {
  credito_id: number | null;
  numero_credito_sifco: string | null;
};

export function resolvePagaloLedgerCreditIdentity(
  command: PagaloImportCommand,
  liveCredit: PagaloLedgerCreditIdentity | undefined,
) {
  if (!liveCredit) {
    return {
      identity: { credito_id: null, numero_credito_sifco: null },
      reviewReason: `El crédito ${command.credito_id} ya no existe; SIFCO recibido: ${command.numero_credito_sifco}.`,
    };
  }
  if (liveCredit.numero_credito_sifco !== command.numero_credito_sifco) {
    return {
      identity: liveCredit,
      reviewReason:
        `SIFCO recibido (${command.numero_credito_sifco}) no coincide con ` +
        `crédito ${command.credito_id} vivo (${liveCredit.numero_credito_sifco}).`,
    };
  }
  return { identity: liveCredit, reviewReason: undefined };
}

const importValues = (
  command: PagaloImportCommand,
  creditIdentity: PagaloLedgerCreditIdentity = command,
) => ({
  crm_group_id: command.crm_group_id,
  credito_id: creditIdentity.credito_id,
  numero_credito_sifco: creditIdentity.numero_credito_sifco,
  currency: command.currency,
  capital_total: command.capital_total,
  facturable_total: command.facturable_total,
  total_amount: command.total_amount,
  capital_transaction_uuid: command.capital?.transaction_uuid ?? null,
  facturable_transaction_uuid: command.facturable?.transaction_uuid ?? null,
  capital_external_identifier: command.capital?.external_identifier ?? null,
  facturable_external_identifier: command.facturable?.external_identifier ?? null,
  capital_request_id: command.capital?.request_id ?? null,
  facturable_request_id: command.facturable?.request_id ?? null,
  capital_request_auth: command.capital?.request_auth ?? null,
  facturable_request_auth: command.facturable?.request_auth ?? null,
  capital_paid_at: command.capital ? new Date(command.capital.paid_at) : null,
  facturable_paid_at: command.facturable
    ? new Date(command.facturable.paid_at)
    : null,
  payload_hash: command.payload_hash,
});

const findSameRoleEvidenceImport = async (
  executor: any,
  command: PagaloImportCommand,
) => {
  const conditions: any[] = [];
  if (command.capital) {
    conditions.push(
      eq(pagalo_payment_imports.capital_transaction_uuid, command.capital.transaction_uuid),
      eq(pagalo_payment_imports.capital_external_identifier, command.capital.external_identifier),
    );
  }
  if (command.facturable) {
    conditions.push(
      eq(pagalo_payment_imports.facturable_transaction_uuid, command.facturable.transaction_uuid),
      eq(pagalo_payment_imports.facturable_external_identifier, command.facturable.external_identifier),
    );
  }
  if (conditions.length === 0) return undefined;
  const [existing] = await executor
    .select({ id: pagalo_payment_imports.id })
    .from(pagalo_payment_imports)
    .where(or(...conditions))
    .limit(1);
  return existing;
};

/**
 * Endpoint interno CRM → Cartera. No recibe credenciales Págalo: solo evidencia
 * ACCEPT ya validada por CRM. Advisory lock y transacción dejan importación,
 * pagos, boletas y validación como una sola unidad.
 *
 * Auth: `authMiddleware` (montado en el router, ver payments.ts) ya exige el
 * mismo Bearer JWT que usa cualquier otra ruta de este router — no hay
 * secreto de servicio adicional; un JWT válido de sesión es suficiente,
 * igual que para /newPayment o /reversePayment.
 */
export const importPagaloPayment = async ({ body, set }: any) => {
	const parsed = validatePagaloImportCommand(body);
	if (!parsed.success) {
    set.status = 400;
    return {
      success: false,
      status: "INVALID_COMMAND",
      errors: parsed.errors,
    };
	}
  if (!verificarPagaloPayloadHash(parsed.data)) {
    set.status = 400;
    return {
      success: false,
      status: "INVALID_COMMAND",
      errors: [{
        code: PAGALO_IMPORT_ERROR_CODES.PAGALO_PAYLOAD_HASH_MISMATCH,
        message: "El payload_hash no corresponde al contenido del comando Págalo.",
      }],
    };
  }
	const command = parsed.data;

  return withPaymentAdvisoryLock(command.credito_id, async () => {
    const [existing] = await db
      .select({
        id: pagalo_payment_imports.id,
        payload_hash: pagalo_payment_imports.payload_hash,
        status: pagalo_payment_imports.status,
        last_error_code: pagalo_payment_imports.last_error_code,
      })
      .from(pagalo_payment_imports)
      .where(eq(pagalo_payment_imports.crm_group_id, command.crm_group_id))
      .limit(1);

    if (existing) {
      if (existing.payload_hash !== command.payload_hash) {
        await db
          .update(pagalo_payment_imports)
          .set({
            status: "REVIEW_REQUIRED",
            last_error_code: "PAGALO_PAYLOAD_HASH_CONFLICT",
            last_error_message: "crm_group_id recibió payload_hash distinto.",
            updated_at: new Date(),
          })
          .where(eq(pagalo_payment_imports.id, existing.id));
        set.status = 409;
        return {
          success: false,
          status: "REVIEW_REQUIRED",
          code: "PAGALO_PAYLOAD_HASH_CONFLICT",
          import_id: existing.id,
        };
      }

      set.status = getPagaloImportReplayHttpStatus(existing.status);
      return {
        success: existing.status === "APPLIED",
        status: existing.status,
        import_id: existing.id,
        payment_ids: await paymentIdsForImport(db, existing.id),
        idempotent_replay: true,
        // Un replay de un import que quedó REVIEW_REQUIRED (deuda viva,
        // comando inválido, etc.) debe llevar el motivo original; sin esto
        // el CRM guardaba `code: undefined` y el operador no sabía por qué
        // revisar el grupo (hallazgo Codex).
        ...(existing.status === "REVIEW_REQUIRED" && existing.last_error_code
          ? { code: existing.last_error_code }
          : {}),
      };
    }

    const evidenceConflict = await findSameRoleEvidenceImport(db, command);
    if (evidenceConflict) {
      set.status = 409;
      return {
        success: false,
        status: "REVIEW_REQUIRED",
        code: "PAGALO_TRANSACTION_ALREADY_IMPORTED",
        conflicting_import_id: evidenceConflict.id,
      };
    }

    try {
      return await db.transaction(async (tx) => {
        const [liveCredit] = await tx
          .select({
            credito_id: creditos.credito_id,
            numero_credito_sifco: creditos.numero_credito_sifco,
          })
          .from(creditos)
          .where(eq(creditos.credito_id, command.credito_id))
          .limit(1)
          .for("update");
        const creditResolution = resolvePagaloLedgerCreditIdentity(command, liveCredit);
        if (creditResolution.reviewReason) {
          const [review] = await tx
            .insert(pagalo_payment_imports)
            .values({
              ...importValues(command, creditResolution.identity),
              status: "REVIEW_REQUIRED",
              last_error_code: "PAGALO_LIVE_CREDIT_IDENTITY_REVIEW",
              last_error_message: creditResolution.reviewReason,
            })
            .returning({ id: pagalo_payment_imports.id });
          set.status = 409;
          return {
            success: false,
            status: "REVIEW_REQUIRED",
            code: "PAGALO_LIVE_CREDIT_IDENTITY_REVIEW",
            import_id: review?.id,
          };
        }

        const [ledger] = await tx
          .insert(pagalo_payment_imports)
          .values({ ...importValues(command, creditResolution.identity), status: "APPLYING" })
          .returning({ id: pagalo_payment_imports.id });
        if (!ledger) throw new Error("No se pudo crear importación Págalo.");

        // D-52 (ajuste): el pago cubre la mora que el cliente vio en el link;
        // si la mora creció desde entonces, la diferencia se repone después.
        const reponerMora = await igualarMoraAlSnapshot(tx, command);

        const result = await procesarRegistroPago(
          {
            data: {
              ...mapPagaloImportToRegistro(command, ledger.id),
              observaciones: `Pago Págalo · grupo ${command.crm_group_id}`,
              otros: 0,
            },
            set: { status: 200 },
          },
          tx,
        );
        if ("success" in result && result.success === false) {
          throw new Error(`${REVIEW_REQUIRED_PREFIX} ${result.message}`);
        }
        if (reponerMora) await reponerMora();

        const paymentIds = await paymentIdsForImport(tx, ledger.id);
        if (paymentIds.length === 0) {
          throw new Error("PAGALO_REVIEW_REQUIRED: importación no creó pagos.");
        }
        // Este import solo deja pago(s) y boleta(s) registrados. Validar el
        // pago (cerrar cuota, mover capital, distribuir a inversionistas) es
        // el flujo normal de cartera-back — el mismo que corre para
        // cualquier otro pago pendiente, sin importar su origen. No se llama
        // acá porque un pago de abono a capital (validationStatus="capital")
        // sigue un camino de validación distinto al de cuotas/mora
        // (validarPagoRegistrado solo entiende "pending"), y este import no
        // decide cuál aplica — el flujo normal de cartera ya sabe hacerlo.
        await tx
          .update(pagalo_payment_imports)
          .set({ status: "APPLIED", applied_at: new Date(), updated_at: new Date() })
          .where(eq(pagalo_payment_imports.id, ledger.id));
        return {
          success: true,
          status: "APPLIED",
          import_id: ledger.id,
          payment_ids: paymentIds,
          idempotent_replay: false,
        };
      });
    } catch (error) {
      if (isPagaloSameRoleEvidenceConflict(error)) {
        set.status = 409;
        return {
          success: false,
          status: "REVIEW_REQUIRED",
          code: "PAGALO_TRANSACTION_ALREADY_IMPORTED",
        };
      }
      const message = getPagaloReviewRequiredReason(error);
      if (message === undefined) throw error;

      // La tx financiera ya hizo rollback y liberó el lock `FOR UPDATE` del
      // crédito, así que pudo desaparecer o cambiar de SIFCO en esa ventana.
      // Re-resolver la identidad bajo un lock propio (no un select+insert
      // sueltos: el crédito podría volver a cambiar entre ambos) evita que
      // el FK compuesto de `pagalo_payment_imports` rechace este insert y se
      // pierda la evidencia de que Págalo aceptó el pago (hallazgo Codex).
      const [review] = await db.transaction(async (auditTx) => {
        const [liveCreditAfterRollback] = await auditTx
          .select({
            credito_id: creditos.credito_id,
            numero_credito_sifco: creditos.numero_credito_sifco,
          })
          .from(creditos)
          .where(eq(creditos.credito_id, command.credito_id))
          .limit(1)
          .for("update");
        const { identity } = resolvePagaloLedgerCreditIdentity(
          command,
          liveCreditAfterRollback,
        );

        return auditTx
          .insert(pagalo_payment_imports)
          .values({
            ...importValues(command, identity),
            status: "REVIEW_REQUIRED",
            last_error_code: "PAGALO_LIVE_DEBT_REVIEW",
            last_error_message: message,
          })
          .returning({ id: pagalo_payment_imports.id });
      });
      set.status = 409;
      return {
        success: false,
        status: "REVIEW_REQUIRED",
        code: "PAGALO_LIVE_DEBT_REVIEW",
        import_id: review?.id,
      };
    }
  });
};
