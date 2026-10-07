import { describe, expect, it, mock } from "bun:test";
import { audit_logs, pagos_credito, rubros_pagos } from "../database/db";

// ─────────────────────────────────────────────────────────────────────────────
// `editarPago` — QUÉ queda adentro del advisory lock del crédito.
//
// Dos cosas distintas, y las dos importan:
//
// 1. **El chequeo de rubros.** Una boleta con cobro de rubros no se edita. Sin
//    candado ese guard es un TOCTOU: `insertPayment` commitea la fila del pago
//    mucho antes de escribir el reclamo (lo hace `commitRubros`, al final y
//    dentro de su propio lock), así que en ese hueco el chequeo cuenta CERO
//    reclamos y deja pasar la edición. Después el registro le cuelga el reclamo
//    a la fila ya editada y el comprobante deja de coincidir con el cobro.
//
// 2. **La lectura de la fila.** Es la parte que se escapa fácil. Los campos que
//    el request no manda se rellenan con los de la fila leída
//    (`campos.abono_capital ?? pago.abono_capital`, y lo mismo con los
//    restantes) para recalcular `monto_aplicado` y `pagado`. Si esa lectura pasa
//    ANTES del candado, mientras la llamada espera su turno otro escritor del
//    mismo crédito mueve esos campos, y la edición entra y los reescribe desde
//    una foto vieja — pisando lo que el otro acababa de dejar. El guard de
//    rubros puede estar perfecto y el descuadre pasa igual, por al lado.
//
// Por eso el test mide un ORDEN y no un resultado: el defecto no cambia ningún
// valor de retorno, sólo cambia cuándo pasan las cosas.
//
// Sin base: se mockea `../database` con un motor que anota cada consulta (tabla
// + si la proyección es completa) y `../utils/paymentAdvisoryLock` para marcar
// dónde abre y cierra el candado. Así la línea de tiempo es observable.
// ─────────────────────────────────────────────────────────────────────────────

const NOMBRES = new Map<unknown, string>([
  [pagos_credito, "pagos_credito"],
  [rubros_pagos, "rubros_pagos"],
  [audit_logs, "audit_logs"],
]);

let eventos: string[] = [];
let filas = new Map<unknown, unknown[]>();

const cadena = (tablaInicial?: unknown, proyectada?: boolean) => {
  const paso: { tabla: unknown; proyectada: boolean } = {
    tabla: tablaInicial,
    proyectada: proyectada ?? false,
  };
  const eslabon: any = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "then") {
          return (ok: any, err: any) => {
            const nombre = NOMBRES.get(paso.tabla) ?? "?";
            eventos.push(
              `select:${nombre}:${paso.proyectada ? "proyectada" : "completa"}`
            );
            return Promise.resolve(filas.get(paso.tabla) ?? []).then(ok, err);
          };
        }
        return (...args: any[]) => {
          if (prop === "from") paso.tabla = args[0];
          return eslabon;
        };
      },
    }
  );
  return eslabon;
};

// Lo que devuelve el RETURNING del UPDATE: la fila con los valores del `.set()`
// (como la BD), salvo que el test fije otra cosa (p. ej. el redondeo de numeric(18,2)).
let persistido: Record<string, unknown> | undefined;
// Filas que se insertaron en audit_logs, y si el INSERT debe fallar.
let auditoria: Record<string, unknown>[] = [];
let auditoriaFalla = false;

const cadenaEscritura = (tabla: unknown, verbo: string) => {
  let valores: Record<string, unknown> = {};
  const eslabon: any = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "then") {
          return (ok: any, err: any) => {
            eventos.push(`${verbo}:${NOMBRES.get(tabla) ?? "?"}`);
            if (tabla === audit_logs) {
              if (auditoriaFalla) return Promise.reject(new Error("monto 99999 ana@x.com")).then(ok, err);
              auditoria.push(valores);
            }
            const fila = verbo === "update" && tabla === pagos_credito
              ? persistido ?? { ...(filas.get(pagos_credito)?.[0] as object), ...valores }
              : { pago_id: 55 };
            return Promise.resolve([fila]).then(ok, err);
          };
        }
        return (...args: any[]) => {
          if (prop === "set" || prop === "values") valores = args[0];
          return eslabon;
        };
      },
    }
  );
  return eslabon;
};

const motor: any = {
  // `.select()` sin argumentos trae la fila entera; `.select({...})` es la
  // pre-lectura mínima. La diferencia es justo lo que este test vigila.
  select: (proj?: unknown) => cadena(undefined, proj !== undefined),
  update: (t: unknown) => cadenaEscritura(t, "update"),
  insert: (t: unknown) => cadenaEscritura(t, "insert"),
  delete: (t: unknown) => cadenaEscritura(t, "delete"),
  execute: () => Promise.reject(new Error("sin BD en tests")),
};
motor.transaction = (cb: any) => cb(motor);

mock.module("../database", () => ({
  db: motor,
  client: {},
  lockPool: {
    connect: async () => ({ query: async () => {}, release: () => {} }),
  },
}));

mock.module("../utils/paymentAdvisoryLock", () => ({
  PAYMENT_ADVISORY_LOCK_NAMESPACE: 8765,
  // registerPayment la importa desde develop; editarPago no la usa. Sin ella
  // el módulo no carga.
  holdsPaymentAdvisoryLock: () => false,
  withPaymentAdvisoryLock: async (clave: number, fn: () => Promise<any>) => {
    eventos.push(`lock:${clave}`);
    try {
      return await fn();
    } finally {
      eventos.push("unlock");
    }
  },
}));

const { editarPago } = await import("./registerPayment");

const preparar = (credito_id: number | null) => {
  eventos = [];
  persistido = undefined;
  auditoria = [];
  auditoriaFalla = false;
  filas = new Map<unknown, unknown[]>([
    [
      pagos_credito,
      [
        {
          pago_id: 55,
          credito_id,
          abono_capital: "100.00",
          abono_interes: "20.00",
          abono_iva_12: "2.40",
          abono_seguro: "0",
          abono_gps: "0",
          membresias_pago: "0",
          capital_restante: "0",
          interes_restante: "0",
          iva_12_restante: "0",
          seguro_restante: "0",
          gps_restante: "0",
          membresias: "0",
        },
      ],
    ],
    // Sin reclamos: la edición es legítima y tiene que llegar hasta el UPDATE.
    [rubros_pagos, [{ total: "0" }]],
  ]);
};

describe("editarPago — qué pasa bajo el candado", () => {
  it("lee la fila que alimenta los fallback ADENTRO del candado", async () => {
    preparar(9);

    await editarPago(55, { mora: "50.00" });

    const abre = eventos.indexOf("lock:9");
    const cierra = eventos.indexOf("unlock");
    const lecturaCompleta = eventos.indexOf("select:pagos_credito:completa");

    expect(abre).toBeGreaterThanOrEqual(0);
    expect(lecturaCompleta).toBeGreaterThan(abre);
    expect(lecturaCompleta).toBeLessThan(cierra);
  });

  it("la pre-lectura de afuera es MÍNIMA: sólo para saber la clave del candado", async () => {
    preparar(9);

    await editarPago(55, { mora: "50.00" });

    const abre = eventos.indexOf("lock:9");
    const previas = eventos.slice(0, abre);

    // Antes del candado puede haber consultas, pero ninguna que traiga la fila
    // entera: esa es la que no se puede usar como foto.
    expect(previas).not.toContain("select:pagos_credito:completa");
    expect(previas).toContain("select:pagos_credito:proyectada");
  });

  it("el chequeo de rubros y el UPDATE también van adentro", async () => {
    preparar(9);

    await editarPago(55, { mora: "50.00" });

    const abre = eventos.indexOf("lock:9");
    const cierra = eventos.indexOf("unlock");
    const chequeo = eventos.indexOf("select:rubros_pagos:proyectada");
    const escritura = eventos.indexOf("update:pagos_credito");

    for (const [nombre, i] of [["chequeo", chequeo], ["update", escritura]] as const) {
      expect(i, `${nombre} tiene que estar adentro`).toBeGreaterThan(abre);
      expect(i, `${nombre} tiene que estar adentro`).toBeLessThan(cierra);
    }
  });

  it("un pago huérfano igual toma candado, con la clave 0", async () => {
    // `pagos_credito.credito_id` es nullable. Sin esta rama la llamada quedaría
    // sin candado justo por ser un caso raro, que es como se cuelan.
    preparar(null);

    await editarPago(55, { mora: "50.00" });

    expect(eventos).toContain("lock:0");
  });

  it("una boleta CON reclamos se rechaza sin tocar la fila", async () => {
    preparar(9);
    filas.set(rubros_pagos, [{ total: "300.00" }]);

    const r = await editarPago(55, { mora: "50.00" });

    expect(r.success).toBe(false);
    expect(r.message).toContain("300.00");
    expect(eventos).not.toContain("update:pagos_credito");
  });
});

// Captura lo que va al log operativo (console.log del logger estructurado) y a
// console.warn/error, para probar que no se cuela correo, monto ni texto.
const capturarLogs = async (fn: () => Promise<unknown>) => {
  const lineas: string[] = [];
  const o = { log: console.log, warn: console.warn, error: console.error };
  const grab = (...a: unknown[]) => { lineas.push(a.map(String).join(" ")); };
  console.log = grab; console.warn = grab; console.error = grab;
  try { await fn(); } finally { Object.assign(console, o); }
  return lineas;
};

describe("editarPago — constancia de edición de pagos Nexa", () => {
  it("un pago de Nexa deja una fila en audit_logs con quién, pago, crédito, evento y antes/después", async () => {
    preparar(9);
    (filas.get(pagos_credito)![0] as Record<string, unknown>).nexaPaymentEventId = 7;

    const r: any = await editarPago(55, { mora: "50.00" }, "ana@x.com");

    expect(r.success).toBe(true);
    expect(auditoria).toHaveLength(1);
    const f = auditoria[0]!;
    expect(f.user_email).toBe("ana@x.com");
    expect(f.user_id).toBeNull();
    expect(JSON.parse(f.body as string)).toEqual({ pago_id: 55, credito_id: 9, nexa_payment_event_id: 7 });
    expect(JSON.parse(f.response as string)).toEqual({
      cambios: [{ campo: "mora", antes: null, despues: "50.00" }],
    });
  });

  it("el usuario numérico va a user_id", async () => {
    preparar(9);
    (filas.get(pagos_credito)![0] as Record<string, unknown>).nexaPaymentEventId = 7;

    await editarPago(55, { mora: "50.00" }, 42);

    expect(auditoria[0]!.user_id).toBe(42);
    expect(auditoria[0]!.user_email).toBeNull();
  });

  it("el log operativo trae solo el conteo: sin correo, montos, texto ni ids", async () => {
    preparar(9);
    (filas.get(pagos_credito)![0] as Record<string, unknown>).nexaPaymentEventId = 7;

    const lineas = await capturarLogs(() =>
      editarPago(55, { mora: "50.00", observaciones: "texto libre secreto" }, "ana@x.com"));

    const eventosNexa = lineas.filter((l) => l.includes("payment.nexa_edit"));
    expect(eventosNexa).toHaveLength(1);
    const e = JSON.parse(eventosNexa[0]!);
    expect(e.changed_field_count).toBe(2);
    expect(e.audit_persisted).toBe(true);
    const todo = lineas.join("\n");
    for (const prohibido of ["ana@x.com", "50.00", "texto libre secreto", "55", "mora", "observaciones"]) {
      expect(todo.includes(prohibido), `no debe aparecer ${prohibido}`).toBe(false);
    }
  });

  it("si audit_logs falla: la edición NO se cae, y el log de error no trae datos", async () => {
    preparar(9);
    (filas.get(pagos_credito)![0] as Record<string, unknown>).nexaPaymentEventId = 7;
    auditoriaFalla = true;

    let r: any;
    const lineas = await capturarLogs(async () => { r = await editarPago(55, { mora: "50.00" }, "ana@x.com"); });

    expect(r.success).toBe(true);
    expect(eventos).toContain("update:pagos_credito");
    const todo = lineas.join("\n");
    expect(todo).toContain("audit.persistence");
    expect(JSON.parse(lineas.find((l) => l.includes("payment.nexa_edit"))!).audit_persisted).toBe(false);
    for (const prohibido of ["ana@x.com", "99999", "50.00"]) {
      expect(todo.includes(prohibido), `no debe aparecer ${prohibido}`).toBe(false);
    }
  });

  // El front manda TODOS los campos del formulario. El rastro tiene que decir
  // qué cambió el operador, no repetir el formulario entero.
  const formularioCompleto = {
    abono_capital: "100", abono_interes: "20.00", abono_iva_12: "2.4", abono_seguro: "0.00",
    abono_gps: "0", membresias_pago: "0", capital_restante: "0.00", interes_restante: "0",
    iva_12_restante: "0", seguro_restante: "0", gps_restante: "0", membresias: "0",
    otros: "15", mora: "30", monto_boleta: "500", observaciones: "boleta Nexa",
    fecha_pago: "2026-10-01T10:00:00.000Z", origen_pago: "transferencia" as const,
  };
  const prepararNexaCompleto = () => {
    preparar(9);
    Object.assign(filas.get(pagos_credito)![0] as Record<string, unknown>, {
      nexaPaymentEventId: 7, otros: "15.00", mora: "30.00", monto_boleta: "500.00",
      monto_aplicado: "122.40", pagado: true, observaciones: "boleta Nexa",
      fecha_pago: new Date("2026-10-01T10:00:00.000Z"), origen_pago: "transferencia",
    });
  };

  it("con el formulario completo y solo la mora distinta, la constancia lista solo mora", async () => {
    prepararNexaCompleto();

    const r: any = await editarPago(55, { ...formularioCompleto, mora: "45.50" }, "ana@x.com");

    expect(r.success).toBe(true);
    expect(auditoria).toHaveLength(1);
    const { cambios } = JSON.parse(auditoria[0]!.response as string);
    expect(cambios.map((c: any) => c.campo)).toEqual(["mora"]);
    expect(cambios[0]).toEqual({ campo: "mora", antes: "30.00", despues: "45.50" });
  });

  it("con el formulario completo sin cambios no se escribe nada", async () => {
    prepararNexaCompleto();

    let r: any;
    const lineas = await capturarLogs(async () => { r = await editarPago(55, formularioCompleto, "ana@x.com"); });

    expect(r.success).toBe(true);
    expect(auditoria).toHaveLength(0);
    expect(lineas.filter((l) => l.includes("payment.nexa_edit"))).toHaveLength(0);
    expect(eventos).not.toContain("insert:audit_logs");
  });

  it("el rastro sale de lo PERSISTIDO: 30.004 se guarda como 30.00 y no hay cambio", async () => {
    prepararNexaCompleto();
    // numeric(18,2) redondea al guardar: el RETURNING trae "30.00", no el payload.
    persistido = { ...(filas.get(pagos_credito)![0] as Record<string, unknown>), mora: "30.00" };

    const r: any = await editarPago(55, { mora: "30.004" }, "ana@x.com");

    expect(r.success).toBe(true);
    expect(auditoria).toHaveLength(0);
    expect(eventos).not.toContain("insert:audit_logs");
  });

  it("un pago manual no devuelve pagoNexaEditado", async () => {
    preparar(9);

    const r: any = await editarPago(55, { mora: "50.00" });

    expect(r.success).toBe(true);
    expect(auditoria).toHaveLength(0);
    expect(eventos).not.toContain("insert:audit_logs");
  });
});

