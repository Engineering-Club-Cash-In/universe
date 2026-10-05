import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Chips de la tabla de Cartera — Figma "03 · Componentes CRM › Cartera".
 *
 *   EstadoGestion → "Cartera/EstadoGestión" (3411:1431)
 *                   Estado=Sin acuerdo|Convenio vigente|Promesa incumplida → `estado`.
 *   AsesorChip    → "Cartera/Asesor" (3434:1423)
 *                   Nombre → `nombre`; Iniciales → `iniciales` (si falta, se toman del nombre).
 *   TipoCartera   → "Cartera/Tipo" (3480:1481)
 *                   Tipo=Documentos|Entrega|Rebaja|Convenio|Crítica → `tipo`;
 *                   Etiqueta → `children` (por defecto, el nombre del tipo).
 *   FilterChip    → "Cartera/FilterChip" (3465:1481)
 *                   Estado=Default → por defecto; Hover → :hover; Seleccionado → `seleccionado`.
 *                   Etiqueta → `children` (+ `cantidad` opcional: "Todos · 312"). Es un <button>.
 *
 * Desvíos/notas:
 *  - Radios sueltos de Figma: r:100/999 → `rounded-full`, r:8 → `rounded-md`, r:12 del avatar
 *    (alto 24) → `rounded-full`.
 *  - FilterChip Hover tiene borde interior de 1px: el chip lleva siempre `border-transparent`
 *    y descuenta 1px del padding (`px-2.75 py-0.75`) para que no cambie de tamaño.
 *  - neutral/100 (FilterChip Default) → `bg-muted` (carbon/800 en oscuro).
 *  - Tipografía sin estilo: 13/16.38 → `text-[13px] leading-[1.26]`, 12/15.12 →
 *    `text-xs leading-[1.26]`, 9/11.34 → `text-[9px] leading-[1.26]`.
 */

/* ── Cartera/EstadoGestión ──────────────────────────────────────────────────── */

export type EstadoGestionValor =
	| "Sin acuerdo"
	| "Convenio vigente"
	| "Promesa incumplida";

const estadoGestionTone: Record<
	EstadoGestionValor,
	{ chip: string; punto: string }
> = {
	"Sin acuerdo": { chip: "text-fg-secondary", punto: "bg-fg-tertiary" },
	"Convenio vigente": {
		chip: "bg-success-subtle text-success-text",
		punto: "bg-success-solid",
	},
	"Promesa incumplida": {
		chip: "bg-danger-subtle text-danger-text",
		punto: "bg-danger-solid",
	},
};

export function EstadoGestion({
	estado,
	children,
	className,
	...props
}: Omit<React.ComponentProps<"span">, "children"> & {
	estado: EstadoGestionValor;
	children?: React.ReactNode;
}) {
	const tone = estadoGestionTone[estado];
	return (
		<span
			data-slot="estado-gestion"
			className={cn(
				"inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full py-1.25 pr-3 pl-2.5 font-semibold text-[13px] leading-[1.26]",
				tone.chip,
				className,
			)}
			{...props}
		>
			<span
				aria-hidden
				className={cn("size-1.75 shrink-0 rounded-full", tone.punto)}
			/>
			{children ?? estado}
		</span>
	);
}

/* ── Cartera/Asesor ─────────────────────────────────────────────────────────── */

function inicialesDe(nombre: string) {
	return nombre
		.replace(/\./g, " ")
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((p) => p[0]?.toUpperCase() ?? "")
		.join("");
}

export function AsesorChip({
	nombre,
	iniciales,
	className,
	...props
}: Omit<React.ComponentProps<"span">, "children"> & {
	/** Nombre corto del asesor: "J. Pérez". */
	nombre: string;
	/** Iniciales del avatar; por defecto, las de `nombre`. */
	iniciales?: string;
}) {
	return (
		<span
			data-slot="asesor-chip"
			className={cn("inline-flex min-w-0 items-center gap-2", className)}
			{...props}
		>
			<span
				aria-hidden
				className="inline-flex h-6 shrink-0 items-center justify-center rounded-full bg-line-subtle px-2 font-semibold text-[9px] text-fg-secondary leading-[1.26]"
			>
				{iniciales ?? inicialesDe(nombre)}
			</span>
			<span className="truncate font-medium text-[13px] text-fg-secondary leading-[1.26]">
				{nombre}
			</span>
		</span>
	);
}

/* ── Cartera/Tipo ───────────────────────────────────────────────────────────── */

export type TipoCarteraValor =
	| "Documentos"
	| "Entrega"
	| "Rebaja"
	| "Convenio"
	| "Crítica";

const tipoTone: Record<TipoCarteraValor, string> = {
	Documentos: "bg-line-subtle text-fg-secondary",
	Entrega: "bg-info-subtle text-info-text",
	Rebaja: "bg-warning-subtle text-warning-text",
	Convenio: "bg-success-subtle text-success-text",
	Crítica: "bg-danger-subtle text-danger-text",
};

export function TipoCartera({
	tipo,
	children,
	className,
	...props
}: Omit<React.ComponentProps<"span">, "children"> & {
	tipo: TipoCarteraValor;
	/** Etiqueta; por defecto, el nombre del tipo. */
	children?: React.ReactNode;
}) {
	return (
		<span
			data-slot="tipo-cartera"
			className={cn(
				"inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-2 py-1 font-semibold text-xs leading-[1.26]",
				tipoTone[tipo],
				className,
			)}
			{...props}
		>
			{children ?? tipo}
		</span>
	);
}

/* ── Cartera/FilterChip ─────────────────────────────────────────────────────── */

export function FilterChip({
	seleccionado = false,
	cantidad,
	children,
	className,
	type = "button",
	...props
}: React.ComponentProps<"button"> & {
	/** Estado "Seleccionado" de Figma. */
	seleccionado?: boolean;
	/** Se agrega a la etiqueta como "Etiqueta · 312". */
	cantidad?: number | string;
}) {
	return (
		<button
			data-slot="filter-chip"
			type={type}
			aria-pressed={seleccionado}
			data-state={seleccionado ? "on" : "off"}
			className={cn(
				"inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-transparent px-2.75 py-0.75 font-medium text-xs leading-[1.26] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
				seleccionado
					? "bg-brand-subtle text-brand"
					: "bg-muted text-fg-secondary hover:border-line hover:bg-surface-raised",
				className,
			)}
			{...props}
		>
			<span
				aria-hidden
				className={cn(
					"size-1.5 shrink-0 rounded-full",
					seleccionado ? "bg-brand" : "bg-fg-secondary",
				)}
			/>
			{children}
			{cantidad != null ? ` · ${cantidad}` : null}
		</button>
	);
}
