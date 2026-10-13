/**
 * Ausencia indefinida de un asesor (tarea M5 de
 * docs/features/cobros-02/18-equipo-solicitudes-backend.md). Textos y reglas
 * puras; el flujo vive en services/ausencias-cobros.ts.
 */

export const MOTIVOS_AUSENCIA = ["incidente", "permiso", "vacaciones"] as const;
export type MotivoAusencia = (typeof MOTIVOS_AUSENCIA)[number];

export const ETIQUETA_MOTIVO_AUSENCIA: Record<MotivoAusencia, string> = {
	incidente: "Incidente",
	permiso: "Permiso",
	vacaciones: "Vacaciones",
};

/** Motivo que queda en el traslado y en el historial de reasignaciones. */
export function motivoDelReparto(motivo: MotivoAusencia): string {
	return `Ausencia temporal (${ETIQUETA_MOTIVO_AUSENCIA[motivo]}): cartera repartida al equipo hasta su reactivación`;
}

/** Motivo de la devolución al reactivar. */
export function motivoDeLaDevolucion(nombre: string | null): string {
	return `Reactivación de ${nombre ?? "asesor"}: se le devuelve su cartera`;
}

const plural = (n: number, uno: string, varios: string) =>
	`${n} ${n === 1 ? uno : varios}`;

/** Aviso al equipo cuando un asesor vuelve (Figma «Asesor reactivado»). */
export function textoAvisoReactivacion(params: {
	nombre: string | null;
	devueltas: number;
	retenidas: number;
}): { titulo: string; descripcion: string } {
	const quien = params.nombre ?? "Un asesor";
	const partes = [
		params.devueltas > 0
			? `Se le devolvió ${plural(params.devueltas, "cuenta", "cuentas")}.`
			: "No había cuentas por devolver.",
		params.retenidas > 0
			? `${plural(params.retenidas, "cuenta se quedó", "cuentas se quedaron")} con quien la lleva ahora porque cambió de bucket o de responsable.`
			: null,
	].filter(Boolean);
	return {
		titulo: `${quien} se reactivó`,
		descripcion: `${quien} volvió y ya atiende su cartera. ${partes.join(" ")}`,
	};
}
