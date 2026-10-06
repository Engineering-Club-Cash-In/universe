import {
	AlertCircle,
	ChevronDown,
	ChevronRight,
	Shield,
	Users,
} from "lucide-react";
import type * as React from "react";
import {
	CrmCard,
	CrmDataField,
	CrmDivider,
	CrmInfoCard,
	CrmPill,
	type CrmTone,
	crmText,
} from "@/components/ds/cards-credito";
import {
	ProximoContacto,
	type ProximoContactoEstado,
	SinContacto,
} from "@/components/ds/indicadores";
import type { TimelineTipo } from "@/components/ds/timeline";
import { cn } from "@/lib/utils";

/**
 * Ficha 360 · Resumen — Figma «CRM Ventas» › Asesor Junior › 04 · Consulta ·
 * Ficha 360 (369:2060 y la variante 1230:12). Solo presentación: los datos
 * llegan por props desde `routes/cobros/$id.tsx`.
 */

/* ── Franja de seguimiento: "Contactabilidad Alta │ Días sin gestión 3" ────── */

export type NivelContactabilidad = "alta" | "media" | "baja";

const CONTACTABILIDAD: Record<
	NivelContactabilidad,
	{ etiqueta: string; clase: string }
> = {
	alta: { etiqueta: "Alta", clase: "text-success-text" },
	media: { etiqueta: "Media", clase: "text-warning-text" },
	baja: { etiqueta: "Baja", clase: "text-danger-text" },
};

function DatoFranja({
	label,
	children,
	valueClassName,
	title,
}: {
	label: string;
	children: React.ReactNode;
	valueClassName?: string;
	title?: string;
}) {
	return (
		<div className="flex items-baseline gap-2" title={title}>
			<span className="text-[13px] text-fg-secondary leading-[1.26]">
				{label}
			</span>
			<span
				className={cn(
					"font-semibold text-[15px] text-fg leading-[1.26]",
					valueClassName,
				)}
			>
				{children}
			</span>
		</div>
	);
}

export function FranjaSeguimiento({
	diasMora,
	contactabilidad,
	contactabilidadDetalle,
	diasSinGestion,
}: {
	/** Variante 1230:12 ("Días en mora 30"); se omite si no se pasa. */
	diasMora?: number | null;
	contactabilidad: NivelContactabilidad | null;
	/** Tooltip: "3 de 5 gestiones con respuesta en 60 días". */
	contactabilidadDetalle?: string;
	diasSinGestion: number | null;
}) {
	const c = contactabilidad ? CONTACTABILIDAD[contactabilidad] : null;
	return (
		<div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-surface px-5 py-3">
			{diasMora != null ? (
				<>
					<DatoFranja
						label="Días en mora"
						valueClassName={diasMora > 0 ? "text-danger-text" : undefined}
					>
						{diasMora}
					</DatoFranja>
					<span aria-hidden className="h-5 w-px bg-divider" />
				</>
			) : null}
			<DatoFranja
				label="Contactabilidad"
				valueClassName={c?.clase ?? "text-fg-tertiary"}
				title={contactabilidadDetalle}
			>
				{c?.etiqueta ?? "—"}
			</DatoFranja>
			<span aria-hidden className="h-5 w-px bg-divider" />
			<DatoFranja label="Días sin gestión">{diasSinGestion ?? "—"}</DatoFranja>
		</div>
	);
}

/** "⚠ 2 intentos sin contacto · Último intento" + "Próximo contacto: Hoy". */
export function FilaSeguimiento({
	intentos,
	ultimoIntento,
	proximo,
}: {
	intentos: number;
	ultimoIntento?: string;
	proximo: { estado: ProximoContactoEstado; valor?: React.ReactNode };
}) {
	return (
		<div className="flex flex-wrap items-start gap-x-8 gap-y-3 px-1">
			<SinContacto intentos={intentos} ultimoIntento={ultimoIntento} />
			{proximo.estado === "Programado" ? (
				<ProximoContacto estado="Programado" valor={proximo.valor} />
			) : (
				<ProximoContacto estado={proximo.estado} valor={proximo.valor} />
			)}
		</div>
	);
}

/* ── Estado del cobro ───────────────────────────────────────────────────────── */

export function CardEstadoCobro({
	estado,
	diasMora,
	bucket,
	filas,
	children,
}: {
	/** Pill junto al título: "En mora" (danger), "Al día" (success)… */
	estado: { etiqueta: string; tone: CrmTone };
	diasMora: number;
	/** "bucket B1". */
	bucket?: React.ReactNode;
	/** Cuotas pagadas, último mes pagado, fecha de pago… */
	filas: Array<{ label: React.ReactNode; valor: React.ReactNode }>;
	/** Lo que la ficha ya mostraba y no está en Figma (mora pagada, etiquetas…). */
	children?: React.ReactNode;
}) {
	return (
		<CrmCard superficie="outline" className="gap-3 p-4">
			<div className="flex flex-wrap items-center gap-2.5">
				<AlertCircle
					aria-hidden
					className={cn(
						"size-4.5 shrink-0",
						diasMora > 0 ? "text-danger-solid" : "text-success-solid",
					)}
				/>
				<h3 className={crmText.title}>Estado del cobro</h3>
				<CrmPill kind="chip" tone={estado.tone}>
					{estado.etiqueta}
				</CrmPill>
			</div>
			<div className="flex items-center gap-2.5">
				<span
					className={cn(
						"font-bold text-[28px] tabular-nums leading-none",
						diasMora > 0 ? "text-danger-text" : "text-success-text",
					)}
				>
					{diasMora}
				</span>
				<span className="flex flex-col">
					<span className="text-[13px] text-fg leading-[1.26]">
						{diasMora === 1 ? "día en mora" : "días en mora"}
					</span>
					{bucket ? (
						<span className="text-[11px] text-fg-tertiary leading-[1.26]">
							{bucket}
						</span>
					) : null}
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
						<dt className="text-[13px] text-fg-secondary leading-[1.26]">
							{f.label}
						</dt>
						<dd className="text-right font-medium text-[13px] text-fg tabular-nums leading-[1.26]">
							{f.valor}
						</dd>
					</div>
				))}
			</dl>
			{children}
		</CrmCard>
	);
}

/* ── Seguro ─────────────────────────────────────────────────────────────────── */

/**
 * Card/Seguro de Figma más los datos de la póliza que la ficha ya mostraba en
 * la pestaña Vehículo (número, monto asegurado, vencimiento).
 */
export function CardSeguroFicha({
	aseguradora,
	tipoSeguro,
	telefonoEmergencia,
	coberturas,
	poliza,
	montoAsegurado,
	vencimiento,
}: {
	aseguradora: React.ReactNode;
	tipoSeguro: React.ReactNode;
	telefonoEmergencia: React.ReactNode;
	coberturas: React.ReactNode;
	poliza?: React.ReactNode;
	montoAsegurado?: React.ReactNode;
	vencimiento?: React.ReactNode;
}) {
	return (
		<CrmInfoCard icon={<Shield aria-hidden />} titulo="Seguro">
			<CrmDataField label="Aseguradora" className="[&>div]:wrap-break-word">
				{aseguradora}
			</CrmDataField>
			<CrmDataField label="Tipo de seguro">{tipoSeguro}</CrmDataField>
			<CrmDataField
				label="Teléfono de emergencia"
				enfasis="fuerte"
				className="[&>div]:wrap-break-word"
			>
				{telefonoEmergencia}
			</CrmDataField>
			<CrmDataField label="Coberturas">{coberturas}</CrmDataField>
			{poliza ? (
				<CrmDataField label="Póliza" className="[&>div]:break-all">
					{poliza}
				</CrmDataField>
			) : null}
			{montoAsegurado ? (
				<CrmDataField label="Monto asegurado">{montoAsegurado}</CrmDataField>
			) : null}
			{vencimiento ? (
				<CrmDataField label="Vencimiento">{vencimiento}</CrmDataField>
			) : null}
		</CrmInfoCard>
	);
}

/* ── Bloque plegable (secciones que la ficha ya tenía y Figma no dibuja) ───── */

/**
 * Card plegable con el estilo de la ficha. Para lo que ya existía y no está en
 * Figma (proyección de mora, seguimiento programado, gestión temprana…): no se
 * pierde, pero no compite con los bloques de Figma.
 */
export function BloqueFicha({
	titulo,
	icono,
	resumen,
	defaultOpen = true,
	acciones,
	children,
}: {
	titulo: React.ReactNode;
	icono?: React.ReactNode;
	/** Texto a la derecha del título (visible aun plegado). */
	resumen?: React.ReactNode;
	defaultOpen?: boolean;
	acciones?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<details
			open={defaultOpen}
			className="group rounded-xl border border-line-subtle bg-surface"
		>
			<summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 [&::-webkit-details-marker]:hidden">
				{icono ? (
					<span className="flex shrink-0 text-fg-secondary [&_svg]:size-4">
						{icono}
					</span>
				) : null}
				<span className={cn(crmText.title, "min-w-0 flex-1 truncate")}>
					{titulo}
				</span>
				{resumen ? (
					<span className="shrink-0 text-fg-secondary text-xs">{resumen}</span>
				) : null}
				{acciones ? (
					// biome-ignore lint/a11y/noStaticElementInteractions: solo evita que el clic en una acción pliegue la card
					// biome-ignore lint/a11y/useKeyWithClickEvents: ídem
					<span
						className="flex shrink-0 items-center gap-2"
						onClick={(e) => e.preventDefault()}
					>
						{acciones}
					</span>
				) : null}
				<ChevronDown
					aria-hidden
					className="size-4 shrink-0 text-fg-tertiary transition-transform group-open:rotate-180"
				/>
			</summary>
			<div className="border-line-subtle border-t px-4 py-3">{children}</div>
		</details>
	);
}

/* ── Gestión → Timeline de Figma ────────────────────────────────────────────── */

/** Tipo de Timeline/Item según el canal y el resultado de la gestión. */
export function tipoTimelineDeGestion(
	metodo: string | null | undefined,
	estado: string | null | undefined,
): { tipo: TimelineTipo; etiqueta?: string } {
	if (estado === "promesa_pago") return { tipo: "Promesa" };
	switch (metodo) {
		case "llamada":
			return { tipo: "Llamada" };
		case "whatsapp":
			return { tipo: "WhatsApp" };
		case "visita_domicilio":
		case "visita_trabajo":
			return { tipo: "Visita" };
		case "sms":
			return { tipo: "Sistema", etiqueta: "SMS" };
		case "email":
			return { tipo: "Sistema", etiqueta: "Correo" };
		case "carta_notarial":
			return { tipo: "Sistema", etiqueta: "Carta notarial" };
		default:
			return { tipo: "Sistema" };
	}
}

/* ── Contacto (Resumen) ─────────────────────────────────────────────────────── */

export type DatoContactoResumen = {
	icono: React.ReactNode;
	label: string;
	valores: Array<{ texto: string; href?: string }>;
};

/**
 * Tarjeta de Contacto del Resumen: los datos del titular a la vista (para
 * llamar sin salir del Resumen) y el acceso al módulo completo de Contacto
 * (personas del crédito, codeudores, editar).
 */
export function CardContactoResumen({
	datos,
	aviso,
	onVerTodo,
}: {
	datos: DatoContactoResumen[];
	/** "2 números nuevos sin guardar · 3 referencias con teléfono". */
	aviso?: React.ReactNode;
	onVerTodo: () => void;
}) {
	return (
		<CrmCard superficie="outline" className="gap-3 p-4">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2.5">
					<span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-violet-bg text-brand [&_svg]:size-4">
						<Users aria-hidden />
					</span>
					<h3 className={crmText.title}>Contacto</h3>
				</div>
				<button
					type="button"
					onClick={onVerTodo}
					className="inline-flex cursor-pointer items-center gap-1 font-semibold text-[13px] text-brand hover:underline"
				>
					Ver todo
					<ChevronRight aria-hidden className="size-3.5" />
				</button>
			</div>
			<dl className="flex flex-col gap-2.5">
				{datos.map((d) => (
					<div key={d.label} className="flex items-start gap-2.5">
						<span className="mt-0.5 flex shrink-0 text-fg-tertiary [&_svg]:size-3.5">
							{d.icono}
						</span>
						<div className="flex min-w-0 flex-1 flex-col gap-0.5">
							<dt className="text-[11px] text-fg-tertiary leading-[1.26]">
								{d.label}
							</dt>
							<dd className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5">
								{d.valores.length === 0 ? (
									<span className="text-[13px] text-fg-tertiary">—</span>
								) : (
									d.valores.map((v) =>
										v.href ? (
											<a
												key={v.texto}
												href={v.href}
												className="min-w-0 break-all font-medium text-[13px] text-brand leading-[1.26] hover:underline"
											>
												{v.texto}
											</a>
										) : (
											<span
												key={v.texto}
												className="wrap-break-word min-w-0 font-medium text-[13px] text-fg leading-[1.26]"
											>
												{v.texto}
											</span>
										),
									)
								)}
							</dd>
						</div>
					</div>
				))}
			</dl>
			{aviso ? (
				<div className="rounded-lg bg-muted px-3 py-2 text-fg-secondary text-xs">
					{aviso}
				</div>
			) : null}
			<button
				type="button"
				onClick={onVerTodo}
				className="mt-1 inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-brand-subtle px-3 py-2 font-semibold text-[13px] text-brand transition-colors hover:bg-cci-primary-100 dark:hover:bg-cci-primary-800"
			>
				Ver contacto completo y codeudores
				<ChevronRight aria-hidden className="size-3.5" />
			</button>
		</CrmCard>
	);
}
