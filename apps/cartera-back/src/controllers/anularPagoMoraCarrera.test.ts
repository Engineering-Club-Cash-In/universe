/**
 * LAS DOS RUTAS QUE DESHACEN UN PAGO HACEN LA MISMA FILA.
 *
 * Hay dos maneras de deshacer un pago y las dos restituyen la MISMA mora:
 * revertirlo (`reversePayment`) y anular su boleta (`falsePayment` →
 * `anularPagoYRestituirMoraSerializado`). Hasta este arreglo no compartían
 * ningún candado: la reversa tomaba el advisory lock por crédito
 * (`withPaymentAdvisoryLock`) y la anulación solo candaba filas, así que
 * corriendo a la vez sobre el mismo pago la reversa leía el estado de
 * reconciliación, la anulación restituía y commiteaba, y la reversa seguía
 * adelante con su lectura vieja y restituía OTRA VEZ. Q100 se volvían Q200 a
 * cargo del cliente.
 *
 * Estas pruebas ejercen el ORDEN, no solo el resultado: la cola falsa registra
 * la secuencia real de los dos caminos y la carrera se arma a propósito para
 * que la anulación caiga justo en la ventana donde antes se colaba.
 */
import { beforeEach, describe, expect, it } from "bun:test";

process.env.SUPABASE_DB_URL ??= "postgresql://nadie:nadie@127.0.0.1:1/ninguna";
const { anularPagoYRestituirMoraSerializado } = await import("./anularPagoMora");

const PAGO_ID = 301;
const CREDITO_ID = 4242;

const traza: string[] = [];
const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * El advisory lock por crédito, de mentira pero con su semántica: FIFO, uno a
 * la vez por `credito_id`, y sin soltar hasta que el cuerpo termina. Es lo
 * mismo que hace `pg_advisory_lock` sobre la conexión de `lockPool`.
 */
const crearCola = () => {
  const ultima = new Map<number, Promise<unknown>>();
  return async function cola(creditoId: number, fn: (lock?: any) => Promise<any>) {
    const previa = ultima.get(creditoId) ?? Promise.resolve();
    let liberar!: () => void;
    const mia = new Promise<void>((r) => (liberar = r));
    ultima.set(creditoId, previa.then(() => mia));
    await previa;
    traza.push(`lock(${creditoId})`);
    try {
      return await fn({});
    } finally {
      traza.push(`unlock(${creditoId})`);
      liberar();
    }
  } as any;
};

beforeEach(() => {
  traza.length = 0;
});

describe("la anulación toma el candado ANTES de abrir su transacción", () => {
  it("el orden es lock → begin → anular → commit → unlock", async () => {
    const filas = await anularPagoYRestituirMoraSerializado(
      { pago_id: PAGO_ID, credito_id: CREDITO_ID },
      {
        withCreditLock: crearCola(),
        runTransaction: (async (fn: any) => {
          traza.push("begin");
          const r = await fn({} as any);
          traza.push("commit");
          return r;
        }) as any,
        anular: (async () => {
          traza.push("anular");
          return 1;
        }) as any,
      },
    );

    expect(filas).toBe(1);
    // El candado tiene que abrazar la transacción ENTERA: si se soltara en el
    // commit —o si se tomara adentro— la otra ruta se cuela entre la lectura
    // del estado y la restitución, que es exactamente la ventana del defecto.
    expect(traza).toEqual([
      `lock(${CREDITO_ID})`,
      "begin",
      "anular",
      "commit",
      `unlock(${CREDITO_ID})`,
    ]);
  });
});

describe("reversa y anulación simultáneas sobre el mismo pago", () => {
  it("la mora se restituye UNA sola vez, no dos", async () => {
    const cola = crearCola();

    // El único estado que importa: la mora que la boleta había cobrado y que
    // falta devolver. Deshacer el pago la pone en cero —marcarlo `paymentFalse`
    // en la anulación, dejar sus montos en cero en la reversa—, y por eso el
    // segundo en pasar no encuentra nada que restituir.
    let moraPorRestituir = 100;
    let restituidoTotal = 0;

    const deshacer = async (etiqueta: string, ceder: number) => {
      traza.push(`${etiqueta}:lee`);
      const pendiente = moraPorRestituir;
      // La ventana: entre leer el estado de reconciliación y escribir la
      // restitución. Sin cola compartida, acá se colaba la otra ruta.
      for (let i = 0; i < ceder; i++) await tick();
      traza.push(`${etiqueta}:restituye:${pendiente}`);
      restituidoTotal += pendiente;
      moraPorRestituir = 0;
    };

    // La reversa, tal cual hoy: su cuerpo corre dentro del advisory lock.
    const reversa = cola(CREDITO_ID, () => deshacer("reversa", 3));

    // La anulación, por la función de producción.
    const anulacion = anularPagoYRestituirMoraSerializado(
      { pago_id: PAGO_ID, credito_id: CREDITO_ID },
      {
        withCreditLock: cola,
        runTransaction: (async (fn: any) => fn({} as any)) as any,
        anular: (async () => {
          await deshacer("anulacion", 1);
          return 1;
        }) as any,
      },
    );

    await Promise.all([reversa, anulacion]);

    // El defecto en una línea: sin cola compartida esto daba 200.
    expect(restituidoTotal).toBe(100);

    // Y el ORDEN lo prueba: la anulación ni siquiera empieza a leer hasta que
    // la reversa soltó el candado, así que lee el estado YA deshecho (0).
    expect(traza).toEqual([
      `lock(${CREDITO_ID})`,
      "reversa:lee",
      "reversa:restituye:100",
      `unlock(${CREDITO_ID})`,
      `lock(${CREDITO_ID})`,
      "anulacion:lee",
      "anulacion:restituye:0",
      `unlock(${CREDITO_ID})`,
    ]);
  });
});
