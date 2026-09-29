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

/**
 * Todo lo que el controlador mandó a escribir, en orden. `tx-begin`/`tx-commit`
 * son marcas del motor falso, no escrituras: permiten afirmar que una escritura
 * cayó DENTRO de la transacción y no después del commit.
 */
let escrituras: {
  op: "update" | "insert" | "delete" | "tx-begin" | "tx-commit";
  valores: any;
}[] = [];

/**
 * Cada entrada de la cola PAREADA con la tabla que la consumió, EN ORDEN.
 *
 * ── Por qué el par y no solo la tabla ──────────────────────────────────────
 * La primera versión de esto anotaba SOLO la tabla, y se creyó que con eso
 * alcanzaba para detectar una cola desalineada. No alcanza, y conviene dejarlo
 * escrito para que nadie lo vuelva a suponer: el código lee siempre las mismas
 * tablas en el mismo orden, así que correr la cola un lugar NO cambia esa
 * secuencia — solo cambia QUÉ filas le tocan a cada una.
 *
 * Que la versión solo-tabla igual se pusiera roja con la mutación fue de
 * rebote: los datos cruzados cambiaban el flujo de control (se perdía una
 * lectura de `moras_historial`) y con eso sí cambiaba la secuencia. Detección
 * accidental, no mecanismo. Pareando tabla y filas la detección es directa.
 *
 * Aseverar sobre `escrituras` tampoco sirve —se probó—: el orden y el contenido
 * de las ESCRITURAS los decide el flujo de control, no lo que devuelven las
 * LECTURAS.
 */
let lecturas: Array<{ tabla: string; filas: unknown }> = [];

/** El nombre de la tabla que drizzle lleva adentro del objeto. */
const tablaDe = (t: any) =>
  t?.[Symbol.for("drizzle:Name")] ?? t?._?.name ?? "?";

/**
 * Motor de base falso manejado por una COLA: cada `await` de una cadena drizzle
 * consume el siguiente resultado. Con la cola agotada RECHAZA, para que una
 * consulta de más sea un test rojo y no un resultado inventado.
 *
 * Cada cadena lleva SU tabla (`caja`) en vez de compartir un único eslabón:
 * así, al resolverse, puede anotar en `lecturas` contra qué tabla se consumió
 * su entrada de la cola.
 */
const motorConCola = (...resultados: unknown[]) => {
  const cola = [...resultados];

  const eslabonCon = (caja: { tabla: string }): any =>
    new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "then") {
            return (ok: any, err: any) => {
              if (!cola.length) {
                return Promise.reject(
                  new Error("consulta de más: la cola se agotó")
                ).then(ok, err);
              }
              const filas = cola.shift();
              lecturas.push({ tabla: caja.tabla, filas });
              return Promise.resolve(filas).then(ok, err);
            };
          }
          return (...args: any[]) => {
            if (prop === "from") caja.tabla = tablaDe(args[0]);
            if (prop === "set") escrituras.push({ op: "update", valores: args[0] });
            if (prop === "values") escrituras.push({ op: "insert", valores: args[0] });
            return eslabonCon(caja);
          };
        },
      }
    );

  const motor: any = {
    select: () => eslabonCon({ tabla: "?" }),
    insert: (t?: any) => eslabonCon({ tabla: tablaDe(t) }),
    update: (t?: any) => eslabonCon({ tabla: tablaDe(t) }),
    delete: (t?: any) => {
      escrituras.push({ op: "delete", valores: null });
      return eslabonCon({ tabla: tablaDe(t) });
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
  // Las marcas alrededor son lo único que la hace visible desde el test.
  motor.transaction = async (cb: any) => {
    escrituras.push({ op: "tx-begin", valores: null });
    const resultado = await cb(motor);
    escrituras.push({ op: "tx-commit", valores: null });
    return resultado;
  };
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

/**
 * ── LO QUE CAMBIÓ AL FUNDIR ESTO CON LA REBANADA DE MORA ───────────────────
 * El cuerpo de `falsePayment` se mudó a `anularPagoYRestituirMora`
 * (`anularPagoMora.ts`) y el ORDEN se invirtió: primero el candado del crédito
 * + la transacción (marcar falso → devolver rubros → restituir mora → resetear
 * el ajuste), y DESPUÉS los espejos de inversionistas. Por eso la cola de este
 * motor falso cambió: el `CUBE` ya no va segundo sino último, y en el medio
 * entran las lecturas que la anulación necesita.
 */

/**
 * La precondición de `falsePayment`: el crédito TIENE inversionistas en el
 * espejo, así que el paso de espejos no va a tirar y se puede anular.
 */
const CREDITO_CON_ESPEJO = [{ credito_id: 5 }];

/**
 * El guard de la red de seguridad de la salida temprana: este `pago_id` YA
 * tiene sus filas de espejo escritas, así que no hay que repararlas.
 */
const ESPEJO_DEL_PAGO_YA_ESCRITO = [{ id: 900 }];

/** El crédito, leído con FOR UPDATE: abre el orden de candados del módulo. */
const CREDITO_CANDADO = [
  {
    credito_id: 5,
    numero_credito_sifco: "SIFCO-5",
    // Sin devolución pendiente: el guard duplicado adentro de la transacción
    // deja pasar.
    estado_devolucion: "NO_APLICA",
  },
];

/**
 * La boleta, leída con FOR UPDATE antes del UPDATE. `mora: "0.00"` a propósito:
 * esta prueba es sobre RUBROS, y con mora cero no se llama a `updateMora` —que
 * exigiría mockear `./latefee`—. La restitución de mora tiene sus propias
 * pruebas en `anularPagoMora.test.ts`.
 */
const PAGO_SIN_MORA = [
  { mora: "0.00", paymentFalse: false, created_at: new Date("2026-09-22T10:00:00.000Z") },
];

/** El estado del decremento de mora: sin marca y sin eventos del cron. */
const SIN_DECREMENTO: unknown[] = [[], []];

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
    lecturas = [];
    dbImpl = motorConCola(
      [{ paymentFalse: false }], // chequeo temprano: el pago existe y NO es falso
      CREDITO_CON_ESPEJO, // precondición: el crédito tiene espejo de inversionistas
      CREDITO_CANDADO, // SELECT creditos FOR UPDATE (abre el orden de candados)
      PAGO_SIN_MORA, // SELECT pagos_credito FOR UPDATE (mora y createdAt)
      ...SIN_DECREMENTO, // el decremento marcado, y los eventos del cron
      { rowCount: 1 }, // UPDATE pagos_credito → paymentFalse
      RECLAMO_APLICADO, // reclamos de la boleta
      RUBRO_SALDADO, // el rubro, releído FOR UPDATE
      [], // UPDATE rubros
      [], // INSERT rubros_historial
      [], // DELETE rubros_pagos
      [], // reset del ajuste por fecha ideal (returning)
      CUBE // nombre del inversionista del espejo — AHORA va al final
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

    // ── LA ALINEACIÓN DE LA COLA ────────────────────────────────────────────
    // Cada entrada de la cola pareada con la tabla que de verdad la consumió.
    // El par es lo que hace de esto un chequeo DIRECTO de alineación: si la
    // cola se corre un lugar, las tablas siguen siendo las mismas pero las
    // filas cambian de dueño, y eso se ve acá y en ningún otro lado de este
    // archivo.
    //
    // De paso documenta el camino completo de `falsePayment`: si alguien agrega
    // una lectura y no le agrega su entrada, esto falla y dice exactamente
    // dónde.
    expect(lecturas).toEqual([
      // salida temprana: ¿ya estaba falso?
      { tabla: "pagos_credito", filas: [{ paymentFalse: false }] },
      // precondición: ¿el crédito puede generar espejos?
      { tabla: "creditos_inversionistas_espejo", filas: CREDITO_CON_ESPEJO },
      // FOR UPDATE: abre el orden de candados del módulo de mora
      { tabla: "creditos", filas: CREDITO_CANDADO },
      // FOR UPDATE: mora y createdAt, leídos ANTES del UPDATE
      { tabla: "pagos_credito", filas: PAGO_SIN_MORA },
      // ¿hay un DECREMENTO marcado con este pago?
      { tabla: "moras_historial", filas: [] },
      // …si no, los eventos del cron posteriores
      { tabla: "moras_historial", filas: [] },
      // UPDATE → paymentFalse (su `rowCount` es el guard de idempotencia)
      { tabla: "pagos_credito", filas: { rowCount: 1 } },
      // los reclamos de rubro de la boleta
      { tabla: "rubros_pagos", filas: RECLAMO_APLICADO },
      // el rubro, releído FOR UPDATE
      { tabla: "rubros", filas: RUBRO_SALDADO },
      { tabla: "rubros", filas: [] }, // UPDATE saldo_pendiente
      { tabla: "rubros_historial", filas: [] }, // INSERT del rastro
      { tabla: "rubros_pagos", filas: [] }, // DELETE del reclamo
      // reset del ajuste por fecha ideal: último, y dentro de la tx
      { tabla: "ajuste_fecha_ideal_pago", filas: [] },
      // ya fuera de la tx: el nombre del inversionista, para excluir a CUBE
      { tabla: "inversionistas", filas: CUBE },
    ]);
  });

  it("si el pago YA es falso, y su espejo ya está escrito, no vuelve a tocar nada", async () => {
    // Ojo con el porqué: ya NO es el chequeo temprano lo único que protege el
    // espejo. Los espejos se mudaron DESPUÉS de la transacción, y el
    // `paymentFalse = false` del WHERE del UPDATE hace que una segunda pasada
    // tire antes de llegar a ellos. El chequeo temprano queda porque convierte
    // ese reintento inocente en un `updatedCount: 0` honesto en vez de un 400,
    // y porque corre la red de seguridad del ajuste por fecha ideal.
    //
    // Lo que sigue valiendo tal cual es lo que se AFIRMA acá abajo: sobre un
    // pago ya falso no se inserta el espejo, no se abre transacción y no se
    // toca ningún rubro.
    escrituras = [];
    lecturas = [];
    dbImpl = motorConCola(
      [{ paymentFalse: true }], // chequeo temprano: el pago YA es falso
      [], // reset del ajuste por fecha ideal (returning) — ver el test de abajo
      ESPEJO_DEL_PAGO_YA_ESCRITO // el espejo de este pago ya existe: no se repara
    );

    const resultado = await falsePayment(77, 5);

    expect(resultado.updatedCount).toBe(0);

    // Lo que el early-return protege: ni transacción abierta, ni rubros
    // tocados, ni un insert de espejo de más.
    //
    // OJO con el matiz nuevo: «no toca el espejo» vale porque en este caso el
    // espejo de ESTE pago YA existe (`ESPEJO_DEL_PAGO_YA_ESCRITO`). Si no
    // existiera, la salida temprana lo escribiría a propósito — es la red de
    // seguridad del orden nuevo, y tiene su propia prueba en
    // `falsePaymentReintento.test.ts`.
    expect(escrituras.some((e) => e.op === "insert")).toBe(false);
    expect(escrituras.some((e) => e.op === "delete")).toBe(false);
    expect(escrituras.some((e) => e.op === "tx-begin")).toBe(false);
    expect(
      escrituras.some(
        (e) => e.op === "update" && e.valores?.saldo_pendiente !== undefined
      )
    ).toBe(false);
  });

  it("el reset del ajuste por fecha ideal corre DENTRO de la transacción", async () => {
    // Estaba DESPUÉS del commit. Si esa consulta fallaba, la boleta quedaba
    // commiteada como falsa con el ajuste todavía marcado como cobrado, y el
    // reintento se iba por el early-return sin volver a limpiarlo nunca: el
    // ajuste quedaba cobrado para siempre apuntando a un pago que no existe, y
    // ningún pago futuro se lo volvía a cobrar al cliente.
    escrituras = [];
    lecturas = [];
    dbImpl = motorConCola(
      [{ paymentFalse: false }],
      CREDITO_CON_ESPEJO,
      CREDITO_CANDADO,
      PAGO_SIN_MORA,
      ...SIN_DECREMENTO,
      { rowCount: 1 },
      RECLAMO_APLICADO,
      RUBRO_SALDADO,
      [],
      [],
      [],
      [{ id: 3 }], // reset del ajuste: devolvió la fila reseteada
      CUBE
    );

    await falsePayment(77, 5);

    const inicio = escrituras.findIndex((e) => e.op === "tx-begin");
    const commit = escrituras.findIndex((e) => e.op === "tx-commit");
    const reset = escrituras.findIndex(
      (e) =>
        e.op === "update" &&
        e.valores?.fecha_cobro === null &&
        e.valores?.pago_id === null
    );

    expect(reset).toBeGreaterThan(inicio);
    expect(reset).toBeLessThan(commit);
  });

  it("el camino del pago ya falso vuelve a correr el reset, que es idempotente", async () => {
    // Red de seguridad para las filas que el bug ya dejó sucias en producción:
    // si un ajuste sigue apuntando a un pago que YA está declarado falso, una
    // segunda llamada a `/false-payment` tiene que limpiarlo. El UPDATE filtra
    // por `pago_id` del pago invalidado, así que correrlo de más no toca nada
    // (0 filas) y jamás puede pisar un ajuste que un pago posterior reclamó.
    escrituras = [];
    lecturas = [];
    dbImpl = motorConCola(
      [{ paymentFalse: true }],
      [{ id: 3 }],
      ESPEJO_DEL_PAGO_YA_ESCRITO
    );

    await falsePayment(77, 5);

    expect(
      escrituras.some(
        (e) =>
          e.op === "update" &&
          e.valores?.fecha_cobro === null &&
          e.valores?.pago_id === null
      )
    ).toBe(true);
  });

  it("si la boleta no existe no toca ningún rubro", async () => {
    escrituras = [];
    lecturas = [];
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
