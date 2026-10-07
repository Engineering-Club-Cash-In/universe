import type * as React from "react";
import type { Bucket } from "@/components/ds/badges";
import { bucketSolidClass } from "@/components/ds/distribucion-bucket";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { type Destino, EnlaceDestino } from "./destino";
import { EnlaceVer, TarjetaSupervision } from "./tarjeta";

/**
 * «Cartera del equipo por bucket» del Dashboard del supervisor (Figma
 * `1954:14`): barra apilada con el reparto de las cuentas del equipo por
 * bucket del motor y su leyenda. Presentación pura.
 *
 * Cada segmento y cada entrada de la leyenda abre la Cartera general filtrada
 * por ese bucket (`/cobros/cartera?bucket=Bn`). Colores: tokens `bucket/bN`.
 */

/** Nombres cortos de la leyenda del Figma («B0 · Sana»). */
export const BUCKET_CORTO: Record<Bucket, string> = {
	B0: "Sana",
	B1: "Alerta",
	B2: "Gestión",
	B3: "Rescate",
	B4: "Pre-Jur.",
	B5: "Jurídico",
};

export type SegmentoBucketEquipo = {
	bucket: Bucket;
	cuentas: number;
	/** 0–100 sobre el total del equipo. */
	porcentaje: number;
	destino: Destino;
};

export type CarteraEquipoBucketProps = {
	segmentos: SegmentoBucketEquipo[];
	total: number;
	cargando: boolean;
	error: boolean;
	onReintentar: () => void;
	verCartera: Destino;
};

export function CarteraEquipoBucket({
	segmentos,
	total,
	cargando,
	error,
	onReintentar,
	verCartera,
}: CarteraEquipoBucketProps) {
	const rango =
		segmentos.length > 0
			? `${segmentos[0].bucket} a ${segmentos[segmentos.length - 1].bucket}`
			: "B0 a B4";
	let cuerpo: React.ReactNode;
	if (cargando && segmentos.length === 0) {
		cuerpo = (
			<div className="flex flex-col gap-3" aria-hidden>
				<Skeleton className="h-4 w-full rounded-md" />
				<Skeleton className="h-4 w-3/4" />
			</div>
		);
	} else if (error && segmentos.length === 0) {
		cuerpo = (
			<EmptyState
				size="sm"
				variant="error"
				title="No se pudo cargar la cartera del equipo"
				action={
					<Button variant="outline" size="sm" onClick={onReintentar}>
						Reintentar
					</Button>
				}
			/>
		);
	} else if (total === 0) {
		cuerpo = (
			<EmptyState
				size="sm"
				variant="no-data"
				title="Sin cuentas asignadas"
				description="El equipo no tiene créditos en sus buckets."
			/>
		);
	} else {
		const visibles = segmentos.filter((s) => s.cuentas > 0);
		cuerpo = (
			<div className="flex flex-col gap-3.5">
				<div className="flex h-4 w-full gap-0.5 overflow-hidden rounded-md">
					{visibles.map((s) => (
						<EnlaceDestino
							key={s.bucket}
							destino={s.destino}
							aria-label={`${s.bucket} · ${BUCKET_CORTO[s.bucket]}: ${s.cuentas} cuentas (${Math.round(s.porcentaje)}%). Abrir en la Cartera general`}
							title={`${s.bucket} · ${s.cuentas.toLocaleString("es-GT")} cuentas`}
							className={cn(
								"block h-full min-w-1 basis-0 rounded-[4px] outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring",
								bucketSolidClass[s.bucket],
							)}
							style={{ flexGrow: Math.max(s.cuentas, 0) }}
						/>
					))}
				</div>
				<ul className="flex flex-wrap gap-x-6 gap-y-2">
					{segmentos.map((s) => (
						<li key={s.bucket}>
							<EnlaceDestino
								destino={s.destino}
								className="group flex items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								<span
									aria-hidden
									className={cn(
										"size-2.25 shrink-0 rounded-full",
										bucketSolidClass[s.bucket],
									)}
								/>
								<span className="font-medium text-[13px] text-fg leading-[1.26] group-hover:underline">
									{s.bucket} · {BUCKET_CORTO[s.bucket]} ·{" "}
									{Math.round(s.porcentaje)}%
								</span>
								<span className="type-caption text-fg-tertiary tabular-nums">
									{s.cuentas.toLocaleString("es-GT")}
								</span>
							</EnlaceDestino>
						</li>
					))}
				</ul>
			</div>
		);
	}

	return (
		<TarjetaSupervision
			titulo="Cartera del equipo por bucket"
			descripcion={`Distribución del equipo · ${rango}${total > 0 ? ` · ${total.toLocaleString("es-GT")} cuentas` : ""}`}
			accion={<EnlaceVer destino={verCartera}>Ver cartera completa</EnlaceVer>}
		>
			{cuerpo}
		</TarjetaSupervision>
	);
}
