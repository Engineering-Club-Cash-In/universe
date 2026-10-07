import { beforeEach, describe, expect, it, mock, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { lockPoolMock } from "../utils/testMocks";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

// ─────────────────────────────────────────────────────────────────────────────
// "Pagos con Inversionistas" (GET /reportes/pagos-inversionistas y los dos Excel
// que reutilizan su WHERE) armaba el SQL pegando el texto del request:
// `numeroCredito=x' OR '1'='1` llegaba como `c.numero_credito_sifco = 'x' OR '1'='1'`
// y devolvía TODOS los pagos. Acá se fija que cada filtro viaja como PARÁMETRO
// ($n) y nunca como texto del SQL.
//
// Sin base: el `db` falso guarda cada query que el controlador manda y la
// compila con el mismo dialecto que usa drizzle en producción.
//
// ⚠️ Correr este archivo solo (o junto a otros de pagos): `reports.test.ts` y
// `paymentAgreement.test.ts` hacen `mock.module("./payments", …)` y, como
// `mock.module` es global al run, en un `bun test` de todo el repo el
// `./payments` de acá puede terminar siendo ese stub (ver falsePaymentRubros.test.ts).
// ─────────────────────────────────────────────────────────────────────────────

let capturadas: SQL[] = [];
const dbFalso = {
  execute: async (q: SQL) => {
    capturadas.push(q);
    return { rows: [] };
  },
};
const databaseMockFactory = () => ({ db: dbFalso, client: {}, lockPool: lockPoolMock });
mock.module("../database", databaseMockFactory);
mock.module("../database/index", databaseMockFactory);
mock.module("@cci/email", () => ({
  sendEmail: mock(() => Promise.resolve()),
  sendLiquidationEmail: mock(() => Promise.resolve()),
  sendPlainEmail: mock(() => Promise.resolve()),
  sendSimpleEmail: mock(() => Promise.resolve()),
  sendInvestorAddedToCreditsNotification: mock(() => Promise.resolve()),
  sendNewCreditNotification: mock(() => Promise.resolve()),
}));

const { getPagosConInversionistas } = await import("./payments");
const dialecto = new PgDialect();

type Compilada = { sql: string; params: unknown[] };
const compilar = (q: SQL): Compilada => dialecto.sqlToQuery(q);

async function correr(opciones: Record<string, unknown>) {
  capturadas = [];
  const r = await getPagosConInversionistas(opciones as any);
  expect((r as any).error).toBeUndefined();
  expect(r.success).toBe(true);
  const compiladas = capturadas.map(compilar);
  const conteo = compiladas.find((c) => c.sql.includes("COUNT(*) as total"));
  const principal = compiladas.find((c) => /LIMIT \$\d+ OFFSET \$\d+/.test(c.sql));
  expect(conteo).toBeDefined();
  expect(principal).toBeDefined();
  return { compiladas, conteo: conteo!, principal: principal! };
}

const MALICIOSOS = [
  "x' OR '1'='1",
  "'; DROP TABLE x; --",
  "%",
  "\\",
];

const FILTROS_TEXTO = [
  "numeroCredito",
  "validationStatus",
  "categoriaCredito",
  "tipoCredito",
  "formatoCredito",
  "fechaInicio",
  "fechaFin",
  "fechaAplicado",
  "fechaAplicadoInicio",
  "fechaAplicadoFin",
  "fechaBoleta",
  "fechaBoletaInicio",
  "fechaBoletaFin",
] as const;

describe("Pagos con Inversionistas: los filtros van como parámetros", () => {
  beforeEach(() => {
    capturadas = [];
  });

  for (const filtro of FILTROS_TEXTO) {
    for (const malicioso of MALICIOSOS) {
      it(`${filtro}=${JSON.stringify(malicioso)} queda como parámetro, no como SQL`, async () => {
        const { compiladas, conteo } = await correr({ [filtro]: malicioso });
        // El valor entero viaja como parámetro del WHERE…
        expect(conteo.params).toContain(malicioso);
        // …y en NINGUNA query aparece pegado al texto.
        for (const c of compiladas) {
          if (malicioso === "%" || malicioso === "\\") {
            // Estos dos sí existen en el SQL fijo (LIKE '%CUBE…%'); lo que no
            // puede aparecer es el valor entre comillas como literal del filtro.
            expect(c.sql).not.toContain(`'${malicioso}'`);
          } else {
            expect(c.sql).not.toContain(malicioso);
          }
        }
      });
    }
  }

  for (const malicioso of MALICIOSOS) {
    it(`usuarioNombre=${JSON.stringify(malicioso)} es búsqueda literal y parametrizada`, async () => {
      const { compiladas, conteo } = await correr({ usuarioNombre: malicioso });
      const escapado = malicioso.replace(/[\\%_]/g, (c) => `\\${c}`);
      expect(conteo.params).toContain(`%${escapado}%`);
      expect(conteo.sql).toMatch(/u\.nombre ILIKE \$\d+/);
      for (const c of compiladas) {
        expect(c.sql).not.toContain(`'%${malicioso}%'`);
        if (malicioso.length > 1) expect(c.sql).not.toContain(malicioso);
      }
    });
  }

  it("usuarioNombre: _ y % no actúan como comodín; un nombre normal se busca igual que antes", async () => {
    const { conteo } = await correr({ usuarioNombre: "a_b%c" });
    expect(conteo.params).toContain("%a\\_b\\%c%");
    const normal = await correr({ usuarioNombre: "Juan Pérez" });
    expect(normal.conteo.params).toContain("%Juan Pérez%");
  });

  for (const filtro of ["anio", "mes", "dia"] as const) {
    it(`${filtro} malicioso (llamada interna sin validar) queda como parámetro`, async () => {
      const malicioso = "2026 OR 1=1";
      const { compiladas, conteo } = await correr({ [filtro]: malicioso });
      expect(conteo.params).toContain(malicioso);
      for (const c of compiladas) expect(c.sql).not.toContain(malicioso);
    });
  }

  for (const id of ["5' OR '1'='1", 5]) {
    it(`inversionistaId=${JSON.stringify(id)} queda como parámetro en el WHERE y en los totales`, async () => {
      const { compiladas, conteo } = await correr({ inversionistaId: id });
      expect(conteo.params).toContain(id);
      for (const c of compiladas) {
        expect(c.sql).not.toContain("'5'");
        expect(c.sql).not.toContain("5' OR");
      }
      // Los filtros de inversionista de los totales también van parametrizados.
      const totales = compiladas.filter((c) => /pci\.inversionista_id = \$\d+|ci\.inversionista_id = \$\d+/.test(c.sql));
      expect(totales.length).toBeGreaterThan(0);
    });
  }

  it("mismo SQL y mismos parámetros para un filtro normal; paginación igual", async () => {
    const { conteo, principal } = await correr({
      numeroCredito: "CRED-123",
      page: 3,
      pageSize: 25,
    });
    expect(conteo.sql).toContain("c.numero_credito_sifco = $1");
    expect(conteo.params).toEqual(["CRED-123"]);
    expect(conteo.sql).toContain(
      "p.validation_status IN ('validated', 'pending' ,'reset', 'capital', 'capital_validated')",
    );
    expect(conteo.sql).toContain(`c."statusCredit" IN ('ACTIVO', 'MOROSO','PENDIENTE_CANCELACION','EN_CONVENIO','CANCELADO','INCOBRABLE')`);
    // LIMIT/OFFSET siguen siendo parámetros: pageSize y (page-1)*pageSize.
    expect(principal.params.slice(-2)).toEqual([25, 50]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Contra Postgres real. Opt-in: TEST_DATABASE_URL apuntando a la base local
// dedicada `cartera_reports_reconciliation_test` (parseTestDatabaseUrl rechaza
// cualquier otra). No toca tablas compartidas: arma TABLAS TEMPORALES con lo
// mínimo que necesita la query de conteo (pagos_credito, creditos, usuarios) y
// corre ESA query —la que el controlador compiló, con sus parámetros— cambiando
// solo el calificador `cartera.` por `pg_temp.`. El WHERE y los $n son los del
// controlador, tal cual.
// ─────────────────────────────────────────────────────────────────────────────
const urlPrueba = process.env.TEST_DATABASE_URL;
const integracion = urlPrueba ? test : test.skip;

integracion("Postgres real: numeroCredito=x' OR '1'='1 cuenta 0 pagos, no todos", async () => {
  const { default: postgres } = await import("postgres");
  const cfg = parseTestDatabaseUrl(urlPrueba!);
  // max: 1 → una sola conexión, para que las tablas temporales se vean siempre.
  const cliente = postgres({ ...cfg, username: cfg.user, max: 1 });
  try {
    await cliente.unsafe(`
      CREATE TEMP TABLE usuarios (usuario_id int PRIMARY KEY, nombre text, categoria text);
      CREATE TEMP TABLE creditos (
        credito_id int PRIMARY KEY, usuario_id int, numero_credito_sifco text,
        "statusCredit" text, tipo_credito text, formato_credito text);
      CREATE TEMP TABLE pagos_credito (
        pago_id int PRIMARY KEY, credito_id int, validation_status text,
        fecha_pago timestamp, nexa_payment_event_id int,
        fecha_aplicado timestamp, fecha_boleta timestamptz);
      INSERT INTO usuarios VALUES (1, 'Ana', 'Vehículo'), (2, 'Beto', 'Vehículo');
      INSERT INTO creditos VALUES
        (10, 1, 'CRED-A', 'ACTIVO', 'x', 'pool'),
        (20, 2, 'CRED-B', 'ACTIVO', 'x', 'pool');
      INSERT INTO pagos_credito VALUES
        (1, 10, 'validated', '2026-09-01', NULL, NULL, NULL),
        (2, 10, 'validated', '2026-09-02', NULL, NULL, NULL),
        (3, 20, 'pending',   '2026-09-03', NULL, NULL, NULL);
    `);

    const contar = async (opciones: Record<string, unknown>) => {
      const { conteo } = await correr(opciones);
      const texto = conteo.sql.replaceAll("cartera.", "pg_temp.");
      const filas = await cliente.unsafe(texto, conteo.params as any[]);
      return Number(filas[0].total);
    };

    expect(await contar({})).toBe(3);
    expect(await contar({ numeroCredito: "CRED-A" })).toBe(2);
    expect(await contar({ numeroCredito: "x' OR '1'='1" })).toBe(0);
    expect(await contar({ categoriaCredito: "x' OR '1'='1" })).toBe(0);
    expect(await contar({ usuarioNombre: "an" })).toBe(2);
    expect(await contar({ usuarioNombre: "%" })).toBe(0);
    expect(await contar({ usuarioNombre: "' OR '1'='1' --" })).toBe(0);
    expect(await contar({ fechaInicio: "2026-09-02", fechaFin: "2026-09-03" })).toBe(1);
  } finally {
    await cliente.end();
  }
});
