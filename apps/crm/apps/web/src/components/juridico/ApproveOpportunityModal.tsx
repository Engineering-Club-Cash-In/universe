import { AlertCircle, CheckCircle } from "lucide-react";
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
						<AlertCircle className="h-5 w-5 text-amber-600" />
						¿Completar contratos?
					</AlertDialogTitle>
					<AlertDialogDescription className="space-y-3 pt-2">
						<p>
							Estás a punto de marcar como completados los contratos legales
							{opportunityTitle && (
								<>
									{" "}
									de la oportunidad <strong>{opportunityTitle}</strong>
								</>
							)}
							.
						</p>
						<div className="rounded-lg bg-blue-50 p-3">
							<p className="font-medium text-blue-900 text-sm">
								<CheckCircle className="mr-1 inline h-4 w-4" />
								Esta acción moverá la oportunidad al 90% de cierre
							</p>
							<p className="mt-1 text-blue-700 text-xs">
								La oportunidad avanzará a la siguiente etapa del proceso de
								venta.
							</p>
						</div>
						<p className="font-medium text-sm">¿Estás seguro de continuar?</p>
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
						{isLoading ? "Procesando..." : "Sí, completar contratos"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
