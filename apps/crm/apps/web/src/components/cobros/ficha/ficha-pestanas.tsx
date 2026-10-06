import {
	ChevronDown,
	CircleCheck,
	Clock,
	FileText,
	Send,
	Sparkles,
	TriangleAlert,
} from "lucide-react";
import * as React from "react";
import {
	CrmCard,
	CrmDivider,
	CrmPill,
	type CrmTone,
	crmText,
} from "@/components/ds/cards-credito";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Ficha 360 · pestañas — Figma «CRM Ventas» › Asesor Junior › 04 · Ficha 360:
 * Historial (409:2923 actual, 1370:91 histórico), Estado de cuenta (412:3245),
 * Documentos (414:3423) y Asistente IA (3011:19436). Solo presentación.
 */

/** Rótulo de sección: "HISTORIAL DEL CRÉDITO · 8 GESTIONES". */
export function RotuloSeccion({ children }: { children: React.ReactNode }) {
	return (
		<p className="font-semibold text-[11px] text-fg-tertiary uppercase tracking-wide">
			{children}
		</p>
	);
}

/** Aviso de un bloque que espera backend (se ve, pero no promete datos). */
export function PendienteBackend({
	titulo = "Pronto",
	children,
	className,
}: {
	titulo?: React.ReactNode;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex items-start gap-3 rounded-xl border border-line border-dashed bg-muted/40 px-4 py-3.5",
				className,
			)}
		>
			<Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-tertiary" />
			<div className="flex flex-col gap-0.5">
				<span className="font-semibold text-fg text-sm">{titulo}</span>
				<span className="text-fg-secondary text-xs leading-relaxed">
					{children}
				</span>
			</div>
		</div>
	);
}

/* ── Historial actual ───────────────────────────────────────────────────────── */

export type TonoGestion = "logrado" | "sin-contacto" | "fallido" | "neutro";

const PUNTO: Record<TonoGestion, string> = {
	logrado: "bg-success-solid",
	"sin-contacto": "bg-warning-solid",
	fallido: "bg-danger-solid",
	neutro: "bg-fg-tertiary",
};

export type ItemGestion = {
	id: string;
	/** "20 jul · 10:30". */
	cuando: string;
	/** "Llamada — Contactado". */
	titulo: React.ReactNode;
	/** Badge junto al título (estado de la gestión). */
	badge?: React.ReactNode;
	/** "Ana G. (asesor)". */
	subtitulo?: React.ReactNode;
	tono: TonoGestion;
	/** Comentario principal (franja de nota, plegable). */
	nota?: string | null;
	/** Lo demás de la gestión: acuerdos, compromisos, próximo paso, duración. */
	detalles?: Array<{ label: string; valor: React.ReactNode }>;
	/** Monto u otro dato a la derecha del título. */
	derecha?: React.ReactNode;
	/** Siempre visible bajo el subtítulo (acciones, avisos). */
	extra?: React.ReactNode;
	/** Contenido propio del detalle plegable (lista de links, interacciones…). */
	detalleNodo?: React.ReactNode;
	/** Texto de la franja plegable cuando no hay nota. */
	detalleEtiqueta?: string;
};

function NotaGestion({
	nota,
	detalles,
	detalleNodo,
	detalleEtiqueta = "Ver detalle de la gestión",
}: {
	nota?: string | null;
	detalles?: ItemGestion["detalles"];
	detalleNodo?: React.ReactNode;
	detalleEtiqueta?: string;
}) {
	const [abierta, setAbierta] = React.useState(false);
	const hayDetalles = (detalles?.length ?? 0) > 0 || !!detalleNodo;
	if (!nota && !hayDetalles) return null;
	return (
		<div className="mt-1.5 rounded-md bg-brand-subtle/50 text-xs">
			<button
				type="button"
				onClick={() => setAbierta((v) => !v)}
				aria-expanded={abierta}
				className="flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left"
			>
				<FileText aria-hidden className="mt-px size-3.5 shrink-0 text-brand" />
				<span
					className={cn(
						"wrap-break-word min-w-0 flex-1 text-fg-secondary",
						!abierta && "line-clamp-1",
					)}
				>
					{nota || detalleEtiqueta}
				</span>
				<ChevronDown
					aria-hidden
					className={cn(
						"size-3.5 shrink-0 text-fg-tertiary transition-transform",
						abierta && "rotate-180",
					)}
				/>
			</button>
			{abierta && detalleNodo ? (
				<div className="px-3 pb-2.5 pl-8.5 text-fg">{detalleNodo}</div>
			) : null}
			{abierta && (detalles?.length ?? 0) > 0 ? (
				<dl className="flex flex-col gap-1 px-3 pb-2.5 pl-8.5">
					{detalles?.map((d) => (
						<div key={d.label} className="flex flex-wrap gap-x-1.5">
							<dt className="font-semibold text-fg">{d.label}:</dt>
							<dd className="wrap-break-word min-w-0 text-fg-secondary">
								{d.valor}
							</dd>
						</div>
					))}
				</dl>
			) : null}
		</div>
	);
}

export function HistorialGestiones({ items }: { items: ItemGestion[] }) {
	return (
		<ol className="flex flex-col">
			{items.map((g, i) => (
				<li key={g.id} className="relative flex gap-3 pb-5">
					{i < items.length - 1 ? (
						<span
							aria-hidden
							className="absolute top-3 bottom-0 left-[3px] w-px bg-divider"
						/>
					) : null}
					<span
						aria-hidden
						className={cn(
							"relative mt-1.5 size-[7px] shrink-0 rounded-full",
							PUNTO[g.tono],
						)}
					/>
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="text-[11px] text-fg-tertiary">{g.cuando}</span>
						<div className="flex flex-wrap items-center gap-2">
							<span className="font-semibold text-fg text-sm">{g.titulo}</span>
							{g.badge}
							{g.derecha ? (
								<span className="ml-auto shrink-0 font-semibold text-fg text-sm tabular-nums">
									{g.derecha}
								</span>
							) : null}
						</div>
						{g.subtitulo ? (
							<span className="text-fg-secondary text-xs">{g.subtitulo}</span>
						) : null}
						{g.extra ? <div className="mt-1">{g.extra}</div> : null}
						<NotaGestion
							nota={g.nota}
							detalles={g.detalles}
							detalleNodo={g.detalleNodo}
							detalleEtiqueta={g.detalleEtiqueta}
						/>
					</div>
				</li>
			))}
		</ol>
	);
}

/**
 * Sección del historial y de referencias: cada una en su propia tarjeta, con
 * ícono, título, contador y su acción, para que se distinga cuál es cuál.
 * Adentro va la línea de tiempo (HistorialGestiones) o el estado (cargando,
 * error con reintento, vacío) en texto discreto.
 */
export function SeccionHistorial({
	titulo,
	conteo,
	icono,
	descripcion,
	derecha,
	estado = "ok",
	vacio,
	onReintentar,
	children,
}: {
	/** "Promesas de pago". */
	titulo: React.ReactNode;
	/** Contador junto al título; `null` lo oculta. */
	conteo?: React.ReactNode;
	/** Ícono lucide de la sección. */
	icono?: React.ReactNode;
	descripcion?: React.ReactNode;
	/** Acción a la derecha del encabezado (Agregar, paginación…). */
	derecha?: React.ReactNode;
	estado?: "ok" | "cargando" | "error" | "vacio";
	/** Texto cuando no hay registros. */
	vacio?: React.ReactNode;
	onReintentar?: () => void;
	children?: React.ReactNode;
}) {
	return (
		<section className="rounded-xl border border-line-subtle bg-surface">
			<header className="flex flex-wrap items-center justify-between gap-3 border-line-subtle border-b px-4 py-3 sm:px-5">
				<div className="flex min-w-0 items-center gap-3">
					{icono ? (
						<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand [&_svg]:size-4">
							{icono}
						</span>
					) : null}
					<div className="flex min-w-0 flex-col gap-0.5">
						<h3 className="flex items-center gap-2 font-semibold text-[15px] text-fg leading-[1.26]">
							{titulo}
							{conteo !== undefined && conteo !== null ? (
								<span className="inline-flex h-5 min-w-6 items-center justify-center rounded-full bg-muted px-1.5 font-semibold text-[11px] text-fg-secondary">
									{conteo}
								</span>
							) : null}
						</h3>
						{descripcion ? (
							<p className="text-fg-tertiary text-xs leading-[1.26]">
								{descripcion}
							</p>
						) : null}
					</div>
				</div>
				{derecha}
			</header>
			<div className="px-4 py-4 sm:px-5">
				{estado === "cargando" ? (
					<p className="text-fg-tertiary text-sm">Cargando…</p>
				) : estado === "error" ? (
					<div className="flex flex-wrap items-center gap-3">
						<p className="text-fg-secondary text-sm">
							No se pudo cargar esta sección.
						</p>
						{onReintentar ? (
							<Button variant="secondary" size="sm" onClick={onReintentar}>
								Reintentar
							</Button>
						) : null}
					</div>
				) : estado === "vacio" ? (
					<p className="text-center text-fg-tertiary text-sm">{vacio}</p>
				) : (
					children
				)}
			</div>
		</section>
	);
}

/* ── Histórico (vida del crédito) ───────────────────────────────────────────── */

export function HistoricoCredito({
	hitos,
}: {
	hitos: Array<{ id: string; descripcion: string; fecha: string }>;
}) {
	return (
		<CrmCard superficie="outline" className="gap-0 p-0">
			{hitos.map((h) => (
				<div
					key={h.id}
					className="flex items-center gap-3 border-line-subtle border-b px-5 py-3.5 last:border-b-0"
				>
					<span
						aria-hidden
						className="size-1.5 shrink-0 rounded-full bg-fg-tertiary"
					/>
					<span className="min-w-0 flex-1 text-fg text-sm">
						{h.descripcion}
					</span>
					<span className="shrink-0 text-fg-tertiary text-xs">{h.fecha}</span>
				</div>
			))}
		</CrmCard>
	);
}

/* ── Estado de cuenta ───────────────────────────────────────────────────────── */

export function ResumenCuentaCard({
	saldoTotal,
	filas,
	children,
}: {
	saldoTotal: React.ReactNode;
	filas: Array<{
		label: React.ReactNode;
		valor: React.ReactNode;
		tono?: "danger" | "success";
	}>;
	/** Debajo: capital, cuota mensual, tipo de crédito, notas… */
	children?: React.ReactNode;
}) {
	return (
		<CrmCard className="gap-3 p-4">
			<span className={crmText.overline}>Resumen de cuenta</span>
			<div className="flex flex-col gap-1">
				<span className="text-[13px] text-fg">Saldo total del crédito</span>
				<span className="font-bold text-[28px] text-fg tabular-nums leading-none">
					{saldoTotal}
				</span>
			</div>
			<CrmDivider />
			<dl className="flex flex-col gap-1.5">
				{filas.map((f, i) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: lista fija de datos
						key={i}
						className="flex items-baseline justify-between gap-4"
					>
						<dt className="text-[13px] text-fg-secondary">{f.label}</dt>
						<dd
							className={cn(
								"text-right font-medium text-[13px] text-fg tabular-nums",
								f.tono === "danger" && "font-semibold text-danger-text",
								f.tono === "success" && "font-semibold text-success-text",
							)}
						>
							{f.valor}
						</dd>
					</div>
				))}
			</dl>
			{children}
		</CrmCard>
	);
}

export type EstadoCuota = "pagada" | "vencida" | "pendiente" | "validacion";

const ESTADO_CUOTA: Record<EstadoCuota, { etiqueta: string; tone: CrmTone }> = {
	pagada: { etiqueta: "Pagada", tone: "success" },
	vencida: { etiqueta: "Vencida", tone: "danger" },
	pendiente: { etiqueta: "Pendiente", tone: "warning" },
	validacion: { etiqueta: "En validación", tone: "info" },
};

/** Una cuota del plan de pagos; el detalle (pagos, desglose) va plegado. */
export function CuotaPlanFila({
	titulo,
	estado,
	monto,
	montoDetalle,
	lineas,
	chips,
	children,
}: {
	/** "Cuota 13 de 48". */
	titulo: React.ReactNode;
	estado: EstadoCuota;
	/** "Q1,850.00". */
	monto: React.ReactNode;
	/** "+Q120.00 mora". */
	montoDetalle?: React.ReactNode;
	/** "Venció 07 jul 2026", "Pagó 03 jul 2026"… */
	lineas: React.ReactNode[];
	/** Chips bajo el título: "Pagado con mora", "Abonado Q500"… */
	chips?: React.ReactNode;
	/** Detalle completo de la cuota (pagos aplicados, desglose). */
	children?: React.ReactNode;
}) {
	const [abierta, setAbierta] = React.useState(false);
	const e = ESTADO_CUOTA[estado];
	const Icono = estado === "pagada" ? CircleCheck : TriangleAlert;
	return (
		<div className="border-line-subtle border-b py-3">
			<div className="flex items-start gap-3">
				<Icono
					aria-hidden
					className={cn(
						"mt-0.5 size-4.5 shrink-0",
						estado === "pagada" && "text-fg",
						estado === "vencida" && "text-danger-solid",
						estado === "pendiente" && "text-warning-solid",
						estado === "validacion" && "text-info-text",
					)}
				/>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="font-semibold text-fg text-sm">{titulo}</span>
					{chips ? <div className="flex flex-wrap gap-1.5">{chips}</div> : null}
					{lineas.map((l, i) => (
						<span
							// biome-ignore lint/suspicious/noArrayIndexKey: líneas fijas
							key={i}
							className="text-fg-tertiary text-xs"
						>
							{l}
						</span>
					))}
					{children ? (
						<button
							type="button"
							onClick={() => setAbierta((v) => !v)}
							aria-expanded={abierta}
							className="mt-1 inline-flex w-fit cursor-pointer items-center gap-1 font-medium text-brand text-xs hover:underline"
						>
							{abierta ? "Ocultar detalle" : "Ver detalle"}
							<ChevronDown
								aria-hidden
								className={cn(
									"size-3.5 transition-transform",
									abierta && "rotate-180",
								)}
							/>
						</button>
					) : null}
				</div>
				<div className="flex shrink-0 flex-col items-end gap-1">
					<span
						className={cn(
							"font-semibold text-sm tabular-nums",
							estado === "vencida" ? "text-danger-text" : "text-fg",
						)}
					>
						{monto}
					</span>
					{montoDetalle ? (
						<span className="text-danger-text text-xs tabular-nums">
							{montoDetalle}
						</span>
					) : null}
					<CrmPill tone={e.tone} className="px-2.5 py-0.5">
						{e.etiqueta}
					</CrmPill>
				</div>
			</div>
			{abierta && children ? (
				<div className="mt-2 pl-7.5">{children}</div>
			) : null}
		</div>
	);
}

/* ── Documentos ─────────────────────────────────────────────────────────────── */

export type DocumentoFila = {
	clave: string;
	nombre: string;
	descripcion: string;
	onClick?: () => void;
	cargando?: boolean;
	/** Sin acción todavía: se ve deshabilitado con el motivo. */
	motivoDeshabilitado?: string;
};

function ListaDocumentos({
	titulo,
	docs,
	accion,
	variante,
}: {
	titulo: string;
	docs: DocumentoFila[];
	accion: string;
	variante: "default" | "secondary";
}) {
	return (
		<section className="flex flex-col gap-2">
			<RotuloSeccion>{titulo}</RotuloSeccion>
			<CrmCard superficie="outline" className="gap-0 px-3 py-1">
				{docs.map((d) => (
					<div
						key={d.clave}
						className="flex items-center gap-3 border-line-subtle border-b py-2.5 last:border-b-0"
					>
						<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-danger-subtle text-danger-text">
							<FileText aria-hidden className="size-4" />
						</span>
						<div className="flex min-w-0 flex-1 flex-col">
							<span className="font-medium text-fg text-sm">{d.nombre}</span>
							<span className="text-fg-tertiary text-xs">{d.descripcion}</span>
						</div>
						<Button
							size="sm"
							variant={variante}
							disabled={!d.onClick || d.cargando}
							loading={d.cargando}
							title={d.motivoDeshabilitado}
							onClick={d.onClick}
						>
							{d.onClick ? accion : "Pronto"}
						</Button>
					</div>
				))}
			</CrmCard>
		</section>
	);
}

export function DocumentosFicha({
	enviar,
	solicitar,
}: {
	enviar: DocumentoFila[];
	solicitar: DocumentoFila[];
}) {
	return (
		<div className="flex flex-col gap-5">
			<ListaDocumentos
				titulo="Enviar al cliente"
				docs={enviar}
				accion="Enviar"
				variante="default"
			/>
			<ListaDocumentos
				titulo="Solicitar al supervisor"
				docs={solicitar}
				accion="Solicitar"
				variante="secondary"
			/>
		</div>
	);
}

/* ── Asistente IA ───────────────────────────────────────────────────────────── */

export function AsistenteIA({
	resumen,
}: {
	resumen: { texto: string; etiquetas: string[]; generadoEn: string } | null;
}) {
	return (
		<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)]">
			<div className="flex min-h-96 flex-col gap-3">
				<div className="flex flex-1 flex-col gap-3 rounded-2xl border border-line-subtle bg-surface p-3">
					<p className="max-w-80 rounded-xl border border-line-subtle px-3 py-2 text-fg-secondary text-xs leading-relaxed">
						Hola, soy el asistente del caso. Podré resumir la situación o
						responder dudas sobre este crédito.
					</p>
				</div>
				<div className="flex items-center gap-2 rounded-full border border-line-subtle bg-surface py-1.5 pr-1.5 pl-4">
					<input
						disabled
						placeholder="Pregúntele a la IA… (pronto)"
						className="min-w-0 flex-1 bg-transparent text-fg text-sm outline-none placeholder:text-fg-tertiary disabled:cursor-not-allowed"
					/>
					<Button
						size="icon"
						disabled
						aria-label="Enviar pregunta"
						className="rounded-full"
					>
						<Send aria-hidden />
					</Button>
				</div>
			</div>
			<aside className="flex flex-col gap-2 rounded-2xl bg-brand-subtle/50 p-4">
				<span className="flex items-center gap-2 font-semibold text-brand text-sm">
					<Sparkles aria-hidden className="size-4" />
					Resumen del caso
					<CrmPill tone="brand" dot={false} className="px-1.5 py-0 text-[10px]">
						IA
					</CrmPill>
				</span>
				{resumen ? (
					<>
						<p className="text-fg-secondary text-xs leading-relaxed">
							{resumen.texto}
						</p>
						<div className="flex flex-wrap gap-1.5">
							{resumen.etiquetas.map((t) => (
								<span
									key={t}
									className="rounded-full border border-line-subtle bg-surface px-2 py-0.5 text-[11px] text-fg-secondary"
								>
									{t}
								</span>
							))}
						</div>
						<span className="text-[11px] text-fg-tertiary">
							Generado por IA · {resumen.generadoEn}
						</span>
					</>
				) : (
					<p className="text-fg-secondary text-xs leading-relaxed">
						El resumen automático del caso todavía no está activo. Cuando lo
						esté, aparecerá aquí con el estado del crédito, la última gestión y
						el riesgo de pasar al siguiente bucket.
					</p>
				)}
			</aside>
		</div>
	);
}
