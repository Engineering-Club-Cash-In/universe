import {
	ArrowRight,
	ArrowUpDown,
	CircleAlert,
	Columns3,
	ListFilter,
	Loader2,
	Search,
} from "lucide-react";
import type * as React from "react";
import {
	COLUMNAS_ASESOR,
	type FilaCartera,
	FilaCreditoAsesor,
} from "@/components/cobros/asesor/fila-cartera";
import { LineaTiempoGestiones } from "@/components/cobros/historial/linea-tiempo";
import type { FilaHistorialData } from "@/components/cobros/historial/tipos";
import {
	type Destino,
	EnlaceDestino,
} from "@/components/cobros/supervision/destino";
import { EnlaceVer } from "@/components/cobros/supervision/tarjeta";
import type { Bucket } from "@/components/ds/badges";
import { DistribucionBucket } from "@/components/ds/distribucion-bucket";
import { KpiSimple } from "@/components/ds/kpi";
import { TablaCartera } from "@/components/ds/tabla-cartera";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { cn } from "@/lib/utils";

/**
 * Pestaña «Resumen» del Detalle del asesor (Figma 2082:13). Presentación pura:
 * KPIs, «Diagnóstico» (distribución de su cartera y casos críticos), «Cartera
 * de {nombre} · vista rápida» y las gestiones más recientes.
 *
 * Convención de los datos: `undefined` = cargando, `null` = sin dato («—»).
 */

const formatoEntero = new Intl.NumberFormat("es-GT");

/** Botones de la barra de la tabla (los mismos íconos de ToolbarButton). */
const HERRAMIENTAS = {
	buscar: { icono: Search, texto: "Buscar" },
	filtros: { icono: ListFilter, texto: "Filtros" },
	ordenar: { icono: ArrowUpDown, texto: "Ordenar" },
	columnas: { icono: Columns3, texto: "Columnas" },
};

export type KpisAsesor = {
	creditos: number | null | undefined;
	/** Atendidos / planificados del último cierre de agenda. */
	cumplimiento:
		| { atendidos: number; planificados: number; fecha: string | null }
		| null
		| undefined;
	/** Contactabilidad del período (0–100) y la del período anterior. */
	contactabilidad:
		| { actual: number | null; anterior: number | null }
		| null
		| undefined;
	/** «vs. 7 días previos». */
	comparacion: string;
	/** Texto del tooltip de contactabilidad (qué período mide). */
	infoContactabilidad: string;
};

export type ItemCritico = {
	clave: string;
	cantidad: number | null | undefined;
	/** «convenios pendientes de aprobación». */
	etiqueta: string;
	destino?: Destino;
	/** Sin fuente todavía: «—» con «Pronto». */
	pronto?: boolean;
	info?: string;
};

export type ResumenAsesorVistaProps = {
	nombre: string;
	kpis: KpisAsesor;
	distribucion:
		| {
				segmentos: { bucket: Bucket; cuentas: number }[];
				total: number;
				/** «Asesor Senior (B2 y B3)». */
				pool: string;
				error?: boolean;
		  }
		| null
		| undefined;
	criticos: {
		items: ItemCritico[];
		/** Suma de los que tienen dato; `undefined` mientras carga alguno. */
		total: number | null | undefined;
		verCasos: Destino;
	};
	cartera: {
		filas: FilaCartera[];
		total: number | null;
		cargando: boolean;
		error: string | null;
		onReintentar?: () => void;
		/** «B2 y B3» (pastilla junto al título). */
		buckets: string;
		destino: Destino;
		onAbrir: (indice: number) => void;
		onVistaRapida: (creditoId: string) => void;
	};
	actividad: {
		items: FilaHistorialData[];
		cargando: boolean;
		error: boolean;
		/** Sin usuario del CRM: no se puede consultar su historial. */
		sinUsuario?: boolean;
		esSupervisor: boolean;
		onVerTodo: () => void;
		hoy?: string;
	};
};

/** «B2 y B3» · «B0, B1 y B2» · «Sin pool». */
export function textoBuckets(buckets: readonly number[]) {
	const lista = [...buckets].sort((a, b) => a - b).map((b) => `B${b}`);
	if (lista.length === 0) return "Sin pool";
	if (lista.length === 1) return lista[0];
	return `${lista.slice(0, -1).join(", ")} y ${lista[lista.length - 1]}`;
}

function ValorCargando() {
	return (
		<span className="inline-block h-8 w-20 animate-pulse rounded-md bg-muted align-middle" />
	);
}

function valorKpi(v: React.ReactNode | undefined) {
	return v === undefined ? <ValorCargando /> : v;
}

function KpisResumen({ kpis }: { kpis: KpisAsesor }) {
	const { creditos, cumplimiento, contactabilidad } = kpis;
	const variacion =
		contactabilidad?.actual != null && contactabilidad.anterior != null
			? Math.round(contactabilidad.actual - contactabilidad.anterior)
			: null;
	return (
		<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
			<KpiSimple
				title="Créditos asignados"
				info="Créditos de su pool en cartera (carga por asesor y bucket)."
				value={valorKpi(
					creditos === null
						? "—"
						: creditos === undefined
							? undefined
							: formatoEntero.format(creditos),
				)}
			/>
			<KpiSimple
				title="Gestiones cumplidas"
				info="Agenda atendida / planificada en el último cierre de agenda."
				value={valorKpi(
					cumplimiento === null
						? "—"
						: cumplimiento === undefined
							? undefined
							: `${cumplimiento.atendidos} / ${cumplimiento.planificados}`,
				)}
				showTrend={!!cumplimiento?.fecha}
				comparison={
					cumplimiento?.fecha ? `Cierre del ${cumplimiento.fecha}` : undefined
				}
			/>
			<KpiSimple
				title="Contactabilidad"
				info={kpis.infoContactabilidad}
				value={valorKpi(
					contactabilidad === undefined
						? undefined
						: contactabilidad?.actual == null
							? "—"
							: `${Math.round(contactabilidad.actual)}%`,
				)}
				showTrend={contactabilidad !== undefined}
				trend={
					variacion === null || variacion === 0
						? "neutra"
						: variacion > 0
							? "positiva"
							: "negativa"
				}
				trendValue={
					variacion === null
						? undefined
						: `${variacion > 0 ? "+" : variacion < 0 ? "−" : ""}${Math.abs(variacion)} pts`
				}
				comparison={kpis.comparacion}
			/>
			{/* TODO(José) · tarea M1: resultado de cartera (recuperación) por asesor, con meta. */}
			<KpiSimple
				title="Resultado de cartera"
				info="Recuperación de su cartera frente a la meta. Disponible pronto."
				value="—"
				showTrend
				comparison={
					<Badge variant="secondary" className="px-2 py-0">
						Pronto
					</Badge>
				}
			/>
		</div>
	);
}

function CasosCriticos({
	criticos,
}: {
	criticos: ResumenAsesorVistaProps["criticos"];
}) {
	return (
		<section className="flex min-w-0 flex-col gap-4 rounded-2xl bg-surface p-5 text-fg shadow-clay-raised sm:px-6">
			<div className="flex items-start justify-between gap-2">
				<h3 className="font-medium text-[13px] text-fg-secondary leading-[1.26]">
					Casos críticos
				</h3>
				<span className="flex size-7 items-center justify-center rounded-full bg-danger-subtle text-danger-text">
					<CircleAlert aria-hidden className="size-4" />
				</span>
			</div>
			<p className="font-bold text-[30px] text-danger-text leading-[1.26]">
				{criticos.total === undefined ? (
					<ValorCargando />
				) : criticos.total === null ? (
					"—"
				) : (
					formatoEntero.format(criticos.total)
				)}
			</p>
			<ul className="flex flex-col gap-2 border-divider border-t pt-4">
				{criticos.items.map((item) => {
					const cantidad =
						item.cantidad === undefined ? (
							<Loader2 aria-hidden className="inline size-3 animate-spin" />
						) : item.cantidad === null ? (
							"—"
						) : (
							formatoEntero.format(item.cantidad)
						);
					const texto = (
						<>
							<span className="min-w-6 font-semibold text-fg tabular-nums">
								{cantidad}
							</span>
							<span className="min-w-0 text-fg-secondary">{item.etiqueta}</span>
						</>
					);
					return (
						<li
							key={item.clave}
							className="flex items-center gap-2.5 text-[13px] leading-[1.26]"
						>
							<span
								aria-hidden
								className={cn(
									"size-1.5 shrink-0 rounded-full",
									item.pronto ? "bg-line" : "bg-danger-solid",
								)}
							/>
							{item.destino && !item.pronto ? (
								<EnlaceDestino
									destino={item.destino}
									title={item.info}
									className="flex min-w-0 items-center gap-2 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
								>
									{texto}
								</EnlaceDestino>
							) : (
								<span
									className="flex min-w-0 items-center gap-2"
									title={item.info}
								>
									{texto}
									{item.pronto ? (
										<Badge variant="secondary" className="px-2 py-0">
											Pronto
										</Badge>
									) : null}
								</span>
							)}
						</li>
					);
				})}
			</ul>
			<EnlaceVer destino={criticos.verCasos} className="w-fit">
				Ver casos
			</EnlaceVer>
		</section>
	);
}

function Distribucion({
	distribucion,
}: {
	distribucion: ResumenAsesorVistaProps["distribucion"];
}) {
	if (distribucion === undefined) {
		return <Skeleton className="h-36 rounded-2xl" />;
	}
	if (distribucion === null || distribucion.error) {
		return (
			<div className="flex min-h-36 flex-col justify-center gap-1 rounded-[16px] border border-line-subtle bg-surface px-5.5 py-5">
				<p className="font-semibold text-[15px] text-fg">
					Distribución de su cartera
				</p>
				<p className="type-body-sm text-fg-secondary">
					{distribucion?.error
						? "No se pudo cargar la carga por bucket. Intente de nuevo en unos minutos."
						: "Sin datos de carga para este asesor."}
				</p>
			</div>
		);
	}
	const { segmentos, total, pool } = distribucion;
	const conCuentas = segmentos.filter((s) => s.cuentas > 0);
	if (total === 0 || conCuentas.length === 0) {
		return (
			<div className="flex min-h-36 flex-col justify-center gap-1 rounded-[16px] border border-line-subtle bg-surface px-5.5 py-5">
				<p className="font-semibold text-[15px] text-fg">
					Distribución de su cartera
				</p>
				<p className="type-body-sm text-fg-secondary">
					Sin créditos asignados · {pool}
				</p>
			</div>
		);
	}
	return (
		<DistribucionBucket
			title="Distribución de su cartera"
			subtitle={`${formatoEntero.format(total)} ${total === 1 ? "crédito" : "créditos"} · ${pool}`}
			segments={conCuentas.map((s) => ({
				bucket: s.bucket,
				label: s.bucket,
				count: `${formatoEntero.format(s.cuentas)} ${s.cuentas === 1 ? "crédito" : "créditos"}`,
				percent: (s.cuentas / total) * 100,
			}))}
		/>
	);
}

function VistaRapidaCartera({
	nombre,
	cartera,
}: {
	nombre: string;
	cartera: ResumenAsesorVistaProps["cartera"];
}) {
	const { filas, total } = cartera;
	const herramienta = (accion: keyof typeof HERRAMIENTAS) => {
		const { icono: Icono, texto } = HERRAMIENTAS[accion];
		// En la vista rápida, las herramientas de la tabla abren la cartera
		// completa, donde están la búsqueda, los filtros, el orden y las columnas.
		return (
			<ToolbarButton key={accion} asChild>
				<EnlaceDestino destino={cartera.destino}>
					<Icono aria-hidden size={14} absoluteStrokeWidth />
					{texto}
				</EnlaceDestino>
			</ToolbarButton>
		);
	};
	const contador =
		total === null
			? null
			: `${formatoEntero.format(total)} ${total === 1 ? "crédito" : "créditos"} · ${cartera.buckets}`;
	return (
		<TablaCartera
			titulo={`Cartera de ${nombre}`}
			contador={contador}
			columnas={COLUMNAS_ASESOR}
			herramientas={
				<div className="hidden flex-wrap items-center gap-2 md:flex">
					{herramienta("buscar")}
					{herramienta("filtros")}
					{herramienta("ordenar")}
					{herramienta("columnas")}
				</div>
			}
			vacio={
				cartera.cargando ? (
					<span className="inline-flex items-center gap-2">
						<Loader2 className="size-4 animate-spin" /> Cargando cartera…
					</span>
				) : cartera.error ? (
					<span className="inline-flex flex-wrap items-center justify-center gap-2 text-danger-text">
						{cartera.error}
						{cartera.onReintentar ? (
							<Button
								size="sm"
								variant="outline"
								onClick={cartera.onReintentar}
							>
								Reintentar
							</Button>
						) : null}
					</span>
				) : (
					"Sin créditos asignados."
				)
			}
			pie={
				<div className="flex flex-wrap items-center justify-between gap-2 border-divider border-t px-4 py-3">
					<span className="type-body-sm text-fg-tertiary">
						{filas.length > 0 && total !== null
							? `Mostrando 1–${filas.length} de ${formatoEntero.format(total)}`
							: ""}
					</span>
					<EnlaceVer destino={cartera.destino}>Ver cartera completa</EnlaceVer>
				</div>
			}
		>
			{cartera.cargando || cartera.error
				? null
				: filas.map((fila, i) => (
						<FilaCreditoAsesor
							key={fila.contratoId}
							fila={fila}
							onVistaRapida={cartera.onVistaRapida}
							onAbrir={() => cartera.onAbrir(i)}
						/>
					))}
		</TablaCartera>
	);
}

function ActividadReciente({
	nombre,
	actividad,
}: {
	nombre: string;
	actividad: ResumenAsesorVistaProps["actividad"];
}) {
	const primerNombre = nombre.trim().split(/\s+/)[0] ?? nombre;
	return (
		<section className="flex min-w-0 flex-col gap-3">
			<div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1.5">
				<div className="flex min-w-0 flex-col gap-0.5">
					<h2 className="type-heading-sm text-fg">Historial de actividad</h2>
					<p className="type-body-sm text-fg-secondary">
						Lo más reciente que ha trabajado {primerNombre}
					</p>
				</div>
				<button
					type="button"
					onClick={actividad.onVerTodo}
					className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md font-semibold text-brand text-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
				>
					Ver historial completo
					<ArrowRight aria-hidden className="size-3.5" />
				</button>
			</div>
			<div className="rounded-2xl border border-line-subtle bg-surface p-4 sm:p-6">
				{actividad.sinUsuario ? (
					<p className="type-body-sm text-fg-secondary">
						Este asesor no tiene un usuario del CRM vinculado a su correo de
						Cash-In, así que no se puede consultar su historial.
					</p>
				) : actividad.cargando ? (
					<div className="flex flex-col gap-4">
						{[0, 1, 2].map((i) => (
							<Skeleton key={i} className="h-12 w-full" />
						))}
					</div>
				) : actividad.error ? (
					<p className="type-body-sm text-danger-text">
						No se pudo cargar el historial. Intente de nuevo en unos segundos.
					</p>
				) : actividad.items.length === 0 ? (
					<p className="type-body-sm text-fg-secondary">
						{primerNombre} no registró gestiones en los últimos 30 días.
					</p>
				) : (
					<LineaTiempoGestiones
						items={actividad.items}
						agrupar={false}
						esSupervisor={actividad.esSupervisor}
						hoy={actividad.hoy}
					/>
				)}
			</div>
		</section>
	);
}

export function ResumenAsesorVista({
	nombre,
	kpis,
	distribucion,
	criticos,
	cartera,
	actividad,
}: ResumenAsesorVistaProps) {
	return (
		<div className="flex min-w-0 flex-col gap-8">
			<KpisResumen kpis={kpis} />

			<section className="flex min-w-0 flex-col gap-3">
				<h2 className="type-heading-sm text-fg">Diagnóstico</h2>
				<div className="grid items-start gap-5 lg:grid-cols-2">
					<Distribucion distribucion={distribucion} />
					<CasosCriticos criticos={criticos} />
				</div>
			</section>

			<section className="flex min-w-0 flex-col gap-3">
				<div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1.5">
					<h2 className="type-heading-sm text-fg">
						Cartera de {nombre} · vista rápida
					</h2>
					<EnlaceVer destino={cartera.destino}>Ver cartera completa</EnlaceVer>
				</div>
				<VistaRapidaCartera nombre={nombre} cartera={cartera} />
			</section>

			<ActividadReciente nombre={nombre} actividad={actividad} />
		</div>
	);
}
