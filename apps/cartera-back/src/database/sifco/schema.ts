import {
  pgTable,
  pgSchema,
  uuid,
  varchar,
  integer,
  numeric,
  boolean,
  text,
  timestamp,
  date,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

export const sifcoSchema = pgSchema("sifco");

// =============================================
// CLIENTES — consultarClientesPorEmail
// =============================================
export const clientes = sifcoSchema.table("clientes", {
  codigo_cliente: varchar("codigo_cliente", { length: 50 }).primaryKey(),
  nombre_completo: varchar("nombre_completo", { length: 300 }).notNull(),
  codigo_referencia: varchar("codigo_referencia", { length: 100 }),
  email_principal: varchar("email_principal", { length: 250 }),
  email_secundario: varchar("email_secundario", { length: 250 }),
  excluir_correos: integer("excluir_correos").default(0),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// =============================================
// PRESTAMOS — consultarPrestamoDetalle
// =============================================
export const prestamos = sifcoSchema.table(
  "prestamos",
  {
    pre_numero: varchar("pre_numero", { length: 50 }).primaryKey(),
    pre_correlativo: varchar("pre_correlativo", { length: 50 }),
    pre_nombre: varchar("pre_nombre", { length: 300 }),

    // Cliente
    pre_cli_cod: varchar("pre_cli_cod", { length: 50 })
      .notNull()
      .references(() => clientes.codigo_cliente),
    pre_cli_nom: varchar("pre_cli_nom", { length: 300 }),
    pre_cli_promotor: varchar("pre_cli_promotor", { length: 200 }),

    // Producto
    pre_prd_cod: integer("pre_prd_cod"),
    pre_prd_nombre: varchar("pre_prd_nombre", { length: 200 }),
    pre_prd_tipo: integer("pre_prd_tipo"),

    // Montos
    pre_mon_original: numeric("pre_mon_original", { precision: 18, scale: 2 }),
    pre_mon_total: numeric("pre_mon_total", { precision: 18, scale: 2 }),
    pre_sal_capital: numeric("pre_sal_capital", { precision: 18, scale: 2 }),
    pre_cap_atrasado: numeric("pre_cap_atrasado", { precision: 18, scale: 2 }),
    pre_val_cuota: numeric("pre_val_cuota", { precision: 18, scale: 2 }),

    // Intereses
    pre_tasa_base: numeric("pre_tasa_base", { precision: 10, scale: 6 }),
    pre_base_mora: numeric("pre_base_mora", { precision: 10, scale: 6 }),
    pre_int_mes: numeric("pre_int_mes", { precision: 18, scale: 2 }),
    pre_int_acumulado: numeric("pre_int_acumulado", { precision: 18, scale: 2 }),
    pre_int_vencido: numeric("pre_int_vencido", { precision: 18, scale: 2 }),
    pre_int_mora: numeric("pre_int_mora", { precision: 18, scale: 2 }),
    pre_int_anticipado: numeric("pre_int_anticipado", { precision: 18, scale: 2 }),
    pre_int_devengado: numeric("pre_int_devengado", { precision: 18, scale: 2 }),

    // Plazos y cuotas
    pre_plazo: integer("pre_plazo"),
    pre_num_cuotas: integer("pre_num_cuotas"),
    pre_fac_plazo: integer("pre_fac_plazo"),
    pre_periodo_frecuencia: varchar("pre_periodo_frecuencia", { length: 10 }),
    pre_dia_pago: integer("pre_dia_pago"),

    // Fechas
    pre_fec_aprobacion: varchar("pre_fec_aprobacion", { length: 20 }),
    pre_fec_concesion: varchar("pre_fec_concesion", { length: 20 }),
    pre_fec_vencimiento: varchar("pre_fec_vencimiento", { length: 20 }),
    pre_fec_1_cap: varchar("pre_fec_1_cap", { length: 20 }),
    pre_fec_1_int: varchar("pre_fec_1_int", { length: 20 }),
    pre_fec_p_cap: varchar("pre_fec_p_cap", { length: 20 }),
    pre_fec_p_int: varchar("pre_fec_p_int", { length: 20 }),
    pre_fec_u_cap: varchar("pre_fec_u_cap", { length: 20 }),
    pre_fec_u_int: varchar("pre_fec_u_int", { length: 20 }),

    // Moneda
    pre_moneda_cod: integer("pre_moneda_cod"),
    pre_moneda_nombre: varchar("pre_moneda_nombre", { length: 50 }),
    pre_moneda_simbolo: varchar("pre_moneda_simbolo", { length: 10 }),

    // Estado
    ap_est_cod: varchar("ap_est_cod", { length: 10 }),
    ap_est_des: varchar("ap_est_des", { length: 100 }),
    pre_estado: boolean("pre_estado"),
    pre_anulado: varchar("pre_anulado", { length: 5 }),

    // Garantía
    pre_gar_cod: integer("pre_gar_cod"),
    pre_gar_des: varchar("pre_gar_des", { length: 200 }),

    // Categoría
    ap_cac_cod: integer("ap_cac_cod"),
    ap_cac_des: varchar("ap_cac_des", { length: 100 }),

    // Refinanciamiento
    pre_numero_refinanciamiento: varchar("pre_numero_refinanciamiento", { length: 50 }),
    pre_tipo_credito: integer("pre_tipo_credito"),

    // Referencia
    pre_referencia: varchar("pre_referencia", { length: 100 }),
    pre_ref_externo: varchar("pre_ref_externo", { length: 100 }),
    pre_comentario: text("pre_comentario"),

    // División
    pre_division_destino: varchar("pre_division_destino", { length: 100 }),
    pre_division_origen: varchar("pre_division_origen", { length: 100 }),
    pre_division_es_originado: boolean("pre_division_es_originado"),
    pre_division_es_originador: boolean("pre_division_es_originador"),

    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("idx_prestamos_cli_cod").on(table.pre_cli_cod)]
);

// =============================================
// RECARGOS LIBRES — consultarRecargosLibres
// =============================================
export const recargos = sifcoSchema.table(
  "recargos",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    pre_numero: varchar("pre_numero", { length: 50 })
      .notNull()
      .references(() => prestamos.pre_numero),
    nombre_prestamo: varchar("nombre_prestamo", { length: 300 }),
    codigo_saldo: integer("codigo_saldo"),
    descripcion_codigo_saldo: varchar("descripcion_codigo_saldo", { length: 200 }),
    valor_saldo: numeric("valor_saldo", { precision: 18, scale: 2 }),
    fecha_proximo_pago: varchar("fecha_proximo_pago", { length: 20 }),
    fecha_ultimo_pago: varchar("fecha_ultimo_pago", { length: 20 }),
    valor_recargo_usuario: numeric("valor_recargo_usuario", { precision: 18, scale: 2 }),
    usuario_actualizo: varchar("usuario_actualizo", { length: 100 }),
    fecha_actualizacion: varchar("fecha_actualizacion", { length: 20 }),
    cuenta_acreditacion: varchar("cuenta_acreditacion", { length: 100 }),
    nombre_cuenta_acreditacion: varchar("nombre_cuenta_acreditacion", { length: 200 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("idx_recargos_pre_numero").on(table.pre_numero)]
);

// =============================================
// ESTADO DE CUENTA — consultarEstadoCuentaPrestamo
// Transacciones del estado de cuenta
// =============================================
export const estado_cuenta_transacciones = sifcoSchema.table(
  "estado_cuenta_transacciones",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    pre_numero: varchar("pre_numero", { length: 50 })
      .notNull()
      .references(() => prestamos.pre_numero),
    numero_movimiento: varchar("numero_movimiento", { length: 50 }),
    usuario_cod: varchar("usuario_cod", { length: 50 }),
    trx_cod: integer("trx_cod"),
    trx_descripcion: varchar("trx_descripcion", { length: 200 }),
    fecha_transaccion: varchar("fecha_transaccion", { length: 20 }),
    hora_transaccion: varchar("hora_transaccion", { length: 20 }),
    fecha_valor: varchar("fecha_valor", { length: 20 }),
    estado: integer("estado"),
    forma_pago: integer("forma_pago"),
    capital_desembolsado: numeric("capital_desembolsado", { precision: 18, scale: 2 }),
    capital_pagado: numeric("capital_pagado", { precision: 18, scale: 2 }),
    interes: numeric("interes", { precision: 18, scale: 2 }),
    interes_moratorio: numeric("interes_moratorio", { precision: 18, scale: 2 }),
    otros: numeric("otros", { precision: 18, scale: 2 }),
    saldo_capital: numeric("saldo_capital", { precision: 18, scale: 2 }),
    referencia: varchar("referencia", { length: 200 }),
    num_documento: varchar("num_documento", { length: 100 }),
    factura_serie: varchar("factura_serie", { length: 50 }),
    factura_correlativo: varchar("factura_correlativo", { length: 50 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_estado_cuenta_pre_numero").on(table.pre_numero),
    index("idx_estado_cuenta_fecha").on(table.fecha_transaccion),
  ]
);

// =============================================
// ESTADO DE CUENTA DETALLES
// Detalles de cada transacción (CAPITAL, ROYALTY, etc.)
// =============================================
export const estado_cuenta_detalles = sifcoSchema.table(
  "estado_cuenta_detalles",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    transaccion_id: uuid("transaccion_id")
      .notNull()
      .references(() => estado_cuenta_transacciones.id),
    codigo_saldo: integer("codigo_saldo"),
    descripcion_saldo: varchar("descripcion_saldo", { length: 200 }),
    valor: numeric("valor", { precision: 18, scale: 2 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
  }
);

// =============================================
// PLAN DE PAGOS — parte del estado de cuenta
// =============================================
export const plan_pagos = sifcoSchema.table(
  "plan_pagos",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    pre_numero: varchar("pre_numero", { length: 50 })
      .notNull()
      .references(() => prestamos.pre_numero),
    fecha: varchar("fecha", { length: 20 }),

    // Capital
    capital_numero_cuota: integer("capital_numero_cuota"),
    capital_monto: numeric("capital_monto", { precision: 18, scale: 2 }),
    capital_abonado: numeric("capital_abonado", { precision: 18, scale: 2 }),
    capital_atrasado: varchar("capital_atrasado", { length: 5 }),
    capital_pagado: varchar("capital_pagado", { length: 5 }),
    capital_saldo: numeric("capital_saldo", { precision: 18, scale: 2 }),
    capital_estado: varchar("capital_estado", { length: 20 }),
    capital_movimiento: varchar("capital_movimiento", { length: 20 }),
    capital_mora_monto: numeric("capital_mora_monto", { precision: 18, scale: 2 }),
    capital_mora_valor_pagado: numeric("capital_mora_valor_pagado", { precision: 18, scale: 2 }),
    capital_mora_pagada: varchar("capital_mora_pagada", { length: 5 }),
    capital_mora_saldo: numeric("capital_mora_saldo", { precision: 18, scale: 2 }),
    capital_mora_dias: integer("capital_mora_dias"),

    // Interés
    interes_numero_cuota: integer("interes_numero_cuota"),
    interes_monto: numeric("interes_monto", { precision: 18, scale: 2 }),
    interes_abonado: numeric("interes_abonado", { precision: 18, scale: 2 }),
    interes_atrasado: varchar("interes_atrasado", { length: 5 }),
    interes_pagado: varchar("interes_pagado", { length: 5 }),
    interes_saldo: numeric("interes_saldo", { precision: 18, scale: 2 }),
    interes_estado: varchar("interes_estado", { length: 20 }),
    interes_movimiento: varchar("interes_movimiento", { length: 20 }),
    interes_mora_monto: numeric("interes_mora_monto", { precision: 18, scale: 2 }),
    interes_mora_valor_pagado: numeric("interes_mora_valor_pagado", { precision: 18, scale: 2 }),
    interes_mora_pagada: varchar("interes_mora_pagada", { length: 5 }),
    interes_mora_saldo: numeric("interes_mora_saldo", { precision: 18, scale: 2 }),
    interes_mora_dias: integer("interes_mora_dias"),

    // Otros
    otros_monto: numeric("otros_monto", { precision: 18, scale: 2 }),
    prestamo: varchar("prestamo", { length: 50 }),

    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_plan_pagos_pre_numero").on(table.pre_numero),
    index("idx_plan_pagos_cuota").on(table.capital_numero_cuota),
  ]
);

// =============================================
// PLAN DE PAGOS OTROS — cargos adicionales por cuota
// (CUOTA SEGURO DAÑOS, MEMBRESIA, etc.)
// =============================================
export const plan_pagos_otros = sifcoSchema.table(
  "plan_pagos_otros",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    plan_pago_id: uuid("plan_pago_id")
      .notNull()
      .references(() => plan_pagos.id),
    numero_cuota: integer("numero_cuota"),
    monto: numeric("monto", { precision: 18, scale: 2 }),
    abonado: numeric("abonado", { precision: 18, scale: 2 }),
    atrasado: varchar("atrasado", { length: 5 }),
    pagado: varchar("pagado", { length: 5 }),
    saldo: integer("saldo"),
    saldo_descripcion: varchar("saldo_descripcion", { length: 200 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("idx_plan_pagos_otros_plan_pago").on(table.plan_pago_id)]
);

// =============================================
// RELACIONES
// =============================================
export const clientesRelations = relations(clientes, ({ many }) => ({
  prestamos: many(prestamos),
}));

export const prestamosRelations = relations(prestamos, ({ one, many }) => ({
  cliente: one(clientes, {
    fields: [prestamos.pre_cli_cod],
    references: [clientes.codigo_cliente],
  }),
  recargos: many(recargos),
  transacciones: many(estado_cuenta_transacciones),
  plan_pagos: many(plan_pagos),
}));

export const recargosRelations = relations(recargos, ({ one }) => ({
  prestamo: one(prestamos, {
    fields: [recargos.pre_numero],
    references: [prestamos.pre_numero],
  }),
}));

export const transaccionesRelations = relations(
  estado_cuenta_transacciones,
  ({ one, many }) => ({
    prestamo: one(prestamos, {
      fields: [estado_cuenta_transacciones.pre_numero],
      references: [prestamos.pre_numero],
    }),
    detalles: many(estado_cuenta_detalles),
  })
);

export const detallesRelations = relations(estado_cuenta_detalles, ({ one }) => ({
  transaccion: one(estado_cuenta_transacciones, {
    fields: [estado_cuenta_detalles.transaccion_id],
    references: [estado_cuenta_transacciones.id],
  }),
}));

export const planPagosRelations = relations(plan_pagos, ({ one, many }) => ({
  prestamo: one(prestamos, {
    fields: [plan_pagos.pre_numero],
    references: [prestamos.pre_numero],
  }),
  otros: many(plan_pagos_otros),
}));

export const planPagosOtrosRelations = relations(plan_pagos_otros, ({ one }) => ({
  plan_pago: one(plan_pagos, {
    fields: [plan_pagos_otros.plan_pago_id],
    references: [plan_pagos.id],
  }),
}));
