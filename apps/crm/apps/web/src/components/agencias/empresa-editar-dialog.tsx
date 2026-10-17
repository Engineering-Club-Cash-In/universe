import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	aEmpresaInput,
	CamposEmpresa,
	type EmpresaInput,
	useEmpresaForm,
} from "./empresa-form";

export type EmpresaEditable = {
	id: string;
	name: string | null;
	industry: string | null;
	size: string | null;
	website: string | null;
	email: string | null;
	phone: string | null;
	address: string | null;
	notes: string | null;
};

/**
 * Diálogo de edición de empresa. `editar` es la mutación a usar y `alEditar`
 * invalida las consultas de quien lo monta. Los campos se cargan desde
 * `empresa` cada vez que el diálogo se abre.
 */
export function EmpresaEditarDialog({
	open,
	onOpenChange,
	empresa,
	editar,
	alEditar,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	empresa: EmpresaEditable | null;
	editar: (input: EmpresaInput & { id: string }) => Promise<unknown>;
	alEditar: () => void;
}) {
	const mutation = useMutation({
		mutationFn: editar,
		onSuccess: () => {
			alEditar();
			toast.success("Empresa actualizada exitosamente");
			onOpenChange(false);
		},
		onError: (error) => {
			toast.error(error.message || "Error al actualizar la empresa");
		},
	});

	const form = useEmpresaForm((value) => {
		if (empresa) {
			mutation.mutate({ id: empresa.id, ...aEmpresaInput(value) });
		}
	});

	useEffect(() => {
		if (!open || !empresa) return;
		form.setFieldValue("name", empresa.name || "");
		form.setFieldValue("industry", empresa.industry || "none");
		form.setFieldValue("size", empresa.size || "none");
		form.setFieldValue("website", empresa.website || "");
		form.setFieldValue("email", empresa.email || "");
		form.setFieldValue("phone", empresa.phone || "");
		form.setFieldValue("address", empresa.address || "");
		form.setFieldValue("notes", empresa.notes || "");
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, empresa]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Editar Empresa</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						void form.handleSubmit();
					}}
					className="space-y-4"
				>
					<CamposEmpresa form={form} mostrarErrores={false} />

					<form.Subscribe>
						{(state) => (
							<div className="flex gap-3">
								<Button
									type="button"
									variant="outline"
									className="flex-1"
									onClick={() => onOpenChange(false)}
								>
									Cancelar
								</Button>
								<Button
									type="submit"
									className="flex-1"
									disabled={
										!state.canSubmit || state.isSubmitting || mutation.isPending
									}
								>
									{state.isSubmitting || mutation.isPending
										? "Actualizando..."
										: "Actualizar Empresa"}
								</Button>
							</div>
						)}
					</form.Subscribe>
				</form>
			</DialogContent>
		</Dialog>
	);
}
