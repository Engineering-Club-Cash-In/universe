import { describe, expect, it } from "bun:test";
import type { z } from "zod";
import {
  PAGALO_IMPORT_ERROR_CODES,
	canonicalizarPagaloPayload,
  calcularPagaloPayloadHash,
  pagaloImportCommandSchema,
  validatePagaloImportCommand,
  verificarPagaloPayloadHash,
  type PagaloImportErrorCode,
} from "./pagaloPaymentImportPolicy";

const groupId = "3b6f0ed4-c4c5-4adf-afb9-aef97da9a5e6";
const capitalTransactionId = "d9d7ba9b-c558-48e9-a68f-38473f82145d";
const facturableTransactionId = "d350f86c-c15e-4cd8-af7f-d197804c0dd0";
const validPayloadHash = "b6a7f6e188653732c9b0d193b00b57956fdf96d33609aa4554e0889f0505803a";

const source = (
  transaction_uuid: string,
  external_identifier: string,
  suffix: string,
) => ({
  transaction_uuid,
  external_identifier,
  request_id: "request-123",
  request_auth: "auth-123",
  paid_at: "2026-08-24T12:00:00.000Z",
  voucher_storage_key: `pagalo/${groupId}/vouchers/${suffix}.pdf`,
});

type MutableSource = {
  transaction_uuid: string;
  external_identifier: string;
  request_id?: string;
  request_auth?: string;
  paid_at: string;
  voucher_storage_key: string;
};
type MutableAllocation = {
  link_type: "CAPITAL" | "MORA_INTERES";
  cartera_cuota_id: number;
  numero_cuota: number;
  rubro:
    | "CAPITAL"
    | "INTERES"
    | "IVA"
    | "INTERES_CI"
    | "IVA_CI"
    | "SEGURO"
    | "GPS"
    | "MEMBRESIAS"
    | "MORA"
    | "OTROS";
  amount: string | number;
  facturable: boolean;
};
type TestCommand = Omit<
  z.input<typeof pagaloImportCommandSchema>,
  "capital" | "facturable" | "allocations"
> & {
  capital: MutableSource;
  facturable: MutableSource;
  allocations: MutableAllocation[];
};

const command = (): TestCommand => ({
  crm_group_id: groupId,
  credito_id: 123,
  numero_credito_sifco: "SIFCO-123",
  currency: "GTQ",
  capital_total: "100.00",
  facturable_total: 25,
  total_amount: "125.00",
  cuota_inicial: 2,
  allocations: [
    {
      link_type: "CAPITAL",
      cartera_cuota_id: 20,
      numero_cuota: 2,
      rubro: "CAPITAL",
      amount: "100.00",
      facturable: false,
    },
    {
      link_type: "MORA_INTERES",
      cartera_cuota_id: 20,
      numero_cuota: 2,
      rubro: "MORA",
      amount: "25.00",
      facturable: true,
    },
  ],
  capital: source(capitalTransactionId, "capital-123", "capital"),
  facturable: source(facturableTransactionId, "facturable-123", "facturable"),
  payload_hash: validPayloadHash,
});

const expectInvalid = (input: unknown, code: PagaloImportErrorCode) => {
  const result = validatePagaloImportCommand(input);
  expect(result.success).toBeFalse();
  if (!result.success)
    expect(result.errors.map((entry) => entry.code)).toContain(code);
};

describe("validatePagaloImportCommand", () => {
	it("Otros Q0 conserva formato canónico histórico", () => {
    const parsed = pagaloImportCommandSchema.parse(command());
    const { payload_hash: _payloadHash, ...content } = parsed;
    expect(canonicalizarPagaloPayload(content)).not.toContain('"otros_total"');
  });

	it("accepts the two-source command and normalizes valid money to cents", () => {
    const result = validatePagaloImportCommand(command());

    expect(result.success).toBeTrue();
    if (result.success) {
      expect(result.data.capital_total).toBe("100.00");
      expect(result.data.facturable_total).toBe("25.00");
    }
	});

	it("acepta Otros facturable cuando coincide con su allocation", () => {
		const input = command();
		input.facturable_total = "37.34";
		input.total_amount = "137.34";
		(input as TestCommand & { otros_total: string }).otros_total = "12.34";
		input.allocations.push({
			link_type: "MORA_INTERES",
			cartera_cuota_id: 20,
			numero_cuota: 2,
			rubro: "OTROS",
			amount: "12.34",
			facturable: true,
		});

		const result = validatePagaloImportCommand(input);
		expect(result.success).toBeTrue();
		if (result.success) expect(result.data.otros_total).toBe("12.34");
	});

	it("rechaza Otros asociado a una cuota posterior", () => {
		const input = command();
		input.facturable_total = "37.34";
		input.total_amount = "137.34";
		(input as TestCommand & { otros_total: string }).otros_total = "12.34";
		input.allocations.push({
			link_type: "MORA_INTERES",
			cartera_cuota_id: 21,
			numero_cuota: 3,
			rubro: "OTROS",
			amount: "12.34",
			facturable: true,
		});

		expectInvalid(input, PAGALO_IMPORT_ERROR_CODES.PAGALO_OTROS_ALLOCATION_MISMATCH);
	});

  it("hashes validated command content canonically and detects an altered hash", () => {
    const parsed = validatePagaloImportCommand(command());
    expect(parsed.success).toBeTrue();
    if (!parsed.success) return;

    expect(calcularPagaloPayloadHash(parsed.data)).toBe(validPayloadHash);
    expect(verificarPagaloPayloadHash(parsed.data)).toBeTrue();
    expect(verificarPagaloPayloadHash({ ...parsed.data, payload_hash: "a".repeat(64) })).toBeFalse();
  });

  it("accepts mora-only commands and requires the top-level source shape", () => {
    const input = command();
    input.capital_total = "0.00";
    input.total_amount = "25.00";
    (input as unknown as { capital: null }).capital = null;
    input.allocations = [input.allocations[1]];

    expect(validatePagaloImportCommand(input).success).toBeTrue();
    expectInvalid(
      {
        ...command(),
        sources: {
          capital: command().capital,
          facturable: command().facturable,
        },
      },
      PAGALO_IMPORT_ERROR_CODES.PAGALO_INVALID_COMMAND,
    );
  });

  it("accepts capital-only commands with no facturable source or allocations", () => {
    const input = command();
    input.facturable_total = "0.00";
    input.total_amount = "100.00";
    (input as unknown as { facturable: null }).facturable = null;
    input.allocations = [input.allocations[0]];

    expect(validatePagaloImportCommand(input).success).toBeTrue();
  });

  it("rejects invalid structural fields and unknown object keys", () => {
    for (const input of [
      { ...command(), crm_group_id: "not-a-uuid" },
      { ...command(), credito_id: 0 },
      { ...command(), numero_credito_sifco: "" },
      { ...command(), currency: "USD" },
      {
        ...command(),
        facturable: { ...command().facturable, transaction_uuid: "bad" },
      },
      { ...command(), ignored: true },
      { ...command(), capital: { ...command().capital, ignored: true } },
      {
        ...command(),
        allocations: [{ ...command().allocations[0], ignored: true }],
      },
    ]) {
      expectInvalid(input, PAGALO_IMPORT_ERROR_CODES.PAGALO_INVALID_COMMAND);
    }
  });

  it("rejects negative, imprecise, exponent, unsafe, and overflowing amounts before Big", () => {
    for (const input of [
      { ...command(), capital_total: "-0.004" },
      { ...command(), facturable_total: "1.001" },
      { ...command(), total_amount: "1e2" },
      { ...command(), total_amount: Number.POSITIVE_INFINITY },
      { ...command(), total_amount: Number.MAX_SAFE_INTEGER + 1 },
      { ...command(), total_amount: 90071992547409.92 },
      { ...command(), total_amount: "12345678901234567.89" },
      {
        ...command(),
        allocations: [{ ...command().allocations[0], amount: "-0.004" }],
      },
    ]) {
      expectInvalid(input, PAGALO_IMPORT_ERROR_CODES.PAGALO_INVALID_COMMAND);
    }
  });

  it("rejects decimal strings that lose cents when the normal payment engine converts them to Number", () => {
    const input = command();
    const amount = "90071992547409.91";
    input.capital_total = amount;
    input.facturable_total = "0.00";
    input.total_amount = amount;
    input.allocations = [{ ...input.allocations[0], amount }];
    (input as unknown as { facturable: null }).facturable = null;

    expectInvalid(input, PAGALO_IMPORT_ERROR_CODES.PAGALO_INVALID_COMMAND);
  });

  it("rejects voucher paths with traversal, encoding escapes, or an external URL", () => {
    for (const voucher_storage_key of [
      `pagalo/${groupId}/../receipt.pdf`,
      `pagalo/${groupId}/%2e%2e/receipt.pdf`,
      `pagalo/${groupId}/%252e%252e/receipt.pdf`,
      `pagalo/${groupId}/receipt?download=1`,
      `pagalo/${groupId}/receipt#fragment`,
      `pagalo/${groupId}/receipt\u0000.pdf`,
      "https://bucket.example/pagalo/receipt.pdf",
      "//bucket.example/pagalo/receipt.pdf",
    ]) {
      const input = command();
      input.facturable.voucher_storage_key = voucher_storage_key;
      expectInvalid(
        input,
        PAGALO_IMPORT_ERROR_CODES.PAGALO_INVALID_VOUCHER_KEY,
      );
    }
  });

  // El comprobante ahora se genera en CRM y se sube reutilizando /upload de
  // cartera-back (mismo endpoint que carteraFront y el bot de cobros usan
  // para boletas de depósito) — ese endpoint siempre devuelve una key plana
  // con nombre aleatorio, sin el prefijo pagalo/{group}/ que antes exigía
  // esta validación cuando se esperaba descargar el voucher real de Págalo.
  it("accepts a plain random key like the one /upload already returns", () => {
    const input = command();
    input.facturable.voucher_storage_key =
      "3f9e9e2a-2f2f-4a7b-9a8f-1a2b3c4d5e6f.pdf";
    const result = validatePagaloImportCommand(input);
    expect(result.success).toBe(true);
  });

  it("rejects duplicate source identifiers and voucher storage keys", () => {
    const transaction = command();
    transaction.facturable.transaction_uuid =
      transaction.capital.transaction_uuid;
    expectInvalid(
      transaction,
      PAGALO_IMPORT_ERROR_CODES.PAGALO_DUPLICATE_TRANSACTION_UUID,
    );

    const external = command();
    external.facturable.external_identifier =
      external.capital.external_identifier;
    expectInvalid(
      external,
      PAGALO_IMPORT_ERROR_CODES.PAGALO_DUPLICATE_EXTERNAL_IDENTIFIER,
    );

    const voucher = command();
    voucher.facturable.voucher_storage_key =
      voucher.capital.voucher_storage_key;
    expectInvalid(
      voucher,
      PAGALO_IMPORT_ERROR_CODES.PAGALO_DUPLICATE_VOUCHER_KEY,
    );
  });

  it("rejects UUID identities duplicated with different casing", () => {
    const input = command();
    input.facturable.transaction_uuid =
      input.capital.transaction_uuid.toUpperCase();

    expectInvalid(
      input,
      PAGALO_IMPORT_ERROR_CODES.PAGALO_DUPLICATE_TRANSACTION_UUID,
    );
  });

  it("maps empty voucher keys to the stable invalid-voucher error", () => {
    const input = command();
    input.facturable.voucher_storage_key = "";

    expectInvalid(input, PAGALO_IMPORT_ERROR_CODES.PAGALO_INVALID_VOUCHER_KEY);
  });

  it("maps missing and non-string voucher keys to the stable invalid-voucher error", () => {
    const missingSource = command().facturable;
    const { voucher_storage_key: _voucherStorageKey, ...withoutVoucher } = missingSource;
    const missing: unknown = { ...command(), facturable: withoutVoucher };
    expectInvalid(
      missing,
      PAGALO_IMPORT_ERROR_CODES.PAGALO_INVALID_VOUCHER_KEY,
    );

    const nonString: unknown = {
      ...command(),
      facturable: { ...command().facturable, voucher_storage_key: 123 },
    };
    expectInvalid(
      nonString,
      PAGALO_IMPORT_ERROR_CODES.PAGALO_INVALID_VOUCHER_KEY,
    );
  });

  it("rejects voucher storage keys longer than the 160-character contract bound", () => {
    const input = command();
    const prefix = `pagalo/${groupId}/`;
    input.facturable.voucher_storage_key = `${prefix}${"a".repeat(161 - prefix.length)}`;

    expect(input.facturable.voucher_storage_key.length).toBe(161);
    expectInvalid(input, PAGALO_IMPORT_ERROR_CODES.PAGALO_INVALID_VOUCHER_KEY);
  });

  it("enforces totals, source presence, sums, and facturable flags", () => {
    const badTotal = command();
    badTotal.total_amount = "124.99";
    expectInvalid(badTotal, PAGALO_IMPORT_ERROR_CODES.PAGALO_TOTAL_MISMATCH);

    const zeroCapital = command();
    zeroCapital.capital_total = "0.00";
    zeroCapital.facturable_total = "125.00";
    (zeroCapital as unknown as { capital: null }).capital = null;
    expectInvalid(
      zeroCapital,
      PAGALO_IMPORT_ERROR_CODES.PAGALO_CAPITAL_ALLOCATIONS_FORBIDDEN,
    );

    const noCapitalSource = command();
    (noCapitalSource as unknown as { capital: null }).capital = null;
    expectInvalid(
      noCapitalSource,
      PAGALO_IMPORT_ERROR_CODES.PAGALO_CAPITAL_SOURCE_REQUIRED,
    );

    const capitalMismatch = command();
    capitalMismatch.allocations[0].amount = "99.99";
    expectInvalid(
      capitalMismatch,
      PAGALO_IMPORT_ERROR_CODES.PAGALO_CAPITAL_ALLOCATIONS_MISMATCH,
    );

    const facturableMismatch = command();
    facturableMismatch.allocations[1].amount = "24.99";
    expectInvalid(
      facturableMismatch,
      PAGALO_IMPORT_ERROR_CODES.PAGALO_FACTURABLE_ALLOCATIONS_MISMATCH,
    );

    const capitalFlag = command();
    capitalFlag.allocations[0].facturable = true;
    expectInvalid(
      capitalFlag,
      PAGALO_IMPORT_ERROR_CODES.PAGALO_CAPITAL_ALLOCATION_FACTURABLE,
    );

    const facturableFlag = command();
    facturableFlag.allocations[1].facturable = false;
    expectInvalid(
      facturableFlag,
      PAGALO_IMPORT_ERROR_CODES.PAGALO_FACTURABLE_ALLOCATION_NOT_FACTURABLE,
    );

    const forbiddenFacturableSource = command();
    forbiddenFacturableSource.facturable_total = "0.00";
    forbiddenFacturableSource.total_amount = "100.00";
    forbiddenFacturableSource.allocations = [
      forbiddenFacturableSource.allocations[0],
    ];
    expectInvalid(
      forbiddenFacturableSource,
      PAGALO_IMPORT_ERROR_CODES.PAGALO_FACTURABLE_SOURCE_FORBIDDEN,
    );

    const forbiddenFacturableAllocation = command();
    forbiddenFacturableAllocation.facturable_total = "0.00";
    forbiddenFacturableAllocation.total_amount = "100.00";
    (forbiddenFacturableAllocation as unknown as { facturable: null }).facturable = null;
    expectInvalid(
      forbiddenFacturableAllocation,
      PAGALO_IMPORT_ERROR_CODES.PAGALO_FACTURABLE_ALLOCATIONS_FORBIDDEN,
    );
  });

  it("allows all D-48 noncapital rubros and rejects unsupported ones", () => {
    for (const rubro of [
      "INTERES",
      "IVA",
      "INTERES_CI",
      "IVA_CI",
      "SEGURO",
      "GPS",
      "MEMBRESIAS",
      "MORA",
    ] as const) {
      const input = command();
      input.allocations[1].rubro = rubro;
      expect(validatePagaloImportCommand(input).success).toBeTrue();
    }
    const unsupported: unknown = {
      ...command(),
      allocations: [
        command().allocations[0],
        { ...command().allocations[1], rubro: "OTRO" },
      ],
    };
    expectInvalid(
      unsupported,
      PAGALO_IMPORT_ERROR_CODES.PAGALO_INVALID_COMMAND,
    );
  });

  it("rejects logical duplicates, conflicting cuota mappings, and wrong cuota_inicial", () => {
    const duplicate = command();
    duplicate.allocations.push({ ...duplicate.allocations[1], amount: "1.00" });
    duplicate.facturable_total = "26.00";
    duplicate.total_amount = "126.00";
    expectInvalid(
      duplicate,
      PAGALO_IMPORT_ERROR_CODES.PAGALO_DUPLICATE_ALLOCATION,
    );

    const conflicting = command();
    conflicting.allocations[1].rubro = "CAPITAL";
    conflicting.allocations[1].cartera_cuota_id = 21;
    expectInvalid(
      conflicting,
      PAGALO_IMPORT_ERROR_CODES.PAGALO_ALLOCATION_CUOTA_CONFLICT,
    );

    const wrongCuota = command();
    wrongCuota.cuota_inicial = 3;
    expectInvalid(
      wrongCuota,
      PAGALO_IMPORT_ERROR_CODES.PAGALO_CUOTA_INICIAL_MISMATCH,
    );
  });

  it("returns documented stable domain errors", () => {
    const total = command();
    total.total_amount = "124.99";
    expect(validatePagaloImportCommand(total)).toEqual({
      success: false,
      errors: [
        {
          code: PAGALO_IMPORT_ERROR_CODES.PAGALO_TOTAL_MISMATCH,
          message: "El total no coincide con capital más facturable.",
        },
      ],
    });

    const voucher = command();
    voucher.facturable.voucher_storage_key = `pagalo/${groupId}/%2e%2e/receipt.pdf`;
    expect(validatePagaloImportCommand(voucher)).toEqual({
      success: false,
      errors: [
        {
          code: PAGALO_IMPORT_ERROR_CODES.PAGALO_INVALID_VOUCHER_KEY,
          message: "La llave del comprobante Págalo no es válida.",
        },
      ],
    });
  });

  it("enforces D-48 link-to-rubro mapping", () => {
    const capitalWrong = command();
    capitalWrong.allocations[0].rubro = "INTERES";
    expectInvalid(
      capitalWrong,
      PAGALO_IMPORT_ERROR_CODES.PAGALO_INVALID_CAPITAL_RUBRO,
    );

    const facturableWrong = command();
    facturableWrong.allocations[1].rubro = "CAPITAL";
    expectInvalid(
      facturableWrong,
      PAGALO_IMPORT_ERROR_CODES.PAGALO_INVALID_FACTURABLE_RUBRO,
    );
  });

  it("rejects numeric(18,2) integer overflow and unsafe PostgreSQL IDs", () => {
    for (const input of [
      { ...command(), capital_total: "99999999999999999" },
      { ...command(), credito_id: 2147483648 },
      { ...command(), cuota_inicial: 2147483648 },
      {
        ...command(),
        allocations: [
          { ...command().allocations[0], cartera_cuota_id: 2147483648 },
        ],
      },
      {
        ...command(),
        allocations: [
          { ...command().allocations[0], numero_cuota: 2147483648 },
        ],
      },
    ])
      expectInvalid(input, PAGALO_IMPORT_ERROR_CODES.PAGALO_INVALID_COMMAND);
  });

  it("canonicalizes CRM and transaction UUIDs and rejects dot path segments", () => {
    const normalized = command();
    normalized.crm_group_id = groupId.toUpperCase();
    normalized.capital.transaction_uuid = capitalTransactionId.toUpperCase();
    const result = validatePagaloImportCommand(normalized);
    expect(result.success).toBeTrue();
    if (result.success) {
      expect(result.data.crm_group_id).toBe(groupId);
      expect(result.data.capital!.transaction_uuid).toBe(capitalTransactionId);
    }

    const dot = command();
    dot.facturable.voucher_storage_key = `pagalo/${groupId}/./receipt.pdf`;
    expectInvalid(dot, PAGALO_IMPORT_ERROR_CODES.PAGALO_INVALID_VOUCHER_KEY);
  });

  it("rejects different cartera cuota IDs for one installment across rubros", () => {
    const input = command();
    input.allocations[1].cartera_cuota_id = 21;
    expectInvalid(
      input,
      PAGALO_IMPORT_ERROR_CODES.PAGALO_ALLOCATION_CUOTA_CONFLICT,
    );
  });

  it("rejects one cartera cuota ID mapped to distinct installments", () => {
    const input = command();
    input.allocations[1].numero_cuota = 3;

    expectInvalid(
      input,
      PAGALO_IMPORT_ERROR_CODES.PAGALO_ALLOCATION_CUOTA_CONFLICT,
    );
  });

  it("emits the cuota mapping conflict code only once", () => {
    const input = command();
    input.allocations[1].cartera_cuota_id = 21;
    input.allocations.push({
      ...input.allocations[1],
      cartera_cuota_id: 20,
      numero_cuota: 3,
      rubro: "INTERES",
      amount: "1.00",
    });
    input.facturable_total = "26.00";
    input.total_amount = "126.00";
    const result = validatePagaloImportCommand(input);

    expect(result.success).toBeFalse();
    if (!result.success) {
      expect(
        result.errors.filter(
          (entry) =>
            entry.code ===
            PAGALO_IMPORT_ERROR_CODES.PAGALO_ALLOCATION_CUOTA_CONFLICT,
        ),
      ).toHaveLength(1);
    }
  });
});
