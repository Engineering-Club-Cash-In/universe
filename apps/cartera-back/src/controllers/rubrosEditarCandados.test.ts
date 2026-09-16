import { describe, expect, it, mock } from "bun:test";
import {
  creditos,
  moras_credito,
  rubros,
  rubros_historial,
  rubros_tipos,
} from "../database/db";

// ─────────────────────────────────────────────────────────────────────────────
// `editarRubro` — QUÉ bloquea y EN QUÉ ORDEN.
//
// Subir el monto de un rubro crea deuda nueva, igual que darlo de alta, y por
// eso se re-evalúa contra `puedeCrearRubro`: un crédito CANCELADO o INCOBRABLE
// no la admite. Esa decisión se toma leyendo `creditos.statusCredit` — y una
// lectura que DECIDE no puede ser plana. El cron de moras escribe esa misma
// columna; sin bloqueo, el alza entra sobre un crédito que un instante después
// ya no la admitía. Es la misma carrera que `crearRubro` cerró con su
// `FOR UPDATE`, por la puerta de al lado.
//
// Pero el bloqueo no basta con estar: tiene que tomarse en el ORDEN correcto.
// `crearRubro` toma `creditos` y DESPUÉS toca `rubros` (su INSERT). Si la
// edición tomara `rubros` primero y `creditos` después, las dos rutas pedirían
// los mismos dos recursos en orden opuesto, que es la definición de deadlock:
// la edición reviviendo un rubro completado deja una entrada sin commitear en
// el índice único `(credito_id, tipo_id) WHERE completado = false` y se queda
// esperando el crédito, mientras el alta —que ya tiene el crédito— espera esa
// entrada del índice. Ninguna avanza y Postgres mata a una.
//
// Por eso estos dos tests son uno solo partido en dos: "lo bloquea" y "lo
// bloquea PRIMERO". El segundo es el que evita que el arreglo del primero
// cambie una carrera esporádica por un deadlock.
//
// Sin base: se mockea "../database" con un motor que responde SEGÚN LA TABLA
// —no por posición en una cola— y va anotando (tabla, cerradura) en el orden en
// que el controlador las pide. Así el test habla de orden de candados, que es
// lo que quiere fijar, y no se rompe porque alguien agregue una consulta.
// ─────────────────────────────────────────────────────────────────────────────

const NOMBRES = new Map<unknown, string>([
  [rubros, "rubros"],
  [creditos, "creditos"],
  [rubros_tipos, "rubros_tipos"],
  [moras_credito, "moras_credito"],
  [rubros_historial, "rubros_historial"],
]);

type Toma = { tabla: string; cerradura: string | null };

const motorQueAnota = (filas: Map<unknown, unknown[]>) => {
  const tomas: Toma[] = [];

  const cadena = (tablaInicial?: unknown) => {
    const paso: { tabla: unknown; cerradura: string | null } = {
      tabla: tablaInicial,
      cerradura: null,
    };
    const eslabon: any = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "then") {
            return (ok: any, err: any) => {
              tomas.push({
                tabla: NOMBRES.get(paso.tabla) ?? "?",
                cerradura: paso.cerradura,
              });
              return Promise.resolve(filas.get(paso.tabla) ?? []).then(ok, err);
            };
          }
          return (...args: any[]) => {
            // `.from(tabla)` en los SELECT; en `update`/`insert`/`delete` la
            // tabla ya vino en la llamada de arranque.
            if (prop === "from") paso.tabla = args[0];
            if (prop === "for") paso.cerradura = args[0];
            return eslabon;
          };
        },
      }
    );
    return eslabon;
  };

  const motor: any = {
    select: () => cadena(),
    insert: (t: unknown) => cadena(t),
    update: (t: unknown) => cadena(t),
    delete: (t: unknown) => cadena(t),
    execute: () => Promise.reject(new Error("sin BD en tests")),
    get tomas() {
      return tomas;
    },
  };
  motor.transaction = (cb: any) => cb(motor);
  return motor;
};

/**
 * Un rubro VIGENTE de Q500 sobre un crédito sano. El patch le sube el monto a
 * Q900, que es lo único que dispara la re-evaluación contra el crédito.
 */
const escenarioDeAlza = () =>
  new Map<unknown, unknown[]>([
    [
      rubros,
      [
        {
          rubro_id: 7,
          credito_id: 9,
          tipo_id: 3,
          descripcion: "Tarjeta de circulación 2026",
          monto_original: "500.00",
          saldo_pendiente: "500.00",
          completado: false,
          activo: true,
          anulado: false,
        },
      ],
    ],
    [creditos, [{ statusCredit: "VIGENTE", credito_id: 9 }]],
    [rubros_tipos, [{ tipo_id: 3, obligatorio: false, activo: true }]],
    [moras_credito, [{ monto: "0" }]],
    [rubros_historial, []],
  ]);

let dbImpl: any = motorQueAnota(escenarioDeAlza());
mock.module("../database", () => ({
  db: new Proxy({}, { get: (_t, p) => dbImpl[p] }),
  client: {},
  lockPool: { connect: async () => ({ query: async () => {}, release: () => {} }) },
}));

const { editarRubro } = await import("./rubros");

const subirElMonto = () =>
  editarRubro(7, {
    monto: 900,
    motivo: "El costo del trámite subió",
    role: "ADMIN",
    usuario_id: 1,
  });

describe("editarRubro — candados sobre el crédito", () => {
  it("bloquea el crédito antes de juzgar si admite el alza", async () => {
    dbImpl = motorQueAnota(escenarioDeAlza());

    await subirElMonto();

    const delCredito = dbImpl.tomas.filter((t: Toma) => t.tabla === "creditos");
    expect(delCredito.length).toBeGreaterThan(0);
    // Plana no sirve: el cron de moras escribe `statusCredit` con un UPDATE de
    // columna común, y eso sólo lo frena `FOR UPDATE` (o `FOR SHARE`).
    expect(delCredito[0].cerradura).toBe("update");
  });

  it("toma el crédito ANTES que el rubro, igual que el alta", async () => {
    dbImpl = motorQueAnota(escenarioDeAlza());

    await subirElMonto();

    const tablas: string[] = dbImpl.tomas.map((t: Toma) => t.tabla);
    const credito = tablas.indexOf("creditos");
    // La primera toma de `rubros` CON CERRADURA: la lectura previa que sólo
    // averigua de qué crédito es el rubro va sin candado a propósito, y por eso
    // no cuenta para el orden.
    const rubroBloqueado = dbImpl.tomas.findIndex(
      (t: Toma) => t.tabla === "rubros" && t.cerradura !== null
    );

    expect(credito).toBeGreaterThanOrEqual(0);
    expect(rubroBloqueado).toBeGreaterThanOrEqual(0);
    expect(credito).toBeLessThan(rubroBloqueado);
  });
});
