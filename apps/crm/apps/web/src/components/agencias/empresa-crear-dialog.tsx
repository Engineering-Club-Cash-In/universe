import { useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	aEmpresaInput,
	CamposEmpresa,
	type EmpresaInput,
	useEmpresaForm,
} from "./empresa-form";

/**
 * Diálogo de alta de empresa. `crear` es la mutación a usar (Empresas llama a
 * createCompany; Agencias llamará a su propio endpoint) y `alCrear` invalida
 * las consultas de quien lo monta.
 */
export function EmpresaCrearDialog({
	trigger,
	crear,
	alCrear,
}: {
	trigger: ReactNode;
	crear: (input: EmpresaInput) => Promise<unknown>;
	alCrear: () => void;
}) {
	const [open, setOpen] = useState(false);

	const mutation = useMutation({
		mutationFn: crear,
		onSuccess: () => {
			alCrear();
			toast.success("Empresa creada exitosamente");
			setOpen(false);
			form.reset();
		},
		onError: (error) => {
			toast.error(error.message || "Error al crear la empresa");
		},
	});

	const form = useEmpresaForm((value) => {
		mutation.mutate(aEmpresaInput(value));
	});

	return (
		<Dialog
			open={open}
			onOpenChange={(abierto) => {
				setOpen(abierto);
				if (!abierto) {
					form.reset();
				}
			}}
		>
			<DialogTrigger asChild>{trigger}</DialogTrigger>
			<DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Crear Nueva Empresa</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						void form.handleSubmit();
					}}
					className="space-y-4"
				>
					<CamposEmpresa form={form} mostrarErrores />

					<form.Subscribe>
						{(state) => (
							<Button
								type="submit"
								className="w-full"
								disabled={
									!state.canSubmit || state.isSubmitting || mutation.isPending
								}
							>
								{state.isSubmitting || mutation.isPending
									? "Creando..."
									: "Crear Empresa"}
							</Button>
						)}
					</form.Subscribe>
				</form>
			</DialogContent>
		</Dialog>
	);
}
