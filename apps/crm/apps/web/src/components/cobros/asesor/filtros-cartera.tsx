import { differenceInDays } from "date-fns";
import type { DateRange } from "react-day-picker";
import { CapitalRangeFilter } from "@/components/cobros/capital-range-filter";
import type { Bucket } from "@/components/ds/badges";
import { FilterChip } from "@/components/ds/cartera-chips";
import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { parseFechaLocal } from "@/lib/date-utils";
import type { FilaCartera } from "./fila-cartera";

/**
 * Filtros de Mi Cartera (rediseño cobros, Figma «Asesor Junior › 02 · Mi Cartera").
 *
 * Son TODOS los de la tabla "Casos de Cobranza" del dashboard anterior, sin perder
 * ninguno: período de pago, rango de fechas, etapa de mora, etiquetas, capital,
 * "ocultar los que ya pagaron su cuota" y No. SIFCO exacto. Figma solo muestra
 * los chips de bucket y de gestión; el resto vive en el popover "Filtros" de la
 * toolbar de la tabla, y lo aplicado se resume en chips removibles.
 *
 * Aquí solo hay tipos, helpers puros y presentación (sin consultas).
 */

/* ── Tipos y constantes ─────────────────────────────────────────────────────── */

export type PeriodoCartera = "hoy" | "semana" | "quincena" | "mes" | "todos";

export const FILTROS_GESTION = [
	"sin_gestion_48h",
	"promesa_por_vencer",
	"convenio_pendiente",
	"sin_contactar_hoy",
] as const;
export type FiltroGestion = (typeof FILTROS_GESTION)[number];

/** Orden de Figma (QuickFilters). */
export const GESTION_LABEL: Record<FiltroGestion, string> = {
	sin_gestion_48h: "Sin gestión +48h",
	promesa_por_vencer: "Promesas por vencer",
	convenio_pendiente: "Convenios pendientes",
	sin_contactar_hoy: "Sin contactar hoy",
};

export const BUCKETS_CARTERA: Bucket[] = ["B0", "B1", "B2", "B3", "B4", "B5"];

/** Bucket de aging → `estadoMora` de getTodosLosCreditos / estatusStats. */
export const ESTADO_POR_BUCKET: Record<Bucket, string> = {
	B0: "al_dia",
	B1: "mora_30",
	B2: "mora_60",
	B3: "mora_90",
	B4: "mora_120",
	B5: "mora_120_plus",
};

export function bucketDeEstadoMora(estado: string | null): Bucket | null {
	if (!estado) return null;
	return (
		(Object.entries(ESTADO_POR_BUCKET).find(([, e]) => e === estado)?.[0] as
			| Bucket
			| undefined) ?? null
	);
}

/** Todas las etapas del filtro de antes, en su orden. */
export const ETAPAS_MORA = [
	"al_dia",
	"en_convenio",
	"mora_30",
	"mora_60",
	"mora_90",
	"mora_120",
	"mora_120_plus",
	"incobrable",
	"pendiente_cancelacion",
	"completado",
] as const;

export const ETIQUETA_LABELS: Record<string, string> = {
	juridico: "Jurídico",
	convenio: "Convenio",
	cobro: "Cobro",
	no_localizable: "No Localizable",
	unidad_a_recuperar: "Unidad a Recuperar",
	unidad_recuperada: "Unidad Recuperada",
	moras_pendientes: "Moras Pendientes",
	compromiso_de_pago: "Compromiso de Pago",
	cancelado: "Cancelado",
	reclamo: "Reclamo",
};

export const PERIODOS: { key: PeriodoCartera; label: string }[] = [
	{ key: "hoy", label: "Hoy" },
	{ key: "semana", label: "Esta semana" },
	{ key: "quincena", label: "Esta quincena" },
	{ key: "mes", label: "Este mes" },
	{ key: "todos", label: "Todos" },
];

export const TIME_POR_PERIODO: Record<
	PeriodoCartera,
	"TODAY" | "WEEK" | "DUEMONTH" | "MONTH" | undefined
> = {
	hoy: "TODAY",
	semana: "WEEK",
	quincena: "DUEMONTH",
	mes: "MONTH",
	todos: undefined,
};

export type FiltrosCartera = {
	/** Mi Cartera es la cartera completa: el período arranca en "todos". */
	periodo: PeriodoCartera;
	rango: DateRange | undefined;
	/** `estadoMora` (lo comparten los chips de bucket y "Etapa de mora"). */
	etapa: string | null;
	etiquetas: string[];
	capitalMin: number | undefined;
	capitalMax: number | undefined;
	excluirPagados: boolean;
	/** No. SIFCO exacto (texto crudo; el contenedor lo debouncea). */
	sifco: string;
	gestion: FiltroGestion | null;
	/** Búsqueda libre (texto crudo; el contenedor lo debouncea). */
	busqueda: string;
};

export const FILTROS_INICIALES: FiltrosCartera = {
	periodo: "todos",
	rango: undefined,
	etapa: null,
	etiquetas: [],
	capitalMin: undefined,
	capitalMax: undefined,
	excluirPagados: false,
	sifco: "",
	gestion: null,
	busqueda: "",
};

export type EtapaOpcion = { key: string; label: string };

/* ── Helpers puros ──────────────────────────────────────────────────────────── */

export function rangoCompleto(rango: DateRange | undefined) {
	return !!(rango?.from && rango?.to);
}

/** Mismo formato que el dashboard anterior ("YYYY-MM-DD" del ISO). */
export function fechasDelRango(rango: DateRange | undefined) {
	if (!rango?.from || !rango?.to) {
		return { fechaDesde: undefined, fechaHasta: undefined };
	}
	return {
		fechaDesde: rango.from.toISOString().slice(0, 10),
		fechaHasta: rango.to.toISOString().slice(0, 10),
	};
}

/** Filtros activos, para el contador y "Limpiar filtros". */
export function contarFiltrosActivos(f: FiltrosCartera) {
	return [
		f.periodo !== "todos",
		f.rango !== undefined,
		f.etapa !== null,
		f.etiquetas.length > 0,
		f.capitalMin !== undefined || f.capitalMax !== undefined,
		f.excluirPagados,
		f.sifco !== "",
		f.gestion !== null,
		f.busqueda !== "",
	].filter(Boolean).length;
}

/** Solo los del popover "Filtros" (los que Figma no muestra a la vista). */
export function contarFiltrosAvanzados(
	f: FiltrosCartera,
	bucketsVisibles: Bucket[],
) {
	const bucket = bucketDeEstadoMora(f.etapa);
	return [
		f.periodo !== "todos",
		f.rango !== undefined,
		f.etapa !== null && !(bucket && bucketsVisibles.includes(bucket)),
		f.etiquetas.length > 0,
		f.capitalMin !== undefined || f.capitalMax !== undefined,
		f.excluirPagados,
		f.sifco !== "",
	].filter(Boolean).length;
}

/** Días hasta la próxima fecha de pago (negativo = vencido), como antes. */
export function diasHastaPago(fila: {
	fechaProximoPago: string | null;
	diasMoraMaximo: number | null;
}): number | null {
	if (fila.fechaProximoPago) {
		const ahora = new Date();
		const hoy = new Date(
			ahora.getFullYear(),
			ahora.getMonth(),
			ahora.getDate(),
		);
		return differenceInDays(parseFechaLocal(fila.fechaProximoPago), hoy);
	}
	if (fila.diasMoraMaximo && fila.diasMoraMaximo > 0) {
		return -fila.diasMoraMaximo;
	}
	return null;
}

const LIMITE_DIAS: Record<PeriodoCartera, number> = {
	hoy: 0,
	semana: 7,
	quincena: 15,
	mes: 30,
	todos: Number.POSITIVE_INFINITY,
};

/**
 * Lo que la tabla de antes hacía en el cliente sobre la página recibida:
 *  - sin etapa elegida, oculta completados e incobrables;
 *  - con un período (no "Todos"), deja solo vencidos y los que vencen dentro del período.
 */
export function refinarPagina<T extends FilaCartera>(
	filas: T[],
	f: Pick<FiltrosCartera, "periodo" | "etapa">,
): T[] {
	let out = filas;
	if (!f.etapa) {
		out = out.filter(
			(c) =>
				c.estadoContrato !== "completado" && c.estadoContrato !== "incobrable",
		);
	}
	if (f.periodo === "todos") return out;
	const limite = LIMITE_DIAS[f.periodo];
	return out.filter((c) => {
		const dias = diasHastaPago(c);
		return dias !== null && dias <= limite;
	});
}

export type CampoOrden = "fecha" | "cliente" | "deuda" | "diasMora" | "capital";
export type OrdenCartera = { campo: CampoOrden; dir: "asc" | "desc" };

export const ORDEN_INICIAL: OrdenCartera = { campo: "fecha", dir: "asc" };

export const CAMPOS_ORDEN: { key: CampoOrden; label: string }[] = [
	{ key: "fecha", label: "Fecha de pago" },
	{ key: "cliente", label: "Cliente" },
	{ key: "deuda", label: "Deuda vencida" },
	{ key: "diasMora", label: "Días de mora" },
	{ key: "capital", label: "Capital" },
];

/** Ordena la página actual (los sin dato van al final). */
export function ordenarPagina<T extends FilaCartera>(
	filas: T[],
	orden: OrdenCartera,
): T[] {
	const valor = (f: T): number | string | null => {
		switch (orden.campo) {
			case "fecha":
				return diasHastaPago(f);
			case "cliente":
				return f.clienteNombre ?? null;
			case "deuda":
				return Number(f.deudaVencida ?? 0);
			case "diasMora":
				return f.diasMoraMaximo ?? 0;
			case "capital":
				return Number(f.montoFinanciado ?? 0);
		}
	};
	const signo = orden.dir === "asc" ? 1 : -1;
	return [...filas].sort((a, b) => {
		const va = valor(a);
		const vb = valor(b);
		if (va === null && vb === null) return 0;
		if (va === null) return 1;
		if (vb === null) return -1;
		if (typeof va === "string" || typeof vb === "string") {
			return String(va).localeCompare(String(vb), "es") * signo;
		}
		return (va - vb) * signo;
	});
}

/* ── Presentación ───────────────────────────────────────────────────────────── */

function Seccion({
	titulo,
	children,
}: {
	titulo: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-2">
			<span className="type-label-sm text-fg-tertiary uppercase">{titulo}</span>
			<div className="flex flex-wrap items-center gap-2">{children}</div>
		</div>
	);
}

/** Contenido del popover "Filtros" (también se usa suelto en el catálogo). */
export function PanelFiltrosCartera({
	filtros,
	etapas,
	onCambiar,
	onLimpiar,
	activos,
}: {
	filtros: FiltrosCartera;
	etapas: EtapaOpcion[];
	onCambiar: (cambio: Partial<FiltrosCartera>) => void;
	onLimpiar: () => void;
	activos: number;
}) {
	return (
		<div className="flex flex-col gap-4">
			<Seccion titulo="Período de pago">
				{PERIODOS.map((p) => (
					<FilterChip
						key={p.key}
						seleccionado={filtros.periodo === p.key}
						onClick={() => onCambiar({ periodo: p.key })}
					>
						{p.label}
					</FilterChip>
				))}
			</Seccion>
			<Seccion titulo="Rango de fechas de pago">
				<DateRangeFilter
					dateRange={filtros.rango}
					required
					onDateRangeChange={(range) => {
						if (!range) {
							onCambiar({ rango: undefined });
							return;
						}
						// Igual que antes: un rango completo reemplaza al período.
						onCambiar(
							range.from && range.to
								? { rango: range, periodo: "todos" }
								: { rango: range },
						);
					}}
				/>
			</Seccion>
			<Seccion titulo="Etapa de mora">
				<FilterChip
					seleccionado={filtros.etapa === null}
					onClick={() => onCambiar({ etapa: null })}
				>
					Todas
				</FilterChip>
				{etapas.map((e) => (
					<FilterChip
						key={e.key}
						seleccionado={filtros.etapa === e.key}
						onClick={() =>
							onCambiar({ etapa: filtros.etapa === e.key ? null : e.key })
						}
					>
						{e.label}
					</FilterChip>
				))}
			</Seccion>
			<Seccion titulo="Etiquetas">
				<FilterChip
					seleccionado={filtros.etiquetas.length === 0}
					onClick={() => onCambiar({ etiquetas: [] })}
				>
					Todas
				</FilterChip>
				{Object.entries(ETIQUETA_LABELS).map(([key, label]) => {
					const activa = filtros.etiquetas.includes(key);
					return (
						<FilterChip
							key={key}
							seleccionado={activa}
							onClick={() =>
								onCambiar({
									etiquetas: activa
										? filtros.etiquetas.filter((x) => x !== key)
										: [...filtros.etiquetas, key],
								})
							}
						>
							{label}
						</FilterChip>
					);
				})}
			</Seccion>
			<div className="grid gap-4 sm:grid-cols-2">
				<Seccion titulo="Capital">
					<CapitalRangeFilter
						capitalMin={filtros.capitalMin}
						capitalMax={filtros.capitalMax}
						onCapitalRangeChange={(min, max) =>
							onCambiar({ capitalMin: min, capitalMax: max })
						}
					/>
				</Seccion>
				<Seccion titulo="No. SIFCO (exacto)">
					<Input
						value={filtros.sifco}
						onChange={(e) => onCambiar({ sifco: e.target.value })}
						placeholder="Ej.: 01010214117590"
						aria-label="Buscar por No. SIFCO exacto"
					/>
				</Seccion>
			</div>
			<Seccion titulo="Cuota actual">
				<div className="flex items-center gap-3">
					<Switch
						id="cartera-excluir-pagados"
						checked={filtros.excluirPagados}
						onCheckedChange={(v) => onCambiar({ excluirPagados: v })}
					/>
					<label
						htmlFor="cartera-excluir-pagados"
						className="type-body-sm cursor-pointer text-fg"
					>
						Ocultar los que ya pagaron su cuota
					</label>
				</div>
			</Seccion>
			{activos > 0 ? (
				<div className="border-divider border-t pt-3">
					<Button
						variant="ghost"
						size="sm"
						className="w-full text-fg-secondary"
						onClick={onLimpiar}
					>
						Limpiar filtros ({activos})
					</Button>
				</div>
			) : null}
		</div>
	);
}

/** Botón "Filtros" de la toolbar con su popover. */
export function BotonFiltrosCartera({
	avanzados,
	...props
}: React.ComponentProps<typeof PanelFiltrosCartera> & { avanzados: number }) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<ToolbarButton action="filtros" active={avanzados > 0}>
					Filtros{avanzados > 0 ? ` · ${avanzados}` : ""}
				</ToolbarButton>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className="max-h-[min(80vh,640px)] w-[min(92vw,600px)] overflow-y-auto p-5"
			>
				<PanelFiltrosCartera {...props} />
			</PopoverContent>
		</Popover>
	);
}

const formatoQ = new Intl.NumberFormat("es-GT", {
	style: "currency",
	currency: "GTQ",
	maximumFractionDigits: 0,
});

function fechaChip(d: Date | undefined) {
	return d
		? d.toLocaleDateString("es-GT", { day: "2-digit", month: "short" })
		: "—";
}

/**
 * Resumen de lo aplicado desde el popover "Filtros" (chips removibles), para que
 * nada quede filtrando sin que se vea.
 */
export function ChipsFiltrosAplicados({
	filtros,
	etapas,
	bucketsVisibles,
	onCambiar,
}: {
	filtros: FiltrosCartera;
	etapas: EtapaOpcion[];
	bucketsVisibles: Bucket[];
	onCambiar: (cambio: Partial<FiltrosCartera>) => void;
}) {
	const chips: { id: string; texto: string; quitar: () => void }[] = [];
	if (filtros.periodo !== "todos") {
		chips.push({
			id: "periodo",
			texto: `Período: ${PERIODOS.find((p) => p.key === filtros.periodo)?.label}`,
			quitar: () => onCambiar({ periodo: "todos" }),
		});
	}
	if (filtros.rango) {
		chips.push({
			id: "rango",
			texto: `Fechas: ${fechaChip(filtros.rango.from)} – ${fechaChip(filtros.rango.to)}`,
			quitar: () => onCambiar({ rango: undefined }),
		});
	}
	const bucket = bucketDeEstadoMora(filtros.etapa);
	if (filtros.etapa && !(bucket && bucketsVisibles.includes(bucket))) {
		chips.push({
			id: "etapa",
			texto: `Etapa: ${etapas.find((e) => e.key === filtros.etapa)?.label ?? filtros.etapa}`,
			quitar: () => onCambiar({ etapa: null }),
		});
	}
	for (const e of filtros.etiquetas) {
		chips.push({
			id: `etiqueta-${e}`,
			texto: ETIQUETA_LABELS[e] ?? e,
			quitar: () =>
				onCambiar({ etiquetas: filtros.etiquetas.filter((x) => x !== e) }),
		});
	}
	if (filtros.capitalMin !== undefined || filtros.capitalMax !== undefined) {
		chips.push({
			id: "capital",
			texto: `Capital: ${filtros.capitalMin !== undefined ? formatoQ.format(filtros.capitalMin) : "sin mín."} – ${filtros.capitalMax !== undefined ? formatoQ.format(filtros.capitalMax) : "sin máx."}`,
			quitar: () => onCambiar({ capitalMin: undefined, capitalMax: undefined }),
		});
	}
	if (filtros.excluirPagados) {
		chips.push({
			id: "pagados",
			texto: "Sin los que ya pagaron su cuota",
			quitar: () => onCambiar({ excluirPagados: false }),
		});
	}
	if (filtros.sifco) {
		chips.push({
			id: "sifco",
			texto: `SIFCO: ${filtros.sifco}`,
			quitar: () => onCambiar({ sifco: "" }),
		});
	}
	if (chips.length === 0) return null;
	return (
		<div className="flex flex-wrap items-center gap-2">
			{chips.map((c) => (
				<Chip
					key={c.id}
					tone="brand"
					dot={false}
					onRemove={c.quitar}
					removeLabel={`Quitar filtro ${c.texto}`}
				>
					{c.texto}
				</Chip>
			))}
		</div>
	);
}
