import { describe, expect, it, mock } from "bun:test";
import { pagos_credito, rubros_pagos } from "../database/db";

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

const cadenaEscritura = (tabla: unknown, verbo: string) => {
  const eslabon: any = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "then") {
          return (ok: any, err: any) => {
            eventos.push(`${verbo}:${NOMBRES.get(tabla) ?? "?"}`);
            return Promise.resolve([{ pago_id: 55 }]).then(ok, err);
          };
        }
        return () => eslabon;
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
