import { Slot } from "@radix-ui/react-slot";
import { ChevronRight, Shield } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import {
	CrmCard,
	CrmDataField,
	CrmDivider,
	CrmField,
	CrmInfoCard,
	crmText,
} from "./cards-credito";

/**
 * Cards de cobranza — Figma "03 · Componentes CRM" (CCI Cobros).
 *
 *   CardPromesa        → "Card · Promesa de Pago"  Card/Promesa (88:956)
 *                        Opciones (boolean) → slot `opciones` (menú contextual; oculto si no se pasa).
 *   CardConvenio       → "Card · Convenio"         Card/Convenio (88:976)
 *   CardProximaAccion  → "Card · Próxima Acción"   Card/PróximaAcción (145:2468)
 *                        Prioridad=Alta|Media|Baja → `prioridad`; Acción (texto) → `accion`.
 *   CardCobro          → "Cards · Cobranza"        Card/Cobro (820:1051)
 *   CardEstadoCuenta   → "Cards · Cobranza"        Card/EstadoCuenta (825:1036)
 *   CardModuleEntry    → "Cards · Cobranza"        Card/ModuleEntry (1368:4056)
 *
 * Badges (estado de promesa/convenio, tipo de próxima acción) y la acción principal
 * entran como `React.ReactNode` para usar `ds/badges.tsx` y `ds/action-crm.tsx`.
 *
 * Desvíos respecto a Figma:
 *  - Card/Cobro y Card/ModuleEntry vienen con hex sueltos (paleta gris de Tailwind):
 *    #111827 → text-fg · #6b7280 → text-fg-secondary · #9aa3af → text-fg-tertiary ·
 *    #eaecef → bg-divider · #f5f7fa (fila total) → bg-muted · #e5e7eb → border-line-subtle ·
 *    #ffffff → bg-surface · #eef0ff (círculo del ícono) → bg-violet-bg.
 *  - r:16 / r:12 sin variable → `rounded-xl` (14) / `rounded-lg` (10), los tokens más cercanos.
 *  - Card/ModuleEntry es un botón (o el hijo con `asChild`): se agregan hover y foco,
 *    que Figma no dibuja.
 *  - Títulos en minúscula según la guía de redacción ("Promesa de pago", "Convenio de pago").
 *  - Ancho fluido; el contenedor decide (Figma: 340/360/400 fijos).
 */

type ArticleProps = Omit<React.ComponentProps<"article">, "children">;

/* ── Card/Promesa ───────────────────────────────────────────────────────────── */

export type CardPromesaProps = ArticleProps & {
	titulo?: React.ReactNode;
	/** Badge de estado, p. ej. `<PromesaBadge promesa="Pendiente" />`. */
	estado: React.ReactNode;
	/** Propiedad "Opciones" de Figma: menú contextual (botón ⋮) junto al estado. */
	opciones?: React.ReactNode;
	/** "Q 5,000.00". */
	monto: React.ReactNode;
	/** "15 / 07 / 2026". */
	fechaCompromiso: React.ReactNode;
	responsable: React.ReactNode;
};

export function CardPromesa({
	titulo = "Promesa de pago",
	estado,
	opciones,
	monto,
	fechaCompromiso,
	responsable,
	...props
}: CardPromesaProps) {
	return (
		<CrmCard data-slot="card-promesa" {...props}>
			<div className="flex items-center justify-between gap-2.5">
				<h3 className={crmText.title}>{titulo}</h3>
				<div className="flex shrink-0 items-center gap-1.5">
					{estado}
					{opciones}
				</div>
			</div>
			<div className="flex flex-col gap-0.5">
				<span className={crmText.label}>Monto comprometido</span>
				<span className="font-bold text-2xl text-fg leading-[1.26]">
					{monto}
				</span>
			</div>
			<CrmDivider />
			<div className="flex justify-between gap-4">
				<CrmField label="Fecha compromiso" valueClassName="font-semibold">
					{fechaCompromiso}
				</CrmField>
				<CrmField label="Responsable">{responsable}</CrmField>
			</div>
		</CrmCard>
	);
}

/* ── Card/Convenio ──────────────────────────────────────────────────────────── */

export type CardConvenioProps = ArticleProps & {
	titulo?: React.ReactNode;
	/** Badge de estado, p. ej. `<ConvenioBadge convenio="Activo" />`. */
	estado: React.ReactNode;
	/** "Q 48,250". */
	montoTotal: React.ReactNode;
	/** "Q 8,041". */
	cuotaMensual: React.ReactNode;
	/** Total de cuotas del convenio. */
	cuotas: number;
	/** Cuotas pagadas: define la barra de avance ("2 de 6 cuotas"). */
	cuotasPagadas: number;
};

export function CardConvenio({
	titulo = "Convenio de pago",
	estado,
	montoTotal,
	cuotaMensual,
	cuotas,
	cuotasPagadas,
	...props
}: CardConvenioProps) {
	const avance =
		cuotas > 0 ? Math.min(100, Math.max(0, (cuotasPagadas / cuotas) * 100)) : 0;
	return (
		<CrmCard data-slot="card-convenio" {...props}>
			<div className="flex items-center justify-between gap-2.5">
				<h3 className={crmText.title}>{titulo}</h3>
				{estado}
			</div>
			<div className="flex justify-between gap-4">
				<CrmField label="Monto total">{montoTotal}</CrmField>
				<CrmField label="Cuotas">{cuotas}</CrmField>
				<CrmField label="Cuota mensual" valueClassName="font-semibold">
					{cuotaMensual}
				</CrmField>
			</div>
			<CrmDivider />
			<div className="flex flex-col gap-1.5">
				<div className="flex items-center justify-between gap-2">
					<span className={crmText.label}>Avance</span>
					<span className="font-medium text-[11px] text-fg-secondary leading-[1.26]">
						{cuotasPagadas} de {cuotas} cuotas
					</span>
				</div>
				<div
					role="progressbar"
					aria-label="Avance del convenio"
					aria-valuemin={0}
					aria-valuemax={cuotas}
					aria-valuenow={cuotasPagadas}
					className="h-2 w-full overflow-hidden rounded-full bg-line-subtle"
				>
					<div
						className="h-full rounded-full bg-brand transition-[width] duration-250"
						style={{ width: `${avance}%` }}
					/>
				</div>
			</div>
		</CrmCard>
	);
}

/* ── Card/PróximaAcción ─────────────────────────────────────────────────────── */

export type PrioridadAccion = "alta" | "media" | "baja";

const prioridadAccion: Record<
	PrioridadAccion,
	{ franja: string; pill: string; punto: string; etiqueta: string }
> = {
	alta: {
		franja: "bg-danger-solid",
		pill: "bg-danger-subtle text-danger-text",
		punto: "bg-danger-solid",
		etiqueta: "Prioridad Alta",
	},
	media: {
		franja: "bg-warning-solid",
		pill: "bg-warning-subtle text-warning-text",
		punto: "bg-warning-solid",
		etiqueta: "Prioridad Media",
	},
	baja: {
		franja: "bg-success-solid",
		pill: "bg-success-subtle text-success-text",
		punto: "bg-success-solid",
		etiqueta: "Prioridad Baja",
	},
};

export type CardProximaAccionProps = ArticleProps & {
	/** Variante "Prioridad": franja superior y pill. */
	prioridad?: PrioridadAccion;
	prioridadLabel?: React.ReactNode;
	/** Celda del tipo de acción (Cell/PróximaAcción), p. ej. pill "Llamar" con ícono. */
	tipo?: React.ReactNode;
	/** Propiedad "Acción" de Figma: "Llamar — seguimiento de promesa". */
	accion: React.ReactNode;
	responsable: React.ReactNode;
	/** "15 jul 2026". */
	fecha: React.ReactNode;
	/** "10:00 AM". */
	hora: React.ReactNode;
	/** CTA de ancho completo, p. ej. `<ActionCrm accion="registrar-gestion" className="w-full" />`. */
	cta?: React.ReactNode;
};

export function CardProximaAccion({
	prioridad = "alta",
	prioridadLabel,
	tipo,
	accion,
	responsable,
	fecha,
	hora,
	cta,
	className,
	...props
}: CardProximaAccionProps) {
	const p = prioridadAccion[prioridad];
	return (
		<article
			data-slot="card-proxima-accion"
			data-prioridad={prioridad}
			className={cn(
				"flex min-w-0 flex-col overflow-hidden rounded-2xl bg-surface text-fg shadow-clay-raised",
				className,
			)}
			{...props}
		>
			<div aria-hidden className={cn("h-1 w-full shrink-0", p.franja)} />
			<div className="flex flex-col gap-3.5 p-5">
				<div className="flex items-center justify-between gap-2">
					<span className={crmText.overline}>Próxima acción</span>
					<span
						className={cn(
							"inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 font-semibold text-[11px] leading-[1.26]",
							p.pill,
						)}
					>
						<span
							aria-hidden
							className={cn("size-1.5 rounded-full", p.punto)}
						/>
						{prioridadLabel ?? p.etiqueta}
					</span>
				</div>
				{tipo ? <div className="flex">{tipo}</div> : null}
				<h3 className="font-bold text-base text-fg leading-[1.26]">{accion}</h3>
				<CrmDivider />
				<div className="flex justify-between gap-4">
					{(
						[
							["Responsable", responsable],
							["Fecha", fecha],
							["Hora", hora],
						] as const
					).map(([label, value]) => (
						<div key={label} className="flex min-w-0 flex-col gap-0.5">
							<span className="text-[10px] text-fg-tertiary leading-[1.26]">
								{label}
							</span>
							<span className="font-semibold text-fg text-xs leading-[1.26]">
								{value}
							</span>
						</div>
					))}
				</div>
				{cta ? <div className="flex flex-col">{cta}</div> : null}
			</div>
		</article>
	);
}

/* ── Card/Cobro ─────────────────────────────────────────────────────────────── */

export type ConceptoCobro = {
	/** "1 cuota vencida". */
	label: React.ReactNode;
	/** Detalle opcional bajo la etiqueta: "Q3,200 c/u". */
	detalle?: React.ReactNode;
	/** "Q 3,200.00". */
	monto: React.ReactNode;
};

export type CardCobroProps = ArticleProps & {
	titulo?: React.ReactNode;
	subtitulo?: React.ReactNode;
	/** Composición del cobro: cuotas vencidas, mora acumulada… */
	conceptos: ConceptoCobro[];
	totalLabel?: React.ReactNode;
	/** "Q 3,400.00". */
	total: React.ReactNode;
	/** Datos de contexto separados por "·": cuota mensual, días en mora, saldo. */
	contexto?: React.ReactNode[];
};

export function CardCobro({
	titulo = "Cobro de hoy",
	subtitulo = "Lo que debe pagar para ponerse al día",
	conceptos,
	totalLabel = "Total a pagar hoy",
	total,
	contexto,
	className,
	...props
}: CardCobroProps) {
	return (
		<CrmCard
			data-slot="card-cobro"
			superficie="outline"
			className={cn("gap-4 p-6", className)}
			{...props}
		>
			<div className="flex flex-col gap-0.5">
				<h3 className={crmText.name}>{titulo}</h3>
				{subtitulo ? <p className={crmText.sub}>{subtitulo}</p> : null}
			</div>
			<div className="flex flex-col gap-3">
				{conceptos.map((c, i) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: lista estática de conceptos
						key={i}
						className="flex items-center justify-between gap-4"
					>
						<div className="flex min-w-0 flex-col gap-px">
							<span className="font-medium text-fg text-sm leading-[1.26]">
								{c.label}
							</span>
							{c.detalle ? (
								<span className="text-fg-tertiary text-xs leading-[1.26]">
									{c.detalle}
								</span>
							) : null}
						</div>
						<span className="shrink-0 font-semibold text-[15px] text-fg leading-[1.26]">
							{c.monto}
						</span>
					</div>
				))}
				<CrmDivider />
				<div className="flex items-center justify-between gap-4 rounded-lg bg-muted px-3.5 py-3">
					<span className="font-semibold text-fg text-sm leading-[1.26]">
						{totalLabel}
					</span>
					<span className="shrink-0 font-bold text-2xl text-fg leading-[1.26]">
						{total}
					</span>
				</div>
			</div>
			{contexto?.length ? (
				<p className={crmText.sub}>
					{contexto.map((item, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: lista estática de datos
						<React.Fragment key={i}>
							<span className="whitespace-nowrap">
								{item}
								{i < contexto.length - 1 ? (
									<span aria-hidden className="pl-1.5 text-fg-tertiary">
										·
									</span>
								) : null}
							</span>{" "}
						</React.Fragment>
					))}
				</p>
			) : null}
		</CrmCard>
	);
}

/* ── Card/EstadoCuenta ──────────────────────────────────────────────────────── */

export type CardEstadoCuentaProps = ArticleProps & {
	titulo?: React.ReactNode;
	/** Días de atraso: número grande, danger si hay atraso y success si es 0. */
	diasAtraso: number;
	/** "En mora". */
	estado: React.ReactNode;
	/** Monto del último abono (énfasis Fuerte). */
	ultimoAbono: React.ReactNode;
	fechaUltimoPago: React.ReactNode;
	proximoVencimiento: React.ReactNode;
	/** "18 de 48". */
	cuotasPagadas: React.ReactNode;
};

export function CardEstadoCuenta({
	titulo = "Estado del cobro",
	diasAtraso,
	estado,
	ultimoAbono,
	fechaUltimoPago,
	proximoVencimiento,
	cuotasPagadas,
	...props
}: CardEstadoCuentaProps) {
	return (
		<CrmInfoCard
			data-slot="card-estado-cuenta"
			icon={<Shield aria-hidden />}
			titulo={titulo}
			{...props}
		>
			<CrmField
				label="Días de atraso"
				valueClassName={cn(
					"font-bold text-2xl",
					diasAtraso > 0 ? "text-danger-text" : "text-success-text",
				)}
			>
				{diasAtraso}
			</CrmField>
			<CrmDataField label="Estado">{estado}</CrmDataField>
			<CrmDataField label="Último abono" enfasis="fuerte">
				{ultimoAbono}
			</CrmDataField>
			<CrmDataField label="Fecha último pago">{fechaUltimoPago}</CrmDataField>
			<CrmDataField label="Próximo vencimiento">
				{proximoVencimiento}
			</CrmDataField>
			<CrmDataField label="Cuotas pagadas">{cuotasPagadas}</CrmDataField>
		</CrmInfoCard>
	);
}

/* ── Card/ModuleEntry ───────────────────────────────────────────────────────── */

export type CardModuleEntryProps = Omit<
	React.ComponentProps<"button">,
	"children" | "title"
> & {
	/** Ícono lucide del módulo (Figma: lucide/map-pin). */
	icon: React.ReactNode;
	titulo: React.ReactNode;
	subtitulo?: React.ReactNode;
	/** Usa el hijo (p. ej. `<Link to="…" />`, sin contenido) como elemento de la card. */
	asChild?: boolean;
	children?: React.ReactElement;
};

export function CardModuleEntry({
	icon,
	titulo,
	subtitulo,
	asChild = false,
	className,
	children,
	type = "button",
	...props
}: CardModuleEntryProps) {
	const contenido = (
		<>
			<span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-violet-bg text-brand [&_svg]:size-4">
				{icon}
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
				<span className={cn(crmText.title, "truncate")}>{titulo}</span>
				{subtitulo ? (
					<span className={cn(crmText.sub, "truncate")}>{subtitulo}</span>
				) : null}
			</span>
			<ChevronRight aria-hidden className="size-4 shrink-0 text-brand" />
		</>
	);
	const clases = cn(
		"flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-line-subtle bg-surface px-4 py-3.5 text-fg outline-none transition-[background-color,border-color] duration-150 ease-out hover:border-line hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring active:shadow-pressed",
		className,
	);
	if (
		asChild &&
		React.isValidElement<{ children?: React.ReactNode }>(children)
	) {
		// El hijo (p. ej. <Link to="…" />) recibe los estilos y el contenido de la card.
		return (
			<Slot data-slot="card-module-entry" className={clases} {...props}>
				{React.cloneElement(children, undefined, contenido)}
			</Slot>
		);
	}
	return (
		<button
			data-slot="card-module-entry"
			type={type}
			className={clases}
			{...props}
		>
			{contenido}
		</button>
	);
}
