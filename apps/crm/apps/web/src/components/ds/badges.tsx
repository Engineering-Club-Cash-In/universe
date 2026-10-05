import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Badges de cobros — Figma "03 · Componentes CRM".
 *
 *   BucketBadge   → "Cartera › Badge/Bucket" (86:919) · sección "Badges · Bucket (B0–B5)"
 *                   Bucket=B0…B5 → `bucket`; Formato=Compacta|Completa → `formato` (default "Compacta").
 *                   Etapa operativa del proceso de cobranza, independiente de la mora.
 *   MoraBadge     → "Cartera › Badge/Mora" (85:892) · sección "Badges · Estado de Mora"
 *                   Mora=AlDia|Mora30|Mora60|Mora90|Mora120 → `mora`.
 *   PromesaBadge  → "Badge/Promesa" (85:905)
 *                   Promesa=Pendiente|Cumplida|Incumplida|Vigente|Cancelada → `promesa`.
 *   ConvenioBadge → "Badge/Convenio" (85:917)
 *                   Convenio=Activo|Finalizado|Incumplido → `convenio`.
 *   AccionBadge   → "Badge/Accion" (85:930)
 *                   Acción=Llamada|WhatsApp|SMS|Correo|Visita → `accion`.
 *   GestionBadge  → "Badge/Gestion" (85:944)
 *                   Gestión=Promesa|Convenio|Reestructura|Apagado|Recuperacion → `gestion`.
 *
 * Todos aceptan `children` para cambiar el texto (por defecto, el de Figma) y las
 * props de <span>. Son de presentación: no consultan el servidor.
 *
 * Desvíos/notas:
 *  - B2 y B4 "Completa": Figma liga el texto a status/warning/text y status/danger/text
 *    (no a bucket/b2/fg y bucket/b4/fg); se respeta. Sus fondos (status/…/subtle) valen
 *    lo mismo que bucket/b2/bg y bucket/b4/bg en ambos modos, así que se usan esos.
 *  - Promesa=Cancelada usa neutral/100 → `bg-muted` (neutral/100 en claro, carbon/800 en oscuro).
 *  - Gestión=Apagado usa primitivos neutral/200 + neutral/700 → se agregan sus `dark:`.
 *  - Texto 12/15.12 (interlineado auto de Plus Jakarta = 126%) → `text-xs leading-[1.26]`.
 */

/* ── Piezas comunes ─────────────────────────────────────────────────────────── */

/** Pill de 23px: p 4/12, gap 6, radio full, texto 600 12/15.12. */
const pillBase =
	"inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 font-semibold text-xs leading-[1.26]";

/** Punto de 7px; toma el color del texto (en Figma siempre coincide). */
function Dot() {
	return (
		<span aria-hidden className="size-1.75 shrink-0 rounded-full bg-current" />
	);
}

type SpanProps = Omit<React.ComponentProps<"span">, "children"> & {
	/** Texto del badge; por defecto, el de Figma para la variante. */
	children?: React.ReactNode;
};

/* ── Badge/Bucket ───────────────────────────────────────────────────────────── */

export type Bucket = "B0" | "B1" | "B2" | "B3" | "B4" | "B5";
export type BucketFormato = "Compacta" | "Completa";

export const BUCKET_LABEL: Record<Bucket, string> = {
	B0: "Cartera Sana",
	B1: "Alerta Temprana",
	B2: "Gestión Activa",
	B3: "Rescate",
	B4: "Pre Jurídico",
	B5: "Jurídico",
};

const bucketTone: Record<Bucket, { bg: string; fg: string; solid: string }> = {
	B0: { bg: "bg-bucket-b0-bg", fg: "text-bucket-b0-fg", solid: "bg-bucket-b0" },
	B1: { bg: "bg-bucket-b1-bg", fg: "text-bucket-b1-fg", solid: "bg-bucket-b1" },
	B2: { bg: "bg-bucket-b2-bg", fg: "text-warning-text", solid: "bg-bucket-b2" },
	B3: { bg: "bg-bucket-b3-bg", fg: "text-bucket-b3-fg", solid: "bg-bucket-b3" },
	B4: { bg: "bg-bucket-b4-bg", fg: "text-danger-text", solid: "bg-bucket-b4" },
	B5: { bg: "bg-bucket-b5-bg", fg: "text-bucket-b5-fg", solid: "bg-bucket-b5" },
};

export function BucketBadge({
	bucket,
	formato = "Compacta",
	children,
	className,
	...props
}: SpanProps & { bucket: Bucket; formato?: BucketFormato }) {
	const tone = bucketTone[bucket];
	const completa = formato === "Completa";
	return (
		<span
			data-slot="bucket-badge"
			title={completa ? undefined : `${bucket} · ${BUCKET_LABEL[bucket]}`}
			className={cn(
				"inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md py-1 font-semibold text-xs leading-[1.26]",
				completa ? "pr-3 pl-2" : "px-2",
				tone.bg,
				tone.fg,
				className,
			)}
			{...props}
		>
			<span
				className={cn(
					"inline-flex w-6 shrink-0 items-center justify-center rounded-md font-bold text-on-solid",
					tone.solid,
				)}
			>
				{bucket}
			</span>
			{completa ? (children ?? BUCKET_LABEL[bucket]) : null}
		</span>
	);
}

/* ── Badge/Mora ─────────────────────────────────────────────────────────────── */

export type Mora = "AlDia" | "Mora30" | "Mora60" | "Mora90" | "Mora120";

export const MORA_LABEL: Record<Mora, string> = {
	AlDia: "Al Día",
	Mora30: "Mora 30",
	Mora60: "Mora 60",
	Mora90: "Mora 90",
	Mora120: "Mora 120+",
};

const moraTone: Record<Mora, string> = {
	AlDia: "bg-success-subtle text-success-text",
	Mora30: "bg-warning-subtle text-warning-text",
	Mora60: "bg-bucket-b3-bg text-bucket-b3-fg",
	Mora90: "bg-danger-subtle text-danger-text",
	Mora120: "bg-bucket-b5-bg text-bucket-b5-fg",
};

export function MoraBadge({
	mora,
	children,
	className,
	...props
}: SpanProps & { mora: Mora }) {
	return (
		<span
			data-slot="mora-badge"
			className={cn(pillBase, moraTone[mora], className)}
			{...props}
		>
			<Dot />
			{children ?? MORA_LABEL[mora]}
		</span>
	);
}

/* ── Badge/Promesa ──────────────────────────────────────────────────────────── */

export type Promesa =
	| "Pendiente"
	| "Cumplida"
	| "Incumplida"
	| "Vigente"
	| "Cancelada";

const promesaTone: Record<Promesa, string> = {
	Pendiente: "bg-warning-subtle text-warning-text",
	Cumplida: "bg-success-subtle text-success-text",
	Incumplida: "bg-danger-subtle text-danger-text",
	Vigente: "bg-brand-subtle text-brand",
	Cancelada: "bg-muted text-fg-secondary",
};

export function PromesaBadge({
	promesa,
	children,
	className,
	...props
}: SpanProps & { promesa: Promesa }) {
	return (
		<span
			data-slot="promesa-badge"
			className={cn(pillBase, promesaTone[promesa], className)}
			{...props}
		>
			<Dot />
			{children ?? promesa}
		</span>
	);
}

/* ── Badge/Convenio ─────────────────────────────────────────────────────────── */

export type Convenio = "Activo" | "Finalizado" | "Incumplido";

const convenioTone: Record<Convenio, string> = {
	Activo: "bg-info-subtle text-info-text",
	Finalizado: "bg-success-subtle text-success-text",
	Incumplido: "bg-danger-subtle text-danger-text",
};

export function ConvenioBadge({
	convenio,
	children,
	className,
	...props
}: SpanProps & { convenio: Convenio }) {
	return (
		<span
			data-slot="convenio-badge"
			className={cn(pillBase, convenioTone[convenio], className)}
			{...props}
		>
			<Dot />
			{children ?? convenio}
		</span>
	);
}

/* ── Badge/Accion ───────────────────────────────────────────────────────────── */

export type Accion = "Llamada" | "WhatsApp" | "SMS" | "Correo" | "Visita";

const accionTone: Record<Accion, string> = {
	Llamada: "bg-bucket-b0-bg text-bucket-b0-fg",
	WhatsApp: "bg-success-alt-bg text-success-alt-fg",
	SMS: "bg-info-subtle text-info-text",
	Correo: "bg-violet-bg text-violet-fg",
	Visita: "bg-accent-alt text-bucket-b3-fg",
};

export function AccionBadge({
	accion,
	children,
	className,
	...props
}: SpanProps & { accion: Accion }) {
	return (
		<span
			data-slot="accion-badge"
			className={cn(pillBase, accionTone[accion], className)}
			{...props}
		>
			{children ?? accion}
		</span>
	);
}

/* ── Badge/Gestion ──────────────────────────────────────────────────────────── */

export type Gestion =
	| "Promesa"
	| "Convenio"
	| "Reestructura"
	| "Apagado"
	| "Recuperacion";

export const GESTION_LABEL: Record<Gestion, string> = {
	Promesa: "Promesa",
	Convenio: "Convenio",
	Reestructura: "Reestructura",
	Apagado: "Apagado",
	Recuperacion: "Recuperación",
};

const gestionTone: Record<Gestion, string> = {
	Promesa: "bg-warning-subtle text-warning-text",
	Convenio: "bg-info-subtle text-info-text",
	Reestructura: "bg-violet-bg text-violet-fg",
	Apagado:
		"bg-cci-neutral-200 text-cci-neutral-700 dark:bg-cci-carbon-750 dark:text-cci-neutral-300",
	Recuperacion: "bg-success-subtle text-success-text",
};

export function GestionBadge({
	gestion,
	children,
	className,
	...props
}: SpanProps & { gestion: Gestion }) {
	return (
		<span
			data-slot="gestion-badge"
			className={cn(pillBase, gestionTone[gestion], className)}
			{...props}
		>
			{children ?? GESTION_LABEL[gestion]}
		</span>
	);
}
