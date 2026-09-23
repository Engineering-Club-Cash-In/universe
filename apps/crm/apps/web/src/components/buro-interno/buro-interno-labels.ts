import type { client } from "@/utils/orpc";

export type RegistroBuroInterno = Awaited<
	ReturnType<typeof client.listBuroInterno>
>["items"][number];
export type CandidatoBuroInterno = Awaited<
	ReturnType<typeof client.buscarCandidatosBuroInterno>
>[number];
export type CoincidenciaBuroInterno = Awaited<
	ReturnType<typeof client.consultarBuroInterno>
>[number];
export type ReglaBuroInterno = Awaited<
	ReturnType<typeof client.getReglasBuroInterno>
>[number];

export const CATEGORIAS_BURO_INTERNO = [
	{ value: "mala_paga", label: "Mala paga" },
	{ value: "fraude", label: "Fraude / documentos falsos" },
	{ value: "vehiculo_recuperado", label: "Vehículo recuperado" },
	{ value: "incobrable", label: "Incobrable" },
	{ value: "otro", label: "Otro" },
] as const;

export type CategoriaBuroInterno =
	(typeof CATEGORIAS_BURO_INTERNO)[number]["value"];

export function etiquetaCategoria(categoria: string): string {
	return (
		CATEGORIAS_BURO_INTERNO.find((c) => c.value === categoria)?.label ??
		categoria
	);
}

export const SEVERIDADES = ["alta", "media", "baja"] as const;
export type Severidad = (typeof SEVERIDADES)[number];

export const ETIQUETA_SEVERIDAD: Record<Severidad, string> = {
	alta: "Alta",
	media: "Media",
	baja: "Baja",
};

/** Qué ve el analista con cada severidad. Ninguna bloquea la aprobación. */
export const DESCRIPCION_SEVERIDAD: Record<Severidad, string> = {
	alta: "Casi seguro es la misma persona. En el análisis sale en rojo y de primera.",
	media:
		"Posible familiar o nombre parecido. Sale en amarillo, después de las altas; el analista revisa si es de la misma familia.",
	baja: "Dato suelto. Sale en gris y al final, solo como referencia.",
};

export const CLASE_SEVERIDAD: Record<Severidad, string> = {
	alta: "border-red-300 bg-red-100 text-red-800 hover:bg-red-100",
	media: "border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-100",
	baja: "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-100",
};

export const ETIQUETA_ORIGEN: Record<string, string> = {
	titular: "Titular",
	codeudor: "Codeudores",
	referencia: "Referencias",
};

export const ETIQUETA_ACCION: Record<string, string> = {
	alta: "Agregado al buró",
	edicion: "Edición",
	baja: "Retirado del buró",
	regla_actualizada: "Regla actualizada",
	consulta: "Consulta",
};

export function formatearFecha(fecha: Date | string | null | undefined) {
	if (!fecha) return "—";
	return new Date(fecha).toLocaleDateString("es-GT", {
		day: "2-digit",
		month: "short",
		year: "numeric",
	});
}

export function formatearFechaHora(fecha: Date | string | null | undefined) {
	if (!fecha) return "—";
	return new Date(fecha).toLocaleString("es-GT", {
		day: "2-digit",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}
