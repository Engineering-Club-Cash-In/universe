import { describe, expect, it, mock } from "bun:test";
import { lockPoolMock } from "../utils/testMocks";

// ─────────────────────────────────────────────────────────────────────────────
// `listarRubrosDeCredito` — de dónde sale el `abonado` de la ficha.
//
// La pantalla de rubros muestra tres columnas de plata: monto, ABONADO y saldo.
// El abonado se derivaba restando (`monto_original − saldo_pendiente`), con un
// caso especial que devolvía 0 para los anulados, y las dos ramas mienten en
// cuanto el rubro tiene cobros de verdad: `anularRubro` deja
// `saldo_pendiente = 0` igual que un rubro saldado, así que la resta no puede
// distinguir "ya no se cobra" de "ya se pagó".
//
// El camino es normal, no rebuscado: rubro de Q1,000 → una boleta cobra Q400 y
// contabilidad la aplica (saldo 600) → el reclamo queda `aplicado = true`, así
// que ya no congela el rubro → un ADMIN lo anula → el saldo va a 0 y la columna
// Abonado pasaba de Q400 a Q0.00. Son Q400 que el cliente pagó y que se
// facturaron, y la pantalla de confirmación de la anulación los muestra un
// segundo antes de que la tabla los desaparezca.
//
// Lo que estos tests fijan: el abonado sale de SUMAR `monto_aplicado` de los
// reclamos aplicados —la única fuente que sabe cuánto puso el cliente— y esa
// suma se trae para TODOS los rubros del crédito en UNA consulta agregada (la
// ficha lista el crédito completo; una consulta por rubro es un N+1).
//
// Sin base: se mockea "../database" con un motor de cola, igual que
// `rubrosCrearRace.test.ts`. Con la cola agotada la consulta RECHAZA en vez de
// devolver `[]`, que es lo que convierte "hizo una consulta de más" en un test
// rojo.
// ─────────────────────────────────────────────────────────────────────────────

const motorConCola = (...pasos: unknown[][]) => {
  const cola = [...pasos];
  let consultas = 0;
  const eslabon: any = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "then") {
          consultas += 1;
          return (ok: any, err: any) =>
            (cola.length
              ? Promise.resolve(cola.shift())
              : Promise.reject(new Error("consulta de más: la cola se agotó"))
            ).then(ok, err);
        }
        // `.from()`, `.where()`, `.groupBy()`, `.orderBy()`… todas devuelven la
        // misma cadena.
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
    /** Cuántos `await` de consulta hizo el controlador. */
    get consultas() {
      return consultas;
    },
  };
  motor.transaction = (cb: any) => cb(motor);
  return motor;
};

let dbImpl: any = motorConCola();
mock.module("../database", () => ({
  db: new Proxy({}, { get: (_t, p) => dbImpl[p] }),
  client: {},
  // Obligatorio aunque este archivo no lo use: `rubros.ts` importa
  // `paymentAdvisoryLock.ts`, que hace `import { lockPool } from "../database"`,
  // y sin la clave el ARCHIVO ENTERO revienta al cargarse.
  lockPool: lockPoolMock,
}));

const { listarRubrosDeCredito } = await import("./rubros");

/** La fila tal como sale del `select({ rubro, tipo_nombre })` del controlador. */
const fila = (rubro: Record<string, unknown>) => ({
  rubro: {
    rubro_id: 7,
    credito_id: 9,
    tipo_id: 3,
    descripcion: "Tarjeta de circulación 2026",
    monto_original: "1000.00",
    saldo_pendiente: "600.00",
    completado: false,
    activo: true,
    anulado: false,
    ...rubro,
  },
  tipo_nombre: "Tarjeta de circulación",
});

const EXISTE_EL_CREDITO = [{ credito_id: 9 }];

describe("listarRubrosDeCredito — el `abonado` es lo que el cliente PAGÓ", () => {
  it("un rubro ANULADO que sí tuvo abonos reporta el abonado real, no 0", async () => {
    // Q1,000 cobrados, Q400 aplicados y facturados, y después un ADMIN anula el
    // rubro: `anularRubro` deja `saldo_pendiente = 0`, pero los Q400 los pagó
    // el cliente y no se le devolvieron.
    dbImpl = motorConCola(
      EXISTE_EL_CREDITO,
      [
        fila({
          saldo_pendiente: "0.00",
          anulado: true,
          completado: true,
          activo: false,
        }),
      ],
      [{ rubro_id: 7, abonado: "400.00" }]
    );

    const [rubro] = await listarRubrosDeCredito(9);

    expect(rubro.abonado).toBe("400.00");
    // El monto original NO se toca al anular: es el rastro de cuánto se había
    // llegado a cobrar, y con el abonado al lado es lo que explica el hueco.
    expect(rubro.monto_original).toBe("1000.00");
  });

  it("un rubro vivo con un abono aplicado reporta ese abono", async () => {
    dbImpl = motorConCola(
      EXISTE_EL_CREDITO,
      [fila({})],
      [{ rubro_id: 7, abonado: "400.00" }]
    );

    const [rubro] = await listarRubrosDeCredito(9);

    expect(rubro.abonado).toBe("400.00");
  });

  it("sin reclamos pero con el saldo descontado, reporta la diferencia: es un borrado en cascada", async () => {
    // Este caso NO puede venir de una boleta apartada: apartar no baja el
    // saldo (lo dice `cobrarRubrosParaBoleta`). Si no hay ningún reclamo
    // aplicado y aun así el saldo es MENOR que el monto, el hueco sólo puede
    // venir de un borrado de `pagos_credito` en cascada —`marcarCreditoComoCaido`,
    // la reducción de plazo, la carga por Excel o `/recalculate`—, que se lleva
    // los reclamos y deja el descuento.
    //
    // Reportar 0.00 ahí borraría de la pantalla plata que el cliente pagó y que
    // se facturó, y además contradiría al backend: `puedeEditarMonto` usa esa
    // misma resta para rechazar un monto menor "a lo ya abonado".
    dbImpl = motorConCola(
      EXISTE_EL_CREDITO,
      [fila({ monto_original: "1000.00", saldo_pendiente: "600.00" })],
      []
    );

    const [rubro] = await listarRubrosDeCredito(9);

    expect(rubro.abonado).toBe("400.00");
  });

  it("un rubro ANULADO sin reclamos reporta 0.00, no su monto entero", async () => {
    // Acá la resta NO sirve como red: anular fuerza el saldo a 0, así que
    // daría el monto completo — el defecto original, que decía que el cliente
    // pagó todo. Si hubo cobros, sus reclamos existen y el agregado los suma;
    // si no hay reclamos, no hubo nada que cobrar.
    dbImpl = motorConCola(
      EXISTE_EL_CREDITO,
      [fila({ monto_original: "1000.00", saldo_pendiente: "0.00", anulado: true })],
      []
    );

    const [rubro] = await listarRubrosDeCredito(9);

    expect(rubro.abonado).toBe("0.00");
  });

  it("con un reclamo borrado en cascada y otro vivo, toma el mayor de los dos", async () => {
    // La reducción de plazo borra sólo los pagos de las cuotas que caen fuera
    // del plazo nuevo: puede llevarse UN reclamo y dejar otro. Acá sobrevive un
    // reclamo de Q200, pero el saldo sigue descontado por los Q600 de ambos. La
    // suma sola diría Q200, y `puedeEditarMonto` —que usa la resta— le exigiría
    // al admin un mínimo de Q600 que la pantalla no le mostró. Se toma el mayor
    // para que no se contradigan.
    //
    // OJO con el `rubro_id` del agregado: tiene que ser el MISMO que el de la
    // fila (7, el default). Con otro, `abonados.get(7)` da `undefined`, el
    // `max` resuelve por el lado de la resta y el test pasa igual sin tocar la
    // rama que dice cubrir — así nació mal la primera versión de este test.
    dbImpl = motorConCola(
      EXISTE_EL_CREDITO,
      [fila({ monto_original: "1000.00", saldo_pendiente: "400.00" })],
      [{ rubro_id: 7, abonado: "200.00" }]
    );

    const [rubro] = await listarRubrosDeCredito(9);

    expect(rubro.abonado).toBe("600.00");
  });

  it("trae los abonos de TODOS los rubros en UNA sola consulta agregada", async () => {
    // Tres rubros y una cola de tres pasos: crédito, rubros y el agregado. Una
    // consulta por rubro agotaría la cola y el `await` rechazaría.
    dbImpl = motorConCola(
      EXISTE_EL_CREDITO,
      [
        fila({ rubro_id: 7 }),
        fila({ rubro_id: 8, saldo_pendiente: "0.00", completado: true }),
        fila({ rubro_id: 9, saldo_pendiente: "1000.00" }),
      ],
      [
        { rubro_id: 7, abonado: "400.00" },
        { rubro_id: 8, abonado: "1000.00" },
      ]
    );

    const listado = await listarRubrosDeCredito(9);

    expect(listado.map((r) => r.abonado)).toEqual([
      "400.00",
      "1000.00",
      // El tercero no aparece en el agregado: nadie le abonó nada.
      "0.00",
    ]);
    expect(dbImpl.consultas).toBe(3);
  });

  it("sin rubros no consulta los abonos", async () => {
    // Cola de DOS pasos a propósito: si el controlador pidiera el agregado con
    // la lista de ids vacía, el tercer `await` rechazaría.
    dbImpl = motorConCola(EXISTE_EL_CREDITO, []);

    expect(await listarRubrosDeCredito(9)).toEqual([]);
    expect(dbImpl.consultas).toBe(2);
  });
});
