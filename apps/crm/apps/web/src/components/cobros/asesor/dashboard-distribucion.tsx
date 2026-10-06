import { Banknote, CircleCheck, Phone, Users } from "lucide-react";
import type * as React from "react";
import { type Bucket, BucketBadge } from "@/components/ds/badges";
import { bucketSolidClass } from "@/components/ds/distribucion-bucket";
import { formatearQuetzales } from "@/components/ds/table-cells";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
	OperationalSummaryBar,
	OperationalSummaryItem,
} from "@/components/ui/operational-summary";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * "Distribución de mi cartera" (Figma › Distribución de Cartera, distribucion.png):
 * una fila por bucket del asesor con Badge/Bucket completa, barra del color del
 * bucket, % y "N créditos · Q capital". Clic en un bucket → Mi Cartera filtrada.
 * Reemplaza al "Embudo de cobranza" del dashboard anterior para el asesor.
 *
 * Arriba, la barra-resumen (Operational Summary) conserva los KPI generales que
 * tenía el dashboard anterior: casos asignados, % al día (efectividad), capital y
 * contactos de hoy.
 *
 * Se compone aquí (no con ds/distribucion-bucket ni KpiDistribucion) porque la
 * pantalla de Figma pinta una card por bucket con cantidad y monto, que ninguno
 * de los dos trae.
 */

export type BucketDistribucion = {
	bucket: Bucket;
	cantidad: number;
	/** 0–100 sobre el total de los buckets mostrados. */
	porcentaje: number;
	capital: number;
	mora: number;
};

export type ResumenCartera = {
	asignados: number;
	/** % de la cartera al día; null si no viene. */
	alDia: number | null;
	capital: number;
	contactosHoy: number;
};

export type DistribucionCarteraProps = {
	items: BucketDistribucion[];
	resumen?: ResumenCartera;
	cargando: boolean;
	error: boolean;
	onReintentar: () => void;
	/** El usuario no tiene asesor de cartera vinculado. */
	sinCartera: boolean;
	onBucket: (bucket: Bucket) => void;
};

const DESCRIPCION: Record<Bucket, string> = {
	B0: "Créditos al día",
	B1: "Alerta temprana",
	B2: "Gestión activa",
	B3: "Rescate",
	B4: "Pre jurídico",
	B5: "Jurídico",
};

function FilaBucket({
	item,
	onClick,
}: {
	item: BucketDistribucion;
	onClick: () => void;
}) {
	const pct = Math.min(Math.max(item.porcentaje, 0), 100);
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={`Abrir ${item.bucket} en Mi Cartera`}
			className="flex w-full cursor-pointer flex-col gap-3 rounded-2xl border border-line-subtle bg-surface px-5 py-4 text-left outline-none transition-colors hover:border-line hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:gap-5"
		>
			<span className="w-44 shrink-0">
				<BucketBadge bucket={item.bucket} formato="Completa" />
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-1.5">
				<span className="flex items-center justify-between gap-3">
					<span className="type-body-sm text-fg-secondary">
						{DESCRIPCION[item.bucket]}
					</span>
					<span className="font-semibold text-[13px] text-fg tabular-nums">
						{Math.round(pct)}%
					</span>
				</span>
				<span className="h-2 w-full overflow-hidden rounded-full bg-line-subtle">
					<span
						className={cn(
							"block h-full rounded-full",
							bucketSolidClass[item.bucket],
						)}
						style={{ width: `${pct}%` }}
					/>
				</span>
				<span className="type-caption text-fg-tertiary tabular-nums">
					{item.cantidad.toLocaleString("es-GT")}{" "}
					{item.cantidad === 1 ? "crédito" : "créditos"} ·{" "}
					{formatearQuetzales(item.capital)}
					{item.mora > 0 ? ` · Mora ${formatearQuetzales(item.mora)}` : ""}
				</span>
			</span>
		</button>
	);
}

export function DistribucionCartera({
	items,
	resumen,
	cargando,
	error,
	onReintentar,
	sinCartera,
	onBucket,
}: DistribucionCarteraProps) {
	let cuerpo: React.ReactNode;
	if (error && items.length === 0) {
		cuerpo = (
			<div className="rounded-2xl border border-line-subtle bg-surface">
				<EmptyState
					size="sm"
					variant="error"
					title="No se pudo cargar la distribución"
					action={
						<Button variant="outline" size="sm" onClick={onReintentar}>
							Reintentar
						</Button>
					}
				/>
			</div>
		);
	} else if (cargando && items.length === 0) {
		cuerpo = (
			<div className="flex flex-col gap-3" aria-hidden>
				<Skeleton className="h-21 w-full rounded-2xl" />
				<Skeleton className="h-21 w-full rounded-2xl" />
			</div>
		);
	} else if (sinCartera || items.length === 0) {
		cuerpo = (
			<div className="rounded-2xl border border-line-subtle bg-surface">
				<EmptyState
					size="sm"
					variant="no-data"
					title="Sin cartera asignada"
					description="Todavía no tiene créditos asignados. Contacte a su supervisor."
				/>
			</div>
		);
	} else {
		cuerpo = (
			<div className="flex flex-col gap-3">
				{items.map((item) => (
					<FilaBucket
						key={item.bucket}
						item={item}
						onClick={() => onBucket(item.bucket)}
					/>
				))}
			</div>
		);
	}

	return (
		<section className="flex flex-col gap-4">
			<SectionHeader
				titleAs="h2"
				title="Distribución de mi cartera"
				description="Cómo se reparte su cartera por bucket. Seleccione un bucket para abrirlo en Mi Cartera."
			/>
			{resumen && !sinCartera ? (
				<OperationalSummaryBar>
					<OperationalSummaryItem
						icon={Users}
						value={resumen.asignados.toLocaleString("es-GT")}
						label="créditos asignados"
					/>
					<OperationalSummaryItem
						icon={CircleCheck}
						status="success"
						value={
							resumen.alDia !== null ? `${resumen.alDia.toFixed(1)}%` : "—"
						}
						label="de la cartera al día"
					/>
					<OperationalSummaryItem
						icon={Banknote}
						value={formatearQuetzales(resumen.capital)}
						label="de capital"
					/>
					<OperationalSummaryItem
						icon={Phone}
						value={resumen.contactosHoy.toLocaleString("es-GT")}
						label="contactos hoy"
					/>
				</OperationalSummaryBar>
			) : null}
			{cuerpo}
		</section>
	);
}
