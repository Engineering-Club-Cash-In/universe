import {
	AlertCircle,
	Check,
	CheckCircle,
	ChevronLeft,
	ChevronRight,
	Link2,
	Loader2,
	User,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { type ContractResult, ContractResults } from "./ContractResults";

// Types from API
export interface DocumentType {
	enum: string;
	label: string;
}

export interface RenapData {
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

export interface Document {
	id: number;
	nombre_documento: string;
	descripcion: string;
	genero: string;
	serialid: string;
	url_insercion: string;
	large_spacing: boolean;
	count_doble_line: number;
}

export interface Field {
	name: string;
	key: string;
	regex: string;
	required: boolean;
	iddocuments: number[];
	relation: string;
	description: string | null;
	default: string | null;
	is_double_line: boolean;
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
	};
	credito: {
		capitalAdeudado?: number;
		mesesPrestamo?: number;
		cuotaMensual?: number;
		porcentajeInteres?: number;
		porcentajeMora?: number;
	};
}

interface GenerationResult {
	success: boolean;
	totalRequested: number;
	successCount: number;
	failCount: number;
	results: ContractResult[];
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
	opportunityId: string;
	leadId?: string;
	onGetDocumentsByDpi: (
		dpi: string,
		documentNames: string[],
	) => Promise<{
		success: boolean;
		renapData: RenapData;
		documents: Document[];
		fields: Field[];
	}>;
	onGenerate: (data: {
		contracts: Array<{
			contractType: string;
			data: Record<string, string>;
			emails?: string[];
			options: {
				gender: "male" | "female";
				generatePdf: boolean;
				filenamePrefix: string;
			};
		}>;
	}) => Promise<GenerationResultWithData>;
	onLinkContracts: (data: {
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
			emails?: string[];
			options: {
				gender: "male" | "female";
				generatePdf: boolean;
				filenamePrefix: string;
			};
		}>;
	}) => Promise<{ success: boolean; message: string }>;
	onBack: () => void;
	isGenerating?: boolean;
	isLinking?: boolean;
}

// Fields to hide from form (signatures, etc.)
const HIDDEN_FIELDS = ["firma", "firmacashin", "signature", "sign"];

// Date-derived fields that are auto-calculated from date pickers
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
function moneyToWords(amount: number): string {
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

export function DynamicContractWizard({
	documentTypes,
	crmData,
	opportunityId,
	leadId,
	onGetDocumentsByDpi,
	onGenerate,
	onLinkContracts,
	onBack,
	isGenerating = false,
	isLinking = false,
}: DynamicContractWizardProps) {
	const [step, setStep] = useState<1 | 2 | 3>(1);
	const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
	const [isLoadingFields, setIsLoadingFields] = useState(false);
	const [showLinkConfirmDialog, setShowLinkConfirmDialog] = useState(false);

	// Data from API
	const [renapData, setRenapData] = useState<RenapData | null>(null);
	const [documents, setDocuments] = useState<Document[]>([]);
	const [fields, setFields] = useState<Field[]>([]);
	const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

	const [generationResult, setGenerationResult] =
		useState<GenerationResultWithData | null>(null);

	// Store generation data for snapshot using ref to avoid state timing issues
	const generationDataRef = useRef<
		Array<{
			contractType: string;
			data: Record<string, string>;
			emails?: string[];
			options: {
				gender: "male" | "female";
				generatePdf: boolean;
				filenamePrefix: string;
			};
		}>
	>([]);

	// Date configuration states
	const [fechaVencimiento, setFechaVencimiento] = useState<string>("");
	const [diaPago, setDiaPago] = useState<string>("día quince"); // Default día 15

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

			const { cliente, vehiculo, credito } = crmData;
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
							initialValues[field.key] = cliente.profesion.toLowerCase() || renapInfo?.ocupation.toLowerCase() || "";
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
							initialValues[field.key] = `${moneyToWords(credito.capitalAdeudado).toUpperCase()} (${moneyToText(credito.capitalAdeudado)})`;
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
							initialValues[field.key] = `${moneyToWords(credito.cuotaMensual).toUpperCase()} (${moneyToText(credito.cuotaMensual)})`;
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
			});

			setFieldValues(initialValues);
		},
		[crmData, numberToText, moneyToText],
	);

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

				// Auto-calculate fecha de vencimiento if we have credit data
				if (crmData.credito?.mesesPrestamo) {
					const hoy = new Date();
					const diaActual = hoy.getDate();

					// Calcular mes de vencimiento (setear día 1 primero para evitar desbordamiento)
					const fechaVenc = new Date();
					fechaVenc.setDate(1);
					fechaVenc.setMonth(fechaVenc.getMonth() + crmData.credito.mesesPrestamo + 1);
					const mesVenc = fechaVenc.getMonth();
					const anioVenc = fechaVenc.getFullYear();

					let diaPagoDefault: string;
					let diaVenc: number;

					if (diaActual <= 20) {
						// Del 1 al 20: día de pago es 15, vencimiento día 15 del mes siguiente
						diaPagoDefault = "día quince";
						diaVenc = 15;
					} else {
						// Del 21 al 31: día de pago es último día, vencimiento último día del mes siguiente
						diaPagoDefault = "último día";
						diaVenc = new Date(anioVenc, mesVenc + 1, 0).getDate();
					}

					const fechaStr = `${anioVenc}-${String(mesVenc + 1).padStart(2, "0")}-${String(diaVenc).padStart(2, "0")}`;
					setDiaPago(diaPagoDefault);
					setFechaVencimiento(fechaStr);
					updateDateFields(fechaStr, diaPagoDefault);
				}
			}
		} catch (error) {
			console.error("Error fetching documents data:", error);
		} finally {
			setIsLoadingFields(false);
		}
	};

	// Validate a specific field against its regex
	const validateField = useCallback((field: Field, value: string): string => {
		const strValue = typeof value === "string" ? value : String(value || "");

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
			return !!fieldValues[fieldKey]?.trim();
		},
		[fieldValues],
	);

	// Count filled vs required fields
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
	const canProceedStep2 =
		fieldStats.required === 0 ||
		fieldStats.filledRequired === fieldStats.required;

	const handleNext = async () => {
		if (step === 1 && canProceedStep1) {
			await fetchDocumentsData();
			setStep(2);
		} else if (step === 2 && canProceedStep2) {
			try {
				// Build contracts payload
				const clientEmail = crmData.cliente.correo;
				const contracts = documents
					.filter((doc) => selectedDocuments.includes(doc.nombre_documento))
					.map((doc) => {
						// Para declaracion_vendedor usar el género del vendedor
						let gender: "male" | "female";
						if (doc.nombre_documento === "declaracion_vendedor") {
							gender = (fieldValues.genderVendedor === "female" ? "female" : "male");
						} else {
							gender = (crmData.cliente.genero === "F" ? "female" : "male");
						}

						return {
							contractType: doc.nombre_documento,
							data: fieldValues,
							emails: clientEmail ? [clientEmail] : undefined,
							options: {
								gender,
								generatePdf: true,
								filenamePrefix: `${crmData.cliente.nombreCompleto}_${doc.nombre_documento}`,
							},
						};
					});

				// Store generation data for snapshot (using ref for immediate availability)
				generationDataRef.current = contracts;

				const result = await onGenerate({ contracts });
				setGenerationResult(result);
				setStep(3);
			} catch (error) {
				console.error("Error generating contracts:", error);
			}
		}
	};

	const handlePrevious = () => {
		if (step === 2) {
			setStep(1);
		} else if (step === 3) {
			// Volver al paso 2 para corregir campos y regenerar
			setGenerationResult(null);
			setStep(2);
		}
	};

	// Handle linking contracts to opportunity
	const handleLinkContracts = async () => {
		if (!generationResult || !leadId) return;

		const successfulContracts = generationResult.results.filter(
			(r) => r.success,
		);
		if (successfulContracts.length === 0) return;

		// Extract contract date from fieldValues
		let contractDate: Date = new Date(); // Default to current date
		const dia = fieldValues.diaContrato || fieldValues.dia;
		const mes = fieldValues.mesContrato || fieldValues.mesTexto;
		const anio = fieldValues.anioContrato || fieldValues.ano;

		console.log("[DynamicContractWizard] Date extraction:", { dia, mes, anio, fieldValues });
		console.log("[DynamicContractWizard] generationDataRef:", generationDataRef.current);

		if (dia && mes && anio) {
			const monthIndex = monthsSpanish.indexOf(mes.toLowerCase());
			if (monthIndex !== -1) {
				// Usar el año tal como viene
				contractDate = new Date(
					Number.parseInt(anio),
					monthIndex,
					Number.parseInt(dia),
				);
			}
		}

		try {
			await onLinkContracts({
				opportunityId,
				leadId,
				contracts: successfulContracts.map((c) => ({
					contractType: c.contractType,
					contractName: c.contractName,
					documentLink: c.documentLink,
					signingLinks: c.signingLinks,
					templateId: c.templateId,
					apiResponse: c.apiResponse,
				})),
				contractDate,
				generationData: generationDataRef.current.length > 0 ? generationDataRef.current : undefined,
			});
			setShowLinkConfirmDialog(false);
			onBack(); // Volver a la pantalla anterior después de enlazar
		} catch (error) {
			console.error("Error linking contracts:", error);
		}
	};

	const steps = [
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
									<span className="font-medium">{s.number}</span>
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
										onClick={() => handleDocumentToggle(docType.enum)}
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
														<option value="último día">Último día del mes</option>
													</select>
													<p className="text-muted-foreground text-xs">
														Se usará: "
														{fieldValues.diaPago || "día quince"}"
														
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
														<div key={field.key} className="flex flex-col">
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

															{/* Input o Select según el campo */}
															{field.key?.toLowerCase() === "gendervendedor" ? (
																<select
																	value={fieldValues[field.key] || "male"}
																	onChange={(e) =>
																		handleFieldChange(field.key, e.target.value)
																	}
																	className={`flex h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${hasError ? "border-red-500" : ""}`}
																>
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
															<div className="mt-1 min-h-[20px]">
																{fieldErrors[field.key] && (
																	<p className="flex items-center gap-1 text-red-600 text-sm">
																		<AlertCircle className="h-3 w-3" />
																		{fieldErrors[field.key]}
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
						<ContractResults
							results={generationResult.results}
							totalRequested={generationResult.totalRequested}
							successCount={generationResult.successCount}
							failCount={generationResult.failCount}
						/>

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
											<li>
												<strong>Revisa los documentos generados</strong>{" "}
												haciendo clic en el botón morado "Ver PDF"
											</li>
											<li>
												Si algún documento tiene errores, haz clic en "Corregir
												y Regenerar" para volver a editarlo
											</li>
											<li>
												Cuando estés satisfecho, haz clic en{" "}
												<strong>"Finalizar y Enlazar"</strong> para guardar los
												contratos en la oportunidad
											</li>
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
					onClick={step === 1 ? onBack : handlePrevious}
					disabled={isGenerating || isLoadingFields || isLinking}
				>
					<ChevronLeft className="mr-2 h-4 w-4" />
					{step === 1
						? "Volver"
						: step === 3
							? "Corregir y Regenerar"
							: "Anterior"}
				</Button>

				{step === 3 ? (
					<Button
						onClick={() => setShowLinkConfirmDialog(true)}
						disabled={
							!generationResult?.results.some((r) => r.success) ||
							!leadId ||
							isLinking
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
							disabled={isLinking}
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
