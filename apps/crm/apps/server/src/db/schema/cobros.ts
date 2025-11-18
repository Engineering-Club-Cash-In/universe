import {
	boolean,
	decimal,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { clients } from "./crm";
import { vehicles } from "./vehicles";

// Enums para cobros
export const estadoMoraEnum = pgEnum("estado_mora", [
	"al_dia", // Pagos al día
	"mora_30", // 1-30 días de retraso
	"mora_60", // 31-60 días de retraso
	"mora_90", // 61-90 días de retraso
	"mora_120", // 91-120 días de retraso
	"mora_120_plus", // Más de 120 días
	"pagado", // Totalmente pagado
	"incobrable", // Declarado incobrable
]);

export const metodoContactoEnum = pgEnum("metodo_contacto", [
	"llamada",
	"whatsapp",
	"email",
	"visita_domicilio",
	"carta_notarial",
]);

export const estadoContactoEnum = pgEnum("estado_contacto", [
	"contactado",
	"no_contesta",
	"numero_equivocado",
	"promesa_pago",
	"acuerdo_parcial",
	"rechaza_pagar",
]);

export const tipoRecuperacionEnum = pgEnum("tipo_recuperacion", [
	"entrega_voluntaria",
	"tomado",
	"orden_secuestro",
]);

export const estadoContratoEnum = pgEnum("estado_contrato", [
	"activo",
	"completado",
	"incobrable",
	"recuperado",
]);

// Contratos de financiamiento - Cuando una opportunity se cierra como "won"
export const contratosFinanciamiento = pgTable("contratos_financiamiento", {
	id: uuid("id").primaryKey().defaultRandom(),
	clientId: uuid("client_id")
		.notNull()
		.references(() => clients.id),
	vehicleId: uuid("vehicle_id")
		.notNull()
		.references(() => vehicles.id),

	// Términos del contrato
	montoFinanciado: decimal("monto_financiado", {
		precision: 12,
		scale: 2,
	}).notNull(),
	cuotaMensual: decimal("cuota_mensual", { precision: 12, scale: 2 }).notNull(),
	numeroCuotas: integer("numero_cuotas").notNull(),
	tasaInteres: decimal("tasa_interes", { precision: 5, scale: 2 }).notNull(),

	// Fechas importantes
	fechaInicio: timestamp("fecha_inicio").notNull(),
	fechaVencimiento: timestamp("fecha_vencimiento").notNull(),
	diaPagoMensual: integer("dia_pago_mensual").notNull().default(15), // día del mes para pago

	// Estado del contrato
	estado: estadoContratoEnum("estado").notNull().default("activo"),

	// Responsable de cobros asignado
	responsableCobros: text("responsable_cobros").references(() => user.id),

	// General notes
	notes: text("notes"),

	// Metadata
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
	createdBy: text("created_by")
		.notNull()
		.references(() => user.id),
});

// Cuotas individuales del contrato
export const cuotasPago = pgTable("cuotas_pago", {
	id: uuid("id").primaryKey().defaultRandom(),
	contratoId: uuid("contrato_id")
		.notNull()
		.references(() => contratosFinanciamiento.id, { onDelete: "cascade" }),

	numeroCuota: integer("numero_cuota").notNull(),
	fechaVencimiento: timestamp("fecha_vencimiento").notNull(),
	montoCuota: decimal("monto_cuota", { precision: 12, scale: 2 }).notNull(),

	// Información de pago
	fechaPago: timestamp("fecha_pago"),
	montoPagado: decimal("monto_pagado", { precision: 12, scale: 2 }),
	montoMora: decimal("monto_mora", { precision: 12, scale: 2 }).default("0.00"),

	// Estado de la cuota
	estadoMora: estadoMoraEnum("estado_mora").notNull().default("al_dia"),
	diasMora: integer("dias_mora").default(0),

	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Casos de cobros - Se crean cuando hay cuotas en mora
export const casosCobros = pgTable("casos_cobros", {
	id: uuid("id").primaryKey().defaultRandom(),
	contratoId: uuid("contrato_id")
		.notNull()
		.references(() => contratosFinanciamiento.id),

	// Referencia a cartera-back (nullable para compatibilidad con datos legacy)
	numeroCreditoSifco: text("numero_credito_sifco"),

	// Estado actual del caso
	estadoMora: estadoMoraEnum("estado_mora").notNull(),
	montoEnMora: decimal("monto_en_mora", { precision: 12, scale: 2 }).notNull(),
	diasMoraMaximo: integer("dias_mora_maximo").notNull(),
	cuotasVencidas: integer("cuotas_vencidas").notNull(),

	// Asignación
	responsableCobros: text("responsable_cobros")
		.notNull()
		.references(() => user.id),

	// Información de contacto del cliente
	telefonoPrincipal: text("telefono_principal").notNull(),
	telefonoAlternativo: text("telefono_alternativo"),
	emailContacto: text("email_contacto").notNull(),
	direccionContacto: text("direccion_contacto").notNull(),

	// Próximo contacto programado
	proximoContacto: timestamp("proximo_contacto"),
	metodoContactoProximo: metodoContactoEnum("metodo_contacto_proximo"),

	// Estado del caso
	activo: boolean("activo").default(true),

	// General notes
	notes: text("notes"),

	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Historial de contactos de cobros
export const contactosCobros = pgTable("contactos_cobros", {
	id: uuid("id").primaryKey().defaultRandom(),
	casoCobroId: uuid("caso_cobro_id")
		.notNull()
		.references(() => casosCobros.id, { onDelete: "cascade" }),

	// Información del contacto
	fechaContacto: timestamp("fecha_contacto").notNull().defaultNow(),
	metodoContacto: metodoContactoEnum("metodo_contacto").notNull(),
	estadoContacto: estadoContactoEnum("estado_contacto").notNull(),

	// Detalles del contacto
	duracionLlamada: integer("duracion_llamada"), // en segundos
	comentarios: text("comentarios").notNull(),
	acuerdosAlcanzados: text("acuerdos_alcanzados"),
	compromisosPago: text("compromisos_pago"),

	// Próximo seguimiento
	requiereSeguimiento: boolean("requiere_seguimiento").default(false),
	fechaProximoContacto: timestamp("fecha_proximo_contacto"),

	// Usuario que realizó el contacto
	realizadoPor: text("realizado_por")
		.notNull()
		.references(() => user.id),

	createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Convenios de pago especiales
export const conveniosPago = pgTable("convenios_pago", {
	id: uuid("id").primaryKey().defaultRandom(),
	casoCobroId: uuid("caso_cobro_id")
		.notNull()
		.references(() => casosCobros.id),

	// Términos del convenio
	montoAcordado: decimal("monto_acordado", {
		precision: 12,
		scale: 2,
	}).notNull(),
	numeroCuotasConvenio: integer("numero_cuotas_convenio").notNull(),
	montoCuotaConvenio: decimal("monto_cuota_convenio", {
		precision: 12,
		scale: 2,
	}).notNull(),
	fechaInicioConvenio: timestamp("fecha_inicio_convenio").notNull(),

	// Estado del convenio
	activo: boolean("activo").default(true),
	cumplido: boolean("cumplido").default(false),
	cuotasCumplidas: integer("cuotas_cumplidas").default(0),

	// Observaciones
	condicionesEspeciales: text("condiciones_especiales"),

	// Aprobación
	aprobadoPor: text("aprobado_por")
		.notNull()
		.references(() => user.id),
	fechaAprobacion: timestamp("fecha_aprobacion").notNull().defaultNow(),

	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Recuperaciones de vehículos
export const recuperacionesVehiculo = pgTable("recuperaciones_vehiculo", {
	id: uuid("id").primaryKey().defaultRandom(),
	casoCobroId: uuid("caso_cobro_id")
		.notNull()
		.references(() => casosCobros.id),

	// Tipo de recuperación
	tipoRecuperacion: tipoRecuperacionEnum("tipo_recuperacion").notNull(),
	fechaRecuperacion: timestamp("fecha_recuperacion"),

	// Proceso legal
	ordenSecuestro: boolean("orden_secuestro").default(false),
	numeroExpediente: text("numero_expediente"),
	juzgadoCompetente: text("juzgado_competente"),

	// Estado de la recuperación
	completada: boolean("completada").default(false),
	observaciones: text("observaciones"),

	// Responsables
	responsableRecuperacion: text("responsable_recuperacion").references(
		() => user.id,
	),

	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Notificaciones automáticas de cobros
export const notificacionesCobros = pgTable("notificaciones_cobros", {
	id: uuid("id").primaryKey().defaultRandom(),
	casoCobroId: uuid("caso_cobro_id")
		.notNull()
		.references(() => casosCobros.id),

	// Tipo de notificación
	tipoNotificacion: text("tipo_notificacion").notNull(), // "vencimiento_proximo", "mora_30", etc.
	canal: metodoContactoEnum("canal").notNull(),

	// Contenido
	asunto: text("asunto").notNull(),
	mensaje: text("mensaje").notNull(),

	// Estado de envío
	enviada: boolean("enviada").default(false),
	fechaEnvio: timestamp("fecha_envio"),
	respuesta: text("respuesta"), // respuesta del cliente si la hay

	// Programación
	fechaProgramada: timestamp("fecha_programada").notNull(),

	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
