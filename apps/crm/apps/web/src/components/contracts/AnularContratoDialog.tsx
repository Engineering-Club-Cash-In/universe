import { useMutation } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { MOTIVOS_DE_ANULACION } from "server/src/lib/contratos-anulacion";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { client } from "@/utils/orpc";

/**
 * Pide el motivo antes de anular un contrato.
 *
 * Anular no es regenerar: no lo reemplaza por otro. La oportunidad se queda sin
 * ese documento hasta que alguien genere uno nuevo, y mientras tanto no se
 * puede aprobar ni confirmar la firma.
 */
export function AnularContratoDialog({
	contractId,
	contractName,
	hayFirmas,
	open,
	onOpenChange,
	onAnulado,
	anular: anularDelArea,
}: {
	contractId: string;
	contractName: string;
	hayFirmas: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onAnulado: () => void;
	/**
	 * Qué hacer con el motivo elegido. Por defecto anula un contrato de venta;
	 * inversiones pasa el suyo, que no mira etapas de oportunidad.
	 */
	anular?: (
		motivo: keyof typeof MOTIVOS_DE_ANULACION,
	) => Promise<{ message: string }>;
}) {
	const [motivo, setMotivo] = useState<string>("");

	const anular = useMutation({
		mutationFn: () => {
			if (!motivo) throw new Error("Elegí el motivo");
			const elegido = motivo as keyof typeof MOTIVOS_DE_ANULACION;
			if (anularDelArea) return anularDelArea(elegido);
			return client.anularContrato({ contractId, motivo: elegido });
		},
		onSuccess: (data) => {
			toast.success(data.message);
			setMotivo("");
			onOpenChange(false);
			onAnulado();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	return (
		<Dialog
			open={open}
			onOpenChange={(abierto) => {
				if (!abierto) setMotivo("");
				onOpenChange(abierto);
			}}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Anular contrato</DialogTitle>
					<DialogDescription>
						Se descarta "{contractName}" sin reemplazarlo por otro.
					</DialogDescription>
				</DialogHeader>

				<div className="min-w-0 space-y-4">
					<div className="space-y-2">
						<Label htmlFor="motivo-anulacion">Motivo</Label>
						<Select value={motivo} onValueChange={setMotivo}>
							<SelectTrigger id="motivo-anulacion" className="w-full">
								<SelectValue placeholder="¿Por qué se descarta?" />
							</SelectTrigger>
							<SelectContent>
								{Object.entries(MOTIVOS_DE_ANULACION).map(
									([clave, etiqueta]) => (
										<SelectItem key={clave} value={clave}>
											{etiqueta}
										</SelectItem>
									),
								)}
							</SelectContent>
						</Select>
					</div>

					{/* Siempre, no sólo con firmas a la vista: el estado de la ficha puede
					    estar atrasado respecto de WeeTrust, y anular consulta el vivo. */}
					<p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 text-xs dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
						{hayFirmas
							? "Este contrato ya tiene firmas. "
							: "Alguien pudo haber firmado desde la última vez que se actualizó el estado. "}
						Si falta firmar alguien, se{" "}
						<strong>borra de la plataforma de firma</strong> y las firmas que
						tenga se pierden (acá queda el registro de quién había firmado). Si
						ya lo firmaron todos, allá queda, porque no se puede borrar; acá se
						ve anulado igual.
					</p>

					<p className="text-muted-foreground text-xs">
						La oportunidad se queda sin este documento: si hace falta, hay que
						generar o subir uno nuevo. Queda en «Ver anulados» como registro.
					</p>
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={anular.isPending}
					>
						Cancelar
					</Button>
					<Button
						variant="destructive"
						onClick={() => anular.mutate()}
						disabled={anular.isPending || !motivo}
					>
						{anular.isPending ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<Trash2 className="mr-2 h-4 w-4" />
						)}
						Anular contrato
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
