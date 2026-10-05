import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Distribución/Bucket — Figma "🏦 CRM · Rescate & Supervisor (B3/B4) › Distribución/Bucket" (2282:3400).
 *
 * Barra apilada con el reparto de la cartera por bucket de mora + leyenda.
 * Props de Figma → código:
 *   título "dist-title"                  → `title`   (default "Distribución por bucket")
 *   subtítulo "dist-sub"                 → `subtitle` (default "Distribución de la cartera")
 *   seg-1…seg-5 + lab-row-1…lab-row-5    → `segments` (uno por bucket)
 *   "Mostrar segmento 3/4/5" (boolean)   → cantidad de elementos de `segments`
 * Colores: cada segmento usa el token del bucket (`bg-bucket-bN`).
 *
 * Desvíos: el ancho de cada segmento es proporcional a `percent` (en Figma los
 * segmentos visibles son "fill" iguales) y la leyenda hace wrap en vez de recortarse.
 */

export type BucketId = "B0" | "B1" | "B2" | "B3" | "B4" | "B5";

/** Relleno sólido de cada bucket (token `bucket/bN/solid`). */
export const bucketSolidClass: Record<BucketId, string> = {
	B0: "bg-bucket-b0",
	B1: "bg-bucket-b1",
	B2: "bg-bucket-b2",
	B3: "bg-bucket-b3",
	B4: "bg-bucket-b4",
	B5: "bg-bucket-b5",
};

export type DistribucionBucketSegment = {
	bucket: BucketId;
	/** Texto de la leyenda, p. ej. "B2 · Gestión". */
	label: React.ReactNode;
	/** Cantidad de créditos (opcional). */
	count?: React.ReactNode;
	/** Porcentaje 0–100: define el ancho del segmento y se muestra en la leyenda. */
	percent: number;
};

type DistribucionBucketProps = Omit<React.ComponentProps<"div">, "title"> & {
	title?: React.ReactNode;
	subtitle?: React.ReactNode;
	segments: DistribucionBucketSegment[];
};

function formatPercent(percent: number) {
	return `${Math.round(percent)}%`;
}

function DistribucionBucket({
	title = "Distribución por bucket",
	subtitle = "Distribución de la cartera",
	segments,
	className,
	...props
}: DistribucionBucketProps) {
	return (
		<div
			data-slot="distribucion-bucket"
			className={cn(
				"flex w-full flex-col gap-3.5 rounded-[16px] border border-line-subtle bg-surface px-5.5 py-5",
				className,
			)}
			{...props}
		>
			<div className="flex flex-col gap-0.5">
				<p className="font-semibold text-[15px] text-fg leading-[1.26]">
					{title}
				</p>
				{subtitle ? (
					<p className="text-fg-secondary text-xs leading-[1.26]">{subtitle}</p>
				) : null}
			</div>

			<div
				role="img"
				aria-label={segments
					.map((s) => `${s.bucket}: ${formatPercent(s.percent)}`)
					.join(", ")}
				className="flex h-4 w-full gap-0.5 overflow-hidden rounded-md"
			>
				{segments.map((s) => (
					<div
						key={s.bucket}
						className={cn(
							"h-full min-w-1 basis-0 rounded-[4px]",
							bucketSolidClass[s.bucket],
						)}
						style={{ flexGrow: Math.max(s.percent, 0) }}
					/>
				))}
			</div>

			<ul className="flex flex-wrap gap-x-7 gap-y-2">
				{segments.map((s) => (
					<li key={s.bucket} className="flex items-center gap-2">
						<span
							aria-hidden
							className={cn(
								"size-2.25 shrink-0 rounded-full",
								bucketSolidClass[s.bucket],
							)}
						/>
						<span className="font-medium text-[13px] text-fg leading-[1.26]">
							{s.label}
							{s.count != null ? <> · {s.count}</> : null} ·{" "}
							{formatPercent(s.percent)}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

export { DistribucionBucket };
