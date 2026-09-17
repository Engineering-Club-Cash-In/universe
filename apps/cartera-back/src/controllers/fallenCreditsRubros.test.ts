import { describe, expect, it, mock } from "bun:test";
import {
  creditos,
  creditos_caidos,
  cuotas_credito,
  pagos_credito,
  rubros,
} from "../database/db";

// ─────────────────────────────────────────────────────────────────────────────
// Marcar un crédito como CAIDO borra TODOS sus pagos, y la FK
// `rubros_pagos.pago_id` es `ON DELETE CASCADE`. O sea que los reclamos de rubros
// se van con los pagos — pero el rubro NO, porque el crédito no se borra.
//
// El rubro queda entonces con el `saldo_pendiente` descontado por plata cuyo
// registro ya no existe: nadie puede reconstruir desde los reclamos qué se le
// cobró. Y si había llegado a cero, queda `completado = true` sin nada que lo
// respalde.
//
// Por eso se BLOQUEA en vez de restaurar el saldo. Restaurarlo sería volver a
// cobrarle al cliente plata que pagó de verdad. El operador decide explícito:
// anula el rubro —que deja registro de la decisión— y después marca el crédito.
//
// Dos cosas se fijan acá, y la segunda es la que evita cambiar una carrera
// esporádica por un cuelgue:
//
//   1. QUE bloquee, y que un rubro ya saldado o anulado NO bloquee.
//   2. Que el advisory lock se tome POR ENCIMA de `db.transaction`. El helper
//      espera en un pool dedicado justamente para que la espera no toque el
//      pool de trabajo, pero una transacción alrededor lo anula: sigue
//      RETENIENDO su conexión de trabajo mientras se espera, y suficientes
//      waiters así dejan sin conexión al dueño del lock, que necesita una para
//      su propia transacción. El orden del módulo es advisory AFUERA,
//      transacción adentro.
// ─────────────────────────────────────────────────────────────────────────────

const NOMBRES = new Map<unknown, string>([
  [creditos, "creditos"],
  [cuotas_credito, "cuotas_credito"],
  [pagos_credito, "pagos_credito"],
  [rubros, "rubros"],
  [creditos_caidos, "creditos_caidos"],
]);

let eventos: string[] = [];
let filas = new Map<unknown, unknown[]>();

/**
 * Qué columnas menciona una condición de drizzle. Se camina el árbol juntando
 * los `name`, que es donde drizzle guarda el nombre de columna.
 *
 * Existe para que el motor falso HONRE el filtro en vez de devolver las filas
 * crudas. Si no, los casos "un rubro pagado no bloquea" y "un rubro anulado no
 * bloquea" no probarían nada: la fila llegaría igual y el guard bloquearía
 * siempre. Y leyendo la condición de verdad —en vez de filtrar a mano— quitar el
 * filtro del código de producción pone el test en rojo, que es el punto.
 */
const columnasEn = (cond: unknown): Set<string> => {
  const vistas = new Set<string>();
  // Se camina SÓLO `queryChunks`, que es donde drizzle anida las condiciones de
  // un `and(...)`. Caminar el objeto entero no sirve —fue el primer intento y
  // salió un test decorativo—: cada columna guarda una referencia a SU TABLA, y
  // la tabla lista TODAS sus columnas, así que el recorrido terminaba juntando
  // `completado` y `anulado` aunque la condición no los mencionara. El motor
  // filtraba igual y quitar el filtro del código de producción no rompía nada.
  const pila: unknown[] = [cond];
  const yaVistos = new Set<unknown>();

  while (pila.length > 0) {
    const nodo: any = pila.pop();
    if (nodo === null || typeof nodo !== "object") continue;
    if (yaVistos.has(nodo)) continue;
    yaVistos.add(nodo);

    if (typeof nodo.name === "string") vistas.add(nodo.name);
    if (Array.isArray(nodo.queryChunks)) pila.push(...nodo.queryChunks);
    if (Array.isArray(nodo)) pila.push(...nodo);
  }
  return vistas;
};

const cadena = (verbo: string, tablaInicial?: unknown) => {
  const paso: { tabla: unknown; cond: unknown } = {
    tabla: tablaInicial,
    cond: undefined,
  };
  const eslabon: any = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "then") {
          return (ok: any, err: any) => {
            eventos.push(`${verbo}:${NOMBRES.get(paso.tabla) ?? "?"}`);
            let r = filas.get(paso.tabla) ?? [];

            // Sólo para los SELECT de `rubros`, que es donde el filtro ES la
            // conducta a fijar. El resto de las tablas devuelve su fixture.
            if (verbo === "select" && paso.tabla === rubros) {
              const cols = columnasEn(paso.cond);
              r = r.filter((fila) => {
                const f = fila as Record<string, unknown>;
                if (cols.has("anulado") && f.anulado === true) return false;
                if (cols.has("completado") && f.completado === true) return false;
                return true;
              });
            }

            return Promise.resolve(verbo === "insert" ? [{ id: 1 }] : r).then(ok, err);
          };
        }
        return (...args: any[]) => {
          if (prop === "from") paso.tabla = args[0];
          if (prop === "where") paso.cond = args[0];
          return eslabon;
        };
      },
    }
  );
  return eslabon;
};

const motor: any = {
  select: () => cadena("select"),
  insert: (t: unknown) => cadena("insert", t),
  update: (t: unknown) => cadena("update", t),
  delete: (t: unknown) => cadena("delete", t),
};
motor.transaction = async (cb: any) => {
  eventos.push("tx:begin");
  try {
    return await cb(motor);
  } finally {
    eventos.push("tx:end");
  }
};

const fakeDb = () => ({
  db: motor,
  client: {},
  lockPool: { connect: async () => ({ query: async () => {}, release: () => {} }) },
});
mock.module("../database", fakeDb);
mock.module("../database/index", fakeDb);

mock.module("../utils/paymentAdvisoryLock", () => ({
  PAYMENT_ADVISORY_LOCK_NAMESPACE: 8765,
  withPaymentAdvisoryLock: async (clave: number, fn: () => Promise<any>) => {
    eventos.push(`lock:${clave}`);
    try {
      return await fn();
    } finally {
      eventos.push("unlock");
    }
  },
}));

const { marcarCreditoComoCaido } = await import("./fallenCredits");

const unRubro = (over: Record<string, unknown> = {}) => ({
  rubro_id: 4,
  credito_id: 9,
  descripcion: "Tarjeta de circulación 2026",
  saldo_pendiente: "300.00",
  anulado: false,
  completado: false,
  ...over,
});

/** Crédito VIGENTE con cuota 0, y los rubros que se le pasen. */
const preparar = (rubrosDelCredito: unknown[]) => {
  eventos = [];
  filas = new Map<unknown, unknown[]>([
    [creditos, [{ credito_id: 9, statusCredit: "VIGENTE" }]],
    [cuotas_credito, [{ cuota_id: 100 }]],
    [pagos_credito, []],
    [rubros, rubrosDelCredito],
    [creditos_caidos, []],
  ]);
};

const marcar = () =>
  marcarCreditoComoCaido({ credito_id: 9, motivo: "Incumplimiento" });

describe("marcarCreditoComoCaido — rubros con deuda viva", () => {
  it("no marca el crédito si hay un rubro con deuda, y no borra nada", async () => {
    preparar([unRubro()]);

    const r = await marcar();

    expect(r.success).toBe(false);
    expect(eventos).not.toContain("delete:pagos_credito");
    expect(eventos).not.toContain("delete:cuotas_credito");
    expect(eventos).not.toContain("update:creditos");
  });

  it("el mensaje nombra el rubro, porque la salida es anularlo", async () => {
    // Un rechazo que no dice qué anular deja al operador adivinando cuál de los
    // cargos del crédito lo está frenando.
    preparar([unRubro()]);

    const r = await marcar();

    expect(r.message).toContain("Tarjeta de circulación 2026");
  });

  it("el mensaje dice QUIÉN puede anular, porque la ruta de anular es ADMIN", async () => {
    // `POST /fallen-credits` no pide rol; `POST /rubros/:id/anular` sí, es ADMIN.
    // Sin decirlo, el rechazo mandaba a un usuario no-ADMIN a comerse un 403
    // siguiendo la instrucción — el mismo callejón que el guard de
    // `/recalculate` tuvo cuando bloqueaba por `anulado` y pedía anular algo que
    // `puedeAnularRubro` iba a rechazar.
    preparar([unRubro()]);

    const r = await marcar();

    expect(r.message).toContain("ADMIN");
  });

  it("el mensaje NO afirma que se cobró plata, porque puede no haberse cobrado", async () => {
    // El guard bloquea por deuda viva aunque el rubro no tenga ni un abono.
    // Decirle al operador que se pierde "lo que ya se le cobró" sería mentirle
    // sobre plata que nunca entró, y encima le tapa la duda real: lo que se
    // pierde es el respaldo de lo que se HAYA cobrado, si algo se cobró.
    preparar([unRubro({ saldo_pendiente: "500.00" })]);

    const r = await marcar();

    expect(r.message).not.toContain("ya se le cobró");
    expect(r.message).toContain("se le haya cobrado");
  });

  it("un rubro ya PAGADO no bloquea", async () => {
    // `completado = true` con `anulado = false` es un rubro cobrado entero, y
    // `puedeAnularRubro` lo rechaza con 409 ("no hay nada que anular"). Si
    // bloqueara, el crédito quedaría imposible de marcar para siempre y el
    // mensaje le pediría al operador justo lo que el sistema le va a negar.
    preparar([unRubro({ completado: true, saldo_pendiente: "0.00" })]);

    const r = await marcar();

    expect(r.success).toBe(true);
    expect(eventos).toContain("delete:pagos_credito");
  });

  it("un rubro ANULADO no bloquea", async () => {
    preparar([unRubro({ anulado: true })]);

    const r = await marcar();

    expect(r.success).toBe(true);
  });

  it("sin rubros sigue funcionando igual que antes", async () => {
    preparar([]);

    const r = await marcar();

    expect(r.success).toBe(true);
    expect(eventos).toContain("delete:pagos_credito");
    expect(eventos).toContain("delete:cuotas_credito");
    expect(eventos).toContain("update:creditos");
    expect(eventos).toContain("insert:creditos_caidos");
  });

  it("🔒 toma el candado POR ENCIMA de la transacción", async () => {
    // Si se tomara adentro, `withPaymentAdvisoryLock` pediría una conexión al
    // `lockPool` mientras la transacción retiene una del pool de trabajo: es el
    // deadlock de pool que prohíbe el helper. El orden es lo que se fija acá.
    preparar([]);

    await marcar();

    const lock = eventos.indexOf("lock:9");
    const abreTx = eventos.indexOf("tx:begin");
    const cierraTx = eventos.indexOf("tx:end");
    const unlock = eventos.indexOf("unlock");

    expect(lock).toBeGreaterThanOrEqual(0);
    expect(abreTx).toBeGreaterThan(lock);
    expect(unlock).toBeGreaterThan(cierraTx);
  });

  it("🔒 el chequeo de rubros también va bajo el candado", async () => {
    // Afuera sería un TOCTOU: entre el SELECT y el borrado, un `crearRubro`
    // puede commitear un rubro nuevo y el DELETE se lleva su reclamo igual.
    preparar([]);

    await marcar();

    const lock = eventos.indexOf("lock:9");
    const chequeo = eventos.indexOf("select:rubros");
    const unlock = eventos.indexOf("unlock");

    expect(chequeo).toBeGreaterThan(lock);
    expect(chequeo).toBeLessThan(unlock);
  });
});
