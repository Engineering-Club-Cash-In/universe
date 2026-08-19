import {
	Mail,
	MapPin,
	MessageSquare,
	Phone,
	Send,
	Smartphone,
} from "lucide-react";

/**
 * Catálogos y helpers de formato compartidos por el tab "Historial de
 * gestiones" y el bloque de gestiones del asesor en "Cumplimiento de agenda".
 */

export const ESTADOS_CONTACTO = [
	{ value: "contactado", label: "Contactado" },
	{ value: "promesa_pago", label: "Promesa de pago" },
	{ value: "acuerdo_parcial", label: "Acuerdo parcial" },
	{ value: "rechaza_pagar", label: "Rechaza pagar" },
	{ value: "no_contesta", label: "No contesta" },
	{ value: "numero_equivocado", label: "Número equivocado" },
] as const;

export const METODOS_CONTACTO = [
	{ value: "llamada", label: "Llamada", icono: Phone },
	{ value: "whatsapp", label: "WhatsApp", icono: MessageSquare },
	{ value: "sms", label: "SMS", icono: Smartphone },
	{ value: "email", label: "Email", icono: Mail },
	{ value: "visita_domicilio", label: "Visita", icono: MapPin },
	{ value: "carta_notarial", label: "Carta notarial", icono: Send },
] as const;

export const ROLES_FILTRABLES = [
	{ value: "cobros", label: "Asesor de Cobros" },
	{ value: "cobros_supervisor", label: "Supervisor de Cobros" },
	{ value: "admin", label: "Administrador" },
] as const;

export const ORIGEN_LABEL: Record<string, string> = {
	manual: "Manual",
	premora: "Premora automático",
	convenio: "Recordatorio de convenio",
	wsp_masivo: "WhatsApp masivo",
};

export function etiquetaEstado(valor: string | null): string {
	return ESTADOS_CONTACTO.find((e) => e.value === valor)?.label ?? "—";
}

export function etiquetaMetodo(valor: string | null): string {
	return METODOS_CONTACTO.find((m) => m.value === valor)?.label ?? "—";
}

export function etiquetaRol(rol: string | null): string {
	return ROLES_FILTRABLES.find((r) => r.value === rol)?.label ?? rol ?? "—";
}

/**
 * `Intl.DateTimeFormat` con zona horaria explícita GT, en vez de `date-fns`
 * puro: `format()` de `date-fns` usa siempre la zona LOCAL del navegador, y las
 * ventanas de este reporte se definen por día calendario de Guatemala en el
 * server. Para un supervisor con el navegador fuera de UTC-6, una gestión
 * cerca de medianoche se mostraba en un día u hora distinto al real GT —y esta
 * fecha alimenta la tabla, el popover de auditoría y el export XLSX, así que
 * podía contradecir el propio rango de fechas que el usuario seleccionó.
 */
const MESES_CORTOS_ES = [
	"ene",
	"feb",
	"mar",
	"abr",
	"may",
	"jun",
	"jul",
	"ago",
	"sep",
	"oct",
	"nov",
	"dic",
];

/** Partes de un instante en el día calendario y hora de Guatemala. */
export function partesGT(fecha: Date) {
	const partes = new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Guatemala",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).formatToParts(fecha);
	const get = (tipo: string) =>
		partes.find((p) => p.type === tipo)?.value ?? "";
	return {
		dia: get("day"),
		mes: MESES_CORTOS_ES[Number(get("month")) - 1] ?? "",
		anio: get("year"),
		hora: get("hour"),
		minuto: get("minute"),
	};
}

export function fechaHora(valor: string | Date | null): string {
	if (!valor) return "—";
	const { dia, mes, anio, hora, minuto } = partesGT(new Date(valor));
	return `${dia} ${mes} ${anio} ${hora}:${minuto}`;
}

export function soloFecha(valor: string | Date | null): string {
	if (!valor) return "—";
	const { dia, mes, anio } = partesGT(new Date(valor));
	return `${dia} ${mes} ${anio}`;
}

/** YYYY-MM-DD de un Date local, sin pasar por UTC (que correría el día). */
export function aFechaISO(fecha: Date): string {
	const y = fecha.getFullYear();
	const m = String(fecha.getMonth() + 1).padStart(2, "0");
	const d = String(fecha.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

/** Suma días a un Date en horario LOCAL (no UTC), preservando hora/minuto. */
export function sumarDiasLocal(fecha: Date, dias: number): Date {
	const copia = new Date(fecha);
	copia.setDate(copia.getDate() + dias);
	return copia;
}

/**
 * YYYY-MM-DD de un instante, en el día calendario de GUATEMALA (no el del
 * navegador). Espejo client-side de `toDateStrGT` del server
 * (`lib/guatemala-month-window.ts`): mismo mecanismo (`Intl.DateTimeFormat`
 * `en-CA` da directo el formato ISO), duplicado porque este archivo no importa
 * del server (ver la nota de TS7056 más abajo). Necesario para convertir
 * `rangoAplicado.hasta` (instante UTC, exclusivo) al día calendario GT que
 * espera `z.string().date()` en el input — usar el día LOCAL del navegador acá
 * correría el día para cualquier usuario fuera de UTC-6.
 */
export function aFechaISO_GT(instante: Date): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Guatemala",
	}).format(instante);
}
