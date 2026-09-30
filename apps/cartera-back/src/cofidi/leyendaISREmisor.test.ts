import { describe, expect, test } from "bun:test";
import { generarHTMLFacturaPro, leyendaISREmisor } from "./functions";
import {
  AMJK_CONFIG,
  AUTOCASH_CONFIG,
  CLUB_CASHIN_CONFIG,
} from "../utils/functions/const";

// SAT le cambió la afiliación ISR a AMJK y Autocash (resoluciones del 21-sep-2026).
// Con escenario 2 COFIDI rechaza TODA factura de esos emisores (TrCode 1029).
describe("frase ISR de los emisores con pago directo", () => {
  test.each([
    ["AMJK", AMJK_CONFIG, "6155219202612561719"],
    ["AUTOCASH", AUTOCASH_CONFIG, "6135219202612505635"],
  ])("%s manda escenario 3 con su resolución", (_nombre, config, resolucion) => {
    expect(config.frases).toEqual([
      {
        tipoFrase: 1,
        codigoEscenario: "3",
        numeroResolucion: resolucion,
        fechaResolucion: "2026-09-21",
      },
    ]);
  });
});

describe("leyendaISREmisor", () => {
  test("cada emisor con pago directo muestra SU resolución, no la de CUBE", () => {
    expect(leyendaISREmisor("100691455")).toBe(
      "Sujeto a pago directo ISR. Resolución No. 6155219202612561719 21/09/2026"
    );
    expect(leyendaISREmisor("96896035")).toBe(
      "Sujeto a pago directo ISR. Resolución No. 6135219202612505635 21/09/2026"
    );
  });

  test("CUBE conserva su leyenda", () => {
    expect(leyendaISREmisor(CLUB_CASHIN_CONFIG.emisor.nit)).toBe(
      "Sujeto a pago directo ISR. Resolución No. 6130294202615373132 29/04/2026"
    );
  });

  test("un emisor sin resolución configurada cae en la de CUBE, como antes", () => {
    const deCube = leyendaISREmisor("98766430");
    expect(leyendaISREmisor("12345678")).toBe(deCube);
  });

  test("el PDF de AMJK lleva la resolución de AMJK", () => {
    const html = generarHTMLFacturaPro(
      {
        tipo: "FCAM",
        serie: "S",
        numero: "1",
        uuid: "U",
        fechaEmision: "2026-09-30T10:00:00",
        fechaCertificacion: "2026-09-30T10:00:00",
        emisor: {
          nit: "100691455",
          nombre: "AMJK INVERSIONES, SOCIEDAD ANONIMA",
          nombreComercial: "AMJK INVERSIONES",
          direccion: {},
        },
        receptor: { nit: "111362067", nombre: "RECEPTOR" },
        items: [],
        totales: { iva: 0, granTotal: 0 },
        abonos: [],
        certificador: { nit: "62469045", nombre: "COFIDI" },
      },
      "logo.png"
    );
    expect(html).toContain("Resolución No. 6155219202612561719 21/09/2026");
    expect(html).not.toContain("6130294202615373132");
  });
});
