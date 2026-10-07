import { CalendarDays, type LucideIcon } from "lucide-react";
import type * as React from "react";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { type Destino, EnlaceDestino } from "./destino";

/**
 * «Sus pendientes de hoy» del Dashboard del supervisor (Figma `1954:14`, el
 * recuadro de arriba). Presentación pura.
 *
 * Barra «x de y aprobaciones resueltas hoy» y una fila de pendientes (ícono +
 * cantidad + etiqueta). Cada pendiente lleva a donde se resuelve: la Cartera
 * general con su filtro, la bandeja correspondiente o el bloque de
 * Aprobaciones de esta misma pantalla. Lo que todavía no tiene fuente se ve con
 * «—» y la marca «Pronto» (tareas S1/S2 del doc 17).
 *
 * `tareas` es el hueco de las Tareas B3 del supervisor (MisTareasB3), que se
 * mudaron aquí desde la Cola del día: se dibujan al pie, separadas por una línea.
 */

export type TonoPendiente = "neutral" | "warning" | "danger" | "brand";

const tonoIcono: Record<TonoPendiente, string> = {
	neutral: "text-fg-secondary",
	warning: "text-warning-solid",
	danger: "text-danger-solid",
	brand: "text-brand",
};

const tonoValor: Record<TonoPendiente, string> = {
	neutral: "text-fg",
	warning: "text-warning-text",
	danger: "text-danger-text",
	brand: "text-brand",
};

export type ItemPendiente = {
	clave: string;
	icono: LucideIcon;
	tono: TonoPendiente;
	/** `null` = sin fuente todavía ("—"). */
	valor: number | null;
	etiqueta: string;
	/** Ayuda del ⓘ (criterio del conteo o por qué dice «Pronto»). */
	info?: string;
	/** Sin fuente en el backend: muestra «Pronto» y no navega. */
	pronto?: boolean;
	destino?: Destino;
	onClick?: () => void;
};

export type PendientesHoyProps = {
	items: ItemPendiente[];
	/** Aprobaciones pendientes ahora y resueltas hoy (`null` = sin fuente, S1). */
	aprobaciones: { pendientes: number | null; resueltasHoy: number | null };
	cargando: boolean;
	/** Tareas B3 del supervisor (MisTareasB3); se oculta solo si no hay tareas. */
	tareas?: React.ReactNode;
};

function ContenidoItem({ item }: { item: ItemPendiente }) {
	const Icono = item.icono;
	return (
		<>
			<Icono
				aria-hidden
				className={cn("size-4 shrink-0", tonoIcono[item.tono])}
			/>
			<span
				className={cn(
					"font-bold text-base tabular-nums leading-5",
					item.valor === null ? "text-fg-tertiary" : tonoValor[item.tono],
				)}
			>
				{item.valor === null ? "—" : item.valor.toLocaleString("es-GT")}
			</span>
			<span className="type-body-sm text-fg-secondary transition-colors group-hover:text-fg">
				{item.etiqueta}
			</span>
			{item.pronto ? (
				<span className="rounded-full bg-muted px-1.75 py-px font-semibold text-[10px] text-fg-tertiary uppercase leading-[1.26] tracking-wide">
					Pronto
				</span>
			) : null}
		</>
	);
}

const claseItem =
	"group inline-flex min-w-0 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Item({ item }: { item: ItemPendiente }) {
	let cuerpo: React.ReactNode;
	if (!item.pronto && item.destino) {
		cuerpo = (
			<EnlaceDestino destino={item.destino} className={claseItem}>
				<ContenidoItem item={item} />
			</EnlaceDestino>
		);
	} else if (!item.pronto && item.onClick) {
		cuerpo = (
			<button
				type="button"
				onClick={item.onClick}
				className={cn(claseItem, "cursor-pointer")}
			>
				<ContenidoItem item={item} />
			</button>
		);
	} else {
		cuerpo = (
			<span className={claseItem}>
				<ContenidoItem item={item} />
			</span>
		);
	}
	return (
		<li className="flex items-center gap-1">
			{cuerpo}
			{item.info ? <InfoTooltip>{item.info}</InfoTooltip> : null}
		</li>
	);
}

function BarraAprobaciones({
	pendientes,
	resueltasHoy,
}: PendientesHoyProps["aprobaciones"]) {
	const total = (pendientes ?? 0) + (resueltasHoy ?? 0);
	const texto =
		resueltasHoy !== null && pendientes !== null
			? `${resueltasHoy.toLocaleString("es-GT")} de ${total.toLocaleString("es-GT")} aprobaciones resueltas hoy`
			: `— de ${pendientes === null ? "—" : pendientes.toLocaleString("es-GT")} aprobaciones resueltas hoy`;
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
			<Progress
				size="sm"
				tone="success"
				value={resueltasHoy ?? 0}
				max={total || 1}
				aria-label="Aprobaciones resueltas hoy"
				className="w-30"
			/>
			<span className="type-caption text-fg-secondary">{texto}</span>
			{resueltasHoy === null ? (
				<InfoTooltip>
					Pronto: el conteo de aprobaciones resueltas hoy todavía no está
					disponible. El total es lo que espera su decisión ahora.
				</InfoTooltip>
			) : null}
		</div>
	);
}

export function PendientesHoy({
	items,
	aprobaciones,
	cargando,
	tareas,
}: PendientesHoyProps) {
	return (
		<section
			aria-labelledby="pendientes-hoy-titulo"
			className="flex flex-col gap-4 rounded-2xl border border-brand/30 bg-brand-subtle/40 px-5 py-5 sm:px-6"
		>
			<div className="flex items-center gap-2.5">
				<CalendarDays aria-hidden className="size-5 shrink-0 text-fg" />
				<h2 id="pendientes-hoy-titulo" className="type-heading-md text-fg">
					Sus pendientes de hoy
				</h2>
			</div>
			{cargando ? (
				<div className="flex flex-col gap-3" aria-hidden>
					<Skeleton className="h-3 w-64" />
					<Skeleton className="h-5 w-full" />
				</div>
			) : (
				<>
					<BarraAprobaciones {...aprobaciones} />
					<ul className="flex flex-wrap items-center gap-x-7 gap-y-3">
						{items.map((item) => (
							<Item key={item.clave} item={item} />
						))}
					</ul>
				</>
			)}
			{tareas}
		</section>
	);
}
