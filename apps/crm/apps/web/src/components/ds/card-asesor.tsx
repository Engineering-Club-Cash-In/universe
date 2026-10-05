import type * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
	CrmAvatar,
	CrmDivider,
	CrmField,
	CrmPill,
	crmText,
	inicialesDe,
} from "./cards-credito";

/**
 * CardAsesor — Figma "03 · Componentes CRM › Card · Asesor".
 *   Card/Asesor          (2058:3376) → <CardAsesor … />
 *   Card/Asesor Ausente  (3380:4324) → <CardAsesor ausencia="Ausente · Vacaciones · vuelve el 30 sep" onReactivar={…} />
 *
 * Variante "Estado" (Default · Hover) → CSS `:hover` (borde border/default 1.5 + sombra).
 * La prop `estado="hover"` la fuerza (solo para el catálogo /design-system).
 *
 * Contenido: avatar M con punto de activo, nombre 16/600, rol 12/400, Chip de estado;
 * "N créditos asignados" + barra apilada por bucket (8px, bucket/bN/solid) + leyenda;
 * Gestiones cumplidas y Contactabilidad (16/700); Progress "Recuperación".
 * Ausente: línea de motivo en status/warning/text, cartera al 40% de opacidad y
 * botón Secondary Small de ancho completo "Reactivar".
 *
 * Desvíos respecto a Figma:
 *  - Avatar 44×44 (Figma lo exporta colapsado a 44×19). En la variante Ausente no se
 *    muestra el punto de activo (Figma reutiliza el avatar "Estado=Activo").
 *  - Chip "Ausente": Figma deja el fondo de Chip Éxito con texto en warning; se usa
 *    el Chip Alerta completo (status/warning/subtle + text) para que sea coherente.
 *  - La línea de ausencia viene en Inter 500 11px; se usa Plus Jakarta Sans como el resto.
 *  - Hover: sombra 0 12 36 + brillo → `shadow-modal` (la Elevation más cercana).
 *  - Cada segmento de la barra es proporcional a su cantidad (Figma: segmentos "fill").
 *  - Ancho fluido (Figma: 320 / 356 fijos).
 */

export type BucketAsesor = "B0" | "B1" | "B2" | "B3" | "B4" | "B5";

const bucketSolido: Record<BucketAsesor, string> = {
	B0: "bg-bucket-b0",
	B1: "bg-bucket-b1",
	B2: "bg-bucket-b2",
	B3: "bg-bucket-b3",
	B4: "bg-bucket-b4",
	B5: "bg-bucket-b5",
};

const tonoTexto = {
	success: "text-success-text",
	warning: "text-warning-text",
	danger: "text-danger-text",
} as const;

const tonoBarra = {
	normal: "bg-brand",
	success: "bg-success-solid",
	warning: "bg-warning-solid",
	danger: "bg-danger-solid",
} as const;

export type CardAsesorProps = Omit<
	React.ComponentProps<"article">,
	"children"
> & {
	nombre: string;
	iniciales?: string;
	/** "Asesor Senior". */
	rol: React.ReactNode;
	/** Chip de estado; por defecto "Activo" (Éxito) o "Ausente" (Alerta) si hay `ausencia`. */
	estadoChip?: React.ReactNode;
	/** Total de créditos de la cartera ("40 créditos asignados"). */
	creditosAsignados: number;
	/** Reparto por bucket: barra apilada y leyenda ("B1 12"). */
	distribucion: { bucket: BucketAsesor; cantidad: number }[];
	/** "18 / 20". */
	gestionesCumplidas: React.ReactNode;
	/** "92%". */
	contactabilidad: React.ReactNode;
	contactabilidadTone?: keyof typeof tonoTexto;
	/** Progress "Barra": porcentaje 0–100 y detalle ("Q 8.4M de Q 9.1M"). */
	recuperacion: {
		porcentaje: number;
		detalle?: React.ReactNode;
		etiqueta?: React.ReactNode;
		/** Estado del Progress de Figma: Normal (marca) · Éxito · Alerta · Riesgo. */
		tono?: keyof typeof tonoBarra;
	};
	/** Activa la variante "Card/Asesor Ausente" con este motivo. */
	ausencia?: React.ReactNode;
	onReactivar?: () => void;
	reactivarLabel?: React.ReactNode;
	reactivando?: boolean;
	/** Fuerza la variante Hover de Figma (catálogo). En uso real sale por CSS. */
	estado?: "default" | "hover";
};

export function CardAsesor({
	nombre,
	iniciales,
	rol,
	estadoChip,
	creditosAsignados,
	distribucion,
	gestionesCumplidas,
	contactabilidad,
	contactabilidadTone = "success",
	recuperacion,
	ausencia,
	onReactivar,
	reactivarLabel = "Reactivar",
	reactivando = false,
	estado = "default",
	className,
	...props
}: CardAsesorProps) {
	const ausente = ausencia != null;
	const total = distribucion.reduce((s, d) => s + d.cantidad, 0);
	const porcentaje = Math.min(100, Math.max(0, recuperacion.porcentaje));

	return (
		<article
			data-slot="card-asesor"
			data-estado={estado}
			data-ausente={ausente || undefined}
			className={cn(
				"flex min-w-0 flex-col gap-3.5 rounded-2xl border-[1.5px] border-transparent bg-surface p-5 text-fg shadow-clay-raised transition-[border-color,box-shadow] duration-150 ease-out",
				"hover:border-line hover:shadow-modal data-[estado=hover]:border-line data-[estado=hover]:shadow-modal",
				className,
			)}
			{...props}
		>
			<div className="flex items-center gap-3">
				<CrmAvatar
					iniciales={iniciales ?? inicialesDe(nombre)}
					activo={!ausente}
				/>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<h3 className={cn(crmText.name, "truncate")}>{nombre}</h3>
					<p className={crmText.sub}>{rol}</p>
				</div>
				{estadoChip ??
					(ausente ? (
						<CrmPill kind="chip" tone="warning">
							Ausente
						</CrmPill>
					) : (
						<CrmPill kind="chip" tone="success">
							Activo
						</CrmPill>
					))}
			</div>

			{ausente ? (
				<p className="font-medium text-[11px] text-warning-text leading-[1.26]">
					{ausencia}
				</p>
			) : null}

			<div className={cn("flex flex-col gap-2", ausente && "opacity-40")}>
				<p className="font-semibold text-[13px] text-fg leading-[1.26]">
					{creditosAsignados} créditos asignados
				</p>
				<div className="flex h-2 w-full overflow-hidden rounded-full bg-line-subtle">
					{total > 0
						? distribucion.map((d) =>
								d.cantidad > 0 ? (
									<div
										key={d.bucket}
										className={cn("h-full", bucketSolido[d.bucket])}
										style={{ flexGrow: d.cantidad, flexBasis: 0 }}
									/>
								) : null,
							)
						: null}
				</div>
				<ul className="flex flex-wrap gap-x-3 gap-y-1">
					{distribucion.map((d) => (
						<li
							key={d.bucket}
							className="flex items-center gap-1.25 font-medium text-[11px] text-fg-secondary leading-[1.26]"
						>
							<span
								aria-hidden
								className={cn(
									"size-1.75 shrink-0 rounded-full",
									bucketSolido[d.bucket],
								)}
							/>
							{d.bucket} {d.cantidad}
						</li>
					))}
				</ul>
			</div>

			<CrmDivider className={cn(ausente && "opacity-40")} />

			<div
				className={cn("flex justify-between gap-4", ausente && "opacity-40")}
			>
				<CrmField
					label="Gestiones cumplidas"
					valueClassName="font-bold text-base"
				>
					{gestionesCumplidas}
				</CrmField>
				<CrmField
					label="Contactabilidad"
					valueClassName={cn(
						"font-bold text-base",
						tonoTexto[contactabilidadTone],
					)}
				>
					{contactabilidad}
				</CrmField>
			</div>

			<div className={cn("flex flex-col gap-2", ausente && "opacity-40")}>
				<div className="flex items-center justify-between gap-2">
					<span className="font-medium text-fg-secondary text-xs leading-[1.26]">
						{recuperacion.etiqueta ?? "Recuperación"}
					</span>
					<span className="font-semibold text-fg text-xs leading-[1.26]">
						{Math.round(porcentaje)}%
					</span>
				</div>
				<div
					role="progressbar"
					aria-label="Recuperación"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={Math.round(porcentaje)}
					className="h-2.5 w-full overflow-hidden rounded-full bg-line-subtle"
				>
					<div
						className={cn(
							"h-full rounded-full",
							tonoBarra[recuperacion.tono ?? "normal"],
						)}
						style={{ width: `${porcentaje}%` }}
					/>
				</div>
				{recuperacion.detalle ? (
					<span className={crmText.label}>{recuperacion.detalle}</span>
				) : null}
			</div>

			{ausente && onReactivar ? (
				<Button
					variant="secondary"
					size="sm"
					className="w-full"
					onClick={onReactivar}
					loading={reactivando}
				>
					{reactivarLabel}
				</Button>
			) : null}
		</article>
	);
}
