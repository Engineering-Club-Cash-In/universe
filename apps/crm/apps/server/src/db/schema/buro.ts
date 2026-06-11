// packages/database/src/schema/infornet.ts
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	serial,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

/**
 * TIPOS DE INFORNET
 * Actualizados con los campos reales que devuelve la API
 */

export type FichaPrincipalPersona = {
	codigo: number;
	nombres: string;
	apellidos: string;
	sexo: string;
	fechaNacimiento: string;
	estadoCivil?: string;
	profesion?: string;
	nacionalidad?: string;
	lugarNacimiento?: string; // 🆕
	pais?: string; // 🆕
};

export type DocumentoIdentidad = {
	tipo: string; // 'DPI', 'NIT', 'LCA', 'PAS'
	numero: string;
	nombreDocumento?: string; // 🆕 "CEDULA DE VECINDAD"
	extension?: string; // 🆕 "GUATEMALA, GUATEMALA"
	paisDocumento?: string; // 🆕 "GUATEMALA"
	fechaEmision?: string;
	fechaVencimiento?: string;
};

export type Direccion = {
	tipo: string;
	direccion: string;
	municipio?: string;
	departamento?: string;
	pais?: string;
	telefono?: string;
};

export type PEP = {
	esPEP: boolean;
	cargo?: string;
	institucion?: string;
	fechaInicio?: string;
	fechaFin?: string;
};

export type Pariente = {
	codigo: number;
	nombre: string;
	parentesco: string;
	esPEP?: boolean;
};

export type Delito = {
	tipo: string;
	descripcion: string;
	fecha?: string;
	estado?: string;
};

export type Involucrado = {
	codigo: number;
	nombre: string;
	rol: string;
};

export type ReferenciaJudicial = {
	delitos: Delito[];
	involucrados: Involucrado[];
};

export type ReferenciaComercial = {
	empresa: string;
	tipo: string;
	monto?: number;
	moneda?: string;
	estado?: string;
	fechaRegistro?: string;
};

export type ReferenciaPrensa = {
	medio: string;
	fecha: string;
	titulo: string;
	resumen?: string;
};

export type ReferenciaMercantil = {
	empresa: string;
	cargo: string;
	fechaInicio?: string;
	fechaFin?: string;
	estado?: string;
};

export type Vehiculo = {
	placa: string;
	marca: string;
	linea: string;
	modelo: string;
	color?: string;
};

export type Inmueble = {
	finca: string;
	folio: string;
	libro: string;
	ubicacion?: string;
	area?: string;
};

export type Empleo = {
	empresa: string;
	cargo: string;
	tipoPatrono?: string; // 🆕 "S" o "P"
	codigoPatrono?: number; // 🆕 Código del patrono en Infornet
	fechaInicio?: string;
	fechaFin?: string;
	fechaRegistro?: string; // 🆕 Fecha de registro en Infornet
	salario?: number;
};

export type ChequeGarantizado = {
	numero: string;
	banco: string;
	monto: number;
	fecha: string;
	estado: string;
};

export type ConsultaEfectuada = {
	fecha: string;
	empresa: string;
	usuario?: string; // 🆕 Usuario que hizo la consulta
	motivo?: string;
};

export type EmpresaResult = {
	tipo: "S" | "P"; // S = Sociedad, P = Persona
	codigo: number;
	propietario: string;
	nombreComercial: string;
	nit: string;
	direccion: string;
	pais: string;
};

/**
 * Tipo del JSON completo del estudio de persona
 */
export type EstudioPersonaJSON = {
	fichaPrincipal: FichaPrincipalPersona;
	documentos: DocumentoIdentidad[];
	direcciones: Direccion[];
	pep?: PEP;
	parientesPep: Pariente[];
	parientes: Pariente[];
	referenciasJudiciales: ReferenciaJudicial;
	referenciasPrensa: ReferenciaPrensa[];
	referenciasComerciales: ReferenciaComercial[];
	chequesGarantizados: ChequeGarantizado[];
	referenciasMercantiles: ReferenciaMercantil[];
	empresasPropiedad: EmpresaResult[];
	empleos: Empleo[];
	vehiculos: Vehiculo[];
	inmuebles: Inmueble[];
	consultasEfectuadas: ConsultaEfectuada[];
};

/**
 * TABLA DE DRIZZLE
 * Cache de estudios de persona de Infornet
 */
export const infornetPersonaCache = pgTable(
	"infornet_persona_cache",
	{
		id: serial("id").primaryKey(),

		// Identificación
		codigoPersona: integer("codigo_persona").notNull().unique(),
		dpi: text("dpi").unique(),
		nombres: text("nombres").notNull(),
		apellidos: text("apellidos").notNull(),
		fechaNacimiento: text("fecha_nacimiento"),
		sexo: text("sexo"),

		// Estudio completo en JSON
		estudioCompleto: jsonb("estudio_completo")
			.notNull()
			.$type<EstudioPersonaJSON>(),

		// Campos indexados para búsquedas rápidas
		tieneReferenciasComerciales: boolean("tiene_referencias_comerciales")
			.notNull()
			.default(false),
		tieneReferenciasJudiciales: boolean("tiene_referencias_judiciales")
			.notNull()
			.default(false),
		esPEP: boolean("es_pep").notNull().default(false),
		cantidadInmuebles: integer("cantidad_inmuebles").notNull().default(0),
		cantidadVehiculos: integer("cantidad_vehiculos").notNull().default(0),
		cantidadEmpresas: integer("cantidad_empresas").notNull().default(0),

		// Control de caché
		consultadoEn: timestamp("consultado_en", { withTimezone: true })
			.notNull()
			.defaultNow(),
		expiraEn: timestamp("expira_en", { withTimezone: true }).notNull(),

		// Auditoría
		consultadoPor: text("consultado_por"),
		motivoConsulta: text("motivo_consulta"),

		// Timestamps
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => ({
		dpiIdx: index("infornet_persona_dpi_idx").on(table.dpi),
		codigoPersonaIdx: index("infornet_persona_codigo_idx").on(
			table.codigoPersona,
		),
		expiraEnIdx: index("infornet_persona_expira_idx").on(table.expiraEn),
	}),
);
