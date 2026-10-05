import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Table — estilo base tomado de Figma "03 · Componentes CRM › Tabla de Cartera"
 * (Table/Cartera, 131:1355). Solo el aspecto genérico; la tabla de cartera con sus
 * celdas de dominio vive aparte.
 *
 * Figma → código:
 *   col-head  36px · bg/canvas · texto 10/600 MAYÚSCULAS text/tertiary → TableHead
 *   row       56px · bg/surface · divisor border/divider de 1px      → TableRow + TableCell
 *   fila resaltada (bg brand/primary-subtle)                         → data-state="selected"
 *                                                                      (hover = el mismo tono, más suave)
 *   padding horizontal de la fila 16px                                → primera/última celda
 *   texto de celda 13px                                               → TableCell
 * Densidad (`density` en <Table>, agregado en código; Figma solo tiene la normal):
 *   "default" → filas de 56px (Figma) · "compact" → filas de 40px para tablas largas.
 * El marco de card (radio 20, borde subtle, Clay-Raised) lo pone el contenedor, no <Table>.
 */
function Table({
	className,
	density = "default",
	...props
}: React.ComponentProps<"table"> & {
	/** "default" = filas de 56px como Figma; "compact" = 40px. */
	density?: "default" | "compact";
}) {
	return (
		<div
			data-slot="table-container"
			className="relative w-full overflow-x-auto"
		>
			<table
				data-slot="table"
				data-density={density}
				className={cn(
					"group/table w-full caption-bottom text-[13px]/4 text-fg",
					className,
				)}
				{...props}
			/>
		</div>
	);
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
	return (
		<thead
			data-slot="table-header"
			className={cn("[&_tr]:border-b-0", className)}
			{...props}
		/>
	);
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
	return (
		<tbody
			data-slot="table-body"
			className={cn("[&_tr:last-child]:border-0", className)}
			{...props}
		/>
	);
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
	return (
		<tfoot
			data-slot="table-footer"
			className={cn(
				"border-divider border-t bg-canvas font-semibold [&>tr]:last:border-b-0",
				className,
			)}
			{...props}
		/>
	);
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
	return (
		<tr
			data-slot="table-row"
			className={cn(
				"border-divider border-b transition-colors duration-150 ease-out hover:bg-brand-subtle/50 data-[state=selected]:bg-brand-subtle",
				className,
			)}
			{...props}
		/>
	);
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
	return (
		<th
			data-slot="table-head"
			className={cn(
				"h-9 whitespace-nowrap bg-canvas px-3 text-left align-middle font-semibold text-[10px]/[13px] text-fg-tertiary uppercase first:pl-4 last:pr-4 [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
				className,
			)}
			{...props}
		/>
	);
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
	return (
		<td
			data-slot="table-cell"
			className={cn(
				"h-14 whitespace-nowrap px-3 py-2 align-middle first:pl-4 last:pr-4 group-data-[density=compact]/table:h-10 group-data-[density=compact]/table:py-1.5 [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
				className,
			)}
			{...props}
		/>
	);
}

function TableCaption({
	className,
	...props
}: React.ComponentProps<"caption">) {
	return (
		<caption
			data-slot="table-caption"
			className={cn("type-caption mt-4 text-fg-tertiary", className)}
			{...props}
		/>
	);
}

export {
	Table,
	TableHeader,
	TableBody,
	TableFooter,
	TableHead,
	TableRow,
	TableCell,
	TableCaption,
};
