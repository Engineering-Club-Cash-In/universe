import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogIcon,
	DialogTitle,
} from "@/components/ui/dialog";
import { fechaCorta, MOTIVO_COBERTURA_LABEL } from "./estado-asesor";

/**
 * «Reactivar» de la tarjeta de un asesor ausente. Hoy una ausencia es una
 * cobertura (`coberturas_agenda_cobros`): reactivar = `cancelarCobertura` de
 * la vigente. La cartera nunca cambió de propietario; lo que vuelve al titular
 * son sus tareas de agenda, que mientras tanto veía el suplente.
 * Presentación pura: el contenedor hace la mutación.
 */

export type CoberturaReactivar = {
	nombre: string;
	motivo: string;
	desde: string;
	hasta: string;
	suplente: string;
};

export function ConfirmarReactivarDialog({
	cobertura,
	pendiente,
	error,
	onConfirmar,
	onCerrar,
}: {
	cobertura: CoberturaReactivar | null;
	pendiente: boolean;
	error?: string | null;
	onConfirmar: () => void;
	onCerrar: () => void;
}) {
	return (
		<AlertDialog
			open={!!cobertura}
			onOpenChange={(abierto) => !abierto && !pendiente && onCerrar()}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Reactivar a {cobertura?.nombre}</AlertDialogTitle>
					<AlertDialogDescription>
						Se cancelará su ausencia por{" "}
						{(
							MOTIVO_COBERTURA_LABEL[cobertura?.motivo ?? ""] ??
							cobertura?.motivo ??
							""
						).toLowerCase()}{" "}
						({cobertura ? fechaCorta(cobertura.desde) : ""} al{" "}
						{cobertura ? fechaCorta(cobertura.hasta) : ""}). Desde ahora sus
						tareas de agenda dejan de mostrarse a {cobertura?.suplente} y
						vuelven a ser suyas. El registro se conserva en el historial de
						coberturas.
					</AlertDialogDescription>
				</AlertDialogHeader>
				{error ? (
					<p role="alert" className="text-danger-text text-sm">
						{error}
					</p>
				) : null}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={pendiente}>Volver</AlertDialogCancel>
					<AlertDialogAction
						disabled={pendiente}
						onClick={(e) => {
							e.preventDefault();
							onConfirmar();
						}}
					>
						{pendiente ? "Reactivando…" : "Reactivar"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

/** Figma «Modal · Asesor reactivado» (3366:4235), en usted. */
export function AsesorReactivadoDialog({
	nombre,
	onCerrar,
}: {
	nombre: string | null;
	onCerrar: () => void;
}) {
	return (
		<Dialog open={!!nombre} onOpenChange={(abierto) => !abierto && onCerrar()}>
			<DialogContent className="sm:max-w-md" showCloseButton={false}>
				<DialogHeader>
					<DialogIcon />
					<DialogTitle>Asesor reactivado</DialogTitle>
					<DialogDescription>
						{nombre} se reincorporó: se canceló su ausencia y sus tareas de
						agenda vuelven a ser suyas desde hoy. Su cartera siempre conservó su
						propietario.
					</DialogDescription>
				</DialogHeader>
				{/* TODO(José) · tarea M5: aviso automático al equipo cuando un asesor
				    se reactiva (y devolución de la cartera repartida). */}
				<div className="flex items-center justify-between gap-3 rounded-xl bg-muted px-4 py-3 text-fg-secondary text-sm">
					<span>Aviso automático al equipo</span>
					<Badge variant="neutral">Pronto</Badge>
				</div>
				<DialogFooter>
					<Button className="w-full" onClick={onCerrar}>
						Entendido
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
