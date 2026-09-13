import Big from "big.js";
import { describe, expect, it } from "bun:test";
import { STATUS_EXCLUIDOS_MORA } from "../constants/creditStatus";
import {
  MONTO_MAXIMO_RUBRO,
  STATUS_TERMINALES_RUBRO,
  eventoDeEdicion,
  nuevoSaldoTrasEdicion,
  origenDeRole,
  puedeActuar,
  puedeAnularRubro,
  puedeCrearRubro,
  puedeEditarMonto,
  puedeEditarRubro,
  puedeUsarMonto,
  redondearMonto,
  rubroCompletado,
  textoLimpio,
  // Fase 2: cobro de rubros en el flujo de pagos.
  crearEstampadorRubros,
  disponibleDeRubro,
  ordenarRubrosParaCobro,
  puedeAplicarReclamo,
  puedeTocarRubroConReclamosVivos,
  repartirEnRubros,
  puedeApartarReclamo,
} from "./rubrosPolicy";

describe("STATUS_TERMINALES_RUBRO", () => {
  it("es STATUS_EXCLUIDOS_MORA sin EN_CONVENIO", () => {
    expect(STATUS_TERMINALES_RUBRO).toEqual([
      "INCOBRABLE",
      "CANCELADO",
      "PENDIENTE_CANCELACION",
      "CAIDO",
    ]);
    expect(STATUS_TERMINALES_RUBRO).not.toContain("EN_CONVENIO");
    // Se deriva de la lista de mora: si allá se agrega un estado, acá también.
    expect(STATUS_EXCLUIDOS_MORA).toContain("EN_CONVENIO");
    expect(STATUS_TERMINALES_RUBRO.length).toBe(
      STATUS_EXCLUIDOS_MORA.length - 1,
    );
  });
});

describe("puedeCrearRubro", () => {
  it("bloquea los cuatro estados terminales aunque el tipo sea obligatorio y pregunte un ADMIN", () => {
    for (const statusCredit of STATUS_TERMINALES_RUBRO) {
      const r = puedeCrearRubro({
        role: "ADMIN",
        statusCredit,
        tipoObligatorio: true,
        moraActivaMonto: null,
      });
      expect(r.permitido).toBe(false);
      expect(r.motivo).toBeString();
      expect(r.motivo?.length).toBeGreaterThan(0);
      // El estado terminal es un choque de negocio, no de permisos: 409.
      expect(r.status ?? 409).toBe(409);
    }
  });

  it("bloquea los estados terminales también para el tipo no obligatorio", () => {
    for (const statusCredit of STATUS_TERMINALES_RUBRO) {
      expect(
        puedeCrearRubro({
          role: "ADMIN",
          statusCredit,
          tipoObligatorio: false,
        }).permitido,
      ).toBe(false);
    }
  });

  // El estado terminal se juzga ANTES que el rol: a un ASESOR pidiendo un rubro
  // obligatorio sobre un crédito CANCELADO hay que decirle que el crédito no
  // admite deuda nueva, no que le falta ser administrador — cambiar de rol no
  // lo desbloquearía.
  it("el estado terminal manda sobre la regla de rol", () => {
    const r = puedeCrearRubro({
      role: "ASESOR",
      statusCredit: "CANCELADO",
      tipoObligatorio: true,
    });
    expect(r.permitido).toBe(false);
    expect(r.status ?? 409).toBe(409);
  });

  it("solo un ADMIN registra rubros de un tipo obligatorio (403)", () => {
    for (const role of ["ASESOR", "INVESTOR", "", undefined]) {
      const r = puedeCrearRubro({
        role,
        statusCredit: "ACTIVO",
        tipoObligatorio: true,
      });
      expect(r.permitido).toBe(false);
      expect(r.status).toBe(403);
      expect(r.motivo).toBeString();
      expect(r.motivo?.length).toBeGreaterThan(0);
    }
  });

  it("el ADMIN sí crea el obligatorio en un crédito MOROSO con mora activa", () => {
    expect(
      puedeCrearRubro({
        role: "ADMIN",
        statusCredit: "MOROSO",
        tipoObligatorio: true,
        moraActivaMonto: "1250.75",
      }),
    ).toEqual({ permitido: true });
  });

  it("el ADMIN sí crea el obligatorio en un crédito EN_CONVENIO", () => {
    expect(
      puedeCrearRubro({
        role: "ADMIN",
        statusCredit: "EN_CONVENIO",
        tipoObligatorio: true,
        moraActivaMonto: null,
      }),
    ).toEqual({ permitido: true });
  });

  it("bloquea el no obligatorio por MOROSO (sin mora activa registrada)", () => {
    const r = puedeCrearRubro({
      role: "ADMIN",
      statusCredit: "MOROSO",
      tipoObligatorio: false,
      moraActivaMonto: null,
    });
    expect(r.permitido).toBe(false);
    expect(r.motivo).toBeString();
    expect(r.status ?? 409).toBe(409);
  });

  it("bloquea el no obligatorio por EN_CONVENIO (sin mora activa registrada)", () => {
    const r = puedeCrearRubro({
      role: "ADMIN",
      statusCredit: "EN_CONVENIO",
      tipoObligatorio: false,
      moraActivaMonto: null,
    });
    expect(r.permitido).toBe(false);
    expect(r.motivo).toBeString();
  });

  it("bloquea el no obligatorio por mora activa aunque el status esté al día", () => {
    const r = puedeCrearRubro({
      role: "ADMIN",
      statusCredit: "ACTIVO",
      tipoObligatorio: false,
      moraActivaMonto: "0.01",
    });
    expect(r.permitido).toBe(false);
    expect(r.motivo).toBeString();
  });

  // El rubro NO obligatorio no es privilegio de nadie: el ASESOR lo cobra igual
  // que el ADMIN mientras el crédito esté al día. La regla 2 mira el tipo, no
  // el módulo entero.
  it("un ASESOR sí crea el no obligatorio en un crédito al día", () => {
    expect(
      puedeCrearRubro({
        role: "ASESOR",
        statusCredit: "ACTIVO",
        tipoObligatorio: false,
        moraActivaMonto: "0",
      }),
    ).toEqual({ permitido: true });
  });

  it("permite el no obligatorio con crédito al día y mora en cero o ausente", () => {
    expect(
      puedeCrearRubro({
        role: "ADMIN",
        statusCredit: "ACTIVO",
        tipoObligatorio: false,
        moraActivaMonto: "0",
      }),
    ).toEqual({ permitido: true });
    expect(
      puedeCrearRubro({
        role: "ADMIN",
        statusCredit: "ACTIVO",
        tipoObligatorio: false,
      }),
    ).toEqual({ permitido: true });
    expect(
      puedeCrearRubro({
        role: "ADMIN",
        statusCredit: null,
        tipoObligatorio: false,
      }),
    ).toEqual({ permitido: true });
  });

  it("una mora activa negativa no bloquea (solo > 0 bloquea)", () => {
    expect(
      puedeCrearRubro({
        role: "ADMIN",
        statusCredit: "ACTIVO",
        tipoObligatorio: false,
        moraActivaMonto: -5,
      }).permitido,
    ).toBe(true);
  });

  // La mora activa sólo pesa sobre el NO obligatorio: el obligatorio ya pasó
  // por la regla 3 y ni siquiera llega a mirarla.
  it("la mora activa no bloquea al obligatorio del ADMIN", () => {
    expect(
      puedeCrearRubro({
        role: "ADMIN",
        statusCredit: "ACTIVO",
        tipoObligatorio: true,
        moraActivaMonto: "9999.99",
      }),
    ).toEqual({ permitido: true });
  });
});

describe("redondearMonto", () => {
  it("deja el monto en la escala exacta de la columna numeric(18,2)", () => {
    expect(redondearMonto("500")).toBe("500.00");
    expect(redondearMonto(1250.5)).toBe("1250.50");
    expect(redondearMonto("1250.75")).toBe("1250.75");
  });

  it("redondea el sub-centavo igual que lo haría el guardado", () => {
    expect(redondearMonto(0.004)).toBe("0.00");
    expect(redondearMonto("0.0049")).toBe("0.00");
    expect(redondearMonto(0.005)).toBe("0.01");
    expect(redondearMonto("1.239")).toBe("1.24");
  });
});

describe("puedeUsarMonto", () => {
  it("rechaza el sub-centavo: se guardaría como 0.00 y sería el rubro de Q0", () => {
    // El guard miraba el valor CRUDO y `aMonto` redondeaba DESPUÉS: 0.004 pasaba
    // como "mayor a cero" y se guardaba "0.00" con completado = true.
    for (const monto of [0.004, "0.004", 0.001, "0.0049", -0.004]) {
      const r = puedeUsarMonto(monto);
      expect(r.permitido).toBe(false);
      expect(r.motivo).toBeString();
    }
  });

  it("un valor que redondea hacia arriba a un centavo sí es cobrable", () => {
    expect(puedeUsarMonto(0.005)).toEqual({ permitido: true });
  });

  it("rechaza el monto cero: un rubro de Q0 no cobra nada y nunca se completa", () => {
    const r = puedeUsarMonto(0);
    expect(r.permitido).toBe(false);
    expect(r.motivo).toBeString();
    expect(r.motivo?.length).toBeGreaterThan(0);
    expect(puedeUsarMonto("0").permitido).toBe(false);
    expect(puedeUsarMonto("0.00").permitido).toBe(false);
  });

  it("rechaza el monto negativo", () => {
    expect(puedeUsarMonto(-500.5).permitido).toBe(false);
    expect(puedeUsarMonto("-0.01").permitido).toBe(false);
  });

  it("permite el borde mínimo cobrable de un centavo", () => {
    expect(puedeUsarMonto("0.01")).toEqual({ permitido: true });
    expect(puedeUsarMonto(0.01)).toEqual({ permitido: true });
  });

  it("permite un monto normal", () => {
    expect(puedeUsarMonto("1250.75")).toEqual({ permitido: true });
  });

  // La columna es numeric(18,2): un monto más grande no es "un rubro caro",
  // es un insert que muere con `numeric field overflow` y sale como 500. El
  // tope se juzga acá para que sea un 4xx con texto, igual que el piso.
  it("rechaza el monto que desborda la columna", () => {
    for (const monto of [1e16, "1e16", "999999999999999999", 1e9]) {
      const r = puedeUsarMonto(monto);
      expect(r.permitido).toBe(false);
      expect(r.motivo).toBeString();
      expect(r.motivo?.length).toBeGreaterThan(0);
    }
  });

  it("permite el borde exacto del tope y rechaza el centavo siguiente", () => {
    expect(puedeUsarMonto(MONTO_MAXIMO_RUBRO)).toEqual({ permitido: true });
    expect(
      puedeUsarMonto(
        new Big(MONTO_MAXIMO_RUBRO).plus("0.01").toFixed(2),
      ).permitido,
    ).toBe(false);
  });

  // El tope se mide sobre el monto YA REDONDEADO, igual que el piso: si se
  // mirara el crudo, un valor que redondea justo al tope se rechazaría por una
  // fracción de centavo que nunca se guarda.
  it("juzga el tope sobre el monto redondeado", () => {
    expect(
      puedeUsarMonto(new Big(MONTO_MAXIMO_RUBRO).plus("0.004").toFixed(3))
        .permitido,
    ).toBe(true);
  });

  it("el tope cabe de sobra en numeric(18,2) y muy por encima de un cobro real", () => {
    // 16 dígitos enteros es el límite de la columna; el tope queda bien abajo.
    expect(new Big(MONTO_MAXIMO_RUBRO).lt(new Big("1e16"))).toBe(true);
    expect(new Big(MONTO_MAXIMO_RUBRO).gt(new Big("1000000"))).toBe(true);
  });
});

describe("origenDeRole", () => {
  // El origen del historial es la respuesta a "¿quién dio de alta este cobro?".
  // Estaba hardcodeado en "admin" desde antes de que el ASESOR pudiera crear
  // rubros, así que el historial —la razón de ser del módulo— mentía.
  it("distingue al asesor del admin", () => {
    expect(origenDeRole("ADMIN")).toBe("admin");
    expect(origenDeRole("ASESOR")).toBe("asesor");
  });

  // Antes normalizaba (trim + mayúsculas) "porque el claim viene de dos
  // emisores distintos". Esa tolerancia es inalcanzable: `requireRole` del
  // router compara EXACTO contra "ADMIN"/"ASESOR", así que un token con
  // " asesor " recibe 403 y nunca llega hasta acá. Normalizar sólo en el
  // último eslabón no arreglaba nada y sugería una tolerancia que el sistema
  // no tiene — la decisión es no normalizar en NINGÚN lado y que una sola
  // grafía sea la válida de punta a punta.
  it("NO normaliza: una grafía distinta ya murió en el gate del router", () => {
    expect(origenDeRole(" asesor ")).toBe("admin");
    expect(origenDeRole("Asesor")).toBe("admin");
    expect(origenDeRole("asesor")).toBe("admin");
  });

  // El router sólo deja pasar ADMIN y ASESOR: cualquier otra cosa es un token
  // raro, y marcarlo "asesor" le inventaría un origen que no es. Queda "admin"
  // —el valor que tenía el módulo entero— y el gate de rol es quien frena.
  it("cae en admin para cualquier otro rol", () => {
    for (const role of ["INVESTOR", "", null, undefined, "ROOT"]) {
      expect(origenDeRole(role)).toBe("admin");
    }
  });
});

describe("puedeAnularRubro", () => {
  it("deja anular un rubro vivo", () => {
    expect(puedeAnularRubro({ completado: false })).toEqual({ permitido: true });
  });

  // Anular un rubro ya completado no libera nada (ya salió del índice único) y
  // metería un evento `anulacion` sobre un cobro cerrado: o ya se anuló, o el
  // cliente ya lo pagó y "dejar de cobrarlo" no significa nada.
  it("rechaza con 409 un rubro ya completado (doble anulación)", () => {
    const r = puedeAnularRubro({ completado: true });
    expect(r.permitido).toBe(false);
    expect(r.status).toBe(409);
    expect(r.motivo).toBeString();
    expect(r.motivo?.length).toBeGreaterThan(0);
  });
});

describe("puedeEditarRubro", () => {
  it("deja editar un rubro vivo (no anulado)", () => {
    expect(puedeEditarRubro({ anulado: false })).toEqual({ permitido: true });
  });

  // Editar un rubro anulado lo revive (activo vuelve a true) mientras
  // `anulado` se queda en true, un estado contradictorio. La anulación es
  // definitiva: la salida para el error es dar de alta un rubro nuevo, no
  // resucitar el viejo por la edición.
  it("rechaza con 409 un rubro anulado", () => {
    const r = puedeEditarRubro({ anulado: true });
    expect(r.permitido).toBe(false);
    expect(r.status).toBe(409);
    expect(r.motivo).toBeString();
    expect(r.motivo?.length).toBeGreaterThan(0);
  });
});

describe("textoLimpio", () => {
  it("recorta el texto que se va a guardar", () => {
    expect(textoLimpio("  tarjeta de circulación  ")).toBe(
      "tarjeta de circulación",
    );
  });

  // El string de puros espacios es el que se cuela: pasa el `minLength: 1` de
  // TypeBox y el NOT NULL de la columna, pero no informa nada. El guard mira el
  // resultado del trim, que es exactamente lo que se guarda.
  it("deja vacío lo que es sólo espacios, tabs o saltos de línea", () => {
    for (const v of ["", "   ", "\t", "\n  \n", null, undefined]) {
      expect(textoLimpio(v)).toBe("");
    }
  });
});

describe("puedeActuar", () => {
  it("rechaza cuando el usuario no se pudo resolver", () => {
    for (const id of [null, undefined, 0]) {
      const r = puedeActuar(id);
      expect(r.permitido).toBe(false);
      expect(r.motivo).toBeString();
      expect(r.motivo?.length).toBeGreaterThan(0);
    }
  });

  it("permite cuando hay un usuario resuelto", () => {
    expect(puedeActuar(7)).toEqual({ permitido: true });
  });
});

describe("eventoDeEdicion", () => {
  it("el cambio de monto manda: un solo evento edicion_monto aunque cambie más", () => {
    expect(
      eventoDeEdicion({ cambiaMonto: true, cambiaOtroCampo: false }),
    ).toBe("edicion_monto");
    expect(eventoDeEdicion({ cambiaMonto: true, cambiaOtroCampo: true })).toBe(
      "edicion_monto",
    );
  });

  it("un cambio de otro campo (obligatorio, descripción, fecha) también se audita", () => {
    expect(eventoDeEdicion({ cambiaMonto: false, cambiaOtroCampo: true })).toBe(
      "edicion",
    );
  });

  it("sin cambios no hay evento", () => {
    expect(
      eventoDeEdicion({ cambiaMonto: false, cambiaOtroCampo: false }),
    ).toBeNull();
  });
});

describe("puedeEditarMonto", () => {
  it("rechaza monto cero y negativo", () => {
    expect(
      puedeEditarMonto({
        montoOriginal: "500",
        saldoPendiente: "500",
        montoNuevo: 0,
      }).permitido,
    ).toBe(false);
    expect(
      puedeEditarMonto({
        montoOriginal: "500",
        saldoPendiente: "500",
        montoNuevo: "-10",
      }).permitido,
    ).toBe(false);
  });

  it("rechaza bajar el monto por debajo de lo ya abonado, y lo dice en el motivo", () => {
    // abonado = 500 - 200 = 300
    const r = puedeEditarMonto({
      montoOriginal: "500",
      saldoPendiente: "200",
      montoNuevo: "250",
    });
    expect(r.permitido).toBe(false);
    expect(r.motivo).toContain("300");
  });

  it("permite el borde montoNuevo === abonado (deja el saldo en 0)", () => {
    expect(
      puedeEditarMonto({
        montoOriginal: "500",
        saldoPendiente: "200",
        montoNuevo: "300",
      }),
    ).toEqual({ permitido: true });
  });

  it("rechaza el sub-centavo: bajar un rubro vivo a 0.004 lo dejaría en 0.00", () => {
    for (const montoNuevo of [0.004, "0.0049"]) {
      const r = puedeEditarMonto({
        montoOriginal: "500",
        saldoPendiente: "500",
        montoNuevo,
      });
      expect(r.permitido).toBe(false);
      expect(r.motivo).toBeString();
    }
  });

  it("compara contra lo abonado el monto YA REDONDEADO, que es lo que se guarda", () => {
    // abonado = 500 − 200 = 300. 299.999 se guardaría como "300.00": el saldo
    // queda en 0, no negativo, así que rechazarlo por el crudo sería mentir.
    expect(
      puedeEditarMonto({
        montoOriginal: "500",
        saldoPendiente: "200",
        montoNuevo: "299.999",
      }),
    ).toEqual({ permitido: true });
    // 299.99 sí queda por debajo tras redondear.
    expect(
      puedeEditarMonto({
        montoOriginal: "500",
        saldoPendiente: "200",
        montoNuevo: "299.99",
      }).permitido,
    ).toBe(false);
  });

  it("permite subir el monto", () => {
    expect(
      puedeEditarMonto({
        montoOriginal: "500",
        saldoPendiente: "200",
        montoNuevo: 800,
      }),
    ).toEqual({ permitido: true });
  });
});

describe("nuevoSaldoTrasEdicion", () => {
  it("resta lo ya abonado del monto nuevo", () => {
    expect(
      nuevoSaldoTrasEdicion({
        montoOriginal: "500",
        saldoPendiente: "200",
        montoNuevo: "800",
      }).toFixed(2),
    ).toBe("500.00");
  });

  it("clampea a 0 cuando el monto nuevo es menor a lo abonado", () => {
    expect(
      nuevoSaldoTrasEdicion({
        montoOriginal: "500",
        saldoPendiente: "200",
        montoNuevo: "100",
      }).toFixed(2),
    ).toBe("0.00");
  });

  it("el borde montoNuevo === abonado deja el saldo exactamente en 0", () => {
    expect(
      nuevoSaldoTrasEdicion({
        montoOriginal: "500",
        saldoPendiente: "200",
        montoNuevo: "300",
      }).toFixed(2),
    ).toBe("0.00");
  });

  it("parte del monto ya redondeado, para que el saldo cuadre con lo guardado", () => {
    // Se guarda monto_original "300.00"; el saldo tiene que ser 300.00 − 300 = 0.
    expect(
      nuevoSaldoTrasEdicion({
        montoOriginal: "500",
        saldoPendiente: "200",
        montoNuevo: "299.999",
      }).toFixed(2),
    ).toBe("0.00");
    expect(
      nuevoSaldoTrasEdicion({
        montoOriginal: "500",
        saldoPendiente: "200",
        montoNuevo: "800.004",
      }).toFixed(2),
    ).toBe("500.00");
  });

  it("no arrastra error de punto flotante", () => {
    expect(
      nuevoSaldoTrasEdicion({
        montoOriginal: "0.3",
        saldoPendiente: "0.1",
        montoNuevo: "0.3",
      }).toFixed(2),
    ).toBe("0.10");
  });
});

describe("rubroCompletado", () => {
  it("está completado con saldo 0 o negativo", () => {
    expect(rubroCompletado("0")).toBe(true);
    expect(rubroCompletado(0)).toBe(true);
    expect(rubroCompletado("-0.01")).toBe(true);
  });

  it("no está completado con saldo vivo", () => {
    expect(rubroCompletado("0.01")).toBe(false);
    expect(rubroCompletado(150)).toBe(false);
  });
});


// ===========================================================================
// FASE 2 — COBRO DE RUBROS EN EL FLUJO DE PAGOS
// ===========================================================================

describe("ordenarRubrosParaCobro", () => {
  const r = (
    rubro_id: number,
    obligatorio: boolean,
    created_at: string | null,
  ) => ({ rubro_id, obligatorio, created_at: created_at ? new Date(created_at) : null });

  it("pone los obligatorios antes que los opcionales aunque sean más nuevos", () => {
    const orden = ordenarRubrosParaCobro([
      r(1, false, "2026-01-01"),
      r(2, true, "2026-09-01"),
      r(3, false, "2026-02-01"),
    ]).map((x) => x.rubro_id);
    expect(orden).toEqual([2, 1, 3]);
  });

  it("dentro del mismo grupo cobra primero el más viejo", () => {
    const orden = ordenarRubrosParaCobro([
      r(1, true, "2026-05-01"),
      r(2, true, "2026-01-01"),
      r(3, true, "2026-03-01"),
    ]).map((x) => x.rubro_id);
    expect(orden).toEqual([2, 3, 1]);
  });

  it("desempata por rubro_id para que el orden sea estable", () => {
    const orden = ordenarRubrosParaCobro([
      r(9, false, "2026-01-01"),
      r(4, false, "2026-01-01"),
    ]).map((x) => x.rubro_id);
    expect(orden).toEqual([4, 9]);
  });

  it("el rubro sin created_at va al final de su grupo, no al principio", () => {
    const orden = ordenarRubrosParaCobro([
      r(1, false, null),
      r(2, false, "2026-01-01"),
    ]).map((x) => x.rubro_id);
    expect(orden).toEqual([2, 1]);
  });

  it("no muta el arreglo que recibe", () => {
    const entrada = [r(1, false, "2026-02-01"), r(2, true, "2026-01-01")];
    ordenarRubrosParaCobro(entrada);
    expect(entrada.map((x) => x.rubro_id)).toEqual([1, 2]);
  });
});

describe("disponibleDeRubro", () => {
  it("es el saldo cuando no hay reclamos de otras boletas", () => {
    expect(
      disponibleDeRubro({ saldoPendiente: "300", reclamadoVivo: 0 }).toFixed(2),
    ).toBe("300.00");
  });

  it("descuenta lo que ya apartaron las boletas hermanas sin aplicar", () => {
    expect(
      disponibleDeRubro({ saldoPendiente: "300", reclamadoVivo: "120" }).toFixed(2),
    ).toBe("180.00");
  });

  it("nunca es negativo aunque los reclamos superen el saldo", () => {
    expect(
      disponibleDeRubro({ saldoPendiente: "100", reclamadoVivo: "250" }).toFixed(2),
    ).toBe("0.00");
  });

  it("no arrastra error de punto flotante", () => {
    expect(
      disponibleDeRubro({ saldoPendiente: "0.3", reclamadoVivo: "0.1" }).toFixed(2),
    ).toBe("0.20");
  });
});

describe("repartirEnRubros", () => {
  const rubro = (
    rubro_id: number,
    saldoPendiente: string,
    reclamadoVivo: string = "0",
    obligatorio = false,
    created_at = "2026-01-01",
  ) => ({
    rubro_id,
    saldoPendiente,
    reclamadoVivo,
    obligatorio,
    created_at: new Date(created_at),
  });

  it("sin disponible no cobra nada", () => {
    const r = repartirEnRubros({ disponible: 0, rubros: [rubro(1, "100")] });
    expect(r.cobros).toEqual([]);
    expect(r.total.toFixed(2)).toBe("0.00");
  });

  it("sin rubros vivos no cobra nada y devuelve el disponible intacto", () => {
    const r = repartirEnRubros({ disponible: "500", rubros: [] });
    expect(r.cobros).toEqual([]);
    expect(r.disponibleRestante.toFixed(2)).toBe("500.00");
  });

  it("cobra el rubro completo y deja el resto del disponible", () => {
    const r = repartirEnRubros({ disponible: "500", rubros: [rubro(1, "100")] });
    expect(r.cobros).toEqual([{ rubro_id: 1, monto: "100.00" }]);
    expect(r.total.toFixed(2)).toBe("100.00");
    expect(r.disponibleRestante.toFixed(2)).toBe("400.00");
  });

  it("permite el abono PARCIAL cuando el disponible no alcanza", () => {
    const r = repartirEnRubros({ disponible: "40", rubros: [rubro(1, "100")] });
    expect(r.cobros).toEqual([{ rubro_id: 1, monto: "40.00" }]);
    expect(r.disponibleRestante.toFixed(2)).toBe("0.00");
  });

  it("consume en el orden de cobro: obligatorio primero, después el más viejo", () => {
    const r = repartirEnRubros({
      disponible: "150",
      rubros: [
        rubro(1, "100", "0", false, "2026-01-01"),
        rubro(2, "100", "0", true, "2026-09-01"),
      ],
    });
    // El obligatorio se lleva sus Q100 aunque sea el más nuevo; al opcional
    // sólo le quedan Q50.
    expect(r.cobros).toEqual([
      { rubro_id: 2, monto: "100.00" },
      { rubro_id: 1, monto: "50.00" },
    ]);
    expect(r.total.toFixed(2)).toBe("150.00");
    expect(r.disponibleRestante.toFixed(2)).toBe("0.00");
  });

  it("netea contra los reclamos vivos de las boletas hermanas", () => {
    const r = repartirEnRubros({
      disponible: "500",
      rubros: [rubro(1, "300", "300")],
    });
    // Otra boleta ya apartó los Q300 completos: no queda nada que cobrar.
    expect(r.cobros).toEqual([]);
    expect(r.disponibleRestante.toFixed(2)).toBe("500.00");
  });

  it("salta el rubro sin disponible y sigue con el siguiente", () => {
    const r = repartirEnRubros({
      disponible: "500",
      rubros: [
        rubro(1, "300", "300", true, "2026-01-01"),
        rubro(2, "120", "0", false, "2026-02-01"),
      ],
    });
    expect(r.cobros).toEqual([{ rubro_id: 2, monto: "120.00" }]);
  });

  it("no escribe reclamos de Q0", () => {
    const r = repartirEnRubros({
      disponible: "100",
      rubros: [rubro(1, "100"), rubro(2, "50", "0", false, "2026-02-01")],
    });
    expect(r.cobros).toEqual([{ rubro_id: 1, monto: "100.00" }]);
  });

  it("los montos salen en la escala de la columna, sin centavos fantasma", () => {
    const r = repartirEnRubros({
      disponible: "0.3",
      rubros: [rubro(1, "0.1"), rubro(2, "0.2", "0", false, "2026-02-01")],
    });
    expect(r.cobros).toEqual([
      { rubro_id: 1, monto: "0.10" },
      { rubro_id: 2, monto: "0.20" },
    ]);
    expect(r.disponibleRestante.toFixed(2)).toBe("0.00");
  });
});

describe("puedeTocarRubroConReclamosVivos", () => {
  it("deja pasar cuando no hay reclamos sin aplicar", () => {
    expect(puedeTocarRubroConReclamosVivos({ reclamos: [] }).permitido).toBe(true);
  });

  it("bloquea con 409 y dice cuánto se apartó y qué hacer", () => {
    const v = puedeTocarRubroConReclamosVivos({
      reclamos: [{ pago_id: 77, monto: "150" }, { pago_id: 78, monto: "50.50" }],
    });
    expect(v.permitido).toBe(false);
    expect(v.status).toBe(409);
    // El monto TOTAL apartado, los pagos involucrados y las dos salidas.
    expect(v.motivo).toContain("200.50");
    expect(v.motivo).toContain("77");
    expect(v.motivo).toContain("78");
    // Las dos salidas que el mensaje tiene que ofrecer.
    expect(v.motivo?.toLowerCase()).toContain("aplique");
    expect(v.motivo?.toLowerCase()).toContain("revi");
  });
});

describe("puedeAplicarReclamo", () => {
  it("deja aplicar cuando el saldo alcanza exactamente", () => {
    expect(
      puedeAplicarReclamo({
        rubro_id: 5,
        saldoPendiente: "100",
        montoApartado: "100",
      }).permitido,
    ).toBe(true);
  });

  it("falla RUIDOSO cuando el saldo ya no alcanza, en vez de aplicar de menos", () => {
    const v = puedeAplicarReclamo({
      rubro_id: 5,
      saldoPendiente: "40",
      montoApartado: "100",
    });
    expect(v.permitido).toBe(false);
    expect(v.motivo).toContain("5");
    expect(v.motivo).toContain("40.00");
    expect(v.motivo).toContain("100.00");
  });

  it("compara con Big: 0.1 + 0.2 apartados contra 0.3 de saldo alcanza", () => {
    expect(
      puedeAplicarReclamo({
        rubro_id: 1,
        saldoPendiente: "0.3",
        montoApartado: new Big("0.1").plus("0.2"),
      }).permitido,
    ).toBe(true);
  });
});

describe("puedeApartarReclamo", () => {
  it("deja apartar cuando el disponible alcanza exactamente", () => {
    expect(
      puedeApartarReclamo({
        rubro_id: 7,
        saldoPendiente: "100",
        reclamadoVivo: "0",
        montoApartado: "100",
      }).permitido,
    ).toBe(true);
  });

  it("rechaza cuando el rubro se achicó entre el reparto y el INSERT del reclamo", () => {
    const v = puedeApartarReclamo({
      rubro_id: 7,
      saldoPendiente: "150",
      reclamadoVivo: "0",
      montoApartado: "400",
    });
    expect(v.permitido).toBe(false);
    expect(v.status).toBe(409);
    // El mensaje es para el asesor que tiene la boleta en la mano: qué pasó,
    // cuánto queda, y que reintentar recalcula.
    expect(v.motivo).toContain("#7");
    expect(v.motivo).toContain("150.00");
    expect(v.motivo).toContain("400.00");
    expect(v.motivo).toContain("NO se registró");
  });

  it("un rubro ANULADO (saldo 0) nunca deja apartar", () => {
    expect(
      puedeApartarReclamo({
        rubro_id: 7,
        saldoPendiente: "0",
        reclamadoVivo: "0",
        montoApartado: "0.01",
      }).permitido,
    ).toBe(false);
  });

  it("mide contra el DISPONIBLE: lo apartado por boletas hermanas no se puede volver a apartar", () => {
    // Mismo saldo, misma boleta: alcanza sin hermanos y no alcanza con ellos.
    expect(
      puedeApartarReclamo({
        rubro_id: 7,
        saldoPendiente: "100",
        reclamadoVivo: "0",
        montoApartado: "60",
      }).permitido,
    ).toBe(true);
    expect(
      puedeApartarReclamo({
        rubro_id: 7,
        saldoPendiente: "100",
        reclamadoVivo: "60",
        montoApartado: "60",
      }).permitido,
    ).toBe(false);
  });

  it("compara con Big: 0.1 + 0.2 apartados contra 0.3 de disponible alcanza", () => {
    expect(
      puedeApartarReclamo({
        rubro_id: 1,
        saldoPendiente: "0.3",
        reclamadoVivo: "0",
        montoApartado: new Big("0.1").plus("0.2"),
      }).permitido,
    ).toBe(true);
  });
});

describe("crearEstampadorRubros", () => {
  it("entrega el total a la PRIMERA fila que lo pide y 0 a las demás", () => {
    const estampar = crearEstampadorRubros("250");
    expect(estampar.pendiente()).toBe("250");
    expect(estampar()).toBe("250");
    expect(estampar()).toBe("0");
    expect(estampar.pendiente()).toBe("0");
  });

  it("el peek NO consume el sello", () => {
    const estampar = crearEstampadorRubros("10");
    expect(estampar.pendiente()).toBe("10");
    expect(estampar.pendiente()).toBe("10");
    expect(estampar()).toBe("10");
  });

  it("sin rubros cobrados nunca estampa nada", () => {
    const estampar = crearEstampadorRubros(0);
    expect(estampar.pendiente()).toBe("0");
    expect(estampar()).toBe("0");
  });
});
