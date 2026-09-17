import { describe, expect, it } from "bun:test";
import { diaISOGT, fmtFechaGT, fmtFechaHoraGT } from "./fechaGT";

// El caso real que motivó el helper: el cron de las 23:59 hora de Guatemala
// del 08-sep queda guardado como 2026-09-09 05:59:05 UTC en un `timestamp`
// sin zona, y el backend lo serializa como string desnudo.
const CRON_2359_DEL_8 = "2026-09-09 05:59:05.245566";

describe("fmtFechaHoraGT", () => {
  it("lee el timestamp sin zona como UTC y lo muestra en Guatemala", () => {
    // Antes se veía "09/09/2026 05:59 a.m.": corrido 6 horas y un día.
    expect(fmtFechaHoraGT(CRON_2359_DEL_8)).toContain("08/09/2026");
    expect(fmtFechaHoraGT(CRON_2359_DEL_8)).toContain("11:59");
  });

  it("da el mismo resultado venga como venga el instante", () => {
    const esperado = fmtFechaHoraGT(CRON_2359_DEL_8);
    expect(fmtFechaHoraGT("2026-09-09T05:59:05.245Z")).toBe(esperado);
    // Postgres escribe el offset con dos dígitos: "+00", no "+00:00".
    expect(fmtFechaHoraGT("2026-09-09 05:59:05.245566+00")).toBe(esperado);
    expect(fmtFechaHoraGT(new Date("2026-09-09T05:59:05.245Z"))).toBe(esperado);
  });

  it("no se rompe con null, vacío ni basura", () => {
    expect(fmtFechaHoraGT(null)).toBe("--");
    expect(fmtFechaHoraGT(undefined)).toBe("--");
    expect(fmtFechaHoraGT("")).toBe("--");
    // Mismo fallback que traía el `fmtFecha` original: se muestra lo que vino
    // recortado, sin inventar una fecha.
    expect(fmtFechaHoraGT("no-es-fecha")).toBe("no-es-fech");
  });
});

describe("fmtFechaGT", () => {
  it("muestra el día de Guatemala, no el de UTC", () => {
    expect(fmtFechaGT(CRON_2359_DEL_8)).toBe("08/09/2026");
  });

  it("un valor de solo fecha no se corre de día", () => {
    expect(fmtFechaGT("2026-09-09")).toBe("09/09/2026");
  });
});

describe("diaISOGT", () => {
  it("devuelve el mismo día que se está mostrando en pantalla", () => {
    // Es la invariante que hace honesto el filtro Desde/Hasta: si diaISOGT
    // dijera "2026-09-09" mientras la fila muestra 08/09, filtrar por
    // hasta=2026-09-08 escondería un evento visible.
    expect(diaISOGT(CRON_2359_DEL_8)).toBe("2026-09-08");
    expect(fmtFechaGT(CRON_2359_DEL_8)).toBe("08/09/2026");
  });

  it("acepta las mismas formas que el formateador", () => {
    expect(diaISOGT("2026-09-09T05:59:05.245Z")).toBe("2026-09-08");
    expect(diaISOGT("2026-09-09 05:59:05.245566+00")).toBe("2026-09-08");
    expect(diaISOGT(new Date("2026-09-09T05:59:05.245Z"))).toBe("2026-09-08");
    expect(diaISOGT("2026-09-09")).toBe("2026-09-09");
  });

  it("por la tarde el día de Guatemala y el de UTC coinciden", () => {
    expect(diaISOGT("2026-09-09 18:30:00")).toBe("2026-09-09");
  });

  it("devuelve string vacío cuando no hay fecha", () => {
    expect(diaISOGT(null)).toBe("");
    expect(diaISOGT("")).toBe("");
  });
});
