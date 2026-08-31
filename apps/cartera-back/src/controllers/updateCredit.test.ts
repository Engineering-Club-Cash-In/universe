import { describe, expect, it, mock, beforeEach } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";

// Evita que database/index.ts abra la conexión al importar el controller.
// El db mockeado captura la condición WHERE del select de pagos para poder
// afirmar sobre el SQL que genera; devuelve 0 filas para que el recálculo
// termine ahí (early return) sin tocar nada más.
const capturedWheres: any[] = [];
const fakeCredito = {
  credito_id: 794,
  capital: "18493.39",
  porcentaje_interes: "1.50",
  cuota_interes: "277.40",
  seguro_10_cuotas: "260.93",
  gps: "0.00",
  membresias_pago: "399.73",
  cuota: "2021.83",
};
const dbMock = {
  select: () => ({
    from: () => ({
      // select del crédito: .where().limit(1)
      where: () => ({ limit: () => Promise.resolve([fakeCredito]) }),
      // select de pagos: .innerJoin().where(cond).orderBy()
      innerJoin: () => ({
        where: (cond: any) => {
          capturedWheres.push(cond);
          return { orderBy: () => Promise.resolve([]) };
        },
      }),
    }),
  }),
};
mock.module("../database", () => ({ db: dbMock, client: {}, lockPool: {} }));
mock.module("../services/sifcoIntegrations", () => ({
  consultarEstadoCuentaPrestamo: () => Promise.resolve(null),
}));

const { recalcularPagosCredito, deduplicarCuotasPorNumero } = await import(
  "./updateCredit"
);

const renderSql = (cond: any) => new PgDialect().sqlToQuery(cond);

beforeEach(() => {
  capturedWheres.length = 0;
});

describe("recalcularPagosCredito — exclusión de pagos de reset", () => {
  it("excluye filas validation_status='reset' al recalcular desde una cuota", async () => {
    await recalcularPagosCredito({
      numero_credito_sifco: "01010214120190",
      numero_cuota: 1,
    });

    expect(capturedWheres.length).toBe(1);
    const q = renderSql(capturedWheres[0]);
    // El NOT IN de estados excluidos debe cubrir también 'reset': un pago de
    // reset de incobrable no es un pago de cuota y redistribuir su split lo
    // convierte en pago normal (caso real: crédito 794).
    expect(q.params).toContain("reset");
    expect(q.params).toContain("capital");
    expect(q.params).toContain("capital_validated");
  });

  it("excluye filas validation_status='reset' también en el modo sin numero_cuota", async () => {
    await recalcularPagosCredito({ numero_credito_sifco: "01010214120190" });

    expect(capturedWheres.length).toBe(1);
    const q = renderSql(capturedWheres[0]);
    expect(q.params).toContain("reset");
    expect(q.params).toContain("capital");
    expect(q.params).toContain("capital_validated");
  });

  // Variante legacy del cierre (ver isCreditClosingPayment y crédito 23 /
  // pago 121102): la fila estructural quedó validated + registerBy='system_reset'.
  it("excluye el cierre legacy validated+system_reset al recalcular desde una cuota", async () => {
    await recalcularPagosCredito({
      numero_credito_sifco: "01010214120190",
      numero_cuota: 1,
    });

    const q = renderSql(capturedWheres[0]);
    expect(q.params).toContain("system_reset");
    expect(q.params).toContain("validated");
  });

  it("excluye el cierre legacy validated+system_reset también sin numero_cuota", async () => {
    await recalcularPagosCredito({ numero_credito_sifco: "01010214120190" });

    const q = renderSql(capturedWheres[0]);
    expect(q.params).toContain("system_reset");
    expect(q.params).toContain("validated");
  });
});

describe("recalcularPagosCredito — solo cuotas abiertas (sin numero_cuota)", () => {
  it("exige que la cuota siga abierta, no solo que la fila de pago esté en pagado=false", async () => {
    await recalcularPagosCredito({ numero_credito_sifco: "01010214120190" });

    const q = renderSql(capturedWheres[0]);
    // Al reversar un pago de una cuota que otros pagos vivos siguen cubriendo,
    // la fila reversada queda pagado=false pero la CUOTA sigue pagada. Si
    // entrara al recorrido se comería un tramo de amortización ya cobrado y
    // correría una casilla los restantes de las cuotas siguientes.
    expect(q.sql).toContain('"cuotas_credito"."pagado"');
    // NULL es cuota abierta (la columna es nullable con default false): no
    // puede quedar fuera del recálculo.
    expect(q.sql).toContain('"cuotas_credito"."pagado" is null');
  });

  it("recalcular DESDE una cuota sigue alcanzando las cuotas ya pagadas", async () => {
    await recalcularPagosCredito({
      numero_credito_sifco: "01010214120190",
      numero_cuota: 1,
    });

    // Ese modo existe justamente para reescribir hacia atrás; el filtro nuevo
    // es solo del modo automático.
    expect(renderSql(capturedWheres[0]).sql).not.toContain(
      '"cuotas_credito"."pagado"',
    );
  });
});

describe("deduplicarCuotasPorNumero", () => {
  const cuota = (numero_cuota: number) => ({ numero_cuota });

  it("con una cuota por número no cambia nada", () => {
    const entrada = new Map([
      [10, cuota(1)],
      [11, cuota(2)],
    ]);
    expect([...deduplicarCuotasPorNumero(entrada).keys()]).toEqual([10, 11]);
  });

  it("con cuotas duplicadas se queda con el cuota_id más grande", () => {
    // Caso crédito 793: la 17 existe dos veces; la copia vigente (recibo
    // re-sembrado) es la del cuota_id mayor. Sin esto el recorrido amortiza
    // el mes 17 dos veces y corre todos los tramos siguientes.
    const entrada = new Map([
      [500, cuota(17)],
      [980, cuota(17)],
      [501, cuota(18)],
    ]);
    const salida = deduplicarCuotasPorNumero(entrada);
    expect([...salida.keys()].sort((a, b) => a - b)).toEqual([501, 980]);
    expect(salida.get(500)).toBeUndefined();
  });

  it("no depende del orden en que vengan las copias", () => {
    const alReves = new Map([
      [980, cuota(17)],
      [500, cuota(17)],
    ]);
    expect([...deduplicarCuotasPorNumero(alReves).keys()]).toEqual([980]);
  });
});
