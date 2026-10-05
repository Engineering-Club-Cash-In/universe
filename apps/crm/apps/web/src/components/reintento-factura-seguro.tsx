import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { client, orpc } from "@/utils/orpc";

export function ReintentoFacturaSeguro({
	opportunityId,
	disponible,
}: {
	opportunityId: string;
	disponible: boolean | null | undefined;
}) {
	const queryClient = useQueryClient();
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

	if (!disponible) return null;

	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			disabled={reenviar.isPending}
			onClick={() => {
				if (
					window.confirm(
						"Solo se permite un reintento de este correo. ¿Continuar?",
					)
				) {
					reenviar.mutate();
				}
			}}
		>
			{reenviar.isPending ? (
				<Loader2 className="mr-1 h-4 w-4 animate-spin" />
			) : (
				<RotateCw className="mr-1 h-4 w-4" />
			)}
			{reenviar.isPending ? "Reintentando..." : "Reintentar correo"}
		</Button>
	);
}
