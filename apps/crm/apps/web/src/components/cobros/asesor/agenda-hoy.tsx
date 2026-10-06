import { differenceInCalendarDays } from "date-fns";
import {
	CalendarClock,
	CalendarDays,
	CalendarRange,
	ChevronRight,
	CircleAlert,
	Clock,
	Handshake,
	type LucideIcon,
	Phone,
	PhoneOff,
	Timer,
	TriangleAlert,
	UserCheck,
	Users,
} from "lucide-react";
import type * as React from "react";
import { BucketBadge } from "@/components/ds/badges";
import { Agenda } from "@/components/ui/agenda";
import { Badge } from "@/components/ui/badge";
import { OperationalSummaryItem } from "@/components/ui/operational-summary";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { bucketDeFila } from "./fila-cartera";

/**
 * "Agenda de hoy" del Dashboard del asesor (Figma «CRM Ventas» › Asesor Junior ›
 * 01 · Dashboard). Presentación pura: recibe los conteos por props.
 *
 * - Caja con borde de marca = `Agenda` de ui/agenda.tsx (progreso "X de Y tareas
 *   realizadas hoy" mientras está colapsada).
 * - Contadores = `OperationalSummaryItem` (02 · Componentes › Operational Summary),
 *   en el orden de Figma y, después, los que ya existían en Mi día y Figma no trae.
 *   Cada contador filtrable filtra la tabla "Casos que requieren atención hoy".
 *   Un contador sin fuente todavía (`null`) se muestra con "pronto".
 * - Expandida: seguimientos programados (antes en el Dashboard) y vencimientos de
 *   los próximos cinco días (antes en Mi día).
 */

export type ClaveContador =
	| "llamada_hoy"
	| "promesa_hoy"
	| "incumplida"
	| "pagos_por_confirmar"
	| "sin_contacto"
	| "referencias"
	| "sla_hoy"
	| "vence_hoy"
	| "promesa_proxima"
	| "sin_intento_hoy";

/** Contadores que filtran la tabla (categorías de getColaDia o `filtroExtra`). */
export type ClaveFiltro = Exclude<
	ClaveContador,
	"pagos_por_confirmar" | "referencias"
>;

type DefContador = {
	clave: ClaveContador;
	etiqueta: string;
	icono: LucideIcon;
	tono: "normal" | "warning" | "danger";
	filtrable: boolean;
};

/** Orden de Figma y, al final, los de Mi día que Figma no tiene. */
export const CONTADORES_AGENDA: DefContador[] = [
	{
		clave: "llamada_hoy",
		etiqueta: "Llamadas pendientes",
		icono: Phone,
		tono: "normal",
		filtrable: true,
	},
	{
		clave: "promesa_hoy",
		etiqueta: "Promesas vencen hoy",
		icono: CalendarDays,
		tono: "normal",
		filtrable: true,
	},
	{
		clave: "incumplida",
		etiqueta: "Promesas vencidas",
		icono: CircleAlert,
		tono: "danger",
		filtrable: true,
	},
	{
		clave: "pagos_por_confirmar",
		etiqueta: "Pagos por confirmar",
		icono: Handshake,
		tono: "normal",
		filtrable: false,
	},
	{
		clave: "sin_contacto",
		etiqueta: "Sin intento de contacto",
		icono: Clock,
		tono: "warning",
		filtrable: true,
	},
	{
		clave: "referencias",
		etiqueta: "Referencias por contactar",
		icono: Users,
		tono: "normal",
		filtrable: false,
	},
	{
		clave: "sla_hoy",
		etiqueta: "SLA por gestionar hoy",
		icono: Timer,
		tono: "normal",
		filtrable: true,
	},
	{
		clave: "vence_hoy",
		etiqueta: "Cuota vence hoy",
		icono: CalendarClock,
		tono: "normal",
		filtrable: true,
	},
	{
		clave: "promesa_proxima",
		etiqueta: "Promesas próximas",
		icono: CalendarRange,
		tono: "normal",
		filtrable: true,
	},
	{
		clave: "sin_intento_hoy",
		etiqueta: "Sin intento hoy",
		icono: PhoneOff,
		tono: "normal",
		filtrable: true,
	},
];

export function etiquetaContador(clave: ClaveContador) {
	return CONTADORES_AGENDA.find((c) => c.clave === clave)?.etiqueta ?? clave;
}

/* ── Próximos días y seguimientos ─────────────────────────────────────────── */

export type ItemProximoDia = {
	cuotaId: number;
	numeroCreditoSifco: string;
	cliente: string | null;
	bucket: number | null;
	montoCuota: string;
	asesor?: string | null;
	cubierto?: boolean;
};

export type DiaProximo = {
	dia: number;
	total: number;
	items: ItemProximoDia[];
};

export type ProximosDiasVista = {
	cargando: boolean;
	/** Algún día (D-1…D-5) no se pudo consultar: el total puede estar incompleto. */
	error: boolean;
	sinAsesor: boolean;
	ausente: boolean;
	dias: DiaProximo[];
};

export type SeguimientoProgramado = {
	id: string;
	/** Id para /cobros/$id (tipo caso). */
	idFicha: string;
	cliente: string;
	vehiculo: string;
	fecha: Date;
};

export type SeguimientosVista = {
	cargando: boolean;
	items: SeguimientoProgramado[];
};

export type AgendaHoyProps = {
	/** `undefined` mientras carga. */
	progreso?: { hechas: number; total: number };
	/** Valor por contador: número, `null` = sin fuente ("pronto"), ausente = cargando. */
	valores: Partial<Record<ClaveContador, number | null>>;
	cargandoConteos: boolean;
	filtroActivo: ClaveFiltro | null;
	onFiltro: (clave: ClaveFiltro) => void;
	expandida: boolean;
	onExpandida: (v: boolean) => void;
	proximos: ProximosDiasVista;
	seguimientos: SeguimientosVista;
	onAbrirFicha: (id: string, tipo: "caso" | "contrato") => void;
};

const montoQ = (v: string) => {
	const n = Number(v ?? 0);
	return Number.isFinite(n)
		? `Q${n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
		: "—";
};

function etiquetaDia(dia: number) {
	return dia === 1 ? "Mañana" : `En ${dia} días`;
}

/** CB-114: cuenta de un titular ausente que el usuario cubre hoy. */
function ChipCobertura({ asesor }: { asesor?: string | null }) {
	return (
		<Badge variant="brand" className="shrink-0 gap-1 font-medium">
			<UserCheck aria-hidden className="size-3" />
			{asesor ? `Cubriendo a ${asesor}` : "Cobertura"}
		</Badge>
	);
}

function Contador({
	def,
	valor,
	cargando,
	activo,
	onClick,
}: {
	def: DefContador;
	valor: number | null | undefined;
	cargando: boolean;
	activo: boolean;
	onClick?: () => void;
}) {
	const base = "-my-1 rounded-lg px-2 py-1 transition-colors";
	if (valor === null) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<div className={cn(base, "cursor-default opacity-60")}>
						<OperationalSummaryItem
							icon={def.icono}
							value="—"
							label={
								<span className="inline-flex items-center gap-1.5">
									{def.etiqueta}
									<Badge
										variant="neutral"
										className="h-4 px-1.5 text-[9px] uppercase"
									>
										pronto
									</Badge>
								</span>
							}
						/>
					</div>
				</TooltipTrigger>
				<TooltipContent side="top">Disponible próximamente</TooltipContent>
			</Tooltip>
		);
	}
	const valorVista =
		valor === undefined && cargando ? (
			<Skeleton className="inline-block h-4 w-5 align-middle" />
		) : (
			(valor ?? 0)
		);
	const tono = (valor ?? 0) > 0 ? def.tono : "normal";
	return (
		<OperationalSummaryItem
			icon={def.icono}
			value={valorVista}
			label={def.etiqueta}
			status={tono}
			onClick={def.filtrable ? onClick : undefined}
			aria-pressed={def.filtrable ? activo : undefined}
			title={def.filtrable ? "Filtrar los casos de hoy" : undefined}
			className={cn(
				base,
				def.filtrable && "hover:bg-surface/70",
				activo && "bg-surface shadow-clay-subtle ring-1 ring-brand",
			)}
		/>
	);
}

function BloqueSeguimientos({
	seguimientos,
	onAbrirFicha,
}: Pick<AgendaHoyProps, "seguimientos" | "onAbrirFicha">) {
	const hoy = new Date();
	hoy.setHours(0, 0, 0, 0);
	return (
		<li className="flex flex-col gap-2">
			<div className="flex items-baseline justify-between gap-3">
				<p className="type-label-base text-fg">Seguimientos programados</p>
				<span className="type-caption text-fg-tertiary">
					Hoy y los próximos 7 días
				</span>
			</div>
			{seguimientos.cargando ? (
				<Skeleton className="h-12 w-full rounded-xl" />
			) : seguimientos.items.length === 0 ? (
				<p className="type-body-sm text-fg-secondary">
					No tiene seguimientos programados.
				</p>
			) : (
				<div className="flex flex-col gap-1.5">
					{seguimientos.items.map((s) => {
						const dias = differenceInCalendarDays(s.fecha, hoy);
						const tono =
							dias < 0
								? "text-danger-text"
								: dias === 0
									? "text-warning-text"
									: "text-fg-secondary";
						const punto =
							dias < 0
								? "bg-danger-solid"
								: dias === 0
									? "bg-warning-solid"
									: "bg-success-solid";
						return (
							<button
								key={s.id}
								type="button"
								onClick={() => onAbrirFicha(s.idFicha, "caso")}
								className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-line-subtle bg-surface px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
							>
								<span className="flex min-w-0 items-center gap-3">
									<span
										aria-hidden
										className={cn("size-2 shrink-0 rounded-full", punto)}
									/>
									<span className="flex min-w-0 flex-col">
										<span className="type-label-base truncate text-fg">
											{s.cliente}
										</span>
										{s.vehiculo ? (
											<span className="type-caption truncate text-fg-tertiary">
												{s.vehiculo}
											</span>
										) : null}
									</span>
								</span>
								<span
									className={cn(
										"shrink-0 text-right font-semibold text-[13px]",
										tono,
									)}
								>
									{dias === 0
										? "Hoy"
										: dias < 0
											? `Vencido · ${s.fecha.toLocaleDateString("es-GT")}`
											: s.fecha.toLocaleDateString("es-GT")}
								</span>
							</button>
						);
					})}
				</div>
			)}
		</li>
	);
}

function BloqueProximosDias({
	proximos,
	onAbrirFicha,
}: Pick<AgendaHoyProps, "proximos" | "onAbrirFicha">) {
	const total = proximos.dias.reduce((t, d) => t + d.total, 0);
	let cuerpo: React.ReactNode;
	if (proximos.cargando) {
		cuerpo = <Skeleton className="h-12 w-full rounded-xl" />;
	} else if (proximos.sinAsesor) {
		cuerpo = (
			<p className="type-body-sm text-fg-secondary">
				Su usuario no está vinculado a un asesor de cartera (por correo).
				Solicite al supervisor que revise su correo de asesor.
			</p>
		);
	} else if (proximos.ausente) {
		cuerpo = (
			<p className="type-body-sm text-fg-secondary">
				Hoy está registrado como ausente: su suplente está trabajando su agenda.
			</p>
		);
	} else if (total === 0 && !proximos.error) {
		cuerpo = (
			<p className="type-body-sm text-fg-secondary">
				No tiene vencimientos en los próximos cinco días.
			</p>
		);
	} else {
		cuerpo = (
			<div className="flex flex-col gap-3">
				{proximos.dias
					.filter((d) => d.total > 0)
					.map((d) => (
						<div key={d.dia} className="flex flex-col gap-1.5">
							<div className="flex items-center justify-between">
								<span className="type-label-sm text-fg">
									{etiquetaDia(d.dia)}
								</span>
								<span className="type-caption text-fg-tertiary">
									{d.total} crédito{d.total === 1 ? "" : "s"}
								</span>
							</div>
							{d.items.map((item) => {
								const bucket = bucketDeFila(item.bucket ?? 0, null);
								return (
									<button
										key={item.cuotaId}
										type="button"
										onClick={() =>
											onAbrirFicha(item.numeroCreditoSifco, "caso")
										}
										className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-line-subtle bg-surface px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
									>
										<span className="flex min-w-0 items-center gap-3">
											{bucket ? <BucketBadge bucket={bucket} /> : null}
											<span className="flex min-w-0 flex-col">
												<span className="flex min-w-0 items-center gap-2">
													<span className="type-label-base truncate text-fg">
														{item.cliente ?? "Cliente sin nombre"}
													</span>
													{item.cubierto ? (
														<ChipCobertura asesor={item.asesor} />
													) : null}
												</span>
												<span className="type-caption text-fg-tertiary">
													SIFCO {item.numeroCreditoSifco} ·{" "}
													{montoQ(item.montoCuota)}
												</span>
											</span>
										</span>
										<ChevronRight
											aria-hidden
											className="size-4 shrink-0 text-fg-tertiary"
										/>
									</button>
								);
							})}
							{d.total > d.items.length ? (
								<p className="type-caption text-fg-tertiary">
									Mostrando los primeros {d.items.length} de {d.total} créditos.
								</p>
							) : null}
						</div>
					))}
			</div>
		);
	}

	return (
		<li className="flex flex-col gap-2">
			<div className="flex items-baseline justify-between gap-3">
				<p className="type-label-base text-fg">Próximos días</p>
				<span className="type-caption text-fg-tertiary">
					Vencimientos de mañana a D-5
					{!proximos.cargando ? ` · ${total}` : ""}
				</span>
			</div>
			{proximos.error && !proximos.cargando ? (
				<p className="type-body-sm flex items-center gap-1.5 text-warning-text">
					<TriangleAlert aria-hidden className="size-4 shrink-0" />
					No se pudieron cargar todos los días: el total puede estar incompleto.
				</p>
			) : null}
			{cuerpo}
		</li>
	);
}

export function AgendaHoy({
	progreso,
	valores,
	cargandoConteos,
	filtroActivo,
	onFiltro,
	expandida,
	onExpandida,
	proximos,
	seguimientos,
	onAbrirFicha,
}: AgendaHoyProps) {
	return (
		<Agenda
			expanded={expandida}
			onExpandedChange={onExpandida}
			expandLabel="Ver próximos días ▾"
			collapseLabel="Ocultar ▴"
			progress={
				progreso
					? {
							done: progreso.hechas,
							total: progreso.total,
							label:
								progreso.total === 0
									? "Sin tareas de agenda para hoy"
									: undefined,
						}
					: { done: 0, total: 0, label: "Cargando tareas de hoy…" }
			}
			summary={
				<div className="-mx-2 flex flex-wrap items-center gap-x-2 gap-y-2">
					{CONTADORES_AGENDA.map((def) => (
						<Contador
							key={def.clave}
							def={def}
							valor={valores[def.clave]}
							cargando={cargandoConteos}
							activo={filtroActivo === def.clave}
							onClick={() => onFiltro(def.clave as ClaveFiltro)}
						/>
					))}
				</div>
			}
		>
			<BloqueSeguimientos
				seguimientos={seguimientos}
				onAbrirFicha={onAbrirFicha}
			/>
			<BloqueProximosDias proximos={proximos} onAbrirFicha={onAbrirFicha} />
		</Agenda>
	);
}
