/**
 * Nivel y estado de un asesor de cobros: criterio ÚNICO que comparten la
 * tarjeta de «Mi equipo» y el encabezado del Detalle del asesor. Funciones
 * puras (sin queries): las usan los contenedores, la presentación y los
 * showcases.
 */

/** Iniciales del avatar («Ana Lucía Díaz» → «AD»): las mismas del design system. */
export { inicialesDe as iniciales } from "@/components/ds/cards-credito";

/* ── Nivel ─────────────────────────────────────────────────────────────── */

export type NivelAsesor = "junior" | "senior" | "especial";

/**
 * Nivel derivado de los buckets del pool del asesor en cartera
 * (`getAsesoresTraslados().buckets`, números 0–5):
 * - **Especial** si atiende B5 (jurídico, lo ve gerencia).
 * - **Senior** si atiende B2, B3 o B4.
 * - **Junior** si solo atiende B0–B1.
 * - `null` si no tiene pool asignado.
 * Criterio confirmado por el usuario (2026-10-07).
 *
 * Es un dato DERIVADO, no un atributo del asesor.
 * TODO(José) · tarea M6: el nivel tiene que ser un dato real del asesor.
 * Ojo: `nivelPorBuckets` del server (routers/cobros-asesor.ts) hoy dice
 * «senior = B2 en adelante» y no tiene «especial» (B5); al volverlo dato real
 * hay que dejar un solo criterio.
 */
export function nivelAsesor(
	buckets: readonly number[] | null | undefined,
): NivelAsesor | null {
	const lista = buckets ?? [];
	if (lista.some((b) => b >= 5)) return "especial";
	if (lista.some((b) => b >= 2 && b <= 4)) return "senior";
	if (lista.some((b) => b === 0 || b === 1)) return "junior";
	return null;
}

export const NIVEL_ASESOR_LABEL: Record<NivelAsesor, string> = {
	junior: "Junior",
	senior: "Senior",
	especial: "Especial",
};

/** «Asesor Senior» · «Sin pool asignado» (subtítulo de la tarjeta y del detalle). */
export function etiquetaNivel(nivel: NivelAsesor | null): string {
	return nivel ? `Asesor ${NIVEL_ASESOR_LABEL[nivel]}` : "Sin pool asignado";
}

/* ── Estado ────────────────────────────────────────────────────────────── */

export type EstadoAsesor = "al_dia" | "requiere_atencion" | "ausente";

/** Cumplimiento de agenda (atendidos / planificados) por debajo de esto: requiere atención. */
export const UMBRAL_CUMPLIMIENTO = 80;
/** Contactabilidad (contactos efectivos / gestiones) por debajo de esto: requiere atención. */
export const UMBRAL_CONTACTABILIDAD = 75;

/**
 * Estado del asesor. Criterio (decidido en la fase 2 del supervisor):
 * 1. **Ausente** si tiene una cobertura vigente HOY (`listarCoberturas`, sin
 *    cancelar, con hoy entre `desde` y `hasta`). Gana sobre lo demás.
 * 2. **Requiere atención** si el cumplimiento de agenda del último cierre es
 *    menor al 80 % o la contactabilidad del período es menor al 75 %.
 * 3. **Al día** en cualquier otro caso.
 *
 * `cumplimiento` y `contactabilidad` van en PORCENTAJE (0–100). `null` = sin
 * dato (no tuvo agenda cerrada o no registró gestiones): un dato que falta no
 * marca al asesor como «requiere atención».
 */
export function estadoAsesor({
	ausente,
	cumplimiento,
	contactabilidad,
}: {
	ausente: boolean;
	cumplimiento: number | null | undefined;
	contactabilidad: number | null | undefined;
}): EstadoAsesor {
	if (ausente) return "ausente";
	if (cumplimiento != null && cumplimiento < UMBRAL_CUMPLIMIENTO)
		return "requiere_atencion";
	if (contactabilidad != null && contactabilidad < UMBRAL_CONTACTABILIDAD)
		return "requiere_atencion";
	return "al_dia";
}

export const ESTADO_ASESOR_LABEL: Record<EstadoAsesor, string> = {
	al_dia: "Al día",
	requiere_atencion: "Requiere atención",
	ausente: "Ausente",
};

/**
 * Tono del chip de estado (`CrmPill kind="chip"` de components/ds/cards-credito,
 * el mismo Chip que usa `CardAsesor`): verde = al día, ámbar = requiere
 * atención y ausente (como la variante «Card/Asesor Ausente» del Figma).
 */
export const TONO_ESTADO_ASESOR: Record<
	EstadoAsesor,
	"success" | "warning" | "neutral"
> = {
	al_dia: "success",
	requiere_atencion: "warning",
	ausente: "warning",
};

/**
 * Las mismas clases en crudo (fondo + texto del chip y color del punto), para
 * quien arma su propio chip. Mismo tono que `TONO_ESTADO_ASESOR`.
 */
export const ESTADO_ASESOR_CLASE: Record<
	EstadoAsesor,
	{ chip: string; punto: string }
> = {
	al_dia: {
		chip: "bg-success-subtle text-success-text",
		punto: "bg-success-solid",
	},
	requiere_atencion: {
		chip: "bg-warning-subtle text-warning-text",
		punto: "bg-warning-solid",
	},
	ausente: {
		chip: "bg-warning-subtle text-warning-text",
		punto: "bg-warning-solid",
	},
};

/** Porcentaje con un decimal como máximo; `null` si no hay base. */
export function porcentaje(parte: number, total: number): number | null {
	if (!total) return null;
	return Math.round((parte / total) * 1000) / 10;
}

/* ── Fuentes de las métricas ──────────────────────────────────────────── */

/**
 * Contactabilidad = contactos efectivos / gestiones registradas, de
 * `getHistorialAgendasResumen` (`efectivos` / `total`). Es la MISMA fórmula
 * que la card «Contactabilidad del equipo» del Dashboard del supervisor, para
 * que el supervisor vea un solo criterio en todas sus pantallas.
 * `null` si no registró gestiones en el rango.
 */
export function contactabilidadDeResumen(
	resumen: { efectivos: number; total: number } | null | undefined,
): number | null {
	if (!resumen) return null;
	return porcentaje(resumen.efectivos, resumen.total);
}

/** Días que mide la contactabilidad de «Mi equipo» (hoy incluido). */
export const DIAS_CONTACTABILIDAD = 7;

/** Fecha YYYY-MM-DD desplazada `dias` días (aritmética de calendario, sin zona). */
export function sumarDiasISO(fecha: string, dias: number): string {
	const [y, m, d] = fecha.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/**
 * Rango de la contactabilidad: los últimos `DIAS_CONTACTABILIDAD` días GT
 * (hoy incluido) y el tramo anterior de igual largo, para la variación.
 * `hoy` es YYYY-MM-DD en Guatemala (`hoyGT()` de supervision/formato).
 */
export function rangosContactabilidad(hoy: string) {
	const desde = sumarDiasISO(hoy, -(DIAS_CONTACTABILIDAD - 1));
	return {
		actual: { desde, hasta: hoy },
		anterior: {
			desde: sumarDiasISO(desde, -DIAS_CONTACTABILIDAD),
			hasta: sumarDiasISO(desde, -1),
		},
	};
}

/**
 * Cobertura vigente HOY de un titular (`listarCoberturas` con desde = hasta =
 * hoy devuelve las que se cruzan con hoy; aquí se descartan las canceladas).
 * `titularId` es el `user.id` del CRM (el `userId` de `getAsesoresTraslados`).
 */
export function coberturaVigente<
	C extends {
		titularId: string;
		desde: string;
		hasta: string;
		canceladaEn: unknown;
	},
>(coberturas: readonly C[], userId: string | null, hoy: string): C | null {
	if (!userId) return null;
	return (
		coberturas.find(
			(c) =>
				c.titularId === userId &&
				!c.canceladaEn &&
				c.desde <= hoy &&
				c.hasta >= hoy,
		) ?? null
	);
}

const MESES_CORTOS = [
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

/** «2026-09-30» → «30 sep». */
export function fechaCorta(fecha: string): string {
	const [, m, d] = fecha.split("-").map(Number);
	return `${d} ${MESES_CORTOS[m - 1] ?? ""}`.trim();
}

export const MOTIVO_COBERTURA_LABEL: Record<string, string> = {
	vacaciones: "Vacaciones",
	permiso: "Permiso",
};

/**
 * «Ausente · Vacaciones · vuelve el 30 sep» (línea de la tarjeta ausente).
 * Vuelve el día siguiente al último día de la cobertura (`hasta` es inclusivo).
 */
export function textoAusencia(cobertura: {
	motivo: string;
	hasta: string;
}): string {
	const motivo =
		MOTIVO_COBERTURA_LABEL[cobertura.motivo] ?? cobertura.motivo ?? "";
	return `Ausente · ${motivo} · vuelve el ${fechaCorta(sumarDiasISO(cobertura.hasta, 1))}`;
}
