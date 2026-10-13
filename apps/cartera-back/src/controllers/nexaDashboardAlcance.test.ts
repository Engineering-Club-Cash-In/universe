import { describe, expect, test } from "bun:test";
// El controlador importa la base; con una URL inalcanzable el pool se crea sin conectarse.
process.env.SUPABASE_DB_URL ??= "postgresql://test@127.0.0.1:1/test";
const { parseAsesorFiltro, resolverAlcanceNexa } = await import("./nexaDashboard");

describe("parseAsesorFiltro", () => {
  test.each([
    ["7", 7],
    ["2147483647", 2_147_483_647],
    [undefined, null],
    ["", null],
    ["0", null],
    ["-3", null],
    ["1.5", null],
    ["1e3", null],
    [" 7", null],
    ["07", null],
    ["2147483648", null],
    ["99999999999", null],
    ["1 OR 1=1", null],
    ["7; DROP TABLE x", null],
    [7, null],
    [["7", "8"], null],
  ])("%j → %j", (valor, esperado) => {
    expect(parseAsesorFiltro(valor)).toBe(esperado);
  });
});

describe("resolverAlcanceNexa", () => {
  const asesor = (asesor_id: number | null, is_active = true, role = "ASESOR") => ({ role, is_active, asesor_id });

  test("ASESOR: siempre su asesor de la base, aunque pida otro", () => {
    expect(resolverAlcanceNexa("ASESOR", asesor(3), 9)).toEqual({ tipo: "asesor", asesorId: 3 });
    expect(resolverAlcanceNexa("ASESOR", asesor(3), null)).toEqual({ tipo: "asesor", asesorId: 3 });
  });

  test("ASESOR sin vínculo, inactivo o sin fila: ninguno (cierra en falso)", () => {
    expect(resolverAlcanceNexa("ASESOR", asesor(null), 9)).toEqual({ tipo: "ninguno" });
    expect(resolverAlcanceNexa("ASESOR", asesor(3, false), null)).toEqual({ tipo: "ninguno" });
    expect(resolverAlcanceNexa("ASESOR", null, 9)).toEqual({ tipo: "ninguno" });
    expect(resolverAlcanceNexa("ASESOR", asesor(0), null)).toEqual({ tipo: "ninguno" });
  });

  test("token viejo de ADMIN cuya fila hoy es ASESOR: se acota como asesor", () => {
    expect(resolverAlcanceNexa("ADMIN", asesor(3), null)).toEqual({ tipo: "asesor", asesorId: 3 });
    expect(resolverAlcanceNexa("ADMIN", asesor(null), 5)).toEqual({ tipo: "ninguno" });
  });

  test("ADMIN y CONTA: todos, o el asesor pedido", () => {
    for (const rol of ["ADMIN", "CONTA"]) {
      const sesion = { role: rol, is_active: true, asesor_id: null };
      expect(resolverAlcanceNexa(rol, sesion, null)).toEqual({ tipo: "todos" });
      expect(resolverAlcanceNexa(rol, sesion, 4)).toEqual({ tipo: "asesor", asesorId: 4 });
    }
  });

  test("ADMIN y CONTA con sesión inválida: ninguno, aunque pidan un asesor", () => {
    for (const rol of ["ADMIN", "CONTA"]) {
      const sesion = (extra: object) => ({ role: rol, is_active: true, asesor_id: null, ...extra });
      expect(resolverAlcanceNexa(rol, null, null)).toEqual({ tipo: "ninguno" });
      expect(resolverAlcanceNexa(rol, null, 4)).toEqual({ tipo: "ninguno" });
      expect(resolverAlcanceNexa(rol, sesion({ is_active: false }), null)).toEqual({ tipo: "ninguno" });
      expect(resolverAlcanceNexa(rol, sesion({ is_active: null }), null)).toEqual({ tipo: "ninguno" });
      expect(resolverAlcanceNexa(rol, sesion({ role: "INVESTOR" }), 4)).toEqual({ tipo: "ninguno" });
      expect(resolverAlcanceNexa(rol, sesion({ role: null }), null)).toEqual({ tipo: "ninguno" });
    }
  });

  test("token ADMIN con la fila hoy CONTA (rol permitido): sigue viendo todo", () => {
    expect(resolverAlcanceNexa("ADMIN", { role: "CONTA", is_active: true, asesor_id: null }, null)).toEqual({ tipo: "todos" });
  });
});
