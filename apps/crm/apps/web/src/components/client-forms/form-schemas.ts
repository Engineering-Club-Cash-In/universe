import { z } from "zod";

// Schema para referencia crediticia
const referenciaCrediticiaSchema = z.object({
	nombre: z.string().optional(),
	telefono: z.string().optional(),
});

// Schema para cuenta bancaria
const cuentaBancariaSchema = z.object({
	numero: z.string().optional(),
	tipo: z.string().optional(),
	banco: z.string().optional(),
});

// Schema para referencia personal
const referenciaPersonalSchema = z.object({
	nombre: z.string().optional(),
	relacion: z.string().optional(),
	telefono: z.string().optional(),
});

export const creditApplicationSchema = z.object({
	// Datos personales
	primerApellido: z.string().min(1, "Requerido"),
	segundoApellido: z.string().optional(),
	apellidoCasada: z.string().optional(),
	primerNombre: z.string().min(1, "Requerido"),
	segundoNombre: z.string().optional(),
	dpi: z.string().min(1, "Requerido"),
	nit: z.string().optional(),
	licenciaNo: z.string().optional(),
	edad: z.coerce.number().optional(),
	estadoCivil: z.string().optional(),
	dependientes: z.coerce.number().optional(),
	fechaNacimiento: z.string().optional(),
	sexo: z.string().optional(),
	nacionalidad: z.string().optional(),
	direccionResidencia: z.string().optional(),
	telResidencia: z.string().optional(),
	telMovil: z.string().optional(),
	telEmergencia: z.string().optional(),
	email: z.string().email("Email inválido").optional().or(z.literal("")),

	// Datos vehiculo
	vehiculoMarca: z.string().optional(),
	vehiculoLinea: z.string().optional(),
	vehiculoModelo: z.string().optional(),
	valorEstimado: z.string().optional(),
	montoSolicitado: z.string().optional(),
	usoUber: z.boolean().optional(),

	// Datos laborales
	profesion: z.string().optional(),
	puesto: z.string().optional(),
	sueldo: z.string().optional(),
	sueldoPeriodicidad: z.string().optional(),
	egresos: z.string().optional(),
	egresosPeriodicidad: z.string().optional(),
	fechaProximoPago: z.string().optional(),
	empresa: z.string().optional(),
	direccionTrabajo: z.string().optional(),
	fechaInicioLabores: z.string().optional(),
	tiempoTrabajado: z.string().optional(),
	horarios: z.string().optional(),
	telTrabajo: z.string().optional(),
	supervisor: z.string().optional(),
	rrhh: z.string().optional(),
	bancoPago: z.string().optional(),
	numCuenta: z.string().optional(),
	tipoCuenta: z.string().optional(),

	// Datos conyuge
	conyugeNombre: z.string().optional(),
	conyugeEmpresa: z.string().optional(),
	conyugeDireccion: z.string().optional(),
	conyugeTelOficina: z.string().optional(),
	conyugeTelMovil: z.string().optional(),

	// JSON arrays
	referenciasCrediticias: z.array(referenciaCrediticiaSchema),
	cuentasBancarias: z.array(cuentaBancariaSchema),
	referenciasPersonales: z.array(referenciaPersonalSchema),

	// Control interno
	esPep: z.boolean().optional(),
	comoSeEntero: z.string().optional(),
	utilizacionCredito: z.string().optional(),
});

export type CreditApplicationFormData = z.infer<typeof creditApplicationSchema>;

// Schema para deposito bancario
const depositoBancarioSchema = z.object({
	descripcion: z.string().optional(),
	monto: z.string().optional(),
});

// Schema para obligacion/otros items con descripcion y monto
const descripcionMontoSchema = z.object({
	descripcion: z.string().optional(),
	monto: z.string().optional(),
});

// Schema para anexo inmueble
const anexoInmuebleSchema = z.object({
	finca: z.string().optional(),
	folio: z.string().optional(),
	libro: z.string().optional(),
	valor: z.string().optional(),
	hipotecada: z.boolean().optional(),
	aFavorDe: z.string().optional(),
	direccion: z.string().optional(),
});

// Schema para anexo vehiculo
const anexoVehiculoSchema = z.object({
	marca: z.string().optional(),
	linea: z.string().optional(),
	placa: z.string().optional(),
	modeloAnio: z.string().optional(),
	valor: z.string().optional(),
});

export const financialStatementSchema = z.object({
	// Datos personales
	primerNombre: z.string().optional(),
	segundoNombre: z.string().optional(),
	primerApellido: z.string().optional(),
	segundoApellido: z.string().optional(),
	apellidoCasada: z.string().optional(),
	dpi: z.string().optional(),
	dpiExtendidoEn: z.string().optional(),
	nit: z.string().optional(),

	// Activos
	efectivo: z.string().optional(),
	depositosBancarios: z.array(depositoBancarioSchema),
	cuentasCobrarAmigos: z.string().optional(),
	cuentasCobrarOtros: z.string().optional(),
	documentosCobrar: z.string().optional(),
	bienesInmueblesCantidad: z.coerce.number().optional(),
	bienesInmueblesValor: z.string().optional(),
	vehiculosCantidad: z.coerce.number().optional(),
	vehiculosValor: z.string().optional(),
	maquinaria: z.string().optional(),
	muebles: z.string().optional(),
	menaje: z.string().optional(),
	otrosActivos: z.array(descripcionMontoSchema),

	// Pasivos
	cuentasPagarAmigos: z.string().optional(),
	cuentasPagarOtros: z.string().optional(),
	letrasPagar: z.string().optional(),
	obligacionesParticulares: z.array(descripcionMontoSchema),
	obligacionesCortoPlazo: z.array(descripcionMontoSchema),
	obligacionesLargoPlazo: z.array(descripcionMontoSchema),
	otrosPasivos: z.array(descripcionMontoSchema),

	// Ingresos
	sueldos: z.string().optional(),
	bonificaciones: z.string().optional(),
	arrendamientos: z.string().optional(),
	otrosIngresos: z.array(descripcionMontoSchema),

	// Egresos
	gastosPersonales: z.string().optional(),
	alquileres: z.string().optional(),
	amortizacionVivienda: z.string().optional(),
	deudasPersonales: z.string().optional(),
	otrosEgresos: z.array(descripcionMontoSchema),

	// Textos
	origenIngresos: z.string().optional(),
	comoAcreditanIngresos: z.string().optional(),

	// Anexos
	anexoInmuebles: z.array(anexoInmuebleSchema),
	anexoVehiculos: z.array(anexoVehiculoSchema),
});

export type FinancialStatementFormData = z.infer<
	typeof financialStatementSchema
>;
