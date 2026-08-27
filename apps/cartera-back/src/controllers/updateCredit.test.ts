import { describe, expect, it, mock, beforeEach } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";

// Evita que database/index.ts abra la conexión al importar el controller.
// El db mockeado captura la condición WHERE del select de pagos para poder
// afirmar sobre el SQL que genera; devuelve 0 filas para que el recálculo
// termine ahí (early return) sin tocar nada más.
const capturedWheres: any[] = [];
const capturedCreditWheres: any[] = [];
// Fixture completo: updateCredit lee estos campos con new Big(...) (que truena
// con undefined) o los necesita para llegar al UPDATE final.
const fakeCredito = {
  credito_id: 794,
  numero_credito_sifco: "01010214120190",
  usuario_id: 1,
  statusCredit: "ACTIVO",
  capital: "18493.39",
  porcentaje_interes: "1.50",
  cuota_interes: "277.40",
  seguro_10_cuotas: "260.93",
  gps: "0.00",
  membresias_pago: "399.73",
  cuota: "2021.83",
  plazo: 24,
  otros: "0",
};
// Fila que devuelve el select del crédito; cada test puede reemplazarla (p. ej.
// statusCredit CANCELADO) y beforeEach la regresa al fixture base.
let creditoActual: any = fakeCredito;
// Filas que devuelve el select de pagos (vacío = early return del recálculo).
let pagosActuales: any[] = [];
const capturedUpdates: { vals: any; cond: any }[] = [];
const dbMock = {
  select: () => ({
    from: () => ({
      // select del crédito: .where(cond).limit(1)
      where: (cond: any) => {
        capturedCreditWheres.push(cond);
        return { limit: () => Promise.resolve([creditoActual]) };
      },
      // select de pagos: .innerJoin().where(cond).orderBy()
      innerJoin: () => ({
        where: (cond: any) => {
          capturedWheres.push(cond);
          return { orderBy: () => Promise.resolve(pagosActuales) };
        },
      }),
    }),
  }),
  // recalcularPagosCredito escribe dentro de db.transaction(tx => tx.update…)
  transaction: async (fn: any) =>
    fn({
      update: () => ({
        set: (vals: any) => ({
          where: (cond: any) => {
            capturedUpdates.push({ vals, cond });
            return Promise.resolve();
          },
        }),
      }),
    }),
  // update del crédito: .set(vals).where().returning()
  update: () => ({
    set: (vals: any) => ({
      where: () => ({
        returning: () => Promise.resolve([{ ...creditoActual, ...vals }]),
      }),
    }),
  }),
};
mock.module("../database", () => ({ db: dbMock, client: {}, lockPool: {} }));
mock.module("../services/sifcoIntegrations", () => ({
  consultarEstadoCuentaPrestamo: () => Promise.resolve(null),
}));

const { recalcularPagosCredito, updateCredit } = await import("./updateCredit");

const renderSql = (cond: any) => new PgDialect().sqlToQuery(cond);

beforeEach(() => {
  capturedWheres.length = 0;
  capturedCreditWheres.length = 0;
  capturedUpdates.length = 0;
  pagosActuales = [];
  creditoActual = fakeCredito;
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

describe("recalcularPagosCredito — numero_cuota se ignora", () => {
  // La amortización siempre arranca del capital ACTUAL del crédito, así que
  // "desde la cuota N, pagadas incluidas" reescribía splits ya validados con
  // un capital ya reducido (o se saltaba la cuota reabierta si N era mayor).
  // Caso real: crédito 3, cuota 17 reabierta por reversión, conta mandó 18.
  it("genera exactamente el mismo WHERE con y sin numero_cuota", async () => {
    await recalcularPagosCredito({
      numero_credito_sifco: "01010214120190",
      numero_cuota: 17,
    });
    await recalcularPagosCredito({ numero_credito_sifco: "01010214120190" });

    expect(capturedWheres.length).toBe(2);
    const conCuota = renderSql(capturedWheres[0]);
    const sinCuota = renderSql(capturedWheres[1]);
    expect(conCuota.sql).toBe(sinCuota.sql);
    expect(conCuota.params).toEqual(sinCuota.params);
  });

  it("con numero_cuota nunca acota por cuota ni incluye pagos validados", async () => {
    await recalcularPagosCredito({
      numero_credito_sifco: "01010214120190",
      numero_cuota: 1,
    });

    const q = renderSql(capturedWheres[0]);
    // Sin el filtro `numero_cuota >= N` de antes…
    expect(q.sql).not.toContain(">=");
    expect(q.params).not.toContain(1);
    // …y con el filtro de "solo lo no aplicado": pagado=false o pending vivo.
    expect(q.params).toContain("pending");
    expect(q.sql).toContain("pagado");
  });
});

describe("recalcularPagosCredito — pagos validados no se reescriben", () => {
  const cuota18 = { cuota_id: 74540, numero_cuota: 18, pagado: false };
  const filaSembrada = {
    pago_id: 74540,
    cuota_id: 74540,
    validationStatus: "no_required",
    pagado: false,
    paymentFalse: false,
    monto_aplicado: "0",
    fecha_pago: null,
  };
  // Parcial ya validado por conta sobre la cuota abierta: su capital ya se
  // descontó del crédito y su split ya se distribuyó a inversionistas.
  const parcialValidado = {
    pago_id: 156048,
    cuota_id: 74540,
    validationStatus: "validated",
    pagado: false,
    paymentFalse: false,
    monto_aplicado: "162",
    fecha_pago: "2026-08-21",
    abono_interes: "100",
    abono_iva_12: "12",
    abono_seguro: "0",
    abono_gps: "0",
    membresias_pago: "0",
    // Ya descontado de creditos.capital al validarse (fixture: 18493.39 es
    // el capital POST-parcial).
    abono_capital: "50",
  };

  it("usa el parcial validado solo como contexto y siembra al hermano sobre el neto", async () => {
    pagosActuales = [
      { pagos_credito: parcialValidado, cuotas_credito: cuota18 },
      { pagos_credito: filaSembrada, cuotas_credito: cuota18 },
    ];

    await recalcularPagosCredito({ numero_credito_sifco: "01010214120190" });

    // Solo se escribe la fila sembrada; el validado queda intacto.
    expect(capturedUpdates.length).toBe(1);
    const idsEscritos = capturedUpdates.map((u) => renderSql(u.cond).params).flat();
    expect(idsEscritos).toContain(74540);
    expect(idsEscritos).not.toContain(156048);

    // La cuota se proyecta desde el principal PRE-parcial: 18493.39 + 50 =
    // 18543.39 × 1.5% = 278.15 de interés, IVA 33.38; capital de la cuota =
    // 2021.83 − 278.15 − 33.38 − 260.93 − 399.73 = 1049.64. El sembrado queda
    // neto de lo que el validado ya abonó (100 / 12 / 50), sin restar el
    // capital validado dos veces.
    const vals = capturedUpdates[0].vals;
    expect(vals.interes_restante).toBe("178.15");
    expect(vals.iva_12_restante).toBe("21.38");
    expect(vals.seguro_restante).toBe("260.93");
    expect(vals.membresias).toBe("399.73");
    expect(vals.capital_restante).toBe("999.64");
    // Capital proyectado hacia la siguiente cuota = pre-parcial − capital de
    // la cuota completa (no vuelve a restar los 50 ya validados).
    expect(vals.total_restante).toBe("17493.75");
    expect(vals.abono_interes).toBe("0");
    expect(vals.pagado).toBe(false);
  });
});

describe("recalcularPagosCredito — capital validado de cuotas posteriores", () => {
  const cuota18 = { cuota_id: 74540, numero_cuota: 18, pagado: false };
  const cuota19 = { cuota_id: 74541, numero_cuota: 19, pagado: false };
  const sembrada = (pago_id: number, cuota_id: number) => ({
    pago_id,
    cuota_id,
    validationStatus: "no_required",
    pagado: false,
    paymentFalse: false,
    monto_aplicado: "0",
    fecha_pago: null,
  });
  // Parcial validado en la cuota 19 (posterior) con capital ya descontado de
  // creditos.capital; quedó pagado=true porque otro pago cerró la cuota.
  const validadoCuota19 = {
    pago_id: 156049,
    cuota_id: 74541,
    validationStatus: "validated",
    pagado: true,
    paymentFalse: false,
    monto_aplicado: "162",
    fecha_pago: "2026-08-21",
    abono_interes: "100",
    abono_iva_12: "12",
    abono_seguro: "0",
    abono_gps: "0",
    membresias_pago: "0",
    abono_capital: "50",
  };

  it("restaura el capital de todas las cuotas abiertas antes de proyectar la primera", async () => {
    pagosActuales = [
      { pagos_credito: sembrada(74540, 74540), cuotas_credito: cuota18 },
      { pagos_credito: validadoCuota19, cuotas_credito: cuota19 },
      { pagos_credito: sembrada(74541, 74541), cuotas_credito: cuota19 },
    ];

    await recalcularPagosCredito({ numero_credito_sifco: "01010214120190" });

    // Se escriben solo las dos sembradas; el validado (aunque pagado=true) no.
    expect(capturedUpdates.length).toBe(2);
    const ids = capturedUpdates.map((u) => renderSql(u.cond).params).flat();
    expect(ids).toContain(74540);
    expect(ids).toContain(74541);
    expect(ids).not.toContain(156049);

    // La cuota 18 se proyecta desde 18493.39 + 50 (capital del parcial de la
    // 19) = 18543.39 × 1.5% = 278.15, no desde el capital ya reducido.
    const c18 = capturedUpdates.find((u) => renderSql(u.cond).params.includes(74540))!.vals;
    expect(c18.interes_restante).toBe("278.15");
    expect(c18.capital_restante).toBe("1049.64");
    // Cuota 19: principal 18543.39 − 1049.64 = 17493.75 × 1.5% = 262.41,
    // neto del interés que ya abonó el validado (100).
    const c19 = capturedUpdates.find((u) => renderSql(u.cond).params.includes(74541))!.vals;
    expect(c19.interes_restante).toBe("162.41");
  });
});

// Body espejo del fixture: sin cambios financieros, sin inversionistas.
const baseBody = {
  credito_id: 794,
  cuota: 2021.83,
  plazo: 24,
  capital: 18493.39,
  porcentaje_interes: 1.5,
  seguro_10_cuotas: 260.93,
  membresias_pago: 399.73,
  otros: 0,
};
const makeCtx = () => ({
  set: {} as any,
  request: { headers: { get: () => null } } as any,
});

describe("updateCredit — editar sin importar el status", () => {
  it("busca el crédito solo por credito_id y la edición llega al UPDATE (200)", async () => {
    const { set, request } = makeCtx();
    const result: any = await updateCredit({ body: { ...baseBody }, set, request });

    // Antes el lookup filtraba por statusCredit (ACTIVO, MOROSO, ...) y editar
    // un crédito CANCELADO/CAIDO devolvía "Credit not found" aunque existiera.
    expect(capturedCreditWheres.length).toBeGreaterThanOrEqual(1);
    const q = renderSql(capturedCreditWheres[0]);
    expect(q.sql).not.toContain("statusCredit");
    expect(q.params).toContain(794);
    expect(set.status).toBe(200);
    expect(result.credito_id).toBe(794);
  });

  it("edita un crédito CANCELADO de punta a punta (200)", async () => {
    creditoActual = { ...fakeCredito, statusCredit: "CANCELADO" };
    const { set, request } = makeCtx();
    const result: any = await updateCredit({ body: { ...baseBody }, set, request });

    expect(set.status).toBe(200);
    expect(result.credito_id).toBe(794);
  });
});

describe("updateCredit — calendario congelado en créditos finalizados", () => {
  // La cancelación deja los pagos no pagados en paymentFalse=true con
  // restantes en 0 (credits.ts) y el caído conserva solo el desembolso
  // (fallenCredits.ts). Si updateInstallments corriera aquí, reescribiría esas
  // filas (deuda fantasma) o, sin filas, tronaría con 500 DESPUÉS de haber
  // commiteado el UPDATE del crédito.
  it("CANCELADO: cambiar la cuota actualiza el crédito pero NO re-proyecta pagos", async () => {
    creditoActual = { ...fakeCredito, statusCredit: "CANCELADO" };
    const { set, request } = makeCtx();
    const result: any = await updateCredit({
      body: { ...baseBody, cuota: 2500 },
      set,
      request,
    });

    expect(set.status).toBe(200);
    expect(result.cuota).toBe("2500");
    // updateInstallments nunca consultó los pagos pendientes
    expect(capturedWheres.length).toBe(0);
  });

  it("CAIDO: cambiar la cuota actualiza el crédito pero NO re-proyecta pagos", async () => {
    creditoActual = { ...fakeCredito, statusCredit: "CAIDO" };
    const { set, request } = makeCtx();
    const result: any = await updateCredit({
      body: { ...baseBody, cuota: 2500 },
      set,
      request,
    });

    expect(set.status).toBe(200);
    expect(result.cuota).toBe("2500");
    expect(capturedWheres.length).toBe(0);
  });

  it("ACTIVO: cambiar la cuota SÍ intenta re-proyectar los pagos pendientes", async () => {
    const { set, request } = makeCtx();
    await updateCredit({ body: { ...baseBody, cuota: 2500 }, set, request });

    // El guard no debe sobre-bloquear: en un crédito vivo updateInstallments
    // sí consulta los pagos pendientes (el mock devuelve 0 filas y el flujo
    // termina en el catch, pero la consulta debe haberse hecho).
    expect(capturedWheres.length).toBe(1);
  });

  it("CANCELADO: ignora los inversionistas existentes del payload (no rebuild, 200)", async () => {
    creditoActual = { ...fakeCredito, statusCredit: "CANCELADO" };
    const { set, request } = makeCtx();
    const result: any = await updateCredit({
      body: {
        ...baseBody,
        // El front SIEMPRE manda las listas al editar; en un crédito
        // finalizado deben ignorarse (participación congelada), no validarse
        // ni disparar el delete+insert del rebuild.
        inversionistas: [
          {
            inversionista_id: 7,
            monto_aportado: 1000,
            porcentaje_cash_in: 50,
            porcentaje_inversion: 50,
          },
        ],
      },
      set,
      request,
    });

    expect(set.status).toBe(200);
    expect(result.credito_id).toBe(794);
    // Solo el lookup del crédito consultó la DB: ni validarInversionistasNuevos
    // ni el rebuild corrieron.
    expect(capturedCreditWheres.length).toBe(1);
  });

  it("CANCELADO: cambiar 'otros' no reescribe la cuota inicial congelada", async () => {
    creditoActual = { ...fakeCredito, statusCredit: "CANCELADO" };
    const { set, request } = makeCtx();
    const result: any = await updateCredit({
      body: { ...baseBody, otros: 50 },
      set,
      request,
    });

    expect(set.status).toBe(200);
    expect(result.credito_id).toBe(794);
    // updateInitialQuotaOtros habría hecho un segundo select (cuota 0);
    // congelado = solo el lookup inicial.
    expect(capturedCreditWheres.length).toBe(1);
  });

  it("ACTIVO: cambiar 'otros' SÍ actualiza la cuota inicial", async () => {
    const { set, request } = makeCtx();
    await updateCredit({ body: { ...baseBody, otros: 50 }, set, request });

    // El guard no debe sobre-bloquear: en un crédito vivo updateInitialQuotaOtros
    // sí busca la cuota 0 (segundo select capturado).
    expect(capturedCreditWheres.length).toBe(2);
  });

  it("CANCELADO: rechaza registrar inversionistas nuevos (400)", async () => {
    creditoActual = { ...fakeCredito, statusCredit: "CANCELADO" };
    const { set, request } = makeCtx();
    const result: any = await updateCredit({
      body: {
        ...baseBody,
        inversionistas: [
          {
            inversionista_id: 7,
            monto_aportado: 1000,
            porcentaje_cash_in: 50,
            porcentaje_inversion: 50,
            es_nuevo: true,
            tipo_operacion: "compra_cartera",
          },
        ],
      },
      set,
      request,
    });

    expect(set.status).toBe(400);
    expect(result.message).toBe(
      "No se pueden registrar inversionistas nuevos en un crédito CANCELADO",
    );
  });
});
