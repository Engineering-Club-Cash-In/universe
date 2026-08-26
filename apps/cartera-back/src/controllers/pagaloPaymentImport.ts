import {
  PAGALO_IMPORT_ERROR_CODES,
  validatePagaloImportCommand,
  verificarPagaloPayloadHash,
  type PagaloImportCommand,
} from "./pagaloPaymentImportPolicy";
import { and, eq } from "drizzle-orm";
import { db } from "../database";
import { pagalo_payment_imports, pagos_credito } from "../database/db";
import { procesarRegistroPago } from "./registerPayment";
import type { PagaloComponentes } from "./registerPayment";
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
  // TEMPORAL (solo pruebas sandbox): procesarRegistroPago usa `banco_id ?? 0`
  // como default cuando no viene, y banco_id=0 no existe en `bancos` (FK
  // pagos_credito_banco_id_fkey). Págalo no tiene banco real que reportar;
  // se fija un banco_id válido cualquiera hasta decidir el manejo definitivo
  // (columna nullable de verdad, o un banco "PAGALO" dedicado).
  banco_id: number;
};

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
    banco_id: 1,
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

const REVIEW_REQUIRED_PREFIX = "PAGALO_REVIEW_REQUIRED:";

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

const importValues = (command: PagaloImportCommand) => ({
  crm_group_id: command.crm_group_id,
  credito_id: command.credito_id,
  numero_credito_sifco: command.numero_credito_sifco,
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

      return {
        success: existing.status === "APPLIED",
        status: existing.status,
        import_id: existing.id,
        payment_ids: await paymentIdsForImport(db, existing.id),
        idempotent_replay: true,
      };
    }

    try {
      return await db.transaction(async (tx) => {
        const [ledger] = await tx
          .insert(pagalo_payment_imports)
          .values({ ...importValues(command), status: "APPLYING" })
          .returning({ id: pagalo_payment_imports.id });
        if (!ledger) throw new Error("No se pudo crear importación Págalo.");

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
      const message = error instanceof Error ? error.message : String(error);
      if (!message.startsWith(REVIEW_REQUIRED_PREFIX)) throw error;

      // La tx financiera ya hizo rollback. Esta tx corta deja evidencia de la
      // revisión sin reintroducir ningún pago, mora, boleta ni saldo mutado.
      const [review] = await db
        .insert(pagalo_payment_imports)
        .values({
          ...importValues(command),
          status: "REVIEW_REQUIRED",
          last_error_code: "PAGALO_LIVE_DEBT_REVIEW",
          last_error_message: message.slice(REVIEW_REQUIRED_PREFIX.length).trim(),
        })
        .returning({ id: pagalo_payment_imports.id });
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
