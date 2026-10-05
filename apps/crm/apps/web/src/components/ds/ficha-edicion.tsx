import { RefreshCw } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Ficha · Edición — Figma "03 · Componentes CRM › Ficha · Edición" (Ficha 360).
 *
 *   FichaEditableRow → Ficha/EditableRow (1165:887)
 *     Etiqueta (texto) → `etiqueta`; Valor (texto) → `valor`
 *     Modo=Vista|Edición → `modo` ("vista" | "edicion"). En edición se muestra el
 *     Input/Text de `ui/input` (estado Filled) con la etiqueta encima.
 *   FichaSaveBar → Ficha/SaveBar (1166:917)
 *     Mensaje (texto) → `mensaje` (o `cambios` para armar "N cambios sin guardar")
 *     Estado=ConCambios|Guardando → `estado` ("con-cambios" | "guardando")
 *   FichaAuditRow → Ficha/AuditRow (1166:918)
 *     Campo, Categoría, Antes, Después, Autor, FechaOrigen → props homónimas.
 *
 * Desvíos respecto a Figma:
 *  - SaveBar: sombra 0 6 20 #0000001f sin token → `shadow-dropdown` (Elevation/Dropdown);
 *    r:12 sin variable → `rounded-lg` (10). Ancho fluido (Figma: 720).
 *  - SaveBar "Guardando": el botón usa el estado Loading de Button (spinner + texto);
 *    en Figma es el Primary normal con el texto "Guardando…". El ícono refresh-cw gira.
 *  - EditableRow "Vista" no fija los 56px de alto de Figma (que en "Edición" se
 *    desborda con el input de 64px): cada modo toma su alto natural.
 *  - AuditRow: anchos 220 / fill / 240 de Figma como columnas de grilla.
 */

/* ── Ficha/EditableRow ──────────────────────────────────────────────────────── */

export type FichaEditableRowProps = Omit<
	React.ComponentProps<"input">,
	"value" | "defaultValue" | "onChange"
> & {
	etiqueta: React.ReactNode;
	valor: string;
	modo?: "vista" | "edicion";
	onValorChange?: (valor: string) => void;
	/** Texto cuando no hay valor en modo vista. */
	vacio?: React.ReactNode;
	/** Clases del contenedor. */
	className?: string;
	/** Clases del Input (modo edición). */
	inputClassName?: string;
};

export function FichaEditableRow({
	etiqueta,
	valor,
	modo = "vista",
	onValorChange,
	vacio = "—",
	className,
	inputClassName,
	id,
	...inputProps
}: FichaEditableRowProps) {
	const autoId = React.useId();
	const inputId = id ?? autoId;

	if (modo === "edicion") {
		return (
			<div
				data-slot="ficha-editable-row"
				data-modo="edicion"
				className={cn("flex min-w-0 flex-col gap-1.5", className)}
			>
				<Label
					htmlFor={inputId}
					className="font-medium text-[13px] text-fg-secondary leading-[1.26]"
				>
					{etiqueta}
				</Label>
				<Input
					id={inputId}
					value={valor}
					onChange={(e) => onValorChange?.(e.target.value)}
					className={inputClassName}
					{...inputProps}
				/>
			</div>
		);
	}

	return (
		<div
			data-slot="ficha-editable-row"
			data-modo="vista"
			className={cn("flex min-w-0 flex-col gap-1", className)}
		>
			<span className="font-medium text-fg-secondary text-xs leading-[1.26]">
				{etiqueta}
			</span>
			<span
				className={cn(
					"break-words text-sm leading-[1.26]",
					valor ? "text-fg" : "text-fg-tertiary",
				)}
			>
				{valor || vacio}
			</span>
		</div>
	);
}

/* ── Ficha/SaveBar ──────────────────────────────────────────────────────────── */

export type FichaSaveBarProps = Omit<
	React.ComponentProps<"div">,
	"children"
> & {
	estado?: "con-cambios" | "guardando";
	/** Texto del indicador; por defecto se arma con `cambios`. */
	mensaje?: React.ReactNode;
	/** Cantidad de cambios: "3 cambios sin guardar". */
	cambios?: number;
	onCancelar?: () => void;
	onGuardar?: () => void;
	cancelarLabel?: React.ReactNode;
	guardarLabel?: React.ReactNode;
	guardandoLabel?: React.ReactNode;
};

export function FichaSaveBar({
	estado = "con-cambios",
	mensaje,
	cambios,
	onCancelar,
	onGuardar,
	cancelarLabel = "Cancelar",
	guardarLabel = "Guardar cambios",
	guardandoLabel = "Guardando…",
	className,
	...props
}: FichaSaveBarProps) {
	const guardando = estado === "guardando";
	const texto =
		mensaje ??
		(cambios === undefined
			? "Cambios sin guardar"
			: `${cambios} ${cambios === 1 ? "cambio" : "cambios"} sin guardar`);

	return (
		<div
			data-slot="ficha-save-bar"
			data-estado={estado}
			className={cn(
				"flex min-h-15 w-full min-w-0 items-center gap-4 rounded-lg border border-line-subtle bg-surface py-2.5 pr-4 pl-5 text-fg shadow-dropdown",
				className,
			)}
			{...props}
		>
			<div className="flex min-w-0 flex-1 items-center gap-2">
				{guardando ? (
					<RefreshCw
						aria-hidden
						className="size-5 shrink-0 animate-spin text-brand"
					/>
				) : (
					<span
						aria-hidden
						className="size-2.25 shrink-0 rounded-full bg-warning-solid"
					/>
				)}
				<output
					aria-live="polite"
					className={cn(
						"truncate font-semibold text-sm leading-[1.26]",
						guardando ? "text-fg" : "text-warning-text",
					)}
				>
					{texto}
				</output>
			</div>
			<Button variant="secondary" onClick={onCancelar}>
				{cancelarLabel}
			</Button>
			<Button onClick={onGuardar} loading={guardando}>
				{guardando ? guardandoLabel : guardarLabel}
			</Button>
		</div>
	);
}

/* ── Ficha/AuditRow ─────────────────────────────────────────────────────────── */

export type FichaAuditRowProps = Omit<
	React.ComponentProps<"div">,
	"children"
> & {
	/** "Teléfono principal". */
	campo: React.ReactNode;
	/** "Contacto". */
	categoria?: React.ReactNode;
	/** Valor anterior (tachado); vacío → "—". */
	antes?: React.ReactNode;
	/** Valor nuevo (chip de marca). */
	despues: React.ReactNode;
	/** "Ana G. (asesor)". */
	autor: React.ReactNode;
	/** "15 jul 2026 · 09:14 · Ficha 360". */
	fechaOrigen: React.ReactNode;
};

export function FichaAuditRow({
	campo,
	categoria,
	antes,
	despues,
	autor,
	fechaOrigen,
	className,
	...props
}: FichaAuditRowProps) {
	const sinAntes = antes === null || antes === undefined || antes === "";
	return (
		<div
			data-slot="ficha-audit-row"
			className={cn(
				"grid min-w-0 grid-cols-[minmax(0,220px)_minmax(0,1fr)_minmax(0,240px)] items-center gap-4 border-line-subtle border-b py-3",
				className,
			)}
			{...props}
		>
			<div className="flex min-w-0 flex-col gap-px">
				<span className="truncate font-semibold text-[13px] text-fg leading-[1.26]">
					{campo}
				</span>
				{categoria ? (
					<span className="truncate text-[11px] text-fg-tertiary leading-[1.26]">
						{categoria}
					</span>
				) : null}
			</div>
			<div className="flex min-w-0 flex-wrap items-center gap-2">
				{sinAntes ? (
					<span className="text-[13px] text-fg-tertiary leading-[1.26]">—</span>
				) : (
					<del className="text-[13px] text-fg-tertiary leading-[1.26]">
						{antes}
					</del>
				)}
				<span
					aria-hidden
					className="font-medium text-[13px] text-fg-tertiary leading-[1.26]"
				>
					→
				</span>
				<ins className="rounded-sm bg-brand-subtle px-2 py-0.75 font-semibold text-[13px] text-success-alt-fg leading-[1.26] no-underline">
					{despues}
				</ins>
			</div>
			<div className="flex min-w-0 flex-col items-end gap-px text-right">
				<span className="truncate font-medium text-[13px] text-fg leading-[1.26]">
					{autor}
				</span>
				<span className="truncate text-[11px] text-fg-tertiary leading-[1.26]">
					{fechaOrigen}
				</span>
			</div>
		</div>
	);
}
