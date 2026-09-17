import { describe, expect, it } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { normalizarDpiPortal } from "../../lib/provisioning";
import {
  condicionDpiNormalizado,
  condicionEmail,
  ordenDesempateDpi,
} from "./dpiLookup";

// Este SQL no tenía NINGUNA prueba: se le podía borrar el ORDER BY entero —lo
// único que decide cuál de dos personas con el mismo DPI normalizado recibe el
// correo— y la suite seguía en verde. No hace falta base para comprobarlo:
// basta con compilar el SQL y mirar qué salió.
const aSql = (fragmento: SQL) => new PgDialect().sqlToQuery(fragmento);

describe("condicionDpiNormalizado", () => {
  it("normaliza LOS DOS lados, no solo el valor buscado", () => {
    const { sql, params } = aSql(condicionDpiNormalizado("4036613"));

    // Sin normalizar la columna, las filas sucias que ya están en producción
    // ('1573 66197 01', '1852752810101.') no se encuentran nunca.
    expect(sql).toContain("regexp_replace");
    expect(sql).toContain("ltrim");
    expect(sql).toContain("coalesce");
    expect(params).toEqual(["4036613"]);
  });

  it("limpia exactamente la basura de captura que existe: espacios, puntos y guiones", () => {
    expect(aSql(condicionDpiNormalizado("1")).sql).toContain("[[:space:].-]");
  });

  it("quita los ceros a la izquierda, igual que el lado de JS", () => {
    // Si SQL y JS no quitaran lo mismo, se guardaría un valor que la búsqueda
    // ya no encuentra y a la misma persona se le crearía una segunda cuenta.
    expect(aSql(condicionDpiNormalizado("1")).sql).toContain("'0'");
    expect(normalizarDpiPortal("04036613")).toBe("4036613");
  });
});

describe("ordenDesempateDpi", () => {
  // Hoy `1852752810101` empata a Oscar Massis (su DPI real) con la cuenta de
  // Inversiones Monaco (capturada con el DPI de su representante, más un
  // punto). Sin desempate, quién recibe el correo lo decide el planificador.
  it("prefiere la coincidencia EXACTA sobre la columna cruda", () => {
    const { sql, params } = aSql(ordenDesempateDpi("1852752810101"));

    expect(sql).toContain("DESC");
    expect(sql).toMatch(/"dpi"\s*=\s*\$1\)?\s*DESC/);
    expect(params).toEqual(["1852752810101"]);
  });

  it("desempata por created_at para que el resultado no cambie entre corridas", () => {
    const { sql } = aSql(ordenDesempateDpi("1"));

    expect(sql).toContain("created_at");
    expect(sql).toContain("ASC");
  });
});

describe("condicionEmail", () => {
  it("compara sin distinguir mayúsculas y sin comodines", () => {
    const { sql, params } = aSql(condicionEmail("ana@ejemplo.com"));

    expect(sql).toContain("lower(");
    // `ilike` leería `_` y `%` del correo como patrón: `john_smith@x.com`
    // casaría con `john.smith@x.com`.
    expect(sql.toLowerCase()).not.toContain("like");
    expect(params).toEqual(["ana@ejemplo.com"]);
  });
});
