/**
 * ORDEN DE CANDADOS del módulo de mora — y la FECHA de los eventos.
 *
 * ── Por qué existe este archivo ─────────────────────────────────────────────
 * Las rutas del módulo tocan las mismas dos filas: la del crédito y la de su
 * mora. Mientras el convenio tomaba `creditos` primero y el cron tomaba
 * `moras_credito` primero, las dos transacciones se quedaban esperando el
 * candado que tenía la otra: ciclo de deadlock. Postgres corta el ciclo
 * matando una con 40P01, que nadie maneja acá — o falla el convenio, o aborta
 * la corrida nocturna ENTERA antes de procesar el resto de los créditos.
 *
 * La regla quedó escrita arriba de todo en `latefee.ts`:
 *
 *     dentro de una transacción, primero `creditos`, después `moras_credito`.
 *
 * Estas pruebas la hacen exigible. No leen el código ni cuentan llamadas
 * sueltas: ejercen las funciones DE VERDAD contra una base falsa que anota, POR
 * TRANSACCIÓN, cada vez que se pide el candado de una tabla —un UPDATE, un
 * INSERT o un `SELECT … FOR UPDATE`— y después verifican que ninguna
 * transacción haya pedido `creditos` DESPUÉS de tener `moras_credito`.
 *
 * Que la verificación sea un barrido sobre TODAS las transacciones observadas
 * (y no una aserción escrita a mano por cada ruta) es a propósito: alcanza con
 * agregar un escenario a `ESCENARIOS` para que una ruta nueva quede cubierta, y
 * una ruta existente que invierta el orden revienta sin que nadie tenga que
 * acordarse de escribirle su prueba.
 *
 * ── Y la fecha ──────────────────────────────────────────────────────────────
 * Sobre el mismo barrido se verifica que TODO evento de `moras_historial` se
 * escriba con `clock_timestamp()` y no con el `DEFAULT now()` de la columna:
 * `now()` es `transaction_timestamp()` —la hora del BEGIN—, y con la
 * transacción larga del convenio eso fechaba su DESACTIVACION ANTES de
 * mutaciones que en realidad ocurrieron primero, dejando que el reporte
 * histórico mostrara mora activa después de que el convenio la apagó.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Un pedido de candado: qué tabla y por qué vía. */
type Candado = { tabla: any; via: "update" | "insert" | "for update" };
/** Los candados que pidió UNA transacción, en orden. */
type Transaccion = Candado[];
type Insert = { tabla: any; values: any };

const estado: {
  /** Filas que devuelven los SELECT, en orden de llamada. */
  selects: any[][];
  /** Filas que devuelve cada `.returning()` de un UPDATE, por tabla. */
  updateReturns: Map<any, any[][]>;
  /** Una entrada por transacción de primer nivel observada. */
  transacciones: Transaccion[];
  /** Todos los INSERT ejecutados (haya commiteado o no la tx). */
  inserts: Insert[];
} = {
  selects: [],
  updateReturns: new Map(),
  transacciones: [],
  inserts: [],
};

/**
 * Scope de ejecución. `raiz` distingue el autocommit (cada statement suelta su
 * candado enseguida, así que no puede sostener un ciclo) de una transacción de
 * verdad. Los savepoints anidados son la MISMA transacción física: sus
 * candados se vuelcan al padre en vez de contarse aparte.
 */
type Scope = { candados: Candado[]; raiz: boolean };

const clienteFalso = (scope: Scope): any => {
  const pedirCandado = (tabla: any, via: Candado["via"]) => {
    if (!scope.raiz) scope.candados.push({ tabla, via });
  };

  const selectChain = () => {
    let tabla: any = null;
    const b: any = {
      from: (t: any) => {
        tabla = t;
        return b;
      },
      innerJoin: () => b,
      leftJoin: () => b,
      where: () => b,
      orderBy: () => b,
      limit: () => b,
      // `SELECT … FOR UPDATE` candea la fila igual que un UPDATE.
      for: () => {
        pedirCandado(tabla, "for update");
        return b;
      },
      then: (res: any, rej: any) =>
        Promise.resolve(estado.selects.shift() ?? []).then(res, rej),
    };
    return b;
  };

  return {
    select: () => selectChain(),
    insert: (tabla: any) => ({
      values: (values: any) => {
        const ejecutar = () => {
          // El INSERT de una mora también compite (índice único parcial); el
          // de historial es append-only, pero anotarlo no molesta: la regla
          // habla de `creditos` y `moras_credito`.
          pedirCandado(tabla, "insert");
          estado.inserts.push({ tabla, values });
          return Promise.resolve([{ mora_id: 999, porcentaje_mora: "1.12" }]);
        };
        const b: any = {
          returning: () => ejecutar(),
          then: (res: any, rej: any) => ejecutar().then(() => []).then(res, rej),
        };
        return b;
      },
    }),
    update: (tabla: any) => ({
      set: () => {
        const ejecutar = () => {
          pedirCandado(tabla, "update");
          return estado.updateReturns.get(tabla)?.shift() ?? [
            { mora_id: 77, credito_id: CREDITO_ID },
          ];
        };
        const b: any = {
          where: () => b,
          returning: () => Promise.resolve(ejecutar()),
          then: (res: any, rej: any) => {
            ejecutar();
            return Promise.resolve({ rowCount: 1 }).then(res, rej);
          },
        };
        return b;
      },
    }),
    transaction: async (cb: any) => {
      const hijo: Scope = { candados: [], raiz: false };
      try {
        return await cb(clienteFalso(hijo));
      } finally {
        // El orden se evalúa igual si la transacción abortó: los candados se
        // pidieron (y el deadlock se pudo dar) antes del ROLLBACK.
        if (scope.raiz) estado.transacciones.push(hijo.candados);
        else scope.candados.push(...hijo.candados);
      }
    },
  };
};

const dbFalsa = clienteFalso({ candados: [], raiz: true });

const clientFalso = {
  connect: async () => ({
    query: async () => ({ rows: [{ ok: true }] }),
    release: () => {},
  }),
};

mock.module("../database", () => ({ db: dbFalsa, client: clientFalso }));
mock.module("../utils/structuredLogger", () => ({ emitCreditLateFee: () => {} }));

const {
  procesarMoras,
  hoyGuatemala,
  desactivarMoraSiCreditoAlDia,
  desactivarMoraPorConvenio,
  updateMora,
  condonarMora,
} = await import("./latefee");
const { creditos, moras_credito, moras_historial } = await import(
  "../database/db/schema"
);

const CREDITO_ID = 4242;

const MORA_ACTIVA = {
  mora_id: 77,
  credito_id: CREDITO_ID,
  monto_mora: "1.00",
  cuotas_atrasadas: 9,
  porcentaje_mora: "1.12",
};

/** Cuota vencida ayer; el capital decide si hay mora que cobrar o no. */
const cuotaDeAyer = (capital = "10000") => {
  const hoy = hoyGuatemala();
  const ayer = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1);
  return {
    cuota_id: 1,
    credito_id: CREDITO_ID,
    fecha_vencimiento: ayer,
    pagado: false,
    statusCredit: "ACTIVO",
    capital,
    hasPaidPayment: false,
  };
};

const CUOTA_AL_DIA = {
  fecha_vencimiento: new Date("2099-01-15T06:00:00.000Z"),
  pagado: false,
  hasPaidPayment: false,
  statusCredit: "MOROSO",
};

/**
 * Cada escenario ejerce UNA transacción del módulo que toca las dos tablas.
 * Agregar una ruta nueva acá la mete sola en todas las verificaciones de abajo.
 */
const ESCENARIOS: Array<{
  nombre: string;
  /** Deja listos los SELECT que va a consumir el camino. */
  preparar: () => void;
  correr: () => Promise<unknown>;
  /** ¿Este camino debe dejar un evento en moras_historial? */
  escribeHistorial: boolean;
}> = [
  {
    nombre: "procesarMoras — rama CREACION",
    preparar: () => {
      estado.selects = [[cuotaDeAyer()], []];
    },
    correr: () => procesarMoras(),
    escribeHistorial: true,
  },
  {
    nombre: "procesarMoras — rama RECALCULO",
    preparar: () => {
      estado.selects = [[cuotaDeAyer()], [MORA_ACTIVA]];
    },
    correr: () => procesarMoras(),
    escribeHistorial: true,
  },
  {
    nombre: "procesarMoras — paso 5, mora que redondea a Q0.00 (desactivarMoraDelCron)",
    preparar: () => {
      // Capital Q10 con 1 día: 10 × 1.12% × 1/30 ≈ Q0.0037 → "0.00".
      estado.selects = [[cuotaDeAyer("10")], [MORA_ACTIVA]];
    },
    correr: () => procesarMoras(),
    escribeHistorial: true,
  },
  {
    nombre: "procesarMoras — paso 6, crédito al día (desactivarMoraDelCron)",
    preparar: () => {
      estado.selects = [[], [MORA_ACTIVA]];
    },
    correr: () => procesarMoras(),
    escribeHistorial: true,
  },
  {
    nombre: "desactivarMoraSiCreditoAlDia",
    preparar: () => {
      estado.selects = [
        [MORA_ACTIVA],
        [{ statusCredit: "MOROSO", capital: "114160.35" }],
        [CUOTA_AL_DIA],
      ];
    },
    correr: () => desactivarMoraSiCreditoAlDia(CREDITO_ID),
    escribeHistorial: true,
  },
  {
    nombre: "updateMora (/mora/update)",
    preparar: () => {
      // creditos FOR UPDATE, después moras_credito FOR UPDATE.
      estado.selects = [
        [{ statusCredit: "MOROSO" }],
        [{ id: 77, monto: "100.00", activa: true, porcentaje_mora: "1.12", cuotas_atrasadas: 2 }],
      ];
    },
    correr: () =>
      updateMora({
        credito_id: CREDITO_ID,
        tipo: "INCREMENTO",
        monto_cambio: 50,
        motivo: "prueba de orden de candados",
      }),
    escribeHistorial: true,
  },
  {
    nombre: "condonarMora",
    preparar: () => {
      estado.selects = [
        [{ id: 9 }], // platform_users por email
        [{ credito_id: CREDITO_ID }], // creditos FOR UPDATE
        [{ id: 77, monto: "100.00", cuotas_atrasadas: 2 }], // moras_credito FOR UPDATE
      ];
    },
    correr: () =>
      condonarMora({
        credito_id: CREDITO_ID,
        motivo: "prueba de orden de candados",
        usuario_email: "quien@sea.com",
      }),
    escribeHistorial: true,
  },
  {
    nombre: "desactivarMoraPorConvenio (transacción propia)",
    preparar: () => {
      estado.selects = [[MORA_ACTIVA]];
    },
    correr: () => desactivarMoraPorConvenio(CREDITO_ID, { convenio_id: 1 }),
    escribeHistorial: true,
  },
];

const reset = () => {
  estado.selects = [];
  estado.updateReturns = new Map();
  estado.transacciones = [];
  estado.inserts = [];
};

/**
 * La violación: una transacción cuyo PRIMER candado sobre `creditos` llega
 * después del primero sobre `moras_credito`. Lo que puede trabar es adquirir
 * el candado del crédito estando ya sentado sobre el de la mora; volver a
 * tocar una fila que esta misma transacción ya candó no espera a nadie, así
 * que un segundo UPDATE de `creditos` más abajo es inofensivo.
 *
 * Devuelve una descripción legible o null.
 */
const violacionDeOrden = (tx: Transaccion): string | null => {
  const primeraMora = tx.findIndex((c) => c.tabla === moras_credito);
  const primerCredito = tx.findIndex((c) => c.tabla === creditos);
  if (primeraMora === -1 || primerCredito === -1) return null;
  if (primerCredito < primeraMora) return null;
  const secuencia = tx
    .map((c) => `${c.tabla === creditos ? "creditos" : "moras_credito"} (${c.via})`)
    .join(" → ");
  return `pidió creditos por primera vez después de moras_credito: ${secuencia}`;
};

beforeEach(reset);

describe("orden de candados: creditos ANTES que moras_credito", () => {
  for (const escenario of ESCENARIOS) {
    it(`${escenario.nombre}: ninguna transacción pide creditos después de la mora`, async () => {
      escenario.preparar();
      await escenario.correr();

      // Si esto falla, el camino dejó de tocar las dos tablas o el fake dejó de
      // verlas: la prueba sería verde por vacío, que es peor que roja.
      expect(estado.transacciones.length).toBeGreaterThan(0);

      const violaciones = estado.transacciones
        .map(violacionDeOrden)
        .filter((v): v is string => v !== null);
      expect(violaciones).toEqual([]);
    });
  }

  it("el barrido de veras mira las dos tablas juntas (si no, no probaría nada)", async () => {
    // Guardia contra un fake que deje de registrar: al menos un escenario tiene
    // que mostrar una transacción con candados sobre AMBAS tablas.
    let vistas = 0;
    for (const escenario of ESCENARIOS) {
      reset();
      escenario.preparar();
      await escenario.correr();
      vistas += estado.transacciones.filter(
        (tx) =>
          tx.some((c) => c.tabla === creditos) &&
          tx.some((c) => c.tabla === moras_credito),
      ).length;
    }
    expect(vistas).toBeGreaterThan(0);
  });

  it("el detector no es decorativo: una secuencia invertida SÍ se marca", () => {
    expect(
      violacionDeOrden([
        { tabla: moras_credito, via: "update" },
        { tabla: creditos, via: "update" },
      ]),
    ).not.toBeNull();
    expect(
      violacionDeOrden([
        { tabla: creditos, via: "update" },
        { tabla: moras_credito, via: "update" },
      ]),
    ).toBeNull();
  });

  it("el convenio marca EN_CONVENIO ANTES de llamar a desactivarMoraPorConvenio", () => {
    // `desactivarMoraPorConvenio` corre DENTRO de la transacción del convenio y
    // solo toca `moras_credito`: el orden compuesto lo define el caller. Esto
    // se verifica sobre la fuente porque es una relación entre dos archivos que
    // ninguna prueba de comportamiento del helper puede ver.
    const fuente = readFileSync(
      join(import.meta.dir, "paymentAgreement.ts"),
      "utf8",
    );
    const update = fuente.indexOf(".update(creditos)");
    const desactiva = fuente.indexOf("desactivarMoraPorConvenio(credit_id");
    expect(update).toBeGreaterThan(-1);
    expect(desactiva).toBeGreaterThan(-1);
    expect(update).toBeLessThan(desactiva);
  });
});

describe("moras_historial.fecha: la hora de la ESCRITURA, no la del BEGIN", () => {
  for (const escenario of ESCENARIOS.filter((e) => e.escribeHistorial)) {
    it(`${escenario.nombre}: el evento se fecha con clock_timestamp()`, async () => {
      escenario.preparar();
      await escenario.correr();

      const eventos = estado.inserts.filter((i) => i.tabla === moras_historial);
      expect(eventos.length).toBeGreaterThan(0);

      for (const evento of eventos) {
        // Con el DEFAULT now() la columna no viene en el INSERT y se llena con
        // transaction_timestamp(): la hora del BEGIN.
        expect(evento.values.fecha).toBeDefined();
        const sql = JSON.stringify(evento.values.fecha);
        expect(sql).toContain("clock_timestamp()");
        expect(sql).not.toContain("now()");
      }
    });
  }
});
