/**
 * CB-039 · Investigación en redes sociales: lo que el asesor encuentra del
 * cliente (perfil, empleo, ubicación, contactos) mientras lo busca.
 *
 * Cada registro es UNA consulta: qué fuente se miró, qué se encontró, cuándo,
 * quién y las capturas que lo respaldan. Es una bitácora append-only: no se
 * edita ni se borra; si algo estaba mal, se registra otra entrada.
 *
 * No es una gestión con el cliente (no se le contactó), así que NO se escribe
 * en `contactos_cobros`: vive en su propia tarjeta de la ficha.
 *
 * Todo lo de acá es puro (sin DB ni red): lo importan el servidor y la ficha,
 * así el botón se habilita con lo mismo que el servidor va a aceptar.
 */

import { z } from "zod";

// ── Buckets ─────────────────────────────────────────────────────────────────

/**
 * Buckets donde se puede registrar una investigación NUEVA. Es el ÚNICO lugar
 * donde se define: servidor y ficha derivan todo de acá. Para abrirla a otro
 * bucket (p. ej. B4) basta sumar el número al arreglo.
 * Hoy B2 y B3, los que trabaja el Asesor Sr (decisión del 2026-10-01).
 * Ver el historial no mira el bucket: lo investigado sigue siendo válido
 * aunque el crédito se haya movido después.
 */
export const BUCKETS_INVESTIGACION: readonly number[] = [2, 3];

export function investigacionPermitidaEnBucket(bucket: number | null): boolean {
	return bucket !== null && BUCKETS_INVESTIGACION.includes(bucket);
}

/** "B2", "B2 y B3", "B2, B3 y B4". */
export function textoBucketsInvestigacion(
	buckets: readonly number[] = BUCKETS_INVESTIGACION,
): string {
	const nombres = [...buckets].sort((a, b) => a - b).map((b) => `B${b}`);
	if (nombres.length <= 1) return nombres.join("");
	return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

/** Por qué no se puede registrar una investigación nueva (null = sí se puede). */
export function motivoBloqueoInvestigacion(
	bucket: number | null,
	prefijo?: string | null,
): string | null {
	if (investigacionPermitidaEnBucket(bucket)) return null;
	const disponible = `Disponible en ${textoBucketsInvestigacion()}.`;
	const donde = prefijo ?? (bucket === null ? null : `B${bucket}`);
	return donde
		? `${disponible} Este caso está en ${donde}.`
		: `${disponible} El crédito no tiene bucket.`;
}

// ── Catálogos ───────────────────────────────────────────────────────────────

/** Catálogo provisional: text validado acá, no enum, para cambiarlo sin migración. */
export const FUENTES_INVESTIGACION = {
	facebook: "Facebook",
	instagram: "Instagram",
	tiktok: "TikTok",
	linkedin: "LinkedIn",
	x: "X (Twitter)",
	threads: "Threads",
	google: "Google / buscador",
	otra: "Otra",
} as const;
export type FuenteInvestigacion = keyof typeof FUENTES_INVESTIGACION;
export const CLAVES_FUENTE_INVESTIGACION = Object.keys(
	FUENTES_INVESTIGACION,
) as [FuenteInvestigacion, ...FuenteInvestigacion[]];

export function etiquetaFuenteInvestigacion(
	clave: string,
	fuenteOtra?: string | null,
): string {
	if (clave === "otra" && fuenteOtra) return fuenteOtra;
	return (FUENTES_INVESTIGACION as Record<string, string>)[clave] ?? clave;
}

export const RESULTADOS_INVESTIGACION = {
	con_hallazgos: "Se encontró información",
	sin_hallazgos: "No se encontró nada",
} as const;
export type ResultadoInvestigacion = keyof typeof RESULTADOS_INVESTIGACION;
export const CLAVES_RESULTADO_INVESTIGACION = Object.keys(
	RESULTADOS_INVESTIGACION,
) as [ResultadoInvestigacion, ...ResultadoInvestigacion[]];

export function etiquetaResultadoInvestigacion(clave: string): string {
	return (RESULTADOS_INVESTIGACION as Record<string, string>)[clave] ?? clave;
}

// ── Evidencia ───────────────────────────────────────────────────────────────

/** Capturas por investigación. */
export const MAX_EVIDENCIAS_INVESTIGACION = 10;

/** Capturas de pantalla (imagen) o un PDF guardado de la página. */
export const MIME_EVIDENCIA_INVESTIGACION = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"application/pdf",
] as const;

export const evidenciaInvestigacionSchema = z.object({
	key: z.string().min(1).max(500),
	nombreArchivo: z.string().trim().min(1).max(255),
});

// ── Formulario ──────────────────────────────────────────────────────────────

const textoOpcional = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.optional()
		.transform((v) => (v ? v : undefined));

export const MIN_CARACTERES_HALLAZGOS = 10;

export const registrarInvestigacionSchema = z.object({
	casoCobroId: z.string().uuid(),
	fuente: z.enum(CLAVES_FUENTE_INVESTIGACION),
	fuenteOtra: textoOpcional(100),
	enlacePerfil: textoOpcional(500),
	resultado: z.enum(CLAVES_RESULTADO_INVESTIGACION),
	hallazgos: z
		.string()
		.trim()
		.min(
			MIN_CARACTERES_HALLAZGOS,
			`Contá qué encontraste (mínimo ${MIN_CARACTERES_HALLAZGOS} caracteres)`,
		)
		.max(4000),
	fechaInvestigacion: z.coerce.date(),
	evidencias: z
		.array(evidenciaInvestigacionSchema)
		.max(
			MAX_EVIDENCIAS_INVESTIGACION,
			`Hasta ${MAX_EVIDENCIAS_INVESTIGACION} archivos por investigación`,
		)
		.default([]),
});
export type RegistrarInvestigacion = z.infer<
	typeof registrarInvestigacionSchema
>;
export type RegistrarInvestigacionInput = z.input<
	typeof registrarInvestigacionSchema
>;

/** Unos minutos de gracia por relojes desfasados entre el navegador y el servidor. */
const TOLERANCIA_RELOJ_MS = 10 * 60_000;
const DIA_MS = 86_400_000;
/** Se registra el mismo día o poco después, no un mes más tarde. */
export const DIAS_MAXIMOS_REGISTRO_TARDIO = 30;

function esUrlHttp(texto: string): boolean {
	try {
		const url = new URL(texto);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

/**
 * Reglas que zod por sí solo no ve. Devuelve el primer problema en texto para
 * el asesor, o null si el formulario está completo.
 */
export function erroresRegistroInvestigacion(
	v: RegistrarInvestigacion,
	ahora: Date = new Date(),
): string | null {
	const t = v.fechaInvestigacion.getTime();
	if (Number.isNaN(t)) return "Falta la fecha de la investigación.";
	if (t > ahora.getTime() + TOLERANCIA_RELOJ_MS) {
		return "La investigación ya se hizo: la fecha no puede ser futura.";
	}
	if (t < ahora.getTime() - DIAS_MAXIMOS_REGISTRO_TARDIO * DIA_MS) {
		return `La investigación es de hace más de ${DIAS_MAXIMOS_REGISTRO_TARDIO} días: revisá la fecha.`;
	}

	if (v.fuente === "otra") {
		if (!v.fuenteOtra)
			return "Marcaste «Otra»: escribí qué fuente consultaste.";
	} else if (v.fuenteOtra) {
		return "El nombre de otra fuente solo aplica si elegís «Otra».";
	}

	if (v.enlacePerfil && !esUrlHttp(v.enlacePerfil)) {
		return "El enlace del perfil tiene que empezar con http:// o https://.";
	}

	const keys = v.evidencias.map((e) => e.key);
	if (new Set(keys).size !== keys.length) return "Hay archivos repetidos.";
	return null;
}
