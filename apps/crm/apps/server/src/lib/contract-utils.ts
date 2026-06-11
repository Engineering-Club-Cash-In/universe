/**
 * Utilidades para generación de contratos legales
 */

// Unidades en español
const UNIDADES = [
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

const ESPECIALES = [
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

const DECENAS = [
	"",
	"diez",
	"veinte",
	"treinta",
	"cuarenta",
	"cincuenta",
	"sesenta",
	"setenta",
	"ochenta",
	"noventa",
];

const CENTENAS = [
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

const MESES = [
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

/**
 * Convierte un número entre 0 y 99 a palabras
 */
function convertirDecenas(n: number): string {
	if (n < 10) return UNIDADES[n];
	if (n < 20) return ESPECIALES[n - 10];
	if (n === 20) return "veinte";
	if (n < 30) return `veinti${UNIDADES[n % 10]}`;

	const decena = Math.floor(n / 10);
	const unidad = n % 10;

	if (unidad === 0) return DECENAS[decena];
	return `${DECENAS[decena]} y ${UNIDADES[unidad]}`;
}

/**
 * Convierte un número entre 0 y 999 a palabras
 */
function convertirCentenas(n: number): string {
	if (n === 0) return "";
	if (n === 100) return "cien";
	if (n < 100) return convertirDecenas(n);

	const centena = Math.floor(n / 100);
	const resto = n % 100;

	if (resto === 0) return CENTENAS[centena];
	return `${CENTENAS[centena]} ${convertirDecenas(resto)}`;
}

/**
 * Ajusta "uno" → "un" cuando va antes de un sustantivo
 * Ej: "veintiuno" → "veintiún", "treinta y uno" → "treinta y un"
 */
function ajustarUnoAntesSustantivo(palabras: string): string {
	return palabras.replace(/uno$/, "un");
}

/**
 * Convierte un número entero a palabras en español
 * Soporta números hasta 999,999,999
 */
export function numberToWords(num: number): string {
	if (num === 0) return "cero";
	if (num < 0) return `menos ${numberToWords(Math.abs(num))}`;
	if (num === 1) return "uno";

	let resultado = "";

	// Millones
	const millones = Math.floor(num / 1000000);
	if (millones > 0) {
		if (millones === 1) {
			resultado = "un millón";
		} else {
			resultado = `${ajustarUnoAntesSustantivo(convertirCentenas(millones))} millones`;
		}
		num %= 1000000;
		if (num > 0) resultado += " ";
	}

	// Miles
	const miles = Math.floor(num / 1000);
	if (miles > 0) {
		if (miles === 1) {
			resultado += "mil";
		} else {
			resultado += `${ajustarUnoAntesSustantivo(convertirCentenas(miles))} mil`;
		}
		num %= 1000;
		if (num > 0) resultado += " ";
	}

	// Centenas
	if (num > 0) {
		resultado += convertirCentenas(num);
	}

	return resultado.trim();
}

/**
 * Convierte un monto en quetzales a palabras en formato legal
 * Ejemplo: 150000.50 => "ciento cincuenta mil quetzales con cincuenta centavos"
 * Ejemplo: 1 => "un quetzal"
 * Ejemplo: 21 => "veintiún quetzales"
 */
export function numberToWordsQuetzales(amount: number): string {
	const entero = Math.floor(amount);
	const centavos = Math.round((amount - entero) * 100);

	// Ajustar "uno" → "un" antes del sustantivo
	const palabrasEntero = ajustarUnoAntesSustantivo(numberToWords(entero));
	// Singular solo para 1, plural para todo lo demás
	const moneda = entero === 1 ? "quetzal" : "quetzales";

	let resultado = `${palabrasEntero} ${moneda}`;

	if (centavos > 0) {
		const palabrasCentavos = ajustarUnoAntesSustantivo(numberToWords(centavos));
		const centavoWord = centavos === 1 ? "centavo" : "centavos";
		resultado += ` con ${palabrasCentavos} ${centavoWord}`;
	}

	return resultado;
}

/**
 * Formatea un número como moneda con comas (sin Q.)
 * Ejemplo: 146970.60 => "146,970.60"
 */
export function formatMoneyNumber(amount: number): string {
	return amount.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
}

/**
 * Formatea un número como moneda con Q.
 * Ejemplo: 146970.60 => "Q.146,970.60"
 */
export function formatMoneyWithQ(amount: number): string {
	return `Q.${formatMoneyNumber(amount)}`;
}

/**
 * Convierte monto a formato legal completo: "MAYÚSCULAS (Q.número)"
 * Ejemplo: 146970.60 => "CIENTO CUARENTA Y SEIS MIL NOVECIENTOS SETENTA QUETZALES CON SESENTA CENTAVOS (Q.146,970.60)"
 */
export function numberToWordsQuetzalesLegal(amount: number): string {
	const palabras = numberToWordsQuetzales(amount).toUpperCase();
	const numero = formatMoneyWithQ(amount);
	return `${palabras} (${numero})`;
}

/**
 * Obtiene solo la parte del año después de "dos mil"
 * Ejemplo: 2025 => "veinticinco"
 * Ejemplo: 2030 => "treinta"
 */
export function getYearPartial(year: number): string {
	const partial = year - 2000;
	if (partial <= 0) return numberToWords(year);
	return numberToWords(partial);
}

/**
 * Obtiene el año en 2 dígitos como string
 * Ejemplo: 2025 => "25"
 */
export function getYearTwoDigits(year: number): string {
	return String(year).slice(-2);
}

/**
 * Obtiene la letra de género para sufijos
 * Ejemplo: "male" => "o", "female" => "a"
 * Usado para: identificado/identificada, propietario/propietaria
 */
export function getGenderLetter(gender: string | null): string {
	return gender === "female" ? "a" : "o";
}

/**
 * Convierte DPI a palabras en MAYÚSCULAS sin paréntesis
 * Ejemplo: "1731641100101" => "UN MIL SETECIENTOS TREINTA Y UNO SESENTA Y CUATRO MIL CIENTO DIEZ CERO CIENTO UNO"
 */
export function dpiToWordsUppercase(dpi: string): string {
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

	return `${palabras1} ${palabras2} ${palabras3}`.toUpperCase();
}

/**
 * Formatea una fecha en formato legal para contratos
 * Ejemplo: "quince de enero del año dos mil veinticinco"
 */
export function formatDateInWords(date: Date): string {
	const day = date.getDate();
	const month = MESES[date.getMonth()];
	const year = date.getFullYear();

	return `${numberToWords(day)} de ${month} del año ${numberToWords(year)}`;
}

/**
 * Obtiene el nombre del mes en español
 */
export function getMonthName(date: Date): string {
	return MESES[date.getMonth()];
}

/**
 * Obtiene los componentes de la fecha para contratos
 */
export function getDateComponents(date: Date): {
	day: string;
	month: string;
	year: string;
	yearPartial: string;
	yearTwoDigits: string;
	dayNumber: number;
	dayPadded: string;
	monthNumber: number;
	yearNumber: number;
} {
	const yearNum = date.getFullYear();
	const dayNum = date.getDate();
	return {
		day: numberToWords(dayNum),
		month: MESES[date.getMonth()],
		year: numberToWords(yearNum),
		yearPartial: getYearPartial(yearNum),
		yearTwoDigits: getYearTwoDigits(yearNum),
		dayNumber: dayNum,
		dayPadded: String(dayNum).padStart(2, "0"),
		monthNumber: date.getMonth() + 1,
		yearNumber: yearNum,
	};
}

/**
 * Calcula la edad y la retorna en palabras
 */
export function calculateAgeInWords(birthDate: Date): string {
	const today = new Date();
	let age = today.getFullYear() - birthDate.getFullYear();
	const monthDiff = today.getMonth() - birthDate.getMonth();

	if (
		monthDiff < 0 ||
		(monthDiff === 0 && today.getDate() < birthDate.getDate())
	) {
		age--;
	}

	return numberToWords(age);
}

/**
 * Calcula la edad como número
 */
export function calculateAge(birthDate: Date): number {
	const today = new Date();
	let age = today.getFullYear() - birthDate.getFullYear();
	const monthDiff = today.getMonth() - birthDate.getMonth();

	if (
		monthDiff < 0 ||
		(monthDiff === 0 && today.getDate() < birthDate.getDate())
	) {
		age--;
	}

	return age;
}

/**
 * Formatea un DPI guatemalteco con espacios
 * Ejemplo: "1234567890123" => "1234 56789 0123"
 */
export function formatDpi(dpi: string): string {
	const cleanDpi = dpi.replace(/\D/g, "");
	if (cleanDpi.length !== 13) return dpi; // Retornar sin formato si no es válido

	return `${cleanDpi.slice(0, 4)} ${cleanDpi.slice(4, 9)} ${cleanDpi.slice(9)}`;
}

/**
 * Convierte un grupo de DPI a palabras, manejando ceros iniciales
 * Ejemplo: "0101" => "cero ciento uno"
 */
function dpiGroupToWords(group: string): string {
	// Contar ceros iniciales
	let leadingZeros = 0;
	for (const char of group) {
		if (char === "0") leadingZeros++;
		else break;
	}

	// Si todo son ceros
	if (leadingZeros === group.length) {
		return Array(group.length).fill("cero").join(" ");
	}

	// Parte sin ceros iniciales
	const numericPart = Number.parseInt(group, 10);
	const words = numberToWords(numericPart);

	// Agregar "cero" por cada cero inicial
	if (leadingZeros > 0) {
		const zeros = Array(leadingZeros).fill("cero").join(" ");
		return `${zeros} ${words}`;
	}

	return words;
}

/**
 * Convierte un DPI completo a formato legal con palabras
 * Ejemplo: "1731641100101" => "un mil setecientos treinta y uno, sesenta y cuatro mil ciento diez, cero ciento uno (1731 64110 0101)"
 */
export function dpiToLegalFormat(dpi: string): string {
	const cleanDpi = dpi.replace(/\D/g, "");
	if (cleanDpi.length !== 13) return dpi;

	// Dividir en grupos: 4-5-4
	const grupo1 = cleanDpi.slice(0, 4);
	const grupo2 = cleanDpi.slice(4, 9);
	const grupo3 = cleanDpi.slice(9, 13);

	// Convertir cada grupo a palabras
	const palabras1 = dpiGroupToWords(grupo1);
	const palabras2 = dpiGroupToWords(grupo2);
	const palabras3 = dpiGroupToWords(grupo3);

	// Formato con espacios
	const formateado = `${grupo1} ${grupo2} ${grupo3}`;

	return `${palabras1}, ${palabras2}, ${palabras3} (${formateado})`;
}

/**
 * Mapea estado civil del CRM al formato legal según género
 */
export function mapMaritalStatus(
	status: string | null,
	gender: string | null,
): string {
	const isFemale = gender === "female";

	switch (status) {
		case "single":
			return isFemale ? "soltera" : "soltero";
		case "married":
			return isFemale ? "casada" : "casado";
		case "divorced":
			return isFemale ? "divorciada" : "divorciado";
		case "widowed":
			return isFemale ? "viuda" : "viudo";
		default:
			return isFemale ? "soltera" : "soltero";
	}
}

/**
 * Mapea género del CRM al formato para contratos
 */
export function mapGender(gender: string | null): string {
	switch (gender) {
		case "male":
			return "masculino";
		case "female":
			return "femenino";
		default:
			return "masculino";
	}
}

/**
 * Formatea nacionalidad según género
 * Solo ajusta automáticamente gentilicios con patrón -o/-a (guatemalteco, mexicano, etc.)
 * Para otros casos (estadounidense, francés), devuelve tal cual - el usuario debe ingresar la forma correcta
 */
export function formatNationality(
	nationality: string | null,
	gender: string | null,
): string {
	if (!nationality) {
		return gender === "female" ? "guatemalteca" : "guatemalteco";
	}

	const trimmed = nationality.trim().toLowerCase();

	// Solo ajustar si termina en 'o' o 'a' (patrón común: guatemalteco/a, mexicano/a, salvadoreño/a)
	if (trimmed.endsWith("o") || trimmed.endsWith("a")) {
		const base = trimmed.slice(0, -1);
		return gender === "female" ? `${base}a` : `${base}o`;
	}

	// Para otros casos (estadounidense, francés, costarricense), devolver como está
	return nationality.trim();
}

/**
 * Capitaliza la primera letra de cada palabra
 */
export function capitalizeWords(text: string): string {
	return text
		.toLowerCase()
		.split(" ")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

/**
 * Convierte texto a mayúsculas para contratos
 */
export function toUpperCase(text: string | null | undefined): string {
	return (text ?? "").toUpperCase();
}
