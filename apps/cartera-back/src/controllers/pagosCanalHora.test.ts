import { describe, expect, it, mock } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { lockPoolMock } from "../utils/testMocks";

// Captura el SQL que arma getPagosConInversionistas sin tocar una base: la
// primera consulta es el COUNT, que lleva el WHERE completo.
const consultas: string[] = [];
const dbMock = () => ({
  db: {
    execute: (q: any) => {
      consultas.push(new PgDialect().sqlToQuery(q).sql.replace(/\s+/g, " ").trim());
      return Promise.resolve({ rows: [] });
    },
    // El router importa módulos que enlazan db.transaction al cargarse.
    transaction: () => Promise.reject(new Error("sin BD en tests")),
  },
  client: {},
  lockPool: lockPoolMock,
});
mock.module("../database", dbMock);
mock.module("../database/index", dbMock);
// La cadena de imports de payments.ts arrastra el paquete de correo, que exige estas variables.
process.env.RESEND_API_KEY ??= "re_test_only";
process.env.EMAIL_DOMAIN ??= "example.test";

const { getPagosConInversionistas } = await import("./payments");

const whereDelCount = async (opciones: Record<string, unknown>) => {
  consultas.length = 0;
  await getPagosConInversionistas(opciones as any);
  return consultas[0]!;
};

// SQL del COUNT antes de esta rebanada (capturado en 41be38882). Sin horas ni
// canal el filtro de rango tiene que quedar EXACTAMENTE así.
const COUNT_RANGO_SIN_HORAS = `SELECT COUNT(*) as total FROM cartera.pagos_credito p LEFT JOIN cartera.creditos c ON c.credito_id = p.credito_id LEFT JOIN cartera.usuarios u ON u.usuario_id = c.usuario_id WHERE (CASE WHEN p.nexa_payment_event_id IS NOT NULL THEN p.fecha_pago ELSE p.fecha_pago AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala' END)::date >= '2026-10-01'::date AND (CASE WHEN p.nexa_payment_event_id IS NOT NULL THEN p.fecha_pago ELSE p.fecha_pago AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala' END)::date <= '2026-10-06'::date AND p.validation_status IN ('validated', 'pending' ,'reset', 'capital', 'capital_validated') AND c."statusCredit" IN ('ACTIVO', 'MOROSO','PENDIENTE_CANCELACION','EN_CONVENIO','CANCELADO','INCOBRABLE')`;

describe("pagos con inversionistas: sin horas el SQL no cambia", () => {
  it("rango de fecha de pago sin horas ni canal", async () => {
    expect(await whereDelCount({ fechaInicio: "2026-10-01", fechaFin: "2026-10-06" })).toBe(COUNT_RANGO_SIN_HORAS);
  });
});

describe("pagos con inversionistas: canal", () => {
  it("NEXA filtra los que tienen evento Nexa", async () => {
    expect(await whereDelCount({ canal: "NEXA" })).toContain("p.nexa_payment_event_id IS NOT NULL AND");
  });
  it("MANUAL filtra los que no tienen evento Nexa", async () => {
    expect(await whereDelCount({ canal: "MANUAL" })).toContain("WHERE p.nexa_payment_event_id IS NULL AND");
  });
  it("cualquier otro valor no filtra", async () => {
    const sinCanal = await whereDelCount({});
    expect(await whereDelCount({ canal: "nexa' OR 1=1 --" })).toBe(sinCanal);
  });
});

describe("pagos con inversionistas: hora de registro", () => {
  it("con horas el rango usa el momento de registro: desde inclusivo, hasta exclusivo", async () => {
    const q = await whereDelCount({ fechaInicio: "2026-10-05", fechaFin: "2026-10-06", horaInicio: "17:00", horaFin: "17:00" });
    expect(q).toContain(">= '2026-10-05 17:00'::timestamp");
    expect(q).toContain("< '2026-10-06 17:00'::timestamp");
    // Nexa: hora del evento (la fila puede ser reusada y su createdat es viejo).
    expect(q).toContain("WHERE ne_mom.id = p.nexa_payment_event_id) AT TIME ZONE 'America/Guatemala'");
    expect(q).toContain("WHEN p.nexa_payment_event_id IS NULL THEN p.fecha_pago");
    expect(q).not.toContain("createdat");
    expect(q).not.toContain("::date >= '2026-10-05'::date");
  });
  it("si falta una hora, esa punta usa 00:00 al inicio y fin de día al final", async () => {
    const soloInicio = await whereDelCount({ fechaInicio: "2026-10-05", fechaFin: "2026-10-06", horaInicio: "08:30" });
    expect(soloInicio).toContain(">= '2026-10-05 08:30'::timestamp");
    expect(soloInicio).toContain("< ('2026-10-06'::date + 1)::timestamp");
    const soloFin = await whereDelCount({ fechaInicio: "2026-10-05", fechaFin: "2026-10-06", horaFin: "17:00" });
    expect(soloFin).toContain(">= '2026-10-05 00:00'::timestamp");
    expect(soloFin).toContain("< '2026-10-06 17:00'::timestamp");
  });
  for (const mala of ["25:00", "17:60", "5:00", "17:00:00", "17:00'; DROP TABLE x; --"]) {
    it(`rechaza la hora inválida ${JSON.stringify(mala)}`, async () => {
      await expect(getPagosConInversionistas({ fechaInicio: "2026-10-05", horaInicio: mala } as any)).rejects.toThrow("hora");
    });
  }
});

describe("GET /reportes/pagos-inversionistas: parámetros nuevos", async () => {
  const { Elysia } = await import("elysia");
  const jwt = (await import("jsonwebtoken")).default;
  const { paymentRouter } = await import("../routers/payments");
  const { validationErrorMiddleware } = await import("../middleware/validationError");
  const app = new Elysia().use(validationErrorMiddleware).use(paymentRouter);
  const token = jwt.sign({ id: 1, email: "a@b.c", role: "CONTA" }, process.env.JWT_SECRET || "supersecreto");
  const get = (qs: string) => {
    consultas.length = 0;
    return app.handle(new Request(`http://localhost/reportes/pagos-inversionistas?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    }));
  };

  for (const qs of ["canal=nexa", "canal=OTRO", "horaInicio=5:00", "horaFin=24:00", "horaInicio=17%3A00%3A00"]) {
    it(`rechaza ${qs} con 422 sin tocar la base`, async () => {
      const res = await get(`fechaInicio=2026-10-05&${qs}`);
      expect(res.status).toBe(422);
      expect(consultas).toHaveLength(0);
    });
  }
  for (const qs of ["horaInicio=17%3A00&fechaFin=2026-10-06", "fechaInicio=2026-10-05&horaFin=17%3A00", "horaInicio=17%3A00"]) {
    it(`rechaza una hora sin su fecha (${qs}) con 422 sin tocar la base`, async () => {
      consultas.length = 0;
      const res = await app.handle(new Request(`http://localhost/reportes/pagos-inversionistas?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      }));
      expect(res.status).toBe(422);
      expect((await res.json()).success).toBe(false);
      expect(consultas).toHaveLength(0);
    });
  }
  it("canal y horas válidos llegan al controlador", async () => {
    const res = await get("fechaInicio=2026-10-05&fechaFin=2026-10-06&horaInicio=17%3A00&horaFin=17%3A00&canal=NEXA");
    expect(res.status).toBe(200);
    expect(consultas[0]).toContain("p.nexa_payment_event_id IS NOT NULL AND");
    expect(consultas[0]).toContain("< '2026-10-06 17:00'::timestamp");
  });
});
