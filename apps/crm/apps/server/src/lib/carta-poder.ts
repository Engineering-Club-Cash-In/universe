/**
 * Carta poder: autoriza al cliente a manejar fuera de Guatemala un vehículo que
 * está a nombre de CUBE o de RDBE.
 *
 * La otorga el representante de la empresa y el notario legaliza su firma en el
 * mismo papel, así que se imprime: no va a WeeTrust (ver
 * `contract-signature-mode.ts`). El generador sólo devuelve el PDF.
 *
 * Jurídico llena todo a mano y el CRM sólo le sugiere lo que ya tiene; nada es
 * obligatorio. Acá se convierte lo que escribió al texto que lleva la carta,
 * con las reglas que pidió jurídico: el nombre en mayúsculas (la plantilla lo
 * pone en negrilla), edades, fechas y DPI en letras minúsculas, y el número del
 * DPI aparte.
 *
 * OJO: lo importa también el navegador (el catálogo de cartas), así que no
 * puede leer `process.env` ni la base.
 */
import {
	dpiEnLetras,
	formatDateInWords,
	formatDpi,
	mapMaritalStatus,
	numberToWords,
} from "./contract-utils";

/** Las cuatro cartas: cada empresa con sus representantes. */
export const CARTAS_PODER = [
	{
		tipo: "carta_cube_andres",
		nombre: "CUBE — José Andrés Asensio",
		representante: "José Andrés Asensio",
		variableEdad: "edadAndres",
	},
	{
		tipo: "carta_cube_don_alex",
		nombre: "CUBE — Don Alex",
		representante: "Don Alex",
		variableEdad: "edadAlex",
	},
	{
		tipo: "carta_rdbe_don_alex",
		nombre: "RDBE — Don Alex",
		representante: "Don Alex",
		variableEdad: "edadAlex",
	},
	{
		tipo: "carta_rdbe_richard",
		nombre: "RDBE — Richard",
		representante: "Richard",
		variableEdad: "edadRichard",
	},
] as const;

export type TipoCartaPoder = (typeof CARTAS_PODER)[number]["tipo"];

export const TIPOS_CARTA_PODER = CARTAS_PODER.map((c) => c.tipo) as [
	TipoCartaPoder,
	...TipoCartaPoder[],
];

export const ESTADOS_CIVILES = [
	"single",
	"married",
	"divorced",
	"widowed",
] as const;

export type EstadoCivil = (typeof ESTADOS_CIVILES)[number];

/**
 * Lo que jurídico ve y corrige en el formulario. Edades y DPI van en número y
 * las fechas como `YYYY-MM-DD`: pasarlos a letras es cosa de esta capa, no de
 * quien llena.
 */
export interface CamposCartaPoder {
	genero: "male" | "female";
	nombreCompleto: string;
	edad: string;
	estadoCivil: EstadoCivil | "";
	profesion: string;
	nacionalidad: string;
	dpi: string;

	tipoVehiculo: string;
	marcaVehiculo: string;
	colorVehiculo: string;
	usoVehiculo: string;
	chasisVehiculo: string;
	motorVehiculo: string;
	serieVehiculo: string;
	lineaVehiculo: string;
	modeloVehiculo: string;
	cm3Vehiculo: string;
	asientosVehiculo: string;
	cilindrosVehiculo: string;
	iscvVehiculo: string;

	paisDestino: string;
	fechaFirma: string;
	fechaVencimiento: string;
	edadRepresentante: string;
}

/** La carta vence al año de firmada. */
export function vencimientoPorDefecto(fechaFirma: string): string {
	const [anio, mes, dia] = fechaFirma.split("-").map(Number);
	if (!anio || !mes || !dia) return "";
	// Un 29 de febrero vence el 28: `Date` lo pasaría al 1 de marzo.
	const ultimoDia = new Date(Date.UTC(anio + 1, mes, 0)).getUTCDate();
	return `${anio + 1}-${String(mes).padStart(2, "0")}-${String(Math.min(dia, ultimoDia)).padStart(2, "0")}`;
}

/** Campos vacíos, para quien no encontró el crédito y escribe todo. */
export function camposVacios(hoy: string): CamposCartaPoder {
	return {
		genero: "male",
		nombreCompleto: "",
		edad: "",
		estadoCivil: "",
		profesion: "",
		nacionalidad: "",
		dpi: "",
		tipoVehiculo: "",
		marcaVehiculo: "",
		colorVehiculo: "",
		// Así venía escrito en la carta de jurídico.
		usoVehiculo: "Particular",
		chasisVehiculo: "",
		motorVehiculo: "",
		serieVehiculo: "",
		lineaVehiculo: "",
		modeloVehiculo: "",
		cm3Vehiculo: "",
		asientosVehiculo: "",
		cilindrosVehiculo: "",
		iscvVehiculo: "",
		paisDestino: "",
		fechaFirma: hoy,
		fechaVencimiento: vencimientoPorDefecto(hoy),
		edadRepresentante: "",
	};
}

// Lo que se deja vacío va vacío: el generador pone su guion, como en los demás
// contratos.
function limpio(valor: string): string {
	return valor.trim();
}

/** Un número se pasa a letras; si escribieron otra cosa ("cuarenta") se respeta. */
function numeroEnLetras(valor: string): string {
	const texto = valor.trim();
	if (!texto) return "";
	return /^\d+$/.test(texto)
		? numberToWords(Number(texto))
		: texto.toLowerCase();
}

function fechaEnLetras(valor: string): string {
	const [anio, mes, dia] = valor.split("-").map(Number);
	if (!anio || !mes || !dia) return "";
	// Por componentes y no con `new Date(valor)`, que la toma como UTC y en
	// Guatemala la corre al día anterior.
	return formatDateInWords(new Date(anio, mes - 1, dia));
}

/**
 * Terminaciones de nacionalidades que cambian con el género (masculino →
 * femenino): guatemalteco/a, salvadoreño/a, mexicano/a, chileno/a, argentino/a,
 * noruego/a, uruguayo/a, polaco/a, turco/a, ruso/a, suizo/a, egipcio/a,
 * sirio/a, indio/a.
 */
const TERMINACIONES_CON_GENERO: ReadonlyArray<[string, string]> = [
	["eño", "eña"],
	["ano", "ana"],
	["eno", "ena"],
	["ino", "ina"],
	["eco", "eca"],
	["ego", "ega"],
	["ayo", "aya"],
	["aco", "aca"],
	["rco", "rca"],
	["uso", "usa"],
	["izo", "iza"],
	["cio", "cia"],
	["rio", "ria"],
	["dio", "dia"],
];

/**
 * La nacionalidad en el género de quien recibe la carta.
 *
 * Sólo se cambian las terminaciones que de verdad tienen masculino y femenino:
 * "belga", "croata" o "vietnamita" son iguales para los dos, y cambiarles la
 * última letra las dejaba en "belgo" o "croato". Lo demás (estadounidense,
 * costarricense, francés) se deja como se escribió.
 */
export function nacionalidadSegunGenero(
	nacionalidad: string,
	genero: "male" | "female",
): string {
	const valor = nacionalidad.trim().replace(/\s+/g, " ").toLowerCase();
	if (!valor) return "";
	for (const [masculino, femenino] of TERMINACIONES_CON_GENERO) {
		const [de, a] =
			genero === "female" ? [masculino, femenino] : [femenino, masculino];
		if (valor.endsWith(de)) return valor.slice(0, -de.length) + a;
	}
	return valor;
}

/** Las variables de la plantilla, ya con el texto que va en la carta. */
export function datosDeLaCartaPoder(
	tipo: TipoCartaPoder,
	campos: CamposCartaPoder,
): Record<string, string | boolean> {
	const carta = CARTAS_PODER.find((c) => c.tipo === tipo);
	if (!carta) throw new Error(`Carta poder desconocida: ${tipo}`);

	const dpi = campos.dpi.replace(/\D/g, "");
	const dpiCompleto = dpi.length === 13;

	return {
		nombreCompleto: limpio(campos.nombreCompleto.toUpperCase()),
		edad: numeroEnLetras(campos.edad),
		estadoCivil: campos.estadoCivil
			? mapMaritalStatus(campos.estadoCivil, campos.genero)
			: "",
		profesion: limpio(campos.profesion.toLowerCase()),
		nacionalidad: nacionalidadSegunGenero(campos.nacionalidad, campos.genero),
		dpiTexto: dpiCompleto ? dpiEnLetras(dpi) : limpio(campos.dpi.toLowerCase()),
		dpiNumero: dpiCompleto ? formatDpi(dpi) : limpio(campos.dpi),
		// Las plantillas ponen "({dpiNumero})" sólo con esto en true: con un DPI
		// incompleto, lo que se escribió ya va en dpiTexto y saldría dos veces.
		dpiCompleto,

		tipoVehiculo: limpio(campos.tipoVehiculo),
		marcaVehiculo: limpio(campos.marcaVehiculo),
		colorVehiculo: limpio(campos.colorVehiculo),
		usoVehiculo: limpio(campos.usoVehiculo),
		chasisVehiculo: limpio(campos.chasisVehiculo),
		motorVehiculo: limpio(campos.motorVehiculo),
		serieVehiculo: limpio(campos.serieVehiculo),
		lineaVehiculo: limpio(campos.lineaVehiculo),
		modeloVehiculo: limpio(campos.modeloVehiculo),
		cm3Vehiculo: limpio(campos.cm3Vehiculo),
		asientosVehiculo: limpio(campos.asientosVehiculo),
		cilindrosVehiculo: limpio(campos.cilindrosVehiculo),
		iscvVehiculo: limpio(campos.iscvVehiculo),

		paisDestino: limpio(campos.paisDestino),
		fechaInicioContrato: fechaEnLetras(campos.fechaFirma),
		fechaVencimiento: fechaEnLetras(campos.fechaVencimiento),
		[carta.variableEdad]: numeroEnLetras(campos.edadRepresentante),
	};
}

/**
 * La edad que tiene el día `fecha` quien nació el día `nacimiento` (las dos
 * "AAAA-MM-DD"). La carta dice la edad a su fecha de firma, que puede no ser
 * hoy. Null si alguna de las dos no es una fecha.
 */
export function edadAl(nacimiento: string, fecha: string): number | null {
	const [an, mn, dn] = nacimiento.split("-").map(Number);
	const [af, mf, df] = fecha.split("-").map(Number);
	if (!an || !mn || !dn || !af || !mf || !df) return null;
	let edad = af - an;
	if (mf < mn || (mf === mn && df < dn)) edad--;
	return edad >= 0 ? edad : null;
}
