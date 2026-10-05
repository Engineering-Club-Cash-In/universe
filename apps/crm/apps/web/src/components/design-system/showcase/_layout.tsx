import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Piezas de maquetación para /design-system. Cada archivo `*.showcase.tsx` de esta
 * carpeta se registra solo (import.meta.glob en routes/design-system.tsx) y exporta:
 *   export const meta: ShowcaseMeta
 *   export default function Showcase() { ... }
 */
export type ShowcaseMeta = {
	/** Orden en la página (menor = más arriba). */
	order: number;
	title: string;
	/** Ruta del componente en Figma, p. ej. "02 · Componentes › Botones". */
	figma: string;
	description?: string;
};

/** Fila con etiqueta a la izquierda y ejemplos a la derecha. */
export function ShowcaseRow({
	label,
	children,
	className,
}: {
	label: string;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div className="grid grid-cols-[160px_1fr] items-start gap-6 py-3">
			<div className="type-label-sm pt-2 text-fg-tertiary">{label}</div>
			<div className={cn("flex flex-wrap items-center gap-4", className)}>
				{children}
			</div>
		</div>
	);
}

/** Grupo con subtítulo dentro de una sección. */
export function ShowcaseGroup({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="space-y-1 border-divider border-t pt-4 first:border-t-0 first:pt-0">
			<h3 className="type-heading-sm text-fg">{title}</h3>
			<div className="divide-y divide-divider">{children}</div>
		</div>
	);
}
