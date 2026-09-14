import { describe, expect, it, mock } from "bun:test";
import { lockPoolMock } from "../utils/testMocks";

// ─────────────────────────────────────────────────────────────────────────────
// `crearRubro` contra la carrera con `eliminarTipo` — hallazgo de Codex en el
// PR #1602.
//
// El bloqueo (`FOR KEY SHARE` sobre el tipo, tomado ANTES del INSERT) es lo que
// cierra la ventana de verdad, y eso no se puede probar sin dos transacciones
// reales corriendo en paralelo contra Postgres. Lo que SÍ se puede probar sin
// base de datos es la red de seguridad: si por debajo del bloqueo —o por
// cualquier otra vía— el INSERT de `rubros` choca contra la FK de `tipo_id`,
// `crearRubro` tiene que traducirlo a un 409 legible en vez de dejarlo escapar
// como el 500 crudo que Codex encontró.
//
// Mismo montaje que `rubrosGuards.test.ts`: se mockea "../database" con un
// motor de cola falso, porque `mock.module` es global en bun test y no puede
// convivir con un controlador que ya haya importado el módulo real.
// ─────────────────────────────────────────────────────────────────────────────

type Paso = any[] | { rechaza: unknown };

/**
 * Mismo motor de `rubrosGuards.test.ts`, con un agregado: un paso puede pedir
 * que ese `await` en particular RECHACE (no sólo resolver con una lista vacía).
 * Es lo único que hace falta para simular "el INSERT choca contra la FK":
 * todos los `select` de camino se resuelven normal y el `insert` final revienta.
 */
const motorConCola = (...pasos: Paso[]) => {
  const cola = [...pasos];
  const eslabon: any = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "then") {
          return (ok: any, err: any) => {
            const paso = cola.shift();
            if (paso && typeof paso === "object" && "rechaza" in paso) {
              return Promise.reject(paso.rechaza).then(ok, err);
            }
            return Promise.resolve(paso ?? []).then(ok, err);
          };
        }
        return (..._args: any[]) => eslabon;
      },
    }
  );

  const motor: any = {
    select: () => eslabon,
    insert: () => eslabon,
    update: () => eslabon,
    delete: () => eslabon,
    execute: () => Promise.reject(new Error("sin BD en tests")),
  };
  motor.transaction = (cb: any) => cb(motor);
  return motor;
};

/** Mismo código que usa `esViolacionFk` en rubros.ts. */
const errorFk = () => Object.assign(new Error("insert or update on table violates fk"), {
  code: "23503",
});

let dbImpl: any = motorConCola();
mock.module("../database", () => ({
  db: new Proxy({}, { get: (_t, p) => dbImpl[p] }),
  client: {},
  // `lockPool` va aunque este archivo no lo use. Desde que `rubros.ts` importa
  // `paymentAdvisoryLock.ts` —que hace `import { lockPool } from "../database"`—
  // ese archivo revienta al cargarse si el mock no la trae. Sin esta clave el
  // test pasa SOLO cuando corre junto a `rubrosGuards.test.ts`, cuyo mock global
  // sí la exporta: verde por accidente de orden, rojo en cuanto corre solo.
  lockPool: lockPoolMock,
}));

const { crearRubro, RubroError } = await import("./rubros");

const PEDIDO = {
  credito_id: 1,
  tipo_id: 1,
  monto: 500,
  descripcion: "Tarjeta de circulación",
  role: "ADMIN",
  usuario_id: 1,
};

describe("crearRubro — red de seguridad contra la carrera con eliminarTipo", () => {
  it("traduce una violación de FK en el INSERT a un 409 legible, no un 500 crudo", async () => {
    // Secuencia de `await` que hace `crearRubro`: credito (FOR UPDATE), tipo
    // (FOR KEY SHARE), mora activa (COALESCE SUM) — las tres resuelven normal,
    // como si el tipo todavía existiera al leerlo — y el INSERT final es el que
    // choca, como pasaría si el borrado se coló por debajo del bloqueo.
    dbImpl = motorConCola(
      [{ statusCredit: "AL_DIA" }],
      [{ tipo_id: 1, obligatorio: false, activo: true }],
      [{ monto: "0" }],
      { rechaza: errorFk() }
    );

    let capturado: unknown;
    try {
      await crearRubro(PEDIDO);
    } catch (e) {
      capturado = e;
    }

    expect(capturado).toBeInstanceOf(RubroError);
    expect((capturado as InstanceType<typeof RubroError>).status).toBe(409);
    // El mensaje lo lee un asesor: nada de "violación de llave foránea".
    expect((capturado as Error).message).not.toMatch(/llave foránea|foreign key|fk/i);
    expect((capturado as Error).message).toContain("dejó de estar disponible");
  });
});
