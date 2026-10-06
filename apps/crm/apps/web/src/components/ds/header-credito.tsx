import type * as React from "react";

import { cn } from "@/lib/utils";
import { CrmAvatar, CrmDivider, CrmPill, inicialesDe } from "./cards-credito";

/**
 * HeaderCredito — Figma "03 · Componentes CRM › Header · Crédito", Header/Crédito (144:2469).
 *
 * Propiedades de Figma → props:
 *   Cliente (texto)              → `cliente`
 *   NúmeroCrédito (texto)        → `numeroCredito` (sin "Crédito #": se agrega solo)
 *   ÚltimaActualización (texto)  → `ultimaActualizacion`
 *   Estado=Activo|EnRiesgo|Jurídico → `estado` ("activo" | "en-riesgo" | "juridico"):
 *     Chip Éxito "Activo" · Chip Info "En riesgo" · Chip Neutro "Jurídico".
 *
 * Estructura: p 20/24, gap 16, radius/lg, Clay-Raised. Arriba la identidad (avatar L,
 * nombre 24/700, etiqueta "Crédito #…" sobre bg/canvas, y la fila de badges: Bucket,
 * Mora y Chip de estado) con las acciones a la derecha (`acciones`, Action/CRM de
 * `ds/action-crm.tsx`). Divider. Abajo los datos: asesor responsable, saldo pendiente,
 * fecha de pago, días en mora (status/danger/text si > 0) y última actualización.
 *
 * Desvíos respecto a Figma:
 *  - Avatar L 64×64 (Figma lo exporta colapsado a 64×28).
 *  - En "EnRiesgo" Figma deja las acciones pegadas a la identidad (sin space-between);
 *    se alinean a la derecha como en las otras dos variantes.
 *  - Ancho fluido (Figma: 1512); la fila superior y los datos hacen wrap si no caben.
 *  - `esquina`: control arriba a la derecha (Ver detalle completo); las acciones bajan.
 *  - `datosExtra`: datos que la Ficha 360 ya mostraba y Figma no trae (capital activo,
 *    cuotas, vehículo). Van después de "Días en mora", con el mismo estilo.
 */

export type EstadoCredito = "activo" | "en-riesgo" | "juridico";

const ESTADO: Record<
	EstadoCredito,
	{ etiqueta: string; tone: "success" | "info" | "neutral" }
> = {
	activo: { etiqueta: "Activo", tone: "success" },
	"en-riesgo": { etiqueta: "En riesgo", tone: "info" },
	juridico: { etiqueta: "Jurídico", tone: "neutral" },
};

export type HeaderCreditoProps = Omit<
	React.ComponentProps<"header">,
	"children"
> & {
	cliente: string;
	iniciales?: string;
	/** "48213" → "Crédito #48213". */
	numeroCredito: React.ReactNode;
	/** Badge del bucket, p. ej. `<BucketBadge bucket="B2" formato="Completa" />`. */
	bucket?: React.ReactNode;
	/** Badge de mora, p. ej. `<MoraBadge mora="Mora60" />`. */
	mora?: React.ReactNode;
	estado?: EstadoCredito;
	/** Reemplaza el Chip de estado. */
	estadoChip?: React.ReactNode;
	/** Botones Action/CRM (Reasignar, Crear promesa, Registrar gestión…). */
	acciones?: React.ReactNode;
	asesor: React.ReactNode;
	saldo: React.ReactNode;
	/** "15 de cada mes". */
	fechaPago: React.ReactNode;
	diasMora: number;
	/** "11 jul 2026 · 14:32". */
	ultimaActualizacion?: React.ReactNode;
	/**
	 * Control en la esquina superior derecha, a la altura del nombre (p. ej.
	 * "Ver detalle completo"). Si se pasa, `acciones` baja a su propia fila.
	 */
	esquina?: React.ReactNode;
	/** Datos adicionales (no están en Figma) tras "Días en mora". */
	datosExtra?: Array<{ label: React.ReactNode; valor: React.ReactNode }>;
};

function Dato({
	label,
	children,
	valueClassName,
}: {
	label: React.ReactNode;
	children: React.ReactNode;
	valueClassName?: string;
}) {
	return (
		<div className="flex flex-col gap-0.5">
			<dt className="text-[11px] text-fg-tertiary leading-[1.26]">{label}</dt>
			<dd
				className={cn(
					"font-semibold text-[13px] text-fg leading-[1.26]",
					valueClassName,
				)}
			>
				{children}
			</dd>
		</div>
	);
}

export function HeaderCredito({
	cliente,
	iniciales,
	numeroCredito,
	bucket,
	mora,
	estado = "activo",
	estadoChip,
	acciones,
	asesor,
	saldo,
	fechaPago,
	diasMora,
	ultimaActualizacion,
	datosExtra,
	esquina,
	className,
	...props
}: HeaderCreditoProps) {
	const e = ESTADO[estado];
	return (
		<header
			data-slot="header-credito"
			data-estado={estado}
			className={cn(
				"flex min-w-0 flex-col gap-4 rounded-2xl bg-surface px-6 py-5 text-fg shadow-clay-raised",
				className,
			)}
			{...props}
		>
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div className="flex min-w-0 items-center gap-3.5">
					<CrmAvatar size="l" iniciales={iniciales ?? inicialesDe(cliente)} />
					<div className="flex min-w-0 flex-col gap-1.5">
						<div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
							<h2 className="font-bold text-2xl text-fg leading-[1.26]">
								{cliente}
							</h2>
							<span className="whitespace-nowrap rounded-md border border-line-subtle bg-canvas px-2 py-0.5 font-semibold text-fg-secondary text-xs leading-[1.26]">
								Crédito #{numeroCredito}
							</span>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							{bucket}
							{mora}
							{estadoChip ?? (
								<CrmPill kind="chip" tone={e.tone}>
									{e.etiqueta}
								</CrmPill>
							)}
						</div>
					</div>
				</div>
				{esquina ? (
					<div className="flex shrink-0 items-center gap-2 self-start">
						{esquina}
					</div>
				) : acciones ? (
					<div className="flex flex-wrap items-center gap-2.5">{acciones}</div>
				) : null}
			</div>
			{/* Con `esquina`, las acciones bajan a su propia fila. */}
			{esquina && acciones ? (
				<div className="flex flex-wrap items-center gap-2.5">{acciones}</div>
			) : null}

			<CrmDivider />

			<div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
				<dl className="flex flex-wrap items-center gap-x-8 gap-y-3">
					<Dato label="Asesor responsable">{asesor}</Dato>
					<Dato label="Saldo pendiente">{saldo}</Dato>
					<Dato label="Fecha de pago">{fechaPago}</Dato>
					<Dato
						label="Días en mora"
						valueClassName={diasMora > 0 ? "text-danger-text" : undefined}
					>
						{diasMora}
					</Dato>
					{datosExtra?.map((d, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: lista fija de datos
						<Dato key={i} label={d.label}>
							{d.valor}
						</Dato>
					))}
				</dl>
				{ultimaActualizacion ? (
					<div className="flex flex-col items-end gap-0.5 text-right">
						<span className="text-[11px] text-fg-tertiary leading-[1.26]">
							Última actualización
						</span>
						<span className="font-medium text-fg-secondary text-xs leading-[1.26]">
							{ultimaActualizacion}
						</span>
					</div>
				) : null}
			</div>
		</header>
	);
}
