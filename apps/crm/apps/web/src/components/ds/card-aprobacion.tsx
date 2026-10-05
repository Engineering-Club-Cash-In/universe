import type * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CrmPill } from "./cards-credito";

/**
 * CardAprobacion — Figma "🏦 CRM · Rescate & Supervisor (B3/B4) › Card/Aprobación" (2132:3432).
 *
 * Variante "Tipo" → prop `tipo`:
 *   Convenio       → "convenio"        ("Convenio / última oferta")
 *   Entrega        → "entrega"         ("Entrega voluntaria")
 *   Acción crítica → "accion-critica"  ("Acción crítica")
 * Las tres comparten estructura; cambian el texto del tipo y las filas de contexto,
 * que entran por `detalles` (p. ej. Propuesta / Monto total / Estado).
 *
 * Estructura: borde status/warning/text 1.5, p 18/20, gap 14, título 16/600 + Chip
 * Alerta; línea meta 13/400 terciaria; caja de contexto (bg/canvas + border/subtle,
 * p 16/18, gap 10; etiqueta 170px 13/500 terciaria, valor 14/600); acciones a la
 * derecha: Button Danger "Rechazar" + Button Primary "Aprobar" (Medium).
 *
 * Desvíos respecto a Figma:
 *  - Textos en trato de usted (guía de redacción de cobros): "Pendiente de su
 *    aprobación" y "Requiere su decisión" (Figma: "tu").
 *  - r:16 / r:12 sin variable → `rounded-xl` (14) / `rounded-lg` (10).
 *  - Ancho fluido (Figma: 600 fijo); el contexto hace wrap en pantallas angostas.
 */

export type TipoAprobacion = "convenio" | "entrega" | "accion-critica";

const TIPO_LABEL: Record<TipoAprobacion, string> = {
	convenio: "Convenio / última oferta",
	entrega: "Entrega voluntaria",
	"accion-critica": "Acción crítica",
};

export type CardAprobacionProps = Omit<
	React.ComponentProps<"article">,
	"children" | "title"
> & {
	tipo: TipoAprobacion;
	/** Reemplaza el texto del tipo ("Convenio / última oferta"). */
	tipoLabel?: React.ReactNode;
	/** "Marta Gómez · Asesor Senior". */
	solicitante: React.ReactNode;
	/** Filas de la caja de contexto. */
	detalles: { label: React.ReactNode; value: React.ReactNode }[];
	titulo?: React.ReactNode;
	chipLabel?: React.ReactNode;
	onAprobar?: () => void;
	onRechazar?: () => void;
	aprobarLabel?: React.ReactNode;
	rechazarLabel?: React.ReactNode;
	/** Estado Loading del botón correspondiente. */
	aprobando?: boolean;
	rechazando?: boolean;
	/** Deshabilita ambas acciones (p. ej. sin permiso). */
	disabled?: boolean;
};

export function CardAprobacion({
	tipo,
	tipoLabel,
	solicitante,
	detalles,
	titulo = "Pendiente de su aprobación",
	chipLabel = "Requiere su decisión",
	onAprobar,
	onRechazar,
	aprobarLabel = "Aprobar",
	rechazarLabel = "Rechazar",
	aprobando = false,
	rechazando = false,
	disabled = false,
	className,
	...props
}: CardAprobacionProps) {
	const ocupado = aprobando || rechazando;
	return (
		<article
			data-slot="card-aprobacion"
			data-tipo={tipo}
			className={cn(
				"flex min-w-0 flex-col gap-3.5 rounded-xl border-[1.5px] border-warning-text bg-surface px-5 py-4.5 text-fg",
				className,
			)}
			{...props}
		>
			<div className="flex flex-wrap items-center gap-2.5">
				<h3 className="font-semibold text-base text-fg leading-[1.26]">
					{titulo}
				</h3>
				<CrmPill kind="chip" tone="warning">
					{chipLabel}
				</CrmPill>
			</div>
			<p className="text-[13px] text-fg-tertiary leading-[1.26]">
				Tipo: {tipoLabel ?? TIPO_LABEL[tipo]}
				<span aria-hidden className="px-2">
					·
				</span>
				Solicitado por: {solicitante}
			</p>
			<dl className="flex flex-col gap-2.5 rounded-lg border border-line-subtle bg-canvas px-4.5 py-4">
				{detalles.map((d, i) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: filas estáticas del contexto
						key={i}
						className="flex flex-col gap-x-2 gap-y-0.5 sm:flex-row sm:items-baseline"
					>
						<dt className="shrink-0 font-medium text-[13px] text-fg-tertiary leading-[1.26] sm:w-42.5">
							{d.label}
						</dt>
						<dd className="min-w-0 flex-1 font-semibold text-fg text-sm leading-[1.26]">
							{d.value}
						</dd>
					</div>
				))}
			</dl>
			{onAprobar || onRechazar ? (
				<div className="flex justify-end gap-2.5">
					{onRechazar ? (
						<Button
							variant="destructive"
							onClick={onRechazar}
							loading={rechazando}
							disabled={disabled || (ocupado && !rechazando)}
						>
							{rechazarLabel}
						</Button>
					) : null}
					{onAprobar ? (
						<Button
							onClick={onAprobar}
							loading={aprobando}
							disabled={disabled || (ocupado && !aprobando)}
						>
							{aprobarLabel}
						</Button>
					) : null}
				</div>
			) : null}
		</article>
	);
}
