/**
 * LAS DOS RUTAS QUE DESHACEN UN PAGO HACEN LA MISMA FILA.
 *
 * Hay dos maneras de deshacer un pago y las dos restituyen la MISMA mora y
 * devuelven los MISMOS rubros: revertirlo (`reversePayment`) y anular su boleta
 * (`falsePayment` → `anularPagoYRestituirMoraSerializado`). Si no compartieran
 * candado —la reversa toma el advisory lock por crédito
 * (`withPaymentAdvisoryLock`) y la anulación solo candaría filas— corriendo a
 * la vez sobre el mismo pago la reversa leería el estado de reconciliación, la
 * anulación restituiría y commitearía, y la reversa seguiría adelante con su
 * lectura vieja y restituiría OTRA VEZ. Q100 se volverían Q200 a cargo del
 * cliente.
 *
 * Estas pruebas ejercen el ORDEN, no solo el resultado: la cola falsa registra
 * la secuencia real de los dos caminos y la carrera se arma a propósito para
 * que la anulación caiga justo en la ventana donde antes se colaba.
 *
 * ── POR QUÉ LA COMPOSICIÓN VIVE ACÁ Y NO EN `falsePayment` ─────────────────
 * `develop` tomaba el advisory lock dentro de `falsePayment` (lo necesitaba
 * para los rubros). Al fundirlo con esta rebanada se dejó UNA sola
 * composición, y se eligió la de este módulo porque es la única que una prueba
 * puede ejercer: `payments.ts` no se puede importar en la suite —varios
 * archivos registran un `mock.module("./payments")` global—, así que allá la
 * invariante solo se podría vigilar leyendo el texto del archivo, que no prueba
 * nada sobre concurrencia. Es el mismo helper y la misma llave: no cambió el
 * comportamiento, solo dónde se escribe.
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

  it("el cuerpo entero —rubros incluidos— cae DENTRO del candado y de la transacción", async () => {
    // Al fundirse con el trabajo de rubros, `anularPagoYRestituirMora` dejó de
    // tocar solo la mora: adentro devuelve también el saldo de los rubros que
    // la boleta cobró. Ese paso NO puede quedar fuera del candado, porque
    // `revertirRubrosDelPago` relee `saldo_pendiente` y le vuelve a sumar
    // `monto_aplicado` (Q1,000 con Q400 cobrados: 600 → 1000 → 1400).
    await anularPagoYRestituirMoraSerializado(
      { pago_id: PAGO_ID, credito_id: CREDITO_ID },
      {
        withCreditLock: crearCola(),
        runTransaction: (async (fn: any) => {
          traza.push("begin");
          const r = await fn({} as any);
          traza.push("commit");
          return r;
        }) as any,
        // El cuerpo real, resumido en sus tres escrituras y en su orden:
        // marcar falso → devolver rubros → restituir mora.
        anular: (async () => {
          traza.push("update:paymentFalse");
          traza.push("rubros:devuelve");
          traza.push("mora:restituye");
          return 1;
        }) as any,
      },
    );

    expect(traza).toEqual([
      `lock(${CREDITO_ID})`,
      "begin",
      "update:paymentFalse",
      "rubros:devuelve",
      "mora:restituye",
      "commit",
      `unlock(${CREDITO_ID})`,
    ]);
  });

  it("el candado se toma UNA sola vez: `falsePayment` ya no lo toma por su cuenta", async () => {
    // `develop` lo tomaba en `falsePayment`. Al mudar la composición acá, ese
    // `withPaymentAdvisoryLock` de allá TIENE que haberse ido: tomarlo en los
    // dos lados lo anida, y un advisory lock anidado sobre la misma conexión
    // lógica es exactamente el bloqueo contra uno mismo que este módulo evita
    // en todos los demás frentes.
    const payments = await Bun.file(
      new URL("./payments.ts", import.meta.url).pathname,
    ).text();
    const inicio = payments.indexOf("export async function falsePayment(");
    expect(inicio).toBeGreaterThan(-1);
    const fin = payments.indexOf("\nexport async function", inicio + 1);
    const cuerpo = payments.slice(inicio, fin === -1 ? undefined : fin);

    // Solo puede aparecer nombrado en un comentario, nunca llamado.
    const codigo = cuerpo
      .split("\n")
      .filter((l) => {
        const t = l.trimStart();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");

    expect(codigo).not.toContain("withPaymentAdvisoryLock");
    expect(codigo).not.toContain("db.transaction(");
    expect(codigo).toContain("anularPagoYRestituirMoraSerializado({");
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

  it("el saldo del rubro también se devuelve UNA sola vez", async () => {
    // El mismo defecto, en la otra plata que las dos rutas mueven. Un rubro de
    // Q1,000 con Q400 aplicados: si las dos lo devuelven, queda en Q1,400 —por
    // encima de su monto original— y la siguiente boleta le cobra al cliente
    // una diferencia que nunca debió.
    const cola = crearCola();

    let saldoRubro = 600;
    let reclamoVivo = true;

    const devolverRubro = async (etiqueta: string, ceder: number) => {
      traza.push(`${etiqueta}:lee:${saldoRubro}`);
      const habiaReclamo = reclamoVivo;
      const base = saldoRubro;
      for (let i = 0; i < ceder; i++) await tick();
      if (!habiaReclamo) {
        // El reclamo es el guard de doble reversa: sin él no hay nada que
        // devolver.
        traza.push(`${etiqueta}:sin-reclamo`);
        return;
      }
      saldoRubro = base + 400;
      reclamoVivo = false;
      traza.push(`${etiqueta}:devuelve:${saldoRubro}`);
    };

    const reversa = cola(CREDITO_ID, () => devolverRubro("reversa", 3));
    const anulacion = anularPagoYRestituirMoraSerializado(
      { pago_id: PAGO_ID, credito_id: CREDITO_ID },
      {
        withCreditLock: cola,
        runTransaction: (async (fn: any) => fn({} as any)) as any,
        anular: (async () => {
          await devolverRubro("anulacion", 1);
          return 1;
        }) as any,
      },
    );

    await Promise.all([reversa, anulacion]);

    expect(saldoRubro).toBe(1000);
    expect(traza).toEqual([
      `lock(${CREDITO_ID})`,
      "reversa:lee:600",
      "reversa:devuelve:1000",
      `unlock(${CREDITO_ID})`,
      `lock(${CREDITO_ID})`,
      "anulacion:lee:1000",
      "anulacion:sin-reclamo",
      `unlock(${CREDITO_ID})`,
    ]);
  });
});
