import { useMutation } from "@tanstack/react-query";
import { Loader2, MessageCircle } from "lucide-react";
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
import { client } from "@/utils/orpc";

/**
 * Pregunta si hay que reenviar los enlaces por WhatsApp.
 *
 * Se abre después de regenerar o de reemplazar un contrato: en los dos casos los
 * enlaces que la gente tenía en el teléfono dejaron de servir, y si nadie les
 * manda los nuevos se quedan esperando sobre un link muerto. No se manda solo
 * porque a veces se regenera varias veces seguidas mientras se corrige algo, y
 * no tiene sentido inundar al cliente.
 *
 * Con `contratos` se manda sólo lo que acaba de cambiar: si se renovó uno, ese;
 * si se rehízo la batería, todos. Los enlaces de los demás siguen sirviendo, y
 * mandarle al cliente la batería entera por un solo contrato lo confunde.
 */
export function ReenviarWhatsappDialog({
	opportunityId,
	contratos,
	open,
	onOpenChange,
}: {
	opportunityId: string | null;
	/** Los contratos a mandar. Sin esto, todos los vigentes. */
	contratos?: Array<{ id: string; nombre: string }>;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const reenviar = useMutation({
		mutationFn: () => {
			if (!opportunityId) throw new Error("Falta la oportunidad");
			return client.resendContractLinksWhatsapp({
				opportunityId,
				contratos: contratos?.length ? contratos.map((c) => c.id) : undefined,
			});
		},
		onSuccess: (data) => {
			if (data.success) toast.success(data.message);
			else toast.warning(data.message);
			onOpenChange(false);
		},
		onError: (error: Error) => toast.error(error.message),
	});

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle className="flex items-center gap-2">
						<MessageCircle className="h-5 w-5 text-[#25D366]" />
						¿Reenviar los enlaces por WhatsApp?
					</AlertDialogTitle>
					<AlertDialogDescription asChild>
						<div className="space-y-2 pt-2">
							<p>
								Los enlaces anteriores dejaron de servir. Si no se reenvían, el
								cliente y los codeudores se quedan con un link que ya no abre.
							</p>
							{contratos?.length ? (
								<p className="text-sm">
									Se manda sólo {contratos.length === 1 ? "el de " : "los de "}
									{contratos.map((c) => `«${c.nombre}»`).join(", ")}: los demás
									contratos siguen con sus enlaces.
								</p>
							) : null}
							<p className="text-muted-foreground text-sm">
								Cada uno recibe el suyo. A quien ya firmó no se le manda nada.
							</p>
						</div>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={reenviar.isPending}>
						Ahora no
					</AlertDialogCancel>
					<AlertDialogAction
						onClick={(e) => {
							e.preventDefault();
							reenviar.mutate();
						}}
						disabled={reenviar.isPending}
					>
						{reenviar.isPending ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Enviando...
							</>
						) : (
							"Sí, reenviar"
						)}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
