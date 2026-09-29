/**
 * REVERTIR UN PAGO NO PUEDE COBRARLE AL CLIENTE MORA QUE EL CRON YA REPUSO.
 *
 * El defecto (vivo en producción, no lo introdujo este stack): el paso 6️⃣ de
 * `reversePayment` sumaba `pagos_credito.mora` A CIEGAS. Registrar un pago baja
 * la mora en el acto, pero el criterio de cobertura del cron solo cuenta pagos
 * `validated`/`no_required`: un pago que amanece `pending` deja su cuota
 * contada como vencida y `procesarMoras` vuelve a FIJAR la mora completa desde
 * la fórmula. Para cuando alguien revierte, la bajada del pago YA está deshecha
 * y sumarla otra vez deja el doble.
 *
 * Caso medido sobre el dump —crédito 980, pago 152172—: DECREMENTO 333.95 →
 * 0.00 el 05-ago 20:09 y CREACION 0.00 → 333.95 el 06-ago 05:59. Revertirlo
 * dejaba la mora en Q667.90.
 *
 * Se ejerce el handler de verdad contra una base falsa. `updateMora` entra por
 * `deps` (y no como import directo) porque varios archivos de la suite lo
 * mockean con `mock.module("./latefee")` y la prueba no puede quedar a merced
 * de cuál gane la corrida.
 */
import { describe, expect, mock, test } from "bun:test";
import {
  creditos,
  moras_historial,
  pagos_credito,
  usuarios,
} from "../database/db/schema";
import { MOTIVO_REVERSA_MORA_PREFIJO } from "../utils/motivoReversaMora";

const syntheticEnvironment = {
  SUPABASE_DB_URL: "postgresql://127.0.0.1:1/synthetic",
  RESEND_API_KEY: "synthetic-test-key",
  EMAIL_DOMAIN: "example.invalid",
} as const;
const previousEnvironment = Object.fromEntries(
  Object.keys(syntheticEnvironment).map((key) => [key, process.env[key]]),
) as Record<keyof typeof syntheticEnvironment, string | undefined>;
Object.assign(process.env, syntheticEnvironment);
const { createReversePayment } = await import("./reversePayment");
const { createCarteraStructuredLogger } = await import(
  "../utils/structuredLogger"
);
for (const key of Object.keys(syntheticEnvironment) as Array<
  keyof typeof syntheticEnvironment
>) {
  const previous = previousEnvironment[key];
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
}

type ReversePaymentDependencies = NonNullable<
  Parameters<typeof createReversePayment>[0]
>;

const CREDITO_ID = 980;
const PAGO_ID = 152172;
/** Cuando se escribió la fila del pago: el ancla de la reconciliación. */
const CREADO = new Date("2026-08-05T20:09:00.000Z");

const pagoConMora = {
  pago_id: PAGO_ID,
  credito_id: CREDITO_ID,
  cuota_id: null,
  validationStatus: "pending",
  registerBy: "synthetic-test",
  mora: "333.95",
  pagoConvenio: "0",
  pagado: false,
  paymentFalse: false,
  createdAt: CREADO as Date | null,
  capital_restante: "100",
  interes_restante: "10",
  iva_12_restante: "1.2",
  seguro_restante: "0",
  gps_restante: "0",
  membresias: "0",
  abono_capital: "0",
  abono_interes: "0",
  abono_iva_12: "0",
  abono_seguro: "0",
  abono_gps: "0",
  membresias_pago: "0",
  monto_boleta: "0",
};

const creditoActivo = {
  creditos: {
    credito_id: CREDITO_ID,
    usuario_id: 20,
    statusCredit: "ACTIVO",
    capital: "1000",
    cuota_interes: "10",
    iva_12: "1.2",
    deudatotal: "1011.2",
    porcentaje_interes: "1",
    seguro_10_cuotas: "0",
    gps: "0",
    membresias_pago: "0",
    cuota: "100",
  },
  usuarios: { usuario_id: 20 },
};
const usuario = { usuario_id: 20, saldo_a_favor: "0" };

/**
 * Un `tx` de drizzle lo bastante real para este camino, que responde POR TABLA
 * (y no por orden de llamada) para que agregar o quitar un SELECT en otro paso
 * de la reversa no rompa esta prueba.
 */
function crearTxFalso(
  pago: Record<string, unknown>,
  eventosDelCron: unknown[],
  tablasConsultadas: unknown[],
  tablasActualizadas: unknown[] = [],
) {
  const filasPorTabla = new Map<unknown, unknown[]>([
    [pagos_credito, [pago]],
    [creditos, [creditoActivo]],
    [usuarios, [usuario]],
    [moras_historial, eventosDelCron],
  ]);
  const select = () => {
    let tabla: unknown = null;
    const filas = () => {
      const resultado = filasPorTabla.get(tabla) ?? [];
      const promesa: any = Object.assign(Promise.resolve(resultado), {
        limit: () => promesa,
        // La búsqueda del DECREMENTO marcado ordena por `(fecha, historial_id)`
        // para quedarse con el más reciente.
        orderBy: () => promesa,
      });
      return promesa;
    };
    const b: any = {
      from: (t: unknown) => (
        (tabla = t), tablasConsultadas.push(t), b
      ),
      innerJoin: () => b,
      where: filas,
      limit: () => filas(),
      for: () => b,
    };
    return b;
  };
  return {
    select: mock(select),
    update: mock((tabla: unknown) => ({
      set: () => ({
        where: () => {
          tablasActualizadas.push(tabla);
          return Object.assign(Promise.resolve([]), {
            returning: () => Promise.resolve([]),
          });
        },
      }),
    })),
    delete: mock(() => ({
      where: () =>
        Object.assign(Promise.resolve([]), {
          returning: () => Promise.resolve([]),
        }),
    })),
    execute: mock(() => Promise.resolve([])),
  };
}

async function revertir({
  pago = pagoConMora,
  eventosDelCron = [] as unknown[],
} = {}) {
  const restituciones: any[] = [];
  const tablasConsultadas: unknown[] = [];
  const tablasActualizadas: unknown[] = [];
  const tx = crearTxFalso(pago, eventosDelCron, tablasConsultadas, tablasActualizadas);
  const handler = createReversePayment({
    runTransaction: (async (callback: (value: typeof tx) => Promise<unknown>) =>
      callback(tx)) as unknown as ReversePaymentDependencies["runTransaction"],
    reverseInvestors: mock(async () =>
      [],
    ) as unknown as ReversePaymentDependencies["reverseInvestors"],
    reverseCapitalPayment: mock(() =>
      Promise.resolve(undefined),
    ) as unknown as ReversePaymentDependencies["reverseCapitalPayment"],
    withCreditLock: ((_creditoId: number, fn: () => Promise<unknown>) =>
      fn()) as ReversePaymentDependencies["withCreditLock"],
    refrescarProyeccion: mock(() =>
      Promise.resolve({ corrio: true as const }),
    ) as unknown as ReversePaymentDependencies["refrescarProyeccion"],
    restituirMora: (async (args: any) => {
      restituciones.push(args);
      return { success: true };
    }) as unknown as ReversePaymentDependencies["restituirMora"],
  });

  await handler({
    body: { credito_id: CREDITO_ID, pago_id: PAGO_ID },
    set: { status: 0 },
    telemetryLogger: createCarteraStructuredLogger({ sink: () => {} }),
  });

  return { restituciones, tablasConsultadas, tablasActualizadas };
}

describe("la reversa restituye la mora que de verdad falta", () => {
  test("si el cron ya la repuso, revertir NO vuelve a sumarla", async () => {
    const { restituciones, tablasConsultadas } = await revertir({
      eventosDelCron: [{ historial_id: 9001 }],
    });

    expect(restituciones).toHaveLength(0);
    // Y el camino LLEGÓ hasta el paso de la mora: el cero no es porque la
    // reversa reventara antes.
    expect(tablasConsultadas).toContain(moras_historial);
  });

  test("si el cron no pasó, restituye completa: el cliente no pagó", async () => {
    const { restituciones } = await revertir({ eventosDelCron: [] });

    expect(restituciones).toHaveLength(1);
    expect(restituciones[0].monto_cambio).toBe(333.95);
    expect(restituciones[0].tipo).toBe("INCREMENTO");
    // El motivo es CONTRATO: el reporte de recuperación lo lee por prefijo para
    // no contar la restitución como mora nueva.
    expect(
      String(restituciones[0].motivo).startsWith(MOTIVO_REVERSA_MORA_PREFIJO),
    ).toBe(true);
    expect(String(restituciones[0].motivo)).toContain(String(PAGO_ID));
  });

  test("sin marca y sin ancla no se reconcilia: restituye (el comportamiento seguro)", async () => {
    // El decremento no lleva marca (decremento viejo) y la fila del pago
    // tampoco tiene `createdat`: no se puede saber qué pasó después. El
    // sobrecobro lo corrige el cron en su próxima corrida; perderle la mora al
    // crédito no lo corrige nadie.
    //
    // Lo que YA NO vale es "ni siquiera se consulta el historial": la búsqueda
    // del decremento marcado no depende de la fecha y por eso se hace igual.
    // Esa independencia es el arreglo.
    const { restituciones } = await revertir({
      pago: { ...pagoConMora, createdAt: null },
      eventosDelCron: [{ historial_id: 9001 }],
    });

    expect(restituciones).toHaveLength(1);
    expect(restituciones[0].monto_cambio).toBe(333.95);
  });

  test("con el decremento identificado, la reversa lo MARCA como anulado", async () => {
    // El tercer defecto, del lado de la reversa: sin la marca el reporte de
    // recuperación sigue viendo la bajada del pago revertido y cuenta la
    // reposición del cron como mora NUEVA. La marca va por `tx` —es una
    // anotación que solo vale si la reversa commitea— y va aunque el monto a
    // restituir sea 0.
    const { tablasActualizadas } = await revertir({
      eventosDelCron: [
        {
          historial_id: 7001,
          fecha: new Date("2026-08-05T20:09:00.000Z"),
          monto_anterior: "333.95",
          monto_nuevo: "0.00",
          motivo: `Pago aplicado a mora (crédito 980) [pago #${PAGO_ID}]`,
        },
      ],
    });

    expect(tablasActualizadas).toContain(moras_historial);
  });

  test("un pago sin mora no consulta el historial ni toca la mora", async () => {
    const { restituciones, tablasConsultadas } = await revertir({
      pago: { ...pagoConMora, mora: "0" },
      eventosDelCron: [{ historial_id: 9001 }],
    });

    expect(restituciones).toHaveLength(0);
    expect(tablasConsultadas).not.toContain(moras_historial);
  });

  test("revertir una boleta YA anulada no restituye de nuevo", async () => {
    // La anulación por boleta falsa ya le devolvió su mora al crédito.
    const { restituciones, tablasConsultadas } = await revertir({
      pago: { ...pagoConMora, paymentFalse: true },
    });

    expect(restituciones).toHaveLength(0);
    expect(tablasConsultadas).toContain(moras_historial);
  });
});
