/**
 * Workspace · panel de gestión: piezas de presentación compartidas por todos
 * los pasos (cabecera «‹ Atrás · Título», banda de contexto, tarjetas-fila de
 * «Otras gestiones», chips y el armazón de cada paso).
 *
 * Solo presentación: nada aquí hace queries. El panel mide 520–640px, así que
 * todo es una columna y los textos largos se cortan con `wrap-break-word`.
 */
import {
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	Clock,
	Lock,
	type LucideIcon,
} from "lucide-react";
import type * as React from "react";
import { CrmPill, type CrmTone } from "@/components/ds/cards-credito";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ── Armazón de un paso ─────────────────────────────────────────────────────── */

/**
 * Cabecera fija, cuerpo con scroll propio y pie fijo. `formulario` deja el
 * cuerpo sin scroll: los formularios embebidos traen su propio cuerpo con
 * scroll y su pie («Cancelar» + acción principal).
 */
export function PasoGestion({
	cabecera,
	pie,
	formulario = false,
	children,
	className,
}: {
	cabecera?: React.ReactNode;
	pie?: React.ReactNode;
	formulario?: boolean;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("@container flex min-h-0 flex-1 flex-col", className)}>
			{cabecera ? <div className="shrink-0">{cabecera}</div> : null}
			<div
				className={cn(
					"min-h-0 flex-1 px-5",
					// Los formularios traen su pie con `border-t pt-3`: con `pb-3`
					// queda igual que el pie de los demás pasos (`py-3`).
					formulario ? "flex flex-col pb-3" : "overflow-y-auto pb-4",
				)}
			>
				{children}
			</div>
			{pie ? (
				<footer className="shrink-0 border-line-subtle border-t px-5 py-3">
					{pie}
				</footer>
			) : null}
		</div>
	);
}

/** «‹ Atrás · Título» (Figma: cabecera de cada paso). */
export function CabeceraPaso({
	titulo,
	descripcion,
	onAtras,
	className,
}: {
	titulo: React.ReactNode;
	descripcion?: React.ReactNode;
	/** Sin handler no se muestra «Atrás». */
	onAtras?: () => void;
	className?: string;
}) {
	return (
		<header className={cn("flex flex-col gap-1 px-5 pt-4 pb-3", className)}>
			<div className="flex min-w-0 items-center gap-1.5">
				{onAtras ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="-ml-2 h-8 shrink-0 gap-1 px-2 font-medium text-fg-secondary"
						onClick={onAtras}
					>
						<ChevronLeft aria-hidden className="size-4" />
						Atrás
					</Button>
				) : null}
				<h2 className="wrap-break-word min-w-0 font-semibold text-base text-fg leading-[1.26]">
					{titulo}
				</h2>
			</div>
			{descripcion ? (
				<p className="wrap-break-word text-fg-secondary text-sm leading-snug">
					{descripcion}
				</p>
			) : null}
		</header>
	);
}

/** Rótulo pequeño de sección («Gestión», «Otras gestiones»). */
export function RotuloGestion({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"font-semibold text-[11px] text-fg-tertiary uppercase leading-[1.26] tracking-wide",
				className,
			)}
		>
			{children}
		</span>
	);
}

/* ── Banda de contexto ──────────────────────────────────────────────────────── */

const BANDA_TONO: Record<
	"brand" | "success" | "warning" | "info",
	{ caja: string; punto: string }
> = {
	brand: { caja: "bg-brand-subtle text-brand", punto: "bg-brand" },
	success: {
		caja: "bg-success-subtle text-success-text",
		punto: "bg-success-solid",
	},
	warning: {
		caja: "bg-warning-subtle text-warning-text",
		punto: "bg-warning-solid",
	},
	info: { caja: "bg-info-subtle text-info-text", punto: "bg-info-solid" },
};

/**
 * Banda con punto (Figma: «En llamada · 01:24», «WhatsApp · atendiendo al
 * cliente», «WhatsApp · enviado · esperando respuesta»). No hay PBX: la banda
 * describe la gestión que se registra, sin cronómetro.
 */
export function BandaContexto({
	tono = "success",
	children,
	accion,
	className,
}: {
	tono?: keyof typeof BANDA_TONO;
	children: React.ReactNode;
	/** A la derecha: «Cambiar participante». */
	accion?: React.ReactNode;
	className?: string;
}) {
	const t = BANDA_TONO[tono];
	return (
		<div
			className={cn(
				"flex min-w-0 items-center gap-2.5 rounded-lg px-3 py-2",
				t.caja,
				className,
			)}
		>
			<span
				aria-hidden
				className={cn("size-2 shrink-0 rounded-full", t.punto)}
			/>
			<span className="wrap-break-word min-w-0 flex-1 font-medium text-[13px] leading-snug">
				{children}
			</span>
			{accion ? <span className="shrink-0">{accion}</span> : null}
		</div>
	);
}

/* ── Tarjetas-fila («Otras gestiones», opciones de acuerdo) ──────────────────── */

export type TonoAccion = "brand" | "success" | "warning" | "danger" | "info";

const ICONO_TONO: Record<TonoAccion, string> = {
	brand: "bg-brand-subtle text-brand",
	success: "bg-success-subtle text-success-text",
	warning: "bg-warning-subtle text-warning-text",
	danger: "bg-danger-subtle text-danger-text",
	info: "bg-info-subtle text-info-text",
};

/** Una gestión del hub o una opción de acuerdo. */
export type AccionGestion = {
	id: string;
	icono: LucideIcon;
	titulo: string;
	subtitulo?: string | null;
	tono?: TonoAccion;
	/** Bloqueada por el estado del caso: se ve deshabilitada con este motivo. */
	motivoBloqueo?: string | null;
	/** No existe todavía en el sistema: deshabilitada con el chip «Pronto». */
	pronto?: boolean;
	/** Gestión de alto impacto (apagado): borde rojo y chip «Crítica». */
	critica?: boolean;
	onClick?: () => void;
};

export type GrupoGestiones = {
	id: string;
	titulo: string;
	acciones: AccionGestion[];
};

export function FilaGestion({
	icono: Icono,
	titulo,
	subtitulo,
	tono = "brand",
	motivoBloqueo,
	pronto,
	critica,
	onClick,
}: AccionGestion) {
	const deshabilitada = !!pronto || !!motivoBloqueo || !onClick;
	return (
		<button
			type="button"
			disabled={deshabilitada}
			onClick={onClick}
			className={cn(
				"group flex w-full min-w-0 items-center gap-3 rounded-xl border bg-surface px-3.5 text-left outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring",
				critica && !deshabilitada
					? "border-danger-solid"
					: "border-line-subtle",
				// Deshabilitada o «Pronto»: más baja y atenuada (R2-7).
				deshabilitada
					? "cursor-not-allowed py-2.5 opacity-70"
					: "cursor-pointer py-3 hover:bg-muted/60",
				!deshabilitada && !critica && "hover:border-line",
			)}
		>
			<span
				aria-hidden
				className={cn(
					"flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4.5",
					deshabilitada ? "bg-muted text-fg-tertiary" : ICONO_TONO[tono],
				)}
			>
				<Icono />
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
					<span
						className={cn(
							"wrap-break-word min-w-0 font-semibold text-sm leading-[1.26]",
							deshabilitada ? "text-fg-secondary" : "text-fg",
						)}
					>
						{titulo}
					</span>
					{pronto ? <ChipPronto /> : null}
					{critica ? <ChipCritica /> : null}
				</span>
				{subtitulo ? (
					<span className="wrap-break-word text-fg-secondary text-xs leading-snug">
						{subtitulo}
					</span>
				) : null}
				{motivoBloqueo && !pronto ? (
					<span className="flex items-start gap-1 text-warning-text text-xs leading-snug">
						<Lock aria-hidden className="mt-px size-3 shrink-0" />
						<span className="wrap-break-word min-w-0">{motivoBloqueo}</span>
					</span>
				) : null}
			</span>
			{deshabilitada ? null : (
				<ChevronRight
					aria-hidden
					className="size-4 shrink-0 text-fg-tertiary transition-transform group-hover:translate-x-0.5"
				/>
			)}
		</button>
	);
}

/** Lista de tarjetas-fila con su rótulo. */
export function ListaGestiones({
	titulo,
	acciones,
	className,
}: {
	titulo?: string;
	acciones: AccionGestion[];
	className?: string;
}) {
	if (acciones.length === 0) return null;
	return (
		<section className={cn("flex flex-col gap-2", className)}>
			{titulo ? <RotuloGestion>{titulo}</RotuloGestion> : null}
			<ul className="flex flex-col gap-2">
				{acciones.map((a) => (
					<li key={a.id}>
						<FilaGestion {...a} />
					</li>
				))}
			</ul>
		</section>
	);
}

/* ── Chips ──────────────────────────────────────────────────────────────────── */

/** «Pronto»: la gestión existe en el Figma pero el backend todavía no. */
export function ChipPronto() {
	return (
		<CrmPill tone="neutral" kind="chip" dot={false} className="px-2 py-0.5">
			Pronto
		</CrmPill>
	);
}

/** «Crítica»: la gestión tiene consecuencias fuertes (apagado de la unidad). */
export function ChipCritica() {
	return (
		<CrmPill tone="danger" kind="chip" dot={false} className="px-2 py-0.5">
			Crítica
		</CrmPill>
	);
}

/** «Guardado en el historial · hoy» (Figma: chip verde con check). */
export function ChipGuardado({
	children = "Guardado en el historial · hoy",
	tono = "success",
}: {
	children?: React.ReactNode;
	tono?: CrmTone;
}) {
	return (
		<CrmPill tone={tono} kind="chip" dot={false} className="whitespace-normal">
			{tono === "success" ? (
				<CheckCircle2 aria-hidden className="size-3.5 shrink-0" />
			) : (
				<Clock aria-hidden className="size-3.5 shrink-0" />
			)}
			{children}
		</CrmPill>
	);
}

/* ── Textos comunes ─────────────────────────────────────────────────────────── */

/** Resultado de un contacto, en las palabras del Figma (con trato de usted). */
export const ETIQUETA_RESULTADO: Record<string, string> = {
	contactado: "Contactado · sin acuerdo de pago",
	acuerdo_parcial: "Acuerdo parcial",
	rechaza_pagar: "Rechaza pagar",
	no_contesta: "El cliente no respondió",
	numero_equivocado: "Número equivocado",
	mensaje_enviado: "Mensaje enviado",
	promesa_pago: "Promesa de pago",
	pago_registrado: "Pago registrado",
	link_pago_generado: "Link de pago generado",
};

export function etiquetaResultado(estado: string | null | undefined): string {
	if (!estado) return "—";
	return ETIQUETA_RESULTADO[estado] ?? estado.replaceAll("_", " ");
}

/** «Hoy · 10:04» (hora de Guatemala). */
export function hoyConHora(fecha: Date = new Date()): string {
	const hora = fecha.toLocaleTimeString("es-GT", {
		timeZone: "America/Guatemala",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
	return `Hoy · ${hora}`;
}
