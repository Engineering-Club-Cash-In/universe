/**
 * Workspace · panel de gestión: pantallas de cierre.
 *
 *  - `GestionRegistradaVista` (Figma gp/RegistradaNA, gp/RegistradaPromesa,
 *    gp/RegistradaComprobante, gp/RegistradaConvenio…): check grande, título
 *    según la gestión, chip «Guardado en el historial · hoy» y la tarjeta
 *    «Resumen de la gestión». Pie: «Siguiente caso →» y «Volver al inicio».
 *  - `MensajeEnviadoVista` (gp/MsgWAenviado, gp/MsgSMSenviado,
 *    gp/MsgCorreoEnviado): el mensaje salió y el caso queda en seguimiento.
 *
 * Solo presentación (sin queries).
 */
import {
	ArrowRight,
	CheckCircle2,
	Clock,
	ExternalLink,
	TriangleAlert,
} from "lucide-react";
import type * as React from "react";
import { CrmPill, type CrmTone } from "@/components/ds/cards-credito";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
	BandaContexto,
	ChipGuardado,
	PasoGestion,
	RotuloGestion,
} from "./piezas";

export type FilaResumen = {
	label: string;
	valor: React.ReactNode;
	/** Resalta el valor (p. ej. «Promesa de pago» en verde). */
	tono?: "success" | "warning" | "danger" | "brand";
};

export type AvisoResumen = {
	tono: "warning" | "danger" | "info";
	texto: string;
};

/** Lo que muestra «Gestión registrada». */
export type ResumenRegistrada = {
	titulo: string;
	subtitulo: string;
	/** Por defecto «Guardado en el historial · hoy». */
	chip?: { texto: string; tono: CrmTone } | null;
	filas: FilaResumen[];
	/** «12 ago 2026 · Llamada». */
	proximoContacto?: string | null;
	avisos?: AvisoResumen[];
};

const VALOR_TONO: Record<NonNullable<FilaResumen["tono"]>, string> = {
	success: "text-success-text",
	warning: "text-warning-text",
	danger: "text-danger-text",
	brand: "text-brand",
};

const AVISO_TONO: Record<AvisoResumen["tono"], string> = {
	warning: "bg-warning-subtle text-warning-text",
	danger: "bg-danger-subtle text-danger-text",
	info: "bg-info-subtle text-info-text",
};

/**
 * Pie común (R2-20): los secundarios en una rejilla de 2 columnas («Volver al
 * inicio» al final; si quedan impares, el último ocupa las dos) y, debajo, el
 * principal «Siguiente caso →» a ancho completo.
 */
export function PieCierre({
	onSiguienteCaso,
	onVolverInicio,
	extra,
}: {
	/** undefined = no hay más casos en la lista. */
	onSiguienteCaso?: () => void;
	onVolverInicio: () => void;
	/** Secundarios antes de «Volver al inicio» («Abrir WhatsApp», «Registrar resultado»). */
	extra?: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-2">
			<div className="grid grid-cols-2 gap-2 [&>*:last-child:nth-child(odd)]:col-span-2">
				{extra}
				<Button type="button" variant="secondary" onClick={onVolverInicio}>
					Volver al inicio
				</Button>
			</div>
			<Button
				type="button"
				className="w-full"
				onClick={onSiguienteCaso}
				disabled={!onSiguienteCaso}
			>
				{onSiguienteCaso ? (
					<>
						Siguiente caso
						<ArrowRight aria-hidden />
					</>
				) : (
					"No hay más casos en esta lista"
				)}
			</Button>
		</div>
	);
}

export function TarjetaResumen({
	titulo = "Resumen de la gestión",
	filas,
	proximoContacto,
	children,
}: {
	titulo?: string;
	filas: FilaResumen[];
	proximoContacto?: string | null;
	children?: React.ReactNode;
}) {
	return (
		<section className="flex flex-col gap-3 rounded-xl border border-line-subtle bg-muted/40 p-4">
			<h3>
				<RotuloGestion>{titulo}</RotuloGestion>
			</h3>
			<dl className="flex flex-col gap-2">
				{filas.map((f) => (
					<div
						key={f.label}
						className="flex min-w-0 items-baseline justify-between gap-4"
					>
						<dt className="shrink-0 text-fg-secondary text-sm">{f.label}</dt>
						<dd
							className={cn(
								"wrap-break-word min-w-0 text-right font-medium text-fg text-sm",
								f.tono && VALOR_TONO[f.tono],
							)}
						>
							{f.valor}
						</dd>
					</div>
				))}
			</dl>
			{proximoContacto ? (
				<div className="flex flex-col gap-0.5 rounded-lg bg-brand-subtle px-3 py-2.5">
					<span className="font-semibold text-[11px] text-brand uppercase tracking-wide">
						Próximo contacto
					</span>
					<span className="wrap-break-word font-semibold text-fg text-sm">
						{proximoContacto}
					</span>
				</div>
			) : null}
			{children}
		</section>
	);
}

export function GestionRegistradaVista({
	resumen,
	onSiguienteCaso,
	onVolverInicio,
	children,
	className,
}: {
	resumen: ResumenRegistrada;
	onSiguienteCaso?: () => void;
	onVolverInicio: () => void;
	/** Debajo del resumen (p. ej. los siguientes pasos de una visita). */
	children?: React.ReactNode;
	className?: string;
}) {
	const chip =
		resumen.chip === undefined
			? { texto: "Guardado en el historial · hoy", tono: "success" as const }
			: resumen.chip;
	return (
		<PasoGestion
			className={className}
			pie={
				<PieCierre
					onSiguienteCaso={onSiguienteCaso}
					onVolverInicio={onVolverInicio}
				/>
			}
		>
			<div className="flex flex-col gap-5 pt-8">
				<div
					aria-live="polite"
					className="flex flex-col items-center gap-2 text-center"
				>
					<span
						aria-hidden
						className="mb-2 flex size-18 items-center justify-center rounded-full bg-success-subtle"
					>
						<span className="flex size-12 items-center justify-center rounded-full bg-success-solid text-on-solid">
							<CheckCircle2 className="size-6.5" />
						</span>
					</span>
					<h2 className="wrap-break-word font-semibold text-fg text-xl leading-[1.26]">
						{resumen.titulo}
					</h2>
					<p className="wrap-break-word max-w-[46ch] text-fg-secondary text-sm leading-snug">
						{resumen.subtitulo}
					</p>
					{chip ? (
						<ChipGuardado tono={chip.tono}>{chip.texto}</ChipGuardado>
					) : null}
				</div>

				{resumen.avisos && resumen.avisos.length > 0 ? (
					<ul className="flex flex-col gap-2">
						{resumen.avisos.map((a) => (
							<li
								key={a.texto}
								className={cn(
									"flex items-start gap-2 rounded-lg px-3 py-2 text-[13px] leading-snug",
									AVISO_TONO[a.tono],
								)}
							>
								<TriangleAlert
									aria-hidden
									className="mt-0.5 size-3.5 shrink-0"
								/>
								<span className="wrap-break-word min-w-0">{a.texto}</span>
							</li>
						))}
					</ul>
				) : null}

				{resumen.filas.length > 0 ? (
					<TarjetaResumen
						filas={resumen.filas}
						proximoContacto={resumen.proximoContacto}
					/>
				) : null}
				{children}
			</div>
		</PasoGestion>
	);
}

const CANAL_ENVIADO: Record<"whatsapp" | "sms" | "email", string> = {
	whatsapp: "WhatsApp",
	sms: "SMS",
	email: "Correo",
};

export function MensajeEnviadoVista({
	canal,
	destinatario,
	abrir,
	onRegistrarResultado,
	onSiguienteCaso,
	onVolverInicio,
	className,
}: {
	canal: "whatsapp" | "sms" | "email";
	/** «María José Contreras · 5555-1234». */
	destinatario?: string | null;
	/**
	 * «Abrir WhatsApp» / «Abrir correo»: un enlace (wa.me o mailto) que solo
	 * abre la conversación; no envía nada.
	 */
	abrir?: { href: string; etiqueta: string } | null;
	onRegistrarResultado: () => void;
	onSiguienteCaso?: () => void;
	onVolverInicio: () => void;
	className?: string;
}) {
	return (
		<PasoGestion
			className={className}
			cabecera={
				<div className="px-5 pt-4 pb-3">
					<BandaContexto tono="brand">
						{CANAL_ENVIADO[canal]} · enviado · esperando respuesta
					</BandaContexto>
				</div>
			}
			pie={
				<PieCierre
					onSiguienteCaso={onSiguienteCaso}
					onVolverInicio={onVolverInicio}
					extra={
						<>
							{abrir ? (
								<Button asChild variant="secondary">
									<a
										href={abrir.href}
										target="_blank"
										rel="noopener noreferrer"
									>
										<ExternalLink aria-hidden />
										{abrir.etiqueta}
									</a>
								</Button>
							) : null}
							<Button
								type="button"
								variant="secondary"
								onClick={onRegistrarResultado}
							>
								Registrar resultado
							</Button>
						</>
					}
				/>
			}
		>
			<div aria-live="polite" className="flex flex-col gap-3 pt-2">
				<h2 className="font-semibold text-fg text-xl leading-[1.26]">
					Mensaje enviado
				</h2>
				<p className="wrap-break-word text-fg-secondary text-sm leading-snug">
					Puede continuar con el siguiente caso. Este crédito permanecerá en
					seguimiento hasta recibir respuesta.
				</p>
				{destinatario ? (
					<p className="wrap-break-word text-fg text-sm">
						<span className="text-fg-secondary">Destinatario: </span>
						<span className="break-all font-medium">{destinatario}</span>
					</p>
				) : null}
				<div className="flex flex-wrap gap-2">
					<ChipGuardado />
					<CrmPill tone="warning" kind="chip" dot={false}>
						<Clock aria-hidden className="size-3.5 shrink-0" />
						Sin respuesta inmediata · En seguimiento
					</CrmPill>
				</div>
				<p className="text-fg-tertiary text-xs leading-snug">
					{canal === "whatsapp"
						? "Cuando el cliente responda, use «Registrar resultado» o «WhatsApp entrante» para dejar el acuerdo en el historial."
						: "Cuando el cliente responda, use «Registrar resultado» para dejar el acuerdo en el historial."}
				</p>
			</div>
		</PasoGestion>
	);
}
