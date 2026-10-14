import type * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { type Destino, EnlaceDestino } from "./destino";
import { EnlaceVer, TarjetaSupervision } from "./tarjeta";

/**
 * «Equipo» del Dashboard del supervisor (Figma `1954:14`): una fila por asesor
 * con sus casos, contactos de hoy, meta, rescate y un punto de estado.
 * Presentación pura.
 *
 *   ASESOR         → pool de cartera (getAsesoresTraslados), con «Ausente» si
 *                    tiene una cobertura vigente hoy.
 *   CASOS          → cuentas del asesor en sus buckets (getCargaPorAsesorBucket).
 *   CONTACTOS HOY  → gestiones manuales de hoy, en vivo (S4).
 *   META           → recuperación del período ÷ meta prorrateada, en % (S4).
 *   RESCATE        → recuperados ÷ (recuperados + escalados) del período (S4).
 *   AGENDA         → cumplimiento de agenda del último cierre (no está en el
 *                    Figma; es lo que hoy tiene el supervisor para medir al equipo).
 *   Punto          → `estadoDelAsesor` (abajo): el mismo criterio en la pantalla
 *                    y en el showcase.
 *
 * Meta y Rescate dependen del período del segmentado Día / Semana / Mes;
 * `actualizando` atenúa la tabla mientras llega el período nuevo.
 *
 * Cada fila abre el Detalle del asesor (`/cobros/equipo/<asesor_id>`).
 */

export type EstadoAsesor = "bien" | "atencion" | "riesgo" | "sin_dato";

/** Umbrales del punto de estado, en %: verde desde 80, ámbar desde 60. */
export const UMBRAL_ESTADO = { bien: 80, atencion: 60 } as const;

/**
 * Punto de estado de cada asesor. Manda la **Meta** del período (recuperación ÷
 * meta prorrateada), que es lo que colorea el Figma; si el asesor no tiene
 * meta, se usa el cumplimiento de **Agenda** del último cierre. Verde desde
 * 80 %, ámbar desde 60 %, rojo por debajo y gris sin ninguno de los dos.
 *
 * «Rescate» no entra: con pocos movimientos de bucket sale entre 50 y 100 %
 * (1 de 1 = 100 %) y pintaría de verde a quien casi no movió su cartera
 * (doc 23, S4).
 */
export function estadoDelAsesor(f: {
	meta: number | null;
	agenda: number | null;
}): EstadoAsesor {
	const pct = f.meta ?? f.agenda;
	if (pct === null) return "sin_dato";
	if (pct >= UMBRAL_ESTADO.bien) return "bien";
	if (pct >= UMBRAL_ESTADO.atencion) return "atencion";
	return "riesgo";
}

const PUNTO: Record<EstadoAsesor, { clase: string; texto: string }> = {
	bien: { clase: "bg-success-solid", texto: "Al día" },
	atencion: { clase: "bg-warning-solid", texto: "Requiere atención" },
	riesgo: { clase: "bg-danger-solid", texto: "En riesgo" },
	sin_dato: { clase: "bg-line", texto: "Sin datos" },
};

export type FilaEquipo = {
	asesorId: number;
	nombre: string;
	casos: number | null;
	contactosHoy: number | null;
	/** %. */
	meta: number | null;
	/** %. */
	rescate: number | null;
	/** % de cumplimiento de agenda del último cierre. */
	agenda: number | null;
	/** Motivo de la cobertura vigente («Vacaciones»), si está ausente. */
	ausencia: string | null;
	estado: EstadoAsesor;
	destino: Destino;
};

export type EquipoTablaProps = {
	filas: FilaEquipo[];
	cargando: boolean;
	error: boolean;
	onReintentar: () => void;
	verEquipo: Destino;
	/** Día del cierre de agenda que se muestra («06/10/2026»). */
	fechaAgenda: string | null;
	/** Llega el período nuevo: Meta y Rescate todavía son del anterior. */
	actualizando?: boolean;
};

function pct(v: number | null) {
	return v === null ? "—" : `${Math.round(v)}%`;
}

function num(v: number | null) {
	return v === null ? "—" : v.toLocaleString("es-GT");
}

const th =
	"px-2 pb-2.5 font-semibold text-[11px] text-fg-tertiary uppercase leading-[1.26] tracking-wide";
const td = "px-2 py-0 text-right text-fg tabular-nums";

/** Celda con el enlace de la fila: todo el ancho de la celda es clicable. */
function Celda({
	destino,
	className,
	children,
	tabIndex,
}: {
	destino: Destino;
	className?: string;
	children: React.ReactNode;
	tabIndex?: number;
}) {
	return (
		<EnlaceDestino
			destino={destino}
			tabIndex={tabIndex}
			className={cn("flex min-h-11 items-center outline-none", className)}
		>
			{children}
		</EnlaceDestino>
	);
}

export function EquipoTabla({
	filas,
	cargando,
	error,
	onReintentar,
	verEquipo,
	fechaAgenda,
	actualizando,
}: EquipoTablaProps) {
	let cuerpo: React.ReactNode;
	if (cargando && filas.length === 0) {
		cuerpo = (
			<div className="flex flex-col gap-3" aria-hidden>
				{[0, 1, 2, 3].map((i) => (
					<Skeleton key={i} className="h-9 w-full" />
				))}
			</div>
		);
	} else if (error && filas.length === 0) {
		cuerpo = (
			<EmptyState
				size="sm"
				variant="error"
				title="No se pudo cargar el equipo"
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
				variant="no-data"
				title="Sin asesores en el pool"
				description="Ningún asesor tiene buckets asignados."
			/>
		);
	} else {
		cuerpo = (
			// Solo la tabla se desplaza en pantallas angostas; la página no.
			<div
				aria-busy={actualizando || undefined}
				className={cn(
					"-mx-2 overflow-x-auto transition-opacity duration-150",
					actualizando && "opacity-60",
				)}
			>
				<table className="w-full min-w-130 border-collapse text-sm">
					<thead>
						<tr className="border-divider border-b">
							<th className={cn(th, "text-left")}>Asesor</th>
							<th className={cn(th, "text-right")}>Casos</th>
							<th className={cn(th, "text-right")}>Contactos hoy</th>
							<th className={cn(th, "text-right")}>Meta</th>
							<th className={cn(th, "text-right")}>Rescate</th>
							<th className={cn(th, "text-right")}>
								<span className="inline-flex items-center gap-1">
									Agenda
									<InfoTooltip>
										Cumplimiento de la agenda del último cierre
										{fechaAgenda ? ` (${fechaAgenda})` : ""}: gestiones
										atendidas sobre las planificadas.
									</InfoTooltip>
								</span>
							</th>
							<th className={th}>
								<span className="sr-only">Estado</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{filas.map((f) => (
							<tr
								key={f.asesorId}
								className="border-divider border-b transition-colors last:border-b-0 hover:bg-muted/60 [&:has(a:focus-visible)]:ring-2 [&:has(a:focus-visible)]:ring-ring"
							>
								<td className="px-2">
									<Celda destino={f.destino} className="gap-2">
										<span className="wrap-break-word font-medium text-fg">
											{f.nombre}
										</span>
										{f.ausencia ? (
											<Badge variant="warning" title={f.ausencia}>
												Ausente
											</Badge>
										) : null}
									</Celda>
								</td>
								<td className={td}>
									<Celda
										destino={f.destino}
										tabIndex={-1}
										className="justify-end"
									>
										{num(f.casos)}
									</Celda>
								</td>
								<td className={td}>
									<Celda
										destino={f.destino}
										tabIndex={-1}
										className="justify-end"
									>
										{num(f.contactosHoy)}
									</Celda>
								</td>
								<td className={cn(td, "font-semibold")}>
									<Celda
										destino={f.destino}
										tabIndex={-1}
										className="justify-end"
									>
										{pct(f.meta)}
									</Celda>
								</td>
								<td className={cn(td, "font-semibold")}>
									<Celda
										destino={f.destino}
										tabIndex={-1}
										className="justify-end"
									>
										{pct(f.rescate)}
									</Celda>
								</td>
								<td className={td}>
									<Celda
										destino={f.destino}
										tabIndex={-1}
										className="justify-end"
									>
										{pct(f.agenda)}
									</Celda>
								</td>
								<td className="w-6 px-2">
									<Celda
										destino={f.destino}
										tabIndex={-1}
										className="justify-center"
									>
										<span
											role="img"
											aria-label={PUNTO[f.estado].texto}
											title={PUNTO[f.estado].texto}
											className={cn(
												"size-2 rounded-full",
												PUNTO[f.estado].clase,
											)}
										/>
									</Celda>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	}

	return (
		<TarjetaSupervision
			titulo="Equipo"
			descripcion={
				cargando && filas.length === 0 ? (
					"Cargando…"
				) : (
					<span className="inline-flex items-center gap-1">
						{filas.length} {filas.length === 1 ? "asesor" : "asesores"}
						<InfoTooltip>
							El punto de cada fila sale de la Meta del período o, si el asesor
							no tiene meta, de la Agenda: verde desde {UMBRAL_ESTADO.bien} %,
							ámbar desde {UMBRAL_ESTADO.atencion} %, rojo por debajo y gris sin
							datos.
						</InfoTooltip>
					</span>
				)
			}
			accion={<EnlaceVer destino={verEquipo}>Ver equipo completo</EnlaceVer>}
		>
			{cuerpo}
		</TarjetaSupervision>
	);
}
