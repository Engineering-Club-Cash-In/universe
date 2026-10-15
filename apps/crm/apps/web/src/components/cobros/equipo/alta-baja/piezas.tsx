import { ArrowRight } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogIcon,
	DialogTitle,
	dialogTitleClassName,
} from "@/components/ui/dialog";
import { PopoverPortalContext } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Piezas compartidas por «Crear asesor» y «Dar de baja» (Figma «05 · Alta y
 * Baja de Asesor»): el modal compacto por pasos y el paso de éxito.
 */

/** Ancho de los modales del Figma (~520 px). Lo usa también el showcase. */
export const ANCHO_MODAL_ALTA_BAJA = "sm:max-w-130";

/**
 * Caja del modal: compacta, con scroll interno si no cabe y los menús
 * (selector de asesor, calendario) montados dentro de la caja
 * (`PopoverPortalContext`). Mientras `ocupado`, no se cierra.
 */
export function MarcoAltaBaja({
	abierto,
	ocupado = false,
	titulo,
	descripcion,
	onCerrar,
	children,
}: {
	abierto: boolean;
	ocupado?: boolean;
	/** Título para lectores de pantalla (cada paso pinta el suyo). */
	titulo: string;
	descripcion: string;
	onCerrar: () => void;
	children: React.ReactNode;
}) {
	const [caja, setCaja] = useState<HTMLDivElement | null>(null);
	return (
		<Dialog
			open={abierto}
			onOpenChange={(v) => {
				if (!v && !ocupado) onCerrar();
			}}
		>
			<DialogContent
				ref={setCaja}
				className={cn(
					"max-h-[calc(100dvh-2rem)] overflow-y-auto",
					ANCHO_MODAL_ALTA_BAJA,
				)}
				onInteractOutside={(e) => {
					if (ocupado) e.preventDefault();
				}}
				onEscapeKeyDown={(e) => {
					if (ocupado) e.preventDefault();
				}}
			>
				<DialogTitle className="sr-only">{titulo}</DialogTitle>
				<DialogDescription className="sr-only">{descripcion}</DialogDescription>
				<PopoverPortalContext.Provider value={caja}>
					{children}
				</PopoverPortalContext.Provider>
			</DialogContent>
		</Dialog>
	);
}

/** Título visible de un paso (el del Dialog queda solo para lectores). */
export function TituloPaso({ children }: { children: React.ReactNode }) {
	return <h2 className={cn(dialogTitleClassName, "pr-10")}>{children}</h2>;
}

/** Botones al pie de un paso: secundario a la izquierda, principal a la derecha. */
export function PiePaso({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
			{children}
		</div>
	);
}

/** Recuadro de dato destacado (Figma: fondo de marca suave). */
export function RecuadroMarca({
	titulo,
	detalle,
	className,
}: {
	titulo: React.ReactNode;
	detalle?: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-col gap-1 rounded-2xl bg-brand-subtle px-4 py-3",
				className,
			)}
		>
			<p className="font-semibold text-fg text-sm leading-normal">{titulo}</p>
			{detalle ? (
				<p className="text-fg-secondary text-xs leading-normal">{detalle}</p>
			) : null}
		</div>
	);
}

/**
 * Paso final (Figma 4298:104 «Asesor creado» y 4300:94 «Asesor dado de
 * baja»): ícono, título, resumen y dos acciones.
 */
export function PasoExito({
	titulo,
	resumen,
	notas = [],
	accion,
	onCerrar,
}: {
	titulo: string;
	resumen: React.ReactNode;
	/** Avisos adicionales (p. ej. qué pasó con el usuario del CRM). */
	notas?: React.ReactNode[];
	accion: { etiqueta: string; onClick: () => void };
	onCerrar: () => void;
}) {
	return (
		<div className="flex flex-col items-center gap-4 py-2 text-center">
			<DialogIcon />
			<div className="flex flex-col gap-2">
				<h2 className={dialogTitleClassName}>{titulo}</h2>
				<p className="text-fg-secondary text-sm leading-normal">{resumen}</p>
			</div>
			{notas.length ? (
				<ul className="flex w-full flex-col gap-1 rounded-xl bg-muted px-4 py-3 text-left text-fg-secondary text-xs leading-normal">
					{notas.map((n, i) => (
						// Lista corta y fija de avisos: el índice basta como clave.
						// biome-ignore lint/suspicious/noArrayIndexKey: lista estática
						<li key={i}>{n}</li>
					))}
				</ul>
			) : null}
			<div className="flex flex-wrap justify-center gap-2.5">
				<Button variant="secondary" onClick={accion.onClick}>
					{accion.etiqueta}
				</Button>
				<Button onClick={onCerrar}>Cerrar</Button>
			</div>
		</div>
	);
}

/** Flecha «antes → después» (el carácter de la fuente sale diminuto). */
export function Flecha() {
	return (
		<ArrowRight
			aria-label="pasa a"
			className="inline size-3 shrink-0 align-[-1px]"
		/>
	);
}
