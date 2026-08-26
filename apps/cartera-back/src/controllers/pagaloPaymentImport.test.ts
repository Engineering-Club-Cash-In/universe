import { describe, expect, it, mock } from "bun:test";
import { calcularPagaloPayloadHash, type PagaloImportCommand } from "./pagaloPaymentImportPolicy";
import {
  calcularAjusteMoraPagalo,
  createPagaloImportService,
  getPagaloImportReplayHttpStatus,
  getPagaloReviewRequiredReason,
  isPagaloSameRoleEvidenceConflict,
  mapPagaloImportToRegistro,
  moraDelSnapshot,
  resolvePagaloLedgerCreditIdentity,
  resumirFacturacion,
} from "./pagaloPaymentImport";

const groupId = "3b6f0ed4-c4c5-4adf-afb9-aef97da9a5e6";

const command = (): PagaloImportCommand => {
  const input: Omit<PagaloImportCommand, "payload_hash"> = {
  crm_group_id: groupId,
  credito_id: 123,
  numero_credito_sifco: "SIFCO-123",
  currency: "GTQ",
  capital_total: "100.00",
  facturable_total: "25.00",
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
  capital: {
    transaction_uuid: "d9d7ba9b-c558-48e9-a68f-38473f82145d",
    external_identifier: "capital-123",
    paid_at: "2026-08-24T12:00:00.000Z",
    voucher_storage_key: `pagalo/${groupId}/capital.pdf`,
  },
  facturable: {
    transaction_uuid: "d350f86c-c15e-4cd8-af7f-d197804c0dd0",
    external_identifier: "facturable-123",
    paid_at: "2026-08-24T12:00:00.000Z",
    voucher_storage_key: `pagalo/${groupId}/facturable.pdf`,
  },
  };
  return { ...input, payload_hash: calcularPagaloPayloadHash(input) };
};

describe("pagalo payment import", () => {
  it("returns 409 when replaying a reviewed import", () => {
    expect(getPagaloImportReplayHttpStatus("REVIEW_REQUIRED")).toBe(409);
    expect(getPagaloImportReplayHttpStatus("APPLIED")).toBe(200);
  });

  it("recognizes unique conflicts for Págalo evidence in the same role", () => {
    expect(
      isPagaloSameRoleEvidenceConflict({
        code: "23505",
        constraint: "pagalo_payment_imports_capital_tx_uq",
      }),
    ).toBe(true);
    expect(
      isPagaloSameRoleEvidenceConflict({
        code: "23505",
        constraint: "pagalo_payment_imports_facturable_external_uq",
      }),
    ).toBe(true);
    expect(
      isPagaloSameRoleEvidenceConflict({ code: "23505", constraint: "other_uq" }),
    ).toBe(false);
  });

  it("maps a two-link group as a single payment with the combined total (Daniel, 2026-08-26)", () => {
    expect(mapPagaloImportToRegistro(command(), 44)).toMatchObject({
      credito_id: 123,
      pagalo_import_id: 44,
      origen_pago: "pagalo",
      monto_boleta: 125,
      registerBy: "pagalo@clubcashin.com",
      pagalo_componentes: {
        capital: {
          disponible: "100.00",
          voucher_storage_key: `pagalo/${groupId}/capital.pdf`,
        },
        facturable: {
          disponible: "25.00",
          voucher_storage_key: `pagalo/${groupId}/facturable.pdf`,
        },
      },
    });
    expect(mapPagaloImportToRegistro(command(), 44)).not.toHaveProperty(
      "abono_directo_capital",
    );
  });

  it("does not invent a Q0 source when mapping capital-only or facturable-only groups", () => {
    const capitalOnly = command();
    capitalOnly.facturable_total = "0.00";
    capitalOnly.total_amount = "100.00";
    capitalOnly.facturable = null;
    capitalOnly.allocations = [capitalOnly.allocations[0]!];

    const facturableOnly = command();
    facturableOnly.capital_total = "0.00";
    facturableOnly.total_amount = "25.00";
    facturableOnly.capital = null;
    facturableOnly.allocations = [facturableOnly.allocations[1]!];

    expect(mapPagaloImportToRegistro(capitalOnly, 45).pagalo_componentes).toEqual({
      capital: expect.any(Object),
    });
    expect(mapPagaloImportToRegistro(facturableOnly, 46).pagalo_componentes).toEqual({
      facturable: expect.any(Object),
    });
  });

  it("uses Guatemala calendar date from the latest paid_at instant", () => {
    const input = command();
    input.capital!.paid_at = "2026-08-20T18:00:00-12:00";
    input.facturable!.paid_at = "2026-08-20T19:00:00+14:00";

    expect(mapPagaloImportToRegistro(input, 47)).toMatchObject({
      fecha_pago: "2026-08-21",
      fecha_boleta: "2026-08-21",
    });
  });

  it("replays an APPLIED group with same hash without creating payments", async () => {
    const registrarPago = mock();
    const service = createPagaloImportService({
      findByGroup: mock(() =>
        Promise.resolve({
          id: 44,
          status: "APPLIED",
          payload_hash: command().payload_hash,
          payment_ids: [801, 802],
        }),
      ),
      markReviewRequired: mock(),
      registrarPago,
    });

    await expect(service.import(command())).resolves.toEqual({
      success: true,
      status: "APPLIED",
      import_id: 44,
      payment_ids: [801, 802],
      idempotent_replay: true,
    });
    expect(registrarPago).not.toHaveBeenCalled();
  });

  it("rejects a stale payload hash before checking idempotency or creating a payment", async () => {
    const findByGroup = mock();
    const registrarPago = mock();
    const service = createPagaloImportService({ findByGroup, markReviewRequired: mock(), registrarPago });
    const stale = { ...command(), payload_hash: "a".repeat(64) };

    await expect(service.import(stale)).resolves.toMatchObject({
      success: false,
      status: "INVALID_COMMAND",
      code: "PAGALO_PAYLOAD_HASH_MISMATCH",
    });
    expect(findByGroup).not.toHaveBeenCalled();
    expect(registrarPago).not.toHaveBeenCalled();
  });

  it("classifies known Cartera business rejects for Págalo manual review", () => {
    expect(
      getPagaloReviewRequiredReason({
        code: "CREDIT_PENDING_CANCELLATION",
        message: "crédito pendiente de cancelación",
      }),
    ).toBe("crédito pendiente de cancelación");
    expect(
      getPagaloReviewRequiredReason(
        new Error("Inconsistencia de integridad: cuota inválida"),
      ),
    ).toBe("Inconsistencia de integridad: cuota inválida");
    expect(getPagaloReviewRequiredReason(new Error("database offline"))).toBeUndefined();
    expect(getPagaloReviewRequiredReason(new Error("Credit not found"))).toBe(
      "Credit not found",
    );
    expect(
      getPagaloReviewRequiredReason(new Error("Pago rechazado: cuota sobre-aplicada")),
    ).toBe("Pago rechazado: cuota sobre-aplicada");
  });

  it("keeps accepted evidence in review when live credit identity changed or vanished", () => {
    expect(resolvePagaloLedgerCreditIdentity(command(), undefined)).toEqual({
      identity: { credito_id: null, numero_credito_sifco: null },
      reviewReason: "El crédito 123 ya no existe; SIFCO recibido: SIFCO-123.",
    });
    expect(
      resolvePagaloLedgerCreditIdentity(command(), {
        credito_id: 123,
        numero_credito_sifco: "SIFCO-actual",
      }),
    ).toEqual({
      identity: { credito_id: 123, numero_credito_sifco: "SIFCO-actual" },
      reviewReason:
        "SIFCO recibido (SIFCO-123) no coincide con crédito 123 vivo (SIFCO-actual).",
    });
    expect(
      resolvePagaloLedgerCreditIdentity(command(), {
        credito_id: 123,
        numero_credito_sifco: "SIFCO-123",
      }),
    ).toEqual({
      identity: { credito_id: 123, numero_credito_sifco: "SIFCO-123" },
      reviewReason: undefined,
    });
  });

  it("marks same group with different hash REVIEW_REQUIRED without creating payments", async () => {
    const markReviewRequired = mock(() => Promise.resolve());
    const registrarPago = mock();
    const service = createPagaloImportService({
      findByGroup: mock(() =>
        Promise.resolve({
          id: 44,
          status: "APPLIED",
          payload_hash: "b".repeat(64),
          payment_ids: [801],
        }),
      ),
      markReviewRequired,
      registrarPago,
    });

    await expect(service.import(command())).resolves.toMatchObject({
      success: false,
      status: "REVIEW_REQUIRED",
      code: "PAGALO_PAYLOAD_HASH_CONFLICT",
      import_id: 44,
    });
    expect(markReviewRequired).toHaveBeenCalledWith(44, "PAGALO_PAYLOAD_HASH_CONFLICT");
    expect(registrarPago).not.toHaveBeenCalled();
  });
});

describe("ajuste de mora al aplicar (D-52, 2026-08-26)", () => {
  it("la mora del snapshot es la suma del rubro MORA (Q0 si no viene)", () => {
    expect(moraDelSnapshot(command())).toBe("25.00");
    const alDia = command();
    alDia.allocations = alDia.allocations.filter((a) => a.rubro !== "MORA");
    expect(moraDelSnapshot(alDia)).toBe("0.00");
  });

  it("si la mora viva creció, la diferencia es lo que sigue pendiente", () => {
    expect(calcularAjusteMoraPagalo("700.00", "500.00")).toBe("200.00");
    // nació una mora que no existía al generar el link (cliente al día)
    expect(calcularAjusteMoraPagalo("312.48", "0.00")).toBe("312.48");
  });

  it("si la mora viva es igual o menor (condonada / pagada por otro canal) no se toca", () => {
    expect(calcularAjusteMoraPagalo("500.00", "500.00")).toBeNull();
    expect(calcularAjusteMoraPagalo("300.00", "500.00")).toBeNull();
    expect(calcularAjusteMoraPagalo(null, "500.00")).toBeNull();
    expect(calcularAjusteMoraPagalo(undefined, "0.00")).toBeNull();
  });
});

describe("facturación post-commit (D-10 v2)", () => {
  it("OK solo si todos los pagos facturaron sin errores", () => {
    expect(
      resumirFacturacion([
        { pago_id: 1, success: true, http: 200, errores: [] },
        { pago_id: 2, success: true, http: 200, errores: [] },
      ]),
    ).toEqual({ status: "OK", error: null });
  });

  it("PARCIAL cuando alguna factura del pago falló pero el pago respondió success", () => {
    const parcial = {
      pago_id: 1,
      success: true,
      http: 200,
      errores: [{ tipo: "INTERESES", error: "SAT timeout" }],
      detalle: "1 factura(s) generada(s), 1 con errores",
    };
    expect(resumirFacturacion([parcial])).toEqual({
      status: "PARCIAL",
      error: JSON.stringify([parcial]),
    });
  });

  it("FALLIDA manda sobre PARCIAL; el detalle conserva los caídos Y los parciales (a medias en SAT)", () => {
    const parcial = { pago_id: 1, success: true, http: 200, errores: [{ error: "x" }] };
    const sat = { pago_id: 2, success: false, http: 500, errores: [{ tipo: "MORA", error: "SAT timeout" }], detalle: "No se pudo generar ninguna factura" };
    const nit = { pago_id: 3, success: false, http: 400, errores: [], detalle: "sin NIT" };
    expect(resumirFacturacion([parcial, sat, nit])).toEqual({
      status: "FALLIDA",
      error: JSON.stringify([sat, nit, parcial]),
    });
    // lo que lee el playbook: qué pago tiene cero facturas (reintento seguro)
    expect(JSON.parse(resumirFacturacion([sat]).error ?? "[]")[0]).toMatchObject({ pago_id: 2, http: 500 });
  });
});
