import { CheckCircle } from "lucide-react";
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
