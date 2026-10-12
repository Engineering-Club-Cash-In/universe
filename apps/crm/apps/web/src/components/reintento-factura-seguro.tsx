import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/button";
import { nombreAseguradora } from "@/lib/envio-aseguradora";
import { client, orpc } from "@/utils/orpc";

export function ReintentoFacturaSeguro({
	opportunityId,
	disponible,
	aseguradora,
	reintentoDesde,
}: {
	opportunityId: string;
	disponible: boolean | null | undefined;
	aseguradora?: string | null;
	/** Cuándo un envío pendiente pasa a reintentable (lo calcula el server). */
	reintentoDesde?: string | null;
}) {
	const queryClient = useQueryClient();
	const [confirmando, setConfirmando] = useState(false);
	const [revisiones, setRevisiones] = useState(0);
	const refrescar = () => {
		queryClient.invalidateQueries({
			queryKey: orpc.getOpportunityDocuments.key(),
		});
		queryClient.invalidateQueries({
			queryKey: ["getOpportunityDocuments", opportunityId],
		});
	};
	const reenviar = useMutation({
		mutationFn: () => client.reenviarFacturaSeguro({ opportunityId }),
		onSuccess: (respuesta) => {
			const r = respuesta as { envio?: string; aseguradora?: string };
			const destino = nombreAseguradora(r.aseguradora);
			if (r.envio === "enviado") {
				toast.success(`Factura reenviada a ${destino}`);
			} else if (r.envio === "fallido") {
				toast.error(`No se pudo reenviar el correo a ${destino}`);
			} else {
				toast.info(`Reintento a ${destino} en proceso`);
			}
			refrescar();
		},
		onError: (error) => {
			toast.error(error.message || "No se pudo reintentar el correo");
			refrescar();
		},
	});

	// Un `pendiente` pasa a reintentable a los 10 minutos: se refresca en ese
	// momento para que el botón aparezca sin recargar. El reloj del navegador
	// puede ir adelantado o atrasado respecto del server, así que se revisa como
	// mucho cada minuto (cada 30 s si el plazo ya pasó) hasta que el server lo
	// habilite; deja de mandar `reintentoDesde` al vencer el plazo.
	useEffect(() => {
		if (!reintentoDesde || disponible) return;
		const restante = Date.parse(reintentoDesde) - Date.now();
		const espera = restante > 0 ? Math.min(restante + 1000, 60_000) : 30_000;
		const id = setTimeout(() => {
			queryClient.invalidateQueries({
				queryKey: orpc.getOpportunityDocuments.key(),
			});
			queryClient.invalidateQueries({
				queryKey: ["getOpportunityDocuments", opportunityId],
			});
			setRevisiones((n) => n + 1);
		}, espera);
		return () => clearTimeout(id);
	}, [reintentoDesde, disponible, opportunityId, queryClient, revisiones]);

	if (!disponible) return null;

	return (
		<>
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={reenviar.isPending}
				onClick={() => setConfirmando(true)}
			>
				{reenviar.isPending ? (
					<Loader2 className="mr-1 h-4 w-4 animate-spin" />
				) : (
					<RotateCw className="mr-1 h-4 w-4" />
				)}
				{reenviar.isPending ? "Reintentando..." : "Reintentar correo"}
			</Button>
			<AlertDialog open={confirmando} onOpenChange={setConfirmando}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Reintentar el envío del correo</AlertDialogTitle>
						<AlertDialogDescription>
							La factura se volverá a enviar por correo electrónico a la
							aseguradora{" "}
							<span className="font-medium text-foreground">
								{nombreAseguradora(aseguradora)}
							</span>
							. Solo se permite un reintento. ¿Está seguro?
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>No</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								setConfirmando(false);
								reenviar.mutate();
							}}
						>
							Sí
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
