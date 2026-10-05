import type * as React from "react";

import { cn } from "@/lib/utils";
import { type Promesa, PromesaBadge } from "./badges";

/**
 * Historial de promesas — Figma "03 · Componentes CRM › Sección: Item / Historial de Promesas".
 *
 *   HistorialPromesaItem → "Item/HistorialPromesa" (462:877). Fila de 64px con seis columnas:
 *                          fecha-creacion → `fechaCreacion`, monto → `monto`,
 *                          fecha-compromiso → `fechaCompromiso`, responsable → `responsable`,
 *                          Estado (Badge/Promesa anidado) → `estado`, resultado → `resultado`.
 *   HistorialPromesaHead → frame "HistorialHead" (462:894) de la demo: encabezado de 36px.
 *   HistorialPromesas    → frame "demo/Tabla" (473:941): superficie + encabezado + filas
 *                          separadas por divisor. Las filas van como `children`.
 *
 * Desvíos/notas:
 *  - Anchos de columna de Figma (150/140/150/170/130/300); la última crece si sobra espacio.
 *  - Radio del contenedor: 16px suelto en Figma → `rounded-xl` (radius/md 14), el token más cercano.
 *  - Tipografía sin estilo: 13/16.38 → `text-[13px] leading-[1.26]`, 12/15.12 →
 *    `text-xs leading-[1.26]`, 10/12.6 → `text-[10px] leading-[1.26]`.
 */

const columnas =
	"grid grid-cols-[150px_140px_150px_170px_130px_minmax(300px,1fr)] items-center px-4";

const ENCABEZADOS = [
	"Fecha creación",
	"Monto",
	"Fecha compromiso",
	"Responsable",
	"Estado",
	"Resultado",
] as const;

export function HistorialPromesaHead({
	className,
	...props
}: Omit<React.ComponentProps<"div">, "children">) {
	return (
		<div
			data-slot="historial-promesa-head"
			className={cn(columnas, "h-9", className)}
			{...props}
		>
			{ENCABEZADOS.map((h) => (
				<span
					key={h}
					className="font-semibold text-[10px] text-fg-tertiary uppercase leading-[1.26]"
				>
					{h}
				</span>
			))}
		</div>
	);
}

export type HistorialPromesaItemProps = Omit<
	React.ComponentProps<"div">,
	"children"
> & {
	/** "11 jul 2026" */
	fechaCreacion: React.ReactNode;
	/** "Q 5,000.00" */
	monto: React.ReactNode;
	/** "15/07/2026" */
	fechaCompromiso: React.ReactNode;
	/** "C. Ramírez" */
	responsable: React.ReactNode;
	/** Estado de la promesa (Badge/Promesa). */
	estado: Promesa;
	/** "Pago recibido a tiempo" */
	resultado?: React.ReactNode;
};

export function HistorialPromesaItem({
	fechaCreacion,
	monto,
	fechaCompromiso,
	responsable,
	estado,
	resultado,
	className,
	...props
}: HistorialPromesaItemProps) {
	return (
		<div
			data-slot="historial-promesa-item"
			className={cn(columnas, "h-16", className)}
			{...props}
		>
			<span className="font-semibold text-[13px] text-fg leading-[1.26]">
				{fechaCreacion}
			</span>
			<span className="font-bold text-[13px] text-fg tabular-nums leading-[1.26]">
				{monto}
			</span>
			<span className="text-fg-secondary text-xs tabular-nums leading-[1.26]">
				{fechaCompromiso}
			</span>
			<span className="truncate pr-4 text-fg-secondary text-xs leading-[1.26]">
				{responsable}
			</span>
			<span>
				<PromesaBadge promesa={estado} />
			</span>
			<span className="text-fg-secondary text-xs leading-[1.26]">
				{resultado}
			</span>
		</div>
	);
}

export function HistorialPromesas({
	children,
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="historial-promesas"
			className={cn(
				"overflow-x-auto rounded-xl border border-line-subtle bg-surface pt-2",
				className,
			)}
			{...props}
		>
			<div className="min-w-max">
				<HistorialPromesaHead />
				<div className="divide-y divide-line-subtle">{children}</div>
			</div>
		</div>
	);
}
