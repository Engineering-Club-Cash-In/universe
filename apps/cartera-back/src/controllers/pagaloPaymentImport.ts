import {
  PAGALO_IMPORT_ERROR_CODES,
  validatePagaloImportCommand,
  verificarPagaloPayloadHash,
  type PagaloImportCommand,
} from "./pagaloPaymentImportPolicy";
import Big from "big.js";
import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "../database";
import {
  creditos,
  cuentasEmpresa,
  moras_credito,
  pagalo_payment_imports,
  pagos_credito,
	cuotas_credito,
} from "../database/db";
import type { PagaloFacturaStatus, PagaloReciboStatus } from "../database/db/schema";
import { facturarPagoCompleto } from "../routers/cofidi";
import { enviarRecibosPagoDeCreditoBestEffort } from "../services/reciboPagoWhatsapp";
import { updateMoraEnTx } from "./latefee";
import {
  aplicarPagoNormalEnTx,
  evaluarPagoParaAplicar,
  procesarRegistroPago,
} from "./registerPayment";
import type { AplicarPagoTx, PagaloComponentes } from "./registerPayment";
import { CREDIT_PENDING_CANCELLATION_ERROR } from "./registerPaymentPolicy";
import { fueraDeLocksHeredados, withPaymentAdvisoryLock } from "../utils/paymentAdvisoryLock";

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
	otros: number;
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
		otros: Number(command.otros_total),
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

/**
 * `Otros` es un cargo de la cuota inicial auditada, no un saldo genérico del
 * crédito. Si esa cuota ya cambió antes de importar, no se puede mover a la
 * siguiente sin contradecir el snapshot firmado por Págalo.
 */
export function esCuotaInicialPagaloVigente(
	command: PagaloImportCommand,
	cuotaInicialVivaId: number | undefined,
): boolean {
	if (new Big(command.otros_total).eq(0)) return true;
	const otros = command.allocations.find(
		(allocation) =>
			allocation.numero_cuota === command.cuota_inicial &&
			allocation.rubro === "OTROS",
	);
	return otros?.cartera_cuota_id === cuotaInicialVivaId;
}

/** Misma regla de duplicados que CRM: la fila con mayor pago_id prevalece. */
export function resolverCuotaInicialPagaloVigente(
	cuotas: { cuotaId: number; pagoId: number }[],
): number | undefined {
	return cuotas.reduce<{ cuotaId: number; pagoId: number } | undefined>(
		(actual, cuota) => (!actual || cuota.pagoId > actual.pagoId ? cuota : actual),
		undefined,
	)?.cuotaId;
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

async function asegurarCuotaInicialPagaloVigente(
	tx: any,
	command: PagaloImportCommand,
): Promise<void> {
	if (new Big(command.otros_total).eq(0)) return;
	const cuotasInicialesVivas = await tx
		.select({
			cuotaId: cuotas_credito.cuota_id,
			pagoId: pagos_credito.pago_id,
		})
		.from(cuotas_credito)
		.innerJoin(
			pagos_credito,
			eq(pagos_credito.cuota_id, cuotas_credito.cuota_id),
		)
		.where(
			and(
				eq(cuotas_credito.credito_id, command.credito_id),
				eq(cuotas_credito.numero_cuota, command.cuota_inicial),
				eq(cuotas_credito.pagado, false),
			),
		)
		.orderBy(desc(pagos_credito.pago_id))
		.for("update");
	if (
		!esCuotaInicialPagaloVigente(
			command,
			resolverCuotaInicialPagaloVigente(cuotasInicialesVivas),
		)
	) {
		throw new Error(
			`${REVIEW_REQUIRED_PREFIX} La cuota inicial auditada de Otros ya no es la cuota pagable actual.`,
		);
	}
}

/**
 * Cuenta de empresa virtual de los pagos con link (la siembra la migración
 * 0012). Se resuelve por `numero_cuenta`, que es UNIQUE — el nombre se puede
 * editar desde la pantalla de cuentas y no es único.
 */
export const PAGALO_CUENTA_EMPRESA_NUMERO = "PAGALO-LINK";

/**
 * Los pagos Págalo nacen con su cuenta de empresa puesta (lo que en el front
 * hace "Seleccionar Cuenta de Empresa" antes de poder validar). Sin la cuenta
 * NO es un caso de revisión: es config faltante → 500, rollback, y el CRM
 * reintenta cuando exista.
 */
async function asignarCuentaPagalo(tx: any, pagoIds: number[]) {
  const [cuenta] = await tx
    .select({ cuentaId: cuentasEmpresa.cuentaId })
    .from(cuentasEmpresa)
    .where(
      and(
        eq(cuentasEmpresa.numeroCuenta, PAGALO_CUENTA_EMPRESA_NUMERO),
        eq(cuentasEmpresa.activo, true),
      ),
    )
    .limit(1);
  if (!cuenta) {
    throw new Error(
      `Falta la cuenta de empresa ${PAGALO_CUENTA_EMPRESA_NUMERO} activa en cuentas_empresa (migración 0012).`,
    );
  }
  const asignados: { pago_id: number }[] = await tx
    .update(pagos_credito)
    .set({ cuenta_empresa_id: cuenta.cuentaId })
    .where(inArray(pagos_credito.pago_id, pagoIds))
    .returning({ pago_id: pagos_credito.pago_id });
  if (asignados.length !== pagoIds.length) {
    throw new Error(
      `${REVIEW_REQUIRED_PREFIX} Se esperaban ${pagoIds.length} pagos y se encontraron ${asignados.length} al asignar la cuenta.`,
    );
  }
}

/**
 * Valida el pago dentro de la MISMA tx del registro con la función del botón
 * "Validar Pago" (`aplicarPagoNormalEnTx`: cierre de cuota, capital/deuda,
 * limpieza de restantes, inversionistas) y los MISMOS guards previos
 * (`evaluarPagoParaAplicar`). No se usa `aplicarPagoAlCredito` porque abre su
 * propio lock y su propia transacción. Se relee la fila justo antes: la
 * validación de un pago anterior del mismo import pudo tocarla.
 */
async function validarPagoEnTx(tx: any, pagoId: number) {
  const [pago] = await tx
    .select()
    .from(pagos_credito)
    .where(eq(pagos_credito.pago_id, pagoId))
    .limit(1);
  if (!pago) throw new Error(`${REVIEW_REQUIRED_PREFIX} Pago ${pagoId} no encontrado tras registrarlo.`);

  const evaluacion = evaluarPagoParaAplicar(pago, pagoId);
  switch (evaluacion.accion) {
    case "rechazar":
      throw new Error(`${REVIEW_REQUIRED_PREFIX} ${evaluacion.resultado.message}`);
    case "capital":
      // Hoy el import no manda abono_directo_capital (un solo pago con el
      // total). Si algún día lo hace, ese pago se aplica con
      // applyCapitalPaymentAndBuildResponse, que no acepta tx: revisión
      // explícita en vez de validar a medias.
      throw new Error(
        `${REVIEW_REQUIRED_PREFIX} El pago ${pagoId} nació como abono a capital (validationStatus="capital"); el import Págalo aún no lo aplica automáticamente.`,
      );
    case "reset":
      throw new Error(
        `${REVIEW_REQUIRED_PREFIX} El pago ${pagoId} nació con validationStatus="reset"; no se valida automáticamente.`,
      );
    case "normal":
      break;
  }
  const resultado = await aplicarPagoNormalEnTx(tx as AplicarPagoTx, pago, pagoId);
  if (!resultado.success) {
    throw new Error(`${REVIEW_REQUIRED_PREFIX} ${resultado.message}`);
  }
}

export type ResultadoFacturaPago = {
  pago_id: number;
  success: boolean;
  /** Status HTTP que hubiera dado el endpoint: 400 = determinista (NIT, %),
   *  500 = SAT/transitorio. Sirve para decidir si reintentar. */
  http: number;
  /** Facturas individuales que fallaron (si la respuesta las trae). */
  errores: Array<{ tipo?: string; error?: string }>;
  /** Cuántas facturas ACTIVAS ya tenía el pago (lo facturó otro flujo antes). */
  yaFacturado?: number;
  detalle?: string;
};

export type RespuestaFacturarPagoCompleto = {
  success?: boolean;
  message?: string;
  error?: string;
  mensaje?: string;
  errores?: Array<{ tipo?: string; error?: string }>;
  facturasExistentes?: unknown[];
  data?: { errores?: Array<{ tipo?: string; error?: string }> };
};

/**
 * Traduce la respuesta HTTP-shaped de `facturarPagoCompleto` a dato.
 * - "Ya tiene facturas activas" NO es un fallo: otro flujo (p. ej. "Generar
 *   Factura" a mano, que ganó el lock antes) ya certificó este pago; se cuenta
 *   como facturado y se anota cuántas había (hallazgo Codex). El pre-check es
 *   por pago, así que si el manual quedó parcial lo muestra su propia
 *   respuesta al humano, no este ledger.
 * - "No se pudo generar ninguna factura" trae `errores` arriba; el parcial los
 *   trae en `data.errores`.
 */
export function clasificarRespuestaFacturacion(
  pagoId: number,
  r: RespuestaFacturarPagoCompleto,
  http: number,
): ResultadoFacturaPago {
  if (r.success !== true && Array.isArray(r.facturasExistentes) && r.facturasExistentes.length > 0) {
    return {
      pago_id: pagoId,
      success: true,
      http: 200,
      errores: [],
      yaFacturado: r.facturasExistentes.length,
      detalle: `Ya facturado por otro flujo (${r.facturasExistentes.length} factura(s) ACTIVA(s))`,
    };
  }
  const errores = r.errores ?? r.data?.errores ?? [];
  return {
    pago_id: pagoId,
    success: r.success === true,
    http,
    errores,
    detalle: r.success ? (errores.length ? r.mensaje : undefined) : (r.message ?? r.error),
  };
}

/**
 * Un estado por import a partir de lo que devolvió la facturación de cada
 * pago. `error` es JSON con los pagos problemáticos (pago_id, http, errores),
 * para que el playbook sepa qué pago tiene cero facturas (reintento seguro)
 * y cuál quedó a medias (revisar antes de reintentar).
 */
export function resumirFacturacion(
  resultados: ResultadoFacturaPago[],
): { status: PagaloFacturaStatus; error: string | null } {
  const fallidas = resultados.filter((r) => !r.success);
  const parciales = resultados.filter((r) => r.success && r.errores.length > 0);
  // FALLIDA manda, pero el detalle conserva TAMBIÉN los parciales: el
  // playbook necesita saber qué pago ya tiene DTE a medias (no reintentar a
  // ciegas) y cuál tiene cero (hallazgo Codex).
  if (fallidas.length) return { status: "FALLIDA", error: JSON.stringify([...fallidas, ...parciales]) };
  if (parciales.length) return { status: "PARCIAL", error: JSON.stringify(parciales) };
  return { status: "OK", error: null };
}

/** Facturar un pago del import, traduciendo la respuesta HTTP-shaped a dato. */
async function facturarPagoDeImport(pagoId: number): Promise<ResultadoFacturaPago> {
  // El lock del crédito ya se soltó: si conta revirtió el pago en la ventana
  // (segundos), no se certifica nada en SAT para un pago que ya no existe.
  const [vivo] = await db
    .select({ validationStatus: pagos_credito.validationStatus, paymentFalse: pagos_credito.paymentFalse })
    .from(pagos_credito)
    .where(eq(pagos_credito.pago_id, pagoId))
    .limit(1);
  if (!vivo || vivo.paymentFalse || vivo.validationStatus !== "validated") {
    return {
      pago_id: pagoId,
      success: false,
      http: 409,
      errores: [],
      detalle: `El pago ya no está validado (status=${vivo?.validationStatus ?? "inexistente"}, paymentFalse=${vivo?.paymentFalse ?? "-"}); no se factura.`,
    };
  }
  try {
    const set: { status?: number | string } = {};
    const r = (await facturarPagoCompleto({ body: { pago_id: pagoId }, set })) as RespuestaFacturarPagoCompleto;
    const resultado = clasificarRespuestaFacturacion(pagoId, r, typeof set.status === "number" ? set.status : 200);
    if (resultado.yaFacturado) {
      console.log(`ℹ️ Págalo pago ${pagoId}: ${resultado.detalle}; no se certifica de nuevo.`);
    }
    return resultado;
  } catch (error) {
    return {
      pago_id: pagoId,
      success: false,
      http: 500,
      errores: [],
      detalle: error instanceof Error ? error.message : String(error),
    };
  }
}

async function guardarEstadoFactura(
  importId: number,
  resumen: { status: PagaloFacturaStatus; error: string | null },
) {
  try {
    await db
      .update(pagalo_payment_imports)
      .set({
        factura_status: resumen.status,
        factura_error: resumen.error,
        factura_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(pagalo_payment_imports.id, importId));
  } catch (error) {
    console.error(`⚠️ Págalo import ${importId}: no se pudo guardar factura_status`, error);
  }
  if (resumen.status !== "OK") {
    console.error(`⚠️ Págalo import ${importId}: facturación ${resumen.status} — ${resumen.error}`);
  }
}

/**
 * Factura cada pago del import y deja el resultado en el ledger. Corre bajo
 * el advisory lock del crédito (el mismo de registrar/validar y de
 * `reversePayment`): así el re-chequeo "¿sigue validated?" de cada pago y la
 * certificación no se cruzan con una reversión — o la reversión termina antes
 * y acá no se factura, o espera y encuentra el DTE ACTIVA para anularlo
 * (hallazgo Codex). Nunca lanza.
 */
async function facturarImport(importId: number, creditoId: number, pagoIds: number[]) {
  try {
    return await withPaymentAdvisoryLock(creditoId, async () => {
      const resultados: ResultadoFacturaPago[] = [];
      for (const pagoId of pagoIds) resultados.push(await facturarPagoDeImport(pagoId));
      const resumen = resumirFacturacion(resultados);
      await guardarEstadoFactura(importId, resumen);
      return resumen;
    });
  } catch (error) {
    // Falló antes de facturar (p. ej. la DB se cayó en el re-chequeo): que
    // quede en el ledger y no como PENDIENTE mudo.
    const detalle = error instanceof Error ? error.message : String(error);
    const resumen = { status: "FALLIDA" as const, error: JSON.stringify([{ motivo: detalle }]) };
    await guardarEstadoFactura(importId, resumen);
    return resumen;
  }
}

/**
 * Gate de la facturación automática post-commit. Solo factura con
 * `PAGALO_FACTURACION_ACTIVA=true`; ausente o cualquier otro valor → se omite
 * (el pago igual nace validado y el recibo igual sale). Existe porque hoy no
 * hay SAT de pruebas separado: mientras esto esté en pruebas, cualquier
 * ambiente sin la env NO certifica nada real (decisión de Daniel 2026-08-27).
 */
export function facturacionPagaloActiva(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.PAGALO_FACTURACION_ACTIVA ?? "").trim().toLowerCase() === "true";
}

/** Un claim ENVIANDO más viejo que esto es de un proceso que murió: se puede retomar. */
export const MINUTOS_RECIBO_ENVIANDO_HUERFANO = 30;
/** Un FALLIDA se reintenta pasado este tiempo, hasta MAXIMO_INTENTOS_RECIBO. */
export const MINUTOS_RECIBO_FALLIDA_REINTENTO = 30;
export const MAXIMO_INTENTOS_RECIBO = 5;

/** Pagos del import a los que todavía no les salió el recibo. */
export function pagosSinRecibo(pagoIds: number[], reciboPagosOk: string | null): number[] {
  let ok: number[] = [];
  try {
    const parsed = reciboPagosOk ? JSON.parse(reciboPagosOk) : [];
    if (Array.isArray(parsed)) ok = parsed.filter((n): n is number => typeof n === "number");
  } catch {}
  return pagoIds.filter((id) => !ok.includes(id));
}

/**
 * Outbox mínimo del recibo por WhatsApp. Claim atómico (PENDIENTE → ENVIANDO;
 * ENVIANDO viejo de un proceso muerto; o FALLIDA con reintentos disponibles),
 * envío SOLO a los pagos que aún no tienen recibo, y OK/FALLIDA. Quien no
 * gana el claim no manda nada, así que lo pueden llamar a la vez el
 * post-commit, un replay del dispatcher y el barrido sin duplicar el mensaje
 * (hallazgos Codex: si cartera moría entre el commit y el envío el cliente se
 * quedaba sin recibo; y una caída transitoria de PDF/CRM no puede dejarlo
 * varado). Un recibo duplicado por una carrera extrema es inocuo; uno que
 * nunca sale, no. Nunca lanza.
 */
export async function intentarEnviarRecibosDeImport(importId: number): Promise<PagaloReciboStatus | "SIN_CLAIM"> {
  const ahora = Date.now();
  const limiteEnviando = new Date(ahora - MINUTOS_RECIBO_ENVIANDO_HUERFANO * 60 * 1000);
  const limiteFallida = new Date(ahora - MINUTOS_RECIBO_FALLIDA_REINTENTO * 60 * 1000);
  /** Generación de ESTE intento (recibo_intentos tras el claim); undefined = no llegó a reclamar. */
  let generacion: number | undefined;
  try {
    const [claim] = await db
      .update(pagalo_payment_imports)
      .set({
        recibo_status: "ENVIANDO",
        recibo_at: new Date(),
        recibo_intentos: sql`${pagalo_payment_imports.recibo_intentos} + 1`,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(pagalo_payment_imports.id, importId),
          eq(pagalo_payment_imports.status, "APPLIED"),
          or(
            eq(pagalo_payment_imports.recibo_status, "PENDIENTE"),
            and(
              eq(pagalo_payment_imports.recibo_status, "ENVIANDO"),
              lt(pagalo_payment_imports.recibo_at, limiteEnviando),
            ),
            and(
              eq(pagalo_payment_imports.recibo_status, "FALLIDA"),
              lt(pagalo_payment_imports.recibo_at, limiteFallida),
              lt(pagalo_payment_imports.recibo_intentos, MAXIMO_INTENTOS_RECIBO),
            ),
          ),
        ),
      )
      .returning({
        credito_id: pagalo_payment_imports.credito_id,
        recibo_pagos_ok: pagalo_payment_imports.recibo_pagos_ok,
        intentos: pagalo_payment_imports.recibo_intentos,
      });
    if (!claim) return "SIN_CLAIM";
    generacion = claim.intentos;
    if (claim.credito_id === null) throw new Error("import sin crédito vivo");

    const pagoIds: number[] = await paymentIdsForImport(db, importId);
    const pendientes = pagosSinRecibo(pagoIds, claim.recibo_pagos_ok);
    const yaOk = pagoIds.filter((id) => !pendientes.includes(id));
    const resultados = await enviarRecibosPagoDeCreditoBestEffort({
      creditoId: claim.credito_id,
      pagoIds: pendientes,
    });
    const nuevosOk = pendientes.filter((_, i) => resultados[i]?.success === true);
    const todosOk = [...yaOk, ...nuevosOk];
    const status: PagaloReciboStatus = todosOk.length === pagoIds.length ? "OK" : "FALLIDA";
    // Guardado por GENERACIÓN: `recibo_intentos` del claim identifica este
    // intento. Si el barrido ya reclamó el import (ENVIANDO > 30 min) y otro
    // intento lo cerró, este worker viejo no debe pisar su OK ni su
    // `recibo_pagos_ok` (hallazgo Codex): la actualización no matchea y se
    // ignora.
    const [cerrado] = await db
      .update(pagalo_payment_imports)
      .set({
        recibo_status: status,
        recibo_at: new Date(),
        recibo_pagos_ok: JSON.stringify(todosOk),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(pagalo_payment_imports.id, importId),
          eq(pagalo_payment_imports.recibo_status, "ENVIANDO"),
          eq(pagalo_payment_imports.recibo_intentos, claim.intentos),
        ),
      )
      .returning({ id: pagalo_payment_imports.id });
    if (!cerrado) {
      console.warn(`⚠️ Págalo import ${importId}: el intento ${claim.intentos} del recibo fue reclamado por otro; se ignora su resultado.`);
      return "SIN_CLAIM";
    }
    if (status !== "OK") {
      console.error(
        `⚠️ Págalo import ${importId}: recibo por WhatsApp FALLIDA (intento ${claim.intentos}/${MAXIMO_INTENTOS_RECIBO}, faltan pagos ${pendientes.filter((id) => !nuevosOk.includes(id)).join(",")})`,
      );
    }
    return status;
  } catch (error) {
    console.error(`⚠️ Págalo import ${importId}: no se pudo enviar/registrar el recibo`, error);
    if (generacion === undefined) return "FALLIDA"; // falló antes de reclamar: no hay claim que cerrar
    try {
      // Solo si este intento sigue siendo el dueño del claim (misma generación).
      await db
        .update(pagalo_payment_imports)
        .set({ recibo_status: "FALLIDA", recibo_at: new Date(), updated_at: new Date() })
        .where(
          and(
            eq(pagalo_payment_imports.id, importId),
            eq(pagalo_payment_imports.recibo_status, "ENVIANDO"),
            eq(pagalo_payment_imports.recibo_intentos, generacion),
          ),
        );
    } catch {}
    return "FALLIDA";
  }
}

/**
 * Post-commit, fire-and-forget: SAT y WhatsApp son irreversibles, así que
 * corren solo cuando el pago ya quedó validado y confirmado. Mismo patrón que
 * `/aplicar-pago` (recibo) y "Validar y Facturar" del front (segunda
 * llamada). Nunca lanza. El recibo es el de pago, no de la factura: se manda
 * igual que cuando conta valida a mano (uno por pago del grupo) y de forma
 * INDEPENDIENTE de la facturación — si esta se traba o falla, el recibo sale
 * igual (hallazgo Codex). Se lanza FUERA del lock del import (ver
 * `fueraDeLocksHeredados`): `facturarImport` toma el suyo.
 */
async function facturarYNotificarPostCommit(
  importId: number,
  creditoId: number,
  pagoIds: number[],
) {
  if (!facturacionPagaloActiva()) {
    console.log(
      `ℹ️ Págalo import ${importId}: facturación OMITIDA (PAGALO_FACTURACION_ACTIVA no es "true"); solo se manda el recibo.`,
    );
    await intentarEnviarRecibosDeImport(importId);
    return;
  }
  await Promise.allSettled([
    facturarImport(importId, creditoId, pagoIds),
    intentarEnviarRecibosDeImport(importId),
  ]);
}

/** Minutos tras `applied_at` a partir de los cuales un PENDIENTE se considera huérfano. */
export const MINUTOS_FACTURA_PENDIENTE_HUERFANA = 10;

export const MOTIVO_FACTURA_HUERFANA =
  "Facturación interrumpida (cartera murió entre el commit y SAT). NO se reintenta sola: verificar en SAT/COFIDI qué DTE existen antes de facturar a mano (playbook facturas no en SAT).";

/**
 * Barrido programado (schedule.ts): un import APPLIED cuya facturación quedó
 * en PENDIENTE más de N minutos es que cartera murió/redeployó entre el commit
 * y SAT. Solo lo MARCA como FALLIDA para que entre al playbook; jamás vuelve a
 * certificar: "no hay factura ACTIVA en la DB" no prueba que no exista en SAT
 * (el proceso pudo morir entre `generarYCertificarDTE` y el insert en
 * `facturas_electronicas`), y SAT no tiene idempotencia de nuestro lado
 * (hallazgo Codex; la idempotencia se descartó en #1282). El UPDATE es
 * condicional y atómico: si dos réplicas corren a la vez, solo una marca cada
 * fila, y marcar dos veces sería inocuo de todos modos.
 */
export async function reintentarFacturacionPagaloPendiente(
  minutos = MINUTOS_FACTURA_PENDIENTE_HUERFANA,
) {
  const limite = new Date(Date.now() - minutos * 60 * 1000);
  const marcados: { id: number }[] = await db
    .update(pagalo_payment_imports)
    .set({
      factura_status: "FALLIDA",
      factura_error: JSON.stringify([{ motivo: MOTIVO_FACTURA_HUERFANA }]),
      factura_at: new Date(),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(pagalo_payment_imports.status, "APPLIED"),
        eq(pagalo_payment_imports.factura_status, "PENDIENTE"),
        lt(pagalo_payment_imports.applied_at, limite),
      ),
    )
    .returning({ id: pagalo_payment_imports.id });
  for (const { id } of marcados) {
    console.error(`⚠️ Págalo import ${id}: ${MOTIVO_FACTURA_HUERFANA}`);
  }

  // Recibos que no salieron (PENDIENTE viejo, ENVIANDO de un proceso muerto,
  // o FALLIDA con reintentos): a diferencia de SAT, reintentar un WhatsApp
  // sí es seguro, y solo va a los pagos que aún no lo recibieron.
  const limiteEnviando = new Date(Date.now() - MINUTOS_RECIBO_ENVIANDO_HUERFANO * 60 * 1000);
  const limiteFallida = new Date(Date.now() - MINUTOS_RECIBO_FALLIDA_REINTENTO * 60 * 1000);
  const recibosHuerfanos: { id: number }[] = await db
    .select({ id: pagalo_payment_imports.id })
    .from(pagalo_payment_imports)
    .where(
      and(
        eq(pagalo_payment_imports.status, "APPLIED"),
        or(
          and(eq(pagalo_payment_imports.recibo_status, "PENDIENTE"), lt(pagalo_payment_imports.applied_at, limite)),
          and(eq(pagalo_payment_imports.recibo_status, "ENVIANDO"), lt(pagalo_payment_imports.recibo_at, limiteEnviando)),
          and(
            eq(pagalo_payment_imports.recibo_status, "FALLIDA"),
            lt(pagalo_payment_imports.recibo_at, limiteFallida),
            lt(pagalo_payment_imports.recibo_intentos, MAXIMO_INTENTOS_RECIBO),
          ),
        ),
      ),
    );
  let recibosReenviados = 0;
  for (const { id } of recibosHuerfanos) {
    if ((await intentarEnviarRecibosDeImport(id)) !== "SIN_CLAIM") recibosReenviados++;
  }
  return { huerfanos: marcados.length, ids: marcados.map((m) => m.id), recibosReenviados };
}

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
      .orderBy(asc(pagos_credito.pago_id))
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
  otros_total: command.otros_total,
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

  const respuesta = await withPaymentAdvisoryLock(command.credito_id, async () => {
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
      const aplicado = await db.transaction(async (tx) => {
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

		await asegurarCuotaInicialPagaloVigente(tx, command);

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

        // D-10 v2 / D-50 v2: el pago Págalo NACE VALIDADO. Todo lo que es DB
        // — cuenta de empresa, validación (cierre de cuota, capital, restantes,
        // inversionistas) y la reposición de la mora — va en ESTA tx: si algo
        // falla se hace rollback completo, el ledger no queda APPLIED y el
        // CRM reintenta. La factura (SAT) y el recibo (WhatsApp) son
        // irreversibles y corren después del commit.
        await asignarCuentaPagalo(tx, paymentIds);
        for (const pagoId of paymentIds) await validarPagoEnTx(tx, pagoId);
        if (reponerMora) await reponerMora();

        await tx
          .update(pagalo_payment_imports)
          .set({
            status: "APPLIED",
            applied_at: new Date(),
            // NULL = "no aplica" cuando la facturación automática está
            // apagada: así el barrido no lo confunde con un PENDIENTE huérfano.
            factura_status: facturacionPagaloActiva() ? "PENDIENTE" : null,
            recibo_status: "PENDIENTE",
            updated_at: new Date(),
          })
          .where(eq(pagalo_payment_imports.id, ledger.id));
        return {
          success: true,
          status: "APPLIED",
          import_id: ledger.id,
          payment_ids: paymentIds,
          idempotent_replay: false,
        };
      });
      return aplicado;
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

  // Post-commit FUERA del lock del import y con el contexto de locks limpio:
  // si se lanzara adentro, heredaría el lock por AsyncLocalStorage, no
  // tomaría el suyo y seguiría certificando después de que este callback lo
  // soltó (hallazgo Codex). Un replay APPLIED solo reanuda el recibo (el
  // claim evita duplicarlo); la factura nunca se reanuda sola (SAT no es
  // idempotente).
  if (
    respuesta.success === true &&
    respuesta.status === "APPLIED" &&
    "import_id" in respuesta &&
    typeof respuesta.import_id === "number"
  ) {
    const importId = respuesta.import_id;
    const esReplay = "idempotent_replay" in respuesta && respuesta.idempotent_replay === true;
    const pagoIds = "payment_ids" in respuesta && Array.isArray(respuesta.payment_ids) ? respuesta.payment_ids : [];
    void fueraDeLocksHeredados(async () => {
      if (esReplay) await intentarEnviarRecibosDeImport(importId);
      else await facturarYNotificarPostCommit(importId, command.credito_id, pagoIds);
    }).catch((error) => console.error(`⚠️ Págalo import ${importId}: post-commit falló`, error));
  }
  return respuesta;
};
