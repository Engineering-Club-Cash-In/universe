/**
 * El cron de mora NO puede escribir una mora activa de Q0.00.
 *
 * Con la mora proporcional, un capital chico con 1 día de atraso da un monto
 * que redondea a "0.00" (Q10 × 1.12% × 1/30 ≈ Q0.0037). Insertar eso con
 * activa=true sería escribir lo que la API prohíbe (createMora: "Monto de mora
 * debe ser mayor a 0"), contradecir a decidirMoraTrasRomperConvenio —que para
 * ese mismo crédito deja ACTIVO— y marcar MOROSO a un cliente por una mora de
 * cero.
 *
 * Estas pruebas ejercen `procesarMoras` DE VERDAD contra una base falsa: lo
 * que importa no es la fórmula (eso lo cubre moraProporcional.test.ts) sino
 * qué writes salen y cuáles NO.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";

type Call = { tabla: any; set?: any; values?: any; where?: any };

const estado: {
  resultados: any[];
  inserts: Call[];
  updates: Call[];
} = { resultados: [], inserts: [], updates: [] };

const thenable = (obtener: () => any) => {
  const builder: any = {
    from: () => builder,
    innerJoin: () => builder,
    leftJoin: () => builder,
    where: (w: any) => {
      builder._where = w;
      return builder;
    },
    returning: () => builder,
    then: (res: any, rej: any) => Promise.resolve().then(obtener).then(res, rej),
  };
  return builder;
};

const dbFalsa = {
  select: () => thenable(() => estado.resultados.shift() ?? []),
  insert: (tabla: any) => ({
    values: (values: any) => {
      const call: Call = { tabla, values };
      estado.inserts.push(call);
      return thenable(() => [{ mora_id: 999, porcentaje_mora: "1.12" }]);
    },
  }),
  update: (tabla: any) => ({
    set: (set: any) => {
      const call: Call = { tabla, set };
      estado.updates.push(call);
      const b = thenable(() => ({ rowCount: 1 }));
      const where = b.where;
      b.where = (w: any) => {
        call.where = w;
        return where(w);
      };
      return b;
    },
  }),
};

const clientFalso = {
  connect: async () => ({
    query: async () => ({ rows: [{ ok: true }] }),
    release: () => {},
  }),
};

mock.module("../database", () => ({ db: dbFalsa, client: clientFalso }));

const { procesarMoras, hoyGuatemala } = await import("./latefee");
const { creditos, moras_credito, moras_historial } = await import("../database/db/schema");

const CREDITO_ID = 4242;

// Una cuota vencida AYER (calendario Guatemala) de un crédito de capital Q10:
// 10 × 1.12% × 1/30 = Q0.0037 → "0.00".
const cuotaDeAyer = () => {
  const hoy = hoyGuatemala();
  const ayer = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1);
  return {
    cuota_id: 1,
    credito_id: CREDITO_ID,
    fecha_vencimiento: ayer,
    pagado: false,
    statusCredit: "ACTIVO",
    capital: "10",
    hasPaidPayment: false,
  };
};

// Valores literales que lleva la cláusula WHERE de un update. Se leen de los
// `queryChunks` de drizzle en vez de recorrer el objeto entero a ciegas: una
// columna arrastra referencias a su tabla (y con ella a los enums de status),
// así que un walk ingenuo encuentra "MOROSO" aunque el WHERE no lo filtre.
const parametrosDelWhere = (nodo: any, out: any[] = []): any[] => {
  for (const chunk of nodo?.queryChunks ?? []) {
    if (Array.isArray(chunk)) continue; // trozos de SQL crudo
    if (chunk && typeof chunk === "object" && "value" in chunk && !("queryChunks" in chunk)) {
      out.push(chunk.value);
    } else {
      parametrosDelWhere(chunk, out);
    }
  }
  return out;
};

const correrCon = async (morasActivas: any[]) => {
  estado.resultados = [[cuotaDeAyer()], morasActivas];
  estado.inserts = [];
  estado.updates = [];
  return await procesarMoras();
};

beforeEach(() => {
  estado.resultados = [];
  estado.inserts = [];
  estado.updates = [];
});

describe("procesarMoras — mora proporcional que redondea a Q0.00", () => {
  it("capital chico con 1 día de atraso: NO inserta mora activa ni marca MOROSO", async () => {
    const r: any = await correrCon([]);

    expect(estado.inserts.filter((c) => c.tabla === moras_credito)).toEqual([]);
    expect(estado.updates.filter((c) => c.tabla === creditos)).toEqual([]);
    expect(r.creadas).toBe(0);
    expect(r.moraCero).toBe(1);
  });

  it("si ya tenía una mora activa, la desactiva y baja el status solo si seguía MOROSO", async () => {
    const r: any = await correrCon([
      {
        mora_id: 77,
        credito_id: CREDITO_ID,
        monto_mora: "112.00",
        cuotas_atrasadas: 1,
        porcentaje_mora: "1.12",
      },
    ]);

    // No se creó nada nuevo...
    expect(estado.inserts.filter((c) => c.tabla === moras_credito)).toEqual([]);

    // ...la mora vieja quedó apagada en cero...
    const apagados = estado.updates.filter((c) => c.tabla === moras_credito);
    expect(apagados.length).toBe(1);
    expect(apagados[0].set).toMatchObject({ activa: false, monto_mora: "0", cuotas_atrasadas: 0 });

    // ...el status bajó a ACTIVO y SOLO desde MOROSO...
    const status = estado.updates.filter((c) => c.tabla === creditos);
    expect(status.length).toBe(1);
    expect(status[0].set).toEqual({ statusCredit: "ACTIVO" });
    expect(parametrosDelWhere(status[0].where)).toContain("MOROSO");

    // ...y el historial dice por qué, con su motivo propio (no el de capital cero).
    const historial = estado.inserts.filter((c) => c.tabla === moras_historial);
    expect(historial.length).toBe(1);
    expect(historial[0].values).toMatchObject({
      tipo_evento: "DESACTIVACION",
      monto_nuevo: "0",
      motivo: "Mora proporcional menor a un centavo",
    });

    expect(r.desactivadas).toBe(1);
    expect(r.moraCero).toBe(1);
  });
});
