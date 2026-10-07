import { Link } from "@tanstack/react-router";
import {
	Check,
	Layers,
	TriangleAlert,
	UserCheck,
	UserRound,
} from "lucide-react";
import type * as React from "react";
import type { FiltroGestionCartera } from "@/components/cobros/asesor/filtros-cartera";
import { PromesaActivaBadge } from "@/components/cobros/promesa-activa-badge";
import { FilterChip } from "@/components/ds/cartera-chips";
import { formatearQuetzales } from "@/components/ds/table-cells";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip, type ChipProps } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { cn } from "@/lib/utils";
import {
	type AlertaConvenio,
	type AlertaPromesa,
	CATEGORIAS_COLA,
	CATEGORIAS_CONVENIO,
	CATEGORIAS_PROMESA,
	type ConteosSegmentos,
	DEF_COLA,
	DEF_CONVENIO,
	DEF_PROMESA,
	DESCRIPCION_GESTION,
	type DetalleSegmento,
	defSegmento,
	ETIQUETA_GESTION_SUPERVISION,
	etiquetaSegmento,
	GESTIONES_SUPERVISION,
	GRUPOS_SEGMENTO,
	type ItemCola,
	mismoSegmento,
	type Segmento,
	type TipoSegmento,
	VACIO_GESTION,
} from "./segmentos";

/**
 * Piezas de presentación de la Cartera general del supervisor (Figma 2262:12).
 * La pantalla es Mi Cartera (`mi-cartera-vista.tsx`) con la prop `supervision`:
 * estas piezas se enchufan ahí. Sin consultas: todo llega por props.
 *
 *   SelectorAsesor        filtro `?asesor=` (asesor_id de cartera).
 *   ChipsRapidosSupervision  chips de Figma: Sin gestión >48h, Promesa por vencer,
 *                         Convenio por vencer, Sin acuerdo.
 *   BotonSegmentos        popover con TODAS las categorías de la Cola del día y
 *                         de las Alertas de promesas y de convenios (con conteo),
 *                         más los filtros de gestión. Reemplaza a esas páginas.
 *   AvisoSegmento         qué es el segmento elegido + avisos (S5, ausencias…).
 *   CeldaSegmento         lo que cada página vieja mostraba por crédito.
 *   VacioSegmento         estado vacío por segmento (Figma 2010:4449).
 */

/* ── Tipos ──────────────────────────────────────────────────────────────────── */

export type AsesorOpcion = {
	asesorId: number;
	nombre: string;
	email: string | null;
};

/** Caso del segmento que cartera no devolvió como fila (p. ej. ya cancelado). */
export type CasoSinFila = {
	sifco: string;
	nombre: string | null;
	casoCobroId: string | null;
};

export type SupervisionCartera = {
	asesores: AsesorOpcion[];
	asesoresCargando?: boolean;
	asesorId: number | null;
	onAsesor: (asesorId: number | null) => void;
	segmento: Segmento | null;
	/** Elegir un segmento limpia `gestion` (y al revés): son excluyentes. */
	onSegmento: (segmento: Segmento | null) => void;
	conteos: ConteosSegmentos;
	/** Detalle de la fuente por No. de crédito (columna del segmento). */
	detalles?: Map<string, DetalleSegmento>;
	/** Avisos del segmento o de los filtros (p. ej. «se filtra sobre la página»). */
	avisos?: string[];
	/** Casos del segmento que no tienen fila en cartera (se listan como enlaces). */
	sinFila?: CasoSinFila[];
	/** Selección múltiple (contratoId de cada fila). */
	seleccion: Set<string>;
	onSeleccionar: (contratoIds: string[], marcar: boolean) => void;
	onLimpiarSeleccion: () => void;
	onReasignar: () => void;
	/** Botones extra de la barra de la tabla (Configurar SLA). */
	herramientas?: React.ReactNode;
	/** Clic en «Requieren atención hoy»: abre la Cola del día. */
	onAtencionHoy?: () => void;
};

const formatoEntero = new Intl.NumberFormat("es-GT");
const cantidad = (n: number | undefined) =>
	n === undefined ? undefined : formatoEntero.format(n);

/* ── Selector de asesor ─────────────────────────────────────────────────────── */

const TODOS = "todos";

export function SelectorAsesor({
	asesores,
	asesorId,
	onAsesor,
	cargando,
}: {
	asesores: AsesorOpcion[];
	asesorId: number | null;
	onAsesor: (asesorId: number | null) => void;
	cargando?: boolean;
}) {
	// Un ?asesor= que no está en la lista (inactivo, otro rol) igual se muestra.
	const opciones =
		asesorId !== null && !asesores.some((a) => a.asesorId === asesorId)
			? [...asesores, { asesorId, nombre: `Asesor #${asesorId}`, email: null }]
			: asesores;
	return (
		<Select
			value={asesorId === null ? TODOS : String(asesorId)}
			onValueChange={(v) => onAsesor(v === TODOS ? null : Number(v))}
		>
			<SelectTrigger
				size="sm"
				className="w-full sm:w-56"
				aria-label="Filtrar por asesor"
			>
				<span className="flex min-w-0 items-center gap-2">
					<UserRound aria-hidden className="size-3.5" />
					<SelectValue placeholder="Todos los asesores" />
				</span>
			</SelectTrigger>
			<SelectContent size="sm">
				<SelectItem value={TODOS}>Todos los asesores</SelectItem>
				{cargando ? (
					<p className="type-caption px-3 py-2 text-fg-tertiary">
						Cargando asesores…
					</p>
				) : null}
				{opciones.map((a) => (
					<SelectItem key={a.asesorId} value={String(a.asesorId)}>
						{a.nombre}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/* ── Chips rápidos (Figma) ──────────────────────────────────────────────────── */

const CONVENIO_POR_VENCER: Segmento = { tipo: "convenio", valor: "por_vencer" };

export function ChipsRapidosSupervision({
	gestion,
	onGestion,
	segmento,
	onSegmento,
	conteos,
}: {
	gestion: FiltroGestionCartera | null;
	onGestion: (gestion: FiltroGestionCartera | null) => void;
	segmento: Segmento | null;
	onSegmento: (segmento: Segmento | null) => void;
	conteos: ConteosSegmentos;
}) {
	const chipGestion = (g: FiltroGestionCartera) => (
		<FilterChip
			key={g}
			seleccionado={gestion === g}
			onClick={() => onGestion(gestion === g ? null : g)}
		>
			{ETIQUETA_GESTION_SUPERVISION[g]}
		</FilterChip>
	);
	const convenioActivo = mismoSegmento(segmento, CONVENIO_POR_VENCER);
	return (
		<fieldset className="flex min-w-0 flex-wrap items-center gap-2">
			<legend className="sr-only">Filtros rápidos</legend>
			{chipGestion("sin_gestion_48h")}
			{chipGestion("promesa_por_vencer")}
			<FilterChip
				seleccionado={convenioActivo}
				cantidad={cantidad(conteos.convenio.por_vencer)}
				onClick={() => onSegmento(convenioActivo ? null : CONVENIO_POR_VENCER)}
			>
				Convenio por vencer
			</FilterChip>
			{chipGestion("sin_acuerdo")}
		</fieldset>
	);
}

/* ── Selector de segmentos (Cola del día y alertas) ─────────────────────────── */

function SeccionSegmentos({
	titulo,
	descripcion,
	children,
}: {
	titulo: string;
	descripcion: string;
	children: React.ReactNode;
}) {
	return (
		<section className="flex flex-col gap-2">
			<div className="flex flex-col gap-0.5">
				<h4 className="type-label-sm text-fg-tertiary uppercase">{titulo}</h4>
				<p className="type-caption text-fg-tertiary">{descripcion}</p>
			</div>
			<div className="flex flex-wrap items-center gap-2">{children}</div>
		</section>
	);
}

/** Contenido del popover «Segmentos» (también se usa suelto en el catálogo). */
export function PanelSegmentos({
	segmento,
	onSegmento,
	gestion,
	onGestion,
	conteos,
}: {
	segmento: Segmento | null;
	onSegmento: (segmento: Segmento | null) => void;
	gestion: FiltroGestionCartera | null;
	onGestion: (gestion: FiltroGestionCartera | null) => void;
	conteos: ConteosSegmentos;
}) {
	const chips = <T extends string>(
		tipo: TipoSegmento,
		categorias: readonly T[],
		defs: Record<T, { etiqueta: string; descripcion: string }>,
		cuentas: Partial<Record<T, number>>,
	) =>
		categorias.map((c) => {
			const s = { tipo, valor: c } as Segmento;
			const activo = mismoSegmento(segmento, s);
			return (
				<FilterChip
					key={c}
					seleccionado={activo}
					cantidad={cantidad(cuentas[c])}
					title={defs[c].descripcion}
					onClick={() => onSegmento(activo ? null : s)}
				>
					{defs[c].etiqueta}
				</FilterChip>
			);
		});

	return (
		<div className="flex flex-col gap-5">
			<SeccionSegmentos
				titulo={GRUPOS_SEGMENTO.cola.titulo}
				descripcion={GRUPOS_SEGMENTO.cola.descripcion}
			>
				{chips("cola", CATEGORIAS_COLA, DEF_COLA, conteos.cola)}
			</SeccionSegmentos>
			<SeccionSegmentos
				titulo={GRUPOS_SEGMENTO.promesa.titulo}
				descripcion={GRUPOS_SEGMENTO.promesa.descripcion}
			>
				{chips("promesa", CATEGORIAS_PROMESA, DEF_PROMESA, conteos.promesa)}
			</SeccionSegmentos>
			<SeccionSegmentos
				titulo={GRUPOS_SEGMENTO.convenio.titulo}
				descripcion={GRUPOS_SEGMENTO.convenio.descripcion}
			>
				{chips("convenio", CATEGORIAS_CONVENIO, DEF_CONVENIO, conteos.convenio)}
			</SeccionSegmentos>
			<SeccionSegmentos
				titulo="Gestión"
				descripcion="Según las gestiones registradas en el CRM."
			>
				{GESTIONES_SUPERVISION.map((g) => (
					<FilterChip
						key={g}
						seleccionado={gestion === g}
						title={DESCRIPCION_GESTION[g]}
						onClick={() => onGestion(gestion === g ? null : g)}
					>
						{ETIQUETA_GESTION_SUPERVISION[g]}
					</FilterChip>
				))}
			</SeccionSegmentos>
			{segmento || gestion ? (
				<div className="border-divider border-t pt-3">
					<Button
						variant="ghost"
						size="sm"
						className="w-full text-fg-secondary"
						onClick={() => {
							onSegmento(null);
							onGestion(null);
						}}
					>
						Ver toda la cartera
					</Button>
				</div>
			) : null}
		</div>
	);
}

/** Botón «Segmentos» con su popover. */
export function BotonSegmentos({
	abierto,
	onAbierto,
	...props
}: React.ComponentProps<typeof PanelSegmentos> & {
	abierto?: boolean;
	onAbierto?: (abierto: boolean) => void;
}) {
	const activo = props.segmento ?? null;
	return (
		<Popover open={abierto} onOpenChange={onAbierto}>
			<PopoverTrigger asChild>
				<ToolbarButton icon={Layers} active={!!activo} className="max-w-full">
					<span className="truncate">
						{activo ? etiquetaSegmento(activo) : "Cola del día y alertas"}
					</span>
				</ToolbarButton>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="max-h-[min(80vh,640px)] w-[min(92vw,600px)] overflow-y-auto p-5"
			>
				<PanelSegmentos {...props} />
			</PopoverContent>
		</Popover>
	);
}

/* ── Aviso del segmento ─────────────────────────────────────────────────────── */

export function AvisoSegmento({
	segmento,
	gestion,
	avisos = [],
	sinFila = [],
	onQuitar,
}: {
	segmento: Segmento | null;
	gestion: FiltroGestionCartera | null;
	avisos?: string[];
	sinFila?: CasoSinFila[];
	onQuitar: () => void;
}) {
	if (!segmento && avisos.length === 0 && sinFila.length === 0) return null;
	const titulo = segmento
		? etiquetaSegmento(segmento)
		: gestion
			? ETIQUETA_GESTION_SUPERVISION[gestion]
			: null;
	const descripcion = segmento
		? defSegmento(segmento).descripcion
		: gestion
			? DESCRIPCION_GESTION[gestion]
			: null;
	return (
		<div className="flex flex-col gap-2 rounded-xl border border-line-subtle bg-surface-raised px-4 py-3">
			{titulo ? (
				<div className="flex flex-wrap items-start justify-between gap-2">
					<div className="flex min-w-0 flex-col gap-0.5">
						<p className="font-semibold text-fg text-sm leading-5">{titulo}</p>
						{descripcion ? (
							<p className="type-body-sm text-fg-secondary">{descripcion}</p>
						) : null}
					</div>
					{segmento ? (
						<Button
							variant="ghost"
							size="sm"
							className="text-fg-secondary"
							onClick={onQuitar}
						>
							Ver toda la cartera
						</Button>
					) : null}
				</div>
			) : null}
			{avisos.map((a) => (
				<p
					key={a}
					className="type-body-sm flex items-start gap-2 text-warning-text"
				>
					<TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
					<span className="wrap-break-word min-w-0">{a}</span>
				</p>
			))}
			{sinFila.length > 0 ? (
				<div className="flex flex-col gap-1.5">
					<p className="type-body-sm text-fg-secondary">
						{sinFila.length === 1
							? "1 caso de este segmento no tiene un crédito vigente en cartera. Ábralo desde aquí:"
							: `${sinFila.length} casos de este segmento no tienen un crédito vigente en cartera. Ábralos desde aquí:`}
					</p>
					<div className="flex flex-wrap gap-1.5">
						{sinFila.map((c) => (
							<Link
								key={c.sifco}
								to="/cobros/$id"
								params={{ id: c.casoCobroId ?? c.sifco }}
								search={{ tipo: c.casoCobroId ? "caso" : "contrato" }}
								className="type-label-sm rounded-full bg-muted px-2.5 py-1 text-fg-secondary hover:bg-brand-subtle hover:text-brand"
							>
								{c.nombre ?? "Cliente sin nombre"} · {c.sifco}
							</Link>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}

/* ── Estado vacío por segmento (Figma 2010:4449) ────────────────────────────── */

export function VacioSegmento({
	segmento,
	gestion,
	onVerTodo,
}: {
	segmento: Segmento | null;
	gestion: FiltroGestionCartera | null;
	onVerTodo?: () => void;
}) {
	const vacio = segmento
		? defSegmento(segmento).vacio
		: gestion
			? VACIO_GESTION[gestion]
			: null;
	if (!vacio) return null;
	return (
		<EmptyState
			size="md"
			icon={
				<span className="flex size-full items-center justify-center bg-success-subtle text-success-solid">
					<Check aria-hidden strokeWidth={2.5} />
				</span>
			}
			title={vacio.titulo}
			description={vacio.descripcion}
			action={
				onVerTodo ? (
					<Button size="sm" variant="outline" onClick={onVerTodo}>
						Ver toda la cartera
					</Button>
				) : null
			}
		/>
	);
}

/* ── Selección múltiple ─────────────────────────────────────────────────────── */

const detener = (e: React.SyntheticEvent) => e.stopPropagation();

/** Casilla de la fila: no abre el Workspace al marcarla. */
export function CasillaFila({
	marcada,
	onMarcar,
	etiqueta,
}: {
	marcada: boolean;
	onMarcar: (marcar: boolean) => void;
	etiqueta: string;
}) {
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: solo evita que el clic llegue a la fila
		<span className="flex items-center" onClick={detener} onKeyDown={detener}>
			<Checkbox
				size="sm"
				checked={marcada}
				onCheckedChange={(v) => onMarcar(v === true)}
				aria-label={etiqueta}
			/>
		</span>
	);
}

/** Casilla del encabezado: marca o desmarca la página visible. */
export function CasillaPagina({
	marcadas,
	total,
	onMarcar,
}: {
	marcadas: number;
	total: number;
	onMarcar: (marcar: boolean) => void;
}) {
	return (
		<Checkbox
			size="sm"
			disabled={total === 0}
			checked={
				total > 0 && marcadas === total
					? true
					: marcadas > 0
						? "indeterminate"
						: false
			}
			onCheckedChange={(v) => onMarcar(v === true)}
			aria-label="Seleccionar los créditos de esta página"
		/>
	);
}

/** Barra de la selección: cuántos hay y qué hacer con ellos. */
export function BarraSeleccion({
	cantidad: n,
	onLimpiar,
}: {
	cantidad: number;
	onLimpiar: () => void;
}) {
	if (n === 0) return null;
	return (
		<div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand bg-brand-subtle px-4 py-2.5">
			<span className="font-semibold text-brand text-sm">
				{n === 1
					? "1 crédito seleccionado"
					: `${formatoEntero.format(n)} créditos seleccionados`}
			</span>
			<Button
				variant="ghost"
				size="sm"
				className="text-fg-secondary"
				onClick={onLimpiar}
			>
				Quitar selección
			</Button>
		</div>
	);
}

/* ── Celda del segmento: lo que mostraba cada página vieja ──────────────────── */

const formatoFecha = (v: string | Date | null | undefined) => {
	if (!v) return "sin fecha";
	if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
		// "YYYY-MM-DD" = día calendario de Guatemala (sin corrimiento por TZ).
		const [y, m, d] = v.split("-").map(Number);
		return new Date(y, m - 1, d)
			.toLocaleDateString("es-GT", {
				day: "numeric",
				month: "short",
				year: "numeric",
			})
			.replace(".", "");
	}
	return new Date(v)
		.toLocaleDateString("es-GT", {
			day: "numeric",
			month: "short",
			year: "numeric",
			timeZone: "America/Guatemala",
		})
		.replace(".", "");
};

const monto = (v: string | null | undefined) => {
	const n = Number(v ?? 0);
	return Number.isFinite(n) && n > 0 ? formatearQuetzales(n) : null;
};

function Lineas({
	arriba,
	abajo,
	tono,
}: {
	arriba: React.ReactNode;
	abajo?: React.ReactNode;
	tono?: string;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-0.5">
			<span
				className={cn(
					"flex min-w-0 items-center gap-1.5 truncate font-semibold text-[13px] leading-[1.26]",
					tono ?? "text-fg",
				)}
			>
				{arriba}
			</span>
			{abajo ? (
				<span
					className="line-clamp-2 whitespace-normal text-[11px] text-fg-tertiary leading-[1.26]"
					title={typeof abajo === "string" ? abajo : undefined}
				>
					{abajo}
				</span>
			) : null}
		</div>
	);
}

const TONO_FECHA: Record<string, string> = {
	vencida: "text-danger-text",
	vence_hoy: "text-warning-text",
	por_vencer: "text-info-text",
};

function rangoCuotas(a: AlertaPromesa) {
	if (a.cuotaInicio == null && a.cuotaFin == null) {
		return a.incluyeMora ? "Solo mora" : null;
	}
	const rango =
		a.cuotaInicio === a.cuotaFin
			? `Cuota ${a.cuotaInicio}`
			: `Cuotas ${a.cuotaInicio}–${a.cuotaFin}`;
	return a.incluyeMora ? `${rango} + mora` : rango;
}

function CeldaPromesa({ alertas }: { alertas: AlertaPromesa[] }) {
	const a = alertas[0];
	if (!a) return null;
	const comprometido = monto(a.montoComprometido);
	const extra =
		alertas.length > 1 ? `+${alertas.length - 1} promesa más` : null;
	return (
		<Lineas
			tono={TONO_FECHA[a.categoria]}
			arriba={
				<>
					{a.categoria === "vencida" ? "Venció" : "Vence"}{" "}
					{formatoFecha(a.fechaPrometida)}
					{a.categoria === "vencida" ? (
						<Chip tone="danger" dot={false} className="py-0.5">
							Prioridad alta
						</Chip>
					) : null}
				</>
			}
			abajo={[
				comprometido ? `Comprometido: ${comprometido}` : null,
				rangoCuotas(a),
				extra,
			]
				.filter(Boolean)
				.join(" · ")}
		/>
	);
}

function CeldaConvenio({ alerta: a }: { alerta: AlertaConvenio }) {
	// En incumplimiento interesa lo VENCIDO; en el resto, lo que toca pagar.
	const vencida = a.categoria === "vencida";
	const debe = monto(vencida ? a.monto_vencido : a.monto_cuota);
	const saldo = monto(a.monto_pendiente_convenio);
	return (
		<Lineas
			tono={TONO_FECHA[a.categoria]}
			arriba={
				<>
					{vencida ? "Venció" : "Vence"} {formatoFecha(a.fecha_vencimiento)}
					{vencida ? (
						<Chip tone="danger" dot={false} className="py-0.5">
							{a.cuotas_vencidas > 1
								? `${a.cuotas_vencidas} cuotas vencidas`
								: "Prioridad alta"}
						</Chip>
					) : null}
				</>
			}
			abajo={[
				debe ? `${vencida ? "Debe" : "A pagar"}: ${debe}` : null,
				saldo ? `Saldo del convenio: ${saldo}` : null,
				`${a.cuotas_pendientes} ${a.cuotas_pendientes === 1 ? "cuota" : "cuotas"} por pagar`,
			]
				.filter(Boolean)
				.join(" · ")}
		/>
	);
}

const CATEGORIAS_ITEM: {
	clave: keyof ItemCola;
	texto: (i: ItemCola) => string;
	tono: ChipProps["tone"];
}[] = [
	{ clave: "slaHoy", texto: () => "SLA hoy", tono: "danger" },
	{ clave: "promesaHoy", texto: () => "Promesa hoy", tono: "warning" },
	{ clave: "venceHoy", texto: () => "Cuota hoy", tono: "warning" },
	{ clave: "incumplida", texto: () => "Incumplida", tono: "neutral" },
	{ clave: "promesaProxima", texto: () => "Promesa próxima", tono: "info" },
	{
		clave: "sinContacto",
		texto: (i) => `${i.diasSinContacto ?? "+5"} días sin contacto`,
		tono: "brand",
	},
];

function CeldaCola({
	item,
	mostrarAsesor,
}: {
	item: ItemCola;
	mostrarAsesor: boolean;
}) {
	const badges = CATEGORIAS_ITEM.filter((c) => item[c.clave]);
	const abajo = [
		item.fechaLimiteSla
			? `Límite SLA: ${formatoFecha(item.fechaLimiteSla)}`
			: null,
		item.fechaPromesa ? `Promesa: ${formatoFecha(item.fechaPromesa)}` : null,
		item.telefono ? `Tel. ${item.telefono}` : "Sin teléfono",
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<span className="flex min-w-0 flex-wrap items-center gap-1 whitespace-normal py-1">
				{badges.map((c) => (
					<Chip key={c.clave} tone={c.tono} dot={false} className="py-0.5">
						{c.texto(item)}
					</Chip>
				))}
				{/* CB-030: promesa vigente que congela cuotas; se omite si «Promesa
				    hoy» ya dice lo mismo. */}
				{item.promesaActiva && !item.promesaHoy ? (
					<PromesaActivaBadge compact />
				) : null}
				{item.cubierto ? (
					<Chip tone="info" dot={false} className="py-0.5">
						<UserCheck aria-hidden className="size-3" />
						{mostrarAsesor && item.suplente
							? `Cubierto por ${item.suplente}`
							: `Cubriendo a ${item.asesor}`}
					</Chip>
				) : null}
			</span>
			<span
				className="line-clamp-2 whitespace-normal text-[11px] text-fg-tertiary leading-[1.26]"
				title={abajo}
			>
				{abajo}
			</span>
		</div>
	);
}

export function CeldaSegmento({
	detalle,
}: {
	detalle: DetalleSegmento | undefined;
}) {
	if (!detalle) {
		return <span className="text-[13px] text-fg-tertiary">—</span>;
	}
	switch (detalle.tipo) {
		case "cola":
			return (
				<CeldaCola item={detalle.item} mostrarAsesor={detalle.mostrarAsesor} />
			);
		case "promesa":
			return <CeldaPromesa alertas={detalle.alertas} />;
		case "convenio":
			return <CeldaConvenio alerta={detalle.alerta} />;
	}
}

/** Encabezado de la columna del segmento. */
export const ETIQUETA_COLUMNA_SEGMENTO: Record<TipoSegmento, string> = {
	cola: "Cola del día",
	promesa: "Promesa de pago",
	convenio: "Convenio",
};
