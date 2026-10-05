/**
 * Verificación de que los tres lugares donde el sistema mueve mora y anota
 * el historial ahora propagan el error del INSERT del historial, en vez de
 * tragárselo en silencio.
 *
 * La regla que valida esto: adentro de una transacción, tragarse un error del
 * INSERT es mentiroso — Postgres aborta la tx y el COMMIT se vuelve ROLLBACK
 * silencioso, así que la mutación se pierde igual pero el caller creyó que
 * quedó escrita. Afuera de transacción el trago es solo una omisión del evento,
 * pero sigue siendo un hoyo en la auditoría: el dinero se movió y nadie lo vio.
 *
 * Por eso: `propagarError: true` en los tres.
 *
 * `condonarMora` además se movió ADENTRO de su transacción: antes el INSERT del
 * historial salía DESPUÉS del COMMIT, otro hoyo de candado. Ahora revienta la
 * transacción si falla, lo que es lo correcto.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";

type Operacion = {
  marca: string;
  tipo: "BEGIN" | "COMMIT" | "ROLLBACK" | "select" | "insert" | "update";
  tabla?: any;
};

const estado: {
  operaciones: Operacion[];
  selects: any[][];
  /** Tabla cuyo INSERT debe reventar (para probar el camino del fallo). */
  insertQueFalla: any | null;
} = { operaciones: [], selects: [], insertQueFalla: null };

const clienteFalso = (marca: string): any => ({
  marca,
  select: () => {
    let tabla: any = null;
    const b: any = {
      from: (t: any) => ((tabla = t), b),
      where: () => b,
      and: () => b,
      orderBy: () => b,
      desc: () => b,
      limit: () => b,
      for: () => b,
      leftJoin: () => b,
      innerJoin: () => b,
      then: (res: any, rej: any) => {
        estado.operaciones.push({ marca, tipo: "select", tabla });
        const data = estado.selects.shift();
        return Promise.resolve(data ?? []).then(res, rej);
      },
    };
    return b;
  },
  insert: (tabla: any) => ({
    values: (vals?: any) => {
      const ejecutar = async () => {
        estado.operaciones.push({ marca, tipo: "insert", tabla });
        if (estado.insertQueFalla === tabla) {
          throw new Error("insert reventado a propósito para probar propagarError");
        }
        // Retornar datos según qué tabla se está insertando
        if (tabla === moras_credito || tabla?.name === "moras_credito") {
          return [{ mora_id: 77, credito_id: CREDITO_ID, porcentaje_mora: "1.12" }];
        }
        if (tabla === moras_historial || tabla?.name === "moras_historial") {
          return [{ historial_id: 6001 }];
        }
        if (tabla === moras_condonaciones || tabla?.name === "moras_condonaciones") {
          return [{ condonacion_id: 1 }];
        }
        return [{}];
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
        estado.operaciones.push({ marca, tipo: "update", tabla });
        if (tabla === creditos || tabla?.name === "creditos") {
          return [{ credito_id: CREDITO_ID, statusCredit: "MOROSO" }];
        }
        if (tabla === moras_credito || tabla?.name === "moras_credito") {
          return [{ mora_id: 77, credito_id: CREDITO_ID, cuotas_atrasadas: 2 }];
        }
        return [{ credito_id: CREDITO_ID }];
      };
      const b: any = {
        where: () => b,
        inArray: () => b,
        and: () => b,
        eq: () => b,
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
    estado.operaciones.push({ marca, tipo: "BEGIN" });
    try {
      const r = await cb(clienteFalso(`${marca}:tx`));
      estado.operaciones.push({ marca, tipo: "COMMIT" });
      return r;
    } catch (e) {
      estado.operaciones.push({ marca, tipo: "ROLLBACK" });
      throw e;
    }
  },
  execute: async () => {
    // Para las queries SQL raw (conteo de cuotas, etc.)
    return { rows: [{ n: 1, factor: "0.03" }] };
  },
});

const dbFalsa = clienteFalso("db");

mock.module("../database", () => ({
  db: dbFalsa,
  client: { connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }) },
  lockPool: {},
}));

mock.module("../utils/structuredLogger", () => ({
  emitCreditLateFee: () => {},
}));

const { createMora, condonarMora, condonarTodasLasMoras } = await import("./latefee");
const { moras_historial, moras_credito, creditos, moras_condonaciones } = await import(
  "../database/db/schema"
);

const CREDITO_ID = 4242;

const resetEstado = () => {
  estado.operaciones = [];
  estado.selects = [];
  estado.insertQueFalla = null;
};

describe("latefeeBitacoraPropaga: propagarError en los tres lugares", () => {
  describe("createMora", () => {
    beforeEach(resetEstado);

    // La regla es CONDICIONAL, y la primera versión de esta prueba la tenía
    // mal: exigía que createMora siempre devolviera error. Una revisión de
    // código mostró por qué eso es un defecto — sin transacción, la mora y el
    // MOROSO ya están commiteados cuando falla la bitácora, y devolver
    // `success:false` hacía que los llamadores trataran como inexistente una
    // mora que sí existe. Las dos pruebas de abajo fijan las dos mitades.

    it("SIN transacción del llamador: si falla la bitácora, NO miente sobre la mora ya escrita", async () => {
      estado.selects = [
        [{ capital: "1000", statusCredit: "ACTIVO" }],
        // Merge COBROS-02: el conteo real sale de un select de las cuotas
        // (cuotasVencidasRealesDelCredito, promesa-aware), no del SQL crudo.
        [{ numero_cuota: 1, fecha_vencimiento: "2020-01-01", pagado: false, hasPaidPayment: false }],
        [],
      ];
      estado.insertQueFalla = moras_historial;

      const res = await createMora({
        credito_id: CREDITO_ID,
        monto_mora: 100,
        cuotas_atrasadas: 1,
        motivo: "prueba",
      });

      // La mora quedó escrita: reportar error acá dejaría estado inconsistente.
      expect(res.success).toBe(true);
    });

    it("CON transacción del llamador: si falla la bitácora, propaga para que el llamador revierta todo", async () => {
      estado.selects = [
        [{ capital: "1000", statusCredit: "ACTIVO" }],
        // Merge COBROS-02: el conteo real sale de un select de las cuotas
        // (cuotasVencidasRealesDelCredito, promesa-aware), no del SQL crudo.
        [{ numero_cuota: 1, fecha_vencimiento: "2020-01-01", pagado: false, hasPaidPayment: false }],
        [],
      ];
      estado.insertQueFalla = moras_historial;

      const res = await createMora({
        credito_id: CREDITO_ID,
        monto_mora: 100,
        cuotas_atrasadas: 1,
        motivo: "prueba",
        // El doble de la base hace de transacción del llamador.
        dbClient: (await import("../database/index")).db,
      });

      // Adentro de una transacción, tragarse el error mentiría: el COMMIT
      // devolvería ROLLBACK sin excepción. Tiene que propagar.
      expect(res.success).toBe(false);
    });
  });

  describe("condonarMora", () => {
    beforeEach(resetEstado);

    it("camino feliz: crea la condonación y registra el historial dentro de la transacción", async () => {
      // Usuario
      estado.selects = [
        [{ id: 999 }],
        [{ credito_id: CREDITO_ID }], // SELECT creditos FOR UPDATE
        // Mora activa (SELECT moras_credito FOR UPDATE)
        [{ id: 77, monto: "500.00", cuotas_atrasadas: 2 }],
        // Cuotas para pendiente (inside cuotasParaPendienteDeCreditos)
        [],
        // Mora pagada por cuota (inside moraPagadaPorCuota)
        [],
      ];

      const res = await condonarMora({
        credito_id: CREDITO_ID,
        motivo: "prueba",
        usuario_email: "test@test.com",
      });

      expect(res.success).toBe(true);
      // El historial debe estar ADENTRO de la transacción (antes del COMMIT)
      const evento = estado.operaciones.find(
        (o) => o.tipo === "insert" && o.tabla === moras_historial,
      );
      const commit = estado.operaciones.find((o) => o.tipo === "COMMIT");
      expect(evento).toBeDefined();
      expect(commit).toBeDefined();
      expect(estado.operaciones.indexOf(evento!)).toBeLessThan(
        estado.operaciones.indexOf(commit!),
      );
    });

    it("si el INSERT del historial falla, la transacción se revierte (ROLLBACK)", async () => {
      estado.selects = [
        [{ id: 999 }],
        [{ credito_id: CREDITO_ID }], // SELECT creditos FOR UPDATE
        // Mora activa (SELECT moras_credito FOR UPDATE)
        [{ id: 77, monto: "500.00", cuotas_atrasadas: 2 }],
        // Cuotas para pendiente (inside cuotasParaPendienteDeCreditos)
        [],
        // Mora pagada por cuota (inside moraPagadaPorCuota)
        [],
      ];
      estado.insertQueFalla = moras_historial;

      const res = await condonarMora({
        credito_id: CREDITO_ID,
        motivo: "prueba",
        usuario_email: "test@test.com",
      });

      // success:false porque el error del INSERT se propagó adentro de la tx
      expect(res.success).toBe(false);
      // Debe haber un ROLLBACK porque el error se propagó adentro de la transacción
      const rollback = estado.operaciones.find((o) => o.tipo === "ROLLBACK");
      expect(rollback).toBeDefined();
    });
  });

  describe("condonarTodasLasMoras", () => {
    beforeEach(resetEstado);

    it("camino feliz: registra histórico para cada condonación masiva", async () => {
      // Con el nuevo flujo, el SELECT de moras ahora se hace DENTRO de la transacción
      // después de adquirir el candado, así que necesitamos más selects:
      // 1) User lookup
      // 2) SELECT MOROSO credits
      // 3) Lock SELECT
      // 4) Re-read moras activas
      estado.selects = [
        [{ id: 999 }], // user lookup
        [{ credito_id: CREDITO_ID }, { credito_id: 4243 }], // MOROSO credits
        [{ credito_id: CREDITO_ID }, { credito_id: 4243 }], // lock
        // Créditos morosos con mora activa (re-read inside tx)
        [
          { credito_id: CREDITO_ID, mora_id: 77, monto_mora: "100.00", cuotas_atrasadas: 1 },
          { credito_id: 4243, mora_id: 78, monto_mora: "200.00", cuotas_atrasadas: 2 },
        ],
      ];

      const res = await condonarTodasLasMoras({
        motivo: "prueba masiva",
        usuario_email: "test@test.com",
      });

      expect(res.success).toBe(true);
      // Debe haber UN INSERT de historial por cada condonación
      const historiales = estado.operaciones.filter(
        (o) => o.tipo === "insert" && o.tabla === moras_historial,
      );
      expect(historiales.length).toBe(2);
    });

    it("si un historial falla en la Promise.all, la función retorna success:false (propaga el error)", async () => {
      // Same new flow as above
      estado.selects = [
        [{ id: 999 }], // user lookup
        [{ credito_id: CREDITO_ID }, { credito_id: 4243 }], // MOROSO credits
        [{ credito_id: CREDITO_ID }, { credito_id: 4243 }], // lock
        [
          { credito_id: CREDITO_ID, mora_id: 77, monto_mora: "100.00", cuotas_atrasadas: 1 },
          { credito_id: 4243, mora_id: 78, monto_mora: "200.00", cuotas_atrasadas: 2 },
        ],
      ];
      // Hacer que el INSERT del historial falle
      estado.insertQueFalla = moras_historial;

      const res = await condonarTodasLasMoras({
        motivo: "prueba masiva",
        usuario_email: "test@test.com",
      });

      // success:false porque el error del INSERT se propagó en Promise.all
      expect(res.success).toBe(false);
    });
  });
});
