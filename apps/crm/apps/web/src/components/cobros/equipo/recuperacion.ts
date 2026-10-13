import { formatoQCompacto } from "@/components/cobros/asesor/mi-desempeno";

/**
 * Recuperación de un asesor en el período (tarea M1), tal como la devuelve el
 * servidor: `getRecuperacionAsesores` y `getSupervisionComplementos().equipo[]`.
 */
export type RecuperacionServidor = {
	monto: number;
	montoAnterior: number | null;
	/** Meta prorrateada al período, en Q; `null` si no tiene. */
	meta: number | null;
	/** Recuperación ÷ meta, en %; puede pasar de 100. `null` sin meta. */
	porcentaje: number | null;
};

export type ResultadoRecuperacionVista = {
	porcentaje: number | null;
	/** «Q8.4K de Q9.1K», o solo el monto si no tiene meta. */
	detalle: string;
	tono: "normal" | "success" | "warning" | "danger";
};

/** Tono de la barra: cumplida, en camino, atrasada o lejos de la meta. */
export function tonoRecuperacion(porcentaje: number | null) {
	if (porcentaje === null) return "normal" as const;
	if (porcentaje >= 100) return "success" as const;
	if (porcentaje >= 60) return "normal" as const;
	if (porcentaje >= 30) return "warning" as const;
	return "danger" as const;
}

/** `null` si el servidor no pudo leer la recuperación (la tarjeta muestra «—»). */
export function resultadoRecuperacion(
	r: RecuperacionServidor | null | undefined,
): ResultadoRecuperacionVista | null {
	if (!r) return null;
	return {
		porcentaje: r.porcentaje,
		detalle:
			r.meta === null
				? `${formatoQCompacto(r.monto)} · sin meta`
				: `${formatoQCompacto(r.monto)} de ${formatoQCompacto(r.meta)}`,
		tono: tonoRecuperacion(r.porcentaje),
	};
}

/**
 * Variación contra el período anterior, en %: `null` si no hay base (el
 * anterior fue 0 o no se pudo leer).
 */
export function variacionRecuperacion(
	r: RecuperacionServidor | null | undefined,
): number | null {
	if (!r || r.montoAnterior === null || !(r.montoAnterior > 0)) return null;
	return (
		Math.round(((r.monto - r.montoAnterior) / r.montoAnterior) * 1000) / 10
	);
}
