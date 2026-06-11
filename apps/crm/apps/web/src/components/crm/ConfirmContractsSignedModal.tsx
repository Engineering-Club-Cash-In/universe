import { FileSignature } from "lucide-react";
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

interface ConfirmContractsSignedModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	isLoading?: boolean;
	opportunityTitle?: string;
}

export function ConfirmContractsSignedModal({
	open,
	onOpenChange,
	onConfirm,
	isLoading = false,
	opportunityTitle,
}: ConfirmContractsSignedModalProps) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle className="flex items-center gap-2">
						<FileSignature className="h-5 w-5 text-green-600" />
						¿Todos los contratos han sido firmados?
					</AlertDialogTitle>
					<AlertDialogDescription asChild>
						<div className="space-y-3 pt-2">
							{opportunityTitle && (
								<p>
									Oportunidad: <strong>{opportunityTitle}</strong>
								</p>
							)}
							<div className="rounded-lg bg-blue-50 p-3">
								<p className="font-medium text-blue-900 text-sm">
									<FileSignature className="mr-1 inline h-4 w-4" />
									Al confirmar, los contratos se marcarán como firmados y la
									oportunidad avanzará al 90%
								</p>
								<p className="mt-1 text-blue-700 text-xs">
									Asegúrate de que todos los contratos estén debidamente
									firmados antes de confirmar.
								</p>
							</div>
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
						{isLoading ? "Procesando..." : "Sí, contratos firmados"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
