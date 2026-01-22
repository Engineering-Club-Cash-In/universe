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
  export enum CategoriaUsuario {
    CV_VEHICULO_NUEVO = "CV Vehículo nuevo",
    VEHICULO = "Vehículo",
    CV_VEHICULO = "CV Vehículo",
  }
  export const userRoleEnum = pgEnum("user_role", ["ADMIN", "ASESOR","CONTA"]);
  export const customSchema = pgSchema("cartera");
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
      enum: ["ACTIVO", "CANCELADO", "INCOBRABLE", "PENDIENTE_CANCELACION","MOROSO", "EN_CONVENIO"],
    })
      .notNull()
      .default(StatusCredit.ACTIVO),
    otros: numeric("otros", { precision: 18, scale: 2 }).notNull().default("0"), // Otros cargos o pagos adicionales
  });
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

  export const creditos_rubros_otros = customSchema.table("creditos_rubros_otros", {
    id: serial("id").primaryKey(),
    credito_id: integer("credito_id")
      .notNull()
      .references(() => creditos.credito_id, { onDelete: "cascade" }),
    nombre_rubro: varchar("nombre_rubro", { length: 100 }).notNull(),
    monto: numeric("monto", { precision: 18, scale: 2 }).notNull().default("0"),
  });

  // 3. Pagos de crédito
  export const paymentValidationStatus = pgEnum('payment_validation_status', [
    'no_required',    // No necesita validación (pagos normales/automáticos)
    'pending',        // Pendiente de validación
    'validated',        // Validado
    'capital',
    'reset'
  ]);

  export const pagos_credito = customSchema.table("pagos_credito", {
    pago_id: serial("pago_id").primaryKey(),
    credito_id: integer("credito_id").references(() => creditos.credito_id), //inpujt
    cuota: numeric("cuota").notNull(), //esto viene del credito
    cuota_interes: numeric("cuota_interes").notNull(), //esto viene del credito
    cuota_id: integer("cuota_id")
      .references(() => cuotas_credito.cuota_id)
      .notNull(),
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
      porcentaje_participacion_inversionista: numeric("porcentaje_participacion_inversionista", { precision: 5, scale: 2 }).notNull(),
      monto_aportado: numeric("monto_aportado", { precision: 18, scale: 2 }).notNull(),
      porcentaje_cash_in: numeric("porcentaje_cash_in", { precision: 5, scale: 2 }).notNull().default("0"),
      iva_inversionista: numeric("iva_inversionista", { precision: 18, scale: 2 }).notNull().default("0"),
      iva_cash_in: numeric("iva_cash_in", { precision: 18 }).notNull().default("0"),
      fecha_creacion: timestamp("fecha_creacion", { withTimezone: true }).notNull().$default(() => new Date()),
      monto_inversionista: numeric("monto_inversionista", { precision: 18, scale: 2 }).notNull().default("0"),
      monto_cash_in: numeric("monto_cash_in", { precision: 18, scale: 2 }).notNull(),
    },
    (t) => ({
      uxCreditoInv: uniqueIndex("ux_credito_inversionista").on(t.credito_id, t.inversionista_id),
    })
  );
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
        precision: 5,
        scale: 2,
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
  export const bancos = customSchema.table('bancos', {
    banco_id: serial('banco_id').primaryKey(),
    nombre: varchar('nombre', { length: 100 }).notNull().unique(),
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

    export const tipoReinversionEnum = customSchema.enum("tipo_reinversion", [
      "sin_reinversion",
      "reinversion_capital",
      "reinversion_interes",
      "reinversion_total"
    ]);


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
    fechaCreacion: timestamp("fecha_creacion").defaultNow().notNull(),
    fechaActualizacion: timestamp("fecha_actualizacion").defaultNow().notNull(),
  });


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
    
    // 🔥 CAMBIO: Ahora enlazamos por PAGO en lugar de CRÉDITO
    pago_id: integer("pago_id")
      .notNull() // 👈 OBLIGATORIO
      .references(() => pagos_credito.pago_id, { onDelete: "cascade" }),
    
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