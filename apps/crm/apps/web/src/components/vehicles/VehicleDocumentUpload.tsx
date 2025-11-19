import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Loader2, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/utils/orpc";

interface VehicleDocumentUploadProps {
	vehicleId: string;
	ownerType: "individual" | "empresa_individual" | "sociedad_anonima";
}

// Document type labels in Spanish
const documentTypeLabels: Record<string, string> = {
	tarjeta_circulacion: "Tarjeta de Circulación",
	titulo_propiedad: "Título de Propiedad",
	dpi_dueno: "DPI del Dueño",
	patente_comercio_vehiculo: "Patente de Comercio",
	representacion_legal_vehiculo: "Representación Legal",
	dpi_representante_legal_vehiculo: "DPI del Representante Legal",
	pago_impuesto_circulacion: "Comprobante de Pago Impuesto de Circulación",
	consulta_sat: "Captura de Pantalla Consulta SAT",
	consulta_garantias_mobiliarias:
		"Certificación de Garantías Mobiliarias (RGM)",
};

export function VehicleDocumentUpload({
	vehicleId,
	ownerType,
}: VehicleDocumentUploadProps) {
	const [open, setOpen] = useState(false);
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [documentType, setDocumentType] = useState<string>("");
	const [description, setDescription] = useState("");

	const queryClient = useQueryClient();

	// Fetch existing documents
	const { data: documents, isLoading } = useQuery({
		queryKey: ["vehicleDocuments", vehicleId],
		queryFn: async () => {
			return await client.getVehicleDocuments({ vehicleId });
		},
	});

	// Upload mutation
	const uploadMutation = useMutation({
		mutationFn: async (data: {
			file: File;
			documentType: string;
			description?: string;
		}) => {
			const base64 = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onloadend = () => {
					const result = reader.result as string;
					const base64Data = result.split(",")[1];
					resolve(base64Data);
				};
				reader.onerror = reject;
				reader.readAsDataURL(data.file);
			});

			return await client.uploadVehicleDocument({
				vehicleId,
				documentType: data.documentType,
				description: data.description,
				file: {
					name: data.file.name,
					type: data.file.type,
					size: data.file.size,
					data: base64,
				},
			});
		},
		onSuccess: () => {
			toast.success("Documento subido exitosamente");
			queryClient.invalidateQueries({
				queryKey: ["vehicleDocuments", vehicleId],
			});
			setOpen(false);
			setSelectedFile(null);
			setDocumentType("");
			setDescription("");
		},
		onError: (error: Error) => {
			toast.error(`Error al subir documento: ${error.message}`);
		},
	});

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: async (documentId: string) => {
			return await client.deleteVehicleDocument({ documentId });
		},
		onSuccess: () => {
			toast.success("Documento eliminado exitosamente");
			queryClient.invalidateQueries({
				queryKey: ["vehicleDocuments", vehicleId],
			});
		},
		onError: (error: Error) => {
			toast.error(`Error al eliminar documento: ${error.message}`);
		},
	});

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) {
			// Validate file size (10MB max)
			if (file.size > 10 * 1024 * 1024) {
				toast.error("El archivo debe ser menor a 10MB");
				return;
			}
			setSelectedFile(file);
		}
	};

	const handleUpload = () => {
		if (!selectedFile || !documentType) {
			toast.error("Por favor selecciona un archivo y tipo de documento");
			return;
		}

		uploadMutation.mutate({
			file: selectedFile,
			documentType,
			description,
		});
	};

	// Get uploaded document types
	const uploadedTypes = new Set(
		documents?.map((d) => d.documentType) || [],
	);

	return (
		<div className="space-y-4">
			{/* Upload Dialog */}
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogTrigger asChild>
					<Button>
						<FileUp className="mr-2 h-4 w-4" />
						Subir Documento
					</Button>
				</DialogTrigger>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Subir Documento del Vehículo</DialogTitle>
						<DialogDescription>
							Selecciona el tipo de documento y sube el archivo
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						{/* Document Type Select */}
						<div className="space-y-2">
							<Label htmlFor="documentType">Tipo de Documento</Label>
							<Select value={documentType} onValueChange={setDocumentType}>
								<SelectTrigger>
									<SelectValue placeholder="Selecciona tipo de documento" />
								</SelectTrigger>
								<SelectContent>
									{Object.entries(documentTypeLabels).map(([key, label]) => (
										<SelectItem key={key} value={key}>
											{label}
											{uploadedTypes.has(key) && " ✓"}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{/* File Input */}
						<div className="space-y-2">
							<Label htmlFor="file">Archivo</Label>
							<input
								id="file"
								type="file"
								accept=".pdf,.jpg,.jpeg,.png"
								onChange={handleFileChange}
								className="w-full"
							/>
							{selectedFile && (
								<p className="text-muted-foreground text-sm">
									Archivo seleccionado: {selectedFile.name} (
									{(selectedFile.size / 1024).toFixed(2)} KB)
								</p>
							)}
						</div>

						{/* Description */}
						<div className="space-y-2">
							<Label htmlFor="description">Descripción (opcional)</Label>
							<Textarea
								id="description"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder="Agrega una descripción..."
							/>
						</div>

						{/* Upload Button */}
						<Button
							onClick={handleUpload}
							disabled={
								!selectedFile || !documentType || uploadMutation.isPending
							}
							className="w-full"
						>
							{uploadMutation.isPending ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Subiendo...
								</>
							) : (
								"Subir Documento"
							)}
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			{/* Documents List */}
			<div className="space-y-2">
				<h4 className="font-medium text-sm">Documentos Subidos</h4>
				{isLoading ? (
					<div className="flex items-center justify-center py-8">
						<Loader2 className="h-6 w-6 animate-spin" />
					</div>
				) : documents && documents.length > 0 ? (
					<div className="space-y-2">
						{documents.map((doc) => (
							<div
								key={doc.id}
								className="flex items-center justify-between rounded-lg border p-3"
							>
								<div className="flex-1">
									<p className="font-medium text-sm">
										{documentTypeLabels[doc.documentType] || doc.documentType}
									</p>
									<p className="text-muted-foreground text-xs">
										{doc.originalName} •{" "}
										{new Date(doc.uploadedAt).toLocaleDateString()}
									</p>
									{doc.description && (
										<p className="text-muted-foreground text-xs">
											{doc.description}
										</p>
									)}
								</div>
								<div className="flex items-center gap-2">
									<Button variant="outline" size="sm" asChild>
										<a href={doc.url} target="_blank" rel="noopener noreferrer">
											Ver
										</a>
									</Button>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => deleteMutation.mutate(doc.id)}
										disabled={deleteMutation.isPending}
									>
										<Trash2 className="h-4 w-4 text-destructive" />
									</Button>
								</div>
							</div>
						))}
					</div>
				) : (
					<p className="py-4 text-center text-muted-foreground text-sm">
						No hay documentos subidos
					</p>
				)}
			</div>
		</div>
	);
}
