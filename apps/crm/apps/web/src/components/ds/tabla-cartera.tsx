import * as React from "react";

import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatearQuetzales } from "./table-cells";

/**
 * Tabla de Cartera — Figma "03 · Componentes CRM".
 *
 *   TablaCartera     → "Tabla de Cartera › Table/Cartera" (131:1355)
 *       Card (surface, border/subtle, radius/lg, Clay-Raised) con toolbar (título + contador +
 *       `herramientas`), encabezado (bg/canvas, 600 10 tertiary, mayúsculas), filas y `pie`
 *       (la Pagination de ui/pagination.tsx). Boolean "Prioridad" → `prioridad` (columna del
 *       número de prioridad). Columnas → `columnas` (COLUMNAS_CARTERA por defecto).
 *   FilaCredito      → "Cartera › Cartera/FilaCrédito" (3442:1510)
 *       Estado=Default|Hover → :hover (y `activa` para fijar el fondo de Hover, p. ej. fila
 *       seleccionada). Boolean "Asesor visible" → la columna "asesor" en `columnas`
 *       (COLUMNAS_CARTERA_CON_ASESOR); fuera de una TablaCartera, basta con pasar `asesor`.
 *   FilaAprobaciones → "Cartera › Cartera/FilaAprobaciones" (3483:6133)
 *       Estado=Default|Hover → igual que FilaCredito. Usar con COLUMNAS_APROBACIONES.
 *   Botones de la toolbar → usar ToolbarButton de ui/toolbar-button.tsx (Button/Toolbar 130:1209)
 *       Acción=Buscar|Filtros|Ordenar|Columnas → `accion`; Estado=Default|Hover → :hover;
 *       Activo → `activo`. Vive aquí porque solo lo usa la toolbar de esta tabla.
 *
 * Badges, chips e indicadores entran como React.ReactNode (BucketBadge, MoraBadge de
 * ds/badges; SinContacto, AccionPendiente de ds/indicadores; EstadoGestion, AsesorChip,
 * TipoCartera de ds/cartera-chips). Montos numéricos se formatean "Q 48,250.00".
 *
 * Desvíos respecto a Figma:
 *  - En Table/Cartera la columna "Crédito / cliente" es fill y Figma la deja en 1px (se ve
 *    cortada en la captura). Aquí tiene un mínimo de 204px (el de FilaCrédito) y la tabla
 *    (table-fixed + contain-inline-size) hace scroll horizontal si no cabe.
 *  - "tb-right" se alinea a la derecha (Figma lo pega al título sin espaciador).
 *  - Los encabezados de FilaAprobaciones no existen en Figma: se nombraron por su contenido.
 */

/* ── Columnas ───────────────────────────────────────────────────────────────── */

export type ColumnaCartera = {
	id: string;
	etiqueta: React.ReactNode;
	/** Ancho fijo de la columna en px (Figma). Sin ancho, la columna ocupa el resto (fill). */
	ancho?: number;
	/** Clases compartidas por encabezado y celdas (p. ej. el padding izquierdo de 24px). */
	celda?: string;
};

const col = {
	cliente: { id: "cliente", etiqueta: "Crédito / cliente" },
	asesor: { id: "asesor", etiqueta: "Asesor", ancho: 150 },
	bucket: { id: "bucket", etiqueta: "Bucket", ancho: 72 },
	mora: { id: "mora", etiqueta: "Mora", ancho: 100 },
	deuda: { id: "deuda", etiqueta: "Deuda vencida", ancho: 130 },
	cuota: { id: "cuota", etiqueta: "Cuota normal", ancho: 140 },
	fecha: { id: "fecha", etiqueta: "Fecha de pago", ancho: 100 },
	seguimiento: {
		id: "seguimiento",
		etiqueta: "Seguimiento",
		ancho: 190,
		celda: "pl-6",
	},
	estado: {
		id: "estado",
		etiqueta: "Estado de gestión",
		ancho: 190,
		celda: "pl-6",
	},
	accion: {
		id: "accion",
		etiqueta: "Acción pendiente",
		ancho: 188,
		celda: "pl-6",
	},
} satisfies Record<string, ColumnaCartera>;

/** Table/Cartera (sin asesor). */
export const COLUMNAS_CARTERA: ColumnaCartera[] = [
	col.cliente,
	col.bucket,
	col.mora,
	col.deuda,
	col.cuota,
	col.fecha,
	col.seguimiento,
	col.estado,
	col.accion,
];

/** Cartera/FilaCrédito con "Asesor visible". */
export const COLUMNAS_CARTERA_CON_ASESOR: ColumnaCartera[] = [
	col.cliente,
	col.asesor,
	...COLUMNAS_CARTERA.slice(1),
];

/** Cartera/FilaAprobaciones. */
export const COLUMNAS_APROBACIONES: ColumnaCartera[] = [
	{ id: "cliente", etiqueta: "Cliente / crédito" },
	{ id: "asesor", etiqueta: "Asesor", ancho: 180 },
	{ id: "tipo", etiqueta: "Tipo", ancho: 130 },
	{ id: "monto", etiqueta: "Monto", ancho: 150 },
	{ id: "fecha", etiqueta: "Solicitada", ancho: 130 },
	{ id: "bucket", etiqueta: "Bucket", ancho: 200, celda: "pl-6" },
];

/** Mínimo de la columna fill (el ancho de "cell" en Cartera/FilaCrédito). */
const MINIMO_FILL = 204;
/** Padding lateral de la fila (16px a cada lado), que en la tabla cae en la 1.ª y última celda. */
const PADDING_FILA = 16;
const ANCHO_PRIORIDAD = 50; // 16 de padding + 22 del círculo + 12 de aire

/** Ancho real de cada columna: la última suma el padding derecho de la fila. */
function anchoColumna(columnas: ColumnaCartera[], i: number) {
	const ancho = columnas[i].ancho;
	if (ancho === undefined) return undefined;
	return i === columnas.length - 1 ? ancho + PADDING_FILA : ancho;
}

type TablaContexto = { prioridad: boolean; ids: Set<string> };
const TablaCarteraContext = React.createContext<TablaContexto | null>(null);

/* ── Piezas de celda ────────────────────────────────────────────────────────── */

// Fila de 56px, padding lateral de 16px en la primera y última celda.
const celdaBase =
	"h-14 whitespace-nowrap p-0 align-middle first:pl-4 last:pr-4";
const textoValor = "font-bold text-[13px] text-fg leading-[1.26] tabular-nums";

function Identidad({
	titulo,
	detalle,
}: {
	titulo: React.ReactNode;
	detalle?: React.ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-0.5">
			<span className="truncate font-semibold text-[13px] text-fg leading-[1.26]">
				{titulo}
			</span>
			{detalle ? (
				<span className="truncate text-[11px] text-fg-tertiary leading-[1.26]">
					{detalle}
				</span>
			) : null}
		</div>
	);
}

function Valor({ children }: { children: React.ReactNode }) {
	if (children === undefined || children === null) return null;
	return (
		<span className={textoValor}>
			{typeof children === "number" ? formatearQuetzales(children) : children}
		</span>
	);
}

function Prioridad({ numero }: { numero?: number }) {
	return (
		<TableCell className={celdaBase}>
			{numero !== undefined ? (
				<span className="flex size-5.5 items-center justify-center rounded-full bg-surface-raised font-semibold text-[11px] text-fg-secondary leading-[1.26] shadow-clay-subtle">
					{numero}
				</span>
			) : null}
		</TableCell>
	);
}

const filaBase =
	"border-divider border-b bg-surface transition-colors duration-150 hover:bg-brand-subtle data-[state=selected]:bg-brand-subtle";

/* ── TablaCartera ───────────────────────────────────────────────────────────── */

type TablaCarteraProps = Omit<React.ComponentProps<"div">, "title"> & {
	titulo?: React.ReactNode;
	/** Contador junto al título: número → "1,538 créditos". `null` lo oculta. */
	contador?: number | React.ReactNode;
	/** Botones de la derecha de la toolbar (ToolbarButton de ui/toolbar-button). */
	herramientas?: React.ReactNode;
	columnas?: ColumnaCartera[];
	/** Boolean "Prioridad" de Figma: agrega la columna del número de prioridad. */
	prioridad?: boolean;
	/** Pie de la tabla (Pagination). */
	pie?: React.ReactNode;
	/** Contenido cuando no hay filas. */
	vacio?: React.ReactNode;
};

function TablaCartera({
	titulo = "Cartera Asignada",
	contador,
	herramientas,
	columnas = COLUMNAS_CARTERA,
	prioridad = false,
	pie,
	vacio = "No hay créditos para mostrar.",
	className,
	children,
	...props
}: TablaCarteraProps) {
	const ctx = React.useMemo<TablaContexto>(
		() => ({ prioridad, ids: new Set(columnas.map((c) => c.id)) }),
		[prioridad, columnas],
	);
	const sinFilas = React.Children.count(children) === 0;
	// Tabla de ancho fijo: columnas de Figma + la fill con su mínimo; si no cabe, scroll horizontal.
	const minWidth =
		columnas.reduce((t, _, i) => t + (anchoColumna(columnas, i) ?? 0), 0) +
		columnas.filter((c) => c.ancho === undefined).length *
			(MINIMO_FILL + PADDING_FILA) +
		(prioridad ? ANCHO_PRIORIDAD : 0);

	return (
		<div
			data-slot="tabla-cartera"
			className={cn(
				// contain-inline-size: el ancho mínimo de la tabla no empuja al contenedor (hace scroll).
				"flex flex-col overflow-hidden rounded-2xl border border-line-subtle bg-surface shadow-clay-raised contain-inline-size",
				className,
			)}
			{...props}
		>
			<div className="flex flex-wrap items-center gap-3 bg-surface px-4 py-3">
				<div className="flex min-w-0 items-center gap-2.5">
					<h3 className="truncate font-semibold text-[15px] text-fg leading-[1.26]">
						{titulo}
					</h3>
					{contador === undefined || contador === null ? null : (
						<span className="inline-flex shrink-0 items-center rounded-full bg-brand-subtle px-2 py-0.5 font-semibold text-[11px] text-brand tabular-nums leading-[1.26]">
							{typeof contador === "number"
								? `${contador.toLocaleString("es-GT")} ${contador === 1 ? "crédito" : "créditos"}`
								: contador}
						</span>
					)}
				</div>
				{herramientas ? (
					<div className="ml-auto flex flex-wrap items-center gap-2">
						{herramientas}
					</div>
				) : null}
			</div>
			<TablaCarteraContext.Provider value={ctx}>
				<Table className="table-fixed text-fg" style={{ minWidth }}>
					<TableHeader className="bg-canvas [&_tr]:border-b-0">
						<TableRow className="border-b-0 hover:bg-transparent">
							{prioridad ? (
								<TableHead
									className="h-9 p-0 first:pl-4"
									style={{ width: ANCHO_PRIORIDAD }}
								>
									<span className="sr-only">Prioridad</span>
								</TableHead>
							) : null}
							{columnas.map((c, i) => (
								<TableHead
									key={c.id}
									className={cn(
										"h-9 p-0 font-semibold text-[10px] text-fg-tertiary uppercase leading-[1.26] first:pl-4 last:pr-4",
										c.celda,
									)}
									style={{ width: anchoColumna(columnas, i) }}
								>
									{c.etiqueta}
								</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{sinFilas ? (
							<TableRow className="border-b-0 hover:bg-transparent">
								<TableCell
									colSpan={columnas.length + (prioridad ? 1 : 0)}
									className="type-body-sm h-24 text-center text-fg-tertiary"
								>
									{vacio}
								</TableCell>
							</TableRow>
						) : (
							children
						)}
					</TableBody>
				</Table>
			</TablaCarteraContext.Provider>
			{pie}
		</div>
	);
}

/* ── FilaCredito ────────────────────────────────────────────────────────────── */

type FilaCreditoProps = React.ComponentProps<"tr"> & {
	/** Número de prioridad (se ve si la tabla tiene `prioridad`). */
	prioridad?: number;
	/** Nombre del cliente. */
	cliente: React.ReactNode;
	/** Segunda línea: "Toyota Hilux · P-482GHT". */
	detalle?: React.ReactNode;
	/** AsesorChip. */
	asesor?: React.ReactNode;
	/** BucketBadge compacta. */
	bucket?: React.ReactNode;
	/** MoraBadge. */
	mora?: React.ReactNode;
	deudaVencida?: number | React.ReactNode;
	cuotaNormal?: number | React.ReactNode;
	/** "15 ago". */
	fechaPago?: React.ReactNode;
	/** SinContacto. */
	seguimiento?: React.ReactNode;
	/** EstadoGestion, o texto (600 13 secundario, como en Table/Cartera). */
	estadoGestion?: React.ReactNode;
	/** AccionPendiente. */
	accionPendiente?: React.ReactNode;
	/** Fija el fondo del estado Hover (fila seleccionada o abierta). */
	activa?: boolean;
};

function FilaCredito({
	prioridad,
	cliente,
	detalle,
	asesor,
	bucket,
	mora,
	deudaVencida,
	cuotaNormal,
	fechaPago,
	seguimiento,
	estadoGestion,
	accionPendiente,
	activa = false,
	className,
	...props
}: FilaCreditoProps) {
	const ctx = React.useContext(TablaCarteraContext);
	const conPrioridad = ctx ? ctx.prioridad : prioridad !== undefined;
	const conAsesor = ctx ? ctx.ids.has("asesor") : asesor !== undefined;

	return (
		<TableRow
			data-slot="fila-credito"
			data-state={activa ? "selected" : undefined}
			className={cn(filaBase, className)}
			{...props}
		>
			{conPrioridad ? <Prioridad numero={prioridad} /> : null}
			<TableCell className={celdaBase}>
				<Identidad titulo={cliente} detalle={detalle} />
			</TableCell>
			{conAsesor ? <TableCell className={celdaBase}>{asesor}</TableCell> : null}
			<TableCell className={celdaBase}>{bucket}</TableCell>
			<TableCell className={celdaBase}>{mora}</TableCell>
			<TableCell className={celdaBase}>
				<Valor>{deudaVencida}</Valor>
			</TableCell>
			<TableCell className={celdaBase}>
				<Valor>{cuotaNormal}</Valor>
			</TableCell>
			<TableCell className={celdaBase}>
				<Valor>{fechaPago}</Valor>
			</TableCell>
			<TableCell className={cn(celdaBase, "pl-6")}>{seguimiento}</TableCell>
			<TableCell className={cn(celdaBase, "pl-6")}>
				{typeof estadoGestion === "string" ? (
					<span className="font-semibold text-[13px] text-fg-secondary leading-[1.26]">
						{estadoGestion}
					</span>
				) : (
					estadoGestion
				)}
			</TableCell>
			<TableCell className={cn(celdaBase, "pl-6")}>{accionPendiente}</TableCell>
		</TableRow>
	);
}

/* ── FilaAprobaciones ───────────────────────────────────────────────────────── */

type FilaAprobacionesProps = React.ComponentProps<"tr"> & {
	prioridad?: number;
	cliente: React.ReactNode;
	/** "Crédito #47120". */
	detalle?: React.ReactNode;
	/** AsesorChip. */
	asesor?: React.ReactNode;
	/** TipoCartera. */
	tipo?: React.ReactNode;
	/** Monto de la solicitud; "—" si no aplica. */
	monto?: number | React.ReactNode;
	/** "hace 2 días". */
	fecha?: React.ReactNode;
	/** BucketBadge completa. */
	bucket?: React.ReactNode;
	activa?: boolean;
};

function FilaAprobaciones({
	prioridad,
	cliente,
	detalle,
	asesor,
	tipo,
	monto = "—",
	fecha,
	bucket,
	activa = false,
	className,
	...props
}: FilaAprobacionesProps) {
	const ctx = React.useContext(TablaCarteraContext);
	const conPrioridad = ctx ? ctx.prioridad : prioridad !== undefined;

	return (
		<TableRow
			data-slot="fila-aprobaciones"
			data-state={activa ? "selected" : undefined}
			className={cn(filaBase, className)}
			{...props}
		>
			{conPrioridad ? <Prioridad numero={prioridad} /> : null}
			<TableCell className={celdaBase}>
				<Identidad titulo={cliente} detalle={detalle} />
			</TableCell>
			<TableCell className={celdaBase}>{asesor}</TableCell>
			<TableCell className={celdaBase}>{tipo}</TableCell>
			<TableCell className={celdaBase}>
				<Valor>{monto}</Valor>
			</TableCell>
			<TableCell className={celdaBase}>
				<Valor>{fecha}</Valor>
			</TableCell>
			<TableCell className={cn(celdaBase, "pl-6")}>{bucket}</TableCell>
		</TableRow>
	);
}

export { FilaAprobaciones, FilaCredito, TablaCartera };
export type { FilaAprobacionesProps, FilaCreditoProps, TablaCarteraProps };
