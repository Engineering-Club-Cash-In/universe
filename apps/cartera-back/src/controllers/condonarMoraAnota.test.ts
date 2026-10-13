import "../utils/baseFalsaParaPruebas";
import { describe, test, expect } from "bun:test";
import { anotacionesDeCondonacion } from "./latefee";
import Big from "big.js";
import type { CuotaParaPendiente } from "../utils/moraPendiente";

describe("anotacionesDeCondonacion", () => {
  test("a) Dos cuotas, la más vieja con más días: el monto va primero a la más vieja", () => {
    // Setup: dos cuotas, la primera con 40 días de atraso, la segunda con 10 días
    // Capital = 1000, monto condonado = 100
    // TASA_MORA = 0.0112 (1.12%), BASE_DIAS = 30
    // Mora cuota1 = 1000 * 0.0112 * min(1, 40/30) = 11.2 * 1 = 11.2
    // Mora cuota2 = 1000 * 0.0112 * min(1, 10/30) = 11.2 * (10/30) = 3.7333...
    // El reparto de 100 va: 11.2 → cuota1, 3.7333 → cuota2, sobrante ≈ 84.9 (no se anota)
    const cuotas: CuotaParaPendiente[] = [
      { cuota_id: 1, diasAtraso: 40, pagado: 0 },
      { cuota_id: 2, diasAtraso: 10, pagado: 0 },
    ];

    const result = anotacionesDeCondonacion({
      credito_id: 123,
      monto: 100,
      capital: 1000,
      cuotas,
      usuario_id: 456,
      motivo: "Prueba",
    });

    expect(result).toHaveLength(2);
    expect(result[0].cuota_id).toBe(1);
    expect(result[0].tipo).toBe("CONDONACION");
    expect(result[0].pago_id).toBe(null);
    expect(result[0].usuario_id).toBe(456);
    expect(new Big(result[0].monto).toFixed(2)).toBe("11.20");
    expect(result[1].cuota_id).toBe(2);
    expect(new Big(result[1].monto).toFixed(2)).toBe("3.73");
  });

  test("b) Cuota con pagado previo: lo anotado en ella no supera su pendiente", () => {
    // Capital = 1000, una cuota con 30 días de atraso
    // Mora devengada = 1000 * 0.0112 * 1 = 11.2
    // Si pagado = 8, pendiente = 11.2 - 8 = 3.2
    // Si condonamos 100, solo se anota 3.2 en esa cuota (el pendiente)
    const cuotas: CuotaParaPendiente[] = [
      { cuota_id: 1, diasAtraso: 30, pagado: 8 },
    ];

    const result = anotacionesDeCondonacion({
      credito_id: 123,
      monto: 100,
      capital: 1000,
      cuotas,
      usuario_id: 456,
      motivo: "Prueba",
    });

    expect(result).toHaveLength(1);
    expect(new Big(result[0].monto).toFixed(2)).toBe("3.20");
  });

  test("c) Monto mayor que el pendiente total: la suma anotada == pendiente total", () => {
    // Capital = 1000, dos cuotas de 30 días c/u
    // TASA_MORA = 0.0112, mora c/u = 1000 * 0.0112 * 1 = 11.2
    // Mora total = 11.2 + 11.2 = 22.4
    // Si condonamos 1000, solo se anota 22.4 (el total pendiente, el sobrante se descarta)
    const cuotas: CuotaParaPendiente[] = [
      { cuota_id: 1, diasAtraso: 30, pagado: 0 },
      { cuota_id: 2, diasAtraso: 30, pagado: 0 },
    ];

    const result = anotacionesDeCondonacion({
      credito_id: 123,
      monto: 1000,
      capital: 1000,
      cuotas,
      usuario_id: 456,
      motivo: "Prueba",
    });

    const totalAnotado = result.reduce((sum, r) => sum.plus(new Big(r.monto)), new Big(0));
    expect(totalAnotado.toFixed(2)).toBe("22.40");
  });

  test("d) Toda anotación lleva tipo CONDONACION, pago_id null, usuario_id y motivo dados", () => {
    const cuotas: CuotaParaPendiente[] = [
      { cuota_id: 1, diasAtraso: 30, pagado: 0 },
    ];

    const result = anotacionesDeCondonacion({
      credito_id: 123,
      monto: 50,
      capital: 1000,
      cuotas,
      usuario_id: 789,
      motivo: "Condonación especial",
    });

    expect(result.length).toBeGreaterThan(0);
    for (const anotacion of result) {
      expect(anotacion.tipo).toBe("CONDONACION");
      expect(anotacion.pago_id).toBe(null);
      expect(anotacion.usuario_id).toBe(789);
      expect(anotacion.motivo).toBe("Condonación especial");
    }
  });

  test("e) Sin cuotas → []", () => {
    const result = anotacionesDeCondonacion({
      credito_id: 123,
      monto: 100,
      capital: 1000,
      cuotas: [],
      usuario_id: 456,
      motivo: "Prueba",
    });

    expect(result).toEqual([]);
  });

  test("f) GUARDA ESTRUCTURAL: condonarMora y condonarTodasLasMoras usan anotacionesDeCondonacion y anotarMoraPagada", async () => {
    // Este test verifica que las funciones tengan la estructura esperada
    const { readFileSync } = await import("fs");
    const filepath = new URL("./latefee.ts", import.meta.url);
    const contenido = readFileSync(filepath, "utf-8");

    // Buscar las funciones
    const condonarMoraMatch = contenido.match(/export async function condonarMora\([^)]*\)[^{]*\{[\s\S]*?^export async function/m);
    const condonarTodasMatch = contenido.match(/export async function condonarTodasLasMoras\([^)]*\)[^{]*\{[\s\S]*?^  \} catch/m);

    expect(condonarMoraMatch).toBeTruthy();
    expect(condonarTodasMatch).toBeTruthy();

    const condonarMoraBody = condonarMoraMatch?.[0] || "";
    const condonarTodasBody = condonarTodasMatch?.[0] || "";

    // Verificar que ambas usen anotacionesDeCondonacion
    expect(condonarMoraBody).toContain("anotacionesDeCondonacion(");
    expect(condonarTodasBody).toContain("anotacionesDeCondonacion(");

    // Verificar que ambas usen anotarMoraPagada
    expect(condonarMoraBody).toContain("anotarMoraPagada(");
    expect(condonarTodasBody).toContain("anotarMoraPagada(");

    // Verificar que condonarTodasLasMoras esté en transacción
    expect(condonarTodasBody).toContain("db.transaction(");
    // Las cuotas se leen por la MISMA transacción, en las dos condonaciones.
    expect(condonarTodasBody).toMatch(/cuotasParaPendienteDeCreditos\(\s*vigentes\.map\(\(v\) => v\.credito_id\),\s*tx\b/);
    expect(condonarMoraBody).toMatch(/cuotasParaPendienteDeCreditos\([^)]*\btx\b/);

    // Verificar que anotarMoraPagada en condonarTodasLasMoras use tx
    expect(condonarTodasBody).toContain("anotarMoraPagada(");
    const anotarMatch = condonarTodasBody.match(/anotarMoraPagada\([^;]*tx as unknown as typeof db/);
    expect(anotarMatch).toBeTruthy();

    // Verificar que registrarHistorialMora dentro de condonarTodasLasMoras use dbClient
    expect(condonarTodasBody).toContain("dbClient: tx as unknown as typeof db");
    expect(condonarTodasBody).toContain("propagarError: true");
  });

  // El candado de créditos de la masiva: desde `const bloqueados` hasta que se usan sus ids.
  const candadoDeLaMasiva = async () => {
    const { readFileSync } = await import("fs");
    const contenido = readFileSync(new URL("./latefee.ts", import.meta.url), "utf-8");
    const cuerpo = contenido.match(/export async function condonarTodasLasMoras\([^)]*\)[^{]*\{[\s\S]*?^  \} catch/m)?.[0] ?? "";
    const inicio = cuerpo.indexOf("const bloqueados = await tx");
    const fin = cuerpo.indexOf("const idsBloqueados");
    return { cuerpo, inicio, candado: inicio > -1 && fin > inicio ? cuerpo.slice(inicio, fin) : "" };
  };

  test("g) GUARDA ESTRUCTURAL (ARREGLO 2): el FOR UPDATE en creditos aparece ANTES que el UPDATE en moras_credito", async () => {
    const { cuerpo, inicio, candado } = await candadoDeLaMasiva();
    expect(candado).toContain('.for("update")');
    const update = cuerpo.indexOf(".update(moras_credito)");
    expect(inicio).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(-1);
    expect(inicio).toBeLessThan(update);
  });

  test("h) la relectura de moras_credito también bloquea las filas (un /mora manual no toma el candado del crédito)", async () => {
    const { cuerpo, inicio, candado } = await candadoDeLaMasiva();
    const vigentes = cuerpo.indexOf("const vigentes = await tx");
    const relectura = cuerpo.slice(vigentes, cuerpo.indexOf("if (vigentes.length === 0)"));
    const update = cuerpo.indexOf(".update(moras_credito)");

    expect(relectura).toContain('.for("update")');
    expect(candado).toContain('.for("update")');
    expect(inicio).toBeGreaterThan(-1);
    expect(inicio).toBeLessThan(vigentes);
    expect(vigentes).toBeLessThan(update);
  });

  test("i) el candado de créditos vuelve a exigir MOROSO (un crédito cancelado en la carrera no se condona)", async () => {
    const { candado } = await candadoDeLaMasiva();
    expect(candado).toContain('eq(creditos.statusCredit, "MOROSO")');
  });

  test("j) el candado de la masiva no usa `FOR UPDATE OF`: sin JOIN, la mora activa va en un EXISTS", async () => {
    const { candado } = await candadoDeLaMasiva();
    // Con JOIN a moras_credito haría falta `OF creditos`, y drizzle lo escribe
    // calificado con el schema: Postgres lo rechaza y la masiva falla siempre.
    expect(candado).not.toContain("{ of:");
    expect(candado).not.toContain("innerJoin(");
    expect(candado).toContain("exists(");
    expect(candado).toContain("eq(moras_credito.credito_id, creditos.credito_id)");
  });

  test("k) GUARDA DE REPO: ningún archivo de src usa `.for(\"update\", { of:`", async () => {
    // drizzle escribe `FOR UPDATE OF "cartera"."tabla"` (calificado con el
    // schema) y Postgres exige nombres sin calificar: "FOR UPDATE must specify
    // unqualified relation names". Las pruebas con base falsa no lo ven, así
    // que cualquier uso nuevo fallaría recién en producción. Si hace falta
    // bloquear solo una tabla de un JOIN, sacar el JOIN a un EXISTS.
    const { readdirSync, readFileSync, statSync } = await import("fs");
    const { join } = await import("path");
    const { fileURLToPath } = await import("url");
    const src = fileURLToPath(new URL("..", import.meta.url));
    const culpables: string[] = [];
    const recorrer = (dir: string) => {
      for (const nombre of readdirSync(dir)) {
        const ruta = join(dir, nombre);
        if (statSync(ruta).isDirectory()) { if (nombre !== "node_modules") recorrer(ruta); continue; }
        if (!/\.tsx?$/.test(nombre) || /\.test\.tsx?$/.test(nombre)) continue;
        if (/\.for\(\s*["']update["']\s*,\s*\{\s*of:/.test(readFileSync(ruta, "utf-8"))) culpables.push(ruta.slice(src.length));
      }
    };
    recorrer(src);
    expect(culpables).toEqual([]);
  });

  test("k) condonarMora individual solo baja a ACTIVO un crédito MOROSO (un CANCELADO no cambia de estado)", async () => {
    const { readFileSync } = await import("fs");
    const contenido = readFileSync(new URL("./latefee.ts", import.meta.url), "utf-8");
    const cuerpo = contenido.match(/export async function condonarMora\([^)]*\)[^{]*\{[\s\S]*?^export async function/m)?.[0] ?? "";
    const idx = cuerpo.indexOf('.set({ statusCredit: "ACTIVO" })');
    expect(idx).toBeGreaterThan(-1);
    const update = cuerpo.slice(idx, cuerpo.indexOf(";", idx));
    expect(update).toContain('eq(creditos.statusCredit, "MOROSO")');
    // Y la mora se condona igual: el UPDATE de la mora no depende del estado.
    expect(cuerpo.indexOf(".update(moras_credito)")).toBeLessThan(idx);
  });
});
