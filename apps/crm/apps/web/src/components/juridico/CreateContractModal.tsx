import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Plus, X } from "lucide-react";
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
import { client } from "@/utils/orpc";

interface CreateContractModalProps {
	leadId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess?: () => void;
}

export function CreateContractModal({
	leadId,
	open,
	onOpenChange,
	onSuccess,
}: CreateContractModalProps) {
	const [formData, setFormData] = useState({
		contractType: "",
		contractName: "",
		clientSigningLink: "",
		representativeSigningLink: "",
		additionalSigningLinks: [] as string[],
	});

	const [newAdditionalLink, setNewAdditionalLink] = useState("");

	const createMutation = useMutation({
		mutationFn: async (values: {
			leadId: string;
			contractType: string;
			contractName: string;
			clientSigningLink?: string;
			representativeSigningLink?: string;
			additionalSigningLinks?: string[];
		}) => {
			return await client.createLegalContract(values);
		},
		onSuccess: () => {
			toast.success("Contrato registrado exitosamente");
			onSuccess?.();
			resetForm();
			onOpenChange(false);
		},
		onError: (error: Error) => {
			toast.error(`Error al registrar contrato: ${error.message}`);
		},
	});

	const resetForm = () => {
		setFormData({
			contractType: "",
			contractName: "",
			clientSigningLink: "",
			representativeSigningLink: "",
			additionalSigningLinks: [],
		});
		setNewAdditionalLink("");
	};

	const handleAddAdditionalLink = () => {
		if (newAdditionalLink.trim()) {
			setFormData((prev) => ({
				...prev,
				additionalSigningLinks: [
					...prev.additionalSigningLinks,
					newAdditionalLink.trim(),
				],
			}));
			setNewAdditionalLink("");
		}
	};

	const handleRemoveAdditionalLink = (index: number) => {
		setFormData((prev) => ({
			...prev,
			additionalSigningLinks: prev.additionalSigningLinks.filter(
				(_, i) => i !== index,
			),
		}));
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();

		// Validaciones
		if (!formData.contractType.trim()) {
			toast.error("El tipo de contrato es requerido");
			return;
		}
		if (!formData.contractName.trim()) {
			toast.error("El nombre del contrato es requerido");
			return;
		}

		createMutation.mutate({
			leadId,
			contractType: formData.contractType.trim(),
			contractName: formData.contractName.trim(),
			clientSigningLink: formData.clientSigningLink.trim() || undefined,
			representativeSigningLink:
				formData.representativeSigningLink.trim() || undefined,
			additionalSigningLinks:
				formData.additionalSigningLinks.length > 0
					? formData.additionalSigningLinks
					: undefined,
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Registrar Nuevo Contrato</DialogTitle>
					<DialogDescription>
						Completa la información del contrato legal generado
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="grid gap-4">
						{/* Tipo de contrato */}
						<div className="space-y-2">
							<Label htmlFor="contractType">
								Tipo de contrato <span className="text-red-500">*</span>
							</Label>
							<Input
								id="contractType"
								placeholder="ej: contrato_privado_uso_carro_usado"
								value={formData.contractType}
								onChange={(e) =>
									setFormData((prev) => ({
										...prev,
										contractType: e.target.value,
									}))
								}
								disabled={createMutation.isPending}
							/>
						</div>

						{/* Nombre del contrato */}
						<div className="space-y-2">
							<Label htmlFor="contractName">
								Nombre del contrato <span className="text-red-500">*</span>
							</Label>
							<Input
								id="contractName"
								placeholder="ej: Contrato de Uso de Vehículo"
								value={formData.contractName}
								onChange={(e) =>
									setFormData((prev) => ({
										...prev,
										contractName: e.target.value,
									}))
								}
								disabled={createMutation.isPending}
							/>
						</div>

						{/* Link del cliente */}
						<div className="space-y-2">
							<Label htmlFor="clientSigningLink">Link del Cliente</Label>
							<Input
								id="clientSigningLink"
								type="url"
								placeholder="https://..."
								value={formData.clientSigningLink}
								onChange={(e) =>
									setFormData((prev) => ({
										...prev,
										clientSigningLink: e.target.value,
									}))
								}
								disabled={createMutation.isPending}
							/>
						</div>

						{/* Link del representante */}
						<div className="space-y-2">
							<Label htmlFor="representativeSigningLink">
								Link del Representante
							</Label>
							<Input
								id="representativeSigningLink"
								type="url"
								placeholder="https://..."
								value={formData.representativeSigningLink}
								onChange={(e) =>
									setFormData((prev) => ({
										...prev,
										representativeSigningLink: e.target.value,
									}))
								}
								disabled={createMutation.isPending}
							/>
						</div>

						{/* Links adicionales */}
						<div className="space-y-2">
							<Label>Links Adicionales</Label>
							<div className="flex gap-2">
								<Input
									type="url"
									placeholder="https://..."
									value={newAdditionalLink}
									onChange={(e) => setNewAdditionalLink(e.target.value)}
									disabled={createMutation.isPending}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											handleAddAdditionalLink();
										}
									}}
								/>
								<Button
									type="button"
									variant="outline"
									size="icon"
									onClick={handleAddAdditionalLink}
									disabled={
										!newAdditionalLink.trim() || createMutation.isPending
									}
								>
									<Plus className="h-4 w-4" />
								</Button>
							</div>

							{/* Lista de links adicionales */}
							{formData.additionalSigningLinks.length > 0 && (
								<div className="mt-2 space-y-2">
									{formData.additionalSigningLinks.map((link, index) => (
										<div
											key={index}
											className="flex items-center gap-2 rounded-md border border-border bg-muted/50 p-2"
										>
											<p className="flex-1 truncate text-sm font-mono">
												{link}
											</p>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												onClick={() => handleRemoveAdditionalLink(index)}
												disabled={createMutation.isPending}
											>
												<X className="h-4 w-4" />
											</Button>
										</div>
									))}
								</div>
							)}
						</div>
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={createMutation.isPending}
						>
							Cancelar
						</Button>
						<Button type="submit" disabled={createMutation.isPending}>
							{createMutation.isPending ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Registrando...
								</>
							) : (
								"Registrar Contrato"
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
