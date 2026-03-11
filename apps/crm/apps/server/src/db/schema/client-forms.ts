import {
	boolean,
	decimal,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { opportunities } from "./crm";

// Token table for public form links
export const clientFormTokens = pgTable("client_form_tokens", {
	id: uuid("id").primaryKey().defaultRandom(),
	opportunityId: uuid("opportunity_id")
		.notNull()
		.references(() => opportunities.id, { onDelete: "cascade" }),
	personType: text("person_type"), // 'lead' | 'coDebtor'
	personId: uuid("person_id"), // lead.id or co_debtors.id
	token: uuid("token").notNull().unique().defaultRandom(),
	expiresAt: timestamp("expires_at").notNull(),
	used: boolean("used").notNull().default(false),
	creditSubmittedAt: timestamp("credit_submitted_at"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Credit Application form (Formulario Solicitud de Credito)
export const creditApplications = pgTable(
	"credit_applications",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		opportunityId: uuid("opportunity_id")
			.notNull()
			.references(() => opportunities.id, { onDelete: "cascade" }),
		personType: text("person_type"), // 'lead' | 'coDebtor'
		personId: uuid("person_id"), // lead.id or co_debtors.id

	// Datos personales
	primerApellido: text("primer_apellido"),
	segundoApellido: text("segundo_apellido"),
	apellidoCasada: text("apellido_casada"),
	primerNombre: text("primer_nombre"),
	segundoNombre: text("segundo_nombre"),
	dpi: text("dpi"),
	nit: text("nit"),
	licenciaNo: text("licencia_no"),
	edad: integer("edad"),
	estadoCivil: text("estado_civil"),
	dependientes: integer("dependientes"),
	fechaNacimiento: text("fecha_nacimiento"),
	sexo: text("sexo"),
	nacionalidad: text("nacionalidad"),
	direccionResidencia: text("direccion_residencia"),
	telResidencia: text("tel_residencia"),
	telMovil: text("tel_movil"),
	telEmergencia: text("tel_emergencia"),
	email: text("email"),

	// Datos vehiculo
	vehiculoMarca: text("vehiculo_marca"),
	vehiculoLinea: text("vehiculo_linea"),
	vehiculoModelo: text("vehiculo_modelo"),
	valorEstimado: decimal("valor_estimado", { precision: 12, scale: 2 }),
	montoSolicitado: decimal("monto_solicitado", { precision: 12, scale: 2 }),
	usoUber: boolean("uso_uber").default(false),

	// Datos laborales
	profesion: text("profesion"),
	puesto: text("puesto"),
	sueldo: decimal("sueldo", { precision: 12, scale: 2 }),
	sueldoPeriodicidad: text("sueldo_periodicidad"), // 'mensual' | 'quincenal'
	egresos: decimal("egresos", { precision: 12, scale: 2 }),
	egresosPeriodicidad: text("egresos_periodicidad"),
	fechaProximoPago: text("fecha_proximo_pago"),
	empresa: text("empresa"),
	direccionTrabajo: text("direccion_trabajo"),
	fechaInicioLabores: text("fecha_inicio_labores"),
	tiempoTrabajado: text("tiempo_trabajado"),
	horarios: text("horarios"),
	telTrabajo: text("tel_trabajo"),
	supervisor: text("supervisor"),
	rrhh: text("rrhh"),
	bancoPago: text("banco_pago"),
	numCuenta: text("num_cuenta"),
	tipoCuenta: text("tipo_cuenta"), // 'monetaria' | 'ahorro'

	// Datos conyuge
	conyugeNombre: text("conyuge_nombre"),
	conyugeEmpresa: text("conyuge_empresa"),
	conyugeDireccion: text("conyuge_direccion"),
	conyugeTelOficina: text("conyuge_tel_oficina"),
	conyugeTelMovil: text("conyuge_tel_movil"),

	// JSON arrays
	referenciasCrediticias: jsonb("referencias_crediticias"), // [{nombre, telefono}]
	cuentasBancarias: jsonb("cuentas_bancarias"), // [{numero, tipo, banco}]
	referenciasPersonales: jsonb("referencias_personales"), // [{nombre, relacion, telefono}]

	// Control interno
	esPep: boolean("es_pep").default(false),
	comoSeEntero: text("como_se_entero"),
	utilizacionCredito: text("utilizacion_credito"),

	// Firma
	firmaImagen: text("firma_imagen"), // R2 key or base64
	fechaFirma: text("fecha_firma"),
	horaFirma: text("hora_firma"),

		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => ({
		opportunityPersonUnique: uniqueIndex(
			"credit_applications_opportunity_person_unique",
		).on(table.opportunityId, table.personType, table.personId),
	}),
);

// Financial Statement (Estado Patrimonial)
export const financialStatements = pgTable(
	"financial_statements",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		opportunityId: uuid("opportunity_id")
			.notNull()
			.references(() => opportunities.id, { onDelete: "cascade" }),
		personType: text("person_type"), // 'lead' | 'coDebtor'
		personId: uuid("person_id"), // lead.id or co_debtors.id

	// Datos personales
	primerNombre: text("primer_nombre"),
	segundoNombre: text("segundo_nombre"),
	primerApellido: text("primer_apellido"),
	segundoApellido: text("segundo_apellido"),
	apellidoCasada: text("apellido_casada"),
	dpi: text("dpi"),
	dpiExtendidoEn: text("dpi_extendido_en"),
	nit: text("nit"),

	// Activos
	efectivo: decimal("efectivo", { precision: 12, scale: 2 }),
	depositosBancarios: jsonb("depositos_bancarios"), // [{descripcion, monto}]
	cuentasCobrarAmigos: decimal("cuentas_cobrar_amigos", {
		precision: 12,
		scale: 2,
	}),
	cuentasCobrarOtros: decimal("cuentas_cobrar_otros", {
		precision: 12,
		scale: 2,
	}),
	documentosCobrar: decimal("documentos_cobrar", { precision: 12, scale: 2 }),
	bienesInmueblesCantidad: integer("bienes_inmuebles_cantidad"),
	bienesInmueblesValor: decimal("bienes_inmuebles_valor", {
		precision: 12,
		scale: 2,
	}),
	vehiculosCantidad: integer("vehiculos_cantidad"),
	vehiculosValor: decimal("vehiculos_valor", { precision: 12, scale: 2 }),
	maquinaria: decimal("maquinaria", { precision: 12, scale: 2 }),
	muebles: decimal("muebles", { precision: 12, scale: 2 }),
	menaje: decimal("menaje", { precision: 12, scale: 2 }),
	otrosActivos: jsonb("otros_activos"), // [{descripcion, monto}]

	// Pasivos
	cuentasPagarAmigos: decimal("cuentas_pagar_amigos", {
		precision: 12,
		scale: 2,
	}),
	cuentasPagarOtros: decimal("cuentas_pagar_otros", {
		precision: 12,
		scale: 2,
	}),
	letrasPagar: decimal("letras_pagar", { precision: 12, scale: 2 }),
	obligacionesParticulares: jsonb("obligaciones_particulares"), // [{descripcion, monto}]
	obligacionesCortoPlazo: jsonb("obligaciones_corto_plazo"), // [{descripcion, monto}]
	obligacionesLargoPlazo: jsonb("obligaciones_largo_plazo"), // [{descripcion, monto}]
	otrosPasivos: jsonb("otros_pasivos"), // [{descripcion, monto}]

	// Ingresos
	sueldos: decimal("sueldos", { precision: 12, scale: 2 }),
	bonificaciones: decimal("bonificaciones", { precision: 12, scale: 2 }),
	arrendamientos: decimal("arrendamientos", { precision: 12, scale: 2 }),
	otrosIngresos: jsonb("otros_ingresos"), // [{descripcion, monto}]

	// Egresos
	gastosPersonales: decimal("gastos_personales", { precision: 12, scale: 2 }),
	alquileres: decimal("alquileres", { precision: 12, scale: 2 }),
	amortizacionVivienda: decimal("amortizacion_vivienda", {
		precision: 12,
		scale: 2,
	}),
	deudasPersonales: decimal("deudas_personales", { precision: 12, scale: 2 }),
	otrosEgresos: jsonb("otros_egresos"), // [{descripcion, monto}]

	// Textos
	origenIngresos: text("origen_ingresos"),
	comoAcreditanIngresos: text("como_acreditan_ingresos"),

	// Anexos
	anexoInmuebles: jsonb("anexo_inmuebles"), // [{finca, folio, libro, valor, hipotecada, aFavorDe, direccion}]
	anexoVehiculos: jsonb("anexo_vehiculos"), // [{marca, linea, placa, modeloAnio, valor}]

	// Firma
	firmaImagen: text("firma_imagen"),
	fechaFirma: text("fecha_firma"),

		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => ({
		opportunityPersonUnique: uniqueIndex(
			"financial_statements_opportunity_person_unique",
		).on(table.opportunityId, table.personType, table.personId),
	}),
);
