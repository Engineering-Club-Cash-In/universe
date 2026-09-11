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
  puedeUsarMonto,
  redondearMonto,
  rubroCompletado,
  textoLimpio,
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

