import { describe, expect, it } from "bun:test";
import {
  cuotasEnAtraso,
  DIAS_PAGO_PENDIENTE_FRENA_MORA,
  devengaMora,
  pagoCubreCuota,
  STATUS_EXCLUIDOS_MORA,
  type PagoParaAtraso,
} from "./cuotaAtrasada";

const HOY = "2026-09-09";

/** Fila vencida y sin cubrir: el caso que SÍ debe pintarse "Atrasada". */
const pagoBase = (over: Partial<PagoParaAtraso> = {}): { pago: PagoParaAtraso } => ({
  pago: {
    cuota_id: 1,
    cuota_pagada: false,
    fecha_vencimiento: "2026-08-01",
    paymentFalse: false,
    pagado: false,
    validationStatus: "pending",
    monto_aplicado: 0,
    statusCredit: "MOROSO",
    ...over,
  },
});

describe("pagoCubreCuota", () => {
  it("un pago validado con monto aplicado cubre la cuota", () => {
    expect(
      pagoCubreCuota({
        paymentFalse: false,
        pagado: true,
        validationStatus: "validated",
        monto_aplicado: 1500,
      })
    ).toBe(true);
  });

  it("no_required también cubre", () => {
    expect(
      pagoCubreCuota({
        paymentFalse: false,
        pagado: true,
        validationStatus: "no_required",
        monto_aplicado: "1500.00",
      })
    ).toBe(true);
  });

  // El corazón del bug (a): las filas-cero que este sistema genera se cuelgan
  // de la cuota con pagado=true y monto_aplicado=0 SIN cubrirla, y el backend
  // le sigue cobrando mora.
  it("una fila-cero (monto aplicado 0) NO cubre la cuota", () => {
    expect(
      pagoCubreCuota({
        paymentFalse: false,
        pagado: true,
        validationStatus: "validated",
        monto_aplicado: 0,
      })
    ).toBe(false);
    expect(
      pagoCubreCuota({
        paymentFalse: false,
        pagado: true,
        validationStatus: "validated",
        monto_aplicado: null,
      })
    ).toBe(false);
    expect(
      pagoCubreCuota({
        paymentFalse: false,
        pagado: true,
        validationStatus: "validated",
        monto_aplicado: "0.00",
      })
    ).toBe(false);
  });

  it("un pago pendiente sin fecha de pago, o anulado, no cubre", () => {
    expect(
      pagoCubreCuota({
        paymentFalse: false,
        pagado: true,
        validationStatus: "pending",
        monto_aplicado: 1500,
      }, HOY)
    ).toBe(false);
    expect(
      pagoCubreCuota({
        paymentFalse: true,
        pagado: true,
        validationStatus: "validated",
        monto_aplicado: 1500,
      })
    ).toBe(false);
  });
});

// Contabilidad valida días después del cobro: un pendiente frena la mora de su
// cuota hasta 7 días (por fecha_pago, calendario de Guatemala), igual que el cron.
describe("pagoCubreCuota — pago pendiente de validación", () => {
  const pendiente = (fecha_pago: PagoParaAtraso["fecha_pago"], over: Partial<PagoParaAtraso> = {}) => ({
    paymentFalse: false,
    pagado: true,
    validationStatus: "pending",
    monto_aplicado: 1500,
    fecha_pago,
    ...over,
  });

  it("el tope es 7 días, como el backend", () => {
    expect(DIAS_PAGO_PENDIENTE_FRENA_MORA).toBe(7);
  });

  it("cubre de hoy hasta hace exactamente 7 días, y deja de cubrir el día 8", () => {
    expect(pagoCubreCuota(pendiente("2026-09-09"), HOY)).toBe(true);
    expect(pagoCubreCuota(pendiente("2026-09-07T00:00:00.000Z"), HOY)).toBe(true);
    expect(pagoCubreCuota(pendiente("2026-09-02"), HOY)).toBe(true);
    expect(pagoCubreCuota(pendiente("2026-09-01"), HOY)).toBe(false);
    expect(pagoCubreCuota(pendiente("2025-12-01"), HOY)).toBe(false);
  });

  it("el día de fecha_pago se lee como el ::date del timestamp (componentes UTC)", () => {
    // 2026-09-02 23:30 sin zona llega como "…T23:30:00.000Z": sigue siendo el 2.
    expect(pagoCubreCuota(pendiente(new Date("2026-09-02T23:30:00.000Z")), HOY)).toBe(true);
    expect(pagoCubreCuota(pendiente(new Date("2026-09-01T23:30:00.000Z")), HOY)).toBe(false);
  });

  it("una fecha futura no alarga el freno: mañana cubre (filas en UTC), pasado mañana no", () => {
    expect(pagoCubreCuota(pendiente("2026-09-10"), HOY)).toBe(true);
    expect(pagoCubreCuota(pendiente("2026-09-11"), HOY)).toBe(false);
    expect(pagoCubreCuota(pendiente("2026-12-31"), HOY)).toBe(false);
  });

  it("el cruce de mes cuenta días de calendario", () => {
    expect(pagoCubreCuota(pendiente("2026-02-24"), "2026-03-03")).toBe(true);
    expect(pagoCubreCuota(pendiente("2026-02-23"), "2026-03-03")).toBe(false);
  });

  it("pendiente reciente pero anulado, sin monto aplicado o parcial: no cubre", () => {
    expect(pagoCubreCuota(pendiente("2026-09-08", { paymentFalse: true }), HOY)).toBe(false);
    expect(pagoCubreCuota(pendiente("2026-09-08", { monto_aplicado: 0 }), HOY)).toBe(false);
    expect(pagoCubreCuota(pendiente("2026-09-08", { pagado: false }), HOY)).toBe(false);
  });

  it("cuotasEnAtraso: un pendiente reciente la saca del atraso; uno viejo no", () => {
    const con = (fecha_pago: string) =>
      cuotasEnAtraso(
        [pagoBase(), pagoBase({ pagado: true, validationStatus: "pending", monto_aplicado: 1000, fecha_pago })],
        HOY
      );
    expect(con("2026-09-05").size).toBe(0);
    expect(con("2026-08-20").size).toBe(1);
  });
});

describe("devengaMora", () => {
  it("los estados excluidos por política no devengan mora", () => {
    for (const s of STATUS_EXCLUIDOS_MORA) {
      expect(devengaMora(s)).toBe(false);
    }
  });

  it("el resto sí", () => {
    expect(devengaMora("MOROSO")).toBe(true);
    expect(devengaMora("ACTIVO")).toBe(true);
    expect(devengaMora(null)).toBe(true);
  });
});

describe("estado visible del pago", () => {
  it("distingue registro, validación y cuota en la matriz QA-03", async () => {
    const module = await import("./cuotaAtrasada");
    const estadoVisible = Reflect.get(module, "estadoVisiblePago");
    expect(estadoVisible).toBeFunction();
    if (typeof estadoVisible !== "function") return;

    expect(estadoVisible({
      pagado: true,
      paymentFalse: false,
      validationStatus: "pending",
      cuota_pagada: false,
    })).toEqual({
      registro: { label: "Registrado completo", tone: "blue" },
      validacion: { label: "Validación pendiente", tone: "amber" },
      cuota: { label: "Cuota pendiente", tone: "amber" },
    });

    expect(estadoVisible({
      pagado: true,
      paymentFalse: false,
      validationStatus: "validated",
      cuota_pagada: true,
    })).toEqual({
      registro: { label: "Registrado completo", tone: "blue" },
      validacion: { label: "Validado", tone: "green" },
      cuota: { label: "Cuota pagada", tone: "green" },
    });

    expect(estadoVisible({
      pagado: false,
      paymentFalse: true,
      validationStatus: "pending",
      cuota_pagada: false,
    })).toEqual({
      registro: { label: "Pago anulado", tone: "red" },
      validacion: { label: "No válido", tone: "red" },
      cuota: { label: "Cuota pendiente", tone: "amber" },
    });

    expect(estadoVisible({
      pagado: true,
      paymentFalse: false,
      validationStatus: "reset",
      cuota_pagada: true,
    })).toEqual({
      registro: { label: "Registrado completo", tone: "blue" },
      validacion: { label: "Validado", tone: "green" },
      cuota: { label: "Cuota pagada", tone: "green" },
    });
  });
});

describe("cuotasEnAtraso", () => {
  it("marca la cuota vencida, sin pagar y sin cubrir", () => {
    const m = cuotasEnAtraso([pagoBase()], HOY);
    expect(m.get(1)).toBe("2026-08-01");
  });

  it("no marca una cuota que todavía no vence", () => {
    const m = cuotasEnAtraso([pagoBase({ fecha_vencimiento: "2026-10-01" })], HOY);
    expect(m.size).toBe(0);
  });

  it("la fecha de HOY no está vencida (el criterio es estrictamente <)", () => {
    const m = cuotasEnAtraso([pagoBase({ fecha_vencimiento: HOY })], HOY);
    expect(m.size).toBe(0);
  });

  it("no marca la cuota si `cuota_pagada` no es exactamente false", () => {
    expect(cuotasEnAtraso([pagoBase({ cuota_pagada: true })], HOY).size).toBe(0);
    // null no califica: el criterio canónico exige `= false`.
    expect(cuotasEnAtraso([pagoBase({ cuota_pagada: null })], HOY).size).toBe(0);
  });

  it("un pago que la cubre la saca del atraso, aunque otra fila la marque", () => {
    const m = cuotasEnAtraso(
      [
        pagoBase(),
        pagoBase({
          pagado: true,
          validationStatus: "validated",
          monto_aplicado: 2000,
        }),
      ],
      HOY
    );
    expect(m.size).toBe(0);
  });

  // (a) — la regresión que motivó el arreglo.
  it("una fila-cero NO la saca del atraso: el backend le cobra mora igual", () => {
    const m = cuotasEnAtraso(
      [
        pagoBase(),
        pagoBase({
          pagado: true,
          validationStatus: "validated",
          monto_aplicado: 0,
        }),
      ],
      HOY
    );
    expect(m.get(1)).toBe("2026-08-01");
  });

  // (b) — la interfaz prometía el criterio de la mora y escalaba sobre créditos
  // exentos por política.
  it("los créditos en estado excluido no muestran cuotas atrasadas", () => {
    for (const statusCredit of STATUS_EXCLUIDOS_MORA) {
      const m = cuotasEnAtraso([pagoBase({ statusCredit })], HOY);
      expect(m.size).toBe(0);
    }
  });

  it("un crédito MOROSO sí las muestra", () => {
    expect(cuotasEnAtraso([pagoBase({ statusCredit: "MOROSO" })], HOY).size).toBe(1);
  });

  it("ignora filas sin pago o sin cuota_id", () => {
    const m = cuotasEnAtraso(
      [null, undefined, {}, { pago: null }, pagoBase({ cuota_id: null })],
      HOY
    );
    expect(m.size).toBe(0);
  });

  it("aguanta una lista vacía", () => {
    expect(cuotasEnAtraso([], HOY).size).toBe(0);
  });

  it("recorta el timestamp del vencimiento al día", () => {
    const m = cuotasEnAtraso(
      [pagoBase({ fecha_vencimiento: "2026-08-01T00:00:00.000Z" })],
      HOY
    );
    expect(m.get(1)).toBe("2026-08-01");
  });

  // `PagoParaAtraso.fecha_vencimiento` admite `Date`, y ahí el recorte crudo
  // producía "Fri Aug 01": comparado lexicográficamente contra "2026-09-09"
  // daba falso y la cuota vencida se caía del mapa en silencio.
  it("un vencimiento que llega como Date se compara como día ISO", () => {
    const m = cuotasEnAtraso(
      [pagoBase({ fecha_vencimiento: new Date("2026-08-01T00:00:00.000Z") })],
      HOY
    );
    expect(m.get(1)).toBe("2026-08-01");
  });

  it("un Date futuro sigue sin marcarse en atraso", () => {
    const m = cuotasEnAtraso(
      [pagoBase({ fecha_vencimiento: new Date("2026-10-01T00:00:00.000Z") })],
      HOY
    );
    expect(m.size).toBe(0);
  });

  it("un Date inválido no marca atraso", () => {
    const m = cuotasEnAtraso(
      [pagoBase({ fecha_vencimiento: new Date("no-es-fecha") })],
      HOY
    );
    expect(m.size).toBe(0);
  });
});
