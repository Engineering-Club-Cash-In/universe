import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { orpc } from "@/utils/orpc";

const MOTIVO_MIN_LENGTH = 5;

/**
 * CB-041 — Solicita el apagado o la reactivación de la unidad del caso. El
 * server valida el bucket y el estado actual de la unidad (puedeSolicitar);
 * este modal solo pide el motivo.
 */
export function SolicitarInmovilizacionModal({
	accion,
	casoCobroId,
	open,
	onOpenChange,
	onSolicitado,
}: {
	accion: "apagado" | "reactivacion";
	casoCobroId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSolicitado: () => void;
}) {
	const [motivo, setMotivo] = useState("");
	const motivoValido = motivo.trim().length >= MOTIVO_MIN_LENGTH;

	const solicitar = useMutation({
		...orpc.solicitarInmovilizacion.mutationOptions(),
		onSuccess: () => {
			toast.success(
				accion === "apagado"
					? "Solicitud de apagado enviada. El supervisor debe aprobarla."
					: "Solicitud de reactivación enviada. El supervisor debe aprobarla.",
			);
			onSolicitado();
			onOpenChange(false);
			setMotivo("");
		},
		onError: (error) => {
			toast.error(error.message || "No se pudo enviar la solicitud.", {
				duration: 8000,
			});
		},
	});

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{accion === "apagado"
							? "Solicitar apagado de unidad"
							: "Solicitar reactivación de unidad"}
					</DialogTitle>
					<DialogDescription>
						{accion === "apagado"
							? "Un supervisor debe aprobar la solicitud antes de que LEGION apague la unidad."
							: "Un supervisor debe aprobar la solicitud antes de que LEGION reactive la unidad."}
					</DialogDescription>
				</DialogHeader>

				<div>
					<Label htmlFor="motivo-inmovilizacion">Motivo</Label>
					<Textarea
						id="motivo-inmovilizacion"
						onChange={(e) => setMotivo(e.target.value)}
						placeholder="Explicá por qué se solicita esta acción"
						rows={4}
						value={motivo}
					/>
					{!motivoValido && motivo.length > 0 && (
						<p className="mt-1 text-destructive text-xs">
							Ingresá al menos {MOTIVO_MIN_LENGTH} caracteres.
						</p>
					)}
				</div>

				<DialogFooter>
					<Button onClick={() => onOpenChange(false)} variant="outline">
						Cancelar
					</Button>
					<Button
						disabled={!motivoValido || solicitar.isPending}
						onClick={() =>
							solicitar.mutate({ casoCobroId, accion, motivo: motivo.trim() })
						}
						variant={accion === "apagado" ? "destructive" : "default"}
					>
						{solicitar.isPending && (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						)}
						{accion === "apagado"
							? "Solicitar apagado"
							: "Solicitar reactivación"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
