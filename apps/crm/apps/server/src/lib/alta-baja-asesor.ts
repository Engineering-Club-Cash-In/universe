/**
 * Alta y baja de asesor desde «Mi equipo» (Figma «05 · Alta y Baja de Asesor»).
 * Reglas y textos PUROS (sin base ni red): los usan el servicio
 * (services/alta-baja-asesor.ts) y el web (los modales recalculan la cartera
 * inicial al mover «Créditos a asignar» sin volver al servidor).
 *
 * - Alta: el nuevo asesor recibe créditos de los asesores de su nivel con más
 *   carga («llenado desde arriba»: se quita siempre al que más tiene), hasta
 *   equilibrar al equipo.
 * - Baja: textos del motivo y el resumen del reparto que previsualiza cartera
 *   (traslado `redistribucion` por capacidad con `desactivarOrigen`).
 */

import type { PreviewTraslado } from "../types/traslados-cobros";
import type { NivelAsesor } from "./nivel-asesor";

/* ── Nivel (rol) del asesor ─────────────────────────────────────────────── */

export const ROLES_ASESOR = [
	"junior",
	"senior",
	"especial",
] as const satisfies readonly NivelAsesor[];
export type RolAsesor = (typeof ROLES_ASESOR)[number];

export const ETIQUETA_ROL_ASESOR: Record<RolAsesor, string> = {
	junior: "Junior",
	senior: "Senior",
	especial: "Especial",
};

/**
 * Pool de cada nivel: el mismo criterio de `nivelPorBuckets` (M6), al revés.
 * Junior B0–B1, Senior B2–B4, Especial B5.
 */
export const BUCKETS_POR_ROL: Record<RolAsesor, readonly number[]> = {
	junior: [0, 1],
	senior: [2, 3, 4],
	especial: [5],
};

/** Tope de la reasignación en bloque (S6): la cartera inicial va en un solo lote. */
export const MAX_CARTERA_INICIAL = 200;

/** Capacidad de una fila nueva del pool cuando el equipo no da referencia. */
export const CAPACIDAD_POR_DEFECTO = 300;

/** Los usuarios del CRM (menos los socios) son del dominio de la empresa. */
export const DOMINIO_CORREO_CRM = "@clubcashin.com";

export function normalizarCorreo(correo: string): string {
	return correo.trim().toLowerCase();
}

/* ── Alta: cartera inicial ──────────────────────────────────────────────── */

export type MiembroEquipo = {
	asesorId: number;
	nombre: string;
	/** Créditos que lleva hoy en los buckets del nivel. */
	carga: number;
};

export type RecomendacionCartera = {
	/** Créditos del equipo del nivel (en sus buckets). */
	total: number;
	/** Asesores del nivel con los que se equilibra. */
	asesores: number;
	/** Lo que deja a todos parejos: total ÷ (asesores + 1). */
	recomendado: number;
	/** Rango sugerido: desde la mitad (por ser nuevo) hasta un 30 % más. */
	rango: { min: number; max: number };
	/** Lo más que se puede pedir: la cartera del equipo y el tope del lote. */
	tope: number;
};

export function recomendarCarteraInicial(
	equipo: readonly MiembroEquipo[],
): RecomendacionCartera {
	const total = equipo.reduce((t, m) => t + Math.max(0, m.carga), 0);
	const tope = Math.min(total, MAX_CARTERA_INICIAL);
	if (equipo.length === 0 || total === 0) {
		return {
			total,
			asesores: equipo.length,
			recomendado: 0,
			rango: { min: 0, max: 0 },
			tope,
		};
	}
	const recomendado = Math.min(tope, Math.floor(total / (equipo.length + 1)));
	return {
		total,
		asesores: equipo.length,
		recomendado,
		rango: {
			min: Math.floor(recomendado / 2),
			max: Math.min(tope, Math.max(recomendado, Math.round(recomendado * 1.3))),
		},
		tope,
	};
}

export type DonanteCartera = {
	asesorId: number;
	nombre: string;
	antes: number;
	despues: number;
	/** Créditos que salen de su cartera hacia el nuevo asesor. */
	quitar: number;
};

export type PlanCarteraInicial = {
	/** Créditos que recibe el nuevo asesor (lo pedido, acotado al tope). */
	asignados: number;
	/** Solo quienes ceden algo, de quien más cede a quien menos. */
	donantes: DonanteCartera[];
	/** Carga del resto del equipo después de asignar (`null` sin equipo). */
	resto: { min: number; max: number } | null;
	/** El resto del equipo queda a 2 créditos o menos entre sí. */
	equilibrado: boolean;
};

/**
 * De dónde salen `n` créditos para el nuevo asesor: uno a uno, siempre del
 * asesor que más tiene en ese momento (a igual carga, el de menor id). Así se
 * empareja al equipo desde arriba y nadie queda por debajo de los demás.
 */
export function planCarteraInicial(
	equipo: readonly MiembroEquipo[],
	n: number,
): PlanCarteraInicial {
	const actual = equipo.map((m) => ({
		...m,
		antes: Math.max(0, m.carga),
		despues: Math.max(0, m.carga),
	}));
	const pedidos = Math.max(
		0,
		Math.min(Math.floor(n), recomendarCarteraInicial(equipo).tope),
	);
	let asignados = 0;
	for (; asignados < pedidos; asignados++) {
		let mayor: (typeof actual)[number] | undefined;
		for (const m of actual) {
			if (
				!mayor ||
				m.despues > mayor.despues ||
				(m.despues === mayor.despues && m.asesorId < mayor.asesorId)
			)
				mayor = m;
		}
		if (!mayor || mayor.despues <= 0) break;
		mayor.despues -= 1;
	}
	const donantes = actual
		.map((m) => ({
			asesorId: m.asesorId,
			nombre: m.nombre,
			antes: m.antes,
			despues: m.despues,
			quitar: m.antes - m.despues,
		}))
		.filter((d) => d.quitar > 0)
		.sort(
			(a, b) =>
				b.quitar - a.quitar ||
				b.antes - a.antes ||
				a.nombre.localeCompare(b.nombre, "es"),
		);
	const resto = actual.length
		? {
				min: Math.min(...actual.map((m) => m.despues)),
				max: Math.max(...actual.map((m) => m.despues)),
			}
		: null;
	return {
		asignados,
		donantes,
		resto,
		equilibrado: !!resto && resto.max - resto.min <= 2,
	};
}

/**
 * Qué créditos cede un asesor: `k` repartidos entre sus buckets en proporción a
 * lo que tiene en cada uno (resto mayor; a igual resto, el bucket más bajo), y
 * dentro de cada bucket los más recientes (mayor id). Determinístico: el mismo
 * reparto da los mismos créditos.
 */
export function elegirCreditosDonante(
	creditos: readonly { creditoId: number; bucket: number }[],
	k: number,
	excluir: ReadonlySet<number> = new Set(),
): number[] {
	const disponibles = creditos.filter((c) => !excluir.has(c.creditoId));
	const cuantos = Math.max(0, Math.min(Math.floor(k), disponibles.length));
	if (cuantos === 0) return [];
	const porBucket = new Map<number, number[]>();
	for (const c of disponibles) {
		porBucket.set(c.bucket, [...(porBucket.get(c.bucket) ?? []), c.creditoId]);
	}
	const grupos = [...porBucket.entries()]
		.map(([bucket, ids]) => ({
			bucket,
			ids: [...ids].sort((a, b) => b - a),
			exacto: (ids.length * cuantos) / disponibles.length,
		}))
		.map((g) => ({ ...g, cupo: Math.floor(g.exacto) }));
	let faltan = cuantos - grupos.reduce((t, g) => t + g.cupo, 0);
	for (const g of [...grupos].sort(
		(a, b) => b.exacto - b.cupo - (a.exacto - a.cupo) || a.bucket - b.bucket,
	)) {
		if (faltan <= 0) break;
		if (g.cupo < g.ids.length) {
			g.cupo += 1;
			faltan -= 1;
		}
	}
	return grupos.flatMap((g) => g.ids.slice(0, g.cupo)).sort((a, b) => a - b);
}

/**
 * Capacidad de cada bucket del pool nuevo: la que más se repite en el equipo
 * para ese bucket (a igual frecuencia, la mayor); sin referencia, 300.
 */
export function capacidadSugeridaPorBucket(
	filas: readonly { bucket: number; capacidad: number }[],
	buckets: readonly number[],
): Record<string, number> {
	const resultado: Record<string, number> = {};
	for (const bucket of buckets) {
		const veces = new Map<number, number>();
		for (const f of filas) {
			if (f.bucket !== bucket || !(f.capacidad > 0)) continue;
			veces.set(f.capacidad, (veces.get(f.capacidad) ?? 0) + 1);
		}
		let elegida = CAPACIDAD_POR_DEFECTO;
		let mas = 0;
		for (const [capacidad, n] of veces) {
			if (n > mas || (n === mas && capacidad > elegida)) {
				elegida = capacidad;
				mas = n;
			}
		}
		resultado[String(bucket)] = elegida;
	}
	return resultado;
}

/* ── Alta: usuario del CRM ──────────────────────────────────────────────── */

export type UsuarioCrmAlta = {
	id: string;
	name: string;
	role: string;
	banned: boolean | null;
	banReason: string | null;
};

export type UsuarioAlta =
	/** Sin usuario: se crea con rol Cobros (entra con su cuenta de Google). */
	| { estado: "nuevo" }
	/** Ya es de cobros y está habilitado: se vincula por su correo. */
	| { estado: "existente"; userId: string; nombre: string }
	/** De cobros, suspendido: se vuelve a habilitar. */
	| { estado: "reactivar"; userId: string; nombre: string };

/**
 * Qué hacer con el usuario del CRM del correo que se da de alta. Supervisión y
 * administración crean usuarios SOLO con rol Cobros (y del dominio de la
 * empresa). Un usuario suspendido por una baja de cobros lo puede habilitar
 * supervisión; uno suspendido por administración, solo un administrador. Un
 * usuario con otro rol no se toca: cambiarle el rol es de Administración ›
 * Usuarios (perdería los accesos que tiene).
 */
export function evaluarUsuarioAlta(
	u: UsuarioCrmAlta | null,
	esAdmin: boolean,
): { usuario: UsuarioAlta | null; bloqueo: string | null } {
	if (!u) return { usuario: { estado: "nuevo" }, bloqueo: null };
	if (u.role !== "cobros") {
		return {
			usuario: null,
			bloqueo: `El correo ya pertenece a ${u.name}, usuario del CRM con otro rol (${u.role}). Un administrador debe cambiarle el rol a Cobros en Administración › Usuarios antes de darlo de alta.`,
		};
	}
	if (u.banned) {
		return esAdmin || suspendidoPorBaja(u.banReason)
			? {
					usuario: { estado: "reactivar", userId: u.id, nombre: u.name },
					bloqueo: null,
				}
			: {
					usuario: null,
					bloqueo: `El usuario de ${u.name} está suspendido por administración. Un administrador debe habilitarlo antes de darlo de alta.`,
				};
	}
	return {
		usuario: { estado: "existente", userId: u.id, nombre: u.name },
		bloqueo: null,
	};
}

/* ── Baja ───────────────────────────────────────────────────────────────── */

export const MOTIVOS_BAJA = [
	"renuncia",
	"despido",
	"fin_contrato",
	"otro",
] as const;
export type MotivoBaja = (typeof MOTIVOS_BAJA)[number];

export const ETIQUETA_MOTIVO_BAJA: Record<MotivoBaja, string> = {
	renuncia: "Renuncia voluntaria",
	despido: "Despido",
	fin_contrato: "Fin de contrato",
	otro: "Otro motivo",
};

/**
 * Prefijo del motivo de toda baja: la bitácora la reconoce por él
 * (`esBajaDeAsesor`) y el alta lo usa para saber que un usuario del CRM se
 * suspendió por una baja (y no por administración).
 */
export const PREFIJO_MOTIVO_BAJA = "Baja de asesor";

/** «2026-10-30» → «30/10/2026». */
export function fechaDMA(fecha: string): string {
	const [y, m, d] = fecha.split("-");
	return y && m && d ? `${d}/${m}/${y}` : fecha;
}

/**
 * Motivo que queda en el traslado, en la bitácora y en la suspensión del
 * usuario: «Baja de asesor: Renuncia voluntaria · último día de trabajo
 * 30/10/2026 · <detalle>». Siempre el mismo texto para los mismos datos: la
 * confirmación lo compara con el que se previsualizó.
 */
export function motivoDeLaBaja(params: {
	motivo: MotivoBaja;
	ultimoDia: string;
	detalle?: string | null;
}): string {
	const detalle = params.detalle?.trim().replace(/\s+/g, " ") || null;
	const principal =
		params.motivo === "otro"
			? (detalle ?? ETIQUETA_MOTIVO_BAJA.otro)
			: ETIQUETA_MOTIVO_BAJA[params.motivo];
	const extra = params.motivo !== "otro" && detalle ? ` · ${detalle}` : "";
	return `${PREFIJO_MOTIVO_BAJA}: ${principal} · último día de trabajo ${fechaDMA(params.ultimoDia)}${extra}`;
}

/** ¿La suspensión del usuario del CRM vino de una baja de cobros? */
export function suspendidoPorBaja(banReason: string | null | undefined) {
	return (banReason ?? "").trim().startsWith(PREFIJO_MOTIVO_BAJA);
}

export type ReceptorBaja = {
	asesorId: number;
	nombre: string;
	antes: number;
	despues: number;
	recibe: number;
	/** Capacidad sumada de sus buckets (0 = sin dato). */
	capacidad: number;
};

export type ResumenRedistribucion = {
	/** Créditos del asesor que se da de baja. */
	total: number;
	/** Los que ya tienen destino en la previsualización. */
	repartidos: number;
	/** Por bucket operativo (los que se reparten por el pool). */
	composicion: { bucket: number; cantidad: number }[];
	/** Cuentas fuera de cobro (canceladas, caídas…): van a un responsable. */
	especiales: { cantidad: number; responsableId: number | null };
	/** Quienes reciben, del que más recibe al que menos. */
	receptores: ReceptorBaja[];
	/** Carga de los receptores después del reparto (`null` si nadie recibe). */
	rangoDespues: { min: number; max: number } | null;
	/** Sin un asesor que cubra su bucket: no se puede confirmar. */
	bloqueados: number;
	/** Activos sin bucket operativo: cartera rechaza confirmar. */
	sinBucket: number;
};

/** Resumen del reparto previsualizado por cartera para la pantalla de la baja. */
export function resumenRedistribucion(
	preview: Pick<
		PreviewTraslado,
		"asignaciones" | "bloqueos" | "excluidos" | "carga"
	>,
	asesorOrigenId: number,
): ResumenRedistribucion {
	const porBucket = new Map<number, number>();
	for (const a of preview.asignaciones) {
		if (a.bucket === null) continue;
		porBucket.set(a.bucket, (porBucket.get(a.bucket) ?? 0) + 1);
	}
	for (const b of preview.bloqueos) {
		porBucket.set(b.bucket, (porBucket.get(b.bucket) ?? 0) + 1);
	}
	const especiales = preview.asignaciones.filter((a) => a.bucket === null);
	const receptores = new Map<number, ReceptorBaja>();
	for (const c of preview.carga) {
		if (c.asesorId === asesorOrigenId) continue;
		const r = receptores.get(c.asesorId) ?? {
			asesorId: c.asesorId,
			nombre: c.nombre,
			antes: 0,
			despues: 0,
			recibe: 0,
			capacidad: 0,
		};
		r.antes += c.antes;
		r.despues += c.despues;
		r.capacidad += Number(c.capacidad) || 0;
		receptores.set(c.asesorId, r);
	}
	const lista = [...receptores.values()]
		.map((r) => ({ ...r, recibe: r.despues - r.antes }))
		.filter((r) => r.recibe > 0)
		.sort(
			(a, b) => b.recibe - a.recibe || a.nombre.localeCompare(b.nombre, "es"),
		);
	return {
		total:
			preview.asignaciones.length +
			preview.bloqueos.length +
			preview.excluidos.length,
		repartidos: preview.asignaciones.length,
		composicion: [...porBucket.entries()]
			.map(([bucket, cantidad]) => ({ bucket, cantidad }))
			.sort((a, b) => a.bucket - b.bucket),
		especiales: {
			cantidad: especiales.length,
			responsableId: especiales[0]?.asesorNuevoId ?? null,
		},
		receptores: lista,
		rangoDespues: lista.length
			? {
					min: Math.min(...lista.map((r) => r.despues)),
					max: Math.max(...lista.map((r) => r.despues)),
				}
			: null,
		bloqueados: preview.bloqueos.length,
		sinBucket: preview.excluidos.length,
	};
}

/**
 * Responsable sugerido de las cuentas fuera de cobro de quien se da de baja: el
 * asesor de su mismo nivel con menos carga (a igualdad, el de menor id); si no
 * hay nadie de su nivel, el de menos carga del equipo.
 */
export function sugerirResponsableEspeciales(
	candidatos: readonly {
		asesorId: number;
		nivel: NivelAsesor | null;
		carga: number;
	}[],
	nivel: NivelAsesor | null,
): number | null {
	const menor = (lista: typeof candidatos) =>
		[...lista].sort((a, b) => a.carga - b.carga || a.asesorId - b.asesorId)[0]
			?.asesorId ?? null;
	return (
		menor(candidatos.filter((c) => nivel && c.nivel === nivel)) ??
		menor(candidatos)
	);
}
