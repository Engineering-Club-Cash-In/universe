/**
 * Chips de categoría del «Historial de actividad» del asesor (Figma 4063:12):
 * Todas, Llamadas, Mensajes, Gestiones, Acuerdos, Escaladas y Cambios de
 * bucket. Solo existen en el Detalle del asesor (`HistorialGestiones` con
 * `usuarioFijo`); la vista del equipo no los tiene.
 *
 * Cada chip se traduce a los filtros reales de `getHistorialAgendas`
 * (`metodoContacto` y `estadoContacto`, que aceptan varios valores). Un chip
 * con métodos y el filtro «Tipo» son excluyentes (lo mismo un chip con
 * resultados y el filtro «Resultado»): elegir uno limpia el otro, así nunca se
 * combinan en un filtro imposible.
 *
 * «Cambios de bucket» no sale de las gestiones: son los movimientos del cierre
 * diario (`getDetalleCierrePorAsesor`), y se pintan en lugar de la tabla.
 * «Escaladas» tampoco: son sus solicitudes a Jurídico y de recuperación del
 * vehículo (`getEscaladasAsesor`, M3), y también se pintan en lugar de la tabla.
 */

export type CategoriaActividad =
	| "todas"
	| "llamadas"
	| "mensajes"
	| "gestiones"
	| "acuerdos"
	| "escaladas"
	| "cambios_bucket";

export type DefCategoriaActividad = {
	clave: CategoriaActividad;
	etiqueta: string;
	/** Tooltip: qué agrupa el chip. */
	descripcion: string;
	/** Valores de `metodoContacto` que manda el chip. */
	metodos?: readonly string[];
	/** Valores de `estadoContacto` que manda el chip. */
	estados?: readonly string[];
	/** Sin fuente todavía: el chip se ve deshabilitado con «Pronto». */
	pronto?: boolean;
};

export const CATEGORIAS_ACTIVIDAD: readonly DefCategoriaActividad[] = [
	{
		clave: "todas",
		etiqueta: "Todas",
		descripcion: "Todas las gestiones del asesor.",
	},
	{
		clave: "llamadas",
		etiqueta: "Llamadas",
		descripcion: "Gestiones registradas como llamada.",
		metodos: ["llamada"],
	},
	{
		clave: "mensajes",
		etiqueta: "Mensajes",
		descripcion: "WhatsApp, SMS y correo electrónico.",
		metodos: ["whatsapp", "sms", "email"],
	},
	{
		clave: "gestiones",
		etiqueta: "Gestiones",
		descripcion:
			"Visitas a residencia y al trabajo, cartas notariales y pagos registrados.",
		metodos: ["visita_domicilio", "visita_trabajo", "carta_notarial", "pago"],
	},
	{
		clave: "acuerdos",
		etiqueta: "Acuerdos",
		descripcion:
			"Promesas de pago y acuerdos parciales. Los convenios enviados a aprobación están en la pestaña Solicitudes.",
		estados: ["promesa_pago", "acuerdo_parcial"],
	},
	{
		clave: "escaladas",
		etiqueta: "Escaladas",
		descripcion:
			"Casos que el asesor escaló con una solicitud a Jurídico o de recuperación del vehículo.",
	},
	{
		clave: "cambios_bucket",
		etiqueta: "Cambios de bucket",
		descripcion:
			"Créditos del asesor que subieron o bajaron de bucket, según el cierre diario.",
	},
];

export function defCategoria(clave: CategoriaActividad): DefCategoriaActividad {
	return (
		CATEGORIAS_ACTIVIDAD.find((c) => c.clave === clave) ??
		CATEGORIAS_ACTIVIDAD[0]
	);
}

export function esCategoriaActividad(v: unknown): v is CategoriaActividad {
	return CATEGORIAS_ACTIVIDAD.some((c) => c.clave === v);
}
