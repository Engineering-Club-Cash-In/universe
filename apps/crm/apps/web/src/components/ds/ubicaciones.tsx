import { Slot, Slottable } from "@radix-ui/react-slot";
import { ArrowLeft, ImageIcon } from "lucide-react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Ubicaciones — Figma "03 · Componentes CRM › Ubicaciones" (P3 · Ubicaciones).
 *
 *   MapView            (1205:3525) → <MapView pins etiqueta>{mapa real opcional}</MapView>
 *       Placeholder visual sin proveedor de mapas: lienzo con 2 calles horizontales y 2
 *       verticales y un pin. Si se pasa `children` (un mapa real), se dibuja encima.
 *   LocationRow        (1205:3533) → <LocationRow nombre descripcion frecuencia icono? />
 *   PhotoStrip         (1205:3543) → <PhotoStrip fotos max onFotoClick onVerMas />
 *       Muestra `max` (3) miniaturas y un "+N" con el resto.
 *   GPS/EstadoVehiculo (1205:3558) → <GpsEstadoVehiculo estado="detenido" | "en-movimiento" />
 *   SegmentedNav       (1205:3549) → <SegmentedNav opciones value onValueChange /> (Radix ToggleGroup)
 *   Nav/VolverButton   (1219:15)   → <VolverButton>Volver al resumen</VolverButton> (asChild para <Link>)
 *
 * Desvíos: esta sección de Figma usa hex sueltos (grises e índigo de Tailwind), no tokens.
 * Se mapearon así:
 *   #eaeef3 lienzo del mapa, #f1f2f4 fondo del segmented, #eef1f5 Detenido → bg-muted
 *   #dce2ea calles, #dde2e8 miniaturas                                      → bg-line-subtle
 *   #e5e7eb bordes                                                           → border-line-subtle
 *   #eef0ff / #4f46e5 (índigo: chip, "+N", pin)                              → bg-violet-bg / text-violet-fg
 *   #e7f6ec / #16a34a (En movimiento)          → bg-success-subtle / bg-success-solid + text-success-text
 *   #111827 / #374151 → text-fg · #6b7280 → text-fg-secondary · #9aa3af → text-fg-tertiary
 *   r:12 del mapa (sin token) → radius/md (rounded-xl); r:10 → rounded-lg; r:8 → rounded-md.
 *   "🖼" de las miniaturas → lucide Image; "←" del botón → lucide ArrowLeft.
 */

/* ── MapView ────────────────────────────────────────────────────────────────── */

type Pin = {
	/** Posición horizontal, en % del ancho. */
	x: number;
	/** Posición vertical, en % del alto. */
	y: number;
	etiqueta?: string;
};

type MapViewProps = React.ComponentProps<"div"> & {
	/** Pines a dibujar sobre el placeholder. Por defecto, uno como en Figma. */
	pins?: Pin[];
	/** Rótulo de la esquina inferior izquierda. `null` lo oculta. */
	etiqueta?: React.ReactNode;
};

const pinClase =
	"absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-3 border-surface bg-violet-fg shadow-tooltip";

function PinMapa({ x, y, etiqueta }: Pin) {
	const style = { left: `${x}%`, top: `${y}%` };
	return etiqueta ? (
		<span
			role="img"
			aria-label={etiqueta}
			title={etiqueta}
			className={pinClase}
			style={style}
		/>
	) : (
		<span aria-hidden className={pinClase} style={style} />
	);
}

function MapView({
	pins = [{ x: 50, y: 46 }],
	etiqueta = "Vista de mapa",
	className,
	children,
	...props
}: MapViewProps) {
	return (
		<div
			data-slot="map-view"
			className={cn(
				"relative h-50 w-90 overflow-hidden rounded-xl bg-muted",
				className,
			)}
			{...props}
		>
			{/* Calles: posiciones de Figma (60/130 de 200 y 90/240 de 360). */}
			<div aria-hidden className="absolute inset-0">
				<span className="absolute inset-x-0 top-[30%] h-1.5 bg-line-subtle" />
				<span className="absolute inset-x-0 top-[65%] h-1.5 bg-line-subtle" />
				<span className="absolute inset-y-0 left-1/4 w-1.5 bg-line-subtle" />
				<span className="absolute inset-y-0 left-2/3 w-1.5 bg-line-subtle" />
			</div>
			{children}
			{pins.map((pin) => (
				<PinMapa key={`${pin.x}-${pin.y}`} {...pin} />
			))}
			{etiqueta ? (
				<span className="absolute bottom-2 left-3 font-medium text-fg-secondary text-xs leading-[1.26]">
					{etiqueta}
				</span>
			) : null}
		</div>
	);
}

/* ── LocationRow ────────────────────────────────────────────────────────────── */

type LocationRowProps = Omit<React.ComponentProps<"div">, "children"> & {
	/** "Casa". */
	nombre: React.ReactNode;
	/** "Residencia habitual · Z.10". */
	descripcion?: React.ReactNode;
	/** Chip de la derecha: "62% del tiempo". */
	frecuencia?: React.ReactNode;
	/** Ícono dentro del círculo (Figma lo deja vacío). */
	icono?: React.ReactNode;
};

function LocationRow({
	nombre,
	descripcion,
	frecuencia,
	icono,
	className,
	...props
}: LocationRowProps) {
	return (
		<div
			data-slot="location-row"
			className={cn(
				"flex w-full items-center gap-3 rounded-lg border border-line-subtle bg-surface px-3.5 py-3",
				className,
			)}
			{...props}
		>
			<span
				aria-hidden
				className="flex size-7 shrink-0 items-center justify-center rounded-full bg-violet-bg text-violet-fg [&_svg]:size-3.5"
			>
				{icono}
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate font-semibold text-fg text-sm leading-[1.26]">
					{nombre}
				</span>
				{descripcion ? (
					<span className="truncate text-fg-secondary text-xs leading-[1.26]">
						{descripcion}
					</span>
				) : null}
			</div>
			{frecuencia ? (
				<span className="shrink-0 whitespace-nowrap rounded-full bg-violet-bg px-2.5 py-1.25 font-semibold text-violet-fg text-xs leading-[1.26]">
					{frecuencia}
				</span>
			) : null}
		</div>
	);
}

/* ── PhotoStrip ─────────────────────────────────────────────────────────────── */

type Foto = { src?: string; alt?: string };

type PhotoStripProps = Omit<React.ComponentProps<"div">, "children"> & {
	fotos: Foto[];
	/** Miniaturas visibles antes del "+N". */
	max?: number;
	onFotoClick?: (index: number) => void;
	onVerMas?: () => void;
};

const thumbBase =
	"relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Miniatura({
	foto,
	indice,
	onClick,
}: {
	foto: Foto;
	indice: number;
	onClick?: (index: number) => void;
}) {
	const contenido = foto.src ? (
		<img
			src={foto.src}
			alt={foto.alt ?? `Foto ${indice + 1}`}
			className="size-full object-cover"
		/>
	) : (
		<ImageIcon aria-hidden className="size-5.5 text-fg-tertiary" />
	);
	const clase = cn(thumbBase, "bg-line-subtle");
	return onClick ? (
		<button
			type="button"
			aria-label={foto.alt ?? `Ver foto ${indice + 1}`}
			onClick={() => onClick(indice)}
			className={cn(clase, "cursor-pointer hover:opacity-90")}
		>
			{contenido}
		</button>
	) : (
		<div className={clase}>{contenido}</div>
	);
}

function PhotoStrip({
	fotos,
	max = 3,
	onFotoClick,
	onVerMas,
	className,
	...props
}: PhotoStripProps) {
	// Si sobra exactamente una, se muestra en vez de un "+1".
	const visibles = fotos.length > max + 1 ? fotos.slice(0, max) : fotos;
	const resto = fotos.length - visibles.length;

	return (
		<div
			data-slot="photo-strip"
			className={cn("flex items-center gap-2.5", className)}
			{...props}
		>
			{visibles.map((foto, i) => (
				<Miniatura
					// biome-ignore lint/suspicious/noArrayIndexKey: las fotos no traen id
					key={i}
					foto={foto}
					indice={i}
					onClick={onFotoClick}
				/>
			))}
			{resto > 0 ? (
				onVerMas ? (
					<button
						type="button"
						onClick={onVerMas}
						aria-label={`Ver ${resto} fotos más`}
						className={cn(
							thumbBase,
							"cursor-pointer bg-violet-bg font-bold text-lg text-violet-fg leading-[1.26] hover:opacity-90",
						)}
					>
						+{resto}
					</button>
				) : (
					<div
						className={cn(
							thumbBase,
							"bg-violet-bg font-bold text-lg text-violet-fg leading-[1.26]",
						)}
					>
						+{resto}
					</div>
				)
			) : null}
		</div>
	);
}

/* ── GPS/EstadoVehiculo ─────────────────────────────────────────────────────── */

type GpsEstado = "detenido" | "en-movimiento";

const GPS: Record<
	GpsEstado,
	{ etiqueta: string; chip: string; punto: string }
> = {
	detenido: {
		etiqueta: "Detenido",
		chip: "bg-muted text-fg-secondary",
		punto: "bg-fg-secondary",
	},
	"en-movimiento": {
		etiqueta: "En movimiento",
		chip: "bg-success-subtle text-success-text",
		punto: "bg-success-solid",
	},
};

function GpsEstadoVehiculo({
	estado,
	children,
	className,
	...props
}: React.ComponentProps<"span"> & { estado: GpsEstado }) {
	const def = GPS[estado];
	return (
		<span
			data-slot="gps-estado-vehiculo"
			data-estado={estado}
			className={cn(
				"inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full py-1.75 pr-3.5 pl-3 font-semibold text-[13px] leading-[1.26]",
				def.chip,
				className,
			)}
			{...props}
		>
			<span aria-hidden className={cn("size-2.5 rounded-full", def.punto)} />
			{children ?? def.etiqueta}
		</span>
	);
}

/* ── SegmentedNav ───────────────────────────────────────────────────────────── */

type SegmentedNavProps = Omit<
	React.ComponentProps<typeof ToggleGroupPrimitive.Root>,
	"type" | "value" | "defaultValue" | "onValueChange"
> & {
	opciones: Array<{
		value: string;
		label: React.ReactNode;
		disabled?: boolean;
	}>;
	value: string;
	onValueChange: (value: string) => void;
};

function SegmentedNav({
	opciones,
	value,
	onValueChange,
	className,
	...props
}: SegmentedNavProps) {
	return (
		<ToggleGroupPrimitive.Root
			type="single"
			data-slot="segmented-nav"
			value={value}
			// Radix permite des-seleccionar el activo: se ignora para que siempre haya uno.
			onValueChange={(v) => {
				if (v) onValueChange(v);
			}}
			className={cn(
				"inline-flex items-center gap-1 rounded-lg bg-muted p-1",
				className,
			)}
			{...props}
		>
			{opciones.map((o) => (
				<ToggleGroupPrimitive.Item
					key={o.value}
					value={o.value}
					disabled={o.disabled}
					className="inline-flex h-8.5 shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-md border border-transparent px-4 font-medium text-fg-secondary text-sm leading-[1.26] outline-none transition-colors duration-150 ease-out hover:text-fg focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 data-[state=on]:border-line-subtle data-[state=on]:bg-surface data-[state=on]:font-semibold data-[state=on]:text-fg"
				>
					{o.label}
				</ToggleGroupPrimitive.Item>
			))}
		</ToggleGroupPrimitive.Root>
	);
}

/* ── Nav/VolverButton ───────────────────────────────────────────────────────── */

function VolverButton({
	asChild = false,
	children = "Volver al resumen",
	className,
	type,
	...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
	const Comp = asChild ? Slot : "button";
	return (
		<Comp
			data-slot="volver-button"
			type={asChild ? undefined : (type ?? "button")}
			className={cn(
				"inline-flex h-9.25 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border border-line-subtle bg-surface pr-4 pl-3.5 font-semibold text-fg text-sm leading-[1.26] outline-none transition-colors duration-150 ease-out hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring active:shadow-pressed disabled:pointer-events-none disabled:opacity-40",
				className,
			)}
			{...props}
		>
			<ArrowLeft aria-hidden className="size-3.5 shrink-0 text-fg-secondary" />
			<Slottable>{children}</Slottable>
		</Comp>
	);
}

export {
	GpsEstadoVehiculo,
	LocationRow,
	MapView,
	PhotoStrip,
	SegmentedNav,
	VolverButton,
};
export type {
	GpsEstado,
	LocationRowProps,
	MapViewProps,
	PhotoStripProps,
	SegmentedNavProps,
};
