import { describe, expect, it } from "bun:test";
import {
  construirHistorialMora,
  construirRespuesta,
  construirVeredicto,
  cotaDelPresupuesto,
  esCreditoInsoluto,
  fichasDelDpi,
  seleccionarFichasDelDpi,
  fusionarCreditosPorId,
  montoDeMorasCerradas,
  nombreClienteSifco,
  numerosEspejoConPresupuesto,
  respuestaClienteNoEncontrado,
  rolPuedeConsultarMora,
  respuestaServicioNoDisponible,
  siguientePasoConsulta,
  unirNumerosCredito,
  validarDpiConsulta,
  type CreditoConsultaMora,
  type FilaCreditoMora,
} from "./consultaMoraPolicy";

const CONSULTADO_EN = new Date("2026-09-17T15:00:00.000Z");

const credito = (
  parcial: Partial<CreditoConsultaMora> = {}
): CreditoConsultaMora => ({
  numeroCreditoSifco: "01010214124060",
  estado: "ACTIVO",
  moraActiva: null,
  ...parcial,
});

describe("veredicto de consulta de mora", () => {
  it("bloquea cuando algún crédito tiene mora viva en moras_credito", () => {
    const veredicto = construirVeredicto([
      credito(),
      credito({
        numeroCreditoSifco: "01010214115650",
        moraActiva: { monto: "1250.00", cuotasAtrasadas: 2 },
      }),
    ]);

    expect(veredicto).toEqual({
      tieneMoraActiva: true,
      puedeContinuar: false,
      motivo: "MORA_ACTIVA",
    });
  });

  it("bloquea por estado MOROSO, CAIDO o INCOBRABLE aunque no haya fila de mora", () => {
    for (const estado of ["MOROSO", "CAIDO", "INCOBRABLE"]) {
      const veredicto = construirVeredicto([credito({ estado })]);

      expect(veredicto.tieneMoraActiva).toBeTrue();
      expect(veredicto.puedeContinuar).toBeFalse();
      expect(veredicto.motivo).toBe("MORA_ACTIVA");
    }
  });

  it("bloquea por EN_CONVENIO sin marcarlo como mora activa", () => {
    const veredicto = construirVeredicto([
      credito(),
      credito({ numeroCreditoSifco: "01010214120190", estado: "EN_CONVENIO" }),
    ]);

    expect(veredicto).toEqual({
      tieneMoraActiva: false,
      puedeContinuar: false,
      motivo: "EN_CONVENIO",
    });
  });

  it("la mora activa gana sobre el convenio cuando conviven", () => {
    const veredicto = construirVeredicto([
      credito({ estado: "EN_CONVENIO" }),
      credito({
        numeroCreditoSifco: "01010214115650",
        moraActiva: { monto: "800.00", cuotasAtrasadas: 1 },
      }),
    ]);

    expect(veredicto.motivo).toBe("MORA_ACTIVA");
    expect(veredicto.puedeContinuar).toBeFalse();
  });

  it("deja pasar al cliente que solo tiene mora histórica", () => {
    const historialMora = construirHistorialMora({
      eventos: [
        {
          fecha: new Date("2026-03-01T00:00:00.000Z"),
          monto_nuevo: "500.00",
          tipo_evento: "CREACION",
          numeroCreditoSifco: "01010214124060",
        },
        {
          fecha: new Date("2026-04-01T00:00:00.000Z"),
          monto_nuevo: "0.00",
          tipo_evento: "DESACTIVACION",
          numeroCreditoSifco: "01010214124060",
        },
      ],
      morasCerradas: [
        {
          fecha: new Date("2026-04-01T00:00:00.000Z"),
          monto_mora: "500.00",
          numeroCreditoSifco: "01010214124060",
        },
      ],
      convenios: [],
    });

    const respuesta = construirRespuesta({
      cliente: { codigoClienteSifco: "8782", nombre: "Juan Pérez" },
      creditos: [credito({ estado: "CANCELADO" })],
      historialMora,
      consultadoEn: CONSULTADO_EN,
    });

    expect(respuesta.tieneMoraActiva).toBeFalse();
    expect(respuesta.puedeContinuar).toBeTrue();
    expect(respuesta.motivo).toBe("SIN_MORA");
    expect(respuesta.historialMora).toHaveLength(3);
  });

  it("deja pasar al cliente sin créditos en cartera", () => {
    expect(construirVeredicto([])).toEqual({
      tieneMoraActiva: false,
      puedeContinuar: true,
      motivo: "SIN_MORA",
    });
  });
});

describe("regla del crédito insoluto", () => {
  it("reconoce el insoluto por el número y no confunde a otros créditos", () => {
    expect(esCreditoInsoluto(credito({ numeroCreditoSifco: "insoluto-1" }))).toBeTrue();
    expect(esCreditoInsoluto(credito({ numeroCreditoSifco: "insoluto-42" }))).toBeTrue();

    for (const numero of [
      "01010214124060",
      "CRM-8f14e45f-ceea-467a-9f07-6c0b6e0a1c33",
      "insoluto-",
      "insoluto-abc",
      "reinsoluto-1",
      "insoluto-1-bis",
    ]) {
      expect(esCreditoInsoluto(credito({ numeroCreditoSifco: numero }))).toBeFalse();
    }
  });

  it("🔴 bloquea aunque el insoluto esté CANCELADO y no haya mora en ningún lado", () => {
    const veredicto = construirVeredicto([
      credito({ estado: "CANCELADO" }),
      credito({ numeroCreditoSifco: "insoluto-3", estado: "CANCELADO" }),
    ]);

    expect(veredicto).toEqual({
      // El bloqueo no se disfraza de mora: no la hay y decirlo sería mentirle al
      // asesor sobre qué tiene que gestionar.
      tieneMoraActiva: false,
      puedeContinuar: false,
      motivo: "CREDITO_INSOLUTO",
    });
  });

  it("un solo insoluto basta, aunque el resto de la cartera esté impecable", () => {
    const veredicto = construirVeredicto([
      credito({ numeroCreditoSifco: "01010214124060", estado: "ACTIVO" }),
      credito({ numeroCreditoSifco: "01010214115650", estado: "CANCELADO" }),
      credito({ numeroCreditoSifco: "insoluto-7", estado: "CANCELADO" }),
    ]);

    expect(veredicto.puedeContinuar).toBeFalse();
    expect(veredicto.motivo).toBe("CREDITO_INSOLUTO");
  });

  it("precedencia: la mora activa se reporta antes que el insoluto", () => {
    const veredicto = construirVeredicto([
      credito({ numeroCreditoSifco: "insoluto-2", estado: "CANCELADO" }),
      credito({
        numeroCreditoSifco: "01010214115650",
        moraActiva: { monto: "900.00", cuotasAtrasadas: 3 },
      }),
    ]);

    expect(veredicto.motivo).toBe("MORA_ACTIVA");
    expect(veredicto.tieneMoraActiva).toBeTrue();
    expect(veredicto.puedeContinuar).toBeFalse();
  });

  it("precedencia: el insoluto se reporta antes que el convenio", () => {
    const veredicto = construirVeredicto([
      credito({ numeroCreditoSifco: "01010214120190", estado: "EN_CONVENIO" }),
      credito({ numeroCreditoSifco: "insoluto-5", estado: "CANCELADO" }),
    ]);

    expect(veredicto.motivo).toBe("CREDITO_INSOLUTO");
    expect(veredicto.puedeContinuar).toBeFalse();
  });

  it("el insoluto INCOBRABLE sale como MORA_ACTIVA: es la razón más grave", () => {
    // Los insolutos nacen INCOBRABLE, y ese estado ya es mora por sí solo. Las
    // dos reglas lo bloquean; se reporta la de arriba.
    const veredicto = construirVeredicto([
      credito({ numeroCreditoSifco: "insoluto-1", estado: "INCOBRABLE" }),
    ]);

    expect(veredicto.motivo).toBe("MORA_ACTIVA");
    expect(veredicto.puedeContinuar).toBeFalse();
  });
});

describe("unión de números de crédito", () => {
  it("suma los que aporta el llamador a los que resolvió SIFCO", () => {
    const unidos = unirNumerosCredito(
      ["01010214124060"],
      ["CRM-8f14e45f-ceea-467a-9f07-6c0b6e0a1c33", "insoluto-3"],
    );

    expect(unidos.sort()).toEqual(
      [
        "01010214124060",
        "CRM-8f14e45f-ceea-467a-9f07-6c0b6e0a1c33",
        "insoluto-3",
      ].sort(),
    );
  });

  it("deduplica el número que ambas fuentes conocen", () => {
    expect(
      unirNumerosCredito(["01010214124060"], ["01010214124060"]),
    ).toEqual(["01010214124060"]);
  });

  it("descarta vacíos y espacios en blanco, y tolera que no vengan conocidos", () => {
    expect(unirNumerosCredito(["01010214124060"], ["", "   "])).toEqual([
      "01010214124060",
    ]);
    expect(unirNumerosCredito(["  01010214124060  "], undefined)).toEqual([
      "01010214124060",
    ]);
    expect(unirNumerosCredito([], undefined)).toEqual([]);
  });

  it("el espejo con filas NO descarta lo que trae el API: se unen", () => {
    // La misma unión la usa `obtenerNumerosPrestamo` para juntar el espejo
    // `sifco.prestamos` con la respuesta del API. Antes el espejo cortaba la
    // consulta apenas devolvía algo, y un espejo PARCIALMENTE atrasado —tiene
    // el préstamo viejo, le falta el que acaba de caer en mora— armaba el
    // veredicto sobre media cartera y salía SIN_MORA.
    expect(
      unirNumerosCredito(
        ["01010214124060"],
        ["01010214124060", "01010214115650"],
      ).sort(),
    ).toEqual(["01010214115650", "01010214124060"]);
  });

  it("el cliente sin ficha en SIFCO llega igual por los números del CRM", () => {
    // SIFCO no devolvió nada porque no tiene ficha suya; los créditos nacieron
    // todos en el CRM. Sin esta unión no habría un solo número que consultar.
    expect(unirNumerosCredito([], ["CRM-abc", "insoluto-9"])).toEqual([
      "CRM-abc",
      "insoluto-9",
    ]);
  });
});

describe("siguiente paso de la consulta", () => {
  it("con números que mirar va a buscar los créditos", () => {
    expect(
      siguientePasoConsulta({ cantidadFichas: 1, cantidadNumeros: 2 }),
    ).toBe("BUSCAR_CREDITOS");
  });

  it("el cliente sin ficha pero con números del CRM también se busca", () => {
    expect(
      siguientePasoConsulta({ cantidadFichas: 0, cantidadNumeros: 1 }),
    ).toBe("BUSCAR_CREDITOS");
  });

  it("ficha válida sin un solo préstamo es un cliente conocido y al día", () => {
    // 🔴 El caso que salía CLIENTE_NO_ENCONTRADO tirando la ficha: el core sí
    // sabe quién es, solo que no tiene créditos. Responder "no es cliente"
    // borraba un dato cierto y le negaba al CRM el nombre que ya tenía.
    expect(
      siguientePasoConsulta({ cantidadFichas: 1, cantidadNumeros: 0 }),
    ).toBe("RESPONDER_SIN_CREDITOS");
  });

  it("ni ficha ni números: recién ahí el DPI no le consta a nadie", () => {
    expect(
      siguientePasoConsulta({ cantidadFichas: 0, cantidadNumeros: 0 }),
    ).toBe("CLIENTE_NO_ENCONTRADO");
  });

  it("el cliente conocido y sin créditos sale encontrado y SIN_MORA", () => {
    // Lo que el controller arma cuando el paso es RESPONDER_SIN_CREDITOS.
    const respuesta = construirRespuesta({
      cliente: { codigoClienteSifco: "4821", nombre: "ANA LOPEZ" },
      creditos: [],
      historialMora: [],
      consultadoEn: CONSULTADO_EN,
    });

    expect(respuesta.encontrado).toBeTrue();
    expect(respuesta.motivo).toBe("SIN_MORA");
    expect(respuesta.puedeContinuar).toBeTrue();
    expect(respuesta.cliente).toEqual({
      codigoClienteSifco: "4821",
      nombre: "ANA LOPEZ",
    });
  });
});

describe("expansión de créditos por dueño", () => {
  const fila = (parcial: Partial<FilaCreditoMora> = {}): FilaCreditoMora => ({
    credito_id: 1,
    usuario_id: 500,
    numeroCreditoSifco: "01010214124060",
    estado: "ACTIVO",
    moraMonto: null,
    moraCuotas: null,
    ...parcial,
  });

  it("suma los hermanos invisibles sin duplicar el crédito que está en ambas", () => {
    const porNumero = [fila({ credito_id: 1 })];
    const porUsuario = [
      fila({ credito_id: 1 }),
      fila({ credito_id: 2, numeroCreditoSifco: "insoluto-3", estado: "CANCELADO" }),
    ];

    const fusionado = fusionarCreditosPorId(porNumero, porUsuario);

    expect(fusionado).toHaveLength(2);
    expect(fusionado.map((f) => f.credito_id).sort()).toEqual([1, 2]);
  });

  it("🔴 el insoluto invisible cambia el veredicto del cliente que pasaba limpio", () => {
    // Este es el agujero entero en una prueba: por número solo se ve el crédito
    // sano; expandiendo por dueño aparece el insoluto y el gate corta.
    const porNumero = [fila({ credito_id: 1 })];
    const porUsuario = [
      fila({ credito_id: 1 }),
      fila({ credito_id: 2, numeroCreditoSifco: "insoluto-3", estado: "CANCELADO" }),
    ];

    const aCredito = (f: FilaCreditoMora): CreditoConsultaMora => ({
      numeroCreditoSifco: f.numeroCreditoSifco,
      estado: f.estado,
      moraActiva: null,
    });

    expect(construirVeredicto(porNumero.map(aCredito)).puedeContinuar).toBeTrue();
    expect(
      construirVeredicto(fusionarCreditosPorId(porNumero, porUsuario).map(aCredito))
        .puedeContinuar,
    ).toBeFalse();
  });

  it("no pierde el crédito que empató por número pero no tiene dueño", () => {
    const huerfano = fila({ credito_id: 9, usuario_id: null });

    expect(fusionarCreditosPorId([huerfano], [])).toEqual([huerfano]);
  });
});

describe("respuestas sin veredicto de créditos", () => {
  it("un DPI desconocido no se rechaza", () => {
    expect(respuestaClienteNoEncontrado(CONSULTADO_EN)).toEqual({
      encontrado: false,
      tieneMoraActiva: false,
      puedeContinuar: true,
      motivo: "CLIENTE_NO_ENCONTRADO",
      cliente: null,
      creditos: [],
      historialMora: [],
      consultadoEn: "2026-09-17T15:00:00.000Z",
    });
  });

  it("un fallo de SIFCO bloquea y no se disfraza de 'sin mora'", () => {
    const respuesta = respuestaServicioNoDisponible(CONSULTADO_EN);

    expect(respuesta.puedeContinuar).toBeFalse();
    expect(respuesta.motivo).toBe("SERVICIO_NO_DISPONIBLE");
    expect(respuesta.motivo).not.toBe("SIN_MORA");
    expect(respuesta.encontrado).toBeFalse();
    expect(respuesta.cliente).toBeNull();
  });
});

describe("historial de mora compuesto", () => {
  it("incluye el convenio, única evidencia del ciclo mora → convenio → terminado", () => {
    // paymentAgreement.ts borra la mora activa al crear el convenio y no deja
    // fila en moras_historial: sin esta fuente el caso desaparece del historial.
    const historial = construirHistorialMora({
      eventos: [],
      morasCerradas: [],
      convenios: [
        {
          fecha_convenio: new Date("2026-05-10T00:00:00.000Z"),
          monto_total_convenio: "12000.00",
          numeroCreditoSifco: "01010214120190",
        },
      ],
    });

    expect(historial).toEqual([
      {
        fecha: "2026-05-10T00:00:00.000Z",
        monto: "12000.00",
        numeroCreditoSifco: "01010214120190",
        evento: "CONVENIO",
      },
    ]);
  });

  it("mezcla las tres fuentes ordenadas por fecha descendente", () => {
    const historial = construirHistorialMora({
      eventos: [
        {
          fecha: new Date("2026-01-15T00:00:00.000Z"),
          monto_nuevo: "300.00",
          tipo_evento: "CREACION",
          numeroCreditoSifco: "A",
        },
        {
          fecha: new Date("2026-06-01T00:00:00.000Z"),
          monto_nuevo: "450.00",
          tipo_evento: "INCREMENTO",
          numeroCreditoSifco: "A",
        },
      ],
      morasCerradas: [
        {
          fecha: new Date("2026-03-20T00:00:00.000Z"),
          monto_mora: "300.00",
          numeroCreditoSifco: "A",
        },
      ],
      convenios: [
        {
          fecha_convenio: new Date("2026-04-05T00:00:00.000Z"),
          monto_total_convenio: "9000.00",
          numeroCreditoSifco: "B",
        },
      ],
    });

    expect(historial.map((e) => [e.evento, e.fecha])).toEqual([
      ["INCREMENTO", "2026-06-01T00:00:00.000Z"],
      ["CONVENIO", "2026-04-05T00:00:00.000Z"],
      ["MORA_CERRADA", "2026-03-20T00:00:00.000Z"],
      ["CREACION", "2026-01-15T00:00:00.000Z"],
    ]);
  });

  it("no inventa montos cuando la fila viene en null", () => {
    const [evento] = construirHistorialMora({
      eventos: [
        {
          fecha: "2026-02-02T00:00:00.000Z",
          monto_nuevo: null,
          tipo_evento: "RECALCULO",
          numeroCreditoSifco: "A",
        },
      ],
      morasCerradas: [],
      convenios: [],
    });

    expect(evento.monto).toBe("0.00");
  });

  it("lee el timestamp sin zona de la BD como UTC, no como hora local", () => {
    // Las columnas `timestamp` sin zona de cartera guardan UTC y el driver las
    // entrega como string desnudo. Interpretarlo en la zona del PROCESO
    // (TZ=America/Guatemala en el servidor) corre esa fecha +6h — y como las
    // fuentes conviven con fechas que sí llegan como instante (Date), el
    // desfase invierte el orden: el INCREMENTO de las 23:00Z se leía como
    // 05:00Z del día siguiente y se colaba ARRIBA del convenio de las 02:00Z.
    const historial = construirHistorialMora({
      eventos: [
        {
          fecha: "2026-03-20 23:00:00",
          monto_nuevo: "450.00",
          tipo_evento: "INCREMENTO",
          numeroCreditoSifco: "A",
        },
      ],
      morasCerradas: [],
      convenios: [
        {
          fecha_convenio: new Date("2026-03-21T02:00:00.000Z"),
          monto_total_convenio: "9000.00",
          numeroCreditoSifco: "A",
        },
      ],
    });

    expect(historial.map((e) => [e.evento, e.fecha])).toEqual([
      ["CONVENIO", "2026-03-21T02:00:00.000Z"],
      ["INCREMENTO", "2026-03-20T23:00:00.000Z"],
    ]);
  });
});

describe("monto de la mora cerrada", () => {
  const moraCerrada = (mora_id: number | null) => ({
    fecha: new Date("2026-04-01T00:00:00.000Z"),
    monto_mora: "0",
    numeroCreditoSifco: "A",
    mora_id,
  });

  it("🔴 usa el monto_anterior de la DESACTIVACION, no el 0 que dejó latefee", () => {
    // `latefee.ts` pone monto_mora = "0" en el mismo update que apaga la mora,
    // así que toda MORA_CERRADA salía en 0 y el asesor leía un historial de
    // moras que nunca debieron nada.
    const historial = construirHistorialMora({
      eventos: [
        {
          fecha: new Date("2026-04-01T00:00:00.000Z"),
          monto_nuevo: "0",
          monto_anterior: "735.50",
          mora_id: 7,
          tipo_evento: "DESACTIVACION",
          numeroCreditoSifco: "A",
        },
      ],
      morasCerradas: [moraCerrada(7)],
      convenios: [],
    });

    const cerrada = historial.find((e) => e.evento === "MORA_CERRADA");
    expect(cerrada?.monto).toBe("735.50");
  });

  it("se queda con la ÚLTIMA desactivación: una mora puede revivir y volver a cerrarse", () => {
    const historial = construirHistorialMora({
      eventos: [
        {
          fecha: new Date("2026-02-01T00:00:00.000Z"),
          monto_nuevo: "0",
          monto_anterior: "100.00",
          mora_id: 7,
          tipo_evento: "DESACTIVACION",
          numeroCreditoSifco: "A",
        },
        {
          fecha: new Date("2026-04-01T00:00:00.000Z"),
          monto_nuevo: "0",
          monto_anterior: "980.00",
          mora_id: 7,
          tipo_evento: "DESACTIVACION",
          numeroCreditoSifco: "A",
        },
      ],
      morasCerradas: [moraCerrada(7)],
      convenios: [],
    });

    expect(historial.find((e) => e.evento === "MORA_CERRADA")?.monto).toBe(
      "980.00"
    );
  });

  it("no toma el monto de OTRA mora ni de un evento que no es DESACTIVACION", () => {
    const historial = construirHistorialMora({
      eventos: [
        {
          fecha: new Date("2026-03-01T00:00:00.000Z"),
          monto_nuevo: "500.00",
          monto_anterior: "400.00",
          mora_id: 7,
          tipo_evento: "INCREMENTO",
          numeroCreditoSifco: "A",
        },
        {
          fecha: new Date("2026-03-15T00:00:00.000Z"),
          monto_nuevo: "0",
          monto_anterior: "1200.00",
          mora_id: 99,
          tipo_evento: "DESACTIVACION",
          numeroCreditoSifco: "A",
        },
      ],
      morasCerradas: [moraCerrada(7)],
      convenios: [],
    });

    expect(historial.find((e) => e.evento === "MORA_CERRADA")?.monto).toBe("0");
  });

  it("sin evento de desactivación queda el monto de la fila: el convenio borra sin rastro", () => {
    // `paymentAgreement.ts` borra la mora activa sin escribir en
    // moras_historial. Ese historial no se pierde: viaja por la fuente CONVENIO.
    const historial = construirHistorialMora({
      eventos: [],
      morasCerradas: [moraCerrada(7)],
      convenios: [],
    });

    expect(historial.find((e) => e.evento === "MORA_CERRADA")?.monto).toBe("0");
  });

  it("el evento con mora_id nulo no rescata a nadie", () => {
    // `moras_historial.mora_id` es ON DELETE SET NULL: sin él no hay a qué mora
    // atribuirle el monto.
    const mapa = montoDeMorasCerradas([
      {
        fecha: new Date("2026-04-01T00:00:00.000Z"),
        tipo_evento: "DESACTIVACION",
        mora_id: null,
        monto_anterior: "500.00",
      },
    ]);

    expect(mapa.size).toBe(0);
  });
});

describe("presupuesto del espejo de SIFCO", () => {
  it("devuelve los números cuando el espejo contesta a tiempo", async () => {
    const numeros = await numerosEspejoConPresupuesto(
      async () => ["01010214124060"],
      1000,
      () => {
        throw new Error("no debía avisar");
      }
    );

    expect(numeros).toEqual(["01010214124060"]);
  });

  it("⚠️ al vencerse sigue con el API: lista vacía y aviso, NO fail-closed", async () => {
    // El espejo es un cache del core; el API es la fuente autoritativa viva, así
    // que seguir sin él deja la lista completa, no media lista.
    const avisos: unknown[] = [];

    const numeros = await numerosEspejoConPresupuesto(
      () => new Promise<string[]>(() => {}),
      10,
      (detalle) => avisos.push(detalle)
    );

    expect(numeros).toEqual([]);
    expect(avisos).toHaveLength(1);
  });

  it("el espejo que falla tampoco tumba la consulta", async () => {
    const avisos: unknown[] = [];

    const numeros = await numerosEspejoConPresupuesto(
      async () => {
        throw new Error("pool agotado");
      },
      1000,
      (detalle) => avisos.push(detalle)
    );

    expect(numeros).toEqual([]);
    expect((avisos[0] as Error).message).toBe("pool agotado");
  });
});

describe("presupuesto global de la consulta", () => {
  const VENCE_EN = 1_000_000;

  it("un paso no puede pedir más de lo que queda del presupuesto", () => {
    // Quedan 3s y el paso pediría 10s: se queda con los 3s. Antes los topes
    // eran aditivos y el paso arrancaba sus 10s completos por más que el
    // presupuesto de la consulta ya estuviera casi consumido.
    expect(cotaDelPresupuesto(10000, VENCE_EN, VENCE_EN - 3000)).toBe(3000);
  });

  it("con presupuesto de sobra manda la cota interna del paso", () => {
    // El espejo no se come el presupuesto entero por el hecho de que sobre.
    expect(cotaDelPresupuesto(5000, VENCE_EN, VENCE_EN - 15000)).toBe(5000);
  });

  it("presupuesto agotado devuelve null: el llamador corta fail-closed", () => {
    expect(cotaDelPresupuesto(10000, VENCE_EN, VENCE_EN)).toBeNull();
    expect(cotaDelPresupuesto(10000, VENCE_EN, VENCE_EN + 1)).toBeNull();
  });

  it("🔴 la suma de los pasos deja de crecer con cada ficha", () => {
    // Simulación del camino real: identificación (10s) + espejo (5s) + API
    // (10s) por cada ficha, secuencial, con un presupuesto global de 15s. Antes
    // esto daba 25s con una ficha y 40s con dos; ahora el total está acotado.
    const PRESUPUESTO = 15000;
    let ahora = 0;
    const venceEn = PRESUPUESTO;

    const correr = (cota: number) => {
      const ms = cotaDelPresupuesto(cota, venceEn, ahora);
      if (ms === null) return false;
      // Peor caso: el paso consume toda su cota.
      ahora += ms;
      return true;
    };

    correr(10000); // identificación
    for (const _ficha of [1, 2, 3]) {
      correr(5000); // espejo
      correr(10000); // API
    }

    expect(ahora).toBeLessThanOrEqual(PRESUPUESTO);
    // Y el paso siguiente ya no arranca: fail-closed en vez de seguir sumando.
    expect(cotaDelPresupuesto(10000, venceEn, ahora)).toBeNull();
  });
});

describe("validación del DPI antes de tocar SIFCO", () => {
  it("acepta el DPI de 13 dígitos y lo devuelve normalizado", () => {
    expect(validarDpiConsulta(" 2543 87621 0101 ")).toEqual({
      valido: true,
      dpi: "2543876210101",
    });
  });

  it("🔴 lo que se normaliza a nada es un error de validación, no una caída", () => {
    // `minLength: 1` los dejaba pasar: se normalizaban a "" y el fallo aguas
    // abajo volvía como 200 SERVICIO_NO_DISPONIBLE, que le dice al asesor
    // "reintentá" cuando lo que hay que hacer es corregir el dato.
    for (const basura of ["   ", "---", " - "]) {
      const resultado = validarDpiConsulta(basura);
      expect(resultado.valido).toBeFalse();
      expect(resultado.valido === false && resultado.mensaje).toContain("13");
    }
  });

  it("🔴 rechaza la forma antes de normalizar: el strip disimulaba la basura", () => {
    // `abc1234567890123xyz` pasaba: normalizar borra la evidencia y lo que
    // quedaba eran 13 dígitos impecables. El DPI se escribe con dígitos y, a lo
    // sumo, espacios o guiones; cualquier otra cosa es un campo a corregir.
    for (const forma of [
      "abc1234567890123xyz",
      "2543-87621-0101'",
      "2543/87621/0101",
      "abc",
    ]) {
      const resultado = validarDpiConsulta(forma);
      expect(resultado.valido).toBeFalse();
      expect(resultado.valido === false && resultado.mensaje).toContain(
        "dígitos, espacios y guiones"
      );
    }
  });

  it("sigue aceptando los separadores con que la gente escribe el DPI", () => {
    expect(validarDpiConsulta("2543-87621-0101").valido).toBeTrue();
    expect(validarDpiConsulta("2543 87621 0101").valido).toBeTrue();
  });

  it("exige el largo exacto: ni de más ni de menos", () => {
    for (const largo of ["123456789012", "12345678901234"]) {
      const resultado = validarDpiConsulta(largo);
      expect(resultado.valido).toBeFalse();
      expect(resultado.valido === false && resultado.mensaje).toContain(
        `se recibieron ${largo.length}`
      );
    }
  });
});

describe("quién puede preguntar por la mora de un DPI", () => {
  it("deja pasar a los tres roles propios de cartera", () => {
    for (const rol of ["ADMIN", "CONTA", "ASESOR"]) {
      expect(rolPuedeConsultarMora(rol)).toBeTrue();
    }
  });

  it("🔴 deja afuera al INVESTOR del portal y a lo que no trae rol", () => {
    // `authMiddleware` solo valida la firma: sin este gate, el token de un
    // cliente del portal pescaba la historia crediticia de cualquier DPI —y
    // podía colgarle créditos ajenos por `numerosCreditoConocidos`.
    for (const rol of ["INVESTOR", "", null, undefined, 1, "admin"]) {
      expect(rolPuedeConsultarMora(rol)).toBeFalse();
    }
  });
});

describe("nombre del cliente de SIFCO", () => {
  it("usa el nombre jurídico cuando existe", () => {
    expect(
      nombreClienteSifco({ NombreJuridico: "CUBE, S.A.", PrimerNombre: "Ignorado" })
    ).toBe("CUBE, S.A.");
  });

  it("arma el nombre natural saltando las partes vacías", () => {
    expect(
      nombreClienteSifco({
        PrimerNombre: "Juan",
        SegundoNombre: "  ",
        PrimeApellido: "Pérez",
        SegundoApellido: "Alvarado",
      })
    ).toBe("Juan Pérez Alvarado");
  });
});

describe("fichas del DPI", () => {
  const DPI = "3460666380101";

  it("devuelve TODAS las fichas del DPI, no solo la primera", () => {
    // El caso que dejaba pasar morosos: dos fichas del mismo DPI (natural y
    // jurídica). Con solo la primera, los créditos de la segunda nunca se
    // consultaban y un moroso salía limpio.
    const fichas = fichasDelDpi(
      [
        { CodigoCliente: 11, NumeroIdentificacion: DPI },
        { CodigoCliente: 22, NumeroIdentificacion: DPI },
      ],
      DPI
    );

    expect(fichas.map((f) => f.CodigoCliente)).toEqual([11, 22]);
  });

  it("descarta las fichas sin código de cliente", () => {
    const fichas = fichasDelDpi(
      [
        { CodigoCliente: null, NumeroIdentificacion: DPI },
        { NumeroIdentificacion: DPI },
        { CodigoCliente: 22, NumeroIdentificacion: DPI },
      ],
      DPI
    );

    expect(fichas.map((f) => f.CodigoCliente)).toEqual([22]);
  });

  it("descarta la ficha cuya identificación no es la buscada", () => {
    const fichas = fichasDelDpi(
      [
        { CodigoCliente: 11, NumeroIdentificacion: DPI },
        { CodigoCliente: 99, NumeroIdentificacion: "1111111110101" },
      ],
      DPI
    );

    expect(fichas.map((f) => f.CodigoCliente)).toEqual([11]);
  });

  it("compara normalizado: los DPI vienen con espacios y guiones", () => {
    const fichas = fichasDelDpi(
      [{ CodigoCliente: 11, NumeroIdentificacion: "3460 66638 0101" }],
      "3460-66638-0101"
    );

    expect(fichas).toHaveLength(1);
  });

  it("conserva la ficha sin identificación: el core no siempre la devuelve", () => {
    // Descartarla sería el falso negativo que este endpoint existe para evitar.
    const fichas = fichasDelDpi(
      [{ CodigoCliente: 11 }, { CodigoCliente: 22, NumeroIdentificacion: "   " }],
      DPI
    );

    expect(fichas.map((f) => f.CodigoCliente)).toEqual([11, 22]);
  });

  it("conserva la ficha cuya identificación es un placeholder sin dígitos", () => {
    // "N/A" normaliza a "" y salía clasificada como "de OTRA persona": se
    // descartaba en silencio y, siendo la única, el DPI contestaba
    // CLIENTE_NO_ENCONTRADO con la deuda sin consultar. Un placeholder no dice
    // de quién es la ficha; es el mismo caso que el campo ausente.
    const fichas = fichasDelDpi(
      [{ CodigoCliente: 11, NumeroIdentificacion: "N/A" }],
      DPI
    );

    expect(fichas.map((f) => f.CodigoCliente)).toEqual([11]);
  });

  it("el placeholder no desplaza a la ficha que sí trae el DPI: se consultan las dos", () => {
    const fichas = fichasDelDpi(
      [
        { CodigoCliente: 11, NumeroIdentificacion: "N/A" },
        { CodigoCliente: 22, NumeroIdentificacion: DPI },
      ],
      DPI
    );

    expect(fichas.map((f) => f.CodigoCliente)).toEqual([11, 22]);
  });

  it("descarta la ficha con código vacío", () => {
    // El tipo admite string, así que un "" pasaba el guard de null/undefined y
    // llegaba al lookup como `Number("")` = 0: una consulta a la ficha ajena 0.
    const fichas = fichasDelDpi(
      [
        { CodigoCliente: "", NumeroIdentificacion: DPI },
        { CodigoCliente: 22, NumeroIdentificacion: DPI },
      ],
      DPI
    );

    expect(fichas.map((f) => f.CodigoCliente)).toEqual([22]);
  });

  it("descarta la ficha cuyo código es solo espacios", () => {
    const fichas = fichasDelDpi(
      [
        { CodigoCliente: "   ", NumeroIdentificacion: DPI },
        { CodigoCliente: 22, NumeroIdentificacion: DPI },
      ],
      DPI
    );

    expect(fichas.map((f) => f.CodigoCliente)).toEqual([22]);
  });

  it("descarta la ficha con código no numérico", () => {
    // `Number("N/A")` es NaN: el lookup posterior recibe basura.
    const fichas = fichasDelDpi(
      [
        { CodigoCliente: "N/A", NumeroIdentificacion: DPI },
        { CodigoCliente: 22, NumeroIdentificacion: DPI },
      ],
      DPI
    );

    expect(fichas.map((f) => f.CodigoCliente)).toEqual([22]);
  });

  it("conserva el código numérico que viaja como string con espacios", () => {
    // El core manda el código de las dos formas; un "  22  " sí es consultable.
    const fichas = fichasDelDpi(
      [{ CodigoCliente: " 22 ", NumeroIdentificacion: DPI }],
      DPI
    );

    expect(fichas).toHaveLength(1);
  });

  it("sin ninguna ficha usable el resultado es vacío", () => {
    // Vacío sí, pero NO "cliente no encontrado": ver el describe de abajo, la
    // ficha basura deja el veredicto indeterminado.
    expect(fichasDelDpi([{ NumeroIdentificacion: DPI }], DPI)).toEqual([]);
  });
});

describe("ficha basura: indeterminado, no cliente inexistente", () => {
  const DPI = "3460666380101";

  it("ninguna ficha: el DPI no es cliente y NO es indeterminado", () => {
    expect(seleccionarFichasDelDpi([], DPI)).toEqual({
      fichas: [],
      indeterminado: false,
    });
  });

  it("todas basura: indeterminado", () => {
    // Antes esto se veía idéntico a "no existe" → CLIENTE_NO_ENCONTRADO →
    // puedeContinuar, con la deuda de esas fichas sin consultar.
    const seleccion = seleccionarFichasDelDpi(
      [
        { CodigoCliente: "N/A", NumeroIdentificacion: DPI },
        { CodigoCliente: null, NumeroIdentificacion: DPI },
      ],
      DPI
    );

    expect(seleccion.fichas).toEqual([]);
    expect(seleccion.indeterminado).toBe(true);
  });

  it("mezcla útil + basura: indeterminado aunque queden fichas consultables", () => {
    // Media lista no alcanza para firmar un "sin mora".
    const seleccion = seleccionarFichasDelDpi(
      [
        { CodigoCliente: 22, NumeroIdentificacion: DPI },
        { CodigoCliente: "", NumeroIdentificacion: DPI },
      ],
      DPI
    );

    expect(seleccion.fichas.map((f) => f.CodigoCliente)).toEqual([22]);
    expect(seleccion.indeterminado).toBe(true);
  });

  it("todas útiles: no es indeterminado", () => {
    const seleccion = seleccionarFichasDelDpi(
      [
        { CodigoCliente: 11, NumeroIdentificacion: DPI },
        { CodigoCliente: " 22 ", NumeroIdentificacion: DPI },
      ],
      DPI
    );

    expect(seleccion.fichas).toHaveLength(2);
    expect(seleccion.indeterminado).toBe(false);
  });

  it("la ficha basura de OTRA identificación no ensucia el veredicto", () => {
    // No es del DPI: dejarla fuera no le quita nada a lo que hay que mirar.
    const seleccion = seleccionarFichasDelDpi(
      [
        { CodigoCliente: 11, NumeroIdentificacion: DPI },
        { CodigoCliente: "N/A", NumeroIdentificacion: "1111111110101" },
      ],
      DPI
    );

    expect(seleccion.fichas.map((f) => f.CodigoCliente)).toEqual([11]);
    expect(seleccion.indeterminado).toBe(false);
  });

  it("la ficha basura SIN identificación cuenta como del DPI: indeterminado", () => {
    // Misma razón por la que la ficha sin identificación se conserva cuando sí
    // es consultable: el core no siempre la devuelve, y asumir que es de otro
    // sería volver al falso negativo.
    const seleccion = seleccionarFichasDelDpi([{ CodigoCliente: "  " }], DPI);

    expect(seleccion.fichas).toEqual([]);
    expect(seleccion.indeterminado).toBe(true);
  });
});

describe("veredicto sobre los créditos de TODAS las fichas", () => {
  it("un crédito de la segunda ficha en mora bloquea aunque la primera esté al día", () => {
    const veredicto = construirVeredicto([
      credito({ numeroCreditoSifco: "AAA", estado: "ACTIVO" }),
      credito({
        numeroCreditoSifco: "BBB",
        estado: "MOROSO",
        moraActiva: { monto: "1200.00", cuotasAtrasadas: 3 },
      }),
    ]);

    expect(veredicto).toEqual({
      tieneMoraActiva: true,
      puedeContinuar: false,
      motivo: "MORA_ACTIVA",
    });
  });
});
