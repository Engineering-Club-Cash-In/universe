/**
 * Cuerpo de un modal de la Ficha 360 con el «Contexto del caso» a la izquierda.
 *
 * Reemplaza al `DialogContent` del modal: sin `caso` se comporta exactamente
 * igual que antes (`DialogContent` con `className`); con `caso` pinta dos
 * paneles, como el Espacio de trabajo:
 * - Izquierda, `ContextoCaso` en solo lectura y sin «Abrir Ficha 360» (ya se
 *   está en la Ficha).
 * - Derecha, el formulario del modal (`children`: cabecera + cuerpo).
 *
 * En pantallas angostas (<lg) un segmentado «Contexto | Formulario» los alterna.
 */
import * as React from "react";
import { DialogContent } from "@/components/ui/dialog";
import { PeriodSelector } from "@/components/ui/period-selector";
import { PopoverPortalContext } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ContextoCaso } from "./workspace/contexto-caso";
import type { CasoWorkspace } from "./workspace/use-caso-workspace";

type PanelMovil = "contexto" | "formulario";

const OPCIONES_PANEL = [
	{ value: "contexto", label: "Contexto" },
	{ value: "formulario", label: "Formulario" },
] as const;

type Props = React.ComponentProps<typeof DialogContent> & {
	/** Caso del que se muestra el contexto; sin él, un `DialogContent` normal. */
	caso?: CasoWorkspace;
	/** Relleno del panel derecho; `false` si el contenido ya trae el suyo. */
	rellenoFormulario?: boolean;
};

export function ModalContenidoConContexto({
	caso,
	rellenoFormulario = true,
	className,
	children,
	ref,
	...rest
}: Props) {
	const [panelMovil, setPanelMovil] = React.useState<PanelMovil>("formulario");
	// Los popovers (combobox, calendarios) se montan en la caja del modal.
	const [cajaModal, setCajaModal] = React.useState<HTMLDivElement | null>(null);
	const refCombinada = React.useCallback(
		(el: HTMLDivElement | null) => {
			setCajaModal(el);
			if (typeof ref === "function") ref(el);
			else if (ref) ref.current = el;
		},
		[ref],
	);

	if (!caso) {
		return (
			<DialogContent ref={ref} className={className} {...rest}>
				{children}
			</DialogContent>
		);
	}

	return (
		<DialogContent
			ref={refCombinada}
			className="flex h-[min(840px,calc(100dvh-2rem))] max-h-none w-[min(1200px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
			{...rest}
		>
			<PopoverPortalContext.Provider value={cajaModal}>
				{/* Móvil: un panel a la vez */}
				<div className="flex shrink-0 justify-center border-line-subtle border-b px-4 py-2 lg:hidden">
					<PeriodSelector
						aria-label="Panel del modal"
						value={panelMovil}
						onChange={setPanelMovil}
						options={OPCIONES_PANEL}
					/>
				</div>
				<div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)]">
					<div
						className={cn(
							"min-h-0 min-w-0 overflow-y-auto overflow-x-hidden border-line-subtle bg-canvas lg:block lg:border-r",
							panelMovil === "contexto" ? "block" : "hidden",
						)}
					>
						<ContextoCaso
							soloLectura
							caso={caso}
							className="h-full bg-canvas"
						/>
					</div>
					<div
						className={cn(
							"min-h-0 min-w-0 flex-col overflow-y-auto overflow-x-hidden bg-surface lg:flex",
							rellenoFormulario && "gap-5 p-6",
							panelMovil === "formulario" ? "flex" : "hidden",
						)}
					>
						{children}
					</div>
				</div>
			</PopoverPortalContext.Provider>
		</DialogContent>
	);
}
