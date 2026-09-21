import { describe, expect, test } from "bun:test";
import { buildProjectedInvestorFlow } from "./investmentProjection";

describe("buildProjectedInvestorFlow", () => {
  test("descompone la cuota sin duplicar interés ni IVA", () => {
    const result = buildProjectedInvestorFlow([
      {
        inversionista_id: 10,
        nombre: "Inversionista Ejemplo",
        tipo_reinv_efectivo: "sin_reinversion",
        monto_reinversion: "0",
        descuenta_impuestos: false,
        emite_factura: true,
        cuota: "111.20",
        interes_inversionista: "10.00",
        interes_cube: "0.00",
        iva_inversionista: "1.20",
        iva_cube: "0.00",
        cargos: "0.00",
        es_mayor_participacion: true,
        monto_aportado: "1000.00",
      },
    ]);

    expect(result).toEqual({
      porInversionista: [
        {
          inversionista_id: 10,
          nombre: "Inversionista Ejemplo",
          reinversion_capital: "0.00",
          reinversion_interes: "0.00",
          reinversion_total: "0.00",
          cash_capital: "100.00",
          cash_interes: "11.20",
          cash_total: "111.20",
          interes_bruto: "10.00",
          iva: "1.20",
          isr: "0.00",
          total: "111.20",
        },
      ],
      totales: {
        reinversion_total: "0.00",
        cash_total: "111.20",
        interes_bruto: "10.00",
        iva: "1.20",
        isr: "0.00",
        total: "111.20",
        externos: {
          reinversion_total: "0.00",
          cash_total: "111.20",
          total: "111.20",
        },
        cube: {
          reinversion_total: "0.00",
          cash_total: "0.00",
          total: "0.00",
        },
      },
    });
  });

  test("aplica ISR al interés sin factura antes de reinvertirlo", () => {
    const result = buildProjectedInvestorFlow([
      {
        inversionista_id: 20,
        nombre: "Inversionista ISR",
        tipo_reinv_efectivo: "reinversion_interes",
        monto_reinversion: "0",
        descuenta_impuestos: false,
        emite_factura: false,
        cuota: "111.20",
        interes_inversionista: "10.00",
        interes_cube: "0.00",
        iva_inversionista: "1.20",
        iva_cube: "0.00",
        cargos: "0.00",
        es_mayor_participacion: true,
        monto_aportado: "1000.00",
      },
    ]);

    expect(result.porInversionista[0]).toMatchObject({
      reinversion_capital: "0.00",
      reinversion_interes: "9.30",
      reinversion_total: "9.30",
      cash_capital: "100.00",
      cash_interes: "0.00",
      cash_total: "100.00",
      interes_bruto: "10.00",
      iva: "1.20",
      isr: "0.70",
      total: "109.30",
    });
  });

  test("distribuye las modalidades fijas entre capital e interés", () => {
    const base = {
      inversionista_id: 30,
      nombre: "Inversionista Modalidades",
      monto_reinversion: "0",
      descuenta_impuestos: false,
      emite_factura: true,
      interes_cube: "0.00",
      iva_cube: "0.00",
      cargos: "0.00",
      es_mayor_participacion: true,
      monto_aportado: "1000.00",
    };
    const result = buildProjectedInvestorFlow([
      {
        ...base,
        tipo_reinv_efectivo: "reinversion_capital",
        cuota: "111.20",
        interes_inversionista: "10.00",
        iva_inversionista: "1.20",
      },
      {
        ...base,
        tipo_reinv_efectivo: "reinversion_total",
        cuota: "55.60",
        interes_inversionista: "5.00",
        iva_inversionista: "0.60",
      },
    ]);

    expect(result.porInversionista[0]).toMatchObject({
      reinversion_capital: "150.00",
      reinversion_interes: "5.60",
      reinversion_total: "155.60",
      cash_capital: "0.00",
      cash_interes: "11.20",
      cash_total: "11.20",
      total: "166.80",
    });
  });

  test("distribuye modalidades variable y excedente una vez por inversionista", () => {
    const base = {
      nombre: "Inversionista Variable",
      monto_reinversion: "50.00",
      descuenta_impuestos: false,
      emite_factura: true,
      cuota: "111.20",
      interes_inversionista: "10.00",
      interes_cube: "0.00",
      iva_inversionista: "1.20",
      iva_cube: "0.00",
      cargos: "0.00",
      es_mayor_participacion: true,
      monto_aportado: "1000.00",
    };
    const result = buildProjectedInvestorFlow([
      {
        ...base,
        inversionista_id: 40,
        tipo_reinv_efectivo: "reinversion_variable",
      },
      {
        ...base,
        inversionista_id: 41,
        nombre: "Inversionista Excedente",
        tipo_reinv_efectivo: "reinversion_excedente",
      },
    ]);

    expect(result.porInversionista).toEqual([
      {
        inversionista_id: 41,
        nombre: "Inversionista Excedente",
        reinversion_capital: "61.20",
        reinversion_interes: "0.00",
        reinversion_total: "61.20",
        cash_capital: "50.00",
        cash_interes: "0.00",
        cash_total: "50.00",
        interes_bruto: "10.00",
        iva: "1.20",
        isr: "0.00",
        total: "111.20",
      },
      {
        inversionista_id: 40,
        nombre: "Inversionista Variable",
        reinversion_capital: "50.00",
        reinversion_interes: "0.00",
        reinversion_total: "50.00",
        cash_capital: "61.20",
        cash_interes: "0.00",
        cash_total: "61.20",
        interes_bruto: "10.00",
        iva: "1.20",
        isr: "0.00",
        total: "111.20",
      },
    ]);
  });

  test("concilia el total con los componentes publicados a centavos", () => {
    const base = {
      inversionista_id: 1,
      nombre: "Sintético",
      monto_reinversion: null,
      descuenta_impuestos: false,
      emite_factura: false,
      monto_aportado: "999999.00",
      interes_cube: "0.00",
      iva_inversionista: "0.00",
      iva_cube: "0.00",
      cargos: "0.00",
      es_mayor_participacion: false,
    };
    const result = buildProjectedInvestorFlow([
      {
        ...base,
        tipo_reinv_efectivo: "sin_reinversion",
        cuota: "100.60000030",
        interes_inversionista: "0.09000030",
      },
      {
        ...base,
        tipo_reinv_efectivo: "reinversion_capital",
        cuota: "100.80000030",
        interes_inversionista: "0.12000030",
      },
      {
        ...base,
        tipo_reinv_efectivo: "reinversion_interes",
        cuota: "101.00000030",
        interes_inversionista: "0.15000030",
      },
      {
        ...base,
        tipo_reinv_efectivo: "reinversion_total",
        cuota: "101.20000030",
        interes_inversionista: "0.18000030",
      },
    ]).porInversionista[0];

    expect(result).toMatchObject({
      reinversion_total: "202.01",
      cash_total: "201.56",
      total: "403.57",
    });
  });

  test("excluye cuotas de créditos fuera de la cartera cobrable", () => {
    const base = {
      nombre: "Sintético",
      tipo_reinv_efectivo: "sin_reinversion",
      monto_reinversion: null,
      descuenta_impuestos: false,
      emite_factura: true,
      cuota: "111.20",
      monto_aportado: "100.00",
      interes_inversionista: "10.00",
      interes_cube: "0.00",
      iva_inversionista: "1.20",
      iva_cube: "0.00",
      cargos: "0.00",
      es_mayor_participacion: false,
    };
    const result = buildProjectedInvestorFlow([
      { ...base, inversionista_id: 1, status_credito: "ACTIVO" },
      { ...base, inversionista_id: 2, status_credito: "CANCELADO" },
    ]);

    expect(result.porInversionista).toHaveLength(1);
    expect(result.totales.total).toBe("111.20");
  });

  test("excluye participaciones que empiezan después del corte", () => {
    const result = buildProjectedInvestorFlow([
      {
        inversionista_id: 1,
        nombre: "Posición futura",
        tipo_reinv_efectivo: "sin_reinversion",
        monto_reinversion: null,
        descuenta_impuestos: false,
        emite_factura: true,
        cuota: "111.20",
        monto_aportado: "100.00",
        interes_inversionista: "10.00",
        interes_cube: "0.00",
        iva_inversionista: "1.20",
        iva_cube: "0.00",
        cargos: "0.00",
        es_mayor_participacion: false,
        fecha_inicio_participacion: "2026-10-01",
        fecha_corte: "2026-09-14",
      },
    ]);

    expect(result.porInversionista).toHaveLength(0);
  });

  test("prorratea el interés del primer pago posterior a una participación reciente", () => {
    const result = buildProjectedInvestorFlow([
      {
        inversionista_id: 1,
        nombre: "Participación reciente",
        tipo_reinv_efectivo: "sin_reinversion",
        monto_reinversion: null,
        descuenta_impuestos: false,
        emite_factura: true,
        credito_id: 9,
        fecha_vencimiento: "2026-10-01",
        en_periodo: true,
        capital_credito: "100.00",
        cuota_credito: "111.20",
        porcentaje_interes: "10.00",
        porcentaje_inversionista: "100.00",
        porcentaje_cube: "0.00",
        monto_pendiente: "0.00",
        cuota: "111.20",
        monto_aportado: "100.00",
        interes_inversionista: "10.00",
        interes_cube: "0.00",
        iva_inversionista: "1.20",
        iva_cube: "0.00",
        cargos: "0.00",
        es_mayor_participacion: false,
        fecha_inicio_participacion: "2026-09-14",
        fecha_corte: "2026-09-14",
      },
    ]).porInversionista.find((row) => row.inversionista_id === 1)!;

    expect(result).toMatchObject({
      cash_capital: "100.00",
      cash_interes: "5.97",
      interes_bruto: "5.33",
      iva: "0.64",
      total: "105.97",
    });
  });

  test("prorratea solo la ampliación reciente y conserva interés completo del capital previo", () => {
    const rows = [
      {
        inversionista_id: 1,
        nombre: "Posición ampliada",
        tipo_reinv_efectivo: "sin_reinversion",
        monto_reinversion: null,
        descuenta_impuestos: false,
        emite_factura: true,
        credito_id: 9,
        fecha_vencimiento: "2026-10-01",
        en_periodo: true,
        capital_credito: "120.00",
        cuota_credito: "133.44",
        porcentaje_interes: "10.00",
        porcentaje_inversionista: "100.00",
        porcentaje_cube: "0.00",
        monto_pendiente: "0.00",
        monto_compras_mes_anterior: "20.00",
        cuota: "133.44",
        monto_aportado: "120.00",
        interes_inversionista: "12.00",
        interes_cube: "0.00",
        iva_inversionista: "1.44",
        iva_cube: "0.00",
        cargos: "0.00",
        es_mayor_participacion: false,
        fecha_inicio_participacion: "2026-09-14",
        fecha_corte: "2026-09-14",
      },
    ];

    const result = buildProjectedInvestorFlow(rows).porInversionista.find(
      (row) => row.inversionista_id === 1,
    )!;

    expect(result.interes_bruto).toBe("11.07");
  });

  test("conserva la cuota_inversionista mientras disminuye el saldo", () => {
    const base = {
      inversionista_id: 1,
      nombre: "Cuota fija",
      tipo_reinv_efectivo: "sin_reinversion",
      monto_reinversion: null,
      descuenta_impuestos: false,
      emite_factura: true,
      credito_id: 9,
      en_periodo: true,
      capital_credito: "200.00",
      cuota_credito: "100.00",
      porcentaje_interes: "10.00",
      porcentaje_inversionista: "100.00",
      porcentaje_cube: "0.00",
      monto_pendiente: "0.00",
      monto_compras_mes_anterior: "0.00",
      cuota: "100.00",
      monto_aportado: "200.00",
      interes_inversionista: "20.00",
      interes_cube: "0.00",
      iva_inversionista: "2.40",
      iva_cube: "0.00",
      cargos: "0.00",
      es_mayor_participacion: false,
      fecha_inicio_participacion: "2026-01-01",
      fecha_corte: "2026-09-14",
    };

    const result = buildProjectedInvestorFlow([
      { ...base, fecha_vencimiento: "2026-10-01" },
      { ...base, fecha_vencimiento: "2026-11-01" },
    ]).porInversionista[0];

    expect(result.cash_total).toBe("200.00");
  });

  test("no consume una compra completada en el mes de una cuota anterior", () => {
    const base = {
      inversionista_id: 1,
      nombre: "Compra nueva",
      tipo_reinv_efectivo: "sin_reinversion",
      monto_reinversion: null,
      descuenta_impuestos: false,
      emite_factura: true,
      credito_id: 9,
      capital_credito: "100.00",
      cuota_credito: "111.20",
      porcentaje_interes: "10.00",
      porcentaje_inversionista: "100.00",
      porcentaje_cube: "0.00",
      monto_pendiente: "0.00",
      cuota: "111.20",
      monto_aportado: "100.00",
      interes_inversionista: "10.00",
      interes_cube: "0.00",
      iva_inversionista: "1.20",
      iva_cube: "0.00",
      cargos: "0.00",
      es_mayor_participacion: false,
      fecha_inicio_participacion: "2026-09-14",
      fecha_corte: "2026-09-14",
    };

    const result = buildProjectedInvestorFlow([
      {
        ...base,
        fecha_vencimiento: "2026-09-20",
        en_periodo: false,
        monto_compras_mes_actual: "100.00",
        monto_compras_mes_anterior: "0.00",
      },
      {
        ...base,
        fecha_vencimiento: "2026-10-20",
        en_periodo: true,
        monto_compras_mes_actual: "0.00",
        monto_compras_mes_anterior: "100.00",
      },
    ]).porInversionista[0];

    expect(result.total).toBe("105.97");
  });

  test("asigna a CUBE el spread generado por posiciones externas", () => {
    const common = {
      tipo_reinv_efectivo: "sin_reinversion",
      monto_reinversion: null,
      descuenta_impuestos: false,
      emite_factura: true,
      credito_id: 9,
      fecha_vencimiento: "2026-10-20",
      en_periodo: true,
      capital_credito: "100.00",
      cuota_credito: "111.20",
      porcentaje_interes: "10.00",
      monto_pendiente: "0.00",
      monto_compras_mes_anterior: "0.00",
      monto_compras_mes_actual: "0.00",
      cuota: "55.60",
      monto_aportado: "50.00",
      cargos: "0.00",
      es_mayor_participacion: false,
      fecha_inicio_participacion: "2026-01-01",
      fecha_corte: "2026-09-14",
      cube_nombre: "Cube Investments S.A.",
      cube_tipo_reinv_efectivo: "sin_reinversion",
      cube_monto_reinversion: null,
      cube_descuenta_impuestos: false,
      cube_emite_factura: true,
    };
    const result = buildProjectedInvestorFlow([
      {
        ...common,
        inversionista_id: 1,
        nombre: "Externo",
        porcentaje_inversionista: "80.00",
        porcentaje_cube: "20.00",
        interes_inversionista: "4.00",
        interes_cube: "1.00",
        iva_inversionista: "0.48",
        iva_cube: "0.12",
      },
      {
        ...common,
        inversionista_id: 86,
        nombre: "Cube Investments S.A.",
        porcentaje_inversionista: "0.00",
        porcentaje_cube: "100.00",
        interes_inversionista: "0.00",
        interes_cube: "5.00",
        iva_inversionista: "0.00",
        iva_cube: "0.60",
      },
    ]);

    expect(result.totales.total).toBe("111.20");
    expect(result.totales.externos).toEqual({
      cash_total: "54.48",
      reinversion_total: "0.00",
      total: "54.48",
    });
    expect(result.totales.cube).toEqual({
      cash_total: "56.72",
      reinversion_total: "0.00",
      total: "56.72",
    });
    expect(
      result.porInversionista.find((row) => row.inversionista_id === 86),
    ).toMatchObject({
      interes_bruto: "6.00",
      iva: "0.72",
      cash_total: "56.72",
    });
  });

  test("asigna centavos de IVA con el mismo residuo exacto que PCI", () => {
    const common = {
      tipo_reinv_efectivo: "sin_reinversion",
      monto_reinversion: null,
      descuenta_impuestos: false,
      emite_factura: true,
      credito_id: 10,
      fecha_vencimiento: "2026-10-20",
      en_periodo: true,
      capital_credito: "600.00",
      cuota_credito: "623.52",
      porcentaje_interes: "3.50",
      monto_pendiente: "0.00",
      monto_compras_mes_anterior: "0.00",
      monto_compras_mes_actual: "0.00",
      cargos: "0.00",
      es_mayor_participacion: false,
      fecha_inicio_participacion: "2026-01-01",
      fecha_corte: "2026-09-14",
      cube_nombre: "Cube Investments S.A.",
      cube_tipo_reinv_efectivo: "sin_reinversion",
      cube_monto_reinversion: null,
      cube_descuenta_impuestos: false,
      cube_emite_factura: true,
    };
    const result = buildProjectedInvestorFlow([
      {
        ...common,
        inversionista_id: 1,
        nombre: "Externo A",
        cuota: "103.92",
        monto_aportado: "100.00",
        porcentaje_inversionista: "60.00",
        porcentaje_cube: "40.00",
        interes_inversionista: "2.10",
        interes_cube: "1.40",
        iva_inversionista: "0.25",
        iva_cube: "0.17",
      },
      {
        ...common,
        inversionista_id: 2,
        nombre: "Externo B",
        cuota: "207.84",
        monto_aportado: "200.00",
        porcentaje_inversionista: "60.00",
        porcentaje_cube: "40.00",
        interes_inversionista: "4.20",
        interes_cube: "2.80",
        iva_inversionista: "0.50",
        iva_cube: "0.34",
      },
      {
        ...common,
        inversionista_id: 86,
        nombre: "Cube Investments S.A.",
        cuota: "311.76",
        monto_aportado: "300.00",
        porcentaje_inversionista: "0.00",
        porcentaje_cube: "100.00",
        interes_inversionista: "0.00",
        interes_cube: "10.50",
        iva_inversionista: "0.00",
        iva_cube: "1.26",
      },
    ]).porInversionista;

    expect(result.find((row) => row.inversionista_id === 2)?.iva).toBe("0.51");
    expect(result.find((row) => row.inversionista_id === 86)?.iva).toBe("1.76");
  });

  test("separa cuotas distintas del mismo crédito aunque compartan fecha", () => {
    const rowsForDates = (dates: [string, string]): ProjectionSourceRow[] =>
      dates.flatMap((fecha_vencimiento, index) => [
        {
          inversionista_id: 1,
          nombre: "Externo",
          tipo_reinv_efectivo: "sin_reinversion",
          monto_reinversion: null,
          descuenta_impuestos: false,
          emite_factura: false,
          credito_id: 77,
          numero_cuota: index + 1,
          fecha_vencimiento,
          en_periodo: true,
          monto_aportado: "100",
          capital_credito: "200",
          cuota_credito: "100",
          porcentaje_interes: "10",
          porcentaje_inversionista: "80",
          porcentaje_cube: "20",
          monto_pendiente: "0",
          monto_compras_mes_anterior: "0",
          monto_compras_mes_actual: "0",
          cuota: "50",
          interes_inversionista: "0",
          interes_cube: "0",
          iva_inversionista: "0",
          iva_cube: "0",
          cargos: "0",
          es_mayor_participacion: true,
        },
        {
          inversionista_id: 86,
          nombre: "CUBE",
          tipo_reinv_efectivo: "sin_reinversion",
          monto_reinversion: null,
          descuenta_impuestos: false,
          emite_factura: false,
          credito_id: 77,
          numero_cuota: index + 1,
          fecha_vencimiento,
          en_periodo: true,
          monto_aportado: "100",
          capital_credito: "200",
          cuota_credito: "100",
          porcentaje_interes: "10",
          porcentaje_inversionista: "0",
          porcentaje_cube: "100",
          monto_pendiente: "0",
          monto_compras_mes_anterior: "0",
          monto_compras_mes_actual: "0",
          cuota: "50",
          interes_inversionista: "0",
          interes_cube: "0",
          iva_inversionista: "0",
          iva_cube: "0",
          cargos: "0",
          es_mayor_participacion: false,
        },
      ]);

    const distinctDates = buildProjectedInvestorFlow(
      rowsForDates(["2026-10-15", "2026-11-15"]),
    );
    const sameDate = buildProjectedInvestorFlow(
      rowsForDates(["2026-10-15", "2026-10-15"]),
    );

    expect(sameDate).toEqual(distinctDates);
  });

  test("asigna cargos según la posición precompra", () => {
    const common = {
      tipo_reinv_efectivo: "sin_reinversion",
      monto_reinversion: null,
      descuenta_impuestos: false,
      emite_factura: false,
      credito_id: 88,
      numero_cuota: 1,
      status_credito: "ACTIVO",
      fecha_vencimiento: "2026-10-15",
      en_periodo: true,
      capital_credito: "200",
      cuota_credito: "200",
      porcentaje_interes: "0",
      porcentaje_inversionista: "100",
      porcentaje_cube: "0",
      monto_compras_mes_anterior: "0",
      monto_compras_mes_actual: "0",
      interes_inversionista: "0",
      interes_cube: "0",
      iva_inversionista: "0",
      iva_cube: "0",
      cargos: "10",
    };

    const result = buildProjectedInvestorFlow([
      {
        ...common,
        inversionista_id: 1,
        nombre: "Mayor precompra",
        monto_aportado: "100",
        monto_pendiente: "20",
        cuota: "100",
        es_mayor_participacion: false,
      },
      {
        ...common,
        inversionista_id: 2,
        nombre: "Marcado incorrectamente",
        monto_aportado: "70",
        monto_pendiente: "0",
        cuota: "70",
        es_mayor_participacion: true,
      },
      {
        ...common,
        inversionista_id: 86,
        nombre: "CUBE",
        monto_aportado: "30",
        monto_pendiente: "0",
        cuota: "30",
        porcentaje_inversionista: "0",
        porcentaje_cube: "100",
        es_mayor_participacion: false,
      },
    ]);

    expect(result.totales.total).toBe("176.00");
    expect(
      result.porInversionista.find((row) => row.inversionista_id === 2)?.total,
    ).toBe("70.00");
  });

  test("traslada a CUBE el interés de una compra completada en el mes", () => {
    const common = {
      tipo_reinv_efectivo: "sin_reinversion",
      monto_reinversion: null,
      descuenta_impuestos: false,
      emite_factura: false,
      credito_id: 89,
      numero_cuota: 1,
      status_credito: "ACTIVO",
      fecha_vencimiento: "2026-10-15",
      en_periodo: true,
      capital_credito: "200",
      cuota_credito: "200",
      porcentaje_interes: "10",
      monto_pendiente: "0",
      monto_compras_mes_anterior: "0",
      interes_inversionista: "0",
      interes_cube: "0",
      iva_inversionista: "0",
      iva_cube: "0",
      cargos: "0",
      es_mayor_participacion: false,
    };
    const result = buildProjectedInvestorFlow([
      {
        ...common,
        inversionista_id: 1,
        nombre: "Comprador",
        monto_aportado: "100",
        cuota: "100",
        porcentaje_inversionista: "100",
        porcentaje_cube: "0",
        monto_compras_mes_actual: "20",
      },
      {
        ...common,
        inversionista_id: 86,
        nombre: "CUBE",
        monto_aportado: "100",
        cuota: "100",
        porcentaje_inversionista: "0",
        porcentaje_cube: "100",
        monto_compras_mes_actual: "0",
      },
    ]);

    expect(result.totales.interes_bruto).toBe("20.00");
    expect(result.totales.iva).toBe("2.40");
  });

  test("sintetiza CUBE cuando una compra del mes consume toda su posición", () => {
    const result = buildProjectedInvestorFlow([
      {
        inversionista_id: 1,
        nombre: "Comprador total",
        tipo_reinv_efectivo: "sin_reinversion",
        monto_reinversion: null,
        descuenta_impuestos: false,
        emite_factura: false,
        credito_id: 90,
        numero_cuota: 1,
        status_credito: "ACTIVO",
        fecha_vencimiento: "2026-10-15",
        en_periodo: true,
        monto_aportado: "100",
        capital_credito: "100",
        cuota_credito: "100",
        porcentaje_interes: "10",
        porcentaje_inversionista: "100",
        porcentaje_cube: "0",
        monto_pendiente: "0",
        monto_compras_mes_anterior: "0",
        monto_compras_mes_actual: "100",
        cuota: "100",
        interes_inversionista: "0",
        interes_cube: "0",
        iva_inversionista: "0",
        iva_cube: "0",
        cargos: "0",
        es_mayor_participacion: false,
        cube_nombre: "CUBE",
        cube_tipo_reinv_efectivo: "sin_reinversion",
        cube_monto_reinversion: null,
        cube_descuenta_impuestos: false,
        cube_emite_factura: false,
      },
    ]);

    expect(result.totales.interes_bruto).toBe("10.00");
    expect(result.totales.iva).toBe("1.20");
    expect(
      result.porInversionista.find((row) => row.inversionista_id === 86),
    ).toMatchObject({ interes_bruto: "10.00", iva: "1.20" });
  });

  test("no proyecta más capital que el saldo de una posición", () => {
    const base = {
      inversionista_id: 1,
      nombre: "Saldo corto",
      tipo_reinv_efectivo: "sin_reinversion",
      monto_reinversion: null,
      descuenta_impuestos: false,
      emite_factura: true,
      credito_id: 9,
      cuota: "80.00",
      monto_aportado: "100.00",
      interes_inversionista: "0.00",
      interes_cube: "0.00",
      iva_inversionista: "0.00",
      iva_cube: "0.00",
      cargos: "0.00",
      es_mayor_participacion: false,
    };
    const result = buildProjectedInvestorFlow([
      { ...base, fecha_vencimiento: "2026-10-01", en_periodo: true },
      { ...base, fecha_vencimiento: "2026-11-01", en_periodo: true },
    ]).porInversionista[0];

    expect(result.cash_capital).toBe("100.00");
  });

  test("no divide entre cero cuando el capital nominal del crédito es cero", () => {
    const result = buildProjectedInvestorFlow([
      {
        inversionista_id: 1,
        nombre: "Capital nominal cero",
        tipo_reinv_efectivo: "sin_reinversion",
        monto_reinversion: null,
        descuenta_impuestos: false,
        emite_factura: true,
        credito_id: 9,
        fecha_vencimiento: "2026-10-01",
        en_periodo: true,
        capital_credito: "0.00",
        cuota_credito: "0.00",
        porcentaje_interes: "10.00",
        porcentaje_inversionista: "100.00",
        porcentaje_cube: "0.00",
        monto_pendiente: "0.00",
        cuota: "0.00",
        monto_aportado: "100.00",
        interes_inversionista: "10.00",
        interes_cube: "0.00",
        iva_inversionista: "1.20",
        iva_cube: "0.00",
        cargos: "0.00",
        es_mayor_participacion: false,
      },
    ]).porInversionista[0];

    expect(result).toMatchObject({
      cash_capital: "0.00",
      cash_interes: "11.20",
      total: "11.20",
    });
  });

  test("resta una compra pendiente sin eliminar el capital previo", () => {
    const result = buildProjectedInvestorFlow([
      {
        inversionista_id: 1,
        nombre: "Capital previo",
        tipo_reinv_efectivo: "sin_reinversion",
        monto_reinversion: null,
        descuenta_impuestos: false,
        emite_factura: true,
        credito_id: 9,
        fecha_vencimiento: "2026-10-01",
        en_periodo: true,
        capital_credito: "100.00",
        cuota_credito: "111.20",
        porcentaje_interes: "10.00",
        porcentaje_inversionista: "100.00",
        porcentaje_cube: "0.00",
        monto_pendiente: "20.00",
        status_posicion: "pendiente_compra_cartera",
        cuota: "133.44",
        monto_aportado: "120.00",
        interes_inversionista: "12.00",
        interes_cube: "0.00",
        iva_inversionista: "1.44",
        iva_cube: "0.00",
        cargos: "0.00",
        es_mayor_participacion: false,
      },
    ]).porInversionista[0];

    expect(result).toMatchObject({
      cash_capital: "100.00",
      interes_bruto: "10.00",
      total: "111.20",
    });
  });

  test("resta capital pagado pendiente de liquidar antes de proyectar", () => {
    const result = buildProjectedInvestorFlow([
      {
        inversionista_id: 1,
        nombre: "Pago pendiente de liquidar",
        tipo_reinv_efectivo: "sin_reinversion",
        monto_reinversion: null,
        descuenta_impuestos: false,
        emite_factura: true,
        credito_id: 9,
        fecha_vencimiento: "2026-10-01",
        en_periodo: true,
        capital_credito: "100.00",
        cuota_credito: "111.20",
        porcentaje_interes: "10.00",
        porcentaje_inversionista: "100.00",
        porcentaje_cube: "0.00",
        monto_pendiente: "0.00",
        capital_pagado_pendiente_liquidar: "40.00",
        cuota: "111.20",
        monto_aportado: "100.00",
        interes_inversionista: "10.00",
        interes_cube: "0.00",
        iva_inversionista: "1.20",
        iva_cube: "0.00",
        cargos: "0.00",
        es_mayor_participacion: false,
      },
    ]).porInversionista[0];

    expect(result).toMatchObject({
      cash_capital: "60.00",
      interes_bruto: "6.00",
      total: "66.72",
    });
  });
});
