import type * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { type Destino, EnlaceDestino } from "./destino";
import { haceCuanto } from "./formato";
import { EnlaceVer, TarjetaSupervision } from "./tarjeta";

/**
 * «Aprobaciones pendientes» del Dashboard del supervisor (Figma `1954:14`):
 * lista mezclada de todo lo que espera la decisión del supervisor, las más
 * antiguas primero, con el chip del tipo y la antigüedad. Presentación pura.
 *
 * Hoy entran convenios de pago por aprobar, solicitudes de recuperación del
 * vehículo y solicitudes de apagado/reactivación. Documentos y rebajas de mora
 * (chips «Documentos» y «Rebaja» del Figma) se suman cuando existan (S1).
 * Cada fila lleva a la bandeja donde se decide. Al pie, un acceso por bandeja
 * (no hay todavía una bandeja única: llega en la fase 2).
 */

export type TipoAprobacionSupervision =
	| "convenio"
	| "recuperacion"
	| "apagado"
	| "reactivacion"
	| "documentos"
	| "rebaja";

const TIPO: Record<
	TipoAprobacionSupervision,
	{
		etiqueta: string;
		variante: "success" | "danger" | "warning" | "info" | "neutral";
	}
> = {
	convenio: { etiqueta: "Convenio", variante: "success" },
	recuperacion: { etiqueta: "Recuperación", variante: "danger" },
	apagado: { etiqueta: "Apagado", variante: "warning" },
	reactivacion: { etiqueta: "Reactivación", variante: "info" },
	documentos: { etiqueta: "Documentos", variante: "neutral" },
	rebaja: { etiqueta: "Rebaja", variante: "warning" },
};

export type FilaAprobacion = {
	id: string;
	tipo: TipoAprobacionSupervision;
	cliente: string;
	/** No. de crédito (SIFCO). */
	credito: string | null;
	/** Asesor que la pidió, ya abreviado («A. Díaz»). */
	asesor: string | null;
	/** ISO; `null` si la fuente no trae fecha. */
	solicitadoEn: string | null;
	destino: Destino;
};

export type BandejaAprobacion = {
	clave: string;
	etiqueta: string;
	cantidad: number | null;
	destino: Destino;
};

export type AprobacionesPendientesProps = {
	/** Ya ordenadas (las más antiguas primero) y recortadas. */
	filas: FilaAprobacion[];
	total: number;
	cargando: boolean;
	error: boolean;
	onReintentar: () => void;
	verTodas: Destino;
	/** Acceso a cada bandeja con su conteo. */
	bandejas: BandejaAprobacion[];
	/** Para fijar la antigüedad en el showcase. */
	ahora?: Date;
};

function Fila({ fila, ahora }: { fila: FilaAprobacion; ahora: Date }) {
	const tipo = TIPO[fila.tipo];
	return (
		<li>
			{/* En tarjetas angostas (celular, columna izquierda) el chip y la
			    antigüedad bajan a su propia línea. */}
			<EnlaceDestino
				destino={fila.destino}
				className="-mx-2 flex @md:flex-row flex-col @md:items-center @md:gap-3 gap-1.5 rounded-lg px-2 py-3 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
			>
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="wrap-break-word font-medium text-fg text-sm leading-[1.26]">
						{fila.cliente}
					</span>
					<span className="type-caption wrap-break-word text-fg-tertiary">
						{fila.credito ? (
							<>
								Crédito{" "}
								<span className="whitespace-nowrap">{fila.credito}</span>
							</>
						) : null}
						{fila.credito && fila.asesor ? " · " : null}
						{fila.asesor}
					</span>
				</span>
				<span className="flex shrink-0 items-center justify-between gap-3">
					<Badge variant={tipo.variante}>{tipo.etiqueta}</Badge>
					<span className="type-caption @md:w-20 shrink-0 whitespace-nowrap text-right text-fg-secondary">
						{fila.solicitadoEn ? haceCuanto(fila.solicitadoEn, ahora) : "—"}
					</span>
				</span>
			</EnlaceDestino>
		</li>
	);
}

export function AprobacionesPendientes({
	filas,
	total,
	cargando,
	error,
	onReintentar,
	verTodas,
	bandejas,
	ahora = new Date(),
}: AprobacionesPendientesProps) {
	let cuerpo: React.ReactNode;
	if (cargando && filas.length === 0) {
		cuerpo = (
			<div className="flex flex-col gap-3" aria-hidden>
				{[0, 1, 2, 3].map((i) => (
					<Skeleton key={i} className="h-11 w-full" />
				))}
			</div>
		);
	} else if (error && filas.length === 0) {
		cuerpo = (
			<EmptyState
				size="sm"
				variant="error"
				title="No se pudieron cargar las aprobaciones"
				action={
					<Button variant="outline" size="sm" onClick={onReintentar}>
						Reintentar
					</Button>
				}
			/>
		);
	} else if (filas.length === 0) {
		cuerpo = (
			<EmptyState
				size="sm"
				variant="empty"
				title="Sin aprobaciones pendientes"
				description="Nada espera su decisión en este momento."
			/>
		);
	} else {
		cuerpo = (
			<ul className="@container flex flex-col divide-y divide-divider">
				{filas.map((f) => (
					<Fila key={f.id} fila={f} ahora={ahora} />
				))}
			</ul>
		);
	}

	return (
		<TarjetaSupervision
			id="aprobaciones-pendientes"
			className="scroll-mt-4"
			titulo="Aprobaciones pendientes"
			descripcion={
				cargando && filas.length === 0
					? "Cargando…"
					: `${total.toLocaleString("es-GT")} ${total === 1 ? "pendiente" : "pendientes"} · las más antiguas primero`
			}
			accion={<EnlaceVer destino={verTodas}>Ver todas</EnlaceVer>}
		>
			{cuerpo}
			{bandejas.length > 0 ? (
				<div className="flex flex-wrap gap-x-4 gap-y-1.5 border-divider border-t pt-3">
					{bandejas.map((b) => (
						<EnlaceDestino
							key={b.clave}
							destino={b.destino}
							className="type-caption rounded-sm text-fg-secondary outline-none hover:text-fg hover:underline focus-visible:ring-2 focus-visible:ring-ring"
						>
							{b.etiqueta}
							{b.cantidad !== null ? (
								<span className="ml-1 font-semibold text-fg tabular-nums">
									{b.cantidad.toLocaleString("es-GT")}
								</span>
							) : null}
						</EnlaceDestino>
					))}
				</div>
			) : null}
		</TarjetaSupervision>
	);
}
