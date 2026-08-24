import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	decimal,
	index,
	integer,
	jsonb,
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
// CB-128: "pago" se agregó al mismo enum (no uno aparte) por el mismo motivo
// que "sms" arriba — es la columna de 4 lugares y partirla obligaría a
// mantener catálogos de canal en paralelo. No es un canal de contacto real:
// marca la fila que el asesor crea al registrar un pago desde la Ficha 360
// (ver estadoContacto = 'pago_registrado' más abajo), donde metodoContacto
// no tiene un canal que reportar pero la columna es NOT NULL.
export const metodoContactoEnum = pgEnum("metodo_contacto", [
	"llamada",
	"whatsapp",
	"sms",
	"email",
	"visita_domicilio",
	"carta_notarial",
	"pago",
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
// CB-128: "pago_registrado" marca la fila que se crea automáticamente cuando
// el asesor registra un pago desde la Ficha 360 (mismo endpoint que hoy
// integra con cartera-back). No es un resultado de contacto real — es la
// forma de que el pago aparezca en Historial/Cumplimiento de agenda igual
// que cualquier otra gestión, sin duplicar esa lógica en una tabla aparte
// (ver pagoReferenceId en contactosCobros más abajo).
export const estadoContactoEnum = pgEnum("estado_contacto", [
	"contactado",
	"no_contesta",
	// Un envío SALIENTE (WhatsApp/Email/SMS por API) registrado en automático:
	// no prueba respuesta del cliente ("contactado" mentiría y apagaría la
	// gestión B1) pero tampoco es "no_contesta" — nadie dejó de contestar una
	// llamada, solo se mandó un mensaje. Migración 0039.
	"mensaje_enviado",
	"numero_equivocado",
	"promesa_pago",
	"acuerdo_parcial",
	"rechaza_pagar",
	"pago_registrado",
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

		// CB-128: bucket que tenía el crédito AL MOMENTO de registrar la gestión.
		// Congelado a propósito — el AC pide segmentar el historial por el bucket
		// de entonces, no por el de hoy (una cuenta que subió de B1 a B3 no debe
		// re-etiquetar retroactivamente la gestión que se hizo cuando estaba en
		// B1).
		//
		// Se llena en tres de los cuatro puntos que insertan en esta tabla:
		//   - createContactoCobros (gestión manual) → capturarBucketSnapshot(),
		//     una llamada a cartera-back con timeout corto y best-effort.
		//   - envío masivo de WhatsApp → DERIVADO de `cuotas_atrasadas`, que ese
		//     flujo ya tiene en memoria. Sin red: llamar a cartera-back por cada
		//     destinatario haría inviable un envío de cientos.
		//   - premora / convenio (send-*-reminders.ts) → queda NULL A PROPÓSITO.
		//     Esos jobs no traen las cuotas atrasadas del crédito (trabajan sobre
		//     cuotas próximas a vencer, no sobre mora), así que derivarlo exigiría
		//     una llamada de red por recordatorio. Son notificaciones del sistema,
		//     excluidas por defecto de la vista, y de volumen bajo — el costo no se
		//     justifica. Si algún día importa, la vía es traer `cuotas_atrasadas`
		//     en la query de esos jobs, NO llamar a cartera-back por fila.
		//
		// NULL = desconocido: filas anteriores a CB-128 (no hay backfill), los
		// recordatorios automáticos de arriba, o cartera-back no respondió al
		// crearla.
		bucketSnapshot: integer("bucket_snapshot"),

		// CB-128: solo se llena cuando estadoContacto = 'pago_registrado' — apunta
		// a la fila de pago_references (schema cartera-back.ts) con el detalle
		// financiero (monto, cuota, banco...) que esta tabla no tiene por qué
		// duplicar. Sin `.references()` a propósito: cartera-back.ts importa de
		// este archivo, no al revés, y una FK acá crearía un ciclo de import.
		pagoReferenceId: uuid("pago_reference_id"),

		createdAt: timestamp("created_at").notNull().defaultNow(),
		// CB-128: última escritura sobre la fila. Dato TÉCNICO, no de negocio: lo
		// tocan también los UPDATE de sistema que solo recalculan estado_promesa,
		// así que NO sirve para decir "esto lo editaron". La marca de edición que
		// ve el usuario sale de contactos_cobros_audit con origen='manual'.
		updatedAt: timestamp("updated_at"),
	},
	(table) => [
		index("idx_contactos_cobros_caso_fecha").on(
			table.casoCobroId,
			table.fechaContacto,
		),
		// CB-128 — índices de escala. El de arriba solo sirve a la Ficha 360 (un
		// caso a la vez); el historial de agendas filtra por rango de fechas
		// GLOBAL, sin caso_cobro_id. Proyección del negocio: 5× créditos a 5 años
		// ⇒ ~500k-800k filas acá, donde un seq scan por carga deja de ser viable.
		index("idx_contactos_cobros_fecha").on(table.fechaContacto.desc()),
		// Scoping del asesor: filtro por usuario + orden por fecha van SIEMPRE
		// juntos en esa vista, por eso compuesto y no dos índices sueltos.
		index("idx_contactos_cobros_realizado_fecha").on(
			table.realizadoPor,
			table.fechaContacto.desc(),
		),
		// Segmentación por bucket (el corazón del AC). Parcial: las filas con
		// snapshot NULL nunca se filtran por bucket, indexarlas es peso muerto.
		index("idx_contactos_cobros_bucket_fecha")
			.on(table.bucketSnapshot, table.fechaContacto.desc())
			.where(sql`${table.bucketSnapshot} IS NOT NULL`),
	],
);

export const agendaCobrosSnapshotEstadoEnum = pgEnum(
	"agenda_cobros_snapshot_estado",
	["abierto", "cerrado"],
);

export const agendaCobrosSnapshots = pgTable(
	"agenda_cobros_snapshots",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		fechaGt: date("fecha_gt").notNull(),
		asesorId: text("asesor_id")
			.notNull()
			.references(() => user.id),
		capturadoEn: timestamp("capturado_en").notNull().defaultNow(),
		cerradoEn: timestamp("cerrado_en"),
		totalPlanificado: integer("total_planificado").notNull(),
		totalAtendidos: integer("total_atendidos").notNull().default(0),
		totalPendientes: integer("total_pendientes").notNull(),
		estado: agendaCobrosSnapshotEstadoEnum("estado")
			.notNull()
			.default("abierto"),
	},
	(table) => [
		uniqueIndex("idx_agenda_snapshots_fecha_asesor_unico").on(
			table.fechaGt,
			table.asesorId,
		),
	],
);

export const agendaCobrosSnapshotItems = pgTable(
	"agenda_cobros_snapshot_items",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		snapshotId: uuid("snapshot_id")
			.notNull()
			.references(() => agendaCobrosSnapshots.id, { onDelete: "cascade" }),
		casoCobroId: uuid("caso_cobro_id").references(() => casosCobros.id),
		numeroCreditoSifco: text("numero_credito_sifco").notNull(),
		bucketSnapshot: integer("bucket_snapshot"),
		motivoAgenda: text("motivo_agenda"),
		atendido: boolean("atendido").notNull().default(false),
		contactoCobroId: uuid("contacto_cobro_id").references(
			() => contactosCobros.id,
			{ onDelete: "set null" },
		),
		atendidoEn: timestamp("atendido_en"),
		resultadoContacto: estadoContactoEnum("resultado_contacto"),
		realizadoPor: text("realizado_por").references(() => user.id),
		promesaCumplida: boolean("promesa_cumplida").notNull().default(false),
		promesaContactoCobroId: uuid("promesa_contacto_cobro_id").references(
			() => contactosCobros.id,
			{ onDelete: "set null" },
		),
		promesaCumplidaEn: timestamp("promesa_cumplida_en"),
	},
	(table) => [
		uniqueIndex("idx_agenda_snapshot_items_credito_unico").on(
			table.snapshotId,
			table.numeroCreditoSifco,
		),
		index("idx_agenda_snapshot_items_estado").on(
			table.snapshotId,
			table.atendido,
		),
		index("idx_agenda_snapshot_items_sifco").on(table.numeroCreditoSifco),
		index("idx_agenda_snapshot_items_promesa_cumplida")
			.on(table.snapshotId, table.promesaCumplida)
			.where(sql`${table.promesaCumplida}`),
	],
);

// CB-128 — auditoría de escrituras sobre contactos_cobros (AC-6: "no se
// eliminan ni alteran registros históricos sin auditoría").
//
// contactos_cobros es append-only SALVO tres UPDATE, que esta tabla cubre:
//
//   1. Edición manual de la promesa activa (CB-029, cobros.ts createContacto-
//      Cobros rama promesaContactoId). Baja frecuencia, decisión humana, pisa
//      la fila ENTERA (cuotas, monto, fecha prometida, comentarios). Es el
//      único caso donde se PIERDE información irrecuperable: sin esto no queda
//      rastro de que el cliente prometió el día 10 y luego se movió al 20.
//      → origen='manual', valores_anteriores = snapshot completo de la fila.
//
//   2. getEstadoPromesasPago (cobros.ts) — recalcula estado_promesa en cada
//      apertura de Ficha 360.
//   3. check-promesas-pago.ts — mismo recálculo, job nocturno.
//      → origen='sistema_lectura'/'sistema_job', valores_anteriores = {de, a}.
//      Solo la transición: estado_promesa es función pura de columnas que ya
//      persisten (cuota_inicio/cuota_fin/incluye_mora/fecha_proximo_contacto)
//      contra el estado del crédito — es lo que hace evaluarPromesa(), o sea
//      que es reconstruible y guardar el snapshot completo sería redundante.
//
// Los casos 2 y 3 SOLO se auditan porque llevan guard de no-op (ver el `or(
// isNull, ne)` en sus WHERE): sin él escribirían en cada corrida aunque el
// estado no cambie, y esta tabla se llenaría de filas 'pendiente → pendiente'
// (~36,500/año con 100 promesas vivas). El guard es prerequisito, no adorno.
//
// LO QUE ESTA TABLA NO CAPTURA — explícito para no asumir cobertura de más:
//   - Cambios en casos_cobros (7 UPDATE: reasignación de responsable,
//     etiquetas, próximo contacto, sync SIFCO). Fuera del alcance de CB-128,
//     que es historial de GESTIONES, no de cuentas. Deuda conocida:
//     casos_cobros tiene updated_at pero ningún updated_by.
//   - DELETE: no existe ninguno en producción (el único está en db/clear.ts,
//     seed). Ojo que la FK es ON DELETE CASCADE, así que si algún día se
//     borrara un contacto su auditoría se iría con él.
//   - Lecturas: quién consultó el historial no se registra.
//   - No reemplaza buckets_historial ni credito_asesor_historial (cartera-back),
//     que ya cubren transiciones de bucket y reasignaciones con su propia
//     bitácora append-only.
//
// `accion` y `valores_anteriores` (jsonb) son deliberadamente genéricos: un
// UPDATE futuro sobre contactos_cobros entra sin migración. Si la tabla solo
// supiera de promesas, el próximo UPDATE rompería el AC-6 en silencio.
export const contactosCobrosAudit = pgTable(
	"contactos_cobros_audit",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		contactoId: uuid("contacto_id")
			.notNull()
			.references(() => contactosCobros.id, { onDelete: "cascade" }),
		casoCobroId: uuid("caso_cobro_id")
			.notNull()
			.references(() => casosCobros.id),

		// 'edicion_promesa' | 'cambio_estado_promesa' — texto libre a propósito
		// (ver nota de genericidad arriba).
		accion: text("accion").notNull(),
		// 'manual' | 'sistema_lectura' | 'sistema_job'
		origen: text("origen").notNull(),
		valoresAnteriores: jsonb("valores_anteriores").notNull(),

		// NULL cuando origen != 'manual': los UPDATE de sistema no tienen usuario.
		editadoPor: text("editado_por").references(() => user.id),
		editadoEn: timestamp("editado_en").notNull().defaultNow(),
	},
	(table) => [
		index("idx_contactos_audit_contacto").on(
			table.contactoId,
			table.editadoEn.desc(),
		),
		index("idx_contactos_audit_caso").on(table.casoCobroId),
		// El listado del historial solo pregunta "¿lo editó un humano?" — parcial
		// para que ese lookup no pague por las filas de sistema, que son mayoría.
		index("idx_contactos_audit_manual")
			.on(table.contactoId)
			.where(sql`${table.origen} = 'manual'`),
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
