/**
 * Piezas chicas de presentación que comparten la bandeja, el historial, el
 * Espacio de aprobación y las solicitudes de un asesor. Sin consultas.
 */
import type * as React from "react";
import { type Bucket, BucketBadge } from "@/components/ds/badges";
import { CrmPill } from "@/components/ds/cards-credito";
import {
	TipoCartera,
	type TipoCarteraValor,
} from "@/components/ds/cartera-chips";
import { cn } from "@/lib/utils";
import type { TipoSolicitud } from "./normalizar";

/** Tipos de la bandeja que todavía no existen (W2 y F6 de José). */
export type TipoPronto = "rebaja" | "documentos";

/**
 * Chip del tipo (Figma «Cartera/Tipo»). Mismos colores que el bloque del
 * Dashboard: convenio verde, recuperación roja, apagado ámbar, reactivación
 * azul.
 */
const CHIP_TIPO: Record<
	TipoSolicitud | TipoPronto,
	{ tono: TipoCarteraValor; etiqueta: string }
> = {
	convenio: { tono: "Convenio", etiqueta: "Convenio" },
	recuperacion: { tono: "Crítica", etiqueta: "Recuperación" },
	apagado: { tono: "Rebaja", etiqueta: "Apagado" },
	reactivacion: { tono: "Entrega", etiqueta: "Reactivación" },
	rebaja: { tono: "Rebaja", etiqueta: "Rebaja" },
	documentos: { tono: "Documentos", etiqueta: "Documentos" },
};

export function ChipTipoSolicitud({
	tipo,
	children,
	className,
}: {
	tipo: TipoSolicitud | TipoPronto;
	children?: React.ReactNode;
	className?: string;
}) {
	const t = CHIP_TIPO[tipo];
	return (
		<TipoCartera tipo={t.tono} className={className}>
			{children ?? t.etiqueta}
		</TipoCartera>
	);
}

/** Punto de color del tipo (tablas del historial y de un asesor). */
const PUNTO_TIPO: Record<string, string> = {
	convenio: "bg-success-solid",
	recuperacion: "bg-danger-solid",
	apagado: "bg-warning-solid",
	reactivacion: "bg-info-solid",
	reasignacion: "bg-warning-solid",
	traslado: "bg-warning-solid",
	baja: "bg-danger-solid",
	ausencia: "bg-danger-solid",
	reactivacion_asesor: "bg-success-solid",
};

export function TipoConPunto({
	clave,
	children,
}: {
	clave: string;
	children: React.ReactNode;
}) {
	return (
		<span className="inline-flex min-w-0 items-center gap-2 text-[13px] text-fg leading-[1.26]">
			<span
				aria-hidden
				className={cn(
					"size-1.75 shrink-0 rounded-full",
					PUNTO_TIPO[clave] ?? "bg-fg-tertiary",
				)}
			/>
			<span className="wrap-break-word min-w-0">{children}</span>
		</span>
	);
}

const BUCKETS: Bucket[] = ["B0", "B1", "B2", "B3", "B4", "B5"];

/** «B4 Pre Jurídico» (Figma: badge completa); «—» sin bucket. */
export function BucketSolicitud({
	numero,
	formato = "Completa",
}: {
	numero: number | null;
	formato?: "Completa" | "Compacta";
}) {
	const bucket = numero !== null ? BUCKETS[numero] : undefined;
	if (!bucket) {
		return numero !== null ? (
			<span className="font-semibold text-fg-secondary text-xs">B{numero}</span>
		) : (
			<span className="text-fg-tertiary">—</span>
		);
	}
	return <BucketBadge bucket={bucket} formato={formato} />;
}

/** Tono de cada resultado (texto de la columna Decisión / Estado). */
export type TonoDecision =
	| "success"
	| "danger"
	| "warning"
	| "info"
	| "neutral";

const TEXTO_TONO: Record<TonoDecision, string> = {
	success: "text-success-text",
	danger: "text-danger-text",
	warning: "text-warning-text",
	info: "text-info-text",
	neutral: "text-fg-tertiary",
};

export function TextoDecision({
	tono,
	children,
}: {
	tono: TonoDecision;
	children: React.ReactNode;
}) {
	return (
		<span
			className={cn(
				"font-semibold text-[13px] leading-[1.26]",
				TEXTO_TONO[tono],
			)}
		>
			{children}
		</span>
	);
}

/** «Pronto»: lo que el Figma pide y todavía no tiene backend. */
export function ChipPronto({ className }: { className?: string }) {
	return (
		<CrmPill
			tone="neutral"
			kind="chip"
			dot={false}
			className={cn("px-2 py-0.5 text-[11px]", className)}
		>
			Pronto
		</CrmPill>
	);
}

/* ── Formatos ───────────────────────────────────────────────────────────────── */

const MESES = [
	"ene",
	"feb",
	"mar",
	"abr",
	"may",
	"jun",
	"jul",
	"ago",
	"sep",
	"oct",
	"nov",
	"dic",
];

/** «23 sep · 10:24» en hora de Guatemala (Figma: columna Fecha). */
export function fechaHoraCorta(valor: string | Date | null | undefined) {
	if (!valor) return "—";
	const d = valor instanceof Date ? valor : new Date(valor);
	if (Number.isNaN(d.getTime())) return "—";
	const partes = new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Guatemala",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).formatToParts(d);
	const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
	const hora = v("hour") === "24" ? "00" : v("hour");
	return `${Number(v("day"))} ${MESES[Number(v("month")) - 1] ?? ""} · ${hora}:${v("minute")}`;
}

/** «5 oct» en hora de Guatemala (fechas sin hora). */
export function fechaCorta(valor: string | Date | null | undefined) {
	const completa = fechaHoraCorta(valor);
	return completa === "—" ? completa : (completa.split(" · ")[0] ?? completa);
}

/** Fecha corta de Guatemala («11/8/2026»), como el historial de antes. */
export function fechaGT(valor: string | Date | null | undefined) {
	if (!valor) return "—";
	const d = valor instanceof Date ? valor : new Date(valor);
	if (Number.isNaN(d.getTime())) return "—";
	return d.toLocaleDateString("es-GT", { timeZone: "America/Guatemala" });
}

/** «Q 9,800.00» (Figma: columna Monto). */
export function quetzales(v: number | string | null | undefined) {
	if (v === null || v === undefined || v === "") return "—";
	const n = Number(v);
	if (!Number.isFinite(n)) return "—";
	return `Q ${n.toLocaleString("es-GT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}
