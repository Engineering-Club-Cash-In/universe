import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban } from "lucide-react";
import { useState } from "react";
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
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { orpc } from "@/utils/orpc";

/**
 * Descartar una batería: la compra que no lleva contratos.
 *
 * Pide motivo escrito, porque una batería que desaparece sin explicación no se
 * distingue de una que se olvidó. Si la compra ya tiene contratos emitidos, el
 * servidor la rechaza y se dice por qué: hay que anularlos primero.
 *
 * Lo usan la lista de jurídico, para descartar sin entrar, y la pantalla de la
 * batería.
 */
export function DescartarBateria({
	batchId,
	investorName,
	onDescartada,
	size = "sm",
	variant = "ghost",
}: {
	batchId: string;
	/** Para que el diálogo diga de quién es la batería que se descarta. */
	investorName?: string;
	onDescartada?: () => void;
	size?: "sm" | "default";
	variant?: "ghost" | "outline";
}) {
	const queryClient = useQueryClient();
	const [abierto, setAbierto] = useState(false);
	const [motivo, setMotivo] = useState("");

	const descartar = useMutation({
		...orpc.closeInvestorContractBatch.mutationOptions(),
		onSuccess: () => {
			toast.success("Batería descartada");
			setAbierto(false);
			setMotivo("");
			queryClient.invalidateQueries({
				predicate: (query) =>
					JSON.stringify(query.queryKey).includes("InvestorContractBatch"),
			});
			onDescartada?.();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	return (
		<AlertDialog
			open={abierto}
			onOpenChange={(valor) => {
				if (!descartar.isPending) setAbierto(valor);
			}}
		>
			<AlertDialogTrigger asChild>
				<Button variant={variant} size={size}>
					<Ban className="mr-2 h-4 w-4" />
					Descartar
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						¿Descartar{" "}
						{investorName ? `la batería de ${investorName}` : "esta batería"}?
					</AlertDialogTitle>
					<AlertDialogDescription>
						Es para la compra que no lleva contratos. Queda registrada con el
						motivo y no se le pueden emitir contratos después.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<Input
					value={motivo}
					onChange={(e) => setMotivo(e.target.value)}
					placeholder="Por qué no hay que hacer estos contratos"
				/>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={descartar.isPending}>
						Cancelar
					</AlertDialogCancel>
					<AlertDialogAction
						onClick={(e) => {
							e.preventDefault();
							descartar.mutate({ batchId, resultado: "descartada", motivo });
						}}
						disabled={descartar.isPending || motivo.trim().length < 3}
					>
						{descartar.isPending ? "Descartando..." : "Descartar"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
