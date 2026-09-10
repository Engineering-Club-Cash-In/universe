import { beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * Tests del controller REAL enviarARecuperacionVehiculo con la DB (frontera del
 * sistema) fakeada — mismo patrón que reasignarAsesor.test.ts de esta carpeta.
 * Lo que se prueba acá es lo que la bitácora tiene que poder responder después:
 * qué fila queda en buckets_historial, si el asesor cambió o no, y que ninguna
 * validación fallida escriba a medias.
 */

type Fila = Record<string, any>;

const estado = {
  selectsPorTabla: new Map<any, Fila[]>(),
  // db.execute sirve dos consultas de datos en orden (getEstadoCredito y
  // getCargaDelBucket). Los SET/advisory lock NO consumen la cola: se detectan
  // por el texto del SQL, así que agregar o mover un lock no desalinea los tests.
  executeQueue: [] as Fila[][],
  locksTomados: [] as string[],
  inserts: [] as { tabla: any; filas: Fila[] }[],
  updates: [] as { tabla: any; set: Fila }[],
  actualizacionAfecta: true,
};

/** Texto aproximado de un objeto SQL de drizzle, para reconocer los locks. */
function textoSql(q: any): string {
  const chunks = q?.queryChunks ?? [];
  return chunks
    .map((c: any) => (c?.value ? ([] as string[]).concat(c.value).join("") : ""))
    .join(" ");
}

function crearBuilderSelect() {
  let tabla: any = null;
  const b: any = {
    from(t: any) {
      tabla = t;
      return b;
    },
    innerJoin: () => b,
    leftJoin: () => b,
    where: () => b,
    orderBy: () => b,
    limit: () => b,
    then(res: any, rej: any) {
      return Promise.resolve(estado.selectsPorTabla.get(tabla) ?? []).then(res, rej);
    },
  };
  return b;
}

function crearMutadores() {
  return {
    insert(tabla: any) {
      return {
        values(v: Fila | Fila[]) {
          const filas = Array.isArray(v) ? v : [v];
          estado.inserts.push({ tabla, filas });
          return Promise.resolve(filas);
        },
      };
    },
    update(tabla: any) {
      return {
        set(s: Fila) {
          estado.updates.push({ tabla, set: s });
          return {
            where: () => {
              const filas = estado.actualizacionAfecta ? [{}] : [];
              const resultado: any = Promise.resolve(filas);
              resultado.returning = () => Promise.resolve(filas);
              return resultado;
            },
          };
        },
      };
    },
  };
}

const fakeExecute = async (q: any) => {
  const texto = textoSql(q);
  if (texto.includes("advisory") || texto.includes("lock_timeout")) {
    estado.locksTomados.push(texto.trim());
    return { rows: [] };
  }
  return { rows: estado.executeQueue.shift() ?? [] };
};

const fakeDb: any = {
  select: () => crearBuilderSelect(),
  ...crearMutadores(),
  execute: fakeExecute,
  // Ahora TODO corre dentro de la transacción (incluidas las lecturas), así que
  // el tx falso necesita `select` además de los mutadores.
  transaction: async (cb: any) =>
    cb({
      ...crearMutadores(),
      select: () => crearBuilderSelect(),
      execute: fakeExecute,
    }),
};

mock.module("../../database", () => ({ db: fakeDb, client: {} }));

const schema = await import("../../database/db/schema");
const { enviarARecuperacionVehiculo, BUCKET_RECUPERACION_VEHICULO } = await import(
  "./recuperacionVehiculo"
);

/** Deja el crédito listo: catálogo con B4 activo, estado del crédito y carga. */
function prepararCredito(opts: {
  bucket: number | null;
  asesor_id: number | null;
  fuera?: boolean;
  status?: string;
  cuotas?: number;
  pool?: number[];
  carga?: { asesor_id: number; cuentas: number }[];
}) {
  estado.selectsPorTabla.set(schema.buckets, [
    { numero: BUCKET_RECUPERACION_VEHICULO, nombre: "Última Instancia / Pre Jurídico" },
  ]);
  estado.executeQueue = [
    [
      {
        asesor_id: opts.asesor_id,
        status_credito: opts.status ?? "MOROSO",
        cuotas_atrasadas: opts.cuotas ?? 2,
        bucket: opts.bucket,
        fuera: opts.fuera ?? false,
      },
    ],
    opts.carga ?? [],
  ];
  estado.selectsPorTabla.set(
    schema.asesor_bucket,
    (opts.pool ?? [7]).map((asesor_id) => ({ asesor_id })),
  );
  estado.selectsPorTabla.set(schema.platform_users, [{ id: 55 }]);
}

const insertsDe = (tabla: any) => estado.inserts.filter((i) => i.tabla === tabla);

beforeEach(() => {
  estado.selectsPorTabla.clear();
  estado.executeQueue = [];
  estado.locksTomados = [];
  estado.inserts = [];
  estado.updates = [];
  estado.actualizacionAfecta = true;
});

describe("enviarARecuperacionVehiculo — controller real con DB fakeada", () => {
  it("traslada a B4 y reasigna: SUBIDA en buckets_historial + bitácora de asesor", async () => {
    prepararCredito({ bucket: 2, asesor_id: 3, cuotas: 2 });

    const r = await enviarARecuperacionVehiculo({
      credito_id: 9116,
      motivo: "Cliente no responde, se autoriza recuperar la unidad",
      usuario_email: "supervisor@clubcashin.com",
    });

    expect(r).toMatchObject({
      success: true,
      credito_id: 9116,
      bucket_anterior: 2,
      bucket_nuevo: 4,
      tipo_evento: "SUBIDA",
      asesor_anterior: 3,
      asesor_nuevo: 7,
      asesor_sin_cambio: false,
    });

    // La fila del traslado: origen manual y las cuotas REALES (2), no las 4 que
    // el rango de B4 haría suponer — el bucket acá no lo derivó la mora.
    const historialBucket = insertsDe(schema.buckets_historial);
    expect(historialBucket).toHaveLength(1);
    expect(historialBucket[0].filas[0]).toMatchObject({
      credito_id: 9116,
      bucket_anterior: 2,
      bucket_nuevo: 4,
      tipo_evento: "SUBIDA",
      origen: "API_MANUAL",
      cuotas_atrasadas_nuevas: 2,
      status_credito: "MOROSO",
    });
    // Sin columna usuario_id en la tabla, el actor tiene que quedar en el motivo.
    expect(historialBucket[0].filas[0].motivo).toContain("supervisor@clubcashin.com");

    const historialAsesor = insertsDe(schema.credito_asesor_historial);
    expect(historialAsesor).toHaveLength(1);
    expect(historialAsesor[0].filas[0]).toMatchObject({
      credito_id: 9116,
      asesor_anterior: 3,
      asesor_nuevo: 7,
      bucket: 4,
      origen: "API_MANUAL",
      usuario_id: 55,
    });

    // UPDATE: ÚNICAMENTE asesor_id (decisión de raíz).
    expect(estado.updates).toHaveLength(1);
    expect(estado.updates[0].tabla).toBe(schema.creditos);
    expect(estado.updates[0].set).toEqual({ asesor_id: 7 });
  });

  it("el dueño ya cubre B4 → registra el traslado pero NO cambia de asesor", async () => {
    prepararCredito({ bucket: 3, asesor_id: 7, pool: [7, 9] });

    const r = await enviarARecuperacionVehiculo({
      credito_id: 9116,
      motivo: "Se autoriza recuperación",
    });

    expect(r).toMatchObject({
      success: true,
      asesor_anterior: 7,
      asesor_nuevo: 7,
      asesor_sin_cambio: true,
    });
    expect(insertsDe(schema.buckets_historial)).toHaveLength(1);
    expect(insertsDe(schema.credito_asesor_historial)).toHaveLength(0);
    expect(estado.updates).toHaveLength(0);
  });

  it("desde B5 el evento es BAJADA (el CHECK de coherencia lo exige)", async () => {
    prepararCredito({ bucket: 5, asesor_id: 3, status: "INCOBRABLE", cuotas: 6 });

    const r = await enviarARecuperacionVehiculo({
      credito_id: 9116,
      motivo: "Regresa a pre jurídico",
    });

    expect(r).toMatchObject({ success: true, tipo_evento: "BAJADA", bucket_anterior: 5 });
    expect(insertsDe(schema.buckets_historial)[0].filas[0]).toMatchObject({
      tipo_evento: "BAJADA",
      bucket_anterior: 5,
      bucket_nuevo: 4,
    });
  });

  it("reparte al de MENOR carga cuando el dueño no cubre B4", async () => {
    prepararCredito({
      bucket: 1,
      asesor_id: 3,
      pool: [7, 9],
      carga: [
        { asesor_id: 7, cuentas: 40 },
        { asesor_id: 9, cuentas: 5 },
      ],
    });

    const r = await enviarARecuperacionVehiculo({
      credito_id: 9116,
      motivo: "Se autoriza recuperación",
    });

    expect(r).toMatchObject({ success: true, asesor_nuevo: 9 });
  });

  it("rechaza motivo vacío sin escribir nada (400)", async () => {
    prepararCredito({ bucket: 2, asesor_id: 3 });
    const r = await enviarARecuperacionVehiculo({ credito_id: 9116, motivo: "   " });
    expect(r).toMatchObject({ success: false, status: 400 });
    expect(estado.inserts).toHaveLength(0);
    expect(estado.updates).toHaveLength(0);
  });

  it("404 cuando el crédito no existe", async () => {
    estado.selectsPorTabla.set(schema.buckets, [
      { numero: BUCKET_RECUPERACION_VEHICULO, nombre: "Última Instancia / Pre Jurídico" },
    ]);
    estado.executeQueue = [[]];
    const r = await enviarARecuperacionVehiculo({ credito_id: 424242, motivo: "válido" });
    expect(r).toMatchObject({ success: false, status: 404 });
    expect(estado.inserts).toHaveLength(0);
  });

  it("rechaza crédito fuera del funnel operativo (400)", async () => {
    prepararCredito({ bucket: null, asesor_id: 3, fuera: true, status: "CANCELADO" });
    const r = await enviarARecuperacionVehiculo({ credito_id: 9116, motivo: "válido" });
    expect(r).toMatchObject({ success: false, status: 400 });
    expect(estado.inserts).toHaveLength(0);
  });

  it("rechaza si ya está en B4 (no duplica el traslado)", async () => {
    prepararCredito({ bucket: 4, asesor_id: 7 });
    const r = await enviarARecuperacionVehiculo({ credito_id: 9116, motivo: "válido" });
    expect(r).toMatchObject({ success: false, status: 400 });
    expect(estado.inserts).toHaveLength(0);
  });

  it("409 si B4 no tiene asesores activos: no deja el crédito sin dueño", async () => {
    prepararCredito({ bucket: 2, asesor_id: 3, pool: [] });
    const r = await enviarARecuperacionVehiculo({ credito_id: 9116, motivo: "válido" });
    expect(r).toMatchObject({ success: false, status: 409 });
    expect(estado.inserts).toHaveLength(0);
    expect(estado.updates).toHaveLength(0);
  });

  it("409 si el bucket destino no está activo en el catálogo", async () => {
    estado.selectsPorTabla.set(schema.buckets, []);
    const r = await enviarARecuperacionVehiculo({ credito_id: 9116, motivo: "válido" });
    expect(r).toMatchObject({ success: false, status: 409 });
    expect(estado.inserts).toHaveLength(0);
  });

  it("409 si el dueño cambió entre la lectura y la escritura, SIN dejar el traslado a medias", async () => {
    prepararCredito({ bucket: 2, asesor_id: 3 });
    estado.actualizacionAfecta = false;
    const r = await enviarARecuperacionVehiculo({ credito_id: 9116, motivo: "válido" });
    expect(r).toMatchObject({ success: false, status: 409 });
    // El bug que reportó Codex: la fila de bucket se insertaba primero y el
    // `return false` COMMITEABA, así que el crédito quedaba en B4 mientras la API
    // respondía 409. Ahora el UPDATE guardado va antes y el abort revierte.
    expect(insertsDe(schema.buckets_historial)).toHaveLength(0);
  });

  it("toma los locks de AMBOS jobs y el del crédito antes de leer", async () => {
    prepararCredito({ bucket: 2, asesor_id: 3 });
    await enviarARecuperacionVehiculo({ credito_id: 9116, motivo: "válido" });
    // El lock por crédito solo no serializa contra procesarMoras ni el job de
    // convenios: ninguno de los dos lo toma (usan sus llaves globales).
    const locks = estado.locksTomados.join(" | ");
    expect(locks).toContain("lock_timeout");
    expect(estado.locksTomados.filter((l) => l.includes("advisory"))).toHaveLength(3);
  });
});
