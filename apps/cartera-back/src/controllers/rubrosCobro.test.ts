import { describe, expect, it } from "bun:test";

// ─────────────────────────────────────────────────────────────────────────────
// Las DOS escrituras del cobro de rubros que no pasan por la policy pura y que
// mueven plata del cliente:
//
//   * `registrarReclamosDeRubros` — la REVALIDACIÓN del reparto contra el saldo
//     bloqueado, justo antes de escribir el reclamo. Cierra la carrera entre el
//     reparto (que `insertPayment` calcula al principio, sin bloqueo) y el
//     INSERT (que ocurre al final, tras todo el recorrido de cuotas).
//   * `desaplicarRubrosDelPago` — el "Revertir Especial": el pago vuelve a
//     `pending` pero SIGUE VIVO, así que el saldo se devuelve y el reclamo se
//     CONSERVA. Es lo que lo distingue de la reversa, que lo borra.
//
// Se prueban con un ejecutor falso y sin base: lo que importa acá es el orden
// de las consultas, qué se escribe y cuándo se aborta — las reglas de negocio
// ya viven probadas en `rubrosPolicy.test.ts`.
// ─────────────────────────────────────────────────────────────────────────────

// A PROPÓSITO sin `mock.module("../database")`: las dos funciones reciben el
// ejecutor por parámetro, así que nunca tocan el `db` del módulo, y `mock.module`
// es GLOBAL en bun test — un mock de más acá le cambia la base a todos los demás
// archivos de `src/controllers/` (así se cayó `revertPaymentToPending.test.ts`,
// que importa `reversePayment.ts` y ese hace `db.transaction.bind(db)` al
// cargarse). La URL sintética sólo evita que el Pool se queje al construirse; no
// se abre ninguna conexión.
process.env.SUPABASE_DB_URL ??= "postgresql://127.0.0.1:1/synthetic";

const {
  registrarReclamosDeRubros,
  desaplicarRubrosDelPago,
  cobroRubrosSeguro,
  totalReclamadoPorPago,
  aplicarRubrosDelPago,
  RubroError,
} = await import("./rubros");

/**
 * Ejecutor falso manejado por una COLA: cada `await` de una consulta drizzle
 * consume el siguiente resultado, en el orden en que el controlador las hace.
 * Los argumentos de `.values()` y `.set()` quedan anotados, que es por donde se
 * mira QUÉ se escribió.
 *
 * Con la cola AGOTADA la consulta RECHAZA en vez de devolver `[]`: una consulta
 * de más tiene que romper el test, no inventarse un resultado vacío.
 */
const ejecutorConCola = (...resultados: unknown[][]) => {
  const cola = [...resultados];
  const escrituras: { op: string; valores: any }[] = [];
  const eslabon: any = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "then") {
          return (ok: any, err: any) =>
            (cola.length
              ? Promise.resolve(cola.shift())
              : Promise.reject(new Error("consulta de más: la cola se agotó"))
            ).then(ok, err);
        }
        return (...args: any[]) => {
          if (prop === "values") escrituras.push({ op: "insert", valores: args[0] });
          if (prop === "set") escrituras.push({ op: "update", valores: args[0] });
          return eslabon;
        };
      },
    }
  );

  return Object.assign(
    {
      select: () => eslabon,
      insert: () => eslabon,
      update: () => eslabon,
      delete: () => {
        escrituras.push({ op: "delete", valores: null });
        return eslabon;
      },
    },
    { escrituras }
  ) as any;
};

const RUBRO_VIVO = {
  rubro_id: 4,
  credito_id: 1,
  saldo_pendiente: "400.00",
  monto_original: "400.00",
  anulado: false,
};

describe("registrarReclamosDeRubros — revalida el reparto contra el saldo bloqueado", () => {
  // Orden: los rubros involucrados (FOR UPDATE), los reclamos vivos de las
  // boletas HERMANAS (los de esta boleta todavía no existen) y el INSERT.
  const cola = (rubros: unknown[], reclamosHermanos: unknown[] = []) =>
    ejecutorConCola(rubros, reclamosHermanos, []);

  it("escribe el reclamo cuando el rubro sigue como estaba", async () => {
    const ej = cola([RUBRO_VIVO]);

    await registrarReclamosDeRubros(
      77,
      [{ rubro_id: 4, monto: "400.00" }],
      ej
    );

    const insertado = ej.escrituras.find((e: any) => e.op === "insert");
    expect(insertado).toBeDefined();
    expect(insertado.valores).toEqual([
      {
        pago_id: 77,
        rubro_id: 4,
        monto: "400.00",
        // NULL hasta que se aplique: un 0 sería indistinguible de "se aplicó y
        // no descontó nada".
        monto_aplicado: null,
        aplicado: false,
      },
    ]);
  });

  it("ABORTA el registro si el rubro se achicó en la ventana, en vez de escribir un reclamo imposible", async () => {
    // Un admin le bajó el monto de Q400 a Q150 entre el reparto y el INSERT.
    const ej = cola([{ ...RUBRO_VIVO, saldo_pendiente: "150.00" }]);

    const error = await registrarReclamosDeRubros(
      77,
      [{ rubro_id: 4, monto: "400.00" }],
      ej
    ).catch((e) => e);

    expect(error).toBeInstanceOf(RubroError);
    expect(error.status).toBe(409);
    expect(error.message).toContain("150.00");
    expect(error.message).toContain("400.00");
    // Y NADA se escribió: fallar en el REGISTRO es barato (el asesor reintenta);
    // fallar en la VALIDACIÓN tumba la boleta entera días después.
    expect(ej.escrituras).toEqual([]);
  });

  it("ABORTA si el rubro se ANULÓ en la ventana, con un motivo distinto al de saldo", async () => {
    const ej = cola([
      { ...RUBRO_VIVO, saldo_pendiente: "0.00", anulado: true },
    ]);

    const error = await registrarReclamosDeRubros(
      77,
      [{ rubro_id: 4, monto: "400.00" }],
      ej
    ).catch((e) => e);

    expect(error).toBeInstanceOf(RubroError);
    expect(error.status).toBe(409);
    expect(error.message).toContain("se anuló");
    expect(ej.escrituras).toEqual([]);
  });

  it("netea contra las boletas HERMANAS: lo ya apartado por otra boleta no se puede volver a apartar", async () => {
    const ej = cola(
      [RUBRO_VIVO],
      [{ rubro_id: 4, pago_id: 70, monto: "300.00" }]
    );

    const error = await registrarReclamosDeRubros(
      77,
      [{ rubro_id: 4, monto: "400.00" }],
      ej
    ).catch((e) => e);

    expect(error).toBeInstanceOf(RubroError);
    // Quedaban Q100 disponibles (400 − 300), no Q400.
    expect(error.message).toContain("100.00");
    expect(ej.escrituras).toEqual([]);
  });

  it("sin cobros no consulta nada: el pago sin rubros no paga el precio del guard", async () => {
    const ej = ejecutorConCola();
    await registrarReclamosDeRubros(77, [], ej);
    expect(ej.escrituras).toEqual([]);
  });
});

describe("desaplicarRubrosDelPago — el pago vuelve a PENDIENTE pero sigue vivo", () => {
  // Orden: los reclamos APLICADOS del pago, el rubro (FOR UPDATE), el UPDATE
  // del rubro, el evento de historial y el UPDATE del reclamo.
  const cola = (reclamos: unknown[], rubro?: unknown) =>
    rubro === undefined
      ? ejecutorConCola(reclamos)
      : ejecutorConCola(reclamos, [rubro], [], [], []);

  const RECLAMO_APLICADO = {
    id: 9,
    rubro_id: 4,
    monto: "400.00",
    monto_aplicado: "400.00",
  };

  it("devuelve el saldo al rubro y lo revive", async () => {
    // Tras aplicar, el rubro había quedado en 0 y completado.
    const ej = cola([RECLAMO_APLICADO], {
      ...RUBRO_VIVO,
      saldo_pendiente: "0.00",
    });

    const resultado = await desaplicarRubrosDelPago(30, ej);

    expect(resultado).toEqual([{ rubro_id: 4, devuelto: "400.00" }]);
    const rubroActualizado = ej.escrituras.find(
      (e: any) => e.op === "update" && e.valores.saldo_pendiente !== undefined
    );
    expect(rubroActualizado.valores.saldo_pendiente).toBe("400.00");
    expect(rubroActualizado.valores.completado).toBe(false);
    expect(rubroActualizado.valores.activo).toBe(true);
  });

  it("CONSERVA el reclamo con aplicado=false: sin él el pago pendiente pierde su reserva", async () => {
    const ej = cola([RECLAMO_APLICADO], {
      ...RUBRO_VIVO,
      saldo_pendiente: "0.00",
    });

    await desaplicarRubrosDelPago(30, ej);

    // Nada se BORRA: borrar es lo que hace la reversa, donde el pago se anula.
    // Acá el pago sigue vivo y su reserva —lo que congela el rubro y lo que la
    // próxima boleta netea— tiene que sobrevivir.
    expect(ej.escrituras.some((e: any) => e.op === "delete")).toBe(false);
    const reclamoActualizado = ej.escrituras.find(
      (e: any) => e.op === "update" && e.valores.aplicado === false
    );
    expect(reclamoActualizado).toBeDefined();
    expect(reclamoActualizado.valores.monto_aplicado).toBeNull();
  });

  it("deja el evento en el historial: el saldo no se mueve sin rastro", async () => {
    const ej = cola([RECLAMO_APLICADO], {
      ...RUBRO_VIVO,
      saldo_pendiente: "0.00",
    });

    await desaplicarRubrosDelPago(30, ej);

    const evento = ej.escrituras.find(
      (e: any) => e.op === "insert" && e.valores?.tipo_evento === "reversa"
    );
    expect(evento).toBeDefined();
    expect(evento.valores.saldo_anterior).toBe("0.00");
    expect(evento.valores.saldo_nuevo).toBe("400.00");
    expect(evento.valores.pago_id).toBe(30);
    expect(evento.valores.motivo).toContain("Revertir Especial");
  });

  it("NO resucita un rubro anulado: el saldo se queda en 0 y el reclamo igual se suelta", async () => {
    const ej = cola([RECLAMO_APLICADO], {
      ...RUBRO_VIVO,
      saldo_pendiente: "0.00",
      anulado: true,
    });

    const resultado = await desaplicarRubrosDelPago(30, ej);

    expect(resultado).toEqual([{ rubro_id: 4, devuelto: "0.00" }]);
    const rubroActualizado = ej.escrituras.find(
      (e: any) => e.op === "update" && e.valores.saldo_pendiente !== undefined
    );
    expect(rubroActualizado.valores.saldo_pendiente).toBe("0.00");
    // El reclamo se suelta igual: el pago vuelve a pendiente pase lo que pase
    // con el rubro. El conflicto se ve recién al revalidar, con el 409 de
    // `puedeAplicarReclamo` — que es donde queremos verlo.
    expect(
      ej.escrituras.some(
        (e: any) => e.op === "update" && e.valores.aplicado === false
      )
    ).toBe(true);
  });

  it("es idempotente: sin reclamos APLICADOS no toca nada", async () => {
    const ej = cola([]);
    expect(await desaplicarRubrosDelPago(30, ej)).toEqual([]);
    expect(ej.escrituras).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `cobroRubrosSeguro` — la red entre el motor de pagos y los rubros.
//
// `insertPayment` llama al cobro de rubros en medio del reparto de TODA boleta
// de la empresa, y lo hacía sin red: cualquier fallo de esa consulta —la tabla
// todavía no existe porque la migración no corrió, un blip de conexión— tumbaba
// el pago entero. O sea que un módulo nuevo y opcional podía dejar a la
// financiera sin poder cobrar NADA.
//
// La decisión es asimétrica a propósito, porque las consecuencias lo son: fallar
// deja a la empresa sin cobranza; seguir sin cobrar el rubro deja ese cargo
// pendiente para la próxima boleta, sin tocarle el saldo a nadie. Es la misma
// red que `getCreditoByNumero` ya se puso por la misma razón.
// ─────────────────────────────────────────────────────────────────────────────

describe("cobroRubrosSeguro", () => {
  const ejecutorQueRevienta = (mensaje: string) =>
    ({
      select: () => {
        throw Object.assign(new Error(mensaje), { code: "42P01" });
      },
    }) as any;

  it("si la consulta revienta, devuelve cobro vacío en vez de tumbar el pago", async () => {
    const r = await cobroRubrosSeguro({
      credito_id: 9,
      disponible: "1000",
      ejecutor: ejecutorQueRevienta('relation "cartera.rubros" does not exist'),
    });

    expect(r.cobros).toEqual([]);
    expect(r.total.toFixed(2)).toBe("0.00");
  });

  it("el disponible de la boleta queda INTACTO cuando el cobro falla", async () => {
    // Lo que de verdad importa: si el total no fuera cero, el motor restaría de
    // `disponible_restante` una plata que nunca se cobró y las cuotas
    // recibirían de menos.
    const r = await cobroRubrosSeguro({
      credito_id: 9,
      disponible: "1000",
      ejecutor: ejecutorQueRevienta("connection terminated"),
    });

    expect(r.total.toFixed(2)).toBe("0.00");
  });

  it("cuando NO falla, deja pasar el cobro tal cual", async () => {
    // La red no puede cambiar el camino feliz: mismo resultado que llamar
    // directo a `cobrarRubrosParaBoleta`.
    const r = await cobroRubrosSeguro({
      credito_id: 9,
      disponible: "500",
      ejecutor: ejecutorConCola([
        { rubro_id: 7, saldo_pendiente: "300.00", created_at: "2026-01-01" },
      ], []),
    });

    expect(r.total.toFixed(2)).toBe("300.00");
    expect(r.cobros).toEqual([{ rubro_id: 7, monto: "300.00" }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `totalReclamadoPorPago` — lo que una boleta tiene comprometido en rubros.
//
// Existe para un guard de `editarPago`. El total de rubros de una boleta se
// guarda SUMÁNDOLO a `pagos_credito.otros`, y esa columna es editable por
// `PATCH /editPayment/:pagoId`, que la pisa sin mirar `rubros_pagos`. Si un
// admin la edita con un reclamo vivo encima, la validación sigue descontándole
// al rubro el monto ORIGINAL mientras los reportes y la facturación leen el
// `otros` nuevo: dos números para el mismo cobro.
// ─────────────────────────────────────────────────────────────────────────────

describe("totalReclamadoPorPago", () => {
  it("suma lo reclamado por la boleta", async () => {
    const total = await totalReclamadoPorPago(
      77,
      ejecutorConCola([{ total: "350.00" }])
    );
    expect(total.toFixed(2)).toBe("350.00");
  });

  it("sin reclamos da cero, no null", async () => {
    // El SUM de cero filas es NULL en Postgres: si eso llegara crudo al `Big`,
    // el guard reventaría con un 500 sobre una boleta perfectamente editable.
    const total = await totalReclamadoPorPago(77, ejecutorConCola([{ total: null }]));
    expect(total.toFixed(2)).toBe("0.00");
  });

  it("sin filas tampoco explota", async () => {
    const total = await totalReclamadoPorPago(77, ejecutorConCola([]));
    expect(total.toFixed(2)).toBe("0.00");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `aplicarRubrosDelPago` — no se le cobra al cliente por una boleta anulada.
//
// Los reclamos se elegían sólo por `pago_id` y `aplicado`, sin mirar si la
// boleta sigue viva. Y hay rutas que marcan `paymentFalse = true` EN BLOQUE
// —`resetCredit` y la caída a incobrable de `credits.ts`— sin tocar
// `rubros_pagos`. Aplicar después una de esas boletas le descontaba el saldo al
// rubro y marcaba el reclamo como aplicado: el cliente termina pagando un cargo
// por una boleta que la empresa ya declaró falsa.
// ─────────────────────────────────────────────────────────────────────────────

describe("aplicarRubrosDelPago — la boleta tiene que seguir viva", () => {
  it("ABORTA si el pago está marcado como falso, no lo saltea en silencio", async () => {
    // Devolver `[]` no alcanzaba: quien llama sigue de largo, marca el pago como
    // aplicado y le aplica capital y cuotas igual. Y el cargo del rubro YA está
    // sumado en `pagos_credito.otros` desde que se registró la boleta, así que
    // el saldo del rubro queda intacto mientras los reportes muestran plata
    // cobrada que nadie le acreditó. Tirar acá tumba la transacción entera, que
    // es lo único que deja los dos lados diciendo lo mismo.
    const ej = ejecutorConCola([{ paymentFalse: true }]);

    const error = await aplicarRubrosDelPago(77, ej).catch((e) => e);

    expect(error).toBeInstanceOf(RubroError);
    expect((error as InstanceType<typeof RubroError>).status).toBe(409);
    expect(ej.escrituras).toEqual([]);
  });

  it("rechaza la boleta falsa AUNQUE no tenga ningún rubro", async () => {
    // El alcance real del guard, fijado a propósito porque es más ancho de lo
    // que sugiere el nombre de la función: corre ANTES de leer `rubros_pagos` y
    // la llaman incondicionalmente el flujo normal y el de capital, así que hoy
    // NINGUNA boleta falsa se aplica, tenga rubros o no.
    //
    // Eso es un cambio de conducta de toda la empresa y merece un test, no un
    // comentario: `revalidatePayment` ya rechazaba las falsas de entrada, así
    // que lo raro era la asimetría — pero si alguien decide revertirlo, que sea
    // a la vista y no por accidente.
    const ej = ejecutorConCola([{ paymentFalse: true }]);

    const error = await aplicarRubrosDelPago(77, ej).catch((e) => e);

    expect(error).toBeInstanceOf(RubroError);
    expect((error as InstanceType<typeof RubroError>).status).toBe(409);
    // La cola tenía UNA sola entrada: si hubiera llegado a pedir los reclamos,
    // la consulta habría rechazado por cola agotada en vez de dar este error.
    expect(ej.escrituras).toEqual([]);
  });

  it("sin fila de pago sale sin escribir, y sin tirar", async () => {
    // Acá NO se aborta, a diferencia de la boleta falsa: sin fila de pago
    // tampoco puede haber reclamos (lo impide la FK), así que no hay nada que
    // salvar. Tirar convertiría en 409 a una docena de llamadores cuyos pagos
    // son legítimos y simplemente no tienen rubros.
    const ej = ejecutorConCola([]);

    expect(await aplicarRubrosDelPago(77, ej)).toEqual([]);
    expect(ej.escrituras).toEqual([]);
  });

  it("con la boleta viva sigue aplicando normal", async () => {
    const ej = ejecutorConCola(
      [{ paymentFalse: false }],
      [{ id: 1, rubro_id: 7, monto: "300.00" }],
      [{ rubro_id: 7, saldo_pendiente: "500.00", anulado: false }],
      [],
      [],
      []
    );

    const r = await aplicarRubrosDelPago(77, ej);

    expect(r).toEqual([{ rubro_id: 7, monto_aplicado: "300.00" }]);
  });
});
