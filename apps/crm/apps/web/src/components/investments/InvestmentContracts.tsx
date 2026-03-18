import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Plus, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadFileToR2WithRetry } from "@/lib/upload-to-r2";
import { client, orpc } from "@/utils/orpc";

interface ContractDoc {
	id: string;
	documentType: string;
	fileUrl: string;
	fileName: string | null;
	status: string;
	createdAt: Date;
}

interface InvestmentContractsProps {
	opportunityId: string;
	investorId?: string;
	documents?: ContractDoc[];
}

export function InvestmentContracts({
	opportunityId,
	investorId,
	documents = [],
}: InvestmentContractsProps) {
	const queryClient = useQueryClient();
	const fileInputRef = useRef<HTMLInputElement>(null);

	const [uploadOpen, setUploadOpen] = useState(false);
	const [contractName, setContractName] = useState("");
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [uploading, setUploading] = useState(false);
	const [uploadProgress, setUploadProgress] = useState(0);

	// Filtrar solo contratos
	const contracts = documents.filter((d) => d.documentType === "contract");

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: orpc.getInvestmentOpportunityById.queryOptions({
				input: { id: opportunityId },
			}).queryKey,
		});

	const uploadMutation = useMutation({
		mutationFn: (data: { fileUrl: string; fileName: string }) => {
			if (!investorId) {
				throw new Error("Se requiere el perfil del inversionista");
			}
			return client.uploadInvestmentDocument({
				investorId,
				investmentOpportunityId: opportunityId,
				documentType: "contract",
				fileUrl: data.fileUrl,
				fileName: data.fileName,
			});
		},
		onSuccess: () => {
			toast.success("Contrato subido exitosamente");
			setUploadOpen(false);
			setSelectedFile(null);
			setContractName("");
			setUploadProgress(0);
			invalidate();
		},
		onError: (error: Error) => {
			toast.error(error.message || "Error al guardar el contrato");
		},
	});

	const handleUpload = async () => {
		if (!contractName.trim()) {
			toast.error("Ingresa el nombre del contrato");
			return;
		}
		if (!selectedFile) {
			toast.error("Selecciona un archivo");
			return;
		}
		if (!investorId) {
			toast.error("Primero crea el perfil del inversionista");
			return;
		}

		setUploading(true);
		setUploadProgress(0);

		try {
			const { key } = await uploadFileToR2WithRetry(
				selectedFile,
				{
					resourceType: "investment_document",
					resourceId: opportunityId,
				},
				{ onProgress: setUploadProgress },
			);

			uploadMutation.mutate({
				fileUrl: key,
				fileName: contractName.trim(),
			});
		} catch {
			toast.error("Error al subir el archivo");
		} finally {
			setUploading(false);
		}
	};

	return (
		<>
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<CardTitle className="flex items-center gap-2 text-lg">
						<FileText className="h-5 w-5" />
						Contratos
					</CardTitle>
					<Button
						size="sm"
						variant="outline"
						onClick={() => {
							setSelectedFile(null);
							setContractName("");
							setUploadProgress(0);
							setUploadOpen(true);
						}}
						disabled={!investorId}
					>
						<Plus className="mr-1 h-4 w-4" />
						Subir contrato
					</Button>
				</CardHeader>
				<CardContent>
					{!investorId && (
						<p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700 text-sm dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
							Primero crea el perfil del inversionista para poder subir
							contratos.
						</p>
					)}

					{contracts.length === 0 && investorId && (
						<p className="py-8 text-center text-muted-foreground text-sm">
							No se han subido contratos aún.
						</p>
					)}

					{contracts.length > 0 && (
						<div className="space-y-3">
							{contracts.map((doc) => (
								<div
									key={doc.id}
									className="flex items-center justify-between gap-3 rounded-lg border p-3"
								>
									<div className="flex min-w-0 items-center gap-3">
										<FileText className="h-5 w-5 shrink-0 text-primary" />
										<div className="min-w-0">
											<p className="truncate font-medium text-sm">
												{doc.fileName ?? "Contrato"}
											</p>
											<p className="text-muted-foreground text-xs">
												{new Date(doc.createdAt).toLocaleDateString("es-GT", {
													day: "2-digit",
													month: "long",
													year: "numeric",
												})}
											</p>
										</div>
									</div>
									{doc.fileUrl.startsWith("http") && (
										<Button
											size="sm"
											variant="ghost"
											className="shrink-0"
											asChild
										>
											<a
												href={doc.fileUrl}
												target="_blank"
												rel="noopener noreferrer"
											>
												Ver
											</a>
										</Button>
									)}
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Upload Dialog */}
			<Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Subir Contrato</DialogTitle>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="contractName">
								Nombre del contrato <span className="text-destructive">*</span>
							</Label>
							<Input
								id="contractName"
								placeholder="Ej: Contrato de inversión, Pagaré, Addendum..."
								value={contractName}
								onChange={(e) => setContractName(e.target.value)}
							/>
						</div>

						<div className="space-y-2">
							<Label>Archivo</Label>
							<input
								ref={fileInputRef}
								type="file"
								accept=".pdf,.jpg,.jpeg,.png,.webp"
								className="hidden"
								onChange={(e) => {
									const file = e.target.files?.[0];
									if (file) {
										if (file.size > 10 * 1024 * 1024) {
											toast.error("El archivo no puede superar 10MB");
											return;
										}
										setSelectedFile(file);
									}
								}}
							/>
							<div
								className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors hover:border-primary/50 hover:bg-muted/50"
								onClick={() => fileInputRef.current?.click()}
								onKeyDown={(e) => {
									if (e.key === "Enter") fileInputRef.current?.click();
								}}
							>
								{selectedFile ? (
									<>
										<FileText className="h-8 w-8 text-primary" />
										<div className="text-center">
											<p className="font-medium text-sm">{selectedFile.name}</p>
											<p className="text-muted-foreground text-xs">
												{(selectedFile.size / 1024 / 1024).toFixed(2)} MB
											</p>
										</div>
									</>
								) : (
									<>
										<Upload className="h-8 w-8 text-muted-foreground" />
										<p className="text-muted-foreground text-sm">
											Haz click para seleccionar un archivo
										</p>
										<p className="text-muted-foreground text-xs">
											PDF, JPG, PNG (máx. 10MB)
										</p>
									</>
								)}
							</div>
						</div>

						{uploading && (
							<div className="space-y-1">
								<div className="flex items-center justify-between text-xs">
									<span className="text-muted-foreground">Subiendo...</span>
									<span className="font-medium">{uploadProgress}%</span>
								</div>
								<div className="h-2 w-full overflow-hidden rounded-full bg-muted">
									<div
										className="h-full rounded-full bg-primary transition-all"
										style={{ width: `${uploadProgress}%` }}
									/>
								</div>
							</div>
						)}
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setUploadOpen(false)}
							disabled={uploading || uploadMutation.isPending}
						>
							Cancelar
						</Button>
						<Button
							onClick={handleUpload}
							disabled={
								uploading ||
								uploadMutation.isPending ||
								!selectedFile ||
								!contractName.trim()
							}
						>
							{uploading || uploadMutation.isPending ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Subiendo...
								</>
							) : (
								"Subir"
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
