/**
 * «Espacio de aprobación» (Figma 3699:5850 · Convenio, 3699:6285 · Entrega,
 * 3329:7989 · Acción crítica y los frames «WS Aprob · * · Resuelto»): el
 * modal de dos paneles que se abre al hacer clic en una solicitud.
 *
 *  - Izquierda, «Contexto del caso»: el MISMO panel del Workspace
 *    (`ContextoCaso` + `useCasoWorkspace`) en modo solo lectura.
 *  - Derecha, la solicitud según su tipo, con «Notas del supervisor» y los
 *    botones Rechazar y Aprobar.
 *
 * Las decisiones NO tienen lógica propia: abren los modales de siempre
 * (`ConvenioAprobacionModal`, `DecisionInmovilizacionModal`,
 * `DecidirSolicitudDialog`), con su validación, idempotencia e invalidaciones.
 * Las notas del supervisor llegan a esos modales como motivo inicial del
 * rechazo. Al confirmarse, el panel pasa a «Resuelto».
 *
 * Piezas:
 *  - `MarcoEspacioAprobacion` y `PanelSolicitudVista`: presentación (las usa
 *    el showcase).
 *  - `EspacioAprobacion` + `useEspacioAprobacion`: el modal conectado.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	Info,
	Pencil,
	TriangleAlert,
	XIcon,
} from "lucide-react";
import * as React from "react";
import {
	ESTADOS_VEHICULO,
	etiquetaMotivo,
} from "server/src/lib/recuperacion-vehiculo";
import { ConvenioAprobacionModal } from "@/components/cobros/convenio-aprobacion-modal";
import { DecisionPorConfirmarBanner } from "@/components/cobros/decision-por-confirmar-banner";
import { DecisionInmovilizacionModal } from "@/components/cobros/inmovilizacion-decision-modal";
import { RespaldoReactivacionResumen } from "@/components/cobros/inmovilizacion-respaldo";
import { UbicacionGuardada } from "@/components/cobros/inmovilizacion-ubicacion";
import {
	ChecklistVista,
	DecidirSolicitudDialog,
} from "@/components/cobros/recuperacion-checklist";
import {
	haceCuanto,
	nombreCorto,
} from "@/components/cobros/supervision/formato";
import { ContextoCaso } from "@/components/cobros/workspace/contexto-caso";
import { ChipGuardado } from "@/components/cobros/workspace/gestion/piezas";
import { useCasoWorkspace } from "@/components/cobros/workspace/use-caso-workspace";
import { CrmPill } from "@/components/ds/cards-credito";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	overlayCloseButtonClassName,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PeriodSelector } from "@/components/ui/period-selector";
import { PopoverPortalContext } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import {
	type ConvenioDecisionIntento,
	listarIntentosPendientes,
	suscribirseAIntentos,
} from "@/lib/cobros/decision-intentos";
import { cn } from "@/lib/utils";
import { googleMapsUrl } from "@/routes/cobros/-gps-ficha";
import { orpc } from "@/utils/orpc";
import type {
	RecuperacionFuente,
	Solicitud,
	TipoSolicitud,
} from "./normalizar";
import { ChipPronto, ChipTipoSolicitud, quetzales } from "./piezas";

/* ── Textos por tipo ────────────────────────────────────────────────────────── */

/** «Espacio de aprobación · …» (Figma: Convenio, Entrega, Acción crítica). */
const TITULO_MODAL: Record<TipoSolicitud, string> = {
	convenio: "Convenio",
	apagado: "Apagado",
	reactivacion: "Reactivación",
	recuperacion: "Recuperación del vehículo",
};

const TITULO_SOLICITUD: Record<TipoSolicitud, string> = {
	convenio: "Solicitud de convenio",
	apagado: "Autorizar apagado del vehículo",
	reactivacion: "Autorizar reactivación del vehículo",
	recuperacion: "Autorizar recuperación del vehículo",
};

const BOTON_APROBAR: Record<TipoSolicitud, string> = {
	convenio: "Aprobar",
	apagado: "Autorizar apagado",
	reactivacion: "Autorizar reactivación",
	// Mismo texto que el diálogo de decisión (DecidirSolicitudDialog).
	recuperacion: "Aprobar y enviar a B4",
};

/** Mínimo del motivo de rechazo de cada decisión (lo exige el servidor). */
const MINIMO_MOTIVO: Record<TipoSolicitud, number> = {
	convenio: 5,
	apagado: 5,
	reactivacion: 5,
	recuperacion: 10,
};

export type ResolucionSolicitud = {
	decision: "aprobada" | "rechazada";
	titulo: string;
	descripcion: string;
};

/** Lo que muestra «Resuelto» según el tipo y la decisión. */
export function resolucionDe(
	tipo: TipoSolicitud,
	decision: "aprobada" | "rechazada",
): ResolucionSolicitud {
	const aprobada = decision === "aprobada";
	switch (tipo) {
		case "convenio":
			return aprobada
				? {
						decision,
						titulo: "Convenio aprobado",
						descripcion:
							"El convenio pasó a activo: el cliente paga la cuota del convenio junto con la cuota normal desde el próximo ciclo. Se avisó al asesor.",
					}
				: {
						decision,
						titulo: "Convenio rechazado",
						descripcion:
							"Se eliminó el convenio y se recalculó la mora del crédito con las cuotas vencidas reales. Se avisó al asesor.",
					};
		case "apagado":
		case "reactivacion": {
			const accion = tipo === "apagado" ? "apagado" : "reactivación";
			return aprobada
				? {
						decision,
						titulo:
							tipo === "apagado"
								? "Apagado autorizado"
								: "Reactivación autorizada",
						descripcion: `La ${tipo === "apagado" ? "solicitud de apagado" : "solicitud de reactivación"} quedó aprobada. El asesor registra la ejecución en la Ficha 360, con la confirmación de LEGION.`,
					}
				: {
						decision,
						titulo: "Solicitud rechazada",
						descripcion: `La solicitud de ${accion} quedó rechazada con su motivo.`,
					};
		}
		case "recuperacion":
			return aprobada
				? {
						decision,
						titulo: "Recuperación aprobada",
						descripcion:
							"El crédito pasó a B4 en estado En recuperación, con el asesor de ese bucket.",
					}
				: {
						decision,
						titulo: "Recuperación rechazada",
						descripcion:
							"El crédito permanece en su bucket. Se notificó el motivo a quien solicitó la recuperación.",
					};
	}
}

/* ── Piezas del panel derecho ───────────────────────────────────────────────── */

function Bloque({
	titulo,
	children,
	className,
}: {
	titulo?: React.ReactNode;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<section
			className={cn(
				"flex flex-col gap-2.5 rounded-xl bg-canvas px-4 py-3.5",
				className,
			)}
		>
			{titulo ? (
				<h3 className="font-semibold text-[13px] text-fg leading-[1.26]">
					{titulo}
				</h3>
			) : null}
			{children}
		</section>
	);
}

function Dato({
	etiqueta,
	children,
	tono,
}: {
	etiqueta: React.ReactNode;
	children: React.ReactNode;
	tono?: "brand" | "danger" | "success";
}) {
	return (
		<div className="flex min-w-0 items-baseline justify-between gap-4">
			<dt className="shrink-0 text-[13px] text-fg-secondary">{etiqueta}</dt>
			<dd
				className={cn(
					"wrap-break-word min-w-0 text-right font-semibold text-[13px] text-fg tabular-nums",
					tono === "brand" && "text-brand",
					tono === "danger" && "text-danger-text",
					tono === "success" && "text-success-text",
				)}
			>
				{children}
			</dd>
		</div>
	);
}

function Nota({
	titulo,
	children,
}: {
	titulo: string;
	children: React.ReactNode;
}) {
	return (
		<section className="flex flex-col gap-1">
			<h3 className="font-semibold text-[13px] text-fg leading-[1.26]">
				{titulo}
			</h3>
			<div className="wrap-break-word text-[13px] text-fg-secondary leading-snug">
				{children}
			</div>
		</section>
	);
}

function Aviso({
	tono,
	children,
}: {
	tono: "danger" | "warning" | "info";
	children: React.ReactNode;
}) {
	return (
		<div
			className={cn(
				"flex items-start gap-2 rounded-lg px-3 py-2.5 text-[13px] leading-snug",
				tono === "danger" && "bg-danger-subtle text-danger-text",
				tono === "warning" && "bg-warning-subtle text-warning-text",
				tono === "info" && "bg-info-subtle text-info-text",
			)}
		>
			{tono === "info" ? (
				<Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
			) : (
				<TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
			)}
			<div className="wrap-break-word min-w-0">{children}</div>
		</div>
	);
}

/** «El crédito X» si la recuperación no trae nombre (como la bandeja de antes). */
export function quienEsRecuperacion(r: RecuperacionFuente) {
	return r.cliente?.trim() ? r.cliente.trim() : `El crédito ${r.numeroSifco}`;
}

function DetalleConvenio({
	solicitud,
}: {
	solicitud: Extract<Solicitud, { tipo: "convenio" }>;
}) {
	const c = solicitud.convenio;
	return (
		<>
			<Bloque titulo="Plan propuesto por el asesor">
				<dl className="flex flex-col gap-2">
					<Dato etiqueta="Total del convenio (deuda vencida)">
						{quetzales(c.monto_total_convenio)}
					</Dato>
					<Dato etiqueta="Nº de cuotas">{c.numero_meses ?? "—"}</Dato>
					<Dato etiqueta="Cuota mensual" tono="brand">
						{quetzales(c.cuota_mensual)}
					</Dato>
					{/* TODO(José) · tarea M4: fecha del primer pago de un convenio
					    pendiente (cartera solo devuelve el plan de cuotas de los
					    convenios activos). */}
					<Dato etiqueta="Primer pago">
						<span className="inline-flex items-center gap-1.5 font-normal text-fg-tertiary">
							—
							<ChipPronto />
						</span>
					</Dato>
					<Dato etiqueta="Bucket antes del convenio">
						{c.bucket_previo_prefijo ||
							(c.bucket_previo != null ? `B${c.bucket_previo}` : "Sin traza")}
					</Dato>
				</dl>
			</Bloque>
			<Nota titulo="Nota del asesor">
				{c.motivo?.trim() ? c.motivo : "El asesor no dejó una nota."}
			</Nota>
		</>
	);
}

function DetalleInmovilizacion({
	solicitud,
	conMapa,
}: {
	solicitud: Extract<Solicitud, { tipo: "apagado" | "reactivacion" }>;
	conMapa: boolean;
}) {
	const i = solicitud.inmovilizacion;
	const apagado = solicitud.tipo === "apagado";
	return (
		<>
			{solicitud.porEjecutar ? (
				<Aviso tono="info">
					Aprobada y pendiente de ejecución. Lo registra el asesor en la Ficha
					360, con la confirmación de LEGION; aquí solo se muestra lo pendiente.
				</Aviso>
			) : apagado ? (
				<Aviso tono="danger">
					Acción crítica: al aprobar, LEGION apaga la unidad. Revise dónde
					estaba el vehículo al solicitarlo y si iba en marcha.
				</Aviso>
			) : null}
			<Bloque titulo="Estado del vehículo al solicitar">
				{i.ubicacionSolicitud ? (
					<UbicacionGuardada
						ubicacion={
							i.ubicacionSolicitud as React.ComponentProps<
								typeof UbicacionGuardada
							>["ubicacion"]
						}
						conMapa={conMapa}
					/>
				) : (
					<p className="text-[13px] text-fg-tertiary">
						No se registró la ubicación al solicitar.
					</p>
				)}
				<dl className="flex flex-col gap-2">
					<Dato etiqueta="Bucket al solicitar">
						{i.bucketSnapshot != null ? `B${i.bucketSnapshot}` : "—"}
					</Dato>
				</dl>
			</Bloque>
			{!apagado ? (
				<Bloque titulo="Respaldo de la reactivación">
					<RespaldoReactivacionResumen
						bucket={
							i.bucketSnapshot != null
								? `B${i.bucketSnapshot} al solicitar`
								: null
						}
						quePaso={i.quePaso}
						respaldo={
							i.respaldoReactivacion as React.ComponentProps<
								typeof RespaldoReactivacionResumen
							>["respaldo"]
						}
					/>
					{!i.quePaso && !i.respaldoReactivacion ? (
						<p className="text-[13px] text-fg-tertiary">
							La solicitud no trae respaldo registrado.
						</p>
					) : null}
				</Bloque>
			) : null}
			<Nota titulo="Motivo del asesor">
				{i.motivo?.trim() ? i.motivo : "El asesor no dejó un motivo."}
			</Nota>
		</>
	);
}

function DetalleRecuperacion({
	solicitud,
}: {
	solicitud: Extract<Solicitud, { tipo: "recuperacion" }>;
}) {
	const r = solicitud.recuperacion;
	const motivos = (r.motivos ?? [])
		.filter((m) => m !== "otro")
		.map(etiquetaMotivo);
	const lat = r.ubicacionLat != null ? Number(r.ubicacionLat) : undefined;
	const lng = r.ubicacionLng != null ? Number(r.ubicacionLng) : undefined;
	const mapa = r.ubicacionEnlace ?? googleMapsUrl(lat, lng);
	const estadoVehiculo = r.estadoVehiculo
		? ((ESTADOS_VEHICULO as Record<string, string>)[r.estadoVehiculo] ??
			r.estadoVehiculo)
		: "No se indicó";
	return (
		<>
			<p className="text-[13px] text-fg-secondary leading-snug">
				Al aprobar, el crédito pasa a{" "}
				<strong className="font-semibold text-fg">
					B4 · Última Instancia / Pre Jurídico
				</strong>{" "}
				en estado{" "}
				<strong className="font-semibold text-fg">En recuperación</strong>, con
				el asesor de ese bucket, aunque todavía no tenga cuatro cuotas vencidas.
			</p>
			<Bloque titulo="Situación del crédito">
				<dl className="flex flex-col gap-2">
					<Dato etiqueta="Motivos">
						{motivos.length > 0 ? motivos.join(", ") : "—"}
					</Dato>
					<Dato etiqueta="Cuotas vencidas">{r.cuotasVencidas ?? "—"}</Dato>
					<Dato etiqueta="Para ponerse al día" tono="danger">
						{quetzales(r.totalParaPonerseAlDia)}
					</Dato>
					<Dato etiqueta="Saldo pendiente">{quetzales(r.saldoPendiente)}</Dato>
					<Dato etiqueta="Bucket de origen">
						{r.bucketOrigen != null ? `B${r.bucketOrigen}` : "—"}
					</Dato>
				</dl>
			</Bloque>
			<Bloque titulo="Vehículo">
				<dl className="flex flex-col gap-2">
					<Dato etiqueta="Estado">{estadoVehiculo}</Dato>
					<Dato etiqueta="Dirección">{r.ubicacionDireccion || "—"}</Dato>
				</dl>
				{mapa ? (
					<a
						href={mapa}
						target="_blank"
						rel="noopener noreferrer"
						className="w-fit rounded-sm font-medium text-[13px] text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
					>
						Abrir en el mapa
					</a>
				) : null}
			</Bloque>
			<Nota titulo="Justificación del asesor">
				{r.motivoDetalle?.trim()
					? `“${r.motivoDetalle}”`
					: "Sin justificación."}
				{r.observaciones ? (
					<p className="mt-1 text-fg-tertiary text-xs">
						Observaciones: {r.observaciones}
					</p>
				) : null}
			</Nota>
			<section className="flex flex-col gap-2">
				<h3 className="font-semibold text-[13px] text-fg leading-[1.26]">
					Checklist de gestión
				</h3>
				<ChecklistVista pasos={r.checklist ?? []} />
			</section>
		</>
	);
}

/** «Convenio aprobado» · «Guardado en el historial · hoy» (Figma «Resuelto»). */
export function ResueltoVista({
	resolucion,
	onVolver,
	onSiguiente,
}: {
	resolucion: ResolucionSolicitud;
	onVolver: () => void;
	/** undefined = no hay más solicitudes en la lista. */
	onSiguiente?: () => void;
}) {
	const aprobada = resolucion.decision === "aprobada";
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-y-auto px-6 py-8 text-center">
				<span
					aria-hidden
					className={cn(
						"mb-2 flex size-18 items-center justify-center rounded-full",
						aprobada ? "bg-success-subtle" : "bg-muted",
					)}
				>
					<span
						className={cn(
							"flex size-12 items-center justify-center rounded-full text-on-solid",
							aprobada ? "bg-success-solid" : "bg-fg-secondary",
						)}
					>
						{aprobada ? (
							<CheckCircle2 className="size-6.5" />
						) : (
							<XIcon className="size-6.5" />
						)}
					</span>
				</span>
				<h2
					aria-live="polite"
					className="wrap-break-word font-semibold text-fg text-xl leading-[1.26]"
				>
					{resolucion.titulo}
				</h2>
				<p className="wrap-break-word max-w-[46ch] text-fg-secondary text-sm leading-snug">
					{resolucion.descripcion}
				</p>
				<ChipGuardado />
			</div>
			<footer className="grid shrink-0 grid-cols-1 gap-2 border-line-subtle border-t px-5 py-3 sm:grid-cols-2">
				<Button type="button" variant="secondary" onClick={onVolver}>
					Volver a la bandeja
				</Button>
				<Button type="button" onClick={onSiguiente} disabled={!onSiguiente}>
					{onSiguiente ? (
						<>
							Siguiente solicitud
							<ChevronRight aria-hidden />
						</>
					) : (
						"No hay más solicitudes"
					)}
				</Button>
			</footer>
		</div>
	);
}

/* ── Panel derecho ──────────────────────────────────────────────────────────── */

export type PanelSolicitudVistaProps = {
	solicitud: Solicitud;
	/** Para fijar la antigüedad en el showcase. */
	ahora?: Date;
	notas: string;
	onNotas: (notas: string) => void;
	/**
	 * Sin handlers no hay botones: solicitudes por ejecutar o propias (regla de
	 * cuatro ojos).
	 */
	onAprobar?: () => void;
	onRechazar?: () => void;
	/** Los botones se ven pero no se pueden usar (con este motivo). */
	bloqueo?: string | null;
	/** Arriba del formulario (decisión por confirmar, «Su solicitud»). */
	aviso?: React.ReactNode;
	/** La decisión ya se confirmó: se muestra «Resuelto». */
	resolucion?: ResolucionSolicitud | null;
	onVolver?: () => void;
	onSiguiente?: () => void;
	/** Mapa chico de la ubicación del apagado (apagado en el showcase). */
	conMapa?: boolean;
	className?: string;
};

export function PanelSolicitudVista({
	solicitud,
	ahora = new Date(),
	notas,
	onNotas,
	onAprobar,
	onRechazar,
	bloqueo,
	aviso,
	resolucion,
	onVolver,
	onSiguiente,
	conMapa = true,
	className,
}: PanelSolicitudVistaProps) {
	const notasId = React.useId();
	if (resolucion) {
		return (
			<section
				aria-label="Solicitud resuelta"
				className={cn("flex h-full min-h-0 flex-col bg-surface", className)}
			>
				<ResueltoVista
					resolucion={resolucion}
					onVolver={onVolver ?? (() => undefined)}
					onSiguiente={onSiguiente}
				/>
			</section>
		);
	}

	const decide = !!onAprobar && !!onRechazar;
	const meta = [
		solicitud.asesor ? `Solicitada por ${nombreCorto(solicitud.asesor)}` : null,
		solicitud.solicitadoEn ? haceCuanto(solicitud.solicitadoEn, ahora) : null,
		solicitud.credito ? `Crédito #${solicitud.credito}` : null,
	]
		.filter(Boolean)
		.join(" · ");
	const minimo = MINIMO_MOTIVO[solicitud.tipo];
	const porEjecutar =
		(solicitud.tipo === "apagado" || solicitud.tipo === "reactivacion") &&
		solicitud.porEjecutar;

	return (
		<section
			aria-label="Solicitud"
			className={cn(
				"@container flex h-full min-h-0 flex-col bg-surface",
				className,
			)}
		>
			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-5 pb-5 sm:px-6">
				<div className="flex flex-col gap-2">
					<div className="flex flex-wrap items-center gap-2">
						<ChipTipoSolicitud tipo={solicitud.tipo} />
						{porEjecutar ? (
							<CrmPill tone="warning" kind="chip" className="px-2 py-0.5">
								Por ejecutar
							</CrmPill>
						) : null}
					</div>
					<h2 className="wrap-break-word font-semibold text-fg text-lg leading-[1.26]">
						{porEjecutar
							? solicitud.tipo === "apagado"
								? "Apagado aprobado, pendiente de ejecución"
								: "Reactivación aprobada, pendiente de ejecución"
							: TITULO_SOLICITUD[solicitud.tipo]}
					</h2>
					<p className="wrap-break-word text-[13px] text-fg-tertiary leading-snug">
						{meta || "—"}
					</p>
				</div>

				{aviso}

				{solicitud.tipo === "convenio" ? (
					<DetalleConvenio solicitud={solicitud} />
				) : solicitud.tipo === "recuperacion" ? (
					<DetalleRecuperacion solicitud={solicitud} />
				) : (
					<DetalleInmovilizacion solicitud={solicitud} conMapa={conMapa} />
				)}

				{decide || bloqueo ? (
					<div className="flex flex-col gap-1.5">
						<Label
							htmlFor={notasId}
							className="font-semibold text-[13px] text-fg"
						>
							Notas del supervisor
						</Label>
						<Textarea
							id={notasId}
							value={notas}
							onChange={(e) => onNotas(e.target.value)}
							placeholder="Agregue una nota (opcional)…"
							rows={3}
							disabled={!!bloqueo}
						/>
						{/* TODO(José) · tarea M3: guardar la nota del supervisor también
						    al aprobar (hoy los procedimientos solo reciben el motivo
						    del rechazo). */}
						<p className="type-caption text-fg-tertiary">
							Si rechaza la solicitud, esta nota se envía como motivo (mínimo{" "}
							{minimo} caracteres). Al aprobar no se guarda.
						</p>
					</div>
				) : null}
			</div>

			{decide || bloqueo ? (
				<footer className="flex shrink-0 flex-col gap-2 border-line-subtle border-t px-5 py-3 sm:px-6">
					{solicitud.tipo === "convenio" ? (
						// TODO(José) · tarea M4: contrapropuesta de convenio (Figma
						// «WS Aprob · Convenio · Contrapropuesta»): total, número de
						// cuotas, cuota recalculada y nota para el cliente.
						<Button
							type="button"
							variant="secondary"
							className="w-full"
							disabled
							title="Pronto: contrapropuesta del convenio"
						>
							<Pencil aria-hidden />
							Editar y contraproponer
							<ChipPronto className="ml-1" />
						</Button>
					) : null}
					<div className="grid grid-cols-2 gap-2">
						<Button
							type="button"
							variant="secondary"
							onClick={onRechazar}
							disabled={!onRechazar || !!bloqueo}
							title={bloqueo ?? undefined}
						>
							Rechazar
						</Button>
						<Button
							type="button"
							onClick={onAprobar}
							disabled={!onAprobar || !!bloqueo}
							title={bloqueo ?? undefined}
							className="whitespace-normal"
						>
							{BOTON_APROBAR[solicitud.tipo]}
						</Button>
					</div>
				</footer>
			) : null}
		</section>
	);
}

/* ── Marco de dos paneles ───────────────────────────────────────────────────── */

const OPCIONES_PANEL = [
	{ value: "contexto", label: "Contexto" },
	{ value: "solicitud", label: "Solicitud" },
] as const;

export function MarcoEspacioAprobacion({
	tipo,
	posicion,
	total,
	onAnterior,
	onSiguiente,
	onCerrar,
	contexto,
	panel,
	className,
	/** En el modal el título es el del diálogo (accesible); en el showcase, un h2. */
	enDialogo = false,
}: {
	tipo: TipoSolicitud;
	posicion: number;
	total: number;
	onAnterior?: () => void;
	onSiguiente?: () => void;
	onCerrar: () => void;
	contexto: React.ReactNode;
	panel: React.ReactNode;
	className?: string;
	enDialogo?: boolean;
}) {
	const [panelMovil, setPanelMovil] = React.useState<"contexto" | "solicitud">(
		"solicitud",
	);
	const titulo = `Espacio de aprobación · ${TITULO_MODAL[tipo]}`;
	return (
		<div className={cn("flex min-h-0 flex-1 flex-col", className)}>
			<header className="flex shrink-0 items-center justify-between gap-3 border-line-subtle border-b px-5 py-3.5 sm:px-6">
				<div className="flex min-w-0 flex-col">
					{enDialogo ? (
						<>
							<DialogTitle className="wrap-break-word font-semibold leading-tight">
								{titulo}
							</DialogTitle>
							<DialogDescription className="sr-only">
								Contexto del caso y decisión de la solicitud.
							</DialogDescription>
						</>
					) : (
						<h2 className="wrap-break-word font-semibold text-base text-fg leading-tight">
							{titulo}
						</h2>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{total > 1 ? (
						<nav
							aria-label="Navegación entre solicitudes"
							className="flex items-center gap-0.5 sm:gap-1"
						>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={onAnterior}
								disabled={!onAnterior}
								aria-label="Solicitud anterior"
							>
								<ChevronLeft />
							</Button>
							<span
								className="min-w-[2.75rem] text-center font-medium text-[13px] text-fg-secondary tabular-nums sm:min-w-[7.5rem]"
								aria-live="polite"
							>
								<span className="sm:hidden" aria-hidden>
									{posicion + 1}/{total}
								</span>
								<span className="sr-only sm:not-sr-only">
									Solicitud {posicion + 1} de {total}
								</span>
							</span>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={onSiguiente}
								disabled={!onSiguiente}
								aria-label="Solicitud siguiente"
							>
								<ChevronRight />
							</Button>
						</nav>
					) : null}
					<button
						type="button"
						onClick={onCerrar}
						className={cn(overlayCloseButtonClassName, "h-8")}
					>
						<XIcon />
						<span className="sr-only">Cerrar</span>
					</button>
				</div>
			</header>

			{/* Móvil: un panel a la vez */}
			<div className="flex shrink-0 justify-center border-line-subtle border-b px-4 py-2 lg:hidden">
				<PeriodSelector
					aria-label="Panel del espacio de aprobación"
					value={panelMovil}
					onChange={setPanelMovil}
					options={OPCIONES_PANEL}
				/>
			</div>

			<div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.06fr)]">
				<div
					className={cn(
						"min-h-0 min-w-0 overflow-y-auto overflow-x-hidden border-line-subtle bg-canvas lg:block lg:border-r",
						panelMovil === "contexto" ? "block" : "hidden",
					)}
				>
					{contexto}
				</div>
				<div
					className={cn(
						"min-h-0 min-w-0 overflow-y-auto overflow-x-hidden bg-surface lg:block",
						panelMovil === "solicitud" ? "block" : "hidden",
					)}
				>
					{panel}
				</div>
			</div>
		</div>
	);
}

/* ── Intentos de decisión de convenios (banner «decisiones por confirmar») ──── */

/**
 * Los intentos de decisión de convenio del usuario que quedaron sin confirmar
 * (`lib/cobros/decision-intentos`): se recalculan ante cualquier cambio, de
 * esta pestaña o de otra (mismo patrón que /cobros/convenios).
 */
export function useIntentosConvenio(userId: string | null | undefined) {
	const [tick, setTick] = React.useState(0);
	const bump = React.useCallback(() => setTick((t) => t + 1), []);
	React.useEffect(() => suscribirseAIntentos(bump), [bump]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `tick` fuerza releer localStorage
	const intentos = React.useMemo<ConvenioDecisionIntento[]>(
		() => (userId ? listarIntentosPendientes(userId) : []),
		[userId, tick],
	);
	return { intentos, bump };
}

/* ── El modal conectado ─────────────────────────────────────────────────────── */

export type EspacioAprobacionProps = {
	solicitudes: Solicitud[];
	/** Posición de la solicitud abierta; null = cerrado. */
	indice: number | null;
	onIndiceChange: (indice: number | null) => void;
};

/** Un clic en un toast (sonner) no cuenta como «clic fuera» del modal. */
function esToast(el: EventTarget | null) {
	return el instanceof Element && !!el.closest("[data-sonner-toaster]");
}

export function EspacioAprobacion({
	solicitudes,
	indice,
	onIndiceChange,
}: EspacioAprobacionProps) {
	const abierto = indice !== null && solicitudes.length > 0;
	// Durante la animación de cierre se sigue pintando la última.
	const ultimo = React.useRef(0);
	if (indice !== null) ultimo.current = indice;
	const posicion = Math.min(
		Math.max(indice ?? ultimo.current, 0),
		Math.max(solicitudes.length - 1, 0),
	);
	const [caja, setCaja] = React.useState<HTMLDivElement | null>(null);
	// Lo que ya se decidió en esta sesión del modal (sobrevive a navegar).
	const [resueltas, setResueltas] = React.useState<
		Record<string, ResolucionSolicitud>
	>({});
	React.useEffect(() => {
		if (!abierto) setResueltas({});
	}, [abierto]);

	return (
		<Dialog
			open={abierto}
			onOpenChange={(open) => {
				if (!open) onIndiceChange(null);
			}}
		>
			<DialogContent
				ref={setCaja}
				showCloseButton={false}
				className="flex h-[min(780px,calc(100dvh-2rem))] w-[min(1100px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
				onPointerDownOutside={(e) => {
					if (esToast(e.target)) e.preventDefault();
				}}
				onInteractOutside={(e) => {
					if (esToast(e.target)) e.preventDefault();
				}}
			>
				<PopoverPortalContext.Provider value={caja}>
					{abierto || solicitudes.length > 0 ? (
						<ContenidoEspacio
							key={solicitudes[posicion]?.id}
							solicitudes={solicitudes}
							posicion={posicion}
							resolucion={resueltas[solicitudes[posicion]?.id ?? ""] ?? null}
							onResuelta={(id, r) =>
								setResueltas((prev) => ({ ...prev, [id]: r }))
							}
							onIr={(i) => onIndiceChange(i)}
							onCerrar={() => onIndiceChange(null)}
						/>
					) : null}
				</PopoverPortalContext.Provider>
			</DialogContent>
		</Dialog>
	);
}

/** Lo de adentro: solo se monta con el modal abierto (las consultas del caso no corren antes). */
function ContenidoEspacio({
	solicitudes,
	posicion,
	resolucion,
	onResuelta,
	onIr,
	onCerrar,
}: {
	solicitudes: Solicitud[];
	posicion: number;
	resolucion: ResolucionSolicitud | null;
	onResuelta: (id: string, r: ResolucionSolicitud) => void;
	onIr: (indice: number) => void;
	onCerrar: () => void;
}) {
	const s = solicitudes[posicion] as Solicitud;
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: session } = authClient.useSession();
	const userId = session?.user?.id ?? null;
	const { intentos, bump } = useIntentosConvenio(userId);

	// Mismo id que la Ficha 360: SIFCO, o el caso si la fuente no trae SIFCO.
	const idCaso = s.credito ?? s.casoCobroId ?? "";
	const caso = useCasoWorkspace(idCaso);

	const [notas, setNotas] = React.useState("");
	const [decision, setDecision] = React.useState<"aprobar" | "rechazar" | null>(
		null,
	);

	const hayAnterior = posicion > 0;
	const hayMas = posicion < solicitudes.length - 1;

	const abrirFicha = () => {
		const id = s.casoCobroId ?? s.credito;
		onCerrar();
		if (!id) return;
		navigate({
			to: "/cobros/$id",
			params: { id },
			search: {
				tipo: "caso",
				...(s.tipo === "apagado" || s.tipo === "reactivacion"
					? { seccion: "inmovilizacion" as const }
					: {}),
			},
		});
	};

	const resolver = (d: "aprobada" | "rechazada") =>
		onResuelta(s.id, resolucionDe(s.tipo, d));

	// ── Quién puede decidir y qué se avisa ──────────────────────────────────
	let aviso: React.ReactNode = null;
	let bloqueo: string | null = null;
	let puedeDecidir = true;
	if (s.tipo === "convenio") {
		const propios = intentos.filter(
			(i) => i.convenioId === s.convenio.convenio_id,
		);
		if (!userId) puedeDecidir = false;
		if (propios.length > 0 && userId) {
			bloqueo = "Hay una decisión sin confirmar sobre este convenio";
			aviso = (
				<DecisionPorConfirmarBanner
					userId={userId}
					intentos={propios}
					onResuelto={() => {
						bump();
						void queryClient.invalidateQueries({
							queryKey: orpc.getConveniosListado.key(),
						});
					}}
				/>
			);
		}
	} else if (s.tipo === "recuperacion" && s.recuperacion.esMia) {
		// Cuatro ojos: la propia no se decide (el servidor lo exige igual).
		puedeDecidir = false;
		aviso = (
			<div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-2.5 text-[13px] text-fg-secondary">
				<CrmPill tone="neutral" kind="chip" className="px-2 py-0.5">
					Su solicitud
				</CrmPill>
				<span className="wrap-break-word min-w-0 flex-1">
					Debe aprobarla otro supervisor o administrador. Si ya no aplica,
					cancélela desde la ficha.
				</span>
			</div>
		);
	} else if (
		(s.tipo === "apagado" || s.tipo === "reactivacion") &&
		s.porEjecutar
	) {
		puedeDecidir = false;
	}

	const handlers =
		puedeDecidir && !bloqueo
			? {
					onAprobar: () => setDecision("aprobar"),
					onRechazar: () => setDecision("rechazar"),
				}
			: {};

	return (
		<>
			<MarcoEspacioAprobacion
				enDialogo
				tipo={s.tipo}
				posicion={posicion}
				total={solicitudes.length}
				onAnterior={hayAnterior ? () => onIr(posicion - 1) : undefined}
				onSiguiente={hayMas ? () => onIr(posicion + 1) : undefined}
				onCerrar={onCerrar}
				contexto={
					<ContextoCaso
						caso={caso}
						onAbrirFicha={abrirFicha}
						soloLectura
						className="h-full bg-canvas"
					/>
				}
				panel={
					<PanelSolicitudVista
						solicitud={s}
						notas={notas}
						onNotas={setNotas}
						{...handlers}
						bloqueo={bloqueo}
						aviso={aviso}
						resolucion={resolucion}
						onVolver={onCerrar}
						onSiguiente={hayMas ? () => onIr(posicion + 1) : undefined}
						className="h-full"
					/>
				}
			/>

			{/* Las decisiones: los modales de siempre, con su lógica intacta. */}
			{decision && s.tipo === "convenio" && userId ? (
				<ConvenioAprobacionModal
					open
					onOpenChange={(open) => {
						if (!open) setDecision(null);
					}}
					decision={decision}
					convenioId={s.convenio.convenio_id}
					userId={userId}
					resumen={{
						clienteNombre: s.convenio.cliente_nombre,
						numeroCreditoSifco: s.convenio.numero_credito_sifco,
						montoTotalConvenio: s.convenio.monto_total_convenio,
					}}
					motivoInicial={notas}
					onDecidido={(d) =>
						resolver(d === "aprobado" ? "aprobada" : "rechazada")
					}
					onResuelto={() => {
						bump();
						setDecision(null);
						// También tras un error (otro supervisor decidió primero): la
						// lista se refresca igual, como en /cobros/convenios.
						void queryClient.invalidateQueries({
							queryKey: orpc.getConveniosListado.key(),
						});
					}}
				/>
			) : null}
			{decision && (s.tipo === "apagado" || s.tipo === "reactivacion") ? (
				<DecisionInmovilizacionModal
					open
					decision={decision}
					id={s.inmovilizacion.id}
					resumen={`${s.inmovilizacion.accion === "apagado" ? "Apagado" : "Reactivación"} — ${s.inmovilizacion.clienteNombre ?? s.inmovilizacion.numeroCreditoSifco}`}
					motivoInicial={notas}
					onOpenChange={(open) => {
						if (!open) setDecision(null);
					}}
					onResuelto={() => {
						void queryClient.invalidateQueries({
							queryKey: orpc.getColaInmovilizaciones.key(),
						});
						resolver(decision === "aprobar" ? "aprobada" : "rechazada");
					}}
				/>
			) : null}
			{decision && s.tipo === "recuperacion" ? (
				<DecidirSolicitudDialog
					solicitud={{
						id: s.recuperacion.id,
						quien: quienEsRecuperacion(s.recuperacion),
					}}
					decision={decision}
					motivoInicial={notas}
					onDecidido={resolver}
					onOpenChange={(abierto) => {
						if (!abierto) setDecision(null);
					}}
				/>
			) : null}
		</>
	);
}

/**
 * Estado del Espacio para una pantalla con lista: guarda una COPIA de la lista
 * al abrir (los refetch no mueven la solicitud abierta) y avisa al cerrar
 * para refrescar la bandeja.
 */
export function useEspacioAprobacion(opciones?: { alCerrar?: () => void }) {
	const [estado, setEstado] = React.useState<{
		solicitudes: Solicitud[];
		indice: number | null;
	}>({ solicitudes: [], indice: null });
	const alCerrar = opciones?.alCerrar;

	const abrir = React.useCallback(
		(solicitudes: Solicitud[], indice: number) => {
			if (indice < 0 || indice >= solicitudes.length) return;
			setEstado({ solicitudes, indice });
		},
		[],
	);
	const onIndiceChange = React.useCallback(
		(indice: number | null) => {
			setEstado((e) => ({ ...e, indice }));
			if (indice === null) alCerrar?.();
		},
		[alCerrar],
	);

	return {
		abrir,
		/** Id de la solicitud abierta (para resaltar su fila), o null. */
		idAbierta:
			estado.indice !== null
				? (estado.solicitudes[estado.indice]?.id ?? null)
				: null,
		modal: {
			solicitudes: estado.solicitudes,
			indice: estado.indice,
			onIndiceChange,
		} satisfies EspacioAprobacionProps,
	};
}
