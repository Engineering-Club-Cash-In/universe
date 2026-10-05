import {
	FilePenLine,
	Handshake,
	type LucideIcon,
	MapPin,
	MessageCircle,
	Phone,
	RefreshCw,
} from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Timeline de cobranza — Figma "03 · Componentes CRM".
 *
 *   TimelineItem → "Sección: Timeline Item › Timeline/Item" (91:967)
 *                  Tipo=Llamada|WhatsApp|Promesa|Convenio|Visita|Sistema → `tipo`.
 *                  Textos: usuario → `usuario`; pill → `etiqueta` (por defecto, el tipo);
 *                  "Resultado:" → `resultadoLabel`; descripción → `descripcion`;
 *                  "10 jul 2026" → `fecha`; "14:32" → `hora` (ya formateados).
 *   Timeline     → "Sección: Timeline › Timeline" (131:1885)
 *                  "Historial de Cobranza" → `titulo`; "Ver todo" → `onVerTodo` (botón) o
 *                  `accion` (slot, p. ej. un <Link>); filas → `children` (TimelineItem).
 *
 * Desvíos/notas:
 *  - Los frames "rail", "content", "head" y "meta" tienen relleno neutral/0 en Figma; se dejan
 *    transparentes para que el ítem funcione sobre cualquier superficie y en modo oscuro.
 *  - La descripción tiene ancho fijo (351px) en Figma; aquí ocupa el ancho disponible y hace
 *    wrap en su columna (en Figma se recorta).
 *  - Color del ícono (override en Figma): Llamada bucket/b0/fg, WhatsApp status/success/alt-fg,
 *    Promesa bucket/b2 (primitivo = `text-bucket-b2`, igual en ambos modos), Convenio info/700
 *    (= `text-info-text`, que en oscuro pasa a info/100), Visita bucket/b3/fg, Sistema neutral/700.
 *  - Sistema usa primitivos neutral/200 + neutral/700 → se agregan sus `dark:`.
 *  - Íconos de 14px con trazo de 2px absoluto (`absoluteStrokeWidth`), como el vector de Figma.
 *  - Radio del Timeline radius/lg (20) → `rounded-2xl`.
 */

export type TimelineTipo =
	| "Llamada"
	| "WhatsApp"
	| "Promesa"
	| "Convenio"
	| "Visita"
	| "Sistema";

const timelineTone: Record<
	TimelineTipo,
	{ icon: LucideIcon; bg: string; pill: string; fg: string; iconFg: string }
> = {
	Llamada: {
		icon: Phone,
		bg: "bg-bucket-b0-bg",
		pill: "bg-bucket-b0-bg/60",
		fg: "text-bucket-b0-fg",
		iconFg: "text-bucket-b0-fg",
	},
	WhatsApp: {
		icon: MessageCircle,
		bg: "bg-success-alt-bg",
		pill: "bg-success-alt-bg/60",
		fg: "text-success-alt-fg",
		iconFg: "text-success-alt-fg",
	},
	Promesa: {
		icon: Handshake,
		bg: "bg-warning-subtle",
		pill: "bg-warning-subtle/60",
		fg: "text-warning-text",
		iconFg: "text-bucket-b2",
	},
	Convenio: {
		icon: FilePenLine,
		bg: "bg-info-subtle",
		pill: "bg-info-subtle/60",
		fg: "text-info-text",
		iconFg: "text-info-text",
	},
	Visita: {
		icon: MapPin,
		bg: "bg-accent-alt",
		pill: "bg-accent-alt/60",
		fg: "text-bucket-b3-fg",
		iconFg: "text-bucket-b3-fg",
	},
	Sistema: {
		icon: RefreshCw,
		bg: "bg-cci-neutral-200 dark:bg-cci-carbon-750",
		pill: "bg-cci-neutral-200/60 dark:bg-cci-carbon-750/60",
		fg: "text-cci-neutral-700 dark:text-cci-neutral-300",
		iconFg: "text-cci-neutral-700 dark:text-cci-neutral-300",
	},
};

export type TimelineItemProps = Omit<
	React.ComponentProps<"div">,
	"children"
> & {
	tipo: TimelineTipo;
	/** Quien registró el evento: "Carlos Ramírez". */
	usuario: React.ReactNode;
	/** Texto de la pill; por defecto, el tipo. */
	etiqueta?: React.ReactNode;
	/** Prefijo en negrita de la descripción. `null` lo oculta. */
	resultadoLabel?: React.ReactNode;
	descripcion: React.ReactNode;
	/** Fecha ya formateada: "10 jul 2026". */
	fecha: React.ReactNode;
	/** Hora ya formateada: "14:32". */
	hora?: React.ReactNode;
};

export function TimelineItem({
	tipo,
	usuario,
	etiqueta,
	resultadoLabel = "Resultado:",
	descripcion,
	fecha,
	hora,
	className,
	...props
}: TimelineItemProps) {
	const tone = timelineTone[tipo];
	const Icon = tone.icon;
	return (
		<div
			data-slot="timeline-item"
			data-tipo={tipo}
			className={cn("flex gap-3", className)}
			{...props}
		>
			{/* rail: ícono + línea vertical */}
			<div className="flex w-8 shrink-0 flex-col items-center">
				<span
					className={cn(
						"flex w-8 shrink-0 items-center justify-center rounded-full py-1",
						tone.bg,
					)}
				>
					<Icon
						aria-hidden
						className={tone.iconFg}
						size={14}
						strokeWidth={2}
						absoluteStrokeWidth
					/>
				</span>
				<span aria-hidden className="w-0.5 flex-1 bg-divider" />
			</div>
			{/* content */}
			<div className="flex min-w-0 flex-1 flex-col gap-1 px-0.5 pt-1 pb-4">
				<div className="flex flex-wrap items-center gap-2">
					<span className="font-semibold text-[13px] text-fg leading-[1.26]">
						{usuario}
					</span>
					<span
						className={cn(
							"inline-flex items-center rounded-full px-2 py-0.5 font-medium text-[10px] leading-[1.26]",
							tone.pill,
							tone.fg,
						)}
					>
						{etiqueta ?? tipo}
					</span>
				</div>
				<div className="flex gap-1 text-[13px] leading-[1.26]">
					{resultadoLabel != null ? (
						<span className="shrink-0 font-semibold text-fg">
							{resultadoLabel}
						</span>
					) : null}
					<p className="min-w-0 flex-1 text-fg-secondary">{descripcion}</p>
				</div>
				<div className="flex items-center gap-1.5 text-[11px] text-fg-tertiary leading-[1.26]">
					<span>{fecha}</span>
					{hora != null ? (
						<>
							<span aria-hidden>·</span>
							<span>{hora}</span>
						</>
					) : null}
				</div>
			</div>
		</div>
	);
}

export function Timeline({
	titulo = "Historial de Cobranza",
	onVerTodo,
	accion,
	children,
	className,
	...props
}: React.ComponentProps<"section"> & {
	titulo?: React.ReactNode;
	/** Muestra el enlace "Ver todo" en el encabezado. */
	onVerTodo?: () => void;
	/** Reemplaza "Ver todo" por otro elemento (p. ej. un <Link>). */
	accion?: React.ReactNode;
}) {
	return (
		<section
			data-slot="timeline"
			className={cn(
				"flex w-full max-w-120 flex-col gap-4 rounded-2xl bg-surface p-6 shadow-clay-raised",
				className,
			)}
			{...props}
		>
			<header className="flex items-center justify-between gap-2">
				<h3 className="font-semibold text-base text-fg leading-[1.26]">
					{titulo}
				</h3>
				{accion ??
					(onVerTodo ? (
						<button
							type="button"
							onClick={onVerTodo}
							className="cursor-pointer rounded-sm font-semibold text-[13px] text-brand leading-[1.26] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
						>
							Ver todo
						</button>
					) : null)}
			</header>
			<div className="flex flex-col">{children}</div>
		</section>
	);
}
