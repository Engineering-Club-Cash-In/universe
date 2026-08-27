import Big from "big.js";
import { createHash } from "node:crypto";
import { z } from "zod";

// FASE 1 — Códigos estables que el endpoint podrá devolver al CRM sin exponer
// detalles internos de Zod, SQL, vouchers o transacciones.
export const PAGALO_IMPORT_ERROR_CODES = {
  PAGALO_INVALID_COMMAND: "PAGALO_INVALID_COMMAND",
  PAGALO_INVALID_VOUCHER_KEY: "PAGALO_INVALID_VOUCHER_KEY",
  PAGALO_TOTAL_MISMATCH: "PAGALO_TOTAL_MISMATCH",
  PAGALO_CAPITAL_SOURCE_FORBIDDEN: "PAGALO_CAPITAL_SOURCE_FORBIDDEN",
  PAGALO_CAPITAL_SOURCE_REQUIRED: "PAGALO_CAPITAL_SOURCE_REQUIRED",
  PAGALO_CAPITAL_ALLOCATIONS_FORBIDDEN: "PAGALO_CAPITAL_ALLOCATIONS_FORBIDDEN",
  PAGALO_CAPITAL_ALLOCATIONS_MISMATCH: "PAGALO_CAPITAL_ALLOCATIONS_MISMATCH",
  PAGALO_CAPITAL_ALLOCATION_FACTURABLE: "PAGALO_CAPITAL_ALLOCATION_FACTURABLE",
  PAGALO_FACTURABLE_SOURCE_FORBIDDEN: "PAGALO_FACTURABLE_SOURCE_FORBIDDEN",
  PAGALO_FACTURABLE_SOURCE_REQUIRED: "PAGALO_FACTURABLE_SOURCE_REQUIRED",
  PAGALO_FACTURABLE_ALLOCATIONS_FORBIDDEN:
    "PAGALO_FACTURABLE_ALLOCATIONS_FORBIDDEN",
  PAGALO_FACTURABLE_ALLOCATIONS_MISMATCH:
    "PAGALO_FACTURABLE_ALLOCATIONS_MISMATCH",
  PAGALO_FACTURABLE_ALLOCATION_NOT_FACTURABLE:
    "PAGALO_FACTURABLE_ALLOCATION_NOT_FACTURABLE",
  PAGALO_OTROS_ALLOCATION_MISMATCH: "PAGALO_OTROS_ALLOCATION_MISMATCH",
  PAGALO_OTROS_ALLOCATION_INVALID: "PAGALO_OTROS_ALLOCATION_INVALID",
  PAGALO_DUPLICATE_ALLOCATION: "PAGALO_DUPLICATE_ALLOCATION",
  PAGALO_ALLOCATION_CUOTA_CONFLICT: "PAGALO_ALLOCATION_CUOTA_CONFLICT",
  PAGALO_CUOTA_INICIAL_MISMATCH: "PAGALO_CUOTA_INICIAL_MISMATCH",
  PAGALO_DUPLICATE_TRANSACTION_UUID: "PAGALO_DUPLICATE_TRANSACTION_UUID",
  PAGALO_DUPLICATE_EXTERNAL_IDENTIFIER: "PAGALO_DUPLICATE_EXTERNAL_IDENTIFIER",
  PAGALO_DUPLICATE_VOUCHER_KEY: "PAGALO_DUPLICATE_VOUCHER_KEY",
  PAGALO_INVALID_CAPITAL_RUBRO: "PAGALO_INVALID_CAPITAL_RUBRO",
  PAGALO_INVALID_FACTURABLE_RUBRO: "PAGALO_INVALID_FACTURABLE_RUBRO",
  PAGALO_PAYLOAD_HASH_MISMATCH: "PAGALO_PAYLOAD_HASH_MISMATCH",
} as const;

export type PagaloImportErrorCode =
  (typeof PAGALO_IMPORT_ERROR_CODES)[keyof typeof PAGALO_IMPORT_ERROR_CODES];
export const PAGALO_IMPORT_ERROR_MESSAGES: Record<
  PagaloImportErrorCode,
  string
> = {
  PAGALO_INVALID_COMMAND:
    "El comando de importación Págalo no tiene la forma requerida.",
  PAGALO_INVALID_VOUCHER_KEY: "La llave del comprobante Págalo no es válida.",
  PAGALO_TOTAL_MISMATCH: "El total no coincide con capital más facturable.",
  PAGALO_CAPITAL_SOURCE_FORBIDDEN:
    "Un pago sin capital no puede incluir evidencia de CAPITAL.",
  PAGALO_CAPITAL_SOURCE_REQUIRED:
    "Un pago con capital requiere evidencia de CAPITAL.",
  PAGALO_CAPITAL_ALLOCATIONS_FORBIDDEN:
    "Un pago sin capital no puede incluir asignaciones CAPITAL.",
  PAGALO_CAPITAL_ALLOCATIONS_MISMATCH:
    "Las asignaciones CAPITAL no coinciden con el total de capital.",
  PAGALO_CAPITAL_ALLOCATION_FACTURABLE:
    "Las asignaciones CAPITAL deben ser no facturables.",
  PAGALO_FACTURABLE_SOURCE_FORBIDDEN:
    "Un pago sin monto facturable no puede incluir evidencia MORA_INTERES.",
  PAGALO_FACTURABLE_SOURCE_REQUIRED:
    "Un pago facturable requiere evidencia MORA_INTERES.",
  PAGALO_FACTURABLE_ALLOCATIONS_FORBIDDEN:
    "Un pago sin monto facturable no puede incluir asignaciones MORA_INTERES.",
  PAGALO_FACTURABLE_ALLOCATIONS_MISMATCH:
    "Las asignaciones MORA_INTERES no coinciden con el total facturable.",
  PAGALO_FACTURABLE_ALLOCATION_NOT_FACTURABLE:
    "Las asignaciones MORA_INTERES deben ser facturables.",
  PAGALO_OTROS_ALLOCATION_MISMATCH:
    "Las asignaciones OTROS no coinciden con el total de Otros.",
  PAGALO_OTROS_ALLOCATION_INVALID:
    "Otros debe ser facturable y pertenecer a MORA_INTERES.",
  PAGALO_DUPLICATE_ALLOCATION:
    "No se permiten asignaciones repetidas para la misma cuota, rubro y tipo.",
  PAGALO_ALLOCATION_CUOTA_CONFLICT:
    "Una cuota de cartera no puede mapearse a cuotas de pago inconsistentes.",
  PAGALO_CUOTA_INICIAL_MISMATCH:
    "La cuota inicial debe ser la menor cuota asignada.",
  PAGALO_DUPLICATE_TRANSACTION_UUID:
    "Las fuentes CAPITAL y MORA_INTERES no pueden reutilizar transaction_uuid.",
  PAGALO_DUPLICATE_EXTERNAL_IDENTIFIER:
    "Las fuentes CAPITAL y MORA_INTERES no pueden reutilizar external_identifier.",
  PAGALO_DUPLICATE_VOUCHER_KEY:
    "Las fuentes CAPITAL y MORA_INTERES no pueden reutilizar voucher_storage_key.",
  PAGALO_INVALID_CAPITAL_RUBRO:
    "Las asignaciones CAPITAL deben usar rubro CAPITAL.",
  PAGALO_INVALID_FACTURABLE_RUBRO:
    "Las asignaciones MORA_INTERES no pueden usar rubro CAPITAL.",
  PAGALO_PAYLOAD_HASH_MISMATCH:
    "El payload_hash no corresponde al contenido del comando Págalo.",
};

const moneyText = /^\d+(?:\.\d{1,2})?$/;

// FASE 2 — Tipos de entrada estrictos. Antes de crear Big.js se descartan
// exponentes, Infinity, montos negativos/imprecisos y valores fuera de
// numeric(18,2). El resultado siempre queda normalizado a centavos.
const money = (minimum: "zero" | "positive") =>
  z.union([z.string(), z.number()]).transform((value, ctx) => {
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected finite money.",
      });
      return z.NEVER;
    }
    const text = typeof value === "string" ? value.trim() : String(value);
    const integerDigits = text.split(".")[0].replace(/^0+/, "").length || 1;
    if (!moneyText.test(text) || integerDigits > 16) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected numeric(18,2) money.",
      });
      return z.NEVER;
    }
    const amount = new Big(text);
    const normalized = amount.toFixed(2);
    // El motor normal de pagos aún recibe `number`. Rechazamos cualquier
    // decimal que no sobreviva esa conversión exactamente, incluso si llega
    // como string y cabe en numeric(18,2).
    const engineAmount = Number(normalized);
    if (
      amount.times(100).gt(Number.MAX_SAFE_INTEGER) ||
      !new Big(engineAmount).eq(amount) ||
      (minimum === "positive" && amount.lte(0))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected numeric(18,2) money.",
      });
      return z.NEVER;
    }
    return normalized;
  });

const sourceSchema = z
  .object({
    transaction_uuid: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
    external_identifier: z.string().trim().min(1).max(150),
    request_id: z.string().max(100).optional(),
    request_auth: z.string().max(100).optional(),
    paid_at: z
      .string()
      .datetime({ offset: true })
      .refine((v) => !Number.isNaN(Date.parse(v))),
    // Reserve headroom for URL_PUBLIC_R2 before persisting boletas.url_boleta
    // (varchar(255)); the service still validates the assembled final URL.
    voucher_storage_key: z.string().max(160),
  })
  .strict();

// Cada allocation es evidencia de cómo se distribuye un link. `link_type`
// separa CAPITAL de MORA_INTERES; las invariantes de negocio se validan abajo.
const allocationSchema = z
  .object({
    link_type: z.enum(["CAPITAL", "MORA_INTERES"]),
    cartera_cuota_id: z.number().int().positive().max(2147483647),
    numero_cuota: z.number().int().positive().max(2147483647),
    rubro: z.enum([
      "CAPITAL",
      "INTERES",
      "IVA",
      "INTERES_CI",
      "IVA_CI",
      "SEGURO",
      "GPS",
      "MEMBRESIAS",
      "MORA",
      "OTROS",
    ]),
    amount: money("positive"),
    facturable: z.boolean(),
  })
  .strict();

// FASE 3 — Forma pública completa del comando. `.strict()` evita que un
// consumidor inyecte campos no auditados (headers, tokens o datos de tarjeta).
export const pagaloImportCommandSchema = z
  .object({
    crm_group_id: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
    credito_id: z.number().int().positive().max(2147483647),
    numero_credito_sifco: z.string().trim().min(1).max(40),
    currency: z.literal("GTQ"),
    capital_total: money("zero"),
    facturable_total: money("zero"),
    otros_total: money("zero").default("0.00"),
    total_amount: money("positive"),
    cuota_inicial: z.number().int().positive().max(2147483647),
    allocations: z.array(allocationSchema).min(1),
    capital: sourceSchema.nullable(),
    facturable: sourceSchema.nullable(),
    payload_hash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type PagaloImportCommand = z.infer<typeof pagaloImportCommandSchema>;
export type PagaloImportValidationError = {
  code: PagaloImportErrorCode;
  message: string;
};
export type PagaloImportValidationResult =
  | { success: true; data: PagaloImportCommand }
  | { success: false; errors: PagaloImportValidationError[] };
const err = (code: PagaloImportErrorCode) => ({
  code,
  message: PAGALO_IMPORT_ERROR_MESSAGES[code],
});

/** Contrato CB-028 compartido con CRM. El hash recibido no es fuente de verdad. */
export function canonicalizarPagaloPayload(
  command: Omit<PagaloImportCommand, "payload_hash">,
): string {
  const allocations = [...command.allocations]
    .sort((a, b) => {
      if (a.link_type !== b.link_type) return a.link_type < b.link_type ? -1 : 1;
      if (a.numero_cuota !== b.numero_cuota) return a.numero_cuota - b.numero_cuota;
      return a.rubro < b.rubro ? -1 : a.rubro > b.rubro ? 1 : 0;
    })
    .map((a) => ({
      link_type: a.link_type,
      cartera_cuota_id: a.cartera_cuota_id,
      numero_cuota: a.numero_cuota,
      rubro: a.rubro,
      amount: a.amount,
      facturable: a.facturable,
    }));
  const source = (value: PagaloImportCommand["capital"]) =>
    value
      ? {
          transaction_uuid: value.transaction_uuid,
          external_identifier: value.external_identifier,
          request_id: value.request_id ?? null,
          request_auth: value.request_auth ?? null,
          paid_at: value.paid_at,
          voucher_storage_key: value.voucher_storage_key,
        }
      : null;

  return JSON.stringify({
    crm_group_id: command.crm_group_id,
    credito_id: command.credito_id,
    numero_credito_sifco: command.numero_credito_sifco,
    currency: command.currency,
    capital_total: command.capital_total,
    facturable_total: command.facturable_total,
    otros_total: command.otros_total,
    total_amount: command.total_amount,
    cuota_inicial: command.cuota_inicial,
    allocations,
    capital: source(command.capital),
    facturable: source(command.facturable),
  });
}

export function calcularPagaloPayloadHash(
  command: Omit<PagaloImportCommand, "payload_hash">,
): string {
  return createHash("sha256").update(canonicalizarPagaloPayload(command)).digest("hex");
}

export function verificarPagaloPayloadHash(command: PagaloImportCommand) {
  const { payload_hash, ...content } = command;
  return calcularPagaloPayloadHash(content) === payload_hash;
}

// FASE 4 — Seguridad del voucher. Solo se acepta una key propia de R2;
// nunca una URL externa, traversal, encoding ambiguo o query.
//
// Antes exigía el prefijo `pagalo/{group}/` porque se esperaba descargar el
// voucher real de Págalo y subirlo nosotros mismos con esa key controlada.
// Cambio de diseño: el voucher ahora se genera en CRM (comprobante propio,
// no el de Págalo) y se sube reutilizando el mismo endpoint `/upload` que ya
// usan carteraFront y el bot de cobros para boletas de depósito — ese
// endpoint siempre devuelve una key plana con nombre aleatorio (`uuid.ext`),
// sin carpetas, así que ya no puede pertenecer a un prefijo por grupo. La
// key sigue atada a SU grupo por el resto del comando (crm_group_id,
// transaction_uuid, external_identifier), no por su propio nombre de archivo.
const voucherValid = (key: unknown, _group: string) => {
  if (typeof key !== "string" || key.length === 0) return false;
  if (
    key.includes("%") ||
    key.startsWith("/") ||
    /[\u0000-\u001F\u007F?#\\]/.test(key)
  )
    return false;
  return (
    !key.split("/").some((segment) => segment === "." || segment === "..") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(key)
  );
};

// FASE 5 — Una cuota lógica y su fila física de cartera son relación 1:1.
// Se revisan ambos sentidos porque existen datos históricos con filas duplicadas.
const hasCuotaMappingConflict = (
  allocations: PagaloImportCommand["allocations"],
) => {
  const cuotaToCartera = new Map<number, number>();
  const carteraToCuota = new Map<number, number>();
  return allocations.some((allocation) => {
    const carteraForCuota = cuotaToCartera.get(allocation.numero_cuota);
    const cuotaForCartera = carteraToCuota.get(allocation.cartera_cuota_id);
    const conflict =
      (carteraForCuota !== undefined &&
        carteraForCuota !== allocation.cartera_cuota_id) ||
      (cuotaForCartera !== undefined &&
        cuotaForCartera !== allocation.numero_cuota);
    cuotaToCartera.set(allocation.numero_cuota, allocation.cartera_cuota_id);
    carteraToCuota.set(allocation.cartera_cuota_id, allocation.numero_cuota);
    return conflict;
  });
};

export function validatePagaloImportCommand(
  input: unknown,
): PagaloImportValidationResult {
  // FASE 6 — Parseo estructural. Los problemas de voucher conservan código
  // específico; cualquier otro problema de forma es PAGALO_INVALID_COMMAND.
  const parsed = pagaloImportCommandSchema.safeParse(input);
  if (!parsed.success) {
    const hasVoucherIssue = parsed.error.issues.some(
      (issue) =>
        (issue.path[0] === "capital" || issue.path[0] === "facturable") &&
        issue.path[1] === "voucher_storage_key",
    );
    return {
      success: false,
      errors: [
        err(
          hasVoucherIssue
            ? PAGALO_IMPORT_ERROR_CODES.PAGALO_INVALID_VOUCHER_KEY
            : PAGALO_IMPORT_ERROR_CODES.PAGALO_INVALID_COMMAND,
        ),
      ],
    };
  }
  const c = parsed.data,
    errors: PagaloImportValidationError[] = [];

  // FASE 7 — Preparar montos y separar allocations por los dos presupuestos.
  // CAPITAL nunca paga facturable; MORA_INTERES nunca paga capital.
  const cap = new Big(c.capital_total),
    fact = new Big(c.facturable_total),
    total = new Big(c.total_amount);
  const capitals = c.allocations.filter((a) => a.link_type === "CAPITAL"),
    facts = c.allocations.filter((a) => a.link_type === "MORA_INTERES");
  const otros = facts.filter((a) => a.rubro === "OTROS");
  const sum = (items: typeof c.allocations) =>
    items.reduce((n, a) => n.plus(a.amount), new Big(0));

  // FASE 8 — Evidencia de Págalo: key segura y fuentes distintas si existen
  // ambos lados. Esto bloquea reutilizar una misma transacción dos veces.
  for (const s of [c.capital, c.facturable])
    if (s && !voucherValid(s.voucher_storage_key, c.crm_group_id)) {
      errors.push(err(PAGALO_IMPORT_ERROR_CODES.PAGALO_INVALID_VOUCHER_KEY));
      break;
    }
  if (c.capital && c.facturable) {
    if (
      c.capital.transaction_uuid.toLowerCase() ===
      c.facturable.transaction_uuid.toLowerCase()
    )
      errors.push(
        err(PAGALO_IMPORT_ERROR_CODES.PAGALO_DUPLICATE_TRANSACTION_UUID),
      );
    if (c.capital.external_identifier === c.facturable.external_identifier)
      errors.push(
        err(PAGALO_IMPORT_ERROR_CODES.PAGALO_DUPLICATE_EXTERNAL_IDENTIFIER),
      );
    if (c.capital.voucher_storage_key === c.facturable.voucher_storage_key)
      errors.push(err(PAGALO_IMPORT_ERROR_CODES.PAGALO_DUPLICATE_VOUCHER_KEY));
  }
  if (!total.eq(cap.plus(fact)))
    errors.push(err(PAGALO_IMPORT_ERROR_CODES.PAGALO_TOTAL_MISMATCH));

  // FASE 9 — Clasificación fiscal D-48: CAPITAL solo puede llevar CAPITAL;
  // los demás rubros pertenecen exclusivamente a MORA_INTERES.
  if (capitals.some((a) => a.rubro !== "CAPITAL"))
    errors.push(err(PAGALO_IMPORT_ERROR_CODES.PAGALO_INVALID_CAPITAL_RUBRO));
  if (facts.some((a) => a.rubro === "CAPITAL"))
    errors.push(err(PAGALO_IMPORT_ERROR_CODES.PAGALO_INVALID_FACTURABLE_RUBRO));
  if (
    otros.some((a) => a.link_type !== "MORA_INTERES" || !a.facturable) ||
    !sum(otros).eq(new Big(c.otros_total))
  )
    errors.push(err(PAGALO_IMPORT_ERROR_CODES.PAGALO_OTROS_ALLOCATION_MISMATCH));

  // FASE 10 — Presencia y suma exacta de cada lado. Un total Q0 significa que
  // no existe fuente ni allocation de ese tipo: no se crean links ficticios.
  if (cap.eq(0)) {
    if (c.capital)
      errors.push(
        err(PAGALO_IMPORT_ERROR_CODES.PAGALO_CAPITAL_SOURCE_FORBIDDEN),
      );
    if (capitals.length)
      errors.push(
        err(PAGALO_IMPORT_ERROR_CODES.PAGALO_CAPITAL_ALLOCATIONS_FORBIDDEN),
      );
  } else {
    if (!c.capital)
      errors.push(
        err(PAGALO_IMPORT_ERROR_CODES.PAGALO_CAPITAL_SOURCE_REQUIRED),
      );
    if (!sum(capitals).eq(cap))
      errors.push(
        err(PAGALO_IMPORT_ERROR_CODES.PAGALO_CAPITAL_ALLOCATIONS_MISMATCH),
      );
    if (capitals.some((a) => a.facturable))
      errors.push(
        err(PAGALO_IMPORT_ERROR_CODES.PAGALO_CAPITAL_ALLOCATION_FACTURABLE),
      );
  }
  if (fact.eq(0)) {
    if (c.facturable)
      errors.push(
        err(PAGALO_IMPORT_ERROR_CODES.PAGALO_FACTURABLE_SOURCE_FORBIDDEN),
      );
    if (facts.length)
      errors.push(
        err(PAGALO_IMPORT_ERROR_CODES.PAGALO_FACTURABLE_ALLOCATIONS_FORBIDDEN),
      );
  } else {
    if (!c.facturable)
      errors.push(
        err(PAGALO_IMPORT_ERROR_CODES.PAGALO_FACTURABLE_SOURCE_REQUIRED),
      );
    if (!sum(facts).eq(fact))
      errors.push(
        err(PAGALO_IMPORT_ERROR_CODES.PAGALO_FACTURABLE_ALLOCATIONS_MISMATCH),
      );
    if (facts.some((a) => !a.facturable))
      errors.push(
        err(
          PAGALO_IMPORT_ERROR_CODES.PAGALO_FACTURABLE_ALLOCATION_NOT_FACTURABLE,
        ),
      );
  }

  // FASE 11 — Integridad de selección: no duplicar mismo rubro/link/cuota,
  // no cruzar cuota lógica/física y exigir que cuota_inicial sea la primera.
  const duplicates = new Set<string>();
  for (const a of c.allocations) {
    const key = `${a.link_type}|${a.numero_cuota}|${a.rubro}`;
    if (duplicates.has(key)) {
      errors.push(err(PAGALO_IMPORT_ERROR_CODES.PAGALO_DUPLICATE_ALLOCATION));
      break;
    }
    duplicates.add(key);
  }
  if (hasCuotaMappingConflict(c.allocations))
    errors.push(err(PAGALO_IMPORT_ERROR_CODES.PAGALO_ALLOCATION_CUOTA_CONFLICT));
  if (c.cuota_inicial !== Math.min(...c.allocations.map((a) => a.numero_cuota)))
    errors.push(err(PAGALO_IMPORT_ERROR_CODES.PAGALO_CUOTA_INICIAL_MISMATCH));
  return errors.length
    ? { success: false, errors }
    : { success: true, data: c };
}
