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
	estado,
}: {
	opportunityId: string;
	disponible: boolean | null | undefined;
	aseguradora?: string | null;
	estado?: string | null;
}) {
	const queryClient = useQueryClient();
	const [confirmando, setConfirmando] = useState(false);
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
		onSuccess: () => {
			toast.info("Reintento procesado. Revisa el estado del correo.");
			refrescar();
		},
		onError: (error) => {
			toast.error(error.message || "No se pudo reintentar el correo");
			refrescar();
		},
	});

	// Un `pendiente` pasa a reintentable a los 10 minutos: mientras tanto se
	// vuelve a consultar, para que el botón aparezca sin recargar.
	useEffect(() => {
		if (estado !== "pendiente" || disponible) return;
		const id = setInterval(() => {
			queryClient.invalidateQueries({
				queryKey: orpc.getOpportunityDocuments.key(),
			});
			queryClient.invalidateQueries({
				queryKey: ["getOpportunityDocuments", opportunityId],
			});
		}, 60_000);
		return () => clearInterval(id);
	}, [estado, disponible, opportunityId, queryClient]);

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
