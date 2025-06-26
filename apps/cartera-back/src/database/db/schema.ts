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
} from "drizzle-orm/pg-core";
export enum CategoriaUsuario {
  CV_VEHICULO_NUEVO = "CV Vehículo nuevo",
  VEHICULO = "Vehículo",
  CV_VEHICULO = "CV Vehículo",
}export const customSchema = pgSchema('cartera');

// 1. Usuarios
export const usuarios = customSchema.table("usuarios", {
  usuario_id: serial("usuario_id").primaryKey(),
  nombre: varchar("nombre", { length: 200 }).notNull(),
  nit: varchar("nit", { length: 30 }),
  categoria: varchar("categoria", { length: 100 }),
  como_se_entero: varchar("como_se_entero", { length: 100 }),
    saldo_a_favor: numeric("saldo_a_favor", { precision: 18, scale: 2 })
    .notNull()
    .default("0"),
});

// 2. Créditos

export const creditos = customSchema.table("creditos", {
  credito_id: serial("credito_id").primaryKey(),
  usuario_id: integer("usuario_id").notNull(),
  fecha_creacion: timestamp("fecha_creacion", { withTimezone: true })
    .notNull()
    .defaultNow(),
 numero_credito_sifco: varchar("numero_credito_sifco", { length: 40 }).notNull().unique(),

  capital: numeric("capital", { precision: 18, scale: 2 }).notNull(),
  porcentaje_interes: numeric("porcentaje_interes", {
    precision: 5,
    scale: 2,
  }).notNull(),
  deudatotal: numeric("deudatotal", { precision: 18, scale: 2 }).notNull(),
  cuota_interes: numeric("cuota_interes", { precision: 18, scale: 2 }).notNull(),
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


  inversionista_id: integer("inversionista_id").references(
    () => inversionistas.inversionista_id
  ),
  porcentaje_participacion_inversionista: numeric("porcentaje_participacion_inversionista", {
    precision: 5,
    scale: 2,
  }).notNull(),
  monto_asignado_inversionista: numeric("monto_asignado_inversionista", {
    precision: 18,
    scale: 2,
  }).notNull(),
  iva_inversionista: numeric("iva_inversionista", { precision: 18, scale: 2 })
    .notNull()
    .default("0"),

  porcentaje_cash_in: numeric("porcentaje_cash_in", {
    precision: 5,
    scale: 2,
  }).notNull(),
  cuota_cash_in: numeric("cuota_cash_in", {
    precision: 18,
    scale: 2,
  }).notNull(),
  iva_cash_in: numeric("iva_cash_in", { precision: 18, scale: 2 }).notNull(),

  membresias_pago: numeric("membresias_pago" ,{ precision: 18, scale: 2 }).notNull(),

  membresias : numeric("membresias" ,{ precision: 18, scale: 2 }).notNull(),

  formato_credito: varchar("formato_credito", { length: 50 }).notNull(), 

});

// 3. Pagos de crédito

export const pagos_credito = customSchema.table("pagos_credito", {
  pago_id: serial("pago_id").primaryKey(),
  credito_id: integer("credito_id").references(() => creditos.credito_id), //inpujt
  cuota: numeric("cuota").notNull(), //esto viene del credito
  cuota_interes: numeric("cuota_interes").notNull(), //esto viene del credito
  numero_cuota: integer("numero_cuota").notNull(), 
  fecha_pago: date("fecha_pago").notNull(), //esto viene del credito
  abono_capital: numeric("abono_capital", { precision: 18, scale: 2 }), //aca abonamos a capital solo si el monto de la cuota que viene del credito es igual al monto de la boleta y se van a restar todos los abonos

  abono_interes: numeric("abono_interes", { precision: 18, scale: 2 }), // aca jala el interes del credito si ? pero solo si  el monto de la boleta  es igual al de la cuota 
  abono_iva_12: numeric("abono_iva_12", { precision: 18, scale: 2 }), //aca el iva_12 del capital solo si el monto de la boleta es igual al de la cuota
  abono_interes_ci: numeric("abono_interes_ci", { precision: 18, scale: 2 }), //viene del creditosolo si el monto de la boleta es igual al de la cuota
  abono_iva_ci: numeric("abono_iva_ci", { precision: 18, scale: 2 }), //viene del credito solo si el monto de la boleta es igual al de la cuota
  abono_seguro: numeric("abono_seguro", { precision: 18, scale: 2 }),// el seguro viene del credito solo si el monto de la boleta es igual al de la cuota
  abono_gps: numeric("abono_gps", { precision: 18, scale: 2 }),// el gps viene del credito solo si el monto de la boleta es igual al de la cuota
  pago_del_mes: numeric("pago_del_mes", { precision: 18, scale: 2 }), // la sumatoria de todos los abonos

  llamada: varchar("llamada", { length: 100 }),// ""
 
  monto_boleta: numeric("monto_boleta", { precision: 18, scale: 2 }), // esto si viene del input
  fecha_filtro: date("fecha_filtro"), // viene del credito

  renuevo_o_nuevo: varchar("renuevo_o_nuevo", { length: 50 }), //input
  

  capital_restante: numeric("capital_restante", { precision: 18, scale: 2 }), //capital menos la cuota si ? pero solo solo si el monto de la boleta es igual al de la cuota
  interes_restante: numeric("interes_restante", { precision: 18, scale: 2 }), //aca lo que viene del credito cuota_interes menos abono_interes
  iva_12_restante: numeric("iva_12_restante", { precision: 18, scale: 2 }),//aca lo que viene del credito si iva 12  menos  abono_iva12
  seguro_restante: numeric("seguro_restante", { precision: 18, scale: 2 }), //aca lo que viene del credito seguro menos abono_seguro
  gps_restante: numeric("gps_restante", { precision: 18, scale: 2 }), //aca lo que viene del credito gps menos abono_gps
  total_restante: numeric("total_restante", { precision: 18, scale: 2 }),  //deuda de lo que viene del credito menos la suma del pago del mes
  tipoCredito: varchar("tipocredito", { length: 100 }), 
  membresias: integer("membresias"), // se jala del credito
  membresias_pago: integer("membresias_pago"), // se jala del credito

  membresias_mes: integer("membresias_mes"), // se jala del credito

  otros: text("otros"), //input
  mora: numeric("mora", { precision: 18, scale: 2 }),//input
  monto_boleta_cuota: numeric("monto_boleta_cuota", {//input
    precision: 18,
    scale: 2,
  }),
  seguro_total: numeric("seguro_total", { precision: 18, scale: 2 }), //viene del credito
  
  pagado: boolean("pagado").default(false), // true solo si el monto de la boleta es igual al de la cuota
  facturacion: varchar("facturacion").default("si"),  // hay que ir a ver el inversionista del prestamo para ver si emite factura o no
  mes_pagado: varchar("mes_pagado", { length: 20 }), // mes actual que se esta efectuando el pago
  seguro_facturado: numeric("seguro_facturado", { precision: 18, scale: 2 }), //viene del credito
  gps_facturado: numeric("gps_facturado", { precision: 18, scale: 2 }), //viene del credito
  reserva: numeric("reserva", { precision: 18, scale: 2 }), //seguro + 600
observaciones: text("observaciones"), //input
});

export const inversionistas = customSchema.table("inversionistas", {
  inversionista_id: serial("inversionista_id").primaryKey(),
  nombre: varchar("nombre", { length: 200 }).notNull(),
  emite_factura: boolean("emite_factura").notNull(), // true=Sí, false=No

});
export const asesores = customSchema.table("asesores", {
  asesor_id: serial("asesor_id").primaryKey(),
  nombre: varchar("nombre", { length: 100 }).notNull(),
  activo: boolean("activo"), // puedes usar boolean si prefieres
});

 