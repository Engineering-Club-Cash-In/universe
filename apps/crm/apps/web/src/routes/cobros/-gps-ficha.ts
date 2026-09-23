import { CircleHelp, Power, PowerOff } from "lucide-react";

/**
 * Helpers puros para la tarjeta GPS de la Ficha 360 (CB-118). Prefijo `-` para
 * quedar excluidos del route tree de TanStack Router, igual que -mora-display.ts
 * y el espejo de admin: routes/admin/-gps-format.ts.
 */

const MINUTO_MS = 60 * 1000;
const HORA_MS = 60 * MINUTO_MS;
const DIA_MS = 24 * HORA_MS;

/**
 * Antigüedad de la última señal en lenguaje del asesor.
 *
 * Se muestra relativa y no como fecha absoluta porque la pregunta que se hace
 * quien gestiona no es "¿qué día reportó?" sino "¿esto que estoy viendo es de
 * ahora?". La fecha exacta va aparte, como detalle.
 */
export function formatUltimaSenal(
	date: Date | string | null | undefined,
	ahora: Date = new Date(),
): string {
	if (!date) return "Sin señal registrada";

	const fecha = date instanceof Date ? date : new Date(date);
	if (Number.isNaN(fecha.getTime())) return "Sin señal registrada";

	const diff = ahora.getTime() - fecha.getTime();

	// Un reloj desfasado entre el GPS y el servidor puede dar diferencias
	// negativas de unos segundos; tratarlas como "ahora" en vez de "en -3 min".
	if (diff < MINUTO_MS) return "hace menos de 1 min";
	if (diff < HORA_MS) {
		const min = Math.floor(diff / MINUTO_MS);
		return `hace ${min} min`;
	}
	if (diff < DIA_MS) {
		const horas = Math.floor(diff / HORA_MS);
		return `hace ${horas} ${horas === 1 ? "hora" : "horas"}`;
	}
	const dias = Math.floor(diff / DIA_MS);
	return `hace ${dias} ${dias === 1 ? "día" : "días"}`;
}

/** Fecha y hora exactas de la última señal, como dato de respaldo. */
export function formatFechaSenal(
	date: Date | string | null | undefined,
): string {
	if (!date) return "—";
	const fecha = date instanceof Date ? date : new Date(date);
	if (Number.isNaN(fecha.getTime())) return "—";
	return fecha.toLocaleString("es-GT", {
		day: "2-digit",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export type EstadoSenal = "fresca" | "tibia" | "vieja" | "sin_datos";

export const ESTADO_SENAL_CONFIG: Record<
	EstadoSenal,
	{ label: string; badgeClass: string; textClass: string }
> = {
	fresca: {
		label: "Señal reciente",
		badgeClass:
			"bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
		textClass: "text-emerald-600 dark:text-emerald-400",
	},
	tibia: {
		label: "Señal con retraso",
		badgeClass:
			"bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
		textClass: "text-amber-600 dark:text-amber-400",
	},
	vieja: {
		label: "Sin reportar",
		badgeClass: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
		textClass: "text-red-600 dark:text-red-400",
	},
	sin_datos: {
		label: "Sin datos",
		badgeClass:
			"bg-muted text-muted-foreground dark:bg-muted/50 dark:text-muted-foreground",
		textClass: "text-muted-foreground",
	},
};

/**
 * Clasifica qué tan confiable es la última posición.
 *
 * Para cobros esto no es cosmético: una ubicación de hace tres días no dice
 * dónde está el vehículo, dice que el GPS dejó de reportar — y eso, en un
 * crédito en mora, es información en sí misma.
 */
export function resolveEstadoSenal(
	date: Date | string | null | undefined,
	ahora: Date = new Date(),
): EstadoSenal {
	if (!date) return "sin_datos";
	const fecha = date instanceof Date ? date : new Date(date);
	if (Number.isNaN(fecha.getTime())) return "sin_datos";

	const diff = ahora.getTime() - fecha.getTime();
	if (diff < 15 * MINUTO_MS) return "fresca";
	if (diff < 2 * HORA_MS) return "tibia";
	return "vieja";
}

/**
 * Estado del motor. Los tres casos son distintos a propósito: `undefined`
 * significa que la unidad no reporta un sensor de ignición reconocible, y
 * pintarlo como "Apagado" sería afirmar algo que nadie midió.
 */
export function formatIgnicion(isIgnitionOn: boolean | undefined): {
	label: string;
	icon: typeof Power;
	className: string;
} {
	if (isIgnitionOn === true) {
		return {
			label: "Encendido",
			icon: Power,
			className: "text-emerald-600 dark:text-emerald-400",
		};
	}
	if (isIgnitionOn === false) {
		return {
			label: "Apagado",
			icon: PowerOff,
			className: "text-muted-foreground",
		};
	}
	return {
		label: "Sin dato",
		icon: CircleHelp,
		className: "text-muted-foreground",
	};
}

export function formatVelocidad(kmh: number | undefined): string {
	if (kmh == null || !Number.isFinite(kmh)) return "—";
	return `${Math.round(kmh)} km/h`;
}

export function formatCoordenadas(
	lat: number | undefined,
	lon: number | undefined,
): string {
	if (lat == null || lon == null) return "—";
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "—";
	return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

/** Link al mapa. Null cuando no hay posición, para no pintar un botón muerto. */
export function googleMapsUrl(
	lat: number | undefined,
	lon: number | undefined,
): string | null {
	if (lat == null || lon == null) return null;
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	return `https://www.google.com/maps?q=${lat},${lon}`;
}

/**
 * Extrae de una placa la parte que sirve para buscarla en el catálogo de
 * Wialon (`filterName` de `getWialonUnits`, que hace match de SUBCADENA
 * LITERAL contra `sys_name`, no una comparación normalizada).
 *
 * Se busca por los 3 dígitos del núcleo de la placa guatemalteca (3 dígitos +
 * 3 letras), mismo criterio que `extraerNucleoPlaca` en el server. No sirve
 * tomar TODOS los dígitos: ~10% de las placas del CRM vienen como
 * "P0-720GVH" (cero tipeado de más) y "0720" no aparece en "P-720GVH...". Ni
 * la placa limpia de guiones: "P278KJQ" tampoco es substring de "P-278KJQ".
 * Sin núcleo pero con 3 dígitos (placa incompleta) se usan esos dígitos; sin
 * nada de eso (vacía o de relleno: "NUEVO", "N/A") devuelve "", y el buscador
 * arranca vacío para que el supervisor escriba.
 */
const NUCLEO_PLACA = /(\d{3})\s*-?\s*[A-Z]{3}/;

export function limpiarPlacaParaBusqueda(valor: string): string {
	const upper = valor.toUpperCase();
	// Placa incompleta ("P-572JX", falta una letra): el server no la vincula
	// solo, pero los 3 dígitos igual acotan el buscador para el supervisor.
	return upper.match(NUCLEO_PLACA)?.[1] ?? upper.match(/\d{3}/)?.[0] ?? "";
}

/** Texto para cada motivo por el que un vehículo no tiene unidad vinculada. */
export const MOTIVO_SIN_VINCULO: Record<
	"sin_placa" | "sin_coincidencia" | "ambiguo" | "asignada_a_otro",
	string
> = {
	sin_placa:
		"El vehículo no tiene una placa válida registrada, así que no se puede identificar su unidad GPS.",
	sin_coincidencia:
		"Ninguna unidad del catálogo de La Legión coincide con la placa de este vehículo.",
	ambiguo:
		"Varias unidades coinciden con esta placa. Hay que elegir cuál corresponde.",
	asignada_a_otro:
		"La unidad GPS que coincide con esta placa está vinculada a otro vehículo. Un supervisor debe confirmar a cuál corresponde.",
};
