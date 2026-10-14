import {
	ChevronDown,
	History,
	LocateFixed,
	RotateCw,
	TriangleAlert,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoaderInline } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * Piezas compartidas de las pestañas de la Ficha 360 › Ubicaciones (GPS,
 * ubicaciones frecuentes, visitas, notificaciones y apagado). Solo
 * presentación: todas las pestañas usan el mismo encabezado, el mismo estado
 * vacío compacto y la misma lista de consultas anteriores, para que se lean
 * como un solo componente.
 */

/** Mínimo del motivo de una consulta (mismo criterio que el servidor: min 5). */
export const MOTIVO_MIN_LENGTH = 5;

/** Título de la pestaña, una línea de contexto y la acción principal a la derecha. */
export function PanelEncabezado({
	titulo,
	descripcion,
	accion,
	className,
}: {
	titulo: ReactNode;
	descripcion?: ReactNode;
	accion?: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-wrap items-start justify-between gap-x-4 gap-y-2",
				className,
			)}
		>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<h3 className="font-semibold text-[15px] text-fg leading-[1.26]">
					{titulo}
				</h3>
				{descripcion ? (
					<p className="text-[13px] text-fg-secondary leading-normal">
						{descripcion}
					</p>
				) : null}
			</div>
			{accion ? (
				<div className="flex shrink-0 flex-wrap items-center gap-2">
					{accion}
				</div>
			) : null}
		</div>
	);
}

/**
 * Estado vacío compacto: una fila con ícono, qué falta y la acción para
 * resolverlo. En vez del bloque grande centrado, que en una pestaña ocupaba
 * media pantalla para decir «no hay nada».
 */
export function PanelVacio({
	icono,
	titulo,
	descripcion,
	accion,
	className,
}: {
	icono: ReactNode;
	titulo: ReactNode;
	descripcion?: ReactNode;
	accion?: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-col gap-3 rounded-xl border border-line border-dashed bg-muted/40 px-4 py-3.5 sm:flex-row sm:items-center",
				className,
			)}
		>
			<div className="flex min-w-0 flex-1 items-start gap-3">
				<span
					aria-hidden
					className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-fg-tertiary [&_svg]:size-4.5"
				>
					{icono}
				</span>
				<div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
					<p className="font-semibold text-fg text-sm leading-[1.26]">
						{titulo}
					</p>
					{descripcion ? (
						<p className="text-fg-secondary text-xs leading-normal">
							{descripcion}
						</p>
					) : null}
				</div>
			</div>
			{accion ? <div className="shrink-0 sm:ml-2">{accion}</div> : null}
		</div>
	);
}

export function PanelCargando({
	texto = "Cargando…",
	className,
}: {
	texto?: string;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex min-h-28 items-center justify-center rounded-xl bg-muted/40",
				className,
			)}
		>
			<LoaderInline>{texto}</LoaderInline>
		</div>
	);
}

/** Error de carga: qué no se pudo cargar y cómo intentarlo de nuevo. */
export function PanelError({
	texto,
	detalle,
	onReintentar,
	className,
}: {
	texto: ReactNode;
	detalle?: ReactNode;
	onReintentar?: () => void;
	className?: string;
}) {
	return (
		<div
			role="alert"
			className={cn(
				"flex flex-col gap-3 rounded-xl bg-danger-subtle px-4 py-3 sm:flex-row sm:items-center",
				className,
			)}
		>
			<div className="flex min-w-0 flex-1 items-start gap-2.5">
				<TriangleAlert
					aria-hidden
					className="mt-0.5 size-4 shrink-0 text-danger-text"
				/>
				<div className="flex min-w-0 flex-col gap-0.5">
					<p className="font-medium text-danger-text text-sm leading-[1.26]">
						{texto}
					</p>
					{detalle ? (
						<p className="wrap-break-word text-fg-secondary text-xs">
							{detalle}
						</p>
					) : null}
				</div>
			</div>
			{onReintentar ? (
				<Button size="sm" variant="outline" onClick={onReintentar}>
					<RotateCw aria-hidden />
					Reintentar
				</Button>
			) : null}
		</div>
	);
}

/**
 * Quién consultó, cuándo y con qué motivo. Va bajo el resultado de cada
 * consulta: el motivo es parte del registro, no un detalle escondido.
 */
export function MetaConsulta({
	usuario,
	fecha,
	motivo,
	estado,
	className,
}: {
	/** Null = la consulta de esta sesión (no hace falta el nombre). */
	usuario: string | null;
	fecha: string;
	motivo: string;
	/** «Consulta registrada», «Consulta no registrada»… */
	estado?: ReactNode;
	className?: string;
}) {
	return (
		<p
			className={cn(
				"wrap-break-word text-fg-tertiary text-xs leading-normal",
				className,
			)}
		>
			<span className="text-fg-secondary">
				{usuario ? `Consultada por ${usuario}` : "Consultada"} · {fecha}
			</span>
			{estado ? <> · {estado}</> : null}
			<br />
			Motivo: {motivo}
		</p>
	);
}

/**
 * Formulario en línea para una consulta nueva: un campo y un botón. Cada
 * consulta queda registrada con su motivo, así que no hay consulta sin él.
 * Va en línea (no en un modal) para que también funcione dentro del diálogo
 * de visita, que ya es un modal.
 */
export function FormMotivoConsulta({
	id,
	placeholder,
	etiquetaBoton,
	aviso,
	onConfirmar,
	onCancelar,
}: {
	id: string;
	placeholder: string;
	etiquetaBoton: string;
	aviso: ReactNode;
	onConfirmar: (motivo: string) => void;
	onCancelar?: () => void;
}) {
	const [motivo, setMotivo] = useState("");
	const valido = motivo.trim().length >= MOTIVO_MIN_LENGTH;
	return (
		<form
			className="flex flex-col gap-2 rounded-xl border border-line-subtle bg-muted/50 p-3"
			onSubmit={(e) => {
				e.preventDefault();
				if (valido) onConfirmar(motivo.trim());
			}}
		>
			<Label htmlFor={id}>Motivo de la consulta</Label>
			<div className="flex flex-col gap-2 sm:flex-row">
				<Input
					autoFocus
					id={id}
					maxLength={300}
					onChange={(e) => setMotivo(e.target.value)}
					placeholder={placeholder}
					value={motivo}
				/>
				<div className="flex shrink-0 gap-2">
					<Button disabled={!valido} type="submit">
						<LocateFixed aria-hidden />
						{etiquetaBoton}
					</Button>
					{onCancelar ? (
						<Button onClick={onCancelar} type="button" variant="ghost">
							Cancelar
						</Button>
					) : null}
				</div>
			</div>
			<p className="text-fg-tertiary text-xs">{aviso}</p>
		</form>
	);
}

/**
 * Consultas anteriores en una fila compacta, cerrada de entrada: «Consultas
 * anteriores (N)» con una flecha. Al abrirla se ven todas las ya traídas, y
 * «Ver más consultas» pide más al servidor si las hay. Lo que importa (la
 * última consulta) va arriba, fuera de esta lista.
 */
export function ListaAnteriores<T>({
	titulo = "Consultas anteriores",
	items,
	render,
	clave,
	hayMasEnServidor = false,
	cargandoMas = false,
	onPedirMas,
	limiteAlcanzado,
	abiertoInicial = false,
}: {
	titulo?: ReactNode;
	items: T[];
	render: (item: T) => ReactNode;
	clave: (item: T) => string;
	/** El servidor puede tener más filas que las ya traídas. */
	hayMasEnServidor?: boolean;
	cargandoMas?: boolean;
	onPedirMas?: () => void;
	/** Solo cuando se llegó al máximo que se muestra (p. ej. 100). */
	limiteAlcanzado?: ReactNode;
	/** Abre la lista de entrada (catálogo del design system). */
	abiertoInicial?: boolean;
}) {
	const [abierto, setAbierto] = useState(abiertoInicial);
	if (items.length === 0) return null;

	return (
		<Collapsible
			className="overflow-hidden rounded-xl border border-line-subtle"
			onOpenChange={setAbierto}
			open={abierto}
		>
			<CollapsibleTrigger asChild>
				<button
					className="flex w-full cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5 text-left outline-none transition-colors duration-150 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
					type="button"
				>
					<span className="flex min-w-0 items-center gap-2">
						<History aria-hidden className="size-4 shrink-0 text-fg-tertiary" />
						<span className="font-semibold text-[13px] text-fg-secondary">
							{titulo}
						</span>
						<span className="inline-flex h-4.5 min-w-5.5 items-center justify-center rounded-full bg-muted px-1.5 font-semibold text-[11px] text-fg-secondary leading-none">
							{items.length}
							{hayMasEnServidor ? "+" : ""}
						</span>
					</span>
					<ChevronDown
						aria-hidden
						className={cn(
							"size-4 shrink-0 text-fg-tertiary transition-transform duration-150",
							abierto && "rotate-180",
						)}
					/>
				</button>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<ul className="divide-y divide-line-subtle border-line-subtle border-t">
					{items.map((item) => (
						<li key={clave(item)}>{render(item)}</li>
					))}
				</ul>
				{hayMasEnServidor ? (
					<div className="border-line-subtle border-t px-2 py-1.5">
						<Button
							disabled={cargandoMas}
							onClick={() => onPedirMas?.()}
							size="sm"
							variant="text"
						>
							<ChevronDown aria-hidden />
							{cargandoMas ? "Cargando…" : "Ver más consultas"}
						</Button>
					</div>
				) : limiteAlcanzado ? (
					<p className="border-line-subtle border-t px-3.5 py-2 text-fg-tertiary text-xs">
						{limiteAlcanzado}
					</p>
				) : null}
			</CollapsibleContent>
		</Collapsible>
	);
}

/** Fecha corta para el asesor: «Hoy, 10:32», «Ayer, 18:05», «12 oct 2026, 09:10». */
export function fechaCortaGps(
	date: Date | string | null | undefined,
	ahora: Date = new Date(),
): string {
	if (!date) return "—";
	const fecha = date instanceof Date ? date : new Date(date);
	if (Number.isNaN(fecha.getTime())) return "—";
	const hora = fecha.toLocaleTimeString("es-GT", {
		hour: "2-digit",
		minute: "2-digit",
	});
	const dia = (d: Date) => d.toLocaleDateString("es-GT");
	const ayer = new Date(ahora);
	ayer.setDate(ayer.getDate() - 1);
	if (dia(fecha) === dia(ahora)) return `Hoy, ${hora}`;
	if (dia(fecha) === dia(ayer)) return `Ayer, ${hora}`;
	return `${fecha.toLocaleDateString("es-GT", {
		day: "numeric",
		month: "short",
		year: "numeric",
	})}, ${hora}`;
}
