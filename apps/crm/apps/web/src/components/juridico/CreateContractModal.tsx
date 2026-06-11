import { useMutation, useQuery } from "@tanstack/react-query";
import { FileUp, Loader2, Plus, X } from "lucide-react";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { uploadFileToR2WithRetry } from "@/lib/upload-to-r2";
import { client, orpc } from "@/utils/orpc";

const CONTRACT_TYPES = [
	{
		enum: "solicitud_compra_vehiculo_tercero",
		label: "Solicitud Compra Vehiculo Tercero",
	},
	{
		enum: "carta_aceptacion_instalacion_gps",
		label: "Carta Aceptacion Instalacion Gps",
	},
	{
		enum: "carta_traspaso_vehiculo_rdbe",
		label: "Carta Traspaso Vehiculo Rdbe",
	},
	{
		enum: "descargo_responsabilidades",
		label: "Descargo Responsabilidades",
	},
	{
		enum: "cobertura_inrexsa",
		label: "Cobertura Inrexsa",
	},
	{
		enum: "reconocimiento_deuda_feb_2025",
		label: "Reconocimiento Deuda Feb 2025",
	},
	{
		enum: "carta_carro_nuevo",
		label: "Carta Carro Nuevo",
	},
	{
		enum: "contrato_privado_uso_carro_nuevo",
		label: "Contrato Privado Uso Carro Nuevo",
	},
	{
		enum: "pagare_unico_libre_protesto",
		label: "Pagare Unico Libre Protesto",
	},
	{
		enum: "carta_emision_cheques",
		label: "Carta Emision Cheques",
	},
	{
		enum: "garantia_mobiliaria",
		label: "Garantia Mobiliaria",
	},
	{
		enum: "declaracion_vendedor",
		label: "Declaracion Vendedor",
	},
	{
		enum: "contrato_privado_uso_carro_usado",
		label: "Contrato Privado Uso Carro Usado",
	},
	{
		enum: "otro",
		label: "Otro (especificar en el nombre)",
	},
] as const;

interface CreateContractModalProps {
	leadId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess?: () => void;
	/** Pre-select an opportunity when opening the modal */
	preselectedOpportunityId?: string;
	/** Contract to edit (if editing) */
	contractToEdit?: {
		id: string;
		contractType: string;
		contractName: string;
		clientSigningLink: string | null;
		representativeSigningLink: string | null;
		additionalSigningLinks: string[] | null;
		opportunityId: string | null;
		pdfLink?: string | null;
	};
	/** Opportunity info (for display when editing) */
	opportunityInfo?: {
		id: string;
		title: string;
		value: string | null;
	} | null;
}

export function CreateContractModal({
	leadId,
	open,
	onOpenChange,
	onSuccess,
	preselectedOpportunityId,
	contractToEdit,
	opportunityInfo,
}: CreateContractModalProps) {
	const isEditing = !!contractToEdit;

	const [formData, setFormData] = useState({
		contractType: contractToEdit?.contractType || "",
		contractName: contractToEdit?.contractName || "",
		clientSigningLink: contractToEdit?.clientSigningLink || "",
		representativeSigningLink: contractToEdit?.representativeSigningLink || "",
		additionalSigningLinks:
			contractToEdit?.additionalSigningLinks || ([] as string[]),
		opportunityId:
			contractToEdit?.opportunityId || preselectedOpportunityId || "",
	});

	const [newAdditionalLink, setNewAdditionalLink] = useState("");
	const [selectedPdfFile, setSelectedPdfFile] = useState<File | null>(null);

	// Actualizar opportunityId cuando cambia preselectedOpportunityId
	useEffect(() => {
		if (preselectedOpportunityId && !isEditing) {
			setFormData((prev) => ({
				...prev,
				opportunityId: preselectedOpportunityId,
			}));
		}
	}, [preselectedOpportunityId, isEditing]);

	// Actualizar form cuando cambia contractToEdit
	useEffect(() => {
		if (contractToEdit) {
			setFormData({
				contractType: contractToEdit.contractType,
				contractName: contractToEdit.contractName,
				clientSigningLink: contractToEdit.clientSigningLink || "",
				representativeSigningLink:
					contractToEdit.representativeSigningLink || "",
				additionalSigningLinks: contractToEdit.additionalSigningLinks || [],
				opportunityId: contractToEdit.opportunityId || "",
			});
		}
	}, [contractToEdit]);

	// Query opportunities for this lead
	const { data: opportunities, isLoading: isLoadingOpportunities } = useQuery({
		...orpc.getOpportunitiesByLead.queryOptions({ input: { leadId } }),
		enabled: open && !!leadId,
	});

	const createMutation = useMutation({
		mutationFn: async (values: {
			id?: string;
			leadId: string;
			contractType: string;
			contractName: string;
			clientSigningLink?: string;
			representativeSigningLink?: string;
			additionalSigningLinks?: string[];
			opportunityId?: string;
			pdfFile?: {
				name: string;
				type: string;
				size: number;
				key: string;
			};
		}) => {
			if (values.id) {
				// Editar contrato existente
				return await client.updateLegalContract({
					id: values.id,
					contractType: values.contractType,
					contractName: values.contractName,
					clientSigningLink: values.clientSigningLink || null,
					representativeSigningLink: values.representativeSigningLink || null,
					additionalSigningLinks: values.additionalSigningLinks || null,
					pdfFile: values.pdfFile,
				});
			}
			// Crear nuevo contrato
			return await client.createLegalContract(values);
		},
		onSuccess: () => {
			toast.success(
				isEditing
					? "Contrato actualizado exitosamente"
					: "Contrato registrado exitosamente",
			);
			onSuccess?.();
			resetForm();
			onOpenChange(false);
		},
		onError: (error: Error) => {
			toast.error(
				`Error al ${isEditing ? "actualizar" : "registrar"} contrato: ${error.message}`,
			);
		},
	});

	const resetForm = () => {
		setFormData({
			contractType: "",
			contractName: "",
			clientSigningLink: "",
			representativeSigningLink: "",
			additionalSigningLinks: [],
			opportunityId: preselectedOpportunityId || "",
		});
		setNewAdditionalLink("");
		setSelectedPdfFile(null);
		// Reset file input
		const fileInput = document.getElementById(
			"pdf-file-input",
		) as HTMLInputElement;
		if (fileInput) fileInput.value = "";
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

	const handlePdfFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) {
			if (file.size > 10 * 1024 * 1024) {
				toast.error("El archivo debe ser menor a 10MB");
				return;
			}
			if (
				file.type !== "application/pdf" &&
				!file.name.toLowerCase().endsWith(".pdf")
			) {
				toast.error("Solo se permiten archivos PDF");
				return;
			}
			setSelectedPdfFile(file);
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
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
		if (!formData.opportunityId && !isEditing) {
			toast.error("Debe seleccionar una oportunidad para asociar el contrato");
			return;
		}

		// Preparar archivo PDF si existe
		let pdfFileData:
			| { name: string; type: string; size: number; key: string }
			| undefined;
		if (selectedPdfFile) {
			const { key } = await uploadFileToR2WithRetry(selectedPdfFile, {
				resourceType: "legal_contract_pdf",
				resourceId: formData.opportunityId || leadId,
			});
			pdfFileData = {
				name: selectedPdfFile.name,
				type: selectedPdfFile.type,
				size: selectedPdfFile.size,
				key,
			};
		}

		createMutation.mutate({
			...(isEditing && contractToEdit ? { id: contractToEdit.id } : {}),
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
			opportunityId: formData.opportunityId || undefined,
			pdfFile: pdfFileData,
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						{isEditing ? "Editar Contrato" : "Registrar Nuevo Contrato"}
					</DialogTitle>
					<DialogDescription>
						{isEditing
							? "Actualiza la información del contrato legal"
							: "Completa la información del contrato legal generado"}
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="grid gap-4">
						{/* Tipo de contrato */}
						<div className="space-y-2">
							<Label htmlFor="contractType">
								Tipo de contrato <span className="text-red-500">*</span>
							</Label>
							<Select
								value={formData.contractType}
								onValueChange={(value) =>
									setFormData((prev) => ({
										...prev,
										contractType: value,
									}))
								}
								disabled={createMutation.isPending}
							>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="Seleccionar tipo de contrato" />
								</SelectTrigger>
								<SelectContent>
									{CONTRACT_TYPES.map((type) => (
										<SelectItem key={type.enum} value={type.enum}>
											{type.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
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

						{/* Oportunidad asociada */}
						<div className="space-y-2">
							<Label htmlFor="opportunityId">
								Oportunidad Asociada <span className="text-red-500">*</span>
							</Label>
							{isEditing && opportunityInfo ? (
								<div className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
									{opportunityInfo.title} - Q
									{Number.parseFloat(
										opportunityInfo.value || "0",
									).toLocaleString()}
								</div>
							) : (
								<Select
									value={formData.opportunityId}
									onValueChange={(value) =>
										setFormData((prev) => ({
											...prev,
											opportunityId: value === "none" ? "" : value,
										}))
									}
									disabled={createMutation.isPending || isLoadingOpportunities}
								>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Seleccionar oportunidad" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="none">Sin oportunidad</SelectItem>
										{opportunities?.map((opp) => (
											<SelectItem key={opp.id} value={opp.id}>
												{opp.title} - Q
												{Number.parseFloat(opp.value || "0").toLocaleString()}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							)}
							{!isEditing && (
								<p className="text-muted-foreground text-xs">
									El contrato debe estar asociado a una oportunidad
								</p>
							)}
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
											<p className="flex-1 truncate font-mono text-sm">
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

						{/* Subir documento PDF */}
						<div className="space-y-2 rounded-lg border bg-muted/30 p-4">
							<div className="flex items-center gap-2">
								<FileUp className="h-4 w-4 text-muted-foreground" />
								<Label htmlFor="pdf-file-input">
									Subir documento si no se ha generado link o es necesario
								</Label>
							</div>
							<input
								id="pdf-file-input"
								type="file"
								accept=".pdf"
								onChange={handlePdfFileChange}
								className="h-10 w-full rounded-md border bg-background px-3 py-2 text-sm file:border-0 file:bg-transparent file:font-medium file:text-sm"
								disabled={createMutation.isPending}
							/>
							{selectedPdfFile && (
								<div className="flex items-center justify-between rounded-md border border-border bg-muted/50 p-2">
									<p className="text-muted-foreground text-xs">
										Seleccionado: {selectedPdfFile.name} (
										{(selectedPdfFile.size / 1024).toFixed(1)} KB)
									</p>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={() => {
											setSelectedPdfFile(null);
											const fileInput = document.getElementById(
												"pdf-file-input",
											) as HTMLInputElement;
											if (fileInput) fileInput.value = "";
										}}
										disabled={createMutation.isPending}
									>
										<X className="h-4 w-4" />
									</Button>
								</div>
							)}
							{isEditing && contractToEdit?.pdfLink && !selectedPdfFile && (
								<p className="text-muted-foreground text-xs">
									Ya tiene un PDF subido.{" "}
									<a
										href={contractToEdit.pdfLink}
										target="_blank"
										rel="noopener noreferrer"
										className="text-primary underline"
									>
										Ver documento actual
									</a>
								</p>
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
									{isEditing ? "Actualizando..." : "Registrando..."}
								</>
							) : isEditing ? (
								"Actualizar Contrato"
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
