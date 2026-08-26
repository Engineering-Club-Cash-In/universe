import { describe, expect, it, mock } from "bun:test";
import { calcularPagaloPayloadHash, type PagaloImportCommand } from "./pagaloPaymentImportPolicy";
import {
  createPagaloImportService,
  mapPagaloImportToRegistro,
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
