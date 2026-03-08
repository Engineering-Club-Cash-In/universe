import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	FileText,
	FileUp,
	Loader2,
	Trash2,
	Upload,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { getDocumentTypeLabel } from "@/lib/crm-formatters";
import { VEHICLE_DOCUMENT_TYPES } from "@/lib/document-constants";
import { uploadFileToR2WithRetry } from "@/lib/upload-to-r2";
import { client } from "@/utils/orpc";

interface OpportunityDocumentUploadProps {
	opportunityId: string;
	documents: any[];
	isLoading: boolean;
	onRefresh: () => void;
	hasVehicle?: boolean;
}

const documentCategories = {
	"Documentos del Cliente": [
		"dpi",
		"licencia",
		"recibo_luz",
		"recibo_adicional",
		"formularios",
		"estados_cuenta_1",
		"estados_cuenta_2",
		"estados_cuenta_3",
	],
	"Documentos Comerciales": ["patente_comercio", "patente_mercantil"],
	"Documentos Empresariales (S.A.)": [
		"representacion_legal",
		"constitucion_sociedad",
		"iva_1",
		"iva_2",
		"iva_3",
		"estado_financiero",
		"clausula_consentimiento",
		"minutas",
	],
	"Documentos del Vehículo": [
		"tarjeta_circulacion",
		"titulo_propiedad",
		"dpi_dueno",
		"patente_comercio_vehiculo",
		"representacion_legal_vehiculo",
		"dpi_representante_legal_vehiculo",
		"pago_impuesto_circulacion",
		"consulta_sat",
		"consulta_garantias_mobiliarias",
		"datos_vehiculo_nuevo",
		"cotizacion_vehiculo_nuevo",
	],
	"Verificaciones del Cliente": [
		"usuario_sat_cliente",
		"rtu_cliente",
		"omisos_incumplimientos_cliente",
		"infornet",
		"confirmacion_referencias",
		"visita_domiciliar",
		"redes_sociales_internet",
		"enganche",
	],
	"Verificaciones del Vehículo / Propietario": [
		"rtu_propietario",
		"omisos_incumplimientos_propietario",
		"garantia_mobiliaria_sat",
		"garantia_mobiliaria_dpi",
		"garantia_mobiliaria_nit",
		"garantia_mobiliaria_serie",
		"multas_vehiculo",
	],
	"Documentos de Cierre (90%)": [
		"seguro_vehiculo",
		"inscripcion_garantia_mobiliaria",
		"traspaso",
		"documentos_firmados_vendedor",
		"copia_llave",
		"confirmacion_enganche",
		"desembolso",
	],
	Otros: ["detalle_analisis", "other"],
};

export function OpportunityDocumentUpload({
	opportunityId,
	documents,
	isLoading,
	onRefresh,
	hasVehicle = false,
}: OpportunityDocumentUploadProps) {
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [documentType, setDocumentType] = useState<string>("");
	const [includeAll3Months, setIncludeAll3Months] = useState(false);

	// Verificar si el documento seleccionado es de vehículo y no hay vehículo asignado
	const isVehicleDocWithoutVehicle =
		VEHICLE_DOCUMENT_TYPES.includes(
			documentType as (typeof VEHICLE_DOCUMENT_TYPES)[number],
		) && !hasVehicle;

	const queryClient = useQueryClient();

	const uploadedTypes = new Set(
		documents?.map((d: any) => d.documentType) || [],
	);

	// Crear opciones para el combobox
	const documentOptions = useMemo(() => {
		const options: { value: string; label: string }[] = [];
		for (const [_category, types] of Object.entries(documentCategories)) {
			for (const type of types) {
				const label = getDocumentTypeLabel(type);
				options.push({
					value: type,
					label: uploadedTypes.has(type) ? `${label} ✓` : label,
				});
			}
		}
		return options;
	}, [uploadedTypes]);

	const uploadMutation = useMutation({
		mutationFn: async (data: { file: File; documentType: string }) => {
			const { key } = await uploadFileToR2WithRetry(
				data.file,
				{
					resourceType: "opportunity_document",
					resourceId: opportunityId,
				},
			);

			return await client.uploadOpportunityDocument({
				opportunityId,
				documentType: data.documentType as any,
				file: {
					name: data.file.name,
					type: data.file.type,
					size: data.file.size,
					key,
				},
			});
		},
		onSuccess: () => {
			toast.success("Documento subido exitosamente");
			queryClient.invalidateQueries({
				queryKey: ["getOpportunityDocuments", opportunityId],
			});
			onRefresh();
			setSelectedFile(null);
			setDocumentType("");
			const fileInput = document.getElementById(
				"doc-file-input",
			) as HTMLInputElement;
			if (fileInput) fileInput.value = "";
		},
		onError: (error: Error) => {
			toast.error(`Error al subir documento: ${error.message}`);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async (documentId: string) => {
			return await client.deleteOpportunityDocument({ documentId });
		},
		onSuccess: () => {
			toast.success("Documento eliminado exitosamente");
			queryClient.invalidateQueries({
				queryKey: ["getOpportunityDocuments", opportunityId],
			});
			onRefresh();
		},
		onError: (error: Error) => {
			toast.error(`Error al eliminar documento: ${error.message}`);
		},
	});

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) {
			if (file.size > 10 * 1024 * 1024) {
				toast.error("El archivo debe ser menor a 10MB");
				return;
			}
			setSelectedFile(file);
		}
	};

	const handleUpload = () => {
		if (!selectedFile || !documentType) {
			toast.error("Selecciona tipo de documento y archivo");
			return;
		}

		// Si es estado de cuenta y marcó "incluye los 3 meses", subir para los 3 tipos
		if (
			includeAll3Months &&
			["estados_cuenta_1", "estados_cuenta_2", "estados_cuenta_3"].includes(
				documentType,
			)
		) {
			const types = [
				"estados_cuenta_1",
				"estados_cuenta_2",
				"estados_cuenta_3",
			] as const;
			let failed = 0;
			(async () => {
				for (const type of types) {
					try {
						await uploadMutation.mutateAsync({
							file: selectedFile,
							documentType: type,
						});
					} catch {
						failed++;
					}
				}
				if (failed > 0) {
					toast.error(`${failed} de 3 estados de cuenta fallaron al subir`);
				}
				setIncludeAll3Months(false);
			})();
		} else {
			uploadMutation.mutate({ file: selectedFile, documentType });
		}
	};

	return (
		<div className="space-y-6">
			{/* Sección: Subir Documento */}
			<div className="rounded-lg border bg-muted/30 p-4">
				<div className="mb-4 flex items-center gap-2">
					<Upload className="h-4 w-4 text-muted-foreground" />
					<h4 className="font-medium text-sm">Subir Documento</h4>
				</div>

				<div className="space-y-3">
					<div className="grid gap-3 sm:grid-cols-2">
						<div className="space-y-1.5">
							<Label>Tipo de Documento</Label>
							<Combobox
								options={documentOptions}
								value={documentType}
								onChange={setDocumentType}
								placeholder="Buscar tipo de documento..."
								width="full"
								popOverWidth="full"
								isInModal={true}
							/>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="doc-file-input">Archivo</Label>
							<input
								id="doc-file-input"
								type="file"
								accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls"
								onChange={handleFileChange}
								className="h-10 w-full rounded-md border bg-background px-3 py-2 text-sm file:border-0 file:bg-transparent file:font-medium file:text-sm"
							/>
						</div>
					</div>

					{[
						"estados_cuenta_1",
						"estados_cuenta_2",
						"estados_cuenta_3",
					].includes(documentType) && (
						<div className="flex items-center gap-2">
							<Checkbox
								id="include-all-months"
								checked={includeAll3Months}
								onCheckedChange={(checked) =>
									setIncludeAll3Months(checked as boolean)
								}
								className="cursor-pointer"
							/>
							<Label
								htmlFor="include-all-months"
								className="cursor-pointer text-sm"
							>
								Este PDF incluye los 3 meses de estados de cuenta
							</Label>
						</div>
					)}

					{isVehicleDocWithoutVehicle && (
						<Alert variant="default" className="border-amber-500 bg-amber-50">
							<AlertTriangle className="h-4 w-4 text-amber-600" />
							<AlertDescription className="text-amber-800 text-sm">
								Este es un documento de vehículo, pero la oportunidad no tiene
								un vehículo asignado. El documento se guardará en la
								oportunidad, pero no se reflejará en el checklist del vehículo.
							</AlertDescription>
						</Alert>
					)}

					{selectedFile && (
						<p className="text-muted-foreground text-xs">
							Seleccionado: {selectedFile.name} (
							{(selectedFile.size / 1024).toFixed(1)} KB)
						</p>
					)}

					<Button
						onClick={handleUpload}
						disabled={
							!selectedFile || !documentType || uploadMutation.isPending
						}
						size="sm"
					>
						{uploadMutation.isPending ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Subiendo...
							</>
						) : (
							<>
								<FileUp className="mr-2 h-4 w-4" />
								Subir Documento
							</>
						)}
					</Button>
				</div>
			</div>

			{/* Sección: Documentos Subidos */}
			<div>
				<div className="mb-3 flex items-center gap-2">
					<FileText className="h-4 w-4 text-muted-foreground" />
					<h4 className="font-medium text-sm">Documentos Subidos</h4>
					{documents && documents.length > 0 && (
						<span className="text-muted-foreground text-xs">
							({documents.length})
						</span>
					)}
				</div>

				{isLoading ? (
					<div className="flex items-center justify-center py-8">
						<Loader2 className="h-6 w-6 animate-spin" />
					</div>
				) : documents && documents.length > 0 ? (
					<div className="space-y-2">
						{documents.map((doc: any) => (
							<div
								key={doc.id}
								className="flex items-center justify-between rounded-lg border p-3"
							>
								<div className="flex-1">
									<p className="font-medium text-sm">
										{getDocumentTypeLabel(doc.documentType)}
									</p>
									<p className="text-muted-foreground text-xs">
										{doc.originalName || doc.filename} •{" "}
										{new Date(doc.uploadedAt).toLocaleDateString()}
									</p>
								</div>
								<div className="flex items-center gap-2">
									{doc.url && (
										<Button variant="outline" size="sm" asChild>
											<a
												href={doc.url}
												target="_blank"
												rel="noopener noreferrer"
											>
												Ver
											</a>
										</Button>
									)}
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
					<div className="rounded-lg border border-dashed py-8 text-center">
						<p className="text-muted-foreground text-sm">
							No hay documentos subidos
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
