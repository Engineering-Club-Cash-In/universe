import { useQuery } from "@tanstack/react-query";
import { CheckCircle, FlaskConical, Send } from "lucide-react";
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
import { orpc } from "@/utils/orpc";

interface ApproveOpportunityModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	isLoading?: boolean;
	opportunityTitle?: string;
}

export function ApproveOpportunityModal({
	open,
	onOpenChange,
	onConfirm,
	isLoading = false,
	opportunityTitle,
}: ApproveOpportunityModalProps) {
	// Sólo se pregunta con el modal abierto: es para avisar en el momento de
	// apretar, no un dato que valga la pena traer en cada carga de la página.
	const { data: modo } = useQuery({
		...orpc.getMessagingMode.queryOptions({ input: {} }),
		enabled: open,
	});
	const modoPrueba = modo?.modoPrueba;

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle className="flex items-center gap-2">
						<CheckCircle className="h-5 w-5 text-green-600" />
						¿Aprobar y enviar a firma?
					</AlertDialogTitle>
					<AlertDialogDescription asChild>
						<div className="space-y-3 pt-2">
							<p>
								Los contratos fueron generados
								{opportunityTitle && (
									<>
										{" "}
										para la oportunidad <strong>{opportunityTitle}</strong>
									</>
								)}
								.
							</p>
							<div className="rounded-lg bg-blue-50 p-3">
								<p className="font-medium text-blue-900 text-sm">
									<CheckCircle className="mr-1 inline h-4 w-4" />
									Esta acción moverá la oportunidad al 85% (Contratos en Firma)
								</p>
								<p className="mt-1 text-blue-700 text-xs">
									El asesor de ventas recibirá una notificación para confirmar
									cuando los contratos estén firmados.
								</p>
							</div>
							{/* Acá es donde salen los WhatsApp con los enlaces de firma.
							    Quien aprieta el botón tiene que saber a quién le va a
							    llegar, sobre todo mientras se está probando. */}
							{modoPrueba === false && (
								<div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
									<p className="font-medium text-amber-900 text-sm">
										<Send className="mr-1 inline h-4 w-4" />
										Se le van a enviar los enlaces de firma por WhatsApp
									</p>
									<p className="mt-1 text-amber-800 text-xs">
										Al cliente, a los codeudores y al representante legal, cada
										uno a su número y con su propio enlace. Esto le llega al
										cliente de verdad.
									</p>
								</div>
							)}

							{modoPrueba === true && (
								<div className="rounded-lg border border-slate-300 bg-slate-50 p-3">
									<p className="font-medium text-slate-900 text-sm">
										<FlaskConical className="mr-1 inline h-4 w-4" />
										Modo prueba: el cliente NO recibe nada
									</p>
									<p className="mt-1 text-slate-700 text-xs">
										Los WhatsApp salen a los números internos de prueba, no a
										los del cliente ni a los de los codeudores.
									</p>
								</div>
							)}

							<p className="font-medium text-sm">¿Estás seguro de continuar?</p>
						</div>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isLoading}>Cancelar</AlertDialogCancel>
					<AlertDialogAction
						onClick={(e) => {
							e.preventDefault();
							onConfirm();
						}}
						disabled={isLoading}
						className="bg-green-600 hover:bg-green-700"
					>
						{isLoading ? "Procesando..." : "Sí, aprobar y enviar a firma"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
