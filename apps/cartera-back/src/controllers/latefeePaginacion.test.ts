import { describe, expect, it, mock } from "bun:test";

// ─────────────────────────────────────────────────────────────────────────────
// Paginación de Gestión de Moras: la pantalla traía 666 créditos de un solo
// golpe. Estos tests verifican que el listado JSON pagine y que `total` /
// `totales` se calculen sobre TODO el conjunto filtrado, no sobre la página.
//
// OJO: el mock de "../database" DEBE incluir `client: {}` — latefee.ts importa
// `client` y bun test comparte caché de módulos entre archivos.
// ─────────────────────────────────────────────────────────────────────────────

type ChainState = { limit?: number; offset?: number };

function makeChain(resolve: (state: ChainState) => any[]) {
  const state: ChainState = {};
  const chain: any = {};
  for (const method of ["from", "innerJoin", "leftJoin", "orderBy", "for"]) {
    chain[method] = () => chain;
  }
  chain.where = (predicado: any) => { ultimoWhere = predicado; return chain; };
  chain.limit = (n: number) => { state.limit = n; return chain; };
  chain.offset = (n: number) => { state.offset = n; return chain; };
  chain.then = (onOk: any, onErr: any) =>
    Promise.resolve().then(() => resolve(state)).then(onOk, onErr);
  return { chain, state };
}

// 7 créditos con mora; el total de mora es 7 * 100 = 700.
const CREDITOS = Array.from({ length: 7 }, (_, i) => ({
  credito_id: i + 1,
  numero_credito_sifco: `SIFCO-${i + 1}`,
  usuario: `Cliente ${i + 1}`,
  monto_mora: "100.00",
}));

const CONDONACIONES = Array.from({ length: 5 }, (_, i) => ({
  condonacion_id: i + 1,
  credito_id: i + 1,
  montoCondonacion: "50.00",
}));

// Guarda el estado de la última query de datos para poder afirmar LIMIT/OFFSET.
let ultimaQueryDatos: ChainState = {};
/** Último predicado WHERE que armó el controlador (para renderizar su SQL). */
let ultimoWhere: any;
/** Filas insertadas, por tabla-ish: se guarda el objeto tal cual. */
const insertados: any[] = [];
/** Créditos MOROSO que devuelve el leftJoin de la condonación masiva. */
let morososMasivos: any[] = [];

/** Fila de mora que ve `updateMora` dentro de la transacción. */
const MORA_ACTUAL = {
  id: 77,
  mora_id: 77,
  monto: "300.00",
  activa: true,
  porcentaje_mora: "1.12",
  cuotas_atrasadas: 3,
};

mock.module("../database", () => {
  const select = (selection: any) => {
    // Query de totales: pide count()/sum(). Query de datos: pide columnas.
    const esTotales = "mora_total" in selection || "monto_total" in selection;
    const esCondonaciones = "monto_total" in selection || "condonacion_id" in selection;

    // Selects que NO son de los listados paginados.
    if ("id" in selection && Object.keys(selection).length === 1) {
      // Búsqueda del platform_user por email.
      const { chain } = makeChain(() => [{ id: 9 }]);
      return chain;
    }
    if ("mora_id" in selection && "monto_mora" in selection) {
      // Créditos MOROSO + su mora activa (condonación masiva).
      const { chain } = makeChain(() => morososMasivos);
      return chain;
    }
    if ("porcentaje_mora" in selection) {
      const { chain } = makeChain(() => [MORA_ACTUAL]);
      return chain;
    }
    if ("statusCredit" in selection) {
      const { chain } = makeChain(() => [{ statusCredit: "MOROSO" }]);
      return chain;
    }

    const filas = esCondonaciones ? CONDONACIONES : CREDITOS;

    if (esTotales) {
      const { chain } = makeChain(() => [
        esCondonaciones
          ? { condonaciones: filas.length, monto_total: "250.00" }
          : { creditos: filas.length, mora_total: "700.00" },
      ]);
      return chain;
    }

    const { chain } = makeChain((s) => {
      ultimaQueryDatos = { ...s };
      const from = s.offset ?? 0;
      const to = s.limit !== undefined ? from + s.limit : filas.length;
      return filas.slice(from, to);
    });
    return chain;
  };

  const update = () => {
    const chain: any = {};
    chain.set = () => chain;
    chain.where = () => chain;
    chain.returning = () =>
      Promise.resolve([{ ...MORA_ACTUAL, monto_mora: "200.00" }]);
    chain.then = (onOk: any, onErr: any) => Promise.resolve([]).then(onOk, onErr);
    return chain;
  };

  const insert = () => {
    const chain: any = {};
    chain.values = (v: any) => {
      insertados.push(v);
      chain.filas = Array.isArray(v) ? v : [v];
      return chain;
    };
    chain.returning = () => Promise.resolve(chain.filas ?? []);
    chain.then = (onOk: any, onErr: any) => Promise.resolve(chain.filas ?? []).then(onOk, onErr);
    return chain;
  };

  const db = {
    select,
    update,
    insert,
    transaction: (cb: any) => cb({ select, update, insert }),
  };
  return { client: {}, db };
});

const {
  getCreditosWithMoras,
  getCondonacionesMora,
  clampPagination,
  filtroFechaCondonacionesGT,
  ParametroInvalidoError,
  updateMora,
  condonarTodasLasMoras,
} = await import("./latefee");

const { PgDialect } = await import("drizzle-orm/pg-core");
const dialecto = new PgDialect();
/** SQL + parámetros reales que produce el filtro (evidencia, no aproximación). */
const renderizar = (clauses: any[]) =>
  clauses.map((c) => {
    const q = dialecto.sqlToQuery(c);
    return { sql: q.sql, params: q.params };
  });

describe("clampPagination", () => {
  it("usa page=1 y pageSize=20 por defecto", () => {
    expect(clampPagination(undefined, undefined)).toEqual({ page: 1, pageSize: 20, offset: 0 });
  });

  it("rechaza page/pageSize negativos o NaN y cae al default", () => {
    expect(clampPagination(-3, -10)).toEqual({ page: 1, pageSize: 20, offset: 0 });
    expect(clampPagination(NaN, NaN)).toEqual({ page: 1, pageSize: 20, offset: 0 });
  });

  it("topa pageSize en 500", () => {
    expect(clampPagination(1, 9999).pageSize).toBe(500);
  });

  it("calcula el offset a partir de la página", () => {
    expect(clampPagination(3, 25).offset).toBe(50);
  });
});

describe("getCreditosWithMoras (paginación)", () => {
  it("respeta pageSize y devuelve el total del conjunto filtrado, no el de la página", async () => {
    const res: any = await getCreditosWithMoras({ page: 2, pageSize: 3 });

    expect(ultimaQueryDatos).toEqual({ limit: 3, offset: 3 });
    expect(res.data.length).toBe(3);
    expect(res.count).toBe(3);
    expect(res.pagination).toEqual({ page: 2, pageSize: 3, total: 7, totalPages: 3 });
  });

  it("devuelve totales (mora_total y créditos) sobre todo el conjunto filtrado", async () => {
    const res: any = await getCreditosWithMoras({ page: 1, pageSize: 2 });

    expect(res.data.length).toBe(2);
    expect(res.totales).toEqual({ mora_total: "700.00", creditos: 7 });
  });

  it("aplica el clamp defensivo cuando llega paginación inválida", async () => {
    const res: any = await getCreditosWithMoras({ page: -1, pageSize: 10_000 });

    expect(res.pagination.page).toBe(1);
    expect(res.pagination.pageSize).toBe(500);
    expect(ultimaQueryDatos).toEqual({ limit: 500, offset: 0 });
  });
});

describe("getCondonacionesMora (paginación)", () => {
  it("pagina y devuelve totales del conjunto filtrado", async () => {
    const res: any = await getCondonacionesMora({ page: 2, pageSize: 2 });

    expect(ultimaQueryDatos).toEqual({ limit: 2, offset: 2 });
    expect(res.data.length).toBe(2);
    expect(res.pagination).toEqual({ page: 2, pageSize: 2, total: 5, totalPages: 3 });
    expect(res.totales).toEqual({ monto_total: "250.00", condonaciones: 5 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Filtro de fecha de condonaciones: `moras_condonaciones.fecha` es timestamp SIN
// zona con el instante en UTC, y la pantalla muestra el día de GUATEMALA.
// El filtro tiene que operar sobre el día GT, no sobre el día UTC crudo.
// ─────────────────────────────────────────────────────────────────────────────
describe("filtroFechaCondonacionesGT", () => {
  it("convierte el día de Guatemala a los instantes UTC del día (rango semiabierto)", () => {
    // 25/08/2026 en Guatemala = [25/08 06:00 UTC, 26/08 06:00 UTC).
    expect(renderizar(filtroFechaCondonacionesGT("2026-08-25", "2026-08-25"))).toEqual([
      {
        sql: '"cartera"."moras_condonaciones"."fecha" >= $1::timestamp',
        params: ["2026-08-25 06:00:00.000"],
      },
      {
        sql: '"cartera"."moras_condonaciones"."fecha" < $1::timestamp',
        params: ["2026-08-26 06:00:00.000"],
      },
    ]);
  });

  it("compara contra la columna CRUDA (sargable), no contra AT TIME ZONE", () => {
    const [{ sql: sqlDesde }] = renderizar(
      filtroFechaCondonacionesGT("2026-08-25", undefined)
    );
    expect(sqlDesde).not.toContain("AT TIME ZONE");
    expect(sqlDesde.startsWith('"cartera"."moras_condonaciones"."fecha" >=')).toBe(true);
  });

  it("aplica 'desde' y 'hasta' por separado (antes se ignoraban si faltaba uno)", () => {
    const soloDesde = renderizar(filtroFechaCondonacionesGT("2026-08-25", undefined));
    expect(soloDesde.length).toBe(1);
    expect(soloDesde[0].sql).toContain(">=");
    expect(soloDesde[0].params).toEqual(["2026-08-25 06:00:00.000"]);

    const soloHasta = renderizar(filtroFechaCondonacionesGT(undefined, "2026-08-25"));
    expect(soloHasta.length).toBe(1);
    expect(soloHasta[0].sql).toContain("<");
    expect(soloHasta[0].params).toEqual(["2026-08-26 06:00:00.000"]);
  });

  it("el límite superior incluye TODO el día elegido en hora de Guatemala", () => {
    const [, hasta] = renderizar(filtroFechaCondonacionesGT("2026-08-25", "2026-08-25"));
    const corte = new Date(`${(hasta.params as string[])[0]}Z`);

    // Una condonación de las 23:59:59.999 GT del 25 (05:59:59.999 UTC del 26) entra…
    expect(new Date("2026-08-26T05:59:59.999Z") < corte).toBe(true);
    // …y la de las 00:00 GT del 26 (06:00 UTC del 26) ya no.
    expect(new Date("2026-08-26T06:00:00.000Z") < corte).toBe(false);
  });

  it("sin fecha no hay filtro (ausente o vacía = 'no pedí filtro')", () => {
    expect(filtroFechaCondonacionesGT(undefined, undefined)).toEqual([]);
    expect(filtroFechaCondonacionesGT("", "")).toEqual([]);
    expect(filtroFechaCondonacionesGT("  ", undefined)).toEqual([]);
  });

  // Antes este caso devolvía [] y el endpoint respondía 200 con TODA la historia
  // de condonaciones (y con excel=true subía ese Excel a R2), mientras la
  // pantalla seguía mostrando el rango que el usuario había pedido.
  it("una fecha PRESENTE pero inválida es un error explícito, no un filtro ignorado", () => {
    expect(() => filtroFechaCondonacionesGT("25/08/2026", undefined)).toThrow(
      ParametroInvalidoError
    );
    expect(() => filtroFechaCondonacionesGT("ayer", undefined)).toThrow(
      /fecha_desde inválida/
    );
    expect(() => filtroFechaCondonacionesGT(undefined, "2026-02-31")).toThrow(
      /fecha_hasta inválida/
    );

    try {
      filtroFechaCondonacionesGT("2026-13-01", undefined);
      throw new Error("debió lanzar");
    } catch (e: any) {
      expect(e).toBeInstanceOf(ParametroInvalidoError);
      expect(e.status).toBe(400);
      expect(e.parametro).toBe("fecha_desde");
      expect(e.message).toContain("YYYY-MM-DD");
    }
  });

  it("un día que no existe no se normaliza a otro día", () => {
    // "2026-02-31" se convertía en el 3 de marzo sin avisarle a nadie.
    expect(() => filtroFechaCondonacionesGT("2026-02-31", undefined)).toThrow(
      ParametroInvalidoError
    );
  });

  it("cruza correctamente meses y años", () => {
    expect(
      renderizar(filtroFechaCondonacionesGT("2026-01-01", "2026-12-31"))[1].params
    ).toEqual(["2027-01-01 06:00:00.000"]);
    expect(
      renderizar(filtroFechaCondonacionesGT("2026-02-28", "2026-02-28"))[1].params
    ).toEqual(["2026-03-01 06:00:00.000"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hallazgos del review adversarial: parámetros inválidos, comodines de ILIKE,
// historial de mora fiel y conteo real de la condonación masiva.
// ─────────────────────────────────────────────────────────────────────────────

describe("getCondonacionesMora — fecha inválida NO devuelve toda la historia", () => {
  it("rechaza con 400 en vez de responder 200 sin filtro", async () => {
    ultimaQueryDatos = {};
    await expect(
      getCondonacionesMora({ fecha_desde: "25/08/2026" })
    ).rejects.toBeInstanceOf(ParametroInvalidoError);
    // Ni siquiera se llegó a consultar la base.
    expect(ultimaQueryDatos).toEqual({});
  });

  it("con excel=true tampoco genera ni sube nada", async () => {
    await expect(
      getCondonacionesMora({ fecha_hasta: "2026-02-31", excel: true })
    ).rejects.toThrow(/fecha_hasta inválida/);
  });

  it("una fecha válida sí consulta", async () => {
    const res: any = await getCondonacionesMora({
      fecha_desde: "2026-08-25",
      fecha_hasta: "2026-08-25",
      page: 1,
      pageSize: 2,
    });
    expect(res.success).toBe(true);
  });
});

describe("getCreditosWithMoras — cuotas_atrasadas no numérico", () => {
  it("NaN se rechaza con 400 en vez de reventar en Postgres con 500", async () => {
    ultimaQueryDatos = {};
    // Es exactamente lo que produce el router: Number("abc").
    await expect(
      getCreditosWithMoras({ cuotas_atrasadas: Number("abc") })
    ).rejects.toBeInstanceOf(ParametroInvalidoError);
    expect(ultimaQueryDatos).toEqual({});
  });

  it("también rechaza negativos y decimales", async () => {
    await expect(getCreditosWithMoras({ cuotas_atrasadas: -1 })).rejects.toThrow(
      /cuotas_atrasadas inválido/
    );
    await expect(getCreditosWithMoras({ cuotas_atrasadas: 2.5 })).rejects.toThrow(
      /cuotas_atrasadas inválido/
    );
  });

  it("un entero válido pasa", async () => {
    const res: any = await getCreditosWithMoras({ cuotas_atrasadas: 2, pageSize: 2 });
    expect(res.success).toBe(true);
  });
});

describe("nombre_usuario — los comodines de ILIKE se escapan", () => {
  const paramsDelWhere = () => {
    const q = dialecto.sqlToQuery(ultimoWhere);
    return q.params;
  };

  it("'_' se busca literal (antes matcheaba a TODOS)", async () => {
    await getCreditosWithMoras({ nombre_usuario: "_", pageSize: 1 });
    expect(paramsDelWhere()).toContain("%\\_%");
  });

  it("'%' ya no devuelve la tabla entera", async () => {
    await getCreditosWithMoras({ nombre_usuario: "100%", pageSize: 1 });
    expect(paramsDelWhere()).toContain("%100\\%%");
  });

  it("la contrabarra también se escapa (es el carácter de escape de Postgres)", async () => {
    await getCondonacionesMora({ nombre_usuario: "a\\b", pageSize: 1 });
    expect(paramsDelWhere()).toContain("%a\\\\b%");
  });

  it("un nombre normal no se toca", async () => {
    await getCondonacionesMora({ nombre_usuario: "Pérez", pageSize: 1 });
    expect(paramsDelWhere()).toContain("%Pérez%");
  });
});

describe("updateMora — no escribe un '→ 0' falso en el historial", () => {
  const historialMora = () =>
    insertados.filter((f) => f && "tipo_evento" in f && "monto_nuevo" in f);

  it("sin cuotas_atrasadas registra el valor que quedó en la fila", async () => {
    insertados.length = 0;
    const res: any = await updateMora({
      credito_id: 1,
      monto_cambio: 100,
      tipo: "DECREMENTO",
      motivo: "pago aplicado",
    });
    expect(res.success).toBe(true);

    const [evento] = historialMora();
    expect(evento.cuotas_atrasadas_anterior).toBe(3);
    // Antes: 0, y el modal de Historial mostraba "Cuotas atrasadas: 3 → 0"
    // en cada pago, un cambio que nunca ocurrió.
    expect(evento.cuotas_atrasadas_nuevas).toBe(3);
  });

  it("si el llamador SÍ manda cuotas_atrasadas, se respeta", async () => {
    insertados.length = 0;
    await updateMora({
      credito_id: 1,
      monto_cambio: 100,
      tipo: "DECREMENTO",
      cuotas_atrasadas: 0,
      motivo: "se puso al día",
    });
    expect(historialMora()[0].cuotas_atrasadas_nuevas).toBe(0);
  });
});

describe("condonarTodasLasMoras — el conteo no incluye créditos sin mora activa", () => {
  it("cuenta solo las moras que realmente se condonaron", async () => {
    insertados.length = 0;
    // 3 créditos MOROSO; el leftJoin deja 1 sin mora activa (mora_id null):
    // ese ni se actualiza ni genera condonación.
    morososMasivos = [
      { credito_id: 1, mora_id: 11, monto_mora: "100.00", cuotas_atrasadas: 2 },
      { credito_id: 2, mora_id: 12, monto_mora: "200.00", cuotas_atrasadas: 3 },
      { credito_id: 3, mora_id: null, monto_mora: null, cuotas_atrasadas: null },
    ];

    const res: any = await condonarTodasLasMoras({
      motivo: "condonación masiva",
      usuario_email: "quien@clubcashin.com",
    });

    expect(res.success).toBe(true);
    expect(res.condonados).toBe(2); // antes: 3
    expect(res.creditos_afectados).toBe(2);
    expect(res.message).toContain("2 moras");
    expect(res.condonaciones.length).toBe(2);
  });

  it("si ningún MOROSO tiene mora activa, condona 0", async () => {
    morososMasivos = [{ credito_id: 9, mora_id: null, monto_mora: null, cuotas_atrasadas: null }];
    const res: any = await condonarTodasLasMoras({
      motivo: "x",
      usuario_email: "quien@clubcashin.com",
    });
    expect(res.condonados).toBe(0);
    expect(res.message).toContain("No hay moras activas");
  });

  it("el historial masivo no inventa un '→ 0' de cuotas atrasadas", async () => {
    insertados.length = 0;
    morososMasivos = [
      { credito_id: 1, mora_id: 11, monto_mora: "100.00", cuotas_atrasadas: 4 },
    ];
    await condonarTodasLasMoras({ motivo: "x", usuario_email: "quien@clubcashin.com" });

    const evento = insertados.find((f) => f && f.tipo_evento === "CONDONACION");
    expect(evento.cuotas_atrasadas_anterior).toBe(4);
    expect(evento.cuotas_atrasadas_nuevas).toBe(4);
    expect(evento.monto_nuevo).toBe("0");
  });
});
