  // src/db/schema.ts
  import {
    pgTable,
    serial,
    varchar,
    integer,
    numeric,
    boolean,
    date,
    text,
    timestamp,
    pgSchema,
    pgEnum,
    uniqueIndex,
    unique,
    bigint,
    index,
  } from "drizzle-orm/pg-core";
  import { sql } from "drizzle-orm";
  export enum CategoriaUsuario {
    CV_VEHICULO_NUEVO = "CV Vehículo nuevo",
    VEHICULO = "Vehículo",
    CV_VEHICULO = "CV Vehículo",
  }
  export const userRoleEnum = pgEnum("user_role", ["ADMIN", "ASESOR","CONTA"]);
  export const customSchema = pgSchema("cartera");

  export const statusCreditoInversionistaEspejoEnum = customSchema.enum("status_credito_inversionista_espejo", [
    "pendiente_reinversion",
    "pendiente_compra_cartera",
    "completado",
    "pendiente_revision"
  ]);

  export const tipoReinversionEnum = customSchema.enum("tipo_reinversion", [
    "sin_reinversion",
    "reinversion_capital",
    "reinversion_interes",
    "reinversion_total",
    "reinversion_variable",
    "reinversion_excedente",
    "reinversion_combinada"
  ]);

  export const statusInversionistaEnum = customSchema.enum("status_inversionista", [
    "activo",
    "inactivo",
    "pendiente_devolucion",
  ]);

  export const estadoDevolucionEnum = customSchema.enum("estado_devolucion", [
    "NO_APLICA",
    "PENDIENTE_AUTORIZACION",
    "VERIFICADO",
    "RECHAZADO"
  ]);

  // 🧾 Rubros del desglose de facturación (lo que factura CUBE) para el reporte diario.
  export const rubroFacturacionEnum = customSchema.enum("rubro_facturacion", [
    "CAPITAL",
    "INTERES",
    "MEMBRESIA",
    "SEGURO",
    "GPS",
    "MORA",
    "OTROS",
    "INTERES_INVERSIONISTAS",
    "ROYALTY",
  ]);
  export const admins = customSchema.table("admins", {
    admin_id: serial("admin_id").primaryKey(),
    nombre: varchar("nombre", { length: 150 }).notNull(),
    apellido: varchar("apellido", { length: 150 }).notNull(),
    email: varchar("email", { length: 150 }).notNull().unique(),
    telefono: varchar("telefono", { length: 30 }),
    activo: boolean("activo").notNull().default(true),

    created_at: timestamp("created_at").defaultNow(),
    updated_at: timestamp("updated_at").defaultNow(),
  });
  export const platform_users = customSchema.table("platform_users", {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 150 }).notNull().unique(),
    password_hash: varchar("password_hash", { length: 255 }).notNull(), // hash, nunca plano
    role: userRoleEnum("role").notNull(),
    is_active: boolean("is_active").notNull().default(true),

    // Relaciones opcionales
    asesor_id: integer("asesor_id").references(() => asesores.asesor_id),
    admin_id: integer("admin_id").references(() => admins.admin_id),
  conta_id: integer("conta_id").references(() => conta_users.conta_id),
    created_at: timestamp("created_at").defaultNow(),
    updated_at: timestamp("updated_at").defaultNow(),
  });
  export const conta_users = customSchema.table("conta_users", {
    conta_id: serial("conta_id").primaryKey(),
    nombre: varchar("nombre", { length: 150 }).notNull(),
    email: varchar("email", { length: 150 }).notNull().unique(),
    telefono: varchar("telefono", { length: 30 }),
    activo: boolean("activo").notNull().default(true),

    created_at: timestamp("created_at").defaultNow(),
    updated_at: timestamp("updated_at").defaultNow(),
  });

  // 1. Usuarios
  // src/db/schema.ts

  export const usuarios = customSchema.table("usuarios", {
    usuario_id: serial("usuario_id").primaryKey(),
    nombre: varchar("nombre", { length: 200 }).notNull(),
    nit: varchar("nit", { length: 30 }),

    // 🔥 CAMPOS NUEVOS PARA FACTURACIÓN
    direccion: varchar("direccion", { length: 300 }),
    municipio: varchar("municipio", { length: 100 }),
    departamento: varchar("departamento", { length: 100 }),
    codigo_postal: varchar("codigo_postal", { length: 10 }).default("01001"),
    pais: varchar("pais").default("GT"),

    // Campos existentes
    categoria: varchar("categoria", { length: 100 }),
    como_se_entero: varchar("como_se_entero", { length: 100 }),
    saldo_a_favor: numeric("saldo_a_favor", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
  });
  export enum StatusCredit {
    ACTIVO = "ACTIVO",
    CANCELADO = "CANCELADO",
    INCOBRABLE = "INCOBRABLE",
    PENDIENTE_CANCELACION = "PENDIENTE_CANCELACION",
    MOROSO = "MOROSO",
    EN_CONVENIO = "EN_CONVENIO",
    CAIDO = "CAIDO",
  }
  // 2. Créditos

  export const creditos = customSchema.table("creditos", {
    credito_id: serial("credito_id").primaryKey(),
    usuario_id: integer("usuario_id").notNull(),
    fecha_creacion: timestamp("fecha_creacion", { withTimezone: true })
      .notNull()
      .defaultNow(),
    numero_credito_sifco: varchar("numero_credito_sifco", { length: 40 })
      .notNull()
      .unique(),

    capital: numeric("capital", { precision: 18, scale: 2 }).notNull(),
    porcentaje_interes: numeric("porcentaje_interes", {
      precision: 5,
      scale: 2,
    }).notNull(),
    deudatotal: numeric("deudatotal", { precision: 18, scale: 2 }).notNull(),
    cuota_interes: numeric("cuota_interes", {
      precision: 18,
      scale: 2,
    }).notNull(),
    cuota: numeric("cuota", { precision: 18, scale: 2 }).notNull(),
    iva_12: numeric("iva_12", { precision: 18, scale: 2 }).notNull(),
    seguro_10_cuotas: numeric("seguro_10_cuotas", {
      precision: 18,
      scale: 2,
    }).notNull(),
    gps: numeric("gps", { precision: 18, scale: 2 }).notNull(),
    observaciones: text("observaciones").notNull(),
    no_poliza: varchar("no_poliza").notNull(),
    como_se_entero: varchar("como_se_entero", { length: 100 }).notNull(),
    asesor_id: integer("asesor_id")
      .notNull()
      .references(() => asesores.asesor_id),
    plazo: integer("plazo").notNull(),

    membresias_pago: numeric("membresias_pago", {
      precision: 18,
      scale: 2,
    }).notNull(),

    membresias: numeric("membresias", { precision: 18, scale: 2 }).notNull(),

    formato_credito: varchar("formato_credito", { length: 50 }).notNull(),

    porcentaje_royalti: numeric("porcentaje_royalti", {
      precision: 18,
      scale: 2,
    }).notNull(),
    tipoCredito: varchar("tipo_credito", { length: 100 }).notNull(),
    royalti: numeric("royalti", {
      precision: 18,
      scale: 2,
    }).notNull(),

    statusCredit: text("statusCredit", {
      enum: ["ACTIVO", "CANCELADO", "INCOBRABLE", "PENDIENTE_CANCELACION","MOROSO", "EN_CONVENIO", "CAIDO"],
    })
      .notNull()
      .default(StatusCredit.ACTIVO),
    otros: numeric("otros", { precision: 18, scale: 2 }).notNull().default("0"), // Otros cargos o pagos adicionales
    permite_abono_capital: boolean("permite_abono_capital").notNull().default(false),
    estado_devolucion: estadoDevolucionEnum("estado_devolucion").notNull().default("NO_APLICA"),
    is_vehiculo_propio: boolean("is_vehiculo_propio").notNull().default(false), // true si el vehículo es propiedad de Cash In
    bandera_reinversion: boolean("bandera_reinversion").notNull().default(false),
    // true = crédito solo-interés: la cuota cubre interés + IVA + seguro + GPS +
    // membresía, sin amortizar capital. El capital se paga vía abonos/pago final.
    no_amortiza_capital: boolean("no_amortiza_capital").notNull().default(false),
  });
  export const historial_devolucion_credito = customSchema.table("historial_devolucion_credito", {
    id: serial("id").primaryKey(),
    credito_id: integer("credito_id")
      .notNull()
      .references(() => creditos.credito_id, { onDelete: "cascade" }),
    usuario_id: integer("usuario_id")
      .notNull()
      .references(() => platform_users.id, { onDelete: "set null" }),
    estado_anterior: estadoDevolucionEnum("estado_anterior").notNull(),
    estado_nuevo: estadoDevolucionEnum("estado_nuevo").notNull(),
    motivo: text("motivo"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => ({
    idxCreditoCreated: index("idx_historial_credito_created").on(table.credito_id, table.created_at),
  }));

  export const cuotas_credito = customSchema.table("cuotas_credito", {
    cuota_id: serial("cuota_id").primaryKey(),
    credito_id: integer("credito_id")
      .references(() => creditos.credito_id)
      .notNull(),
    numero_cuota: integer("numero_cuota").notNull(), // Ej: 1, 2, 3...
    fecha_vencimiento: date("fecha_vencimiento").notNull(),
    pagado: boolean("pagado").default(false), // 👈 Si el cliente ya pagó esta cuota

    // 👇 NUEVO - Para control de liquidación a inversionistas
    liquidado_inversionistas: boolean("liquidado_inversionistas").default(false).notNull(), // 👈 Si ya se liquidó a TODOS los inversionistas
    fecha_liquidacion_inversionistas: timestamp("fecha_liquidacion_inversionistas"), // 👈 Cuándo se liquidó

    createdAt: timestamp("createdat").defaultNow(),
  });
  // 📊 Cierre mensual de cartera — foto del estado por cada statusCredit.
  //    El job corre el día 5 de cada mes y `periodo` apunta al mes anterior (el que se cierra).
  //    `capital_total` = suma del campo capital (monto colocado) de los créditos en ese estado.
  //    Las columnas de mora reflejan el atraso ACTUAL al momento de generar la foto.
  export const cierre_mensual = customSchema.table(
    "cierre_mensual",
    {
      id: serial("id").primaryKey(),
      periodo: date("periodo").notNull(), // Primer día del mes cerrado, ej. 2026-05-01 = cierre de mayo
      status_credit: text("status_credit").notNull(),
      cantidad_creditos: integer("cantidad_creditos").notNull().default(0),
      capital_total: numeric("capital_total", { precision: 18, scale: 2 })
        .notNull()
        .default("0"),
      creditos_con_mora: integer("creditos_con_mora").notNull().default(0),
      capital_en_mora: numeric("capital_en_mora", { precision: 18, scale: 2 })
        .notNull()
        .default("0"),
      created_at: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table) => ({
      uqPeriodoStatus: uniqueIndex("uq_cierre_mensual_periodo_status").on(
        table.periodo,
        table.status_credit
      ),
    })
  );

  // 📊 Aging de mora — foto por periodo agrupando los créditos morosos por cuotas
  //    atrasadas. Buckets: 30 (1 cuota), 60 (2), 90 (3), 120 (4 o más). Una fila por
  //    (periodo, bucket). Se llena junto con cierre_mensual (mismo filtro de fecha).
  export const cierre_mora_aging = customSchema.table(
    "cierre_mora_aging",
    {
      id: serial("id").primaryKey(),
      periodo: date("periodo").notNull(), // primer día del mes cerrado, ej. 2026-06-01
      bucket: text("bucket").notNull(), // '30' | '60' | '90' | '120'
      cuotas_min: integer("cuotas_min").notNull(), // 1 | 2 | 3 | 4 (mínimo de cuotas atrasadas del bucket)
      cantidad_creditos: integer("cantidad_creditos").notNull().default(0),
      monto_mora: numeric("monto_mora", { precision: 18, scale: 2 })
        .notNull()
        .default("0"),
      created_at: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table) => ({
      uqPeriodoBucket: uniqueIndex("uq_cierre_mora_aging_periodo_bucket").on(
        table.periodo,
        table.bucket
      ),
    })
  );

  export const moras_credito = customSchema.table("moras_credito", {
    mora_id: serial("mora_id").primaryKey(),
    credito_id: integer("credito_id")
      .notNull()
      .references(() => creditos.credito_id, { onDelete: "cascade" }),
    activa: boolean("activa").notNull().default(true),
    porcentaje_mora: numeric("porcentaje_mora", { precision: 5, scale: 2 })
      .notNull()
      .default("1.12"),
    monto_mora: numeric("monto_mora", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    cuotas_atrasadas: integer("cuotas_atrasadas").notNull().default(0),

    created_at: timestamp("created_at").defaultNow(),
    updated_at: timestamp("updated_at").defaultNow(),
  });
  export const moras_condonaciones = customSchema.table("moras_condonaciones", {
    condonacion_id: serial("condonacion_id").primaryKey(),
    credito_id: integer("credito_id")
      .notNull()
      .references(() => creditos.credito_id, { onDelete: "cascade" }),
    mora_id: integer("mora_id")
      .notNull()
      .references(() => moras_credito.mora_id, { onDelete: "cascade" }),
    motivo: text("motivo").notNull(), // reason for condonation
    montoCondonacion: numeric("monto_condonacion", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    usuario_id: integer("usuario_id")
      .notNull()
      .references(() => platform_users.id, { onDelete: "cascade" }),
    fecha: timestamp("fecha").defaultNow().notNull(),
  });

  export const moraEventoTipoEnum = customSchema.enum("mora_evento_tipo", [
    "CREACION",
    "RECALCULO",
    "INCREMENTO",
    "DECREMENTO",
    "CONDONACION",
    "DESACTIVACION",
  ]);

  export const moraEventoOrigenEnum = customSchema.enum("mora_evento_origen", [
    "PROCESO_AUTO",
    "API_MANUAL",
    "CONDONACION_INDIVIDUAL",
    "CONDONACION_MASIVA",
  ]);

  export const moras_historial = customSchema.table("moras_historial", {
    historial_id: serial("historial_id").primaryKey(),
    credito_id: integer("credito_id")
      .notNull()
      .references(() => creditos.credito_id, { onDelete: "cascade" }),
    mora_id: integer("mora_id")
      .references(() => moras_credito.mora_id, { onDelete: "set null" }),
    tipo_evento: moraEventoTipoEnum("tipo_evento").notNull(),
    origen: moraEventoOrigenEnum("origen").notNull(),
    monto_anterior: numeric("monto_anterior", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    monto_nuevo: numeric("monto_nuevo", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    cuotas_atrasadas_anterior: integer("cuotas_atrasadas_anterior").notNull().default(0),
    cuotas_atrasadas_nuevas: integer("cuotas_atrasadas_nuevas").notNull().default(0),
    capital_credito: numeric("capital_credito", { precision: 18, scale: 2 }),
    porcentaje_mora: numeric("porcentaje_mora", { precision: 5, scale: 4 }),
    usuario_id: integer("usuario_id")
      .references(() => platform_users.id, { onDelete: "set null" }),
    motivo: text("motivo"),
    fecha: timestamp("fecha").defaultNow().notNull(),
  }, (table) => [
    index("moras_historial_credito_idx").on(table.credito_id),
    index("moras_historial_fecha_idx").on(table.fecha),
  ]);

  export const creditos_rubros_otros = customSchema.table("creditos_rubros_otros", {
    id: serial("id").primaryKey(),
    credito_id: integer("credito_id")
      .notNull()
      .references(() => creditos.credito_id, { onDelete: "cascade" }),
    nombre_rubro: varchar("nombre_rubro", { length: 100 }).notNull(),
    monto: numeric("monto", { precision: 18, scale: 2 }).notNull().default("0"),
  });

  // 3. Pagos de crédito
  export const origenPagoEnum = pgEnum('origen_pago', [
    'transferencia',
    'cheque',
    'boleta',
  ]);

  export const paymentValidationStatus = pgEnum('payment_validation_status', [
    'no_required',    // No necesita validación (pagos normales/automáticos)
    'pending',        // Pendiente de validación
    'validated',        // Validado
    'capital',          // Abono directo a capital REGISTRADO (sin aplicar)
    'capital_validated',// Abono directo a capital YA APLICADO (no es pago de cuota)
    'reset'
  ]);

  export const pagos_credito = customSchema.table("pagos_credito", {
    pago_id: serial("pago_id").primaryKey(),
    credito_id: integer("credito_id").references(() => creditos.credito_id), //inpujt
    cuota: numeric("cuota").notNull(), //esto viene del credito
    cuota_interes: numeric("cuota_interes").notNull(), //esto viene del credito
    cuota_id: integer("cuota_id")
      .references(() => cuotas_credito.cuota_id),
    fecha_pago: timestamp("fecha_pago").defaultNow(), //esto viene del credito
    abono_capital: numeric("abono_capital", { precision: 18, scale: 2 }), //aca abonamos a capital solo si el monto de la cuota que viene del credito es igual al monto de la boleta y se van a restar todos los abonos

    abono_interes: numeric("abono_interes", { precision: 18, scale: 2 }), // aca jala el interes del credito si ? pero solo si  el monto de la boleta  es igual al de la cuota
    abono_iva_12: numeric("abono_iva_12", { precision: 18, scale: 2 }), //aca el iva_12 del capital solo si el monto de la boleta es igual al de la cuota
    abono_interes_ci: numeric("abono_interes_ci", { precision: 18, scale: 2 }), //viene del creditosolo si el monto de la boleta es igual al de la cuota
    abono_iva_ci: numeric("abono_iva_ci", { precision: 18, scale: 2 }), //viene del credito solo si el monto de la boleta es igual al de la cuota
    abono_seguro: numeric("abono_seguro", { precision: 18, scale: 2 }), // el seguro viene del credito solo si el monto de la boleta es igual al de la cuota
    abono_gps: numeric("abono_gps", { precision: 18, scale: 2 }), // el gps viene del credito solo si el monto de la boleta es igual al de la cuota
    pago_del_mes: numeric("pago_del_mes", { precision: 18, scale: 2 }), // la sumatoria de todos los abonos

    llamada: varchar("llamada", { length: 100 }), // ""

    monto_boleta: numeric("monto_boleta", { precision: 18, scale: 2 }), // esto si viene del input
    fecha_vencimiento: date("fecha_vencimiento").defaultNow(), // viene del credito

    renuevo_o_nuevo: varchar("renuevo_o_nuevo", { length: 50 }), //input

    capital_restante: numeric("capital_restante", { precision: 18, scale: 2 }), //capital menos la cuota si ? pero solo solo si el monto de la boleta es igual al de la cuota
    interes_restante: numeric("interes_restante", { precision: 18, scale: 2 }), //aca lo que viene del credito cuota_interes menos abono_interes
    iva_12_restante: numeric("iva_12_restante", { precision: 18, scale: 2 }), //aca lo que viene del credito si iva 12  menos  abono_iva12
    seguro_restante: numeric("seguro_restante", { precision: 18, scale: 2 }), //aca lo que viene del credito seguro menos abono_seguro
    gps_restante: numeric("gps_restante", { precision: 18, scale: 2 }), //aca lo que viene del credito gps menos abono_gps
    total_restante: numeric("total_restante", { precision: 18, scale: 2 }), //deuda de lo que viene del credito menos la suma del pago del mes

    membresias: numeric("membresias"), // se jala del credito
    membresias_pago: numeric("membresias_pago"), // se jala del credito

    membresias_mes: numeric("membresias_mes"), // se jala del credito

    otros: text("otros"), //input
    mora: numeric("mora", { precision: 18, scale: 2 }), //input
    monto_boleta_cuota: numeric("monto_boleta_cuota", {
      //input
      precision: 18,
      scale: 2,
    }),
    seguro_total: numeric("seguro_total", { precision: 18, scale: 2 }), //viene del credito

    pagado: boolean("pagado").default(false), // true solo si el monto de la boleta es igual al de la cuota
    facturacion: varchar("facturacion").default("si"), // hay que ir a ver el inversionista del prestamo para ver si emite factura o no
    mes_pagado: varchar("mes_pagado", { length: 20 }), // mes actual que se esta efectuando el pago
    seguro_facturado: numeric("seguro_facturado", { precision: 18, scale: 2 }), //viene del credito
    gps_facturado: numeric("gps_facturado", { precision: 18, scale: 2 }), //viene del credito
    reserva: numeric("reserva", { precision: 18, scale: 2 }), //seguro + 600
    observaciones: text("observaciones"), //input

    paymentFalse: boolean("paymentFalse").notNull().default(false), // indica si el pago es falso
    validationStatus: paymentValidationStatus("validation_status")
    .notNull()
    .default('no_required'),
    createdAt: timestamp("createdat").defaultNow(),
      banco_id: integer("banco_id").references(() => bancos.banco_id), // 👈 OPCIONAL
    numeroAutorizacion: varchar("numeroautorizacion", { length: 100 }),
    registerBy:varchar("registerby",{length:150}).notNull(),
      cuenta_empresa_id: integer("cuenta_empresa_id")
      .references(() => cuentasEmpresa.cuentaId), //
    pagoConvenio :numeric("pago_convenio",{precision:18,scale:2}).notNull(),

    fecha_boleta: date("fecha_boleta"), // Fecha del pago en la boleta
    monto_aplicado: numeric("monto_aplicado", { precision: 18, scale: 2 }).notNull(),
    fecha_aplicado: timestamp("fecha_aplicado"), // Fecha en que se aplicó el pago al crédito
    origen_pago: origenPagoEnum("origen_pago"),
  });
  export const boletas = customSchema.table("boletas", {
    id: serial("id").primaryKey(),
    pago_id: integer("pago_id")
      .notNull()
      .references(() => pagos_credito.pago_id), // Foreign Key
    url_boleta: varchar("url_boleta", { length: 255 }).notNull(), // URL imagen
    created_at: timestamp("created_at").defaultNow(), // opcional, para seguimiento
  });

  export const creditos_inversionistas = customSchema.table(
    "creditos_inversionistas",
    {
      id: serial("id").primaryKey(),
      cuota_inversionista: numeric("cuota_inversionista", { precision: 18, scale: 2 }).notNull(),
      credito_id: integer("credito_id").notNull().references(() => creditos.credito_id),
      inversionista_id: integer("inversionista_id").notNull().references(() => inversionistas.inversionista_id),
      porcentaje_participacion_inversionista: numeric("porcentaje_participacion_inversionista").notNull(),
      monto_aportado: numeric("monto_aportado", { precision: 18, scale: 8 }).notNull(),
      porcentaje_cash_in: numeric("porcentaje_cash_in").notNull().default("0"),
      iva_inversionista: numeric("iva_inversionista", { precision: 18, scale: 2 }).notNull().default("0"),
      iva_cash_in: numeric("iva_cash_in", { precision: 18 }).notNull().default("0"),
      fecha_creacion: timestamp("fecha_creacion", { withTimezone: true }).notNull().$default(() => new Date()),
      fecha_inicio_participacion: date("fecha_inicio_participacion").notNull().default("2025-12-01"),
      monto_inversionista: numeric("monto_inversionista", { precision: 18, scale: 2 }).notNull().default("0"),
      monto_cash_in: numeric("monto_cash_in", { precision: 18, scale: 2 }).notNull(),
    },
    (t) => ({
      uxCreditoInv: uniqueIndex("ux_credito_inversionista").on(t.credito_id, t.inversionista_id),
    })
  );
  export const creditos_inversionistas_espejo = customSchema.table(
    "creditos_inversionistas_espejo",
    {
      id: serial("id").primaryKey(),
      credito_id: integer("credito_id").notNull().references(() => creditos.credito_id),
      inversionista_id: integer("inversionista_id").notNull().references(() => inversionistas.inversionista_id),
      cuota_inversionista: numeric("cuota_inversionista", { precision: 18, scale: 2 }).notNull(),
      porcentaje_participacion_inversionista: numeric("porcentaje_participacion_inversionista").notNull(),
      monto_aportado: numeric("monto_aportado", { precision: 18, scale: 8 }).notNull(),
      porcentaje_cash_in: numeric("porcentaje_cash_in").notNull().default("0"),
      monto_inversionista: numeric("monto_inversionista", { precision: 18, scale: 2 }).notNull().default("0"),
      monto_cash_in: numeric("monto_cash_in", { precision: 18, scale: 2 }).notNull().default("0"),
      iva_inversionista: numeric("iva_inversionista", { precision: 18, scale: 2 }).notNull().default("0"),
      iva_cash_in: numeric("iva_cash_in", { precision: 18, scale: 2 }).notNull().default("0"),
      fecha_creacion: timestamp("fecha_creacion", { withTimezone: true }).notNull().$default(() => new Date()),
      fecha_inicio_participacion: date("fecha_inicio_participacion").notNull().default("2025-12-01"),
      updated_at: timestamp("updated_at").defaultNow(),
      tipo_reinversion: tipoReinversionEnum("tipo_reinversion"),
      status: statusCreditoInversionistaEspejoEnum("status").notNull().default("completado"),
      aceptada_at: timestamp("aceptada_at", { withTimezone: true }),
      aceptada_por: text("aceptada_por"),
      compra_cartera_extendida_at: timestamp("compra_cartera_extendida_at", { withTimezone: true }),
    },
    (t) => ({
      uxCreditoInvEspejo: uniqueIndex("ux_credito_inversionista_espejo").on(t.credito_id, t.inversionista_id),
    })
  );

  // ====================================================================
  // compras_credito_inversionista
  // ====================================================================
  // Registro de cada operación (compra_cartera o reinversion) que entra
  // sobre un crédito para un inversionista. Guarda SOLO el monto nuevo
  // aportado en esa operación (no la suma acumulada en el padre/espejo).
  //
  // Se usa para que el correo de aceptación de compra/reinversión pueda
  // reportar el monto real ingresado en la operación, en vez de leer el
  // monto_aportado del espejo (que ya incluye lo que el inversionista
  // tenía antes en el crédito).
  // ====================================================================
  export const compras_credito_inversionista = customSchema.table(
    "compras_credito_inversionista",
    {
      id: serial("id").primaryKey(),
      credito_id: integer("credito_id").notNull().references(() => creditos.credito_id),
      inversionista_id: integer("inversionista_id").notNull().references(() => inversionistas.inversionista_id),
      monto_aportado: numeric("monto_aportado", { precision: 18, scale: 8 }).notNull(),
      tipo_operacion: varchar("tipo_operacion", { length: 30 }).notNull(),
      tipo_reinversion: tipoReinversionEnum("tipo_reinversion"),
      status: statusCreditoInversionistaEspejoEnum("status").notNull(),
      pendiente_facturar: boolean("pendiente_facturar").notNull().default(false),
      fecha_completada: timestamp("fecha_completada", { withTimezone: true }),
      fecha: timestamp("fecha", { withTimezone: true }).notNull().$default(() => new Date()),
      created_at: timestamp("created_at", { withTimezone: true }).notNull().$default(() => new Date()),
      updated_at: timestamp("updated_at", { withTimezone: true }),
    },
    (t) => ({
      ixStatus: index("ix_compras_credito_inv_status").on(t.status),
      ixCreditoInv: index("ix_compras_credito_inv_credito_inv").on(t.credito_id, t.inversionista_id),
    })
  );

  export const liquidacion_locks = customSchema.table("liquidacion_locks", {
    id: serial("id").primaryKey(),
    inversionista_id: integer("inversionista_id"),
    estado: varchar("estado", { length: 20 }).notNull().default("EN_PROCESO"),
    started_at: timestamp("started_at").defaultNow(),
    finished_at: timestamp("finished_at"),
    error: text("error"),
  });

  export const credit_cancelations = customSchema.table("credit_cancelations", {
    id: serial("id").primaryKey(),
    credit_id: integer("credit_id")
      .notNull()
      .references(() => creditos.credito_id, { onDelete: "cascade" }),
    motivo: text("motivo").notNull(), // Motivo de cancelación
    observaciones: text("observaciones"),
    fecha_cancelacion: timestamp("fecha_cancelacion").defaultNow(),
    monto_cancelacion: numeric("monto_cancelacion", {
      precision: 18,
      scale: 2,
    }).notNull(), // Monto total del crédito al momento de la cancelación
    activo: boolean("activo").notNull().default(false), // Si la cancelación está activa
    traspaso: numeric("traspaso", { precision: 18, scale: 2 }).default("0"),
    garantia_mobiliaria: numeric("garantia_mobiliaria", { precision: 18, scale: 2 }).default("0"),
    otros: numeric("otros", { precision: 18, scale: 2 }).default("0"),
    cuotas_atrasadas: integer("cuotas_atrasadas").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true }).default(sql`NOW() AT TIME ZONE 'America/Guatemala'`),
  });

  export const bad_debts = customSchema.table("bad_debts", {
    id: serial("id").primaryKey(),
    credit_id: integer("credit_id")
      .notNull()
      .references(() => creditos.credito_id, { onDelete: "cascade" }),
    motivo: text("motivo").notNull(), // Motivo de que el crédito se considera incobrable
    observaciones: text("observaciones"),
    fecha_registro: timestamp("fecha_registro").defaultNow(),
    monto_incobrable: numeric("monto_incobrable", {
      precision: 18,
      scale: 2,
    }).notNull(),
  });

  export const creditos_caidos = customSchema.table("creditos_caidos", {
    id: serial("id").primaryKey(),
    credit_id: integer("credit_id")
      .notNull()
      .references(() => creditos.credito_id, { onDelete: "cascade" }),
    motivo: text("motivo").notNull(),
    observaciones: text("observaciones"),
    fecha_caida: timestamp("fecha_caida", { withTimezone: true }).default(sql`NOW() AT TIME ZONE 'America/Guatemala'`),
    created_at: timestamp("created_at", { withTimezone: true }).default(sql`NOW() AT TIME ZONE 'America/Guatemala'`),
  });

  export const montos_adicionales = customSchema.table("montos_adicionales", {
    id: serial("id").primaryKey(),
    credit_id: integer("credit_id")
      .notNull()
      .references(() => creditos.credito_id, { onDelete: "cascade" }),

    concepto: varchar("concepto", { length: 100 }).notNull(), // Tipo de cargo adicional
    monto: numeric("monto", { precision: 18, scale: 2 }).notNull(),
    fecha_registro: timestamp("fecha_registro").defaultNow(),
  });
  export const estadoLiquidacionEnum = pgEnum("estado_liquidacion", [
    "NO_LIQUIDADO",
    "POR_LIQUIDAR",
    "LIQUIDADO",
  ]);
  export const pagos_credito_inversionistas = customSchema.table(
    "pagos_credito_inversionistas",
    {
      id: serial("id").primaryKey(),
      pago_id: integer("pago_id")
        .notNull()
        .references(() => pagos_credito.pago_id),
      inversionista_id: integer("inversionista_id")
        .notNull()
        .references(() => inversionistas.inversionista_id),
      credito_id: integer("credito_id")
        .notNull()
        .references(() => creditos.credito_id),

      abono_capital: numeric("abono_capital", {
        precision: 18,
        scale: 2,
      }).notNull(),
      abono_interes: numeric("abono_interes", {
        precision: 18,
        scale: 2,
      }).notNull(),
      abono_iva_12: numeric("abono_iva_12", {
        precision: 18,
        scale: 2,
      }).notNull(),

      porcentaje_participacion: numeric("porcentaje_participacion", {
        precision: 18,
        scale: 10,
      }).notNull(),

      fecha_pago: timestamp("fecha_pago", { withTimezone: true })
        .notNull()
        .$default(() => new Date()),
      estado_liquidacion: estadoLiquidacionEnum("estado_liquidacion")
        .notNull()
        .default("NO_LIQUIDADO"),
      cuota: numeric("cuota", { precision: 18, scale: 2 }).notNull(),

      // 🆕 ENLACE A LIQUIDACIÓN
      liquidacion_id: integer("liquidacion_id").references(
        () => liquidaciones.liquidacion_id,
        { onDelete: "set null" } // Si se borra la liquidación, el campo queda en null
      ),
    },
    (table) => ({
      uniquePagoInversionista: unique("unique_pago_inversionista").on(
        table.pago_id,
        table.inversionista_id
      ),
      // 🆕 Índice para búsquedas por liquidación
      liquidacionIdx: index("idx_pagos_liquidacion").on(table.liquidacion_id),
    })
  );

  export const pagos_credito_inversionistas_espejo = customSchema.table(
    "pagos_credito_inversionistas_espejo",
    {
      id: serial("id").primaryKey(),
      pago_id: integer("pago_id")
        .references(() => pagos_credito.pago_id, { onDelete: "set null" }),
      inversionista_id: integer("inversionista_id")
        .notNull()
        .references(() => inversionistas.inversionista_id, { onDelete: "restrict" }),
      credito_id: integer("credito_id")
        .notNull()
        .references(() => creditos.credito_id, { onDelete: "restrict" }),

      abono_capital: numeric("abono_capital", {
        precision: 18,
        scale: 10,
      }).notNull(),
      abono_interes: numeric("abono_interes", {
        precision: 18,
        scale: 10,
      }).notNull(),
      abono_iva_12: numeric("abono_iva_12", {
        precision: 18,
        scale: 2,
      }).notNull(),

      porcentaje_participacion: numeric("porcentaje_participacion", {
        precision: 18,
        scale: 10,
      }).notNull(),

      fecha_pago: timestamp("fecha_pago", { withTimezone: true })
        .notNull()
        .$default(() => new Date()),
      estado_liquidacion: estadoLiquidacionEnum("estado_liquidacion")
        .notNull()
        .default("NO_LIQUIDADO"),
      cuota: numeric("cuota", { precision: 18, scale: 2 }).notNull(),

      // Desglose del interés/IVA cuando hay compras en el mes anterior.
      // _sin_compras: parte que el inversionista ya tenía → interés mensual completo.
      // _con_compras: parte aportada por compras del mes → interés proporcional.
      // abono_interes / abono_iva_12 siguen siendo la suma de ambos.
      abono_interes_sin_compras: numeric("abono_interes_sin_compras", {
        precision: 18,
        scale: 10,
      }),
      abono_interes_con_compras: numeric("abono_interes_con_compras", {
        precision: 18,
        scale: 10,
      }),
      abono_iva_12_sin_compras: numeric("abono_iva_12_sin_compras", {
        precision: 18,
        scale: 2,
      }),
      abono_iva_12_con_compras: numeric("abono_iva_12_con_compras", {
        precision: 18,
        scale: 2,
      }),

      // FK al abono a capital asociado (nullable)
      abono_capital_id: integer("abono_capital_id").references(
        () => abonos_capital.abono_id,
        { onDelete: "set null" }
      ),

      // 🆕 ENLACE A LIQUIDACIÓN
      liquidacion_id: integer("liquidacion_id").references(
        () => liquidaciones.liquidacion_id,
        { onDelete: "set null" } // Si se borra la liquidación, el campo queda en null
      ),

      updated_at: timestamp("updated_at").defaultNow(),
    },
    (table) => ({
      // 🆕 Índice para búsquedas por liquidación
      liquidacionIdxEspejo: index("idx_pagos_liquidacion_espejo").on(
        table.liquidacion_id
      ),
    })
  );
  export const bancos = customSchema.table('bancos', {
    banco_id: serial('banco_id').primaryKey(),
    nombre: varchar('nombre', { length: 100 }).notNull().unique(),
    id_banco_transferencia: varchar('id_banco_transferencia', { length: 50 }).unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  });
  export const bancoEnum = pgEnum("banco_enum", [
    "GyT",
    "BAM",
    "BI",
    "BANRURAL",
    "PROMERICA",
    "BANTRAB",
    "BAC",
    "NEXA",
    "INDUSTRIAL",
    "INTERBANCO",
    // si deseas, también puedes incluir casos especiales como:
    "INTERBANCO/RICHARD",
    "BI/MENFER S.A.",
  ]);

  export const tipoCuentaEnum = pgEnum("tipo_cuenta_enum", [
    "AHORRO",
    "AHORRO Q",
    "AHORROS",
    "AHORRO $",
    "MONETARIA",
    "MONETARIA Q",
    "MONETARIA $",
    "Capital"
  ]);



  export const tipoMonedaEnum = customSchema.enum("tipo_moneda", ["quetzales", "dolares"]);


  export const inversionistas = customSchema.table("inversionistas", {
    inversionista_id: serial("inversionista_id").primaryKey(),
    nombre: varchar("nombre", { length: 200 }).notNull().unique(),
    dpi: bigint("dpi", { mode: "number" }).unique(),
    email: varchar("email", { length: 255 }),
    emite_factura: boolean("emite_factura").notNull(),
    tipo_reinversion: tipoReinversionEnum("tipo_reinversion")
      .notNull()
      .default("sin_reinversion"),
    // 🔥 CAMBIO: ahora es FK a la tabla bancos
    banco_id: integer("banco_id").references(() => bancos.banco_id),
    tipo_cuenta: tipoCuentaEnum("tipo_cuenta"),
    numero_cuenta: varchar("numero_cuenta", { length: 100 }),
    moneda: tipoMonedaEnum("moneda").notNull().default("quetzales"),
    permite_distribucion: boolean("permite_distribucion").notNull().default(false),
    monto_reinversion: numeric("monto_reinversion", { precision: 18, scale: 2 }),
    saldo_reinversion: numeric("saldo_reinversion", { precision: 18, scale: 2 }).notNull().default("0"),
    dpi_rep_legal: varchar("dpi_rep_legal", { length: 20 }),
    celular: varchar("celular", { length: 100 }),
    status: statusInversionistaEnum("status").notNull().default("activo"),
  });

  export const cuentas_extra_inversionista = customSchema.table(
    "cuentas_extra_inversionista",
    {
      cuenta_extra_id: serial("cuenta_extra_id").primaryKey(),
      inversionista_id: integer("inversionista_id")
        .notNull()
        .references(() => inversionistas.inversionista_id, { onDelete: "cascade" }),
      banco_id: integer("banco_id")
        .notNull()
        .references(() => bancos.banco_id),
      tipo_cuenta: tipoCuentaEnum("tipo_cuenta").notNull(),
      numero_cuenta: varchar("numero_cuenta", { length: 100 }).notNull(),
      moneda: tipoMonedaEnum("moneda").notNull().default("quetzales"),
      motivo_cuenta: varchar("motivo_cuenta", { length: 255 }).notNull(),
    },
    (t) => ({
      inversionistaIdx: index("idx_cuentas_extra_inv_inversionista").on(t.inversionista_id),
      uxCuentaExtra: uniqueIndex("ux_cuentas_extra_inv_numero").on(
        t.inversionista_id,
        t.banco_id,
        t.numero_cuenta
      ),
    })
  );

  export const reinversiones = customSchema.table("reinversiones", {
    reinversion_id: serial("reinversion_id").primaryKey(),
    inversionista_id: integer("inversionista_id")
      .notNull()
      .references(() => inversionistas.inversionista_id),
    monto_capital: numeric("monto_capital", { precision: 18, scale: 2 }).notNull().default("0"),
    monto_interes: numeric("monto_interes", { precision: 18, scale: 2 }).notNull().default("0"),
    monto_total: numeric("monto_total", { precision: 18, scale: 2 }).notNull().default("0"),
    tipo_reinversion: tipoReinversionEnum("tipo_reinversion").notNull(),
    fecha_creacion: timestamp("fecha_creacion").defaultNow().notNull(),
  });

  export const asesores = customSchema.table("asesores", {
    asesor_id: serial("asesor_id").primaryKey(),
    nombre: varchar("nombre", { length: 100 }).notNull(),
    telefono: varchar("telefono", { length: 20 }), // 🔥 NUEVO CAMPO OPCIONAL
    activo: boolean("activo"),
    emailCashIn: varchar("email_cash_in", { length: 150 }), // 🔥 NUEVO CAMPO OPCIONAL
  });

  export const cuentasEmpresa = customSchema.table("cuentas_empresa", {
    cuentaId: serial("cuenta_id").primaryKey(),
    nombreCuenta: varchar("nombre_cuenta", { length: 100 }).notNull(),
    banco: varchar("banco", { length: 100 }).notNull(),
    numeroCuenta: varchar("numero_cuenta", { length: 50 }).notNull().unique(),
    descripcion: varchar("descripcion", { length: 255 }),
    activo: boolean("activo").default(true).notNull(),
    moneda: tipoMonedaEnum("moneda").notNull().default("quetzales"),
    // saldo_actual NO se modifica desde la app: lo mueve solo el trigger
    // BEFORE INSERT en cuentas_empresa_movimientos (ver más abajo).
    saldo_actual: numeric("saldo_actual", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    fechaCreacion: timestamp("fecha_creacion")
      .notNull()
      .default(sql`NOW() AT TIME ZONE 'America/Guatemala'`),
    fechaActualizacion: timestamp("fecha_actualizacion")
      .notNull()
      .default(sql`NOW() AT TIME ZONE 'America/Guatemala'`),
  });

  export const tipoMovimientoCuentaEmpresaEnum = customSchema.enum(
    "tipo_movimiento_cuenta_empresa",
    ["ingreso", "egreso" ]
  );

  // Ledger de movimientos por cuenta. Cada fila es un evento de plata
  // (entrada o salida). El saldo_actual de cuentas_empresa se deriva de
  // la suma de estos movimientos — la columna saldo_actual es solo un
  // cache mantenido por el trigger DB para lectura rápida.
  //
  // saldo_post guarda el saldo de la cuenta justo después de aplicar
  // este movimiento (snapshot histórico, sirve para auditoría).
  export const cuentas_empresa_movimientos = customSchema.table(
    "cuentas_empresa_movimientos",
    {
      movimiento_id: serial("movimiento_id").primaryKey(),
      // ON DELETE RESTRICT: no se puede borrar una cuenta con movimientos.
      cuenta_id: integer("cuenta_id")
        .notNull()
        .references(() => cuentasEmpresa.cuentaId, { onDelete: "restrict" }),
      tipo: tipoMovimientoCuentaEmpresaEnum("tipo").notNull(),
      // monto siempre positivo; el signo lo determina `tipo` (CHECK monto > 0 en DB).
      monto: numeric("monto", { precision: 18, scale: 2 }).notNull(),
      // El trigger BEFORE INSERT sobrescribe este valor con el saldo real
      // de la cuenta tras aplicar el movimiento.
      saldo_post: numeric("saldo_post", { precision: 18, scale: 2 }).notNull(),
      motivo: text("motivo"),
      created_by: integer("created_by").references(() => platform_users.id),
      created_at: timestamp("created_at", { withTimezone: true })
        .notNull()
        .default(sql`NOW() AT TIME ZONE 'America/Guatemala'`),
    },
    (t) => ({
      cuentaIdx: index("idx_cuentas_empresa_mov_cuenta").on(t.cuenta_id),
      fechaIdx: index("idx_cuentas_empresa_mov_fecha").on(t.created_at),
    })
  );

  // ===== Funciones + triggers de cuentas_empresa (hora Guatemala) =====
  // Aplica un movimiento al saldo_actual de la cuenta y guarda saldo_post.
  export const aplicarMovimientoCuentaEmpresaFn = sql`
    CREATE OR REPLACE FUNCTION cartera.aplicar_movimiento_cuenta_empresa()
    RETURNS TRIGGER AS $$
    DECLARE
      v_delta numeric(18,2);
      v_nuevo_saldo numeric(18,2);
    BEGIN
      v_delta := CASE NEW.tipo WHEN 'ingreso' THEN NEW.monto ELSE -NEW.monto END;

      UPDATE cartera.cuentas_empresa
         SET saldo_actual = saldo_actual + v_delta
       WHERE cuenta_id = NEW.cuenta_id
       RETURNING saldo_actual INTO v_nuevo_saldo;

      IF v_nuevo_saldo IS NULL THEN
        RAISE EXCEPTION 'cuenta_id % no existe', NEW.cuenta_id;
      END IF;

      NEW.saldo_post := v_nuevo_saldo;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `;

  export const aplicarMovimientoCuentaEmpresaTrigger = sql`
    DROP TRIGGER IF EXISTS trg_cuentas_empresa_mov_aplicar ON cartera.cuentas_empresa_movimientos;
    CREATE TRIGGER trg_cuentas_empresa_mov_aplicar
    BEFORE INSERT ON cartera.cuentas_empresa_movimientos
    FOR EACH ROW
    EXECUTE FUNCTION cartera.aplicar_movimiento_cuenta_empresa();
  `;

  // Auto-actualiza fecha_actualizacion en cualquier UPDATE.
  export const setFechaActualizacionFn = sql`
    CREATE OR REPLACE FUNCTION cartera.set_fecha_actualizacion()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.fecha_actualizacion = NOW() AT TIME ZONE 'America/Guatemala';
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `;

  export const cuentasEmpresaSetFechaTrigger = sql`
    DROP TRIGGER IF EXISTS trg_cuentas_empresa_set_fecha_actualizacion ON cartera.cuentas_empresa;
    CREATE TRIGGER trg_cuentas_empresa_set_fecha_actualizacion
    BEFORE UPDATE ON cartera.cuentas_empresa
    FOR EACH ROW
    EXECUTE FUNCTION cartera.set_fecha_actualizacion();
  `;



  export const convenios_pago = customSchema.table("convenios_pago", {
    convenio_id: serial("convenio_id").primaryKey(),

    // Relación con el crédito
    credito_id: integer("credito_id")
      .notNull()
      .references(() => creditos.credito_id, { onDelete: "cascade" }),

    // Detalles del convenio
    monto_total_convenio: numeric("monto_total_convenio", {
      precision: 18,
      scale: 2
    }).notNull(),

    numero_meses: integer("numero_meses").notNull(),

    cuota_mensual: numeric("cuota_mensual", {
      precision: 18,
      scale: 2
    }).notNull(),

    fecha_convenio: timestamp("fecha_convenio").notNull(),

    // 🎯 CONTROL DEL CONVENIO
    monto_pagado: numeric("monto_pagado", {
      precision: 18,
      scale: 2
    }).notNull().default("0"), // Cuánto se ha pagado

    monto_pendiente: numeric("monto_pendiente", {
      precision: 18,
      scale: 2
    }).notNull(), // Cuánto falta (se actualiza con cada pago)

    pagos_realizados: integer("pagos_realizados").notNull().default(0), // Cuántos pagos se han hecho

    pagos_pendientes: integer("pagos_pendientes").notNull(), // Cuántos pagos faltan

    // Estado del convenio
    activo: boolean("activo").notNull().default(true),

    completado: boolean("completado").notNull().default(false),

    // Metadata
    motivo: text("motivo"),
    observaciones: text("observaciones"),

    created_by: integer("created_by")
      .references(() => platform_users.id),

    created_at: timestamp("created_at").defaultNow(),
    updated_at: timestamp("updated_at").defaultNow(),
  });


  export const convenios_pagos_resume = customSchema.table("convenios_pagos_resume", {
    id: serial("id").primaryKey(),

    convenio_id: integer("convenio_id")
      .notNull()
      .references(() => convenios_pago.convenio_id, { onDelete: "cascade" }),

    pago_id: integer("pago_id")
      .notNull()
      .references(() => pagos_credito.pago_id, { onDelete: "cascade" }),

    created_at: timestamp("created_at").defaultNow(),
  });export const convenio_cuotas = customSchema.table("convenio_cuotas", {
    cuota_convenio_id: serial("cuota_convenio_id").primaryKey(),
    convenio_id: integer("convenio_id")
      .references(() => convenios_pago.convenio_id)
      .notNull(),

    // Control mínimo
    numero_cuota: integer("numero_cuota").notNull(), // 1, 2, 3... hasta numero_meses
    fecha_vencimiento: date("fecha_vencimiento").notNull(), // Cuándo vence esta cuota
    fecha_pago: timestamp("fecha_pago"), // NULL si no está pagada, timestamp cuando se paga

    created_at: timestamp("created_at").defaultNow(),
  });



  // src/db/schema.ts

  // 🔥 ENUM para status de factura
  export const statusFacturaEnum = pgEnum("status_factura", [
    "ACTIVA",
    "ANULADA"
  ]);
  // src/db/schema.ts

  export const facturas_electronicas = customSchema.table("facturas_electronicas", {
    factura_id: serial("factura_id").primaryKey(),

    // 🔥 Opcional: puede ser null para facturas genéricas (sin pago asociado)
    pago_id: integer("pago_id")
      .references(() => pagos_credito.pago_id, { onDelete: "set null" }),

    // Datos del DTE
    serie: varchar("serie", { length: 50 }).notNull(),
    numero: varchar("numero", { length: 100 }).notNull(),
    uuid: varchar("uuid", { length: 255 }).notNull().unique(),

    tipo_documento: varchar("tipo_documento", { length: 10 }).notNull(),

    // Montos
    monto_total: numeric("monto_total", { precision: 18, scale: 2 }).notNull(),
    monto_iva: numeric("monto_iva", { precision: 18, scale: 2 }).notNull(),

    // URLs
    pdf_url: varchar("pdf_url", { length: 500 }).notNull(),
    xml_url: varchar("xml_url", { length: 500 }),

    // Emisor
    emisor_nit: varchar("emisor_nit", { length: 30 }),
    emisor_nombre: varchar("emisor_nombre", { length: 200 }),

    // Receptor
    receptor_nit: varchar("receptor_nit", { length: 30 }).notNull(),
    receptor_nombre: varchar("receptor_nombre", { length: 200 }).notNull(),

    // Fechas
    fecha_emision: timestamp("fecha_emision").notNull(),
    fecha_certificacion: timestamp("fecha_certificacion").notNull(),

    // STATUS Y ANULACIÓN
    status: statusFacturaEnum("status").notNull().default("ACTIVA"),
    fecha_anulacion: timestamp("fecha_anulacion"),
    motivo_anulacion: text("motivo_anulacion"),
    anulada_por: integer("anulada_por").references(() => platform_users.id),

    // Metadata
    created_at: timestamp("created_at").defaultNow().notNull(),
    created_by: integer("created_by").references(() => platform_users.id),
  });

  // ============================================
  // 🧾 TABLA: facturacion_desglose
  //    Desglose por rubro de LO QUE FACTURA CUBE en cada pago, para el
  //    reporte diario de facturación (matriz categoría × rubro × día).
  //    - 1 fila por (pago_id, rubro).
  //    - INTERES = residuo CUBE CON IVA (totalCube de /facturar-pago-completo).
  //    - CAPITAL no se factura → factura_id NULL, monto_iva 0.
  //    - monto_total incluye IVA (misma convención que facturas_electronicas).
  //    - fecha_aplicado_gt = fecha_aplicado del pago en zona America/Guatemala.
  //    - La categoría NO se guarda: sale por JOIN pago→crédito→usuario.
  // ============================================
  export const facturacion_desglose = customSchema.table(
    "facturacion_desglose",
    {
      id: serial("id").primaryKey(),
      // nullable: las facturas GENÉRICAS no tienen pago (se anclan por factura_id).
      pago_id: integer("pago_id").references(
        () => pagos_credito.pago_id,
        { onDelete: "cascade" }
      ),
      factura_id: integer("factura_id").references(
        () => facturas_electronicas.factura_id,
        { onDelete: "set null" }
      ),
      rubro: rubroFacturacionEnum("rubro").notNull(),
      monto_total: numeric("monto_total", { precision: 18, scale: 2 })
        .notNull()
        .default("0"), // con IVA incluido
      monto_iva: numeric("monto_iva", { precision: 18, scale: 2 })
        .notNull()
        .default("0"),
      fecha_aplicado_gt: date("fecha_aplicado_gt"),
      // Categoría del receptor (resuelta por NIT) para las genéricas → columna de
      // producto del reporte. En filas ligadas a un pago queda NULL y se deriva
      // por JOIN pago→credito→usuario.
      categoria: varchar("categoria", { length: 100 }),
      created_at: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => ({
      uqPagoRubro: uniqueIndex("uq_facturacion_desglose_pago_rubro").on(
        table.pago_id,
        table.rubro
      ),
      idxFecha: index("idx_facturacion_desglose_fecha").on(
        table.fecha_aplicado_gt
      ),
    })
  );

  // ============================================
  // 🧾 TABLA: gastos_administrativos
  //    Gastos administrativos manuales para el reporte diario de facturación.
  //    Itemizados por día (concepto + monto). El reporte suma por día.
  //    En el Excel: "Otros cobros" = Otros ingresos − SUM(gastos del día).
  // ============================================
  export const gastos_administrativos = customSchema.table(
    "gastos_administrativos",
    {
      id: serial("id").primaryKey(),
      fecha: date("fecha").notNull(), // fecha del gasto (America/Guatemala)
      concepto: varchar("concepto", { length: 200 }).notNull(),
      monto: numeric("monto", { precision: 18, scale: 2 })
        .notNull()
        .default("0"),
      created_at: timestamp("created_at").defaultNow().notNull(),
      created_by: integer("created_by"),
    },
    (table) => ({
      idxFecha: index("idx_gastos_admin_fecha").on(table.fecha),
    })
  );

  // ============================================
  // 🚗 TABLA: ingresos_carros
  //    Ingresos por carros manuales para el reporte diario (columna "Ingreso
  //    Carros" del Excel). Itemizados por día. El snapshot suma por día.
  // ============================================
  export const ingresos_carros = customSchema.table(
    "ingresos_carros",
    {
      id: serial("id").primaryKey(),
      fecha: date("fecha").notNull(), // America/Guatemala
      concepto: varchar("concepto", { length: 200 }).notNull(),
      monto: numeric("monto", { precision: 18, scale: 2 })
        .notNull()
        .default("0"),
      created_at: timestamp("created_at").defaultNow().notNull(),
      created_by: integer("created_by"),
    },
    (table) => ({
      idxFecha: index("idx_ingresos_carros_fecha").on(table.fecha),
    })
  );

  // ============================================
  // 🎯 TABLA: metas_facturacion
  //    Metas financieras manuales por (año, mes). Globales (no por categoría).
  //    - meta_mensual/semanal/diaria se capturan por separado.
  //    - meta_diaria aplica a cada día del mes.
  //    - deuda_* opcionales (mismo bloque del Excel).
  // ============================================
  export const metas_facturacion = customSchema.table(
    "metas_facturacion",
    {
      id: serial("id").primaryKey(),
      anio: integer("anio").notNull(),
      mes: integer("mes").notNull(), // 1-12
      meta_mensual: numeric("meta_mensual", { precision: 18, scale: 2 })
        .notNull()
        .default("0"),
      meta_semanal: numeric("meta_semanal", { precision: 18, scale: 2 })
        .notNull()
        .default("0"),
      meta_diaria: numeric("meta_diaria", { precision: 18, scale: 2 })
        .notNull()
        .default("0"),
      deuda_mensual: numeric("deuda_mensual", { precision: 18, scale: 2 }),
      deuda_semanal: numeric("deuda_semanal", { precision: 18, scale: 2 }),
      deuda_diaria: numeric("deuda_diaria", { precision: 18, scale: 2 }),
      created_at: timestamp("created_at").defaultNow().notNull(),
      updated_at: timestamp("updated_at").defaultNow().notNull(),
    },
    (table) => ({
      uqAnioMes: uniqueIndex("uq_metas_facturacion_anio_mes").on(
        table.anio,
        table.mes
      ),
    })
  );

  // ============================================
  // 📸 TABLA: facturacion_snapshot_diario
  //    Snapshot diario tipo Excel "Reuniones diarias" → hoja Facturación.
  //    1 fila por día (columnas A→BK del Excel), congeladas.
  //    Se llena con endpoint manual + job de respaldo si el día no se guardó.
  //    Money = numeric(18,2). Sufijos de producto = categoría del crédito.
  // ============================================
  export const facturacion_snapshot_diario = customSchema.table(
    "facturacion_snapshot_diario",
    {
      id: serial("id").primaryKey(),
      fecha: date("fecha").notNull(), // A — día (America/Guatemala)
      anio: integer("anio"), // helper
      mes: integer("mes"), // helper

      // 💰 Capital (B–H)
      cap_autocompras: numeric("cap_autocompras", { precision: 18, scale: 2 }).notNull().default("0"),
      cap_sobre_vehiculo: numeric("cap_sobre_vehiculo", { precision: 18, scale: 2 }).notNull().default("0"),
      nuevo_cap_autocompras: numeric("nuevo_cap_autocompras", { precision: 18, scale: 2 }).notNull().default("0"),
      cap_hipotecario: numeric("cap_hipotecario", { precision: 18, scale: 2 }).notNull().default("0"),
      cap_extra_financiamiento: numeric("cap_extra_financiamiento", { precision: 18, scale: 2 }).notNull().default("0"),
      cap_reestructura: numeric("cap_reestructura", { precision: 18, scale: 2 }).notNull().default("0"),
      capital_total: numeric("capital_total", { precision: 18, scale: 2 }).notNull().default("0"),

      // 💵 Interés (I–O)
      int_autocompras: numeric("int_autocompras", { precision: 18, scale: 2 }).notNull().default("0"),
      int_sobre_vehiculo: numeric("int_sobre_vehiculo", { precision: 18, scale: 2 }).notNull().default("0"),
      nuevo_int_autocompras: numeric("nuevo_int_autocompras", { precision: 18, scale: 2 }).notNull().default("0"),
      int_hipotecario: numeric("int_hipotecario", { precision: 18, scale: 2 }).notNull().default("0"),
      int_extra_financiamiento: numeric("int_extra_financiamiento", { precision: 18, scale: 2 }).notNull().default("0"),
      int_reestructura: numeric("int_reestructura", { precision: 18, scale: 2 }).notNull().default("0"),
      interes_cube: numeric("interes_cube", { precision: 18, scale: 2 }).notNull().default("0"),

      // 🎟️ Membresía (P–V)
      mem_autocompras: numeric("mem_autocompras", { precision: 18, scale: 2 }).notNull().default("0"),
      mem_sobre_vehiculo: numeric("mem_sobre_vehiculo", { precision: 18, scale: 2 }).notNull().default("0"),
      nuevo_mem_autocompras: numeric("nuevo_mem_autocompras", { precision: 18, scale: 2 }).notNull().default("0"),
      mem_hipotecario: numeric("mem_hipotecario", { precision: 18, scale: 2 }).notNull().default("0"),
      mem_extra_financiamiento: numeric("mem_extra_financiamiento", { precision: 18, scale: 2 }).notNull().default("0"),
      mem_reestructura: numeric("mem_reestructura", { precision: 18, scale: 2 }).notNull().default("0"),
      membresia: numeric("membresia", { precision: 18, scale: 2 }).notNull().default("0"),

      // 📦 Otros ingresos (W–AE)
      oi_autocompras: numeric("oi_autocompras", { precision: 18, scale: 2 }).notNull().default("0"),
      oi_sobre_vehiculo: numeric("oi_sobre_vehiculo", { precision: 18, scale: 2 }).notNull().default("0"),
      nuevo_oi_autocompras: numeric("nuevo_oi_autocompras", { precision: 18, scale: 2 }).notNull().default("0"),
      oi_hipotecario: numeric("oi_hipotecario", { precision: 18, scale: 2 }).notNull().default("0"),
      oi_extra_financiamiento: numeric("oi_extra_financiamiento", { precision: 18, scale: 2 }).notNull().default("0"),
      oi_reestructura: numeric("oi_reestructura", { precision: 18, scale: 2 }).notNull().default("0"),
      otros_ingresos: numeric("otros_ingresos", { precision: 18, scale: 2 }).notNull().default("0"),
      administrativos: numeric("administrativos", { precision: 18, scale: 2 }).notNull().default("0"),
      otros_cobros: numeric("otros_cobros", { precision: 18, scale: 2 }).notNull().default("0"),

      // ⚠️ Mora (AF–AL)
      mora_autocompras: numeric("mora_autocompras", { precision: 18, scale: 2 }).notNull().default("0"),
      mora_sobre_vehiculo: numeric("mora_sobre_vehiculo", { precision: 18, scale: 2 }).notNull().default("0"),
      nuevo_mora_autocompras: numeric("nuevo_mora_autocompras", { precision: 18, scale: 2 }).notNull().default("0"),
      mora_hipotecario: numeric("mora_hipotecario", { precision: 18, scale: 2 }).notNull().default("0"),
      mora_extra_financiamiento: numeric("mora_extra_financiamiento", { precision: 18, scale: 2 }).notNull().default("0"),
      mora_reestructura: numeric("mora_reestructura", { precision: 18, scale: 2 }).notNull().default("0"),
      mora_cube: numeric("mora_cube", { precision: 18, scale: 2 }).notNull().default("0"),

      // 👑 Royalty (AM–AS)
      roy_autocompras: numeric("roy_autocompras", { precision: 18, scale: 2 }).notNull().default("0"),
      roy_sobre_vehiculo: numeric("roy_sobre_vehiculo", { precision: 18, scale: 2 }).notNull().default("0"),
      nuevo_roy_autocompras: numeric("nuevo_roy_autocompras", { precision: 18, scale: 2 }).notNull().default("0"),
      roy_hipotecario: numeric("roy_hipotecario", { precision: 18, scale: 2 }).notNull().default("0"),
      roy_extra_financiamiento: numeric("roy_extra_financiamiento", { precision: 18, scale: 2 }).notNull().default("0"),
      roy_reestructura: numeric("roy_reestructura", { precision: 18, scale: 2 }).notNull().default("0"),
      royalty: numeric("royalty", { precision: 18, scale: 2 }).notNull().default("0"),

      // 🛡️ Seguro por categoría (segmentación; el COMBINADO sigue en servicios_seguro_gps)
      seg_autocompras: numeric("seg_autocompras", { precision: 18, scale: 2 }).notNull().default("0"),
      seg_sobre_vehiculo: numeric("seg_sobre_vehiculo", { precision: 18, scale: 2 }).notNull().default("0"),
      nuevo_seg_autocompras: numeric("nuevo_seg_autocompras", { precision: 18, scale: 2 }).notNull().default("0"),
      seg_hipotecario: numeric("seg_hipotecario", { precision: 18, scale: 2 }).notNull().default("0"),
      seg_extra_financiamiento: numeric("seg_extra_financiamiento", { precision: 18, scale: 2 }).notNull().default("0"),
      seg_reestructura: numeric("seg_reestructura", { precision: 18, scale: 2 }).notNull().default("0"),
      seguro_total: numeric("seguro_total", { precision: 18, scale: 2 }).notNull().default("0"),

      // 📍 GPS por categoría (segmentación; el COMBINADO sigue en servicios_seguro_gps)
      gps_autocompras: numeric("gps_autocompras", { precision: 18, scale: 2 }).notNull().default("0"),
      gps_sobre_vehiculo: numeric("gps_sobre_vehiculo", { precision: 18, scale: 2 }).notNull().default("0"),
      nuevo_gps_autocompras: numeric("nuevo_gps_autocompras", { precision: 18, scale: 2 }).notNull().default("0"),
      gps_hipotecario: numeric("gps_hipotecario", { precision: 18, scale: 2 }).notNull().default("0"),
      gps_extra_financiamiento: numeric("gps_extra_financiamiento", { precision: 18, scale: 2 }).notNull().default("0"),
      gps_reestructura: numeric("gps_reestructura", { precision: 18, scale: 2 }).notNull().default("0"),
      gps_total: numeric("gps_total", { precision: 18, scale: 2 }).notNull().default("0"),

      // 📊 Totales / acumulados (AT–BE)
      facturacion: numeric("facturacion", { precision: 18, scale: 2 }).notNull().default("0"),
      facturacion_acumulado: numeric("facturacion_acumulado", { precision: 18, scale: 2 }).notNull().default("0"),
      servicios_seguro_gps: numeric("servicios_seguro_gps", { precision: 18, scale: 2 }).notNull().default("0"),
      acum_servicios_seguro_gps: numeric("acum_servicios_seguro_gps", { precision: 18, scale: 2 }).notNull().default("0"),
      facturacion_mas_servicios: numeric("facturacion_mas_servicios", { precision: 18, scale: 2 }).notNull().default("0"),
      acumulado_total: numeric("acumulado_total", { precision: 18, scale: 2 }).notNull().default("0"),
      facturacion_inversionistas: numeric("facturacion_inversionistas", { precision: 18, scale: 2 }).notNull().default("0"),
      acumulado_inversionistas: numeric("acumulado_inversionistas", { precision: 18, scale: 2 }).notNull().default("0"),
      tendencia_fin_mes: numeric("tendencia_fin_mes", { precision: 18, scale: 2 }).notNull().default("0"),
      tendencia_semanal: numeric("tendencia_semanal", { precision: 18, scale: 2 }).notNull().default("0"),
      ingreso_carros: numeric("ingreso_carros", { precision: 18, scale: 2 }).notNull().default("0"),
      reserva_acumulada: numeric("reserva_acumulada", { precision: 18, scale: 2 }).notNull().default("0"),
      semana: integer("semana"), // BF

      // 🎯 Metas (BG–BK)
      meta_facturacion_mensual: numeric("meta_facturacion_mensual", { precision: 18, scale: 2 }).notNull().default("0"),
      meta_facturacion_semanal: numeric("meta_facturacion_semanal", { precision: 18, scale: 2 }).notNull().default("0"),
      meta_facturacion_diaria: numeric("meta_facturacion_diaria", { precision: 18, scale: 2 }).notNull().default("0"),
      porcentaje_meta_mensual: numeric("porcentaje_meta_mensual", { precision: 9, scale: 4 }).notNull().default("0"),
      meta_diaria: numeric("meta_diaria", { precision: 18, scale: 2 }).notNull().default("0"),

      created_at: timestamp("created_at").defaultNow().notNull(),
      updated_at: timestamp("updated_at").defaultNow().notNull(),

      bloqueado: boolean("bloqueado").notNull().default(false),
      bloqueado_por: integer("bloqueado_por"),
      bloqueado_at: timestamp("bloqueado_at"),
    },
    (table) => ({
      uqFecha: uniqueIndex("uq_facturacion_snapshot_diario_fecha").on(table.fecha),
    })
  );

  // 🧾 TABLA: facturacion_snapshot_detalle
  //    Desglose del snapshot por ORIGEN (crédito nuevo vs pago) para que conta vea
  //    la diferencia que hoy calcula a mano. 1 fila por (fecha, rubro, producto,
  //    origen). Se DERIVA de facturacion_desglose en generarSnapshotDiario
  //    (origen = pago_id IS NULL → 'nuevo' [originación]; si no → 'pago').
  //    NO afecta los totales del snapshot ni las fórmulas del Excel: es una vista
  //    de control adicional (~60–70 filas/día).
  export const facturacion_snapshot_detalle = customSchema.table(
    "facturacion_snapshot_detalle",
    {
      id: serial("id").primaryKey(),
      fecha: date("fecha").notNull(),
      rubro: rubroFacturacionEnum("rubro").notNull(),
      // producto: autocompras|sobre_vehiculo|nuevo_autocompras|hipotecario|extra_financiamiento|reestructura|sin_producto
      producto: varchar("producto", { length: 40 }).notNull(),
      origen: varchar("origen", { length: 10 }).notNull(), // 'nuevo' (originación) | 'pago'
      monto_total: numeric("monto_total", { precision: 18, scale: 2 }).notNull().default("0"),
      monto_iva: numeric("monto_iva", { precision: 18, scale: 2 }).notNull().default("0"),
      created_at: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => ({
      uqDetalle: uniqueIndex("uq_facturacion_snapshot_detalle").on(
        table.fecha,
        table.rubro,
        table.producto,
        table.origen
      ),
      idxFecha: index("idx_facturacion_snapshot_detalle_fecha").on(table.fecha),
    })
  );

  export const facturacion_snapshot_auditoria = customSchema.table(
    "facturacion_snapshot_auditoria",
    {
      id: serial("id").primaryKey(),
      fecha: date("fecha").notNull(),
      columna: varchar("columna", { length: 100 }).notNull(),
      valor_anterior: text("valor_anterior"),
      valor_nuevo: text("valor_nuevo"),
      accion: varchar("accion", { length: 20 }).notNull(),
      usuario_id: integer("usuario_id"),
      created_at: timestamp("created_at").defaultNow().notNull(),
    }
  );

  // ============================================
  // 🆕 TABLA: facturas_fallidas_sat
  //    Registro de facturas que están ACTIVA en BD pero NO se
  //    encontraron en SAT al verificarlas con obtenerPorUUID.
  // ============================================
  export const facturas_fallidas_sat = customSchema.table("facturas_fallidas_sat", {
    id: serial("id").primaryKey(),

    // Una fila por factura (UNIQUE para upsert / no duplicar)
    factura_id: integer("factura_id")
      .notNull()
      .unique()
      .references(() => facturas_electronicas.factura_id),

    // Datos de la factura (copiados para el reporte)
    uuid: varchar("uuid", { length: 255 }).notNull(),
    serie: varchar("serie", { length: 50 }).notNull(),
    numero: varchar("numero", { length: 100 }).notNull(),
    emisor_nit: varchar("emisor_nit", { length: 30 }),
    emisor_nombre: varchar("emisor_nombre", { length: 200 }),
    receptor_nit: varchar("receptor_nit", { length: 30 }),
    receptor_nombre: varchar("receptor_nombre", { length: 200 }),
    monto_total: numeric("monto_total", { precision: 18, scale: 2 }),
    fecha_certificacion: timestamp("fecha_certificacion"),

    // Resultado de la verificación
    mensaje_sat: text("mensaje_sat"),
    intentos: integer("intentos").notNull().default(1),
    status: varchar("status", { length: 20 }).notNull().default("PENDIENTE"), // PENDIENTE | RESUELTA

    // Metadata
    detectada_at: timestamp("detectada_at").defaultNow().notNull(),
    resuelta_at: timestamp("resuelta_at"),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  });

  // ============================================
  // 🆕 TABLA: job_checkpoints
  //    Cursor genérico para jobs incrementales (arrancar desde
  //    donde se quedó). Ej: verificar_facturas_sat.
  // ============================================
  export const job_checkpoints = customSchema.table("job_checkpoints", {
    job_name: varchar("job_name", { length: 100 }).primaryKey(),
    last_factura_id: integer("last_factura_id").notNull().default(0),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  });


  // 🆕 TABLA: liquidaciones
  // ============================================
  // 🆕 ENUM para estado de boleta
  // ============================================
  export const estadoBoletaEnum = pgEnum("estado_boleta", [
    "PENDIENTE",
    "PROCESADO"
  ]);

  // ============================================
  // 🆕 TABLA: boletas_pago_inversionista
  // ============================================
  export const boletasPagoInversionista = customSchema.table(
    "boletas_pago_inversionista",
    {
      boleta_id: serial("boleta_id").primaryKey(),

      // 🔥 INVERSIONISTA (obligatorio)
      inversionista_id: integer("inversionista_id")
        .notNull()
        .references(() => inversionistas.inversionista_id, { onDelete: "cascade" }),

      // URL de la boleta del banco (foto o PDF)
      boleta_url: text("boleta_url").notNull(),

      // Estado del comprobante
      estado: estadoBoletaEnum("estado").notNull().default("PENDIENTE"),

      // Metadata
      notas: text("notas"),
      monto_boleta: numeric("monto_boleta", { precision: 18, scale: 2 }),

      // Fechas
      fecha_subida: timestamp("fecha_subida", { withTimezone: true })
        .notNull()
        .$default(() => new Date()),
      fecha_procesado: timestamp("fecha_procesado", { withTimezone: true }),

      // Quién subió la boleta
      subido_por: integer("subido_por")
        .references(() => platform_users.id, { onDelete: "set null" }),
    },
    (table) => ({
      inversionistaIdx: index("idx_boletas_inversionista").on(
        table.inversionista_id
      ),
      estadoIdx: index("idx_boletas_estado").on(table.estado),
      fechaIdx: index("idx_boletas_fecha_subida").on(table.fecha_subida),
    })
  );

  // ============================================
  // 🔄 ACTUALIZACIÓN: liquidaciones
  // ============================================
  export const liquidaciones = customSchema.table(
    "liquidaciones",
    {
      liquidacion_id: serial("liquidacion_id").primaryKey(),

      // Inversionista (OBLIGATORIO)
      inversionista_id: integer("inversionista_id")
        .notNull()
        .references(() => inversionistas.inversionista_id, { onDelete: "cascade" }),

      // 🆕 ENLACE A LA BOLETA que originó esta liquidación
      boleta_id: integer("boleta_id")
        .references(() => boletasPagoInversionista.boleta_id, { onDelete: "set null" }),

      // Totales de la liquidación
      total_pagos_liquidados: integer("total_pagos_liquidados").notNull().default(0),
      total_capital: numeric("total_capital", { precision: 18, scale: 2 }).notNull().default("0"),
      total_interes: numeric("total_interes", { precision: 18, scale: 2 }).notNull().default("0"),
      total_iva: numeric("total_iva", { precision: 18, scale: 2 }).notNull().default("0"),
      total_isr: numeric("total_isr", { precision: 18, scale: 2 }).notNull().default("0"),
      total_cuota: numeric("total_cuota", { precision: 18, scale: 2 }).notNull().default("0"),

      // Reinversión
      reinversion_capital: numeric("reinversion_capital", { precision: 18, scale: 2 }).notNull().default("0"),
      reinversion_interes: numeric("reinversion_interes", { precision: 18, scale: 2 }).notNull().default("0"),
      reinversion_total: numeric("reinversion_total", { precision: 18, scale: 2 }).notNull().default("0"),

      // Reporte de liquidación (Excel/PDF)
      reporte_liquidacion_url: text("reporte_liquidacion_url"),

      // Fecha
      fecha_liquidacion: timestamp("fecha_liquidacion", { withTimezone: true })
        .notNull()
        .$default(() => new Date()),

      // Metadata
      creado_por: integer("creado_por")
        .references(() => platform_users.id, { onDelete: "set null" }),
    },
    (table) => ({
      inversionistaIdx: index("idx_liquidaciones_inversionista").on(
        table.inversionista_id
      ),
      boletaIdx: index("idx_liquidaciones_boleta").on(table.boleta_id),
      fechaIdx: index("idx_liquidaciones_fecha").on(table.fecha_liquidacion),
    })
  );

  // ========================================
  // HISTORIAL DE EFECTIVIDAD POR ASESOR
  // ========================================
  export const efectividad_asesores = customSchema.table("efectividad_asesores", {
    efectividad_id: serial("efectividad_id").primaryKey(),

    // ID del asesor al que pertenece este registro
    asesor_id: integer("asesor_id")
      .notNull()
      .references(() => asesores.asesor_id),
    // ID del crédito (enlaza a la tabla creditos, null si el asesor no tuvo cuotas ese día)
    credito_id: integer("credito_id")
      .references(() => creditos.credito_id),

    // Día de vencimiento consultado (1-31)
    dia: integer("dia").notNull(),
    // Mes consultado (1-12)
    mes: integer("mes").notNull(),
    // Año consultado (ej: 2026)
    anio: integer("anio").notNull(),
    // Fecha completa en timezone Guatemala (para queries y orden)
    fecha: timestamp("fecha", { withTimezone: true }).notNull(),

    // === COBRO DEL DÍA: cuántas cuotas vencían ese día y cuántas se cobraron ===
    // Total de cuotas que vencen ese día para este asesor
    total_cuotas: integer("total_cuotas").notNull().default(0),
    // Cuotas que ya fueron pagadas (se actualiza cada vez que corre el job)
    cuotas_pagadas: integer("cuotas_pagadas").notNull().default(0),
    // Cuotas que siguen sin pagar
    cuotas_pendientes: integer("cuotas_pendientes").notNull().default(0),
    // Dinero total esperado ese día (cuota + convenio si aplica)
    monto_esperado: numeric("monto_esperado", { precision: 18, scale: 2 }).notNull().default("0"),
    // Dinero efectivamente cobrado
    monto_cobrado: numeric("monto_cobrado", { precision: 18, scale: 2 }).notNull().default("0"),
    // Dinero que falta por cobrar
    monto_pendiente: numeric("monto_pendiente", { precision: 18, scale: 2 }).notNull().default("0"),

    // === EFECTIVIDAD ===
    // % de efectividad de ese día específico (cuotas_pagadas / total_cuotas * 100)
    efectividad_dia: numeric("efectividad_dia", { precision: 5, scale: 2 }).notNull().default("0"),
    // % de efectividad acumulada del asesor en el mes (suma de todos los días del mes hasta hoy)
    efectividad: numeric("efectividad", { precision: 5, scale: 2 }).notNull().default("0"),

    created_at: timestamp("created_at").defaultNow(),
  });

  // Historial de cambios de fecha de inicio de crédito
  export const historial_cambio_fecha = customSchema.table("historial_cambio_fecha", {
    id: serial("id").primaryKey(),
    credito_id: integer("credito_id")
      .notNull()
      .references(() => creditos.credito_id),
    fecha_inicio_anterior: date("fecha_inicio_anterior").notNull(),
    fecha_inicio_nueva: date("fecha_inicio_nueva").notNull(),
    razon: text("razon").notNull(),
    changed_by: varchar("changed_by", { length: 150 }).notNull(),
    created_at: timestamp("created_at").defaultNow(),
  });

  // ========================================
  // DOCUMENTOS / CONTRATOS DE INVERSIONISTAS
  // ========================================
  export const documentos_inversionista = customSchema.table("documentos_inversionista", {
    documento_id: serial("documento_id").primaryKey(),
    inversionista_id: integer("inversionista_id")
      .notNull()
      .references(() => inversionistas.inversionista_id, { onDelete: "cascade" }),
    key: varchar("key", { length: 500 }).notNull(),
    nombre: varchar("nombre", { length: 300 }).notNull(),
    descripcion: varchar("descripcion", { length: 500 }),
    visible: boolean("visible").notNull().default(false),
    created_at: timestamp("created_at").defaultNow().notNull(),
    created_by: varchar("created_by", { length: 250 }),
  }, (table) => ({
    inversionistaIdx: index("idx_docs_inversionista").on(table.inversionista_id),
  }));

  // ========================================
  // ABONOS A CAPITAL
  // ========================================
  export const tipoAbonoEnum = customSchema.enum("tipo_abono", [
    "CANCELACION",
    "CAPITAL",
  ]);

  export const abonos_capital = customSchema.table("abonos_capital", {
    abono_id: serial("abono_id").primaryKey(),
    credito_id: integer("credito_id")
      .notNull()
      .references(() => creditos.credito_id),
    inversionista_id: integer("inversionista_id")
      .notNull()
      .references(() => inversionistas.inversionista_id),
    monto: numeric("monto", { precision: 18, scale: 6 }).notNull(),
    tipo: tipoAbonoEnum("tipo").notNull(),
    liquidado: boolean("liquidado").notNull().default(false),
    created_at: timestamp("created_at").defaultNow(),
    updated_at: timestamp("updated_at").defaultNow(),
  });

  export const historico_liquidaciones_espejo = customSchema.table(
    "historico_liquidaciones_espejo",
    {
      id: serial("id").primaryKey(),
      monto_aportado: numeric("monto_aportado", { precision: 18, scale: 8 }).notNull(),
      fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),
      inversionista_id: integer("inversionista_id")
        .notNull()
        .references(() => inversionistas.inversionista_id, { onDelete: "cascade" }),
      credito_id: integer("credito_id")
        .notNull()
        .references(() => creditos.credito_id, { onDelete: "cascade" }),
      liquidacion_id: integer("liquidacion_id")
        .references(() => liquidaciones.liquidacion_id, { onDelete: "set null" }),
    },
    (t) => ({
      ixInvCred: index("ix_historico_liq_inv_cred").on(t.inversionista_id, t.credito_id),
      ixFecha: index("ix_historico_liq_fecha").on(t.fecha),
      ixLiquidacion: index("ix_historico_liq_liquidacion_id").on(t.liquidacion_id),
    })
  );

  // ── Recibos genéricos (sin FK a créditos) ──
  export const recibos_genericos = customSchema.table("recibos_genericos", {
    id: serial("id").primaryKey(),
    nombre: varchar("nombre", { length: 200 }).notNull(),
    observaciones: text("observaciones"),
    moneda: varchar("moneda", { length: 10 }).notNull().default("GTQ"),
    fecha: timestamp("fecha", { withTimezone: true })
      .notNull()
      .default(sql`NOW() AT TIME ZONE 'America/Guatemala'`),
    created_at: timestamp("created_at", { withTimezone: true })
      .default(sql`NOW() AT TIME ZONE 'America/Guatemala'`),
  });

  export const recibo_generico_montos = customSchema.table("recibo_generico_montos", {
    id: serial("id").primaryKey(),
    recibo_id: integer("recibo_id")
      .notNull()
      .references(() => recibos_genericos.id, { onDelete: "cascade" }),
    concepto: varchar("concepto", { length: 300 }).notNull(),
    monto: numeric("monto", { precision: 18, scale: 2 }).notNull(),
  });

  // ── Historial de cambios de monto_aportado en creditos_inversionistas_espejo ──
  export const historico_monto_aportado_espejo = customSchema.table(
    "historico_monto_aportado_espejo",
    {
      id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
      txid: bigint("txid", { mode: "number" }).notNull(),
      operacion: text("operacion").notNull(),
      credito_id: integer("credito_id").notNull().references(() => creditos.credito_id, { onDelete: "cascade" }),
      inversionista_id: integer("inversionista_id").notNull().references(() => inversionistas.inversionista_id, { onDelete: "cascade" }),
      monto_anterior: numeric("monto_anterior", { precision: 18, scale: 8 }),
      monto_nuevo: numeric("monto_nuevo", { precision: 18, scale: 8 }),
      platform_user_id: integer("platform_user_id").references(() => platform_users.id, { onDelete: "set null" }),
      user_email: varchar("user_email", { length: 200 }),
      source: text("source").notNull().default("unknown"),
      fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => ({
      ixTxid:   index("ix_hist_mont_txid").on(t.txid),
      ixCred:   index("ix_hist_mont_cred").on(t.credito_id, t.inversionista_id),
      ixFecha:  index("ix_hist_mont_fecha").on(t.fecha),
    })
  );

  // ── Audit logs ──
  export const audit_logs = customSchema.table("audit_logs", {
    id: serial("id").primaryKey(),
    user_id: integer("user_id"),
    user_email: varchar("user_email", { length: 200 }),
    method: varchar("method", { length: 10 }).notNull(),
    path: varchar("path", { length: 500 }).notNull(),
    status_code: integer("status_code"),
    body: text("body"),
    response: text("response"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW() AT TIME ZONE 'America/Guatemala'`),
  });
