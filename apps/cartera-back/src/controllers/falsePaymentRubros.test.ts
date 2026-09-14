import { describe, expect, it, mock } from "bun:test";

// ─────────────────────────────────────────────────────────────────────────────
// `/false-payment` tiene que llevarse los rubros que la boleta cobró.
//
// Declarar falsa una boleta la INVALIDA. Un reclamo sin aplicar se soltaba solo
// (el neteo de `reclamosVivosDeRubros` filtra `paymentFalse = false`), pero uno
// YA APLICADO dejaba el saldo del rubro descontado para siempre: si el abono lo
// había dejado en cero, el rubro quedaba `completado` y `activo = false` — la
// deuda desaparecía por una boleta que se declaró falsa, y ninguna ruta la
// devolvía.
//
// Lo que se fija acá: `falsePayment` llama a `revertirRubrosDelPago` —la misma
// operación que `reversePayment`, porque el pago se invalida y no vuelve a
// pendiente— DENTRO de la misma transacción que marca `paymentFalse`, y no lo
// hace cuando la boleta no existe.
//
// Sin base: el motor falso atiende la cola de consultas en el orden en que el
// controlador las hace. `insertPagosCreditoInversionistas` sale temprano por su
// propio camino (un único inversionista del espejo que es CUBE, y la llamada va
// con `excludeCube = true`), así que el fixture no tiene que modelar el reparto
// a inversionistas para poder probar lo que este test prueba.
//
// ⚠️ CÓMO CORRERLO: este archivo solo, o junto a los de rubros/pagos. En un
// `bun test` de TODO el repo falla, y no por su culpa: `paymentAgreement.test.ts`
// y `reports.test.ts` hacen `mock.module("./payments", …)` con un stub, y
// `mock.module` es GLOBAL al run —bun carga todos los archivos antes de correr
// las pruebas—, así que el `./payments` que importa este archivo termina siendo
// ese stub y `falsePayment` queda `undefined`. Es la misma enfermedad que hoy
// tumba las 30 pruebas de `payments.test.ts` en la corrida completa, y no tiene
// arreglo desde acá: cualquier archivo que importe el `./payments` REAL corre la
// misma suerte.
// ─────────────────────────────────────────────────────────────────────────────

/** Todo lo que el controlador mandó a escribir, en orden. */
let escrituras: { op: "update" | "insert" | "delete"; valores: any }[] = [];

/**
 * Motor de base falso manejado por una COLA: cada `await` de una cadena drizzle
 * consume el siguiente resultado. Con la cola agotada RECHAZA, para que una
 * consulta de más sea un test rojo y no un resultado inventado.
 */
const motorConCola = (...resultados: unknown[]) => {
  const cola = [...resultados];
  const eslabon: any = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "then") {
          return (ok: any, err: any) =>
            (cola.length
              ? Promise.resolve(cola.shift())
              : Promise.reject(new Error("consulta de más: la cola se agotó"))
            ).then(ok, err);
        }
        return (...args: any[]) => {
          if (prop === "set") escrituras.push({ op: "update", valores: args[0] });
          if (prop === "values") escrituras.push({ op: "insert", valores: args[0] });
          return eslabon;
        };
      },
    }
  );

  const motor: any = {
    select: () => eslabon,
    insert: () => eslabon,
    update: () => eslabon,
    delete: () => {
      escrituras.push({ op: "delete", valores: null });
      return eslabon;
    },
    execute: () => Promise.reject(new Error("sin BD en tests")),
    // El reparto a inversionistas del espejo: un solo inversionista, y es CUBE.
    // `falsePayment` llama con `excludeCube = true`, así que la lista filtrada
    // queda vacía y la función retorna sin escribir nada.
    query: {
      creditos_inversionistas_espejo: {
        findMany: async () => [
          { inversionista_id: 86, credito_id: 5, cuota_inversionista: "0" },
        ],
      },
      pagos_credito: { findFirst: async () => ({ pago_id: 77, cuota: "0" }) },
      creditos: { findFirst: async () => ({ credito_id: 5 }) },
    },
  };
  // La transacción corre contra el MISMO motor: el controlador no distingue.
  motor.transaction = (cb: any) => cb(motor);
  return motor;
};

let dbImpl: any = motorConCola();

mock.module("../database/index", () => ({
  db: new Proxy({}, { get: (_t, p) => dbImpl[p] }),
  client: {},
  // `withPendingReturnCreditLocks` toma una conexión propia y corre su BEGIN /
  // SELECT ... FOR NO KEY UPDATE / COMMIT. Sin créditos bloqueados el guard deja
  // pasar (`buildPendingReturnAuthorizationWarning([])` devuelve null).
  lockPool: {
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release: () => {},
    }),
  },
}));

const { falsePayment } = await import("./payments");

/** El inversionista del espejo, resuelto por nombre: CUBE, que se excluye. */
const CUBE = [{ nombre: "Cube Investments S.A.", status: "ACTIVO" }];

/** Un reclamo YA APLICADO: la boleta descontó Q400 del rubro de verdad. */
const RECLAMO_APLICADO = [
  {
    id: 1,
    rubro_id: 7,
    monto: "400.00",
    monto_aplicado: "400.00",
    aplicado: true,
  },
];

/** El rubro quedó SALDADO por ese abono: saldo 0, completado, inactivo. */
const RUBRO_SALDADO = [
  {
    rubro_id: 7,
    credito_id: 5,
    monto_original: "400.00",
    saldo_pendiente: "0.00",
    completado: true,
    activo: false,
    anulado: false,
  },
];

describe("falsePayment — la boleta falsa devuelve lo que cobró de los rubros", () => {
  it("restituye el saldo del rubro y borra el reclamo aplicado", async () => {
    escrituras = [];
    dbImpl = motorConCola(
      [{ paymentFalse: false }], // chequeo temprano: el pago existe y NO es falso
      CUBE, // nombre del inversionista del espejo
      { rowCount: 1 }, // UPDATE pagos_credito → paymentFalse
      RECLAMO_APLICADO, // reclamos de la boleta
      RUBRO_SALDADO, // el rubro, releído FOR UPDATE
      [], // UPDATE rubros
      [], // INSERT rubros_historial
      [], // DELETE rubros_pagos
      [] // reset del ajuste por fecha ideal (returning)
    );

    await falsePayment(77, 5);

    // La boleta queda invalidada…
    expect(
      escrituras.some(
        (e) =>
          e.op === "update" &&
          e.valores?.paymentFalse === true &&
          e.valores?.pagado === false
      )
    ).toBe(true);

    // …y el rubro vuelve a deber los Q400 que esa boleta había abonado: saldo
    // restituido, `completado` apagado y `activo` derivado del saldo.
    const devolucion = escrituras.find(
      (e) => e.op === "update" && e.valores?.saldo_pendiente !== undefined
    );
    expect(devolucion?.valores).toMatchObject({
      saldo_pendiente: "400.00",
      completado: false,
      activo: true,
    });

    // El historial del rubro deja el rastro de la devolución, con el pago que
    // la causó.
    expect(
      escrituras.find((e) => e.op === "insert")?.valores
    ).toMatchObject({
      rubro_id: 7,
      tipo_evento: "reversa",
      saldo_anterior: "0.00",
      saldo_nuevo: "400.00",
      pago_id: 77,
      origen: "reversa",
    });

    // El reclamo se borra: es el guard de doble reversa.
    expect(escrituras.some((e) => e.op === "delete")).toBe(true);
  });

  it("si el pago YA es falso corta antes de tocar el espejo de inversionistas", async () => {
    // Es el 90% del motivo del chequeo temprano: `insertPagosCreditoInversionistas`
    // corre antes, commitea sus filas y resta del aporte, y NO es idempotente.
    // Una segunda llamada sobre un pago ya falso duplicaba el espejo y restaba
    // dos veces, rompiendo `capital == Σ monto_aportado`.
    //
    // La cola trae SÓLO el chequeo: si el early-return desapareciera, el
    // controlador seguiría hasta el espejo y la cola agotada haría fallar esto.
    escrituras = [];
    dbImpl = motorConCola([{ paymentFalse: true }]);

    const resultado = await falsePayment(77, 5);

    expect(resultado.updatedCount).toBe(0);
    expect(escrituras).toEqual([]);
  });

  it("si la boleta no existe no toca ningún rubro", async () => {
    escrituras = [];
    // El chequeo temprano ya no encuentra la fila: corta ANTES de tocar el
    // espejo de inversionistas, que es justamente lo que no es idempotente.
    dbImpl = motorConCola([]);

    await expect(falsePayment(77, 5)).rejects.toThrow(
      "No payment found to mark as false with the given criteria"
    );

    // Ni reversa ni borrado: revertirle los rubros a un pago que no le
    // pertenece al crédito sería peor que no hacer nada.
    expect(escrituras.some((e) => e.op === "delete")).toBe(false);
    expect(
      escrituras.some(
        (e) => e.op === "update" && e.valores?.saldo_pendiente !== undefined
      )
    ).toBe(false);
  });
});
