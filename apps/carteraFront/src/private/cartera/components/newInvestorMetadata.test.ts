import { describe, expect, it } from "bun:test";
import {
  getNewInvestorMetadataError,
  mapNewInvestorMetadata,
} from "./newInvestorMetadata";

describe("new investor operation metadata", () => {
  it("requires a reinvestment type for a new reinvestment", () => {
    expect(
      getNewInvestorMetadataError({
        es_nuevo: true,
        tipo_operacion: "reinversion",
      }),
    ).toBe("Seleccioná el tipo de reinversión.");
  });

  it("requires the catalog modality and spread row for a new purchase", () => {
    expect(
      getNewInvestorMetadataError({
        es_nuevo: true,
        tipo_operacion: "compra_cartera",
        tipo_reinversion: "sin_reinversion",
        modalidad_facturacion: "p2p_directa",
      }),
    ).toBe("Seleccioná el rango de facturación.");
  });

  it("requires a reinvestment type for a new purchase", () => {
    expect(
      getNewInvestorMetadataError({
        es_nuevo: true,
        tipo_operacion: "compra_cartera",
        modalidad_facturacion: "p2p_directa",
        modalidad_facturacion_spread_id: 4,
      }),
    ).toBe("Seleccioná el tipo de reinversión.");
  });

  it("keeps exact catalog metadata in the submitted purchase payload", () => {
    expect(
      mapNewInvestorMetadata({
        es_nuevo: true,
        tipo_operacion: "compra_cartera",
        tipo_reinversion: "reinversion_capital",
        modalidad_facturacion: "factura_cube",
        modalidad_facturacion_spread_id: 17,
      }),
    ).toEqual({
      es_nuevo: true,
      tipo_operacion: "compra_cartera",
      tipo_reinversion: "reinversion_capital",
      modalidad_facturacion: "factura_cube",
      modalidad_facturacion_spread_id: 17,
    });
  });

  it("keeps the two per-credit reinvestment modes and clears purchase metadata", () => {
    expect(
      mapNewInvestorMetadata({
        es_nuevo: true,
        tipo_operacion: "reinversion",
        tipo_reinversion: "reinversion_variable",
        modalidad_facturacion: "factura_cube",
        modalidad_facturacion_spread_id: 17,
      }),
    ).toEqual({
      es_nuevo: true,
      tipo_operacion: "reinversion",
      tipo_reinversion: "reinversion_variable",
    });
    expect(
      mapNewInvestorMetadata({
        es_nuevo: true,
        tipo_operacion: "reinversion",
        tipo_reinversion: "reinversion_excedente",
      }),
    ).toEqual({
      es_nuevo: true,
      tipo_operacion: "reinversion",
      tipo_reinversion: "reinversion_excedente",
    });
  });

  it("exposes both per-credit modes in the edit-credit selector", async () => {
    const selector = await Bun.file(new URL("./InvestorsList.tsx", import.meta.url)).text();
    expect(selector).toContain('value="reinversion_variable"');
    expect(selector).toContain('value="reinversion_excedente"');
  });
});
