import {
	AlertCircle,
	Check,
	CheckCircle,
	ChevronLeft,
	ChevronRight,
	Link2,
	Loader2,
	Plus,
	Send,
	Trash2,
	TriangleAlert,
	User,
	Users,
	UserX,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { esFirmaFisica } from "server/src/lib/contract-signature-mode";
import {
	esCartaUnificable,
	PAQUETE_CARTAS,
} from "server/src/lib/paquete-cartas";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { type ContractResult, ContractResults } from "./ContractResults";

// Types from API
interface DocumentType {
	enum: string;
	label: string;
}

interface RenapData {
	dpi: string;
	firstName: string;
	secondName: string;
	thirdName: string;
	firstLastName: string;
	secondLastName: string;
	marriedLastName: string;
	picture: string;
	birthDate: string;
	gender: string;
	civil_status: string;
	nationality: string;
	borned_in: string;
	department_borned_in: string;
	municipality_borned_in: string;
	deathDate: string;
	ocupation: string;
	cedula_order: string;
	cedula_register: string;
	dpi_expiracy_date: string;
}

interface Document {
	id: number;
	nombre_documento: string;
	descripcion: string;
	genero: string;
	serialid: string;
	url_insercion: string;
	large_spacing: boolean;
	count_doble_line: number;
}

/**
 * Qué clase de campo es.
 *
 * Los contratos de inversiones traen los tres: la cesión pide una lista de
 * créditos cedidos, el anexo de beneficiarios una lista de personas, y la
 * modalidad de retorno o la figura fiscal son opciones cerradas. Sin esto se
 * pintaban todos como una caja de texto y no había forma de cargarlos.
 */
type FieldType = "text" | "select" | "list";

interface FieldOption {
	value: string;
	label: string;
}

interface Field {
	name: string;
	key: string;
	regex: string;
	required: boolean;
	iddocuments: number[];
	relation: string;
	description: string | null;
	default: string | null;
	is_double_line: boolean;
	type?: FieldType;
	/** En un `select`, las opciones; en una `list`, las columnas de cada item. */
	options?: FieldOption[] | null;
}

/** Los items de un campo de lista, que se guardan como JSON en el formulario. */
function itemsDeLista(valor: string): Array<Record<string, string>> {
	if (!valor) return [];
	try {
		const parsed = JSON.parse(valor);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

/**
 * Los valores como los espera el generador.
 *
 * Las listas viajan como arreglo, no como el JSON con el que se editan. Y cada
 * `select` manda, además de su valor, una marca por opción (`clave_opcion`:
 * ☒ o ☐): así el template puede marcar la casilla que corresponde en vez de
 * escribir el texto.
 */
function valoresParaElGenerador(
	fields: Field[],
	fieldValues: Record<string, string>,
): Record<string, unknown> {
	const datos: Record<string, unknown> = { ...fieldValues };

	for (const field of fields) {
		const valor = fieldValues[field.key] ?? "";

		if (field.type === "list") {
			datos[field.key] = itemsDeLista(valor);
			continue;
		}

		if (field.type === "select" && Array.isArray(field.options)) {
			for (const opcion of field.options) {
				datos[`${field.key}_${opcion.value}`] =
					valor === opcion.value ? "☒" : "☐";
			}
		}
	}

	return datos;
}

// Co-debtor data from database
export interface CoDebtorData {
	id: string;
	fullName: string;
	dpi: string;
	age?: number | null;
	gender?: string | null;
	maritalStatus?: string | null;
	profession?: string | null;
	nationality?: string | null;
	email?: string | null;
}

// CRM data that we already have
export interface CRMData {
	cliente: {
		nombreCompleto?: string;
		dpi?: string;
		direccion?: string;
		nacionalidad?: string;
		estadoCivil?: string;
		profesion?: string;
		edad?: number;
		correo?: string;
		genero?: "M" | "F";
	};
	// Vendedor del vehículo (Declaración de Vendedor). Opcional: asignarlo en la
	// oportunidad todavía no es obligatorio.
	vendedor?: {
		nombreMayusculas?: string;
		dpi?: string;
		dpiLetras?: string;
		genero?: string;
	};
	// Filas de la Carta de Emisión de Cheques, ya formateadas por el servidor
	// {agencia}: la empresa que vende el carro nuevo
	agencia?: string;
	desembolso?: {
		filas: Array<{ cuenta: string; valor: string }>;
		sobrantes: number;
		omitidosPorMoneda: number;
	};
	// {empresa} NO se mapea: la API ya lo llena con su propio default
	// {entidad}/{tipoEntidad}: acreedor = inversionista del análisis del 50%
	entidad?: {
		nombre?: string;
		tipo?: string;
	};
	vehiculo: {
		tipo?: string;
		marca?: string;
		linea?: string;
		modelo?: string;
		color?: string;
		uso?: string;
		chasis?: string;
		combustible?: string;
		motor?: string;
		serie?: string;
		cm3?: string;
		asientos?: string;
		cilindros?: string;
		iscv?: string;
		esNuevo?: boolean;
	};
	credito: {
		capitalAdeudado?: number;
		mesesPrestamo?: number;
		cuotaMensual?: number;
		porcentajeInteres?: number;
		porcentajeMora?: number;
		// Valor crudo de opportunity.diaPagoMensual. Si no es 15 ni 30, significa que
		// el analista eligió uno de los 3 días recomendados por la IA en el 50%.
		diaPagoMensualRaw?: number | null;
	};
	coDebtors?: CoDebtorData[];
}

interface GenerationResult {
	success: boolean;
	totalRequested: number;
	successCount: number;
	failCount: number;
	results: ContractResult[];
}

/**
 * Rol de un firmante del contrato. Decide en qué línea de firma cae la persona:
 * el generador conoce el layout de cada template y reparte por rol, porque el
 * orden no es el mismo en todos (en la garantía mobiliaria y el reconocimiento
 * de deuda el representante legal firma primero, no último).
 *
 * `REP_LEGAL` lo agrega el servidor, que es donde vive su correo.
 */
export type SignerRole = "TITULAR" | "COFIRMANTE" | "REP_LEGAL" | "VENDEDOR";

export interface ContractSigner {
	role: SignerRole;
	email: string;
	/** Nombre real de la persona, tal como debe verse en el documento. */
	name: string;
	dpi?: string;
	phone?: string;
}

// Editable fields for additional debtors
interface EditableCoDebtorFields {
	id: string;
	nombreCompleto: string;
	dpi: string;
	dpiTexto: string;
	edadTexto: string;
	estadoCivil: string;
	profesion: string;
	nacionalidad: string;
	correoElectronico: string;
}

// Extended result with data needed for linking
interface GenerationResultWithData extends GenerationResult {
	results: Array<
		ContractResult & {
			templateId?: number;
			apiResponse?: unknown;
		}
	>;
}

interface DynamicContractWizardProps {
	documentTypes: DocumentType[];
	crmData: CRMData;
	/**
	 * La oportunidad de venta, cuando los contratos son de ventas.
	 *
	 * En inversiones no hay oportunidad: los contratos son del inversionista y
	 * `onGenerate` ya los guarda, así que no hay segundo paso que enlazar.
	 */
	opportunityId?: string;
	leadId?: string;
	onGetDocumentsByDpi: (
		dpi: string,
		documentNames: string[],
	) => Promise<{
		success: boolean;
		/** null cuando RENAP no tiene a la persona: se usan los datos del CRM */
		renapData: RenapData | null;
		documents: Document[];
		fields: Field[];
		renapUnavailable?: boolean;
	}>;
	onGenerate: (data: {
		contracts: Array<{
			contractType: string;
			data: Record<string, string>;
			signers?: ContractSigner[];
			emails?: string[];
			options: {
				gender: "male" | "female";
				generatePdf: boolean;
				isPlural?: boolean;
				filenamePrefix: string;
			};
		}>;
	}) => Promise<GenerationResultWithData>;
	/**
	 * Guarda en la oportunidad los contratos recién generados.
	 *
	 * Sólo en ventas, donde generar y guardar son dos pasos: jurídico revisa los
	 * PDF antes de instalarlos. Sin esto, el wizard termina al generar.
	 */
	/**
	 * Una acción propia del área en cada contrato de los resultados. Se pasa tal
	 * cual a `ContractResults`.
	 */
	accionPorContrato?: (result: ContractResult) => ReactNode;
	/**
	 * Lo que el área quiera poner debajo de la lista de resultados, antes de las
	 * instrucciones. Inversiones pone ahí lo de subir un contrato armado por
	 * fuera, para tenerlo a mano sin bajar hasta el final de la pantalla.
	 */
	accionesDeResultados?: ReactNode;
	/**
	 * Lo que el área tiene de verdad, para mostrarlo en los resultados en vez de
	 * lo que devolvió esta emisión.
	 *
	 * Inversiones lo usa para que las tarjetas sean la vista previa del correo:
	 * reemplazar o subir un contrato cambia lo que la batería tiene, y los
	 * resultados de la emisión seguían mostrando el viejo. Los que fallaron en
	 * esta sesión se agregan igual, para poder reintentarlos.
	 */
	resultadosVigentes?: ContractResult[];
	/**
	 * El "Listo" de los resultados, cuando no hay paso de enlazado. Sin esto no
	 * aparece: inversiones sólo lo pasa mientras la batería no se mandó.
	 */
	onFinish?: () => void;
	/** Si el "Listo" está trabajando, para no mandarlo dos veces. */
	finalizando?: boolean;
	/** Avisa cuándo se están mostrando los resultados, y cuándo ya no. */
	onResultadosVisibles?: (visibles: boolean) => void;
	/**
	 * "Corregir y Regenerar" sin paso de enlazado: descarta lo emitido y vuelve
	 * al formulario con los datos cargados, como en ventas. Inversiones lo pasa
	 * sólo antes del "Listo"; sin esto el botón es "Volver".
	 */
	onCorregir?: () => Promise<void>;
	onLinkContracts?: (data: {
		opportunityId: string;
		leadId: string;
		contracts: Array<{
			contractType: string;
			contractName: string;
			documentLink?: string;
			signingLinks?: string[];
			templateId?: number;
			apiResponse?: unknown;
		}>;
		contractDate?: Date;
		generationData?: Array<{
			contractType: string;
			data: Record<string, string>;
			signers?: ContractSigner[];
			emails?: string[];
			options: {
				gender: "male" | "female";
				generatePdf: boolean;
				isPlural?: boolean;
				filenamePrefix: string;
			};
		}>;
	}) => Promise<{ success: boolean; message: string }>;
	/**
	 * Valores que el área ya conoce, por clave de campo.
	 *
	 * En ventas los campos se llenan del lead, la oportunidad y el vehículo, que
	 * el wizard conoce. En inversiones lo que se sabe viene de cartera —los
	 * créditos de la compra, con su capital y sus fechas—, y eso lo arma quien
	 * llama. Lo que ya se editó a mano no se pisa.
	 */
	valoresIniciales?: Record<string, string>;
	/**
	 * Un paso propio del área, antes del de selección.
	 *
	 * Inversiones lo usa para la categoría: primero individual o sociedad, y
	 * recién ahí qué contratos, porque la categoría decide cuáles hay. Sin esto,
	 * el wizard arranca en la selección de documentos, como en ventas.
	 */
	pasoPrevio?: {
		etiqueta: string;
		contenido: ReactNode;
		/** Si ya se puede seguir al paso de selección. */
		completo: boolean;
	};
	onBack: () => void;
	/**
	 * Borra en WeeTrust lo que se generó y no se va a enlazar. Los contratos se
	 * crean (y WeeTrust manda las invitaciones) antes de "Finalizar y Enlazar":
	 * si jurídico vuelve a corregir o se va, quedaban vivos sin fila en el CRM.
	 */
	onDescartarSinEnlazar?: (
		documentos: Array<{ documentID: string; descarte: string }>,
	) => void;
	isGenerating?: boolean;
	isLinking?: boolean;
}

// Fields to hide from form (signatures, etc.)
const HIDDEN_FIELDS = ["firma", "firmacashin", "signature", "sign"];

// Date-derived fields that are auto-calculated from date pickers
/**
 * Datos técnicos del vehículo que el CRM casi nunca tiene (cm3 y cilindros
 * solo se piden en la inspección; el ISCV es opcional). Cuando faltan se
 * llenan con un guion para no bloquear la generación.
 */
const OPTIONAL_VEHICLE_FIELDS = [
	"cm3vehiculo",
	"cilindrosvehiculo",
	"iscvvehiculo",
];

const MISSING_FIELD_PLACEHOLDER = "-";

/** Campos que se llenan solo si la oportunidad tiene vendedor asignado. */
const VENDOR_FIELDS = ["nombrevendedor", "dpivendedor", "dpitextovendedor"];

const DATE_DERIVED_FIELDS = [
	"diapago",
	"diatextovencimiento",
	"mestextovencimiento",
	"anotextovencimiento",
	"diavencimiento",
	"mesvencimiento",
	"anovencimiento",
];

// Helper function to convert a number group to words (for DPI)
function dpiGroupToWords(numStr: string): string {
	const num = Number.parseInt(numStr, 10);
	if (Number.isNaN(num)) return numStr;

	const unidades = [
		"",
		"uno",
		"dos",
		"tres",
		"cuatro",
		"cinco",
		"seis",
		"siete",
		"ocho",
		"nueve",
	];
	const especiales = [
		"diez",
		"once",
		"doce",
		"trece",
		"catorce",
		"quince",
		"dieciséis",
		"diecisiete",
		"dieciocho",
		"diecinueve",
	];
	const decenas = [
		"",
		"",
		"veinte",
		"treinta",
		"cuarenta",
		"cincuenta",
		"sesenta",
		"setenta",
		"ochenta",
		"noventa",
	];
	const centenas = [
		"",
		"ciento",
		"doscientos",
		"trescientos",
		"cuatrocientos",
		"quinientos",
		"seiscientos",
		"setecientos",
		"ochocientos",
		"novecientos",
	];

	if (num === 0) return "cero";
	if (num === 100) return "cien";

	let result = "";

	// Miles
	if (num >= 1000) {
		const miles = Math.floor(num / 1000);
		if (miles === 1) {
			result = "mil";
		} else {
			result = `${dpiGroupToWords(String(miles))} mil`;
		}
	}

	// Resto
	const resto = num % 1000;
	if (resto > 0) {
		// Centenas
		if (resto >= 100) {
			const c = Math.floor(resto / 100);
			if (resto === 100) {
				result += result ? " cien" : "cien";
			} else {
				result += result ? ` ${centenas[c]}` : centenas[c];
			}
		}

		// Decenas y unidades
		const du = resto % 100;
		if (du > 0) {
			if (du < 10) {
				result += result ? ` ${unidades[du]}` : unidades[du];
			} else if (du < 20) {
				result += result ? ` ${especiales[du - 10]}` : especiales[du - 10];
			} else {
				const d = Math.floor(du / 10);
				const u = du % 10;
				if (u === 0) {
					result += result ? ` ${decenas[d]}` : decenas[d];
				} else if (d === 2) {
					result += result ? ` veinti${unidades[u]}` : `veinti${unidades[u]}`;
				} else {
					result += result
						? ` ${decenas[d]} y ${unidades[u]}`
						: `${decenas[d]} y ${unidades[u]}`;
				}
			}
		}
	}

	return result.trim();
}

// Convert money amount to words in Spanish
export function moneyToWords(amount: number): string {
	const unidades = [
		"",
		"UN",
		"DOS",
		"TRES",
		"CUATRO",
		"CINCO",
		"SEIS",
		"SIETE",
		"OCHO",
		"NUEVE",
	];
	const especiales = [
		"DIEZ",
		"ONCE",
		"DOCE",
		"TRECE",
		"CATORCE",
		"QUINCE",
		"DIECISEIS",
		"DIECISIETE",
		"DIECIOCHO",
		"DIECINUEVE",
	];
	const decenas = [
		"",
		"",
		"VEINTE",
		"TREINTA",
		"CUARENTA",
		"CINCUENTA",
		"SESENTA",
		"SETENTA",
		"OCHENTA",
		"NOVENTA",
	];
	const centenas = [
		"",
		"CIENTO",
		"DOSCIENTOS",
		"TRESCIENTOS",
		"CUATROCIENTOS",
		"QUINIENTOS",
		"SEISCIENTOS",
		"SETECIENTOS",
		"OCHOCIENTOS",
		"NOVECIENTOS",
	];

	const convertirGrupo = (n: number): string => {
		if (n === 0) return "";
		if (n === 100) return "CIEN";

		let resultado = "";

		if (n >= 100) {
			resultado += centenas[Math.floor(n / 100)] + " ";
			n %= 100;
		}

		if (n >= 20) {
			const d = Math.floor(n / 10);
			const u = n % 10;
			if (u === 0) {
				resultado += decenas[d];
			} else if (d === 2) {
				resultado += "VEINTI" + unidades[u];
			} else {
				resultado += decenas[d] + " Y " + unidades[u];
			}
		} else if (n >= 10) {
			resultado += especiales[n - 10];
		} else if (n > 0) {
			resultado += unidades[n];
		}

		return resultado.trim();
	};

	const entero = Math.floor(amount);
	const centavos = Math.round((amount - entero) * 100);

	if (entero === 0) return "CERO QUETZALES";

	let resultado = "";

	// Millones
	if (entero >= 1000000) {
		const millones = Math.floor(entero / 1000000);
		if (millones === 1) {
			resultado += "UN MILLON ";
		} else {
			resultado += convertirGrupo(millones) + " MILLONES ";
		}
	}

	// Miles
	const resto = entero % 1000000;
	if (resto >= 1000) {
		const miles = Math.floor(resto / 1000);
		if (miles === 1) {
			resultado += "MIL ";
		} else {
			resultado += convertirGrupo(miles) + " MIL ";
		}
	}

	// Unidades
	const unidad = resto % 1000;
	if (unidad > 0) {
		resultado += convertirGrupo(unidad) + " ";
	}

	resultado += "QUETZALES";

	if (centavos > 0) {
		resultado += " CON " + convertirGrupo(centavos) + " CENTAVOS";
	}

	return resultado.trim();
}

// Convert age number to text in Spanish
function numberToTextForAge(num: number): string {
	if (num < 0 || num > 99) return num.toString();

	const basicNumbers: Record<number, string> = {
		0: "cero",
		1: "uno",
		2: "dos",
		3: "tres",
		4: "cuatro",
		5: "cinco",
		6: "seis",
		7: "siete",
		8: "ocho",
		9: "nueve",
		10: "diez",
		11: "once",
		12: "doce",
		13: "trece",
		14: "catorce",
		15: "quince",
		16: "dieciséis",
		17: "diecisiete",
		18: "dieciocho",
		19: "diecinueve",
		20: "veinte",
		21: "veintiuno",
		22: "veintidós",
		23: "veintitrés",
		24: "veinticuatro",
		25: "veinticinco",
		26: "veintiséis",
		27: "veintisiete",
		28: "veintiocho",
		29: "veintinueve",
		30: "treinta",
	};

	if (basicNumbers[num] !== undefined) return basicNumbers[num];

	if (num > 30) {
		const tens = Math.floor(num / 10);
		const units = num % 10;

		const tensText: Record<number, string> = {
			3: "treinta",
			4: "cuarenta",
			5: "cincuenta",
			6: "sesenta",
			7: "setenta",
			8: "ochenta",
			9: "noventa",
		};
		const unitsText: Record<number, string> = {
			1: "uno",
			2: "dos",
			3: "tres",
			4: "cuatro",
			5: "cinco",
			6: "seis",
			7: "siete",
			8: "ocho",
			9: "nueve",
		};

		if (units === 0) return tensText[tens] || num.toString();
		return `${tensText[tens]} y ${unitsText[units]}`;
	}

	return num.toString();
}

// Map marital status enum to Spanish text
function mapMaritalStatus(status: string | null | undefined): string {
	if (!status) return "";
	const map: Record<string, string> = {
		single: "soltero",
		married: "casado",
		divorced: "divorciado",
		widowed: "viudo",
	};
	return map[status] || status.toLowerCase();
}

// Convert DPI to words in uppercase with number in parentheses
function dpiToWords(dpi: string): string {
	const cleanDpi = dpi.replace(/\D/g, "");
	if (cleanDpi.length !== 13) return dpi.toUpperCase();

	// Dividir en grupos: 4-5-4
	const grupo1 = cleanDpi.slice(0, 4);
	const grupo2 = cleanDpi.slice(4, 9);
	const grupo3 = cleanDpi.slice(9, 13);

	// Convertir cada grupo a palabras
	const palabras1 = dpiGroupToWords(grupo1);
	const palabras2 = dpiGroupToWords(grupo2);
	const palabras3 = dpiGroupToWords(grupo3);

	const texto = `${palabras1} ${palabras2} ${palabras3}`.toLowerCase();
	return `${texto} (${cleanDpi})`;
}

/**
 * Un campo de lista: tantos items como haga falta, cada uno con sus columnas.
 *
 * Es lo que piden la cesión de créditos (un item por crédito cedido) y el anexo
 * de beneficiarios (uno por persona designada). Se guarda como JSON en el
 * formulario y se convierte a arreglo al mandarlo.
 */
function CampoDeLista({
	field,
	valor,
	onChange,
}: {
	field: Field;
	valor: string;
	onChange: (key: string, value: string) => void;
}) {
	const items = itemsDeLista(valor);
	const columnas = field.options ?? [];

	const guardar = (siguientes: Array<Record<string, string>>) =>
		onChange(field.key, JSON.stringify(siguientes));

	return (
		<div className="space-y-3">
			{items.length === 0 && (
				<p className="text-muted-foreground text-xs italic">
					Sin items todavía. Agregá el primero.
				</p>
			)}

			{items.map((item, idx) => (
				<div
					key={`${field.key}-${idx}`}
					className="space-y-2 rounded-md border bg-muted/20 p-3"
				>
					<div className="flex items-center justify-between">
						<span className="font-medium text-muted-foreground text-xs">
							Item #{idx + 1}
						</span>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="text-destructive hover:text-destructive"
							onClick={() => guardar(items.filter((_, i) => i !== idx))}
						>
							<Trash2 className="h-4 w-4" />
						</Button>
					</div>
					<div className="grid grid-cols-1 gap-2 md:grid-cols-2">
						{columnas.map((columna) => (
							<div key={columna.value} className="flex flex-col">
								<label
									className="mb-1 text-muted-foreground text-xs"
									htmlFor={`${field.key}-${idx}-${columna.value}`}
								>
									{columna.label}
								</label>
								<Input
									id={`${field.key}-${idx}-${columna.value}`}
									value={item[columna.value] ?? ""}
									placeholder={columna.label}
									className="h-9 bg-white text-sm"
									onChange={(e) =>
										guardar(
											items.map((otro, i) =>
												i === idx
													? { ...otro, [columna.value]: e.target.value }
													: otro,
											),
										)
									}
								/>
							</div>
						))}
					</div>
				</div>
			))}

			<Button
				type="button"
				variant="outline"
				size="sm"
				className="gap-2"
				onClick={() =>
					guardar([
						...items,
						Object.fromEntries(columnas.map((c) => [c.value, ""])),
					])
				}
			>
				<Plus className="h-4 w-4" />
				Agregar
			</Button>
		</div>
	);
}

export function DynamicContractWizard({
	documentTypes,
	crmData,
	opportunityId,
	leadId,
	pasoPrevio,
	valoresIniciales,
	onGetDocumentsByDpi,
	onGenerate,
	accionPorContrato,
	accionesDeResultados,
	resultadosVigentes,
	onFinish,
	finalizando = false,
	onResultadosVisibles,
	onCorregir,
	onLinkContracts,
	onBack,
	onDescartarSinEnlazar,
	isGenerating = false,
	isLinking = false,
}: DynamicContractWizardProps) {
	const [step, setStep] = useState<0 | 1 | 2 | 3>(pasoPrevio ? 0 : 1);

	// Lo generado que todavía no se enlazó: documento -> comprobante. Ref y no
	// estado porque lo lee la limpieza al desmontar, que ve la última versión.
	const sinEnlazarRef = useRef(new Map<string, string>());
	const descartarRef = useRef(onDescartarSinEnlazar);
	descartarRef.current = onDescartarSinEnlazar;

	const descartarSinEnlazar = useCallback(() => {
		const documentos = [...sinEnlazarRef.current].map(
			([documentID, descarte]) => ({ documentID, descarte }),
		);
		sinEnlazarRef.current.clear();
		if (documentos.length > 0) descartarRef.current?.(documentos);
	}, []);

	// Irse sin enlazar (la flecha de atrás, otra ruta) deja lo generado sin
	// dueño: se descarta al desmontar. Cerrar la pestaña no pasa por acá.
	const montadoRef = useRef(true);
	useEffect(() => {
		montadoRef.current = true;
		return () => {
			montadoRef.current = false;
			descartarSinEnlazar();
		};
	}, [descartarSinEnlazar]);

	const anotarGenerados = (resultados: ContractResult[]) => {
		for (const r of resultados) {
			if (r.documentID && r.descarte) {
				sinEnlazarRef.current.set(r.documentID, r.descarte);
			}
		}
		// La generación terminó después de que se fueron de la pantalla: la
		// limpieza al desmontar ya pasó con la lista vacía, así que se descarta
		// ahora. Si no, esos documentos quedaban vivos en WeeTrust sin dueño.
		if (!montadoRef.current) descartarSinEnlazar();
	};
	const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
	const [isLoadingFields, setIsLoadingFields] = useState(false);
	const [showLinkConfirmDialog, setShowLinkConfirmDialog] = useState(false);

	// Data from API
	const [renapData, setRenapData] = useState<RenapData | null>(null);
	// RENAP no encontró el DPI: los campos se llenaron solo con datos del CRM
	const [renapUnavailable, setRenapUnavailable] = useState(false);
	const [documents, setDocuments] = useState<Document[]>([]);
	const [fields, setFields] = useState<Field[]>([]);
	const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

	const [generationResult, setGenerationResult] =
		useState<GenerationResultWithData | null>(null);
	// Tipo de contrato que se está reintentando, para bloquear el resto de botones
	const [retryingType, setRetryingType] = useState<string | null>(null);

	// State for editable co-debtor fields
	const [coDebtorFields, setCoDebtorFields] = useState<
		EditableCoDebtorFields[]
	>([]);

	const touchedFieldsRef = useRef<Set<string>>(new Set());

	// Store generation data for snapshot using ref to avoid state timing issues
	const generationDataRef = useRef<
		Array<{
			contractType: string;
			data: Record<string, string>;
			signers?: ContractSigner[];
			emails?: string[];
			options: {
				gender: "male" | "female";
				generatePdf: boolean;
				isPlural?: boolean;
				filenamePrefix: string;
			};
		}>
	>([]);

	// Date configuration states
	const [fechaVencimiento, setFechaVencimiento] = useState<string>("");
	const [diaPago, setDiaPago] = useState<string>("día quince"); // Default día 15
	// Día recomendado por la IA que el analista eligió en el 50% (si aplica).
	// Solo se llena cuando opportunity.diaPagoMensual no es 15 ni 30.
	const [analysisSuggestedDay, setAnalysisSuggestedDay] = useState<{
		dia: number;
		label: string;
	} | null>(null);

	// Initialize co-debtor editable fields from CRM data
	useEffect(() => {
		if (crmData.coDebtors && crmData.coDebtors.length > 0) {
			const initialFields = crmData.coDebtors.map((cd) => ({
				id: cd.id,
				nombreCompleto: cd.fullName?.toUpperCase() || "",
				dpi: cd.dpi || "",
				dpiTexto: cd.dpi ? dpiToWords(cd.dpi) : "",
				edadTexto: cd.age ? numberToTextForAge(cd.age) : "",
				estadoCivil: mapMaritalStatus(cd.maritalStatus),
				profesion: cd.profession?.toLowerCase() || "",
				nacionalidad: cd.nationality?.toLowerCase() || "",
				correoElectronico: cd.email || "",
			}));
			setCoDebtorFields(initialFields);
		}
	}, [crmData.coDebtors]);

	// Months in Spanish for date conversion
	const monthsSpanish = useMemo(
		() => [
			"enero",
			"febrero",
			"marzo",
			"abril",
			"mayo",
			"junio",
			"julio",
			"agosto",
			"septiembre",
			"octubre",
			"noviembre",
			"diciembre",
		],
		[],
	);

	// Get ALL relevant fields for selected documents (including date fields for checking)
	const allRelevantFields = useMemo(() => {
		const selectedDocIds = documents
			.filter((doc) => selectedDocuments.includes(doc.nombre_documento))
			.map((doc) => doc.id);

		return fields
			.filter(
				(field) =>
					field.iddocuments.some((docId) => selectedDocIds.includes(docId)) &&
					!HIDDEN_FIELDS.includes(field.key?.toLowerCase()),
			)
			.sort((a, b) => {
				const relationA = Number.parseFloat(a.relation) || 0;
				const relationB = Number.parseFloat(b.relation) || 0;
				return relationA - relationB;
			});
	}, [fields, documents, selectedDocuments]);

	// Check if any date-derived fields are needed
	const needsDateConfig = useMemo(() => {
		return allRelevantFields.some((field) =>
			DATE_DERIVED_FIELDS.includes(field.key?.toLowerCase()),
		);
	}, [allRelevantFields]);

	// Get relevant fields EXCLUDING date-derived fields (shown separately)
	const relevantFields = useMemo(() => {
		return allRelevantFields.filter(
			(field) => !DATE_DERIVED_FIELDS.includes(field.key?.toLowerCase()),
		);
	}, [allRelevantFields]);

	// Get date-derived fields separately
	const dateFields = useMemo(() => {
		return allRelevantFields.filter((field) =>
			DATE_DERIVED_FIELDS.includes(field.key?.toLowerCase()),
		);
	}, [allRelevantFields]);

	// Number to text utility (moved up for use in updateDateFields)
	const numberToText = useCallback((num: number): string => {
		if (num < 0 || num > 99) return num.toString();

		const basicNumbers: Record<number, string> = {
			0: "cero",
			1: "uno",
			2: "dos",
			3: "tres",
			4: "cuatro",
			5: "cinco",
			6: "seis",
			7: "siete",
			8: "ocho",
			9: "nueve",
			10: "diez",
			11: "once",
			12: "doce",
			13: "trece",
			14: "catorce",
			15: "quince",
			16: "dieciséis",
			17: "diecisiete",
			18: "dieciocho",
			19: "diecinueve",
			20: "veinte",
			21: "veintiuno",
			22: "veintidós",
			23: "veintitrés",
			24: "veinticuatro",
			25: "veinticinco",
			26: "veintiséis",
			27: "veintisiete",
			28: "veintiocho",
			29: "veintinueve",
			30: "treinta",
		};

		if (basicNumbers[num] !== undefined) return basicNumbers[num];

		if (num > 30) {
			const tens = Math.floor(num / 10);
			const units = num % 10;

			const tensText: Record<number, string> = {
				3: "treinta",
				4: "cuarenta",
				5: "cincuenta",
				6: "sesenta",
				7: "setenta",
				8: "ochenta",
				9: "noventa",
			};
			const unitsText: Record<number, string> = {
				1: "uno",
				2: "dos",
				3: "tres",
				4: "cuatro",
				5: "cinco",
				6: "seis",
				7: "siete",
				8: "ocho",
				9: "nueve",
			};

			if (units === 0) return tensText[tens] || num.toString();
			return `${tensText[tens]} y ${unitsText[units]}`;
		}

		return num.toString();
	}, []);

	// Update date-derived field values when dates change
	const updateDateFields = useCallback(
		(vencimiento: string, diaPagoVal: string) => {
			const updates: Record<string, string> = {};

			// Día de pago
			if (diaPagoVal) {
				updates.diaPago = diaPagoVal;
			}

			// Fecha de vencimiento
			if (vencimiento) {
				const fecha = new Date(vencimiento + "T00:00:00");
				const dia = fecha.getDate();
				const mes = fecha.getMonth();
				const anio = fecha.getFullYear();

				updates.diaTextoVencimiento = numberToText(dia);
				updates.mesTextoVencimiento = monthsSpanish[mes];
				updates.anoTextoVencimiento = numberToText(anio % 100);
				updates.diaVencimiento = String(dia);
				updates.mesVencimiento = String(mes + 1).padStart(2, "0");
				updates.anoVencimiento = String(anio).slice(-2);
			}

			setFieldValues((prev) => ({ ...prev, ...updates }));
		},
		[numberToText, monthsSpanish],
	);

	// Handle date changes
	const handleFechaVencimientoChange = (value: string) => {
		setFechaVencimiento(value);
		updateDateFields(value, diaPago);
	};

	const handleDiaPagoChange = (value: string) => {
		setDiaPago(value);

		// Actualizar el día de la fecha de vencimiento según el día de pago
		if (fechaVencimiento) {
			const fecha = new Date(fechaVencimiento + "T00:00:00");
			const anio = fecha.getFullYear();
			const mes = fecha.getMonth();

			let nuevoDia: number;
			if (value === "último día") {
				// Último día del mes
				nuevoDia = new Date(anio, mes + 1, 0).getDate();
			} else if (analysisSuggestedDay && value === analysisSuggestedDay.label) {
				// Día recomendado por la IA que eligió el analista en el 50%
				const diasEnMes = new Date(anio, mes + 1, 0).getDate();
				nuevoDia = Math.min(analysisSuggestedDay.dia, diasEnMes);
			} else {
				// Día 15
				nuevoDia = 15;
			}

			const fechaStr = `${anio}-${String(mes + 1).padStart(2, "0")}-${String(nuevoDia).padStart(2, "0")}`;
			setFechaVencimiento(fechaStr);
			updateDateFields(fechaStr, value);
		} else {
			updateDateFields(fechaVencimiento, value);
		}
	};

	// Format money to text (e.g., "CIENTO CINCUENTA MIL QUETZALES (Q150,000.00)")
	const moneyToText = useCallback((amount: number): string => {
		const formatted = amount.toLocaleString("es-GT", {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		});
		// Simplified - in production you'd want a full number-to-words library
		return `Q${formatted}`;
	}, []);

	// Pre-fill fields with CRM data, RENAP data, and defaults
	const prefillFields = useCallback(
		(fieldsData: Field[], renapInfo: RenapData | null) => {
			const initialValues: Record<string, string> = {};
			const today = new Date();
			const months = [
				"enero",
				"febrero",
				"marzo",
				"abril",
				"mayo",
				"junio",
				"julio",
				"agosto",
				"septiembre",
				"octubre",
				"noviembre",
				"diciembre",
			];

			const {
				cliente,
				vehiculo,
				credito,
				vendedor,
				desembolso,
				entidad,
				agencia,
			} = crmData;
			const gender = cliente.genero || renapInfo?.gender || "M";

			fieldsData.forEach((field) => {
				const fieldKeyLower = field.key?.toLowerCase();

				// === CLIENTE DATA (from CRM) ===
				switch (fieldKeyLower) {
					case "nombrecompleto":
						if (cliente.nombreCompleto) {
							initialValues[field.key] = renapInfo
								? `${renapInfo.firstName} ${renapInfo.secondName} ${renapInfo.thirdName} ${renapInfo.firstLastName} ${renapInfo.secondLastName} ${renapInfo.marriedLastName}`.toUpperCase()
								: cliente.nombreCompleto.toUpperCase();
							return;
						}
						break;
					case "dpi":
						if (cliente.dpi) {
							initialValues[field.key] = cliente.dpi;
							return;
						}
						break;
					case "dpitexto":
						if (cliente.dpi) {
							initialValues[field.key] = dpiToWords(cliente.dpi);
							return;
						}
						break;
					case "direccion":
						if (cliente.direccion) {
							initialValues[field.key] = cliente.direccion.toUpperCase();
							return;
						}
						break;
					case "nacionalidad":
						if (cliente.nacionalidad) {
							initialValues[field.key] = cliente.nacionalidad.toLowerCase();
							return;
						}
						break;
					case "estadocivil":
						if (cliente.estadoCivil) {
							initialValues[field.key] = cliente.estadoCivil.toLowerCase();
							return;
						}
						break;
					case "profesion":
						if (cliente.profesion) {
							initialValues[field.key] =
								cliente?.profesion.toLowerCase() ||
								renapInfo?.ocupation.toLowerCase() ||
								"";
							return;
						}
						break;
					case "edad":
						if (cliente.edad) {
							initialValues[field.key] = numberToText(cliente.edad);
							return;
						}
						break;
					case "correo":
						if (cliente.correo) {
							initialValues[field.key] = cliente.correo;
							return;
						}
						break;
				}

				// === VEHICULO DATA (from CRM) ===
				switch (fieldKeyLower) {
					case "tipovehiculo":
						if (vehiculo.tipo) {
							initialValues[field.key] = vehiculo.tipo.toUpperCase();
							return;
						}
						break;
					case "marcavehiculo":
						if (vehiculo.marca) {
							initialValues[field.key] = vehiculo.marca.toUpperCase();
							return;
						}
						break;
					case "lineavehiculo":
						if (vehiculo.linea) {
							initialValues[field.key] = vehiculo.linea.toUpperCase();
							return;
						}
						break;
					case "modelovehiculo":
						if (vehiculo.modelo) {
							initialValues[field.key] = vehiculo.modelo;
							return;
						}
						break;
					case "colorvehiculo":
						if (vehiculo.color) {
							initialValues[field.key] = vehiculo.color.toUpperCase();
							return;
						}
						break;
					case "usovehiculo":
						if (vehiculo.uso) {
							initialValues[field.key] = vehiculo.uso.toUpperCase();
							return;
						}
						break;
					case "chasisvehiculo":
						if (vehiculo.chasis) {
							initialValues[field.key] = vehiculo.chasis.toUpperCase();
							return;
						}
						break;
					case "combustiblevehiculo":
						if (vehiculo.combustible) {
							initialValues[field.key] = vehiculo.combustible.toUpperCase();
							return;
						}
						break;
					case "motorvehiculo":
						if (vehiculo.motor) {
							initialValues[field.key] = vehiculo.motor.toUpperCase();
							return;
						}
						break;
					case "serievehiculo":
						if (vehiculo.serie) {
							initialValues[field.key] = vehiculo.serie.toUpperCase();
							return;
						}
						break;
					case "cm3vehiculo":
						if (vehiculo.cm3) {
							initialValues[field.key] = vehiculo.cm3;
							return;
						}
						break;
					case "asientosvehiculo":
						if (vehiculo.asientos) {
							initialValues[field.key] = vehiculo.asientos;
							return;
						}
						break;
					case "cilindrosvehiculo":
						if (vehiculo.cilindros) {
							initialValues[field.key] = vehiculo.cilindros;
							return;
						}
						break;
					case "iscvvehiculo":
						if (vehiculo.iscv) {
							initialValues[field.key] = vehiculo.iscv;
							return;
						}
						break;
				}

				// === CREDITO DATA (from CRM) ===
				switch (fieldKeyLower) {
					case "capitaladeudado":
						if (credito.capitalAdeudado) {
							initialValues[field.key] =
								`${moneyToWords(credito.capitalAdeudado).toUpperCase()} (${moneyToText(credito.capitalAdeudado)})`;
							return;
						}
						break;
					case "mesesprestamo":
						if (credito.mesesPrestamo) {
							initialValues[field.key] =
								`${numberToText(credito.mesesPrestamo).toUpperCase()} (${credito.mesesPrestamo})`;
							return;
						}
						break;
					case "cuotasmensuales":
					case "cuotamensual":
						if (credito.cuotaMensual) {
							initialValues[field.key] =
								`${moneyToWords(credito.cuotaMensual).toUpperCase()} (${moneyToText(credito.cuotaMensual)})`;
							return;
						}
						break;
					case "cantidadcuota":
						// Cuota en letras minúsculas
						if (credito.cuotaMensual) {
							const cuotaFormateada = credito.cuotaMensual.toLocaleString(
								"es-GT",
								{
									minimumFractionDigits: 2,
									maximumFractionDigits: 2,
								},
							);
							initialValues[field.key] = `Q.${cuotaFormateada}`;
							return;
						}
						break;
					case "cantidad":
						// Valor Nominal = cuota × plazo
						if (credito.cuotaMensual && credito.mesesPrestamo) {
							const valorNominal = credito.cuotaMensual * credito.mesesPrestamo;
							const valorFormateado = valorNominal.toLocaleString("es-GT", {
								minimumFractionDigits: 2,
								maximumFractionDigits: 2,
							});
							initialValues[field.key] = `${valorFormateado}`;
							return;
						}
						break;
					case "valornominaltexto":
						// Valor Nominal en letras MAYÚSCULAS (número entre paréntesis)
						if (credito.cuotaMensual && credito.mesesPrestamo) {
							const valorNominal = credito.cuotaMensual * credito.mesesPrestamo;
							const valorFormateado = valorNominal.toLocaleString("es-GT", {
								minimumFractionDigits: 2,
								maximumFractionDigits: 2,
							});
							const enLetras = moneyToWords(valorNominal);
							initialValues[field.key] = `${enLetras} (Q.${valorFormateado})`;
							return;
						}
						break;
					case "porcentajedeudanumero":
						if (credito.porcentajeInteres) {
							initialValues[field.key] = String(credito.porcentajeInteres);
							return;
						}
						break;
					case "porcentajedeudaletras":
					case "porcentajedeulatexto":
					case "porcentajedeutexto":
					case "porcentajedeuatexto":
					case "porcentajedudatexto":
					case "porcentajedeudatexto":
						if (credito.porcentajeInteres) {
							// Manejar decimales: 1.5 -> "uno punto cinco"
							const partes = String(credito.porcentajeInteres).split(".");
							const entero = numberToText(Number(partes[0]));
							if (partes[1]) {
								const decimal = numberToText(Number(partes[1]));
								initialValues[field.key] = `${entero} punto ${decimal}`;
							} else {
								initialValues[field.key] = entero;
							}
							return;
						}
						break;
					case "porcentajemoranumero":
						// Default 5% si no viene del backend
						initialValues[field.key] = String(credito.porcentajeMora || 5);
						return;
					case "porcentajemoratexto":
					case "porcentajemoraletras": {
						// Default 5% si no viene del backend
						const mora = credito.porcentajeMora || 5;
						const partesMora = String(mora).split(".");
						const enteroMora = numberToText(Number(partesMora[0]));
						if (partesMora[1]) {
							const decimalMora = numberToText(Number(partesMora[1]));
							initialValues[field.key] = `${enteroMora} punto ${decimalMora}`;
						} else {
							initialValues[field.key] = enteroMora;
						}
						return;
					}
					case "plazo":
						if (credito.mesesPrestamo) {
							initialValues[field.key] = String(credito.mesesPrestamo);
							return;
						}
						break;
					case "plazotexto":
						if (credito.mesesPrestamo) {
							initialValues[field.key] = numberToText(credito.mesesPrestamo);
							return;
						}
						break;
				}

				// === DATE FIELDS (auto-generated) ===
				switch (fieldKeyLower) {
					case "dia":
						initialValues[field.key] = today
							.getDate()
							.toString()
							.padStart(2, "0");
						return;
					case "diatexto":
						initialValues[field.key] = numberToText(today.getDate());
						return;
					case "mes":
						initialValues[field.key] = (today.getMonth() + 1)
							.toString()
							.padStart(2, "0");
						return;
					case "mestexto":
						initialValues[field.key] = months[today.getMonth()];
						return;
					case "ano":
						initialValues[field.key] = today.getFullYear().toString().slice(-2);
						return;
					case "anotexto":
						initialValues[field.key] = numberToText(today.getFullYear() % 100);
						return;
					case "fechainiciocontrato":
						initialValues[field.key] =
							`${numberToText(today.getDate())} de ${months[today.getMonth()]} de dos mil ${numberToText(today.getFullYear() % 100)}`;
						return;
				}

				// === VENDEDOR DEL VEHICULO (from CRM) ===
				switch (fieldKeyLower) {
					case "nombrevendedor":
						if (vendedor?.nombreMayusculas) {
							initialValues[field.key] = vendedor.nombreMayusculas;
							return;
						}
						break;
					case "dpivendedor":
						if (vendedor?.dpi) {
							initialValues[field.key] = vendedor.dpi;
							return;
						}
						break;
					case "dpitextovendedor":
						// Mismo helper que "dpitexto" para que los dos DPI del
						// documento se lean igual.
						if (vendedor?.dpi) {
							initialValues[field.key] = dpiToWords(vendedor.dpi);
							return;
						}
						break;
					case "agencia":
						// La empresa asignada a la oportunidad. En un usado no aplica y
						// se resuelve más abajo con un guion.
						if (vehiculo.esNuevo === true && agencia) {
							initialValues[field.key] = agencia.toUpperCase();
							return;
						}
						break;
					case "gendervendedor":
						// Se captura al asignar la inversión (DPI + RENAP).
						if (vendedor?.genero === "male" || vendedor?.genero === "female") {
							initialValues[field.key] = vendedor.genero;
							return;
						}
						break;
				}

				// === DESEMBOLSO: cheques ya registrados (from CRM) ===
				switch (fieldKeyLower) {
					case "cuenta":
						if (desembolso?.filas[0]) {
							initialValues[field.key] = desembolso.filas[0].cuenta;
							return;
						}
						break;
					case "valor":
						if (desembolso?.filas[0]) {
							initialValues[field.key] = desembolso.filas[0].valor;
							return;
						}
						break;
					case "cuenta2":
						if (desembolso?.filas[1]) {
							initialValues[field.key] = desembolso.filas[1].cuenta;
							return;
						}
						break;
					case "valor2":
						if (desembolso?.filas[1]) {
							initialValues[field.key] = desembolso.filas[1].valor;
							return;
						}
						break;
				}

				// === ENTIDAD ACREEDORA (inversionista del 50%) ===
				switch (fieldKeyLower) {
					case "entidad":
						if (entidad?.nombre) {
							initialValues[field.key] = entidad.nombre;
							return;
						}
						break;
					case "tipoentidad":
						if (entidad?.tipo) {
							initialValues[field.key] = entidad.tipo;
							return;
						}
						break;
				}

				// === DEFAULT VALUES from API field definition ===
				if (field.default && field.default.trim()) {
					initialValues[field.key] = field.default;
					return;
				}

				// === FALLBACK: try RENAP data if CRM doesn't have it ===
				if (renapInfo) {
					switch (fieldKeyLower) {
						case "nombrecompleto":
							initialValues[field.key] =
								`${renapInfo.firstName} ${renapInfo.secondName || ""} ${renapInfo.firstLastName} ${renapInfo.secondLastName}`
									.trim()
									.toUpperCase();
							return;
						case "dpi":
							initialValues[field.key] = renapInfo.dpi;
							return;
						case "nacionalidad":
							initialValues[field.key] =
								renapInfo.nationality?.toLowerCase() || "";
							return;
					}
				}

				// === ÚLTIMO RECURSO: datos técnicos del vehículo ===
				// Van al final a propósito: si el CRM tiene el dato, o la API define un
				// default, esos ganan. El guion evita que un dato que nadie tiene
				// bloquee la generación; cada campo avisa debajo que quedó así.
				if (OPTIONAL_VEHICLE_FIELDS.includes(fieldKeyLower)) {
					initialValues[field.key] = MISSING_FIELD_PLACEHOLDER;
				}

				// La agencia solo aplica a carro nuevo. En un usado no existe, así que
				// se marca con guion y sin aviso: no es un dato que falte, no aplica.
				if (fieldKeyLower === "agencia" && vehiculo.esNuevo === false) {
					initialValues[field.key] = MISSING_FIELD_PLACEHOLDER;
				}
			});

			setFieldValues((prev) => {
				const editadosAMano: Record<string, string> = {};
				for (const key of touchedFieldsRef.current) {
					if (prev[key] !== undefined) editadosAMano[key] = prev[key];
				}
				// Los del área van después de los del CRM y antes de lo editado a
				// mano: son datos que acá no se saben calcular, pero no le ganan a
				// quien ya los corrigió.
				return { ...initialValues, ...valoresIniciales, ...editadosAMano };
			});
		},
		[crmData, numberToText, moneyToText, valoresIniciales],
	);

	/**
	 * Contratos que no salieron. Con alguno así, "Listo" no puede cerrar el
	 * trabajo: la batería saldría de la lista de jurídico con un contrato de
	 * menos y nadie se enteraría.
	 */
	const fallidosDeLaSesion =
		generationResult?.results.filter((r) => !r.success) ?? [];
	const fallidos = fallidosDeLaSesion.length;
	const hayFallidos = fallidos > 0;

	// Las tarjetas: lo que el área tiene de verdad, si lo pasa, más lo que falló
	// en esta sesión. Si no, lo que devolvió la emisión.
	const resultadosAMostrar = resultadosVigentes
		? [...resultadosVigentes, ...fallidosDeLaSesion]
		: (generationResult?.results ?? []);

	const resultadosVisibles = step === 3 && Boolean(generationResult);
	useEffect(() => {
		onResultadosVisibles?.(resultadosVisibles);
	}, [resultadosVisibles, onResultadosVisibles]);

	// Fetch documents and fields when moving to step 2
	const fetchDocumentsData = async () => {
		if (selectedDocuments.length === 0 || !crmData.cliente.dpi) return;

		setIsLoadingFields(true);
		try {
			const response = await onGetDocumentsByDpi(
				crmData.cliente.dpi,
				selectedDocuments,
			);
			if (response.success) {
				setRenapData(response.renapData);
				setDocuments(response.documents);
				setFields(response.fields);
				prefillFields(response.fields, response.renapData);

				// RENAP no siempre tiene a la persona aunque el DPI sea correcto:
				// se sigue con los datos de la oportunidad, pero hay que revisarlos.
				const sinRenap = response.renapUnavailable ?? !response.renapData;
				setRenapUnavailable(sinRenap);
				if (sinRenap) {
					toast.warning(
						"RENAP no devolvió datos de este DPI. Los campos se llenaron con la información del CRM: revíselos antes de generar.",
						{ duration: 8000 },
					);
				}

				// Auto-calculate fecha de vencimiento if we have credit data
				if (crmData.credito?.mesesPrestamo) {
					const hoy = new Date();
					const diaActual = hoy.getDate();

					// Calcular mes de vencimiento (setear día 1 primero para evitar desbordamiento)
					const fechaVenc = new Date();
					fechaVenc.setDate(1);
					fechaVenc.setMonth(
						fechaVenc.getMonth() + crmData.credito.mesesPrestamo + 1,
					);
					const mesVenc = fechaVenc.getMonth();
					const anioVenc = fechaVenc.getFullYear();

					let diaPagoDefault: string;
					let diaVenc: number;

					const diaAnalisis = crmData.credito?.diaPagoMensualRaw;
					const diasEnMesVenc = new Date(anioVenc, mesVenc + 1, 0).getDate();

					if (diaAnalisis && diaAnalisis !== 15 && diaAnalisis !== 30) {
						// El analista eligió uno de los 3 días recomendados por la IA en el
						// 50%: ese es el default aquí, en vez del algoritmo por fecha de hoy.
						diaPagoDefault = `día ${numberToText(diaAnalisis)}`;
						diaVenc = Math.min(diaAnalisis, diasEnMesVenc);
						setAnalysisSuggestedDay({
							dia: diaAnalisis,
							label: diaPagoDefault,
						});
					} else if (diaActual <= 20) {
						// Del 1 al 20: día de pago es 15, vencimiento día 15 del mes siguiente
						diaPagoDefault = "día quince";
						diaVenc = 15;
					} else {
						// Del 21 al 31: día de pago es último día, vencimiento último día del mes siguiente
						diaPagoDefault = "último día";
						diaVenc = diasEnMesVenc;
					}

					const fechaStr = `${anioVenc}-${String(mesVenc + 1).padStart(2, "0")}-${String(diaVenc).padStart(2, "0")}`;
					setDiaPago(diaPagoDefault);
					setFechaVencimiento(fechaStr);
					updateDateFields(fechaStr, diaPagoDefault);
				}
			}
		} catch (error: any) {
			console.error("Error fetching documents data:", error);
			const message = error?.message || "Error al obtener datos de documentos";
			toast.error(message);
		} finally {
			setIsLoadingFields(false);
		}
	};

	// Validate a specific field against its regex
	const validateField = useCallback((field: Field, value: string): string => {
		const strValue = typeof value === "string" ? value : String(value || "");

		// Una lista se guarda como JSON, así que "[]" es texto y pasaría por
		// llena. Lo que importa es si tiene items, y la regex no aplica: no se
		// valida el JSON, se validan sus columnas.
		if (field.type === "list") {
			if (field.required && itemsDeLista(strValue).length === 0) {
				return "Agregá al menos un item";
			}
			return "";
		}

		// Validate required field
		if (field.required && !strValue.trim()) {
			return "Este campo es obligatorio";
		}

		// Validate regex if there's a value and regex is defined
		if (strValue.trim() && field.regex) {
			try {
				const regex = new RegExp(field.regex);
				if (!regex.test(strValue)) {
					return "El formato del campo no es válido";
				}
			} catch {
				console.warn(`Regex inválida para el campo ${field.key}:`, field.regex);
			}
		}

		return "";
	}, []);

	// Filter input in real-time based on regex pattern
	const validateInputOnType = useCallback(
		(regex: string, value: string): string => {
			if (!regex || !value) return value;

			try {
				// Remove anchors ^ and $ for real-time validation
				const cleanPattern = regex.replace(/^\^|\$$/g, "");

				// Extract quantifier info and character type
				const quantifierMatch = cleanPattern.match(
					/^(.+?)\{(\d+)(?:,(\d+))?\}$/,
				);

				if (quantifierMatch) {
					const [, charPattern, min, max] = quantifierMatch;
					const maxLength = Number.parseInt(max || min);

					// Build allowed characters set
					let allowedChars = "";

					if (charPattern.includes("\\d")) allowedChars += "0-9";
					if (charPattern.includes("\\w")) allowedChars += "a-zA-Z0-9_";
					if (charPattern.includes("\\s")) allowedChars += " \\t\\n\\r";

					// Handle character sets [...]
					const charSetMatch = charPattern.match(/\[([^\]]+)\]/);
					if (charSetMatch) {
						allowedChars += charSetMatch[1];
					}

					// Literal characters
					if (charPattern.includes("\\.")) allowedChars += ".";
					if (charPattern.includes("-") && !charPattern.includes("["))
						allowedChars += "-";
					if (charPattern.includes(",")) allowedChars += ",";

					if (allowedChars) {
						// Filter disallowed characters
						const inverseRegex = new RegExp(`[^${allowedChars}]`, "g");
						const filtered = value.replace(inverseRegex, "");

						// Limit to max length
						return filtered.slice(0, maxLength);
					}
				}

				// Fallback: extract allowed characters without strict limit
				const charSetMatch = cleanPattern.match(/\[([^\]]+)\]/g);

				if (charSetMatch) {
					let allowedChars = "";
					for (const set of charSetMatch) {
						allowedChars += set.slice(1, -1);
					}

					if (cleanPattern.includes("\\d")) allowedChars += "0-9";
					if (cleanPattern.includes("\\s")) allowedChars += " \\s";
					if (cleanPattern.includes("(") && cleanPattern.includes(")"))
						allowedChars += "()";
					if (cleanPattern.includes("\\.")) allowedChars += ".";
					if (cleanPattern.includes(",")) allowedChars += ",";

					const inverseRegex = new RegExp(`[^${allowedChars}]`, "g");
					return value.replace(inverseRegex, "");
				}

				return value;
			} catch (error) {
				console.warn("Error procesando regex:", error);
				return value;
			}
		},
		[],
	);

	// Handle field change (for manual adjustments)
	const handleFieldChange = (fieldKey: string, value: string) => {
		// Find field to get its regex
		const field = relevantFields.find((f) => f.key === fieldKey);

		// Apply real-time validation if field has regex
		const processedValue = field?.regex
			? validateInputOnType(field.regex, value)
			: value;

		// Para que un re-prefill no borre esta corrección
		touchedFieldsRef.current.add(fieldKey);

		setFieldValues((prev) => ({ ...prev, [fieldKey]: processedValue }));

		// Validate and update errors
		if (field) {
			const error = validateField(field, processedValue);
			setFieldErrors((prev) => ({
				...prev,
				[fieldKey]: error,
			}));
		}
	};

	// Check if field has value
	const fieldHasValue = useCallback(
		(fieldKey: string): boolean => {
			const valor = fieldValues[fieldKey]?.trim();
			if (!valor) return false;

			// Una lista vacía se guarda como "[]", que es texto: contarla como
			// llena dejaba seguir sin haber cargado ningún item.
			const field = fields.find((f) => f.key === fieldKey);
			if (field?.type === "list") return itemsDeLista(valor).length > 0;

			return true;
		},
		[fieldValues, fields],
	);

	// Count filled vs required fields
	// Campos tecnicos que quedaron con guion: se avisan para que juridico los corrija
	// Aviso corto bajo un campo cuando el valor autollenado necesita una
	// aclaración: dato que el CRM no tiene, o vendedor sin asignar.
	const avisoDelCampo = (field: Field): string | null => {
		const key = field.key?.toLowerCase();

		if (
			OPTIONAL_VEHICLE_FIELDS.includes(key) &&
			fieldValues[field.key] === MISSING_FIELD_PLACEHOLDER
		) {
			return "El CRM no tiene este dato del vehículo.";
		}

		if (VENDOR_FIELDS.includes(key) && !crmData.vendedor) {
			return "La oportunidad no tiene vendedor asignado.";
		}

		if (
			(key === "cuenta2" || key === "valor2") &&
			(crmData.desembolso?.sobrantes ?? 0) > 0
		) {
			return `Hay ${crmData.desembolso?.sobrantes} cheque(s) más que no caben en la carta.`;
		}

		return null;
	};

	const fieldStats = useMemo(() => {
		const required = relevantFields.filter((f) => f.required);
		const filledRequired = required.filter((f) => fieldHasValue(f.key));
		const allFilled = relevantFields.filter((f) => fieldHasValue(f.key));

		return {
			total: relevantFields.length,
			required: required.length,
			filledRequired: filledRequired.length,
			allFilled: allFilled.length,
		};
	}, [relevantFields, fieldHasValue]);

	// Toggle document selection
	const handleDocumentToggle = (docEnum: string) => {
		setSelectedDocuments((prev) =>
			prev.includes(docEnum)
				? prev.filter((d) => d !== docEnum)
				: [...prev, docEnum],
		);
	};

	// Select/deselect all documents
	const handleSelectAll = () => {
		if (selectedDocuments.length === documentTypes.length) {
			setSelectedDocuments([]);
		} else {
			setSelectedDocuments(documentTypes.map((doc) => doc.enum));
		}
	};

	const allSelected =
		documentTypes.length > 0 &&
		selectedDocuments.length === documentTypes.length;

	const canProceedStep1 = selectedDocuments.length > 0;
	const vendorDeclarationSelected = selectedDocuments.includes(
		"declaracion_vendedor",
	);
	const vendorGenderSelected =
		fieldValues.genderVendedor === "male" ||
		fieldValues.genderVendedor === "female";
	const unsupportedDisbursementCount = selectedDocuments.includes(
		"carta_emision_cheques",
	)
		? (crmData.desembolso?.omitidosPorMoneda ?? 0)
		: 0;
	const canProceedStep2 =
		(fieldStats.required === 0 ||
			fieldStats.filledRequired === fieldStats.required) &&
		(!vendorDeclarationSelected || vendorGenderSelected) &&
		unsupportedDisbursementCount === 0;

	const handleNext = async () => {
		if (step === 0) {
			setStep(1);
		} else if (step === 1 && canProceedStep1) {
			await fetchDocumentsData();
			setStep(2);
		} else if (step === 2) {
			if (unsupportedDisbursementCount > 0) {
				toast.error(
					`No se puede generar la carta: ${unsupportedDisbursementCount} cheque(s) no están en GTQ. Corrige la moneda en el detalle de crédito.`,
				);
				return;
			}
			if (!canProceedStep2) return;

			try {
				if (vendorDeclarationSelected && !vendorGenderSelected) {
					setFieldErrors((prev) => ({
						...prev,
						genderVendedor: "Selecciona el género del vendedor",
					}));
					toast.error("Selecciona el género del vendedor antes de generar");
					return;
				}

				// Build contracts payload
				const clientEmail = crmData.cliente.correo;
				const hasCoDebtors = coDebtorFields.length > 0;

				// Cada deudor que sale en el documento tiene su línea de firma y
				// necesita su propio correo para recibir su enlace. Si falta uno, el
				// reparto por rol no calza con el PDF y fallan TODOS los contratos
				// electrónicos; y si dos comparten correo, WeeTrust los junta en uno
				// solo y la misma persona firmaría por los dos.
				const hayElectronicos = selectedDocuments.some(
					(doc) => !esFirmaFisica(doc),
				);
				if (hayElectronicos) {
					const sinCorreo = [
						...(clientEmail
							? []
							: [crmData.cliente.nombreCompleto || "El cliente"]),
						...coDebtorFields
							.filter((cd) => !cd.correoElectronico?.trim())
							.map((cd) => cd.nombreCompleto || "Un codeudor"),
					];
					if (sinCorreo.length > 0) {
						toast.error(
							`Falta el correo de: ${sinCorreo.join(", ")}. Cada firmante necesita el suyo para recibir su enlace.`,
						);
						return;
					}
					const correos = [
						clientEmail,
						...coDebtorFields.map((cd) => cd.correoElectronico),
					].map((c) => (c ?? "").trim().toLowerCase());
					if (new Set(correos).size !== correos.length) {
						toast.error(
							"El cliente y los codeudores no pueden compartir correo: cada uno firma con el suyo.",
						);
						return;
					}
				}

				// Build deudoresAdicionales array from editable co-debtor fields
				const deudoresAdicionales = coDebtorFields.map((cd) => ({
					nombreCompleto: cd.nombreCompleto,
					dpi: cd.dpi,
					dpiTexto: cd.dpiTexto,
					edadTexto: cd.edadTexto,
					estadoCivil: cd.estadoCivil,
					profesion: cd.profesion,
					nacionalidad: cd.nacionalidad,
				}));

				// Firmantes con su rol. El rol es lo que decide en qué línea de firma
				// del documento cae cada persona: mandarlos como una lista plana los
				// repartía por índice y con cofirmante el link salía cruzado. Al
				// representante legal lo agrega el servidor, que es donde vive su correo.
				const signers: ContractSigner[] = [];
				if (clientEmail) {
					// Nombre y DPI de lo que quedó en el formulario, que es lo que se
					// imprime: si jurídico corrigió el DPI, el viejo no calzaría con el
					// que aparece bajo la línea de firma y el contrato no se generaría.
					signers.push({
						role: "TITULAR",
						email: clientEmail,
						name:
							fieldValues.nombreCompleto?.trim() ||
							crmData.cliente.nombreCompleto ||
							clientEmail,
						dpi: fieldValues.dpi?.trim() || crmData.cliente.dpi,
					});
				}
				coDebtorFields.forEach((cd) => {
					if (cd.correoElectronico) {
						signers.push({
							role: "COFIRMANTE",
							email: cd.correoElectronico,
							name: cd.nombreCompleto || cd.correoElectronico,
							dpi: cd.dpi,
						});
					}
				});

				// Determine combined gender: if any male (lead or co-debtor), use "male"
				// Only use "female" if ALL are female
				const leadIsMale = crmData.cliente.genero !== "F";
				const anyCoDebtorIsMale = crmData.coDebtors?.some(
					(cd) => cd.gender === "male" || !cd.gender,
				);
				const combinedGenderIsMale = leadIsMale || anyCoDebtorIsMale;

				const contracts = documents
					.filter((doc) => selectedDocuments.includes(doc.nombre_documento))
					.map((doc) => {
						const isVendorDeclaration =
							doc.nombre_documento === "declaracion_vendedor";

						// Para declaracion_vendedor usar el género del vendedor y nunca plural
						let gender: "male" | "female";
						let isPlural = false;

						if (isVendorDeclaration) {
							gender = fieldValues.genderVendedor as "male" | "female";
							// Vendor declaration is always singular
							isPlural = false;
						} else {
							// For other contracts, use combined gender and plural if there are co-debtors
							gender = combinedGenderIsMale ? "male" : "female";
							isPlural = hasCoDebtors;
						}

						// Build contract data with deudoresAdicionales
						const contractData: Record<string, unknown> =
							valoresParaElGenerador(fields, fieldValues);
						if (hasCoDebtors && !isVendorDeclaration) {
							contractData.deudoresAdicionales = deudoresAdicionales;
						}

						return {
							contractType: doc.nombre_documento,
							data: contractData as Record<string, string>,
							// Los contratos que se firman en papel no llevan firmantes: el
							// entregable es el PDF para imprimir, no un link.
							signers:
								signers.length > 0 && !esFirmaFisica(doc.nombre_documento)
									? signers
									: undefined,
							options: {
								gender,
								generatePdf: true,
								isPlural,
								// Sólo el nombre de la persona. El generador le pega el tipo
								// y el timestamp para el archivo en R2; mandárselo acá
								// también producía nombres con el tipo repetido
								// ("..._pagare_unico_libre_protesto_pagare_unico_libre_protesto_...").
								// Cómo se ve en WeeTrust lo arma el generador con la
								// descripción de su propio registro de plantillas.
								filenamePrefix: crmData.cliente.nombreCompleto || "contrato",
							},
						};
					});

				// Store generation data for snapshot (using ref for immediate availability)
				generationDataRef.current = contracts;

				const result = await onGenerate({ contracts });
				anotarGenerados(result.results);
				setGenerationResult(result);
				setStep(3);
			} catch (error) {
				console.error("Error generating contracts:", error);
			}
		}
	};

	/**
	 * Reintenta un solo documento y reemplaza su tarjeta en los resultados.
	 *
	 * Se manda únicamente el contrato que falló: los que ya salieron bien conservan
	 * su PDF y sus links, así que no hay que esperar a que se regenere todo el lote.
	 */
	const handleRetryContract = async (contractType: string) => {
		// Las cartas salieron unidas: reintentarlas es mandar todas otra vez, que
		// el servidor vuelve a juntar en un solo documento.
		const contratos =
			contractType === PAQUETE_CARTAS
				? generationDataRef.current.filter((c) =>
						esCartaUnificable(c.contractType),
					)
				: generationDataRef.current.filter(
						(c) => c.contractType === contractType,
					);
		if (contratos.length === 0 || retryingType) return;

		setRetryingType(contractType);
		try {
			const retryResult = await onGenerate({ contracts: contratos });
			const nuevo = retryResult.results[0];
			if (!nuevo) return;
			anotarGenerados(retryResult.results);

			setGenerationResult((prev) => {
				if (!prev) return prev;
				const results = prev.results.map((r) =>
					r.contractType === contractType ? nuevo : r,
				);
				const successCount = results.filter((r) => r.success).length;
				return {
					...prev,
					results,
					successCount,
					failCount: results.length - successCount,
					success: successCount === results.length,
				};
			});

			if (nuevo.success) {
				toast.success(`${nuevo.contractName} se generó correctamente`);
			} else {
				toast.error(
					nuevo.error ||
						`${nuevo.contractName} volvió a fallar. Intenta de nuevo.`,
				);
			}
		} catch (error) {
			console.error("Error retrying contract:", error);
			toast.error("No se pudo reintentar el documento");
		} finally {
			setRetryingType(null);
		}
	};

	// Descartar lo emitido tarda (habla con WeeTrust): mientras tanto no se
	// puede volver a apretar ni darle Listo.
	const [corrigiendo, setCorrigiendo] = useState(false);
	const handleCorregir = async () => {
		if (!onCorregir) return;
		setCorrigiendo(true);
		try {
			await onCorregir();
			setGenerationResult(null);
			setStep(2);
		} catch {
			// Quien lo pasa ya avisó el error; se queda en los resultados.
		} finally {
			setCorrigiendo(false);
		}
	};

	const handlePrevious = () => {
		if (step === 1 && pasoPrevio) {
			setStep(0);
		} else if (step === 2) {
			setStep(1);
		} else if (step === 3) {
			// Volver al paso 2 para corregir campos y regenerar. Lo que se generó
			// no se va a enlazar: se borra en WeeTrust, o el cliente tendría
			// invitaciones de documentos que nadie sigue.
			descartarSinEnlazar();
			setGenerationResult(null);
			setStep(2);
		}
	};

	// Handle linking contracts to opportunity
	const handleLinkContracts = async () => {
		if (!generationResult || !leadId || retryingType) return;
		// En inversiones no hay oportunidad ni paso de enlazado: los contratos se
		// guardaron al generarlos.
		if (!onLinkContracts || !opportunityId) return;

		const successfulContracts = generationResult.results.filter(
			(r) => r.success,
		);
		if (successfulContracts.length === 0) return;

		// Extract contract date from fieldValues
		let contractDate: Date = new Date(); // Default to current date
		const dia = fieldValues.diaContrato || fieldValues.dia;
		const mes = fieldValues.mesContrato || fieldValues.mesTexto;
		const anio = fieldValues.anioContrato || fieldValues.ano;

		console.log("[DynamicContractWizard] Date extraction:", {
			dia,
			mes,
			anio,
			fieldValues,
		});
		console.log(
			"[DynamicContractWizard] generationDataRef:",
			generationDataRef.current,
		);

		if (dia && mes && anio) {
			const monthIndex = monthsSpanish.indexOf(mes.toLowerCase());
			if (monthIndex !== -1) {
				// El año viene con 2 dígitos ("26"). `new Date(26, ...)` lo mapea a
				// 1926, así que hay que llevarlo a 4 dígitos antes de construir la fecha.
				const anioNum = Number.parseInt(anio, 10);
				const anioCompleto = anioNum < 100 ? 2000 + anioNum : anioNum;
				contractDate = new Date(
					anioCompleto,
					monthIndex,
					Number.parseInt(dia, 10),
				);
			}
		}

		// Mientras se enlaza, lo generado ya no es un descarte: si se van de la
		// pantalla a mitad del pedido, la limpieza al desmontar no puede borrar en
		// WeeTrust los documentos que el servidor está guardando. Si el enlace
		// falla, vuelven a la lista.
		const enVuelo = new Map(sinEnlazarRef.current);
		sinEnlazarRef.current.clear();

		try {
			await onLinkContracts({
				opportunityId,
				leadId,
				contracts: successfulContracts.map((c) => ({
					contractType: c.contractType,
					contractName: c.contractName,
					documentLink: c.r2Key ?? c.documentLink,
					signingLinks: c.signingLinks,
					templateId: c.templateId,
					apiResponse: c.apiResponse,
				})),
				contractDate,
				generationData:
					generationDataRef.current.length > 0
						? generationDataRef.current
						: undefined,
			});
			// Ya tienen fila: no son descartes. (Los que el servidor descartó al
			// enlazar, por cambio de etapa, ya los borró él.)
			setShowLinkConfirmDialog(false);
			onBack(); // Volver a la pantalla anterior después de enlazar
		} catch (error) {
			console.error("Error linking contracts:", error);
			for (const [documentID, descarte] of enVuelo) {
				sinEnlazarRef.current.set(documentID, descarte);
			}
			// Ya se fueron: nadie más los va a descartar. El servidor no borra los
			// que alcanzaron a quedar con fila.
			if (!montadoRef.current) descartarSinEnlazar();
		}
	};

	// Se numeran por posición y no con el número interno del paso: con un paso
	// previo, "Seleccionar" es el 2 para quien lo mira aunque adentro siga
	// siendo el 1.
	const steps = [
		...(pasoPrevio ? [{ number: 0, label: pasoPrevio.etiqueta }] : []),
		{ number: 1, label: "Seleccionar" },
		{ number: 2, label: "Confirmar" },
		{ number: 3, label: "Resultados" },
	];

	return (
		<div className="space-y-6">
			{/* Progress Indicator */}
			<div className="flex items-center justify-center">
				{steps.map((s, index) => (
					<div key={s.number} className="flex items-center">
						<div className="flex flex-col items-center">
							<div
								className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors ${
									step >= s.number
										? "border-primary bg-primary text-white"
										: "border-muted-foreground/30 text-muted-foreground"
								}`}
							>
								{step > s.number ? (
									<Check className="h-5 w-5" />
								) : (
									<span className="font-medium">{index + 1}</span>
								)}
							</div>
							<span
								className={`mt-1 text-xs ${
									step >= s.number
										? "font-medium text-primary"
										: "text-muted-foreground"
								}`}
							>
								{s.label}
							</span>
						</div>
						{index < steps.length - 1 && (
							<div
								className={`mx-4 h-0.5 w-20 ${
									step > s.number ? "bg-primary" : "bg-muted-foreground/30"
								}`}
							/>
						)}
					</div>
				))}
			</div>

			{/* Step Content */}
			<div className="min-h-[400px]">
				{/* Paso previo del área (en inversiones, la categoría) */}
				{step === 0 && pasoPrevio && (
					<Card>
						<CardHeader>
							<CardTitle>{pasoPrevio.etiqueta}</CardTitle>
						</CardHeader>
						<CardContent>{pasoPrevio.contenido}</CardContent>
					</Card>
				)}

				{/* Step 1: Document Selection */}
				{step === 1 && (
					<Card>
						<CardHeader>
							<div className="flex items-center justify-between">
								<CardTitle>Seleccione los documentos a generar</CardTitle>
								{documentTypes.length > 0 && (
									<Button variant="outline" size="sm" onClick={handleSelectAll}>
										{allSelected ? "Deseleccionar todos" : "Seleccionar todos"}
									</Button>
								)}
							</div>
						</CardHeader>
						<CardContent>
							<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
								{documentTypes.map((docType) => (
									<div
										key={docType.enum}
										className={`flex cursor-pointer items-center space-x-3 rounded-lg border p-4 transition-colors ${
											selectedDocuments.includes(docType.enum)
												? "border-primary bg-primary/5"
												: "border-border hover:border-primary/50"
										}`}
										role="button"
										tabIndex={0}
										onClick={() => handleDocumentToggle(docType.enum)}
										onKeyDown={(e) => {
											if (e.key === "Enter" || e.key === " ") {
												e.preventDefault();
												handleDocumentToggle(docType.enum);
											}
										}}
									>
										<Checkbox
											id={docType.enum}
											checked={selectedDocuments.includes(docType.enum)}
											onCheckedChange={() => handleDocumentToggle(docType.enum)}
										/>
										<Label
											htmlFor={docType.enum}
											className="flex-1 cursor-pointer font-medium text-sm"
										>
											{docType.label}
										</Label>
									</div>
								))}
							</div>
							{documentTypes.length === 0 && (
								<p className="text-center text-muted-foreground">
									No hay tipos de documento disponibles
								</p>
							)}
							{/* Las cartas no salen cada una por su lado: el servidor las junta
							    en un documento, y es bueno saberlo antes de generar. */}
							{selectedDocuments.some(esCartaUnificable) && (
								<p className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-blue-900 text-sm dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300">
									Las cartas salen en un solo documento, con un enlace por
									firmante. Si la oportunidad ya tiene cartas unidas, éstas las
									reemplazan enteras: tienen que venir todas las que ya estaban.
								</p>
							)}
						</CardContent>
					</Card>
				)}

				{/* Step 2: Confirm Data */}
				{step === 2 && (
					<div className="space-y-6">
						{isLoadingFields ? (
							<div className="flex items-center justify-center py-12">
								<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
								<span className="ml-2 text-muted-foreground">
									Cargando datos...
								</span>
							</div>
						) : (
							<>
								{unsupportedDisbursementCount > 0 && (
									<Card className="border-red-300 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/30">
										<CardHeader>
											<CardTitle className="flex items-center gap-2 text-red-900 dark:text-red-200">
												<TriangleAlert className="h-5 w-5 shrink-0" />
												Moneda no soportada en desembolsos
											</CardTitle>
										</CardHeader>
										<CardContent>
											<p className="text-red-800 text-sm dark:text-red-200">
												Se encontraron {unsupportedDisbursementCount} cheque(s)
												en una moneda distinta de GTQ. Esos cheques no pueden
												incluirse correctamente en la carta.
											</p>
											<p className="mt-2 text-red-800 text-sm dark:text-red-200">
												Corrige la moneda en el detalle de crédito antes de
												generar el contrato.
											</p>
										</CardContent>
									</Card>
								)}

								{/* RENAP Info */}
								{renapData && (
									<Card>
										<CardHeader>
											<CardTitle className="flex items-center gap-2">
												<User className="h-5 w-5" />
												Información del Firmante (RENAP)
											</CardTitle>
										</CardHeader>
										<CardContent>
											<div className="flex items-center space-x-4">
												{renapData.picture && (
													<img
														src={renapData.picture}
														alt="Foto DPI"
														className="h-16 w-16 rounded-lg border-2 border-muted object-cover"
														onError={(e) => {
															e.currentTarget.style.display = "none";
														}}
													/>
												)}
												<div>
													<h3 className="font-semibold">
														{renapData.firstName} {renapData.secondName}{" "}
														{renapData.firstLastName} {renapData.secondLastName}
													</h3>
													<p className="text-muted-foreground">
														DPI: {renapData.dpi}
													</p>
													<p className="text-muted-foreground text-sm">
														{renapData.birthDate} •{" "}
														{renapData.gender === "F"
															? "Femenino"
															: "Masculino"}
													</p>
												</div>
											</div>
										</CardContent>
									</Card>
								)}

								{/* RENAP no tiene el DPI: se muestran los datos del CRM */}
								{!renapData && renapUnavailable && (
									<Card className="border-amber-300 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/30">
										<CardHeader>
											<CardTitle className="flex flex-wrap items-center gap-2 text-amber-900 dark:text-amber-200">
												<TriangleAlert className="h-5 w-5 shrink-0" />
												Información del Firmante (datos del CRM)
												<Badge
													variant="outline"
													className="border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-900/50 dark:text-amber-100"
												>
													Revisar
												</Badge>
											</CardTitle>
										</CardHeader>
										<CardContent>
											<div className="flex items-start space-x-4">
												<div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border-2 border-amber-400 border-dashed bg-amber-100/60 dark:border-amber-800 dark:bg-amber-900/30">
													<UserX className="h-7 w-7 text-amber-600 dark:text-amber-400" />
												</div>
												<div className="space-y-1">
													<h3 className="font-semibold">
														{crmData.cliente.nombreCompleto?.toUpperCase() ||
															"Sin nombre en el CRM"}
													</h3>
													<p className="text-muted-foreground">
														DPI: {crmData.cliente.dpi || "—"}
													</p>
													<p className="text-amber-800 text-sm dark:text-amber-200">
														<strong>
															No se encontró este DPI en RENAP, así que no hay
															foto ni datos oficiales que mostrar.
														</strong>{" "}
														Los campos se llenaron con la información de la
														oportunidad: revíselos antes de generar los
														contratos.
													</p>
												</div>
											</div>
										</CardContent>
									</Card>
								)}

								{/* Date Configuration Section */}
								{needsDateConfig && (
									<Card>
										<CardHeader>
											<CardTitle className="flex items-center gap-2">
												<svg
													xmlns="http://www.w3.org/2000/svg"
													className="h-5 w-5"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2"
												>
													<rect
														x="3"
														y="4"
														width="18"
														height="18"
														rx="2"
														ry="2"
													/>
													<line x1="16" y1="2" x2="16" y2="6" />
													<line x1="8" y1="2" x2="8" y2="6" />
													<line x1="3" y1="10" x2="21" y2="10" />
												</svg>
												Configuración de Fechas
											</CardTitle>
										</CardHeader>
										<CardContent>
											<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
												<div className="space-y-2">
													<Label htmlFor="diaPago">Día de Pago Mensual</Label>
													<select
														id="diaPago"
														value={diaPago}
														onChange={(e) =>
															handleDiaPagoChange(e.target.value)
														}
														className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
													>
														<option value="día quince">Día quince</option>
														<option value="último día">
															Último día del mes
														</option>
														{analysisSuggestedDay && (
															<option value={analysisSuggestedDay.label}>
																Día {analysisSuggestedDay.dia} (elegido en
																Análisis)
															</option>
														)}
													</select>
													<p className="text-muted-foreground text-xs">
														Se usará: "{fieldValues.diaPago || "día quince"}"
													</p>
												</div>
												<div className="space-y-2">
													<Label htmlFor="fechaVencimiento">
														Fecha de Vencimiento del Crédito
													</Label>
													<Input
														id="fechaVencimiento"
														type="date"
														value={fechaVencimiento}
														onChange={(e) =>
															handleFechaVencimientoChange(e.target.value)
														}
													/>
													{fechaVencimiento && (
														<p className="text-muted-foreground text-xs">
															Se usará: "{fieldValues.diaTextoVencimiento} de{" "}
															{fieldValues.mesTextoVencimiento} del dos mil{" "}
															{fieldValues.anoTextoVencimiento}"
														</p>
													)}
												</div>
											</div>
											{dateFields.length > 0 && (
												<div className="mt-4 rounded-lg border bg-muted/30 p-3">
													<p className="mb-2 font-medium text-sm">
														Campos que se llenarán automáticamente:
													</p>
													<div className="flex flex-wrap gap-2">
														{dateFields.map((field) => (
															<span
																key={field.key}
																className="rounded-full bg-primary/10 px-2 py-1 text-primary text-xs"
															>
																{field.name}
															</span>
														))}
													</div>
												</div>
											)}
										</CardContent>
									</Card>
								)}

								{/* Fields Summary - Collapsed by default, expandable */}
								{relevantFields.length > 0 && (
									<Card>
										<CardHeader>
											<CardTitle className="flex items-center justify-between">
												<span>Datos a Enviar</span>
												<span className="font-normal text-muted-foreground text-sm">
													{fieldStats.allFilled} / {fieldStats.total} campos
													completados
												</span>
											</CardTitle>
										</CardHeader>
										<CardContent>
											<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
												{relevantFields.map((field) => {
													const hasValue = fieldHasValue(field.key);
													const hasError = !!fieldErrors[field.key];
													return (
														<div
															key={field.key}
															// Las listas ocupan el ancho completo: cada item
															// trae varias columnas adentro y en media fila
															// quedan apretadas.
															className={`flex flex-col ${
																field.type === "list" ? "md:col-span-2" : ""
															}`}
														>
															{/* Label */}
															<div className="mb-1.5 flex items-center gap-2">
																{hasError ? (
																	<AlertCircle className="h-4 w-4 text-red-500" />
																) : hasValue ? (
																	<CheckCircle className="h-4 w-4 text-green-600" />
																) : (
																	<AlertCircle className="h-4 w-4 text-amber-600" />
																)}
																<span className="font-medium text-sm">
																	{field.name}
																	{field.required && (
																		<span className="text-red-500"> *</span>
																	)}
																</span>
															</div>

															{/* Description - visible hint */}
															<div className="min-h-[20px]">
																{field.description && (
																	<p className="text-muted-foreground text-xs leading-tight">
																		{field.description}
																	</p>
																)}
															</div>

															{/* Input, selector o lista, según lo que sea */}
															{field.type === "list" ? (
																<CampoDeLista
																	field={field}
																	valor={fieldValues[field.key] || ""}
																	onChange={handleFieldChange}
																/>
															) : field.type === "select" &&
																Array.isArray(field.options) ? (
																<select
																	value={fieldValues[field.key] || ""}
																	onChange={(e) =>
																		handleFieldChange(field.key, e.target.value)
																	}
																	className={`flex h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${hasError ? "border-red-500" : ""}`}
																>
																	<option value="" disabled>
																		Selecciona {field.name.toLowerCase()}
																	</option>
																	{field.options.map((opcion) => (
																		<option
																			key={opcion.value}
																			value={opcion.value}
																		>
																			{opcion.label}
																		</option>
																	))}
																</select>
															) : field.key?.toLowerCase() ===
																"gendervendedor" ? (
																<select
																	value={fieldValues[field.key] || ""}
																	onChange={(e) =>
																		handleFieldChange(field.key, e.target.value)
																	}
																	className={`flex h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${hasError ? "border-red-500" : ""}`}
																>
																	<option value="" disabled>
																		Selecciona el género
																	</option>
																	<option value="male">Masculino</option>
																	<option value="female">Femenino</option>
																</select>
															) : (
																<Input
																	value={fieldValues[field.key] || ""}
																	onChange={(e) =>
																		handleFieldChange(field.key, e.target.value)
																	}
																	placeholder={`Ingresa ${field.name.toLowerCase()}`}
																	className={`h-9 bg-white text-sm ${hasError ? "border-red-500" : ""}`}
																/>
															)}

															{/* Error message */}
															<div className="mt-1 min-h-[20px] space-y-1">
																{fieldErrors[field.key] && (
																	<p className="flex items-center gap-1 text-red-600 text-sm">
																		<AlertCircle className="h-3 w-3" />
																		{fieldErrors[field.key]}
																	</p>
																)}
																{!fieldErrors[field.key] &&
																	avisoDelCampo(field) && (
																		<p className="flex items-center gap-1 text-amber-600 text-xs dark:text-amber-500">
																			<AlertCircle className="h-3 w-3 shrink-0" />
																			{avisoDelCampo(field)}
																		</p>
																	)}
															</div>
														</div>
													);
												})}
											</div>

											{fieldStats.filledRequired < fieldStats.required && (
												<div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
													<p className="font-medium text-amber-800 text-sm">
														Faltan{" "}
														{fieldStats.required - fieldStats.filledRequired}{" "}
														campos requeridos por completar
													</p>
												</div>
											)}
										</CardContent>
									</Card>
								)}

								{/* Co-Debtors Section */}
								{coDebtorFields.length > 0 && (
									<Card className="border-purple-200 bg-purple-50/30">
										<CardHeader>
											<CardTitle className="flex items-center gap-2">
												<Users className="h-5 w-5 text-purple-600" />
												Deudores Adicionales ({coDebtorFields.length})
											</CardTitle>
											<p className="text-muted-foreground text-sm">
												Estos datos se incluirán en los contratos como
												co-deudores
											</p>
										</CardHeader>
										<CardContent className="space-y-6">
											{coDebtorFields.map((coDebtor, index) => (
												<div
													key={coDebtor.id}
													className="rounded-lg border bg-white p-4"
												>
													<h4 className="mb-4 font-semibold text-purple-700">
														Co-deudor {index + 1}:{" "}
														{coDebtor.nombreCompleto || "Sin nombre"}
													</h4>
													<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
														<div className="space-y-2">
															<Label htmlFor={`cd-dpi-${coDebtor.id}`}>
																DPI
															</Label>
															<Input
																id={`cd-dpi-${coDebtor.id}`}
																value={coDebtor.dpi}
																onChange={(e) => {
																	const newDpi = e.target.value;
																	setCoDebtorFields((prev) =>
																		prev.map((cd) =>
																			cd.id === coDebtor.id
																				? {
																						...cd,
																						dpi: newDpi,
																						dpiTexto: dpiToWords(newDpi),
																					}
																				: cd,
																		),
																	);
																}}
																className="bg-white"
															/>
														</div>
														<div className="space-y-2">
															<Label htmlFor={`cd-dpiTexto-${coDebtor.id}`}>
																DPI en Texto
															</Label>
															<Input
																id={`cd-dpiTexto-${coDebtor.id}`}
																value={coDebtor.dpiTexto}
																onChange={(e) => {
																	setCoDebtorFields((prev) =>
																		prev.map((cd) =>
																			cd.id === coDebtor.id
																				? { ...cd, dpiTexto: e.target.value }
																				: cd,
																		),
																	);
																}}
																className="bg-white"
															/>
														</div>
														<div className="space-y-2">
															<Label htmlFor={`cd-edad-${coDebtor.id}`}>
																Edad en Texto
															</Label>
															<Input
																id={`cd-edad-${coDebtor.id}`}
																value={coDebtor.edadTexto}
																onChange={(e) => {
																	setCoDebtorFields((prev) =>
																		prev.map((cd) =>
																			cd.id === coDebtor.id
																				? { ...cd, edadTexto: e.target.value }
																				: cd,
																		),
																	);
																}}
																placeholder="ej: treinta y cinco"
																className="bg-white"
															/>
														</div>
														<div className="space-y-2">
															<Label htmlFor={`cd-estadoCivil-${coDebtor.id}`}>
																Estado Civil
															</Label>
															<Input
																id={`cd-estadoCivil-${coDebtor.id}`}
																value={coDebtor.estadoCivil}
																onChange={(e) => {
																	setCoDebtorFields((prev) =>
																		prev.map((cd) =>
																			cd.id === coDebtor.id
																				? { ...cd, estadoCivil: e.target.value }
																				: cd,
																		),
																	);
																}}
																placeholder="ej: soltero, casado"
																className="bg-white"
															/>
														</div>
														<div className="space-y-2">
															<Label htmlFor={`cd-profesion-${coDebtor.id}`}>
																Profesión
															</Label>
															<Input
																id={`cd-profesion-${coDebtor.id}`}
																value={coDebtor.profesion}
																onChange={(e) => {
																	setCoDebtorFields((prev) =>
																		prev.map((cd) =>
																			cd.id === coDebtor.id
																				? { ...cd, profesion: e.target.value }
																				: cd,
																		),
																	);
																}}
																placeholder="ej: comerciante"
																className="bg-white"
															/>
														</div>
														<div className="space-y-2">
															<Label htmlFor={`cd-nacionalidad-${coDebtor.id}`}>
																Nacionalidad
															</Label>
															<Input
																id={`cd-nacionalidad-${coDebtor.id}`}
																value={coDebtor.nacionalidad}
																onChange={(e) => {
																	setCoDebtorFields((prev) =>
																		prev.map((cd) =>
																			cd.id === coDebtor.id
																				? {
																						...cd,
																						nacionalidad: e.target.value,
																					}
																				: cd,
																		),
																	);
																}}
																placeholder="ej: guatemalteco"
																className="bg-white"
															/>
														</div>
														<div className="space-y-2 md:col-span-2">
															<Label htmlFor={`cd-correo-${coDebtor.id}`}>
																Correo Electrónico
															</Label>
															<Input
																id={`cd-correo-${coDebtor.id}`}
																type="email"
																value={coDebtor.correoElectronico}
																onChange={(e) => {
																	setCoDebtorFields((prev) =>
																		prev.map((cd) =>
																			cd.id === coDebtor.id
																				? {
																						...cd,
																						correoElectronico: e.target.value,
																					}
																				: cd,
																		),
																	);
																}}
																placeholder="correo@ejemplo.com"
																className="bg-white"
															/>
														</div>
													</div>
												</div>
											))}
										</CardContent>
									</Card>
								)}

								{/* Selected Documents Summary */}
								<Card>
									<CardHeader>
										<CardTitle>
											Documentos a Generar ({selectedDocuments.length})
										</CardTitle>
									</CardHeader>
									<CardContent>
										<div className="space-y-2">
											{documents
												.filter((doc) =>
													selectedDocuments.includes(doc.nombre_documento),
												)
												.map((doc) => {
													// Get the label from documentTypes for a readable name
													const docType = documentTypes.find(
														(dt) => dt.enum === doc.nombre_documento,
													);
													const displayName =
														doc.descripcion ||
														docType?.label ||
														doc.nombre_documento;
													return (
														<div
															key={doc.id}
															className="flex items-center gap-2"
														>
															<div className="h-2 w-2 rounded-full bg-green-500" />
															<span className="text-sm">{displayName}</span>
														</div>
													);
												})}
										</div>
									</CardContent>
								</Card>
							</>
						)}
					</div>
				)}

				{/* Step 3: Results */}
				{step === 3 && generationResult && (
					<div className="space-y-4">
						{/* Sin paso de enlazado, cómo salió todo va arriba, sin bajar hasta
						    el final de los resultados. */}
						{!onLinkContracts && (
							<Card
								className={
									hayFallidos
										? "border-amber-200 bg-amber-50"
										: "border-green-200 bg-green-50"
								}
							>
								<CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
									<div className="flex items-start gap-3">
										<div
											className={`rounded-full p-2 ${hayFallidos ? "bg-amber-100" : "bg-green-100"}`}
										>
											{hayFallidos ? (
												<AlertCircle className="h-5 w-5 text-amber-600" />
											) : (
												<CheckCircle className="h-5 w-5 text-green-600" />
											)}
										</div>
										{hayFallidos ? (
											<div>
												<h4 className="font-semibold text-amber-800">
													Falta {fallidos} contrato(s)
												</h4>
												<p className="text-amber-700 text-sm">
													Reintentá el que salió en rojo o subilo a mano.
												</p>
											</div>
										) : (
											<div>
												<h4 className="font-semibold text-green-800">
													Contratos emitidos
												</h4>
												<p className="text-green-700 text-sm">
													{onFinish
														? "Revisalos abajo, reemplazá o subí el que haga falta, y dale Listo para mandarlos al hilo de la compra."
														: "Ya se mandaron al hilo de la compra: lo que emitas ahora se manda solo."}
												</p>
											</div>
										)}
									</div>
									{onFinish && (
										<Button
											size="lg"
											onClick={onFinish}
											disabled={
												finalizando ||
												isGenerating ||
												Boolean(retryingType) ||
												hayFallidos
											}
											title={
												hayFallidos
													? "Hay contratos que no salieron: reintentalos o subilos a mano"
													: undefined
											}
											className="bg-green-600 hover:bg-green-700"
										>
											{finalizando ? (
												<Loader2 className="mr-2 h-5 w-5 animate-spin" />
											) : (
												<Send className="mr-2 h-5 w-5" />
											)}
											Listo
										</Button>
									)}
								</CardContent>
							</Card>
						)}

						<ContractResults
							results={resultadosAMostrar}
							totalRequested={
								resultadosVigentes
									? resultadosAMostrar.length
									: generationResult.totalRequested
							}
							successCount={
								resultadosVigentes
									? resultadosVigentes.length
									: generationResult.successCount
							}
							failCount={
								resultadosVigentes ? fallidos : generationResult.failCount
							}
							onRetry={handleRetryContract}
							retryingType={retryingType}
							accionPorContrato={accionPorContrato}
						/>

						{accionesDeResultados}

						{/* Instructions for user */}
						<Card className="border-blue-200 bg-blue-50">
							<CardContent className="pt-4">
								<div className="flex items-start gap-3">
									<div className="rounded-full bg-blue-100 p-2">
										<Link2 className="h-5 w-5 text-blue-600" />
									</div>
									<div>
										<h4 className="font-semibold text-blue-800">¿Qué sigue?</h4>
										<ul className="mt-1 list-inside list-disc space-y-1 text-blue-700 text-sm">
											{onLinkContracts ? (
												<>
													<li>
														<strong>Revisa los documentos generados</strong>{" "}
														haciendo clic en el botón morado "Ver PDF"
													</li>
													<li>
														Si algún documento salió en rojo, haz clic en{" "}
														<strong>"Reintentar"</strong> en esa tarjeta: se
														vuelve a generar solo ese, los demás se quedan como
														están
													</li>
													<li>
														Si un documento tiene datos equivocados, haz clic en
														"Corregir y Regenerar" para volver a editarlo
													</li>
													<li>
														Cuando estés satisfecho, haz clic en{" "}
														<strong>"Finalizar y Enlazar"</strong> para guardar
														los contratos en la oportunidad
													</li>
												</>
											) : (
												<>
													<li>
														<strong>Revisá los contratos</strong> de acá arriba:
														lo que ves es exactamente lo que se va a mandar
													</li>
													<li>
														Si alguno salió en rojo,{" "}
														<strong>"Reintentar"</strong> vuelve a generar sólo
														ese
													</li>
													<li>
														Para cambiar uno, <strong>"Reemplazar"</strong> en
														su tarjeta; para agregar uno armado por fuera,{" "}
														<strong>"Subir contrato"</strong>
													</li>
													<li>
														Cuando estén bien, <strong>"Listo"</strong>: se
														mandan al hilo del correo de la compra, con los PDF
														y los enlaces de firma
													</li>
												</>
											)}
										</ul>
									</div>
								</div>
							</CardContent>
						</Card>
					</div>
				)}
			</div>

			{/* Navigation Buttons */}
			<div className="flex justify-between border-t pt-4">
				<Button
					variant="outline"
					onClick={
						step === 3 && !onLinkContracts && onCorregir
							? handleCorregir
							: step === 0 ||
									(step === 1 && !pasoPrevio) ||
									(step === 3 && !onLinkContracts)
								? onBack
								: handlePrevious
					}
					disabled={
						isGenerating ||
						isLoadingFields ||
						isLinking ||
						corrigiendo ||
						finalizando
					}
				>
					{corrigiendo ? (
						<Loader2 className="mr-2 h-4 w-4 animate-spin" />
					) : (
						<ChevronLeft className="mr-2 h-4 w-4" />
					)}
					{step === 0 || (step === 1 && !pasoPrevio)
						? "Volver"
						: step === 3
							? // Sin enlazado, corregir descarta lo emitido: sólo mientras no
								// se mandó. Después los contratos ya salieron en el hilo.
								onLinkContracts || onCorregir
								? "Corregir y Regenerar"
								: "Volver"
							: "Anterior"}
				</Button>

				{step === 3 && !onLinkContracts ? (
					onFinish ? (
						<Button
							size="lg"
							onClick={onFinish}
							disabled={
								finalizando ||
								isGenerating ||
								Boolean(retryingType) ||
								hayFallidos
							}
							title={
								hayFallidos
									? "Hay contratos que no salieron: reintentalos o subilos a mano"
									: undefined
							}
							className="bg-green-600 hover:bg-green-700"
						>
							{finalizando ? (
								<Loader2 className="mr-2 h-5 w-5 animate-spin" />
							) : (
								<Send className="mr-2 h-5 w-5" />
							)}
							Listo
						</Button>
					) : null
				) : step === 3 ? (
					<Button
						onClick={() => setShowLinkConfirmDialog(true)}
						disabled={
							!generationResult?.results.some((r) => r.success) ||
							!leadId ||
							isLinking ||
							// Enlazar con un reintento en vuelo guardaría los resultados viejos
							// y se saldría de la pantalla: el PDF recién generado quedaría suelto.
							Boolean(retryingType) ||
							isGenerating
						}
						className="bg-green-600 hover:bg-green-700"
					>
						{isLinking ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Enlazando...
							</>
						) : (
							<>
								<Link2 className="mr-2 h-4 w-4" />
								Finalizar y Enlazar
							</>
						)}
					</Button>
				) : (
					<Button
						onClick={handleNext}
						disabled={
							(step === 0 && !pasoPrevio?.completo) ||
							(step === 1 && !canProceedStep1) ||
							(step === 2 && !canProceedStep2) ||
							isGenerating ||
							isLoadingFields
						}
					>
						{isGenerating || isLoadingFields ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								{isLoadingFields ? "Cargando..." : "Generando..."}
							</>
						) : (
							<>
								{step === 2 ? "Generar Contratos" : "Continuar"}
								<ChevronRight className="ml-2 h-4 w-4" />
							</>
						)}
					</Button>
				)}
			</div>

			{/* Confirmation Dialog for Linking Contracts */}
			<AlertDialog
				open={showLinkConfirmDialog}
				onOpenChange={setShowLinkConfirmDialog}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							¿Enlazar contratos a la oportunidad?
						</AlertDialogTitle>
						<AlertDialogDescription className="space-y-2">
							<p>
								Estás a punto de enlazar{" "}
								<strong>
									{generationResult?.results.filter((r) => r.success).length ||
										0}{" "}
									contrato(s)
								</strong>{" "}
								a la oportunidad.
							</p>
							{(generationResult?.failCount ?? 0) > 0 && (
								<p className="text-red-600">
									<strong>Ojo:</strong>{" "}
									{generationResult?.results
										.filter((r) => !r.success)
										.map((r) => r.contractName)
										.join(", ")}{" "}
									no se generó y <strong>no se va a enlazar</strong>. Reintenta
									ese documento antes de continuar si lo necesitas.
								</p>
							)}
							<p className="text-amber-600">
								<strong>Nota importante:</strong> Esta acción solo enlaza los
								contratos a la oportunidad. No envía a análisis ni avanza la
								etapa del lead.
							</p>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isLinking}>Cancelar</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleLinkContracts}
							disabled={isLinking || Boolean(retryingType) || isGenerating}
							className="bg-green-600 hover:bg-green-700"
						>
							{isLinking ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Enlazando...
								</>
							) : (
								"Sí, enlazar contratos"
							)}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
