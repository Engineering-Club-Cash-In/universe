import {
	Banknote,
	Bot,
	Briefcase,
	CalendarClock,
	CheckCircle2,
	Clock,
	CreditCard,
	FileText,
	HandCoins,
	Handshake,
	History,
	Home,
	Layers,
	type LucideIcon,
	Mail,
	MessageCircle,
	MessageSquare,
	Phone,
	PhoneIncoming,
	TriangleAlert,
	Wallet,
	XCircle,
} from "lucide-react";
import * as React from "react";
import {
	HistorialGestiones,
	type ItemGestion,
	SeccionHistorial,
} from "@/components/cobros/ficha/ficha-pestanas";
import { FilterChip } from "@/components/ds/cartera-chips";
import { SegmentedNav } from "@/components/ds/ubicaciones";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	type CortePeriodo,
	contarPorFiltro,
	type EventoHistorial,
	etiquetaFiltro,
	eventosDelPeriodo,
	FILTROS_HISTORIAL,
	type FiltroHistorial,
	filtrarEventos,
	type IconoEvento,
	type PeriodoHistorial,
} from "@/lib/cobros/historial-unificado";
import { fechaLargaGT } from "@/lib/cobros/reglas-caso";
import { cn } from "@/lib/utils";

/**
 * Historial del crédito en UNA línea de tiempo (Ficha 360 › Historial y la
 * pestaña Historial del Workspace): gestiones, promesas de pago, pagos, links
 * de pago, recordatorios, bot de WhatsApp y vida del crédito, con chips de
 * filtro. «Historial actual» e «Histórico» son la misma vista con otro rango de
 * fechas (ver `cortePeriodoActual`).
 *
 * Solo presentación: los datos los arma `useHistorialUnificado`.
 */

/** Una fuente del historial y cómo va su carga. */
export type FuenteHistorial = {
	clave: string;
	etiqueta: string;
	estado: "cargando" | "error" | "ok";
	onReintentar?: () => void;
};

export type DatosHistorialUnificado = {
	/** Todos los eventos, ya mezclados (lo más reciente primero). */
	eventos: EventoHistorial[];
	/** Desde cuándo cuenta el «Historial actual»; null = todo es actual. */
	corte: CortePeriodo | null;
	/** Lo anterior a esta fecha todavía no se cargó completo (ver «Cargar más»). */
	horizonte: number | null;
	/** Falta lo mínimo para ordenar y cortar (gestiones y bucket actual). */
	cargando: boolean;
	fuentes: FuenteHistorial[];
	/** Alguna fuente tiene registros más viejos sin cargar. */
	hayMasEnServidor: boolean;
	cargandoMas: boolean;
	onCargarMas: () => void;
	/** Notas al pie (fuentes con tope que no se puede ampliar). */
	avisos: string[];
};

const POR_PAGINA = 25;

const ICONOS: Record<IconoEvento, LucideIcon> = {
	llamada: Phone,
	llamada_entrante: PhoneIncoming,
	whatsapp: MessageCircle,
	sms: MessageSquare,
	email: Mail,
	visita_domicilio: Home,
	visita_trabajo: Briefcase,
	carta_notarial: FileText,
	pago_gestion: Banknote,
	promesa: HandCoins,
	pago: Wallet,
	link_pago: CreditCard,
	recordatorio: CalendarClock,
	bot: Bot,
	bucket: Layers,
	convenio: Handshake,
	otro: History,
};

/** Un evento → fila de la línea de tiempo. */
function aItemGestion(e: EventoHistorial): ItemGestion {
	const Icono = ICONOS[e.icono];
	const avisos = e.avisos ?? [];
	const extra =
		avisos.length > 0 || e.contenido?.extra ? (
			<div className="space-y-1.5">
				{avisos.map((a) => (
					<p
						key={a.texto}
						className={cn(
							"text-xs",
							a.tono === "success" ? "text-success-text" : "text-danger-text",
						)}
					>
						{a.tono === "success" ? (
							<CheckCircle2 aria-hidden className="mr-1 inline size-3.5" />
						) : (
							<XCircle aria-hidden className="mr-1 inline size-3.5" />
						)}
						{a.texto}
					</p>
				))}
				{e.contenido?.extra}
			</div>
		) : undefined;
	return {
		id: e.id,
		cuando: e.cuando,
		titulo: (
			<span
				className={cn(
					"inline-flex items-center gap-1.5",
					e.tituloAtenuado && "font-normal text-fg-tertiary italic",
				)}
				title={e.tituloAyuda}
			>
				<Icono aria-hidden className="size-3.5 shrink-0 text-fg-tertiary" />
				{e.titulo}
			</span>
		),
		badge:
			e.badges.length > 0 ? (
				<span className="inline-flex flex-wrap items-center gap-1.5">
					{e.badges.map((b) =>
						b.contorno ? (
							<Badge
								key={b.etiqueta}
								variant="outline"
								className="text-[10px]"
								title={b.ayuda}
							>
								{b.etiqueta}
							</Badge>
						) : (
							<Badge key={b.etiqueta} variant={b.tono} title={b.ayuda}>
								{b.etiqueta}
							</Badge>
						),
					)}
				</span>
			) : undefined,
		subtitulo: e.subtitulo,
		contacto: e.contacto,
		derecha: e.derecha,
		tono: e.tono,
		nota: e.nota,
		detalles: e.detalles,
		extra,
		detalleNodo: e.contenido?.detalleNodo,
		detalleEtiqueta:
			e.contenido?.detalleEtiqueta ??
			e.detalleEtiqueta ??
			"Ver detalle de la gestión",
	};
}

/** Qué rango de fechas se está viendo. */
function textoPeriodo(
	periodo: PeriodoHistorial,
	corte: CortePeriodo | null,
): string {
	if (!corte) {
		return periodo === "actual"
			? "Todo el historial: el crédito no tiene fecha de ingreso a un bucket."
			: "Sin fecha de ingreso a un bucket.";
	}
	const fecha = fechaLargaGT(new Date(corte.fecha));
	if (periodo === "historico") {
		return `Antes del ${fecha}, fecha de ingreso al bucket actual.`;
	}
	if (corte.origen === "ultimo_hito") {
		return `Desde el ${fecha}, último cambio de bucket registrado.`;
	}
	return corte.bucket
		? `Desde el ${fecha}, cuando el crédito ingresó a ${corte.bucket}.`
		: `Desde el ${fecha}, cuando el crédito ingresó a su bucket actual.`;
}

function ChipsFiltro({
	activo,
	conteo,
	onCambiar,
}: {
	activo: FiltroHistorial;
	conteo: Record<FiltroHistorial, number>;
	onCambiar: (filtro: FiltroHistorial) => void;
}) {
	return (
		<fieldset className="flex min-w-0 flex-wrap items-center gap-2">
			<legend className="sr-only">Filtrar el historial</legend>
			{FILTROS_HISTORIAL.map((f) => (
				<Tooltip key={f.clave}>
					<TooltipTrigger asChild>
						<FilterChip
							seleccionado={activo === f.clave}
							cantidad={conteo[f.clave]}
							onClick={() => onCambiar(f.clave)}
						>
							{f.etiqueta}
						</FilterChip>
					</TooltipTrigger>
					<TooltipContent>{f.descripcion}</TooltipContent>
				</Tooltip>
			))}
		</fieldset>
	);
}

/** Fuentes que siguen cargando o que fallaron: no son «no hay registros». */
function EstadoFuentes({ fuentes }: { fuentes: FuenteHistorial[] }) {
	const cargando = fuentes.filter((f) => f.estado === "cargando");
	const conError = fuentes.filter((f) => f.estado === "error");
	if (cargando.length === 0 && conError.length === 0) return null;
	return (
		<div className="flex flex-col gap-1.5">
			{conError.length > 0 ? (
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md bg-danger-subtle px-3 py-2 text-danger-text text-xs">
					<span className="inline-flex min-w-0 items-center gap-1.5">
						<TriangleAlert aria-hidden className="size-3.5 shrink-0" />
						No se pudo cargar: {conError.map((f) => f.etiqueta).join(", ")}.
					</span>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => {
							for (const f of conError) f.onReintentar?.();
						}}
					>
						Reintentar
					</Button>
				</div>
			) : null}
			{cargando.length > 0 ? (
				<p className="text-fg-tertiary text-xs">
					Cargando: {cargando.map((f) => f.etiqueta).join(", ")}…
				</p>
			) : null}
		</div>
	);
}

export function HistorialUnificado({
	datos,
	periodoInicial = "actual",
	filtroInicial = "todo",
	className,
}: {
	datos: DatosHistorialUnificado;
	periodoInicial?: PeriodoHistorial;
	filtroInicial?: FiltroHistorial;
	className?: string;
}) {
	const [periodo, setPeriodo] =
		React.useState<PeriodoHistorial>(periodoInicial);
	const [filtro, setFiltro] = React.useState<FiltroHistorial>(filtroInicial);
	const [visibles, setVisibles] = React.useState(POR_PAGINA);
	const { eventos, corte, horizonte } = datos;

	const delPeriodo = React.useMemo(
		() => eventosDelPeriodo(eventos, { periodo, corte, horizonte }),
		[eventos, periodo, corte, horizonte],
	);
	const conteo = React.useMemo(() => contarPorFiltro(delPeriodo), [delPeriodo]);
	const lista = React.useMemo(
		() => filtrarEventos(delPeriodo, filtro),
		[delPeriodo, filtro],
	);
	const items = React.useMemo(
		() => lista.slice(0, visibles).map(aItemGestion),
		[lista, visibles],
	);

	const hayMasEnMemoria = lista.length > visibles;
	const hayMas = hayMasEnMemoria || datos.hayMasEnServidor;
	const cargarMas = () => {
		setVisibles((v) => v + POR_PAGINA);
		// Se acabó lo cargado: se piden los registros anteriores.
		if (visibles + POR_PAGINA >= lista.length && datos.hayMasEnServidor) {
			datos.onCargarMas();
		}
	};

	const vacio =
		periodo === "historico" && !corte
			? "Sin fecha de ingreso al bucket actual: todo el historial está en «Historial actual»."
			: filtro === "todo"
				? periodo === "actual"
					? "No hay registros desde el ingreso al bucket actual."
					: "No hay registros anteriores al bucket actual."
				: `No hay registros de «${etiquetaFiltro(filtro)}» en este periodo.`;

	return (
		<div className={cn("flex flex-col gap-4", className)}>
			<SegmentedNav
				className="self-start"
				value={periodo}
				onValueChange={(v) => {
					setPeriodo(v as PeriodoHistorial);
					setVisibles(POR_PAGINA);
				}}
				opciones={[
					{ value: "actual", label: "Historial actual" },
					{ value: "historico", label: "Histórico" },
				]}
			/>
			<SeccionHistorial
				titulo="Historial del crédito"
				conteo={datos.cargando ? "…" : conteo.todo}
				icono={<Clock />}
				descripcion={datos.cargando ? undefined : textoPeriodo(periodo, corte)}
				estado={datos.cargando ? "cargando" : "ok"}
			>
				<div className="flex flex-col gap-4">
					<ChipsFiltro
						activo={filtro}
						conteo={conteo}
						onCambiar={(f) => {
							setFiltro(f);
							setVisibles(POR_PAGINA);
						}}
					/>
					<EstadoFuentes fuentes={datos.fuentes} />
					{lista.length === 0 ? (
						<div className="flex flex-col items-center gap-3 rounded-lg border border-line-subtle border-dashed px-4 py-6 text-center">
							<p className="text-fg-tertiary text-sm">{vacio}</p>
							{datos.hayMasEnServidor ? (
								<Button
									variant="secondary"
									size="sm"
									loading={datos.cargandoMas}
									disabled={datos.cargandoMas}
									onClick={datos.onCargarMas}
								>
									Cargar registros anteriores
								</Button>
							) : null}
						</div>
					) : (
						<HistorialGestiones items={items} />
					)}
					{lista.length > 0 && hayMas ? (
						<div className="flex flex-col items-center gap-1.5">
							<Button
								variant="secondary"
								size="sm"
								loading={datos.cargandoMas}
								disabled={datos.cargandoMas}
								onClick={cargarMas}
							>
								Cargar más
							</Button>
							<span className="text-fg-tertiary text-xs">
								Se muestran {items.length} de {lista.length}{" "}
								{lista.length === 1 ? "registro" : "registros"}
								{datos.hayMasEnServidor
									? " · Hay registros anteriores por cargar"
									: ""}
							</span>
						</div>
					) : null}
					{datos.avisos.map((aviso) => (
						<p key={aviso} className="text-fg-tertiary text-xs">
							{aviso}
						</p>
					))}
				</div>
			</SeccionHistorial>
		</div>
	);
}
