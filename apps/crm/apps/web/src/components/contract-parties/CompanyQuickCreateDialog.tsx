import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { client, orpc } from "@/utils/orpc";

export interface QuickCompany {
	id: string;
	name: string;
	razonSocial: string | null;
}

/** Alta rápida de la empresa (agencia) sin salir de la pantalla. */
export function CompanyQuickCreateDialog({
	open,
	onOpenChange,
	onSaved,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSaved: (company: QuickCompany) => void;
}) {
	const queryClient = useQueryClient();
	const [nombre, setNombre] = useState("");
	const [razonSocial, setRazonSocial] = useState("");

	useEffect(() => {
		if (!open) return;
		setNombre("");
		setRazonSocial("");
	}, [open]);

	const createMutation = useMutation({
		mutationFn: () =>
			client.createCompany({
				name: nombre.trim(),
				razonSocial: razonSocial.trim() || undefined,
			}),
		onSuccess: (company) => {
			queryClient.invalidateQueries({ queryKey: orpc.getCompanies.key() });
			queryClient.invalidateQueries({
				queryKey: orpc.getCompaniesForContracts.key(),
			});
			toast.success("Empresa creada");
			onSaved({
				id: company.id,
				name: company.name,
				razonSocial: company.razonSocial,
			});
			onOpenChange(false);
		},
		onError: (error) => {
			toast.error(error.message || "No se pudo crear la empresa");
		},
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Nueva empresa (agencia)</DialogTitle>
					<DialogDescription>
						La razón social es el nombre legal que va en los contratos.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="quick-company-nombre">Nombre comercial</Label>
						<Input
							id="quick-company-nombre"
							placeholder="JAC Plaza Madero"
							value={nombre}
							onChange={(e) => setNombre(e.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="quick-company-razon">Razón social</Label>
						<Input
							id="quick-company-razon"
							placeholder="JAC GUATEMALA, SOCIEDAD ANÓNIMA"
							value={razonSocial}
							onChange={(e) => setRazonSocial(e.target.value)}
						/>
					</div>
				</div>

				<DialogFooter>
					<Button
						type="button"
						onClick={() => createMutation.mutate()}
						disabled={!nombre.trim() || createMutation.isPending}
					>
						{createMutation.isPending ? "Creando..." : "Crear empresa"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
