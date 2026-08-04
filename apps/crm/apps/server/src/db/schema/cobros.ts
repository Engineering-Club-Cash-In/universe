import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	decimal,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { clients } from "./crm";
import { vehicles } from "./vehicles";

// Enums para cobros
export const estadoMoraEnum = pgEnum("estado_mora", [
	"al_dia", // Pagos al día
	"en_convenio", // Crédito con convenio de pago activo
	"mora_30", // 1-30 días de retraso
	"mora_60", // 31-60 días de retraso
	"mora_90", // 61-90 días de retraso
	"mora_120", // 91-120 días de retraso
	"mora_120_plus", // Más de 120 días
	"pagado", // Totalmente pagado
	"incobrable", // Declarado incobrable
]);

// CB-026: los 3 canales de la gestión temprana B1 son llamada / whatsapp /
// sms. `sms` se agregó a ESTE enum (no a uno aparte) porque el mismo tipo es
// la columna de 4 lugares — contactos_cobros.metodo_contacto,
// notificaciones_cobros.canal, seguimientos_programados.metodo_contacto y
// casos_cobros.metodo_contacto_proximo — y partirlo obligaría a mantener dos
// catálogos de canal en paralelo.
// AGREGAR un valor es aditivo y seguro: `ALTER TYPE ... ADD VALUE` no reescribe
// tabla ni toma lock exclusivo, y ninguna de las 4 columnas tiene CHECK ni
// índice parcial que enumere valores. QUITARLO después NO se puede en caliente
// (ver la nota de estado_contacto abajo) — el valor es irreversible en la
// práctica.
// Nota: el orden de este array es cosmético. `ADD VALUE` sin BEFORE/AFTER
// agrega la etiqueta al FINAL del orden de sort de Postgres; nadie hace
// ORDER BY sobre esta columna, así que la divergencia es inocua.
export const metodoContactoEnum = pgEnum("metodo_contacto", [
	"llamada",
	"whatsapp",
	"sms",
	"email",
	"visita_domicilio",
	"carta_notarial",
]);

// CB-025: catálogo de resultados PROVISIONAL — "Definición de listo" del
// ticket deja pendiente el catálogo final (qué cuenta como contacto
// efectivo, si "contactado" debe partirse en más resultados, etc.). Decisión
// de negocio sin cerrar, no técnica.
// Para AGREGAR un valor cuando negocio decida: `ALTER TYPE public.estado_contacto
// ADD VALUE 'nuevo_valor'` es seguro (no bloquea, no requiere rescribir tabla).
// Para QUITAR o RENOMBRAR uno existente: Postgres no lo permite directo sobre
// un pgEnum nativo — requiere crear un tipo nuevo, migrar la columna
// (`ALTER TABLE ... ALTER COLUMN ... TYPE nuevo_tipo USING ...`) y actualizar
// filas existentes. Si el catálogo final termina necesitando renombrar/quitar
// valores, considerar migrar esta columna de enum a texto libre + lista de
// valores válidos en TypeScript en ese momento — mucho más barato de cambiar
// después que un pgEnum.
export const estadoContactoEnum = pgEnum("estado_contacto", [
	"contactado",
	"no_contesta",
	"numero_equivocado",
	"promesa_pago",
	"acuerdo_parcial",
	"rechaza_pagar",
]);

// CB-020: estado de cumplimiento de una promesa de pago (solo aplica a filas
// con estadoContacto = 'promesa_pago'). Se deriva cruzando cuotaInicio/
// cuotaFin/incluyeMora contra el estado real del crédito en cartera-back
// (getEstadoPromesasPago) — nunca se marca a mano.
export const estadoPromesaEnum = pgEnum("estado_promesa", [
	"pendiente",
	"cumplida",
	"incumplida",
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
export const casosCobros = pgTable(
	"casos_cobros",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		contratoId: uuid("contrato_id").references(
			() => contratosFinanciamiento.id,
		),

		// Referencia a cartera-back (nullable para compatibilidad con datos legacy)
		numeroCreditoSifco: text("numero_credito_sifco"),

		// Estado actual del caso
		estadoMora: estadoMoraEnum("estado_mora").notNull(),
		montoEnMora: decimal("monto_en_mora", {
			precision: 12,
			scale: 2,
		}).notNull(),
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

		// Etiquetas del caso
		etiquetas: text("etiquetas").array().default([]),

		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => [
		index("idx_casos_cobros_activo_proximo_contacto").on(
			table.activo,
			table.proximoContacto,
		),
	],
);

// Historial de contactos de cobros
export const contactosCobros = pgTable(
	"contactos_cobros",
	{
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

		// CB-020: promesa de pago atada a cuotas concretas (no a una fecha
		// genérica) — solo aplican cuando estadoContacto = 'promesa_pago'.
		// cartera-back NO separa la mora por cuota (es un monto agregado del
		// crédito, ver moras_credito), por eso incluyeMora es independiente del
		// rango: puede haber rango sin mora, mora sin rango ("solo mora"), o
		// ambos. Ver getEstadoPromesasPago para la verificación.
		cuotaInicio: integer("cuota_inicio"),
		cuotaFin: integer("cuota_fin"),
		incluyeMora: boolean("incluye_mora").notNull().default(false),
		estadoPromesa: estadoPromesaEnum("estado_promesa"),
		// CB-025: monto que el cliente dijo que va a pagar. Informativo — NO lo
		// lee evaluarPromesa, cumplida/incumplida sigue viniendo solo de
		// cuota_inicio/cuota_fin/incluye_mora contra cartera-back. Opcional.
		montoComprometido: decimal("monto_comprometido", {
			precision: 12,
			scale: 2,
		}),

		// Próximo seguimiento
		requiereSeguimiento: boolean("requiere_seguimiento").default(false),
		fechaProximoContacto: timestamp("fecha_proximo_contacto"),
		// CB-029: "alerta programada" — cuándo avisar al asesor ANTES de que venza
		// la promesa (default = fecha prometida − 1 día, editable). El job diario
		// dispara la notificación promesa_por_vencer cuando fecha_alerta = hoy (GT).
		// Solo aplica a filas con estadoContacto = 'promesa_pago'.
		fechaAlerta: timestamp("fecha_alerta"),
		// CB-025: qué hacer en el próximo contacto (fechaProximoContacto solo
		// dice CUÁNDO, no QUÉ). Texto libre a propósito — el AC del ticket solo
		// pide "próximo paso", sin catálogo cerrado (ver nota en
		// estadoContactoEnum sobre catálogos pendientes de negocio).
		proximoPaso: text("proximo_paso"),

		// Usuario que realizó el contacto
		realizadoPor: text("realizado_por")
			.notNull()
			.references(() => user.id),

		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [
		index("idx_contactos_cobros_caso_fecha").on(
			table.casoCobroId,
			table.fechaContacto,
		),
	],
);

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

// Metas de mora mensuales (porcentajes objetivo globales)
export const categoriaMetaMoraEnum = pgEnum("categoria_meta_mora", [
	"mora_total",
	"mora_30",
	"mora_60",
	"mora_90",
	"mora_120",
]);

export const metasMoraCobros = pgTable("metas_mora_cobros", {
	id: uuid("id").primaryKey().defaultRandom(),

	// Período
	mes: integer("mes").notNull(), // 1-12
	anio: integer("anio").notNull(),

	// Categoría de mora
	categoria: categoriaMetaMoraEnum("categoria").notNull(),

	// Porcentaje objetivo (ej: 8.35 = 8.35%)
	valorObjetivo: decimal("valor_objetivo", {
		precision: 5,
		scale: 2,
	}).notNull(),

	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Seguimientos programados recurrentes para casos de cobros
export const seguimientosProgramados = pgTable(
	"seguimientos_programados",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		casoCobroId: uuid("caso_cobro_id")
			.notNull()
			.references(() => casosCobros.id, { onDelete: "cascade" }),
		agenteId: text("agente_id")
			.notNull()
			.references(() => user.id),
		metodoContacto: metodoContactoEnum("metodo_contacto").notNull(),
		intervaloDias: integer("intervalo_dias").notNull(),
		ocurrenciasMaximas: integer("ocurrencias_maximas"),
		ocurrenciasRealizadas: integer("ocurrencias_realizadas")
			.notNull()
			.default(0),
		fechaInicio: timestamp("fecha_inicio").notNull(),
		fechaFin: timestamp("fecha_fin"),
		presetOriginal: text("preset_original"),
		activo: boolean("activo").default(true),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => [
		check("intervalo_dias_positive", sql`${table.intervaloDias} > 0`),
	],
);

// CB-024: snapshot de cierre diario de cobros, DETALLE por crédito. Job corre
// 22:00 GT todos los días con dos orígenes distintos en la misma tabla
// (columna `tipo` los distingue):
//   - 'contacto': una fila por cada contacto real del día (INSERT ... ON
//     CONFLICT (contacto_id) DO NOTHING — un contacto ya registrado es
//     histórico inmutable, nunca se duplica en un re-run).
//   - 'subida'/'bajada': una fila por cada crédito que SALIÓ del bucket del
//     pool del asesor ese día, con su ruta (bucketAnterior → bucket). Se
//     reemplazan completos (DELETE + INSERT del día) porque son datos
//     derivados de cartera-back, recalculables en cada corrida.
// Los agregados (efectivos, promesas, subieron, bajaron) se calculan agrupando
// esta misma tabla — no se guardan aparte.
export const cierreCreditoTipoEnum = pgEnum("cierre_credito_tipo", [
	"contacto",
	"subida",
	"bajada",
]);

export const cierreDiarioCreditoCobros = pgTable(
	"cierre_diario_credito_cobros",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		fecha: date("fecha").notNull(),
		asesorId: text("asesor_id")
			.notNull()
			.references(() => user.id),
		tipo: cierreCreditoTipoEnum("tipo").notNull(),

		casoCobroId: uuid("caso_cobro_id").references(() => casosCobros.id),
		numeroCreditoSifco: text("numero_credito_sifco"),

		// Solo aplica cuando tipo='contacto'
		contactoId: uuid("contacto_id").references(() => contactosCobros.id),
		estadoContacto: estadoContactoEnum("estado_contacto"),
		// El cliente CONTESTÓ y el contacto fue manual del asesor. Categorías
		// excluyentes: 'promesa_pago' NO suma acá (cuenta como promesa aparte);
		// 'no_contesta'/'numero_equivocado' no cuentan en ninguna. Excluye además
		// los contactos automáticos del sistema, identificados por prefijo de
		// comentario (ver send-premora-reminders.ts y cobros.ts:createMassWhatsapp).
		esEfectivoManual: boolean("es_efectivo_manual").notNull().default(false),
		fechaContacto: timestamp("fecha_contacto"),

		// Solo aplican cuando tipo='subida'/'bajada' — la ruta del movimiento.
		bucketAnterior: integer("bucket_anterior"), // de dónde salió (pool del asesor)
		bucket: integer("bucket"), // a dónde fue

		generadoEn: timestamp("generado_en").notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex("idx_cierre_detalle_contacto_unico")
			.on(table.contactoId)
			.where(sql`${table.contactoId} IS NOT NULL`),
		index("idx_cierre_detalle_fecha_asesor").on(table.fecha, table.asesorId),
	],
);
