import { useMutation } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
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
 * Pide el motivo antes de reemitir un contrato.
 *
 * Regenerar no es refrescar: crea un documento NUEVO en WeeTrust con el mismo
 * PDF, lo que invalida los enlaces que la gente ya tiene y borra las firmas que
 * hubiera. Por eso se pregunta por qué, y queda guardado en el contrato.
 */
export function RegenerarEnlacesDialog({
	contractId,
	contractName,
	hayFirmas,
	open,
	onOpenChange,
	onRegenerado,
}: {
	contractId: string;
	contractName: string;
	hayFirmas: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/**
	 * Con el id del contrato nuevo, que es el que hay que reenviar, y la etapa
	 * con la que lo guardó el servidor.
	 */
	onRegenerado: (
		nuevoContractId: string,
		porcentajeEtapa: number | null,
	) => void;
}) {
	const [motivo, setMotivo] = useState<string>("");

	const regenerar = useMutation({
		mutationFn: () => {
			if (!motivo) throw new Error("Elegí el motivo");
			return client.refreshContractSigningLinks({
				contractId,
				motivo: motivo as keyof typeof MOTIVOS_DE_ANULACION,
			});
		},
		onSuccess: (data) => {
			toast.success(`${data.message} (${data.enlaces} enlace(s))`);
			setMotivo("");
			onOpenChange(false);
			onRegenerado(data.contractId, data.porcentajeEtapa);
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
					<DialogTitle>Renovar enlaces de firma</DialogTitle>
					<DialogDescription>
						Se manda otra vez "{contractName}" a firmar, con el mismo documento
						y enlaces nuevos para todos.
					</DialogDescription>
				</DialogHeader>

				<div className="min-w-0 space-y-4">
					<div className="space-y-2">
						<Label htmlFor="motivo-regeneracion">Motivo</Label>
						<Select value={motivo} onValueChange={setMotivo}>
							<SelectTrigger id="motivo-regeneracion" className="w-full">
								<SelectValue placeholder="¿Por qué hay que renovarlos?" />
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

					{hayFirmas && (
						<p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 text-xs dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
							Este contrato ya tiene firmas. Al renovar los enlaces quedan sin
							efecto y todos tendrán que firmar de nuevo. El documento anterior
							no se puede borrar de la plataforma de firma, pero deja de ser el
							válido.
						</p>
					)}

					<p className="text-muted-foreground text-xs">
						Los enlaces que ya tenga la gente dejan de servir. Al terminar se te
						pregunta si querés reenviarlos por WhatsApp.
					</p>
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={regenerar.isPending}
					>
						Cancelar
					</Button>
					<Button
						onClick={() => regenerar.mutate()}
						disabled={regenerar.isPending || !motivo}
					>
						{regenerar.isPending ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<RefreshCw className="mr-2 h-4 w-4" />
						)}
						Renovar
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
