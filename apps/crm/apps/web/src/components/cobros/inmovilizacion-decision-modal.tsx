import { useMutation } from "@tanstack/react-query";
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

export type DecisionInmovilizacion = "aprobar" | "rechazar";

/**
 * CB-041 — Aprobar o rechazar una solicitud de inmovilización. Lo usan la cola
 * del supervisor y la carta de la Ficha 360; el server solo deja decidir a
 * supervisor y admin (`decidirInmovilizacion`), así que quien lo monte decide
 * además a quién se lo muestra.
 */
export function DecisionInmovilizacionModal({
	id,
	decision,
	resumen,
	open,
	onOpenChange,
	onResuelto,
}: {
	id: string;
	decision: DecisionInmovilizacion;
	resumen: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onResuelto: () => void;
}) {
	const [motivoRechazo, setMotivoRechazo] = useState("");
	const motivoValido = motivoRechazo.trim().length >= 5;

	const mutation = useMutation({
		...orpc.decidirInmovilizacion.mutationOptions(),
		onSuccess: () => {
			toast.success(
				decision === "aprobar" ? "Solicitud aprobada." : "Solicitud rechazada.",
			);
			onResuelto();
			onOpenChange(false);
			setMotivoRechazo("");
		},
		onError: (error) => {
			toast.error(error.message || "No se pudo procesar la decisión.", {
				duration: 8000,
			});
		},
	});

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{decision === "aprobar"
							? "Aprobar solicitud"
							: "Rechazar solicitud"}
					</DialogTitle>
					<DialogDescription>{resumen}</DialogDescription>
				</DialogHeader>

				{decision === "rechazar" && (
					<div>
						<Label htmlFor="motivo-rechazo-inmov">Motivo del rechazo</Label>
						<Textarea
							id="motivo-rechazo-inmov"
							onChange={(e) => setMotivoRechazo(e.target.value)}
							rows={3}
							value={motivoRechazo}
						/>
						{!motivoValido && motivoRechazo.length > 0 && (
							<p className="mt-1 text-destructive text-xs">
								Ingrese al menos 5 caracteres.
							</p>
						)}
					</div>
				)}

				<DialogFooter>
					<Button onClick={() => onOpenChange(false)} variant="outline">
						Cancelar
					</Button>
					<Button
						disabled={
							mutation.isPending || (decision === "rechazar" && !motivoValido)
						}
						onClick={() =>
							mutation.mutate({
								id,
								decision,
								motivoRechazo:
									decision === "rechazar" ? motivoRechazo.trim() : undefined,
							})
						}
						variant={decision === "aprobar" ? "default" : "destructive"}
					>
						Confirmar
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
