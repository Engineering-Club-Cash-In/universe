import { AlertCircle, AlertTriangle, CheckCircle, FileText } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ContractInfo {
	id: string;
	contractName: string;
	status: "pending" | "signed" | "cancelled";
}

interface ApproveOpportunityModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	onMarkAllSigned?: () => void;
	isLoading?: boolean;
	isMarkingAsSigned?: boolean;
	opportunityTitle?: string;
	contracts?: ContractInfo[];
}

export function ApproveOpportunityModal({
	open,
	onOpenChange,
	onConfirm,
	onMarkAllSigned,
	isLoading = false,
	isMarkingAsSigned = false,
	opportunityTitle,
	contracts = [],
}: ApproveOpportunityModalProps) {
	const activeContracts = contracts.filter((c) => c.status !== "cancelled");
	const unsignedContracts = activeContracts.filter(
		(c) => c.status !== "signed",
	);
	const hasUnsigned = unsignedContracts.length > 0;

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle className="flex items-center gap-2">
						{hasUnsigned ? (
							<AlertTriangle className="h-5 w-5 text-amber-600" />
						) : (
							<CheckCircle className="h-5 w-5 text-green-600" />
						)}
						{hasUnsigned
							? "Contratos sin firmar"
							: "¿Completar contratos?"}
					</AlertDialogTitle>
					<AlertDialogDescription asChild>
						<div className="space-y-3 pt-2">
							{hasUnsigned ? (
								<>
									<p>
										Hay{" "}
										<strong>
											{unsignedContracts.length} contrato
											{unsignedContracts.length > 1 ? "s" : ""}
										</strong>{" "}
										sin firmar
										{opportunityTitle && (
											<>
												{" "}
												en la oportunidad{" "}
												<strong>{opportunityTitle}</strong>
											</>
										)}
										:
									</p>
									<div className="space-y-2 rounded-lg border bg-muted/30 p-3">
										{activeContracts.map((contract) => (
											<div
												key={contract.id}
												className="flex items-center justify-between text-sm"
											>
												<span className="flex items-center gap-2">
													<FileText className="h-3.5 w-3.5 text-muted-foreground" />
													{contract.contractName}
												</span>
												<Badge
													variant={
														contract.status === "signed"
															? "default"
															: "outline"
													}
													className={
														contract.status === "signed"
															? "border-green-500 bg-green-50 text-green-700"
															: "border-amber-500 bg-amber-50 text-amber-700"
													}
												>
													{contract.status === "signed"
														? "Firmado"
														: "Pendiente"}
												</Badge>
											</div>
										))}
									</div>
									<div className="rounded-lg bg-amber-50 p-3">
										<p className="font-medium text-amber-900 text-sm">
											<AlertCircle className="mr-1 inline h-4 w-4" />
											Debes marcar los contratos como firmados antes de
											aprobar
										</p>
									</div>
								</>
							) : (
								<>
									<p>
										Todos los contratos están firmados
										{opportunityTitle && (
											<>
												{" "}
												para la oportunidad{" "}
												<strong>{opportunityTitle}</strong>
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
											La oportunidad avanzará a la siguiente etapa del
											proceso de venta.
										</p>
									</div>
									<p className="font-medium text-sm">
										¿Estás seguro de continuar?
									</p>
								</>
							)}
						</div>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isLoading || isMarkingAsSigned}>
						Cancelar
					</AlertDialogCancel>
					{hasUnsigned ? (
						<Button
							onClick={(e) => {
								e.preventDefault();
								onMarkAllSigned?.();
							}}
							disabled={isMarkingAsSigned}
							className="bg-amber-600 hover:bg-amber-700"
						>
							{isMarkingAsSigned
								? "Marcando..."
								: "Marcar todos como firmados"}
						</Button>
					) : (
						<AlertDialogAction
							onClick={(e) => {
								e.preventDefault();
								onConfirm();
							}}
							disabled={isLoading}
							className="bg-green-600 hover:bg-green-700"
						>
							{isLoading ? "Procesando..." : "Sí, aprobar y avanzar a 90%"}
						</AlertDialogAction>
					)}
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
