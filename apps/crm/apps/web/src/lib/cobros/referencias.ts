/**
 * CB-036 · Textos y enlaces de la pestaña Referencias de la Ficha 360.
 * Los catálogos vienen del server (`lib/referencias-cobros.ts`) para que las
 * etiquetas no se desalineen de lo que el router acepta.
 */
import type {
	MetodoContactoReferencia,
	OrigenReferencia,
	ResultadoContactoReferencia,
	TipoHallazgo,
} from "server/src/lib/referencias-cobros";

export {
	METODOS_CONTACTO_REFERENCIA,
	RESULTADOS_CONTACTO_REFERENCIA,
	TIPOS_HALLAZGO,
} from "server/src/lib/referencias-cobros";

export const ORIGEN_REFERENCIA_LABELS: Record<OrigenReferencia, string> = {
	cobros: "Cobros",
	cofirmante: "Cofirmante",
	conyuge: "Cónyuge",
	ventas_personal: "Personal",
	ventas_familiar: "Familiar",
	emergencia: "Emergencia",
};

/** Colores de la etiqueta de origen: cofirmante resalta, lo de ventas en gris. */
export const ORIGEN_REFERENCIA_CLASES: Record<OrigenReferencia, string> = {
	cobros: "border-sky-200 bg-sky-50 text-sky-700",
	cofirmante: "border-violet-200 bg-violet-50 text-violet-700",
	conyuge: "border-rose-200 bg-rose-50 text-rose-700",
	ventas_personal: "border-slate-200 bg-slate-50 text-slate-700",
	ventas_familiar: "border-amber-200 bg-amber-50 text-amber-700",
	emergencia: "border-red-200 bg-red-50 text-red-700",
};

export const PARENTESCO_LABELS: Record<string, string> = {
	padre_madre: "Padre/Madre",
	hermano_a: "Hermano/a",
	hijo_a: "Hijo/a",
	conyuge: "Cónyuge",
	tio_a: "Tío/a",
	primo_a: "Primo/a",
	amigo_a: "Amigo/a",
	vecino_a: "Vecino/a",
	companero_trabajo: "Compañero de trabajo",
	otro: "Otro",
};

export const PARENTESCO_OPCIONES = Object.keys(PARENTESCO_LABELS) as [
	string,
	...string[],
];

export const METODO_REFERENCIA_LABELS: Record<
	MetodoContactoReferencia,
	string
> = {
	llamada: "Llamada",
	whatsapp: "WhatsApp",
	sms: "SMS",
	visita_domicilio: "Visita",
};

export const RESULTADO_REFERENCIA_LABELS: Record<
	ResultadoContactoReferencia,
	string
> = {
	dio_informacion: "Dio información del cliente",
	pasara_mensaje: "Le pasará el mensaje al cliente",
	sin_informacion: "Contestó, no sabe nada del cliente",
	no_conoce_al_cliente: "Dice no conocer al cliente",
	no_contesta: "No contesta",
	numero_equivocado: "Número equivocado o fuera de servicio",
	mensaje_enviado: "Se le dejó mensaje",
};

/** Verde = habló y sirvió; ámbar = habló sin resultado; gris/rojo = no se pudo. */
export const RESULTADO_REFERENCIA_CLASES: Record<
	ResultadoContactoReferencia,
	string
> = {
	dio_informacion: "border-emerald-200 bg-emerald-50 text-emerald-700",
	pasara_mensaje: "border-emerald-200 bg-emerald-50 text-emerald-700",
	sin_informacion: "border-amber-200 bg-amber-50 text-amber-700",
	no_conoce_al_cliente: "border-amber-200 bg-amber-50 text-amber-700",
	no_contesta: "border-slate-200 bg-slate-50 text-slate-600",
	numero_equivocado: "border-red-200 bg-red-50 text-red-700",
	mensaje_enviado: "border-slate-200 bg-slate-50 text-slate-600",
};

export const TIPO_HALLAZGO_LABELS: Record<TipoHallazgo, string> = {
	telefono: "Teléfono",
	direccion: "Dirección",
	ubicacion: "Ubicación",
};

export function etiquetaResultadoReferencia(resultado: string): string {
	return (
		RESULTADO_REFERENCIA_LABELS[resultado as ResultadoContactoReferencia] ??
		resultado
	);
}

export function clasesResultadoReferencia(resultado: string): string {
	return (
		RESULTADO_REFERENCIA_CLASES[resultado as ResultadoContactoReferencia] ??
		"border-slate-200 bg-slate-50 text-slate-600"
	);
}

export function etiquetaMetodoReferencia(metodo: string): string {
	return METODO_REFERENCIA_LABELS[metodo as MetodoContactoReferencia] ?? metodo;
}

export function etiquetaOrigenReferencia(origen: string): string {
	return ORIGEN_REFERENCIA_LABELS[origen as OrigenReferencia] ?? origen;
}

/** `tel:` solo con dígitos y el `+` (el texto puede traer guiones y espacios). */
export function urlLlamada(telefono: string): string {
	return `tel:${telefono.replace(/[^0-9+]/g, "")}`;
}

/** wa.me exige el código de país: a los 8 dígitos guatemaltecos se les pone 502. */
export function urlWhatsapp(telefono: string): string {
	const digitos = telefono.replace(/\D/g, "");
	return `https://wa.me/${digitos.length === 8 ? `502${digitos}` : digitos}`;
}

/** Solo se pintan como enlace los http(s) — el server ya lo exige. */
export function esEnlaceSeguro(url: string | null | undefined): url is string {
	return !!url && /^https?:\/\//i.test(url);
}
