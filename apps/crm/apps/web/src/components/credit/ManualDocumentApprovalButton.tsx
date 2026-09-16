import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { client, orpc } from "@/utils/orpc";

export type ManualDocumentApproval = Awaited<
	ReturnType<typeof client.approveDocumentIntegrityValidation>
>;

export function ManualDocumentApprovalButton({
	validationId,
	disabled = false,
	onApproved,
}: {
	validationId: string;
	disabled?: boolean;
	onApproved?: (approval: ManualDocumentApproval) => void;
}) {
	const [open, setOpen] = useState(false);
	const [reason, setReason] = useState("");
	const queryClient = useQueryClient();
	const approvalMutation = useMutation({
		mutationFn: () =>
			client.approveDocumentIntegrityValidation({ validationId, reason }),
		onSuccess: (approval) => {
			toast.success("Documento aprobado manualmente");
			onApproved?.(approval);
			setReason("");
			setOpen(false);
			queryClient.invalidateQueries({
				queryKey: orpc.getDocumentIntegrityValidationGroup.key(),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getLatestReusableDocumentIntegrityRun.key(),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.listDocumentIntegrityValidations.key(),
			});
		},
		onError: (error) => {
			toast.error(`No se pudo aprobar el documento: ${error.message}`);
		},
	});
	const canSubmit = reason.trim().length >= 5 && !approvalMutation.isPending;

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button type="button" size="sm" disabled={disabled}>
					<CheckCircle2 className="mr-2 h-4 w-4" />
					Aprobar documento
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Aprobar documento manualmente</DialogTitle>
					<DialogDescription>
						El resultado automático original se conservará. Su decisión y
						justificación quedarán auditadas.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-2">
					<Label htmlFor={`manual-approval-${validationId}`}>
						Justificación
					</Label>
					<Textarea
						id={`manual-approval-${validationId}`}
						value={reason}
						onChange={(event) => setReason(event.target.value)}
						placeholder="Explique por qué considera que el documento puede aprobarse"
						maxLength={1000}
						rows={4}
					/>
					<p className="text-muted-foreground text-xs">
						Mínimo 5 caracteres. Esta aprobación no modifica el resultado
						automático.
					</p>
				</div>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={() => setOpen(false)}
						disabled={approvalMutation.isPending}
					>
						Cancelar
					</Button>
					<Button
						type="button"
						onClick={() => approvalMutation.mutate()}
						disabled={!canSubmit}
					>
						{approvalMutation.isPending && (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						)}
						Confirmar aprobación
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
