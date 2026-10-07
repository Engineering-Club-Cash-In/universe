import type * as React from "react";
import { useState } from "react";
import { TrasladosPanel } from "@/components/cobros/traslados-panel";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import { PopoverPortalContext } from "@/components/ui/popover";

/** Descripción del modal para lectores de pantalla (la usa también el showcase). */
export const DESCRIPCION_TRASLADO =
	"Revise la distribución por asesor y bucket antes de confirmar. Los compromisos conservan sus condiciones.";

/**
 * Caja del modal «Trasladar cartera»: compacta como «Marcar ausente» (Figma
 * 3367:4244), con scroll interno si el contenido no cabe y los popovers
 * (combobox de asesores) montados dentro de la caja (`PopoverPortalContext`),
 * para que no queden cortados ni detrás del scroll bloqueado. Mientras
 * `ocupado`, el modal no se cierra. La usa el showcase con la vista de ejemplo.
 */
export function TrasladarDialogMarco({
	abierto,
	ocupado = false,
	onCerrar,
	children,
}: {
	abierto: boolean;
	ocupado?: boolean;
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
				className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-140"
				onInteractOutside={(e) => {
					if (ocupado) e.preventDefault();
				}}
			>
				<DialogTitle className="sr-only">Trasladar cartera</DialogTitle>
				<DialogDescription className="sr-only">
					{DESCRIPCION_TRASLADO}
				</DialogDescription>
				<PopoverPortalContext.Provider value={caja}>
					{children}
				</PopoverPortalContext.Provider>
			</DialogContent>
		</Dialog>
	);
}

/**
 * «Trasladar cartera» (botón del encabezado de Mi equipo o fila de Carga y
 * asignación): el traslado masivo COMPLETO de `TrasladosPanel` en tres pasos
 * (origen y forma de repartir → revisión del reparto → resultado).
 */
export function TrasladarDialog({
	abierto,
	asesorInicial,
	onCerrar,
}: {
	abierto: boolean;
	/** `asesor_id` de cartera ya elegido como origen (`?asesor=`). */
	asesorInicial?: number;
	onCerrar: () => void;
}) {
	const [ocupado, setOcupado] = useState(false);
	return (
		<TrasladarDialogMarco
			abierto={abierto}
			ocupado={ocupado}
			onCerrar={onCerrar}
		>
			{abierto ? (
				<TrasladosPanel
					// Si cambia el asesor pedido, el formulario arranca de nuevo.
					key={asesorInicial ?? "sin-asesor"}
					origenInicial={asesorInicial}
					onOcupado={setOcupado}
					onCerrar={onCerrar}
				/>
			) : null}
		</TrasladarDialogMarco>
	);
}
