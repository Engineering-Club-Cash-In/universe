import { describe, expect, it } from "bun:test";
import {
  diasDelMes,
  dosDigitos,
  etiquetaRango,
  rangoDesdeSeleccion,
  recortarDiaAlMes,
} from "./periodoGT";

describe("diasDelMes", () => {
  it("da el último día de cada mes", () => {
    expect(diasDelMes(2026, 1)).toBe(31); // enero
    expect(diasDelMes(2026, 4)).toBe(30); // abril
    expect(diasDelMes(2026, 12)).toBe(31); // diciembre
  });

  it("contempla bisiestos", () => {
    expect(diasDelMes(2024, 2)).toBe(29);
    expect(diasDelMes(2025, 2)).toBe(28);
    expect(diasDelMes(2000, 2)).toBe(29); // divisible por 400
    expect(diasDelMes(1900, 2)).toBe(28); // divisible por 100 pero no por 400
  });
});

describe("recortarDiaAlMes", () => {
  // El bug original: Año 2026 / Mes Enero / Día 31, el usuario cambia a
  // Febrero. El `<select>` de día se dibujaba en blanco ("Todo el mes") pero el
  // estado seguía en "31", y se armaba `2026-02-31`.
  it("recorta el día al último del mes nuevo", () => {
    expect(recortarDiaAlMes("31", "2026", "2")).toBe("28");
    expect(recortarDiaAlMes("31", "2024", "2")).toBe("29"); // bisiesto
    expect(recortarDiaAlMes("31", "2026", "4")).toBe("30"); // abril
  });

  it("deja el día tal cual si todavía cabe en el mes nuevo", () => {
    expect(recortarDiaAlMes("15", "2026", "2")).toBe("15");
    expect(recortarDiaAlMes("31", "2026", "3")).toBe("31");
  });

  it("recorta también al cambiar de AÑO (29-feb de un bisiesto al año siguiente)", () => {
    expect(recortarDiaAlMes("29", "2025", "2")).toBe("28");
    expect(recortarDiaAlMes("29", "2024", "2")).toBe("29");
  });

  it("limpia el día si el año o el mes quedan vacíos", () => {
    // Sin año no hay mes ni día que valgan.
    expect(recortarDiaAlMes("31", "", "2")).toBe("");
    expect(recortarDiaAlMes("31", "2026", "")).toBe("");
  });

  it("sin día elegido no inventa uno", () => {
    expect(recortarDiaAlMes("", "2026", "2")).toBe("");
  });

  it("no propaga basura", () => {
    expect(recortarDiaAlMes("abc", "2026", "2")).toBe("");
  });
});

describe("rangoDesdeSeleccion", () => {
  const base = { modo: "periodo" as const, anio: "", mes: "", dia: "", desde: "", hasta: "" };

  it("sin año no filtra nada", () => {
    expect(rangoDesdeSeleccion(base)).toEqual({ desde: "", hasta: "" });
  });

  it("solo año → el año completo", () => {
    expect(rangoDesdeSeleccion({ ...base, anio: "2026" })).toEqual({
      desde: "2026-01-01",
      hasta: "2026-12-31",
    });
  });

  it("año + mes → el mes completo, con su último día real", () => {
    expect(rangoDesdeSeleccion({ ...base, anio: "2026", mes: "2" })).toEqual({
      desde: "2026-02-01",
      hasta: "2026-02-28",
    });
    expect(rangoDesdeSeleccion({ ...base, anio: "2024", mes: "2" })).toEqual({
      desde: "2024-02-01",
      hasta: "2024-02-29",
    });
  });

  it("año + mes + día → ese día solo, con dos dígitos", () => {
    expect(rangoDesdeSeleccion({ ...base, anio: "2026", mes: "8", dia: "5" })).toEqual({
      desde: "2026-08-05",
      hasta: "2026-08-05",
    });
  });

  // Último cinturón: aunque el estado quedara desincronizado por cualquier vía,
  // de acá NO puede salir una fecha que no existe.
  it("NUNCA construye una fecha imposible", () => {
    expect(rangoDesdeSeleccion({ ...base, anio: "2026", mes: "2", dia: "31" })).toEqual({
      desde: "2026-02-28",
      hasta: "2026-02-28",
    });
    expect(rangoDesdeSeleccion({ ...base, anio: "2026", mes: "4", dia: "31" })).toEqual({
      desde: "2026-04-30",
      hasta: "2026-04-30",
    });
    expect(rangoDesdeSeleccion({ ...base, anio: "2026", mes: "1", dia: "0" })).toEqual({
      desde: "2026-01-01",
      hasta: "2026-01-01",
    });
  });

  it("en modo rango pasa desde/hasta tal cual", () => {
    expect(
      rangoDesdeSeleccion({
        ...base,
        modo: "rango",
        // El período se ignora por completo: los dos modos no conviven.
        anio: "2026",
        mes: "2",
        dia: "31",
        desde: "2026-01-01",
        hasta: "2026-03-15",
      })
    ).toEqual({ desde: "2026-01-01", hasta: "2026-03-15" });
  });
});

describe("dosDigitos", () => {
  it("rellena a dos dígitos", () => {
    expect(dosDigitos(1)).toBe("01");
    expect(dosDigitos("9")).toBe("09");
    expect(dosDigitos(12)).toBe("12");
  });
});

describe("etiquetaRango", () => {
  it("un solo día", () => {
    expect(etiquetaRango("2026-08-25", "2026-08-25")).toBe("el 25/08/2026");
  });

  it("rango de días", () => {
    expect(etiquetaRango("2026-08-01", "2026-08-31")).toBe(
      "del 01/08/2026 al 31/08/2026"
    );
  });

  it("extremos abiertos", () => {
    expect(etiquetaRango("2026-08-01", "")).toBe("desde el 01/08/2026");
    expect(etiquetaRango("", "2026-08-31")).toBe("hasta el 31/08/2026");
  });

  it("sin fechas no dice nada", () => {
    expect(etiquetaRango("", "")).toBe("");
  });
});
