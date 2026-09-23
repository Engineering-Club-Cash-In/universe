import { describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * El listado de créditos tiene que traer el RITMO y el TECHO de la mora.
 *
 * Por qué este archivo existe: los dos campos se calculaban solo en
 * `getCreditoByNumero`, pero las tarjetas de escritorio y móvil del listado
 * reciben su `item` de `getCreditosWithUserByMesAnio`. Ahí llegaban
 * `undefined`, `construirMoraTarjeta` devolvía `ritmo` y `techo` en `null` y
 * NINGÚN mensaje de crecimiento o de techo se mostraba jamás. Se prueban las
 * dos mitades: que el cálculo en conjunto dé los valores correctos, y que NO
 * cueste una consulta por crédito.
 */

// El árbol de imports de `credits.ts` arrastra el paquete de correo, que
// revienta al cargar si no hay credenciales. Este test no manda correos.
process.env.RESEND_API_KEY ||= "test";
process.env.EMAIL_DOMAIN ||= "test.local";

// --- doble de `db`: cuenta las consultas y devuelve cuotas a pedido ---------
let cuotasDevueltas: any[] = [];
let selectsHechos = 0;

const dbFalso = {
  select: (_fields?: unknown) => {
    selectsHechos += 1;
    const chain = {
      from: () => chain,
      leftJoin: () => chain,
      innerJoin: () => chain,
      where: () => Promise.resolve(cuotasDevueltas),
      orderBy: () => Promise.resolve(cuotasDevueltas),
    };
    return chain;
  },
  execute: () => Promise.resolve({ rows: [] }),
  transaction: (fn: any) => fn(dbFalso),
};

mock.module("../database/index", () => ({
  db: dbFalso,
  client: {},
  lockPool: {},
}));

const { incrementosMoraPorCredito, limiteHorizonteMora } = await import(
  "./credits"
);

// Hoy FIJO: los días de atraso de cada caso se calculan contra esta fecha.
const HOY = new Date(2026, 8, 22); // 22-sep-2026, hora de pared de Guatemala
const diasAntes = (n: number) => {
  const d = new Date(2026, 8, 22 - n);
  return [
    String(d.getFullYear()).padStart(4, "0"),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
};

const cuota = (credito_id: number, vence: string) => ({
  credito_id,
  fecha_vencimiento: vence,
  pagado: false,
  hasPaidPayment: false,
});

describe("incrementosMoraPorCredito: el listado provee ritmo y techo", () => {
  it("crédito con mora que SUBE: ritmo y techo positivos", async () => {
    cuotasDevueltas = [cuota(1, diasAntes(10))];
    const mapa = await incrementosMoraPorCredito(
      [{ credito_id: 1, capital: "10000", statusCredit: "MOROSO" }],
      HOY,
    );
    // capital 10.000 × 1,12% = Q112 de cargo mensual; a 10 días lleva Q37,33 y
    // a 11 días Q41,07 → sube Q3,74 mañana. El techo es lo que falta para el
    // cargo completo: 112 − 37,33 = Q74,67.
    expect(mapa.get(1)).toEqual({
      incrementoDiarioMora: "3.74",
      incrementoMaximoMensualMora: "74.67",
    });
  });

  it("crédito TOPADO: ya devengó el cargo completo, ritmo y techo en cero", async () => {
    cuotasDevueltas = [cuota(2, diasAntes(60))];
    const mapa = await incrementosMoraPorCredito(
      [{ credito_id: 2, capital: "10000", statusCredit: "MOROSO" }],
      HOY,
    );
    expect(mapa.get(2)).toEqual({
      incrementoDiarioMora: "0.00",
      incrementoMaximoMensualMora: "0.00",
    });
  });

  it("crédito SIN mora: ninguna cuota en el horizonte → cero, nunca ausente", async () => {
    cuotasDevueltas = [];
    const mapa = await incrementosMoraPorCredito(
      [{ credito_id: 3, capital: "10000", statusCredit: "ACTIVO" }],
      HOY,
    );
    expect(mapa.get(3)).toEqual({
      incrementoDiarioMora: "0.00",
      incrementoMaximoMensualMora: "0.00",
    });
  });

  it("crédito en estado EXCLUIDO: la cuota atrasada no cuenta", async () => {
    // La MISMA cuota del primer caso, que allá daba Q3,74.
    cuotasDevueltas = [cuota(4, diasAntes(10))];
    const mapa = await incrementosMoraPorCredito(
      [{ credito_id: 4, capital: "10000", statusCredit: "EN_CONVENIO" }],
      HOY,
    );
    expect(mapa.get(4)).toEqual({
      incrementoDiarioMora: "0.00",
      incrementoMaximoMensualMora: "0.00",
    });
  });

  it("la cuota que vence DENTRO del horizonte ya mueve el techo", async () => {
    // Vence en 5 días: mañana todavía no cobra nada (diario 0), pero dentro de
    // 30 días lleva 25 de atraso → el techo NO puede ser cero.
    cuotasDevueltas = [cuota(5, diasAntes(-5))];
    const mapa = await incrementosMoraPorCredito(
      [{ credito_id: 5, capital: "10000", statusCredit: "ACTIVO" }],
      HOY,
    );
    expect(mapa.get(5)?.incrementoDiarioMora).toBe("0.00");
    // 112 × 25/30 = Q93,33. Si los días se aplastaran a 0 (`diasAtrasoMora` en
    // vez de la versión CON SIGNO) la cuota empezaría a cobrar desde hoy y el
    // techo daría el cargo completo, Q112.00.
    expect(mapa.get(5)?.incrementoMaximoMensualMora).toBe("93.33");
  });

  it("MUTACIÓN: el horizonte llega a hoy + 30 días exactos", () => {
    expect(limiteHorizonteMora(HOY)).toBe("2026-10-22");
  });

  it("NO cuesta una consulta por crédito: una página entera es UNA consulta", async () => {
    cuotasDevueltas = Array.from({ length: 40 }, (_, i) =>
      cuota((i % 20) + 1, diasAntes(10)),
    );
    selectsHechos = 0;
    const pagina = Array.from({ length: 20 }, (_, i) => ({
      credito_id: i + 1,
      capital: "10000",
      statusCredit: "MOROSO",
    }));
    const mapa = await incrementosMoraPorCredito(pagina, HOY);

    expect(selectsHechos).toBe(1);
    expect(mapa.size).toBe(20);
  });

  it("página vacía: ni una consulta", async () => {
    selectsHechos = 0;
    const mapa = await incrementosMoraPorCredito([], HOY);
    expect(selectsHechos).toBe(0);
    expect(mapa.size).toBe(0);
  });
});

describe("CONTRATO: el listado cablea los dos campos, y fuera del loop", () => {
  const fuente = readFileSync(
    new URL("./credits.ts", import.meta.url),
    "utf8",
  );

  it("el EXISTS del pago aplicado CALIFICA la columna de la cuota", () => {
    // `${cuotas_credito.cuota_id}` lo renderiza como `"cuota_id"` pelado, y
    // adentro del EXISTS gana el alcance interno: `pc.cuota_id = pc.cuota_id`,
    // siempre cierto. Con eso el EXISTS pasa a preguntar "¿hay ALGÚN pago
    // aplicado en toda la tabla?" —true para todas las cuotas—, ninguna cuota
    // queda elegible y el incremento da "0.00" siempre, en el listado Y en el
    // detalle. Este test lo fija sobre el fuente porque el doble de `db` de
    // arriba nunca ejecuta SQL de verdad.
    expect(fuente).not.toContain(
      "WHERE pc.cuota_id = ${cuotas_credito.cuota_id}",
    );
    expect(fuente).toContain(
      'WHERE pc.cuota_id = "cartera"."cuotas_credito"."cuota_id"',
    );
  });
  const listado = fuente.slice(
    fuente.indexOf("export async function getCreditosWithUserByMesAnio"),
  );
  const cuerpo = listado.slice(0, listado.indexOf("\ntype Aporte"));

  it("los dos campos viajan en cada fila del listado", () => {
    expect(cuerpo).toContain("incrementoDiarioMora:");
    expect(cuerpo).toContain("incrementoMaximoMensualMora:");
  });

  it("se llama UNA sola vez en todo el listado", () => {
    const llamadas = cuerpo.match(/incrementosMoraPorCredito\(/g) ?? [];
    expect(llamadas).toHaveLength(1);
  });

  it("la llamada va ANTES del map final, no dentro de él", () => {
    // El único loop por crédito del listado es el `rows.forEach` del MAP FINAL.
    // Meter ahí la llamada la volvería una consulta por fila, que es justo lo
    // que este cableado existe para evitar.
    const idxLlamada = cuerpo.indexOf("incrementosMoraPorCredito(");
    const idxMapFinal = cuerpo.indexOf("MAP FINAL");
    expect(idxLlamada).toBeGreaterThan(-1);
    expect(idxMapFinal).toBeGreaterThan(-1);
    expect(idxLlamada).toBeLessThan(idxMapFinal);
    // Y recibe una LISTA, no un crédito suelto.
    expect(cuerpo.slice(idxLlamada, idxLlamada + 120)).toContain("[");
  });
});
