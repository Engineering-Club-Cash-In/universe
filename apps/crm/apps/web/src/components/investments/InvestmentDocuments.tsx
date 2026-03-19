import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	CheckCircle,
	Clock,
	FileText,
	Loader2,
	Upload,
	XCircle,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
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
import { uploadFileToR2WithRetry } from "@/lib/upload-to-r2";
import { client, orpc } from "@/utils/orpc";

const DOC_TYPE_LABELS: Record<string, string> = {
	dpi_front: "DPI (Frente)",
	dpi_back: "DPI (Reverso)",
	income_form: "Formulario de Ingresos",
	fund_declaration: "Declaración de Fondos",
	utility_bill: "Recibo de Servicios",
	bank_statement: "Estado de Cuenta",
	investment_receipt: "Comprobante de Inversión",
	other: "Otro",
};

const ALL_DOC_TYPES = Object.keys(DOC_TYPE_LABELS) as Array<
	keyof typeof DOC_TYPE_LABELS
>;

type DocumentStatus = "pending" | "approved" | "rejected" | "not_uploaded";

interface DocumentItem {
	id: string;
	documentType: string;
	fileUrl: string;
	fileName: string | null;
	status: string;
	reviewedBy: string | null;
	reviewedAt: Date | null;
	rejectionReason: string | null;
	createdAt: Date;
}

interface InvestmentDocumentsProps {
	opportunityId: string;
	investorId?: string;
	documents?: DocumentItem[];
	canReview?: boolean;
}

function getStatusBadge(status: DocumentStatus) {
	switch (status) {
		case "approved":
			return (
				<Badge className="bg-green-100 text-green-800 hover:bg-green-100">
					<CheckCircle className="mr-1 h-3 w-3" />
					Aprobado
				</Badge>
			);
		case "rejected":
			return (
				<Badge className="bg-red-100 text-red-800 hover:bg-red-100">
					<XCircle className="mr-1 h-3 w-3" />
					Rechazado
				</Badge>
			);
		case "pending":
			return (
				<Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
					<Clock className="mr-1 h-3 w-3" />
					Pendiente
				</Badge>
			);
		default:
			return (
				<Badge className="bg-gray-100 text-gray-500 hover:bg-gray-100">
					Sin subir
				</Badge>
			);
	}
}

export function InvestmentDocuments({
	opportunityId,
	investorId,
	documents = [],
	canReview = false,
}: InvestmentDocumentsProps) {
	const queryClient = useQueryClient();
	const fileInputRef = useRef<HTMLInputElement>(null);

	// Upload dialog state
	const [uploadOpen, setUploadOpen] = useState(false);
	const [uploadDocType, setUploadDocType] = useState<string>("");
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [uploading, setUploading] = useState(false);
	const [uploadProgress, setUploadProgress] = useState(0);

	// Rejection dialog state
	const [rejectOpen, setRejectOpen] = useState(false);
	const [rejectDocId, setRejectDocId] = useState<string>("");
	const [rejectReason, setRejectReason] = useState("");

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: orpc.getInvestmentOpportunityById.queryOptions({
				input: { id: opportunityId },
			}).queryKey,
		});

	const uploadMutation = useMutation({
		mutationFn: (data: {
			documentType: string;
			fileUrl: string;
			fileName?: string;
			mimeType?: string;
		}) => {
			if (!investorId) {
				throw new Error(
					"Se requiere el ID del inversionista para subir documentos",
				);
			}
			return client.uploadInvestmentDocument({
				investorId,
				investmentOpportunityId: opportunityId,
				documentType: data.documentType as
					| "dpi_front"
					| "dpi_back"
					| "income_form"
					| "fund_declaration"
					| "utility_bill"
					| "bank_statement"
					| "investment_receipt"
					| "other",
				fileUrl: data.fileUrl,
				fileName: data.fileName || undefined,
				mimeType: data.mimeType || undefined,
			});
		},
		onSuccess: () => {
			toast.success("Documento subido exitosamente");
			setUploadOpen(false);
			setSelectedFile(null);
			setUploadDocType("");
			setUploadProgress(0);
			invalidate();
		},
		onError: (error: Error) => {
			toast.error(error.message || "Error al subir el documento");
		},
	});

	const approveMutation = useMutation({
		mutationFn: (documentId: string) =>
			client.reviewInvestmentDocument({
				documentId,
				status: "approved",
			}),
		onSuccess: () => {
			toast.success("Documento aprobado");
			invalidate();
		},
		onError: (error: Error) => {
			toast.error(error.message || "Error al aprobar el documento");
		},
	});

	const rejectMutation = useMutation({
		mutationFn: (data: { documentId: string; rejectionReason: string }) =>
			client.reviewInvestmentDocument({
				documentId: data.documentId,
				status: "rejected",
				rejectionReason: data.rejectionReason,
			}),
		onSuccess: () => {
			toast.success("Documento rechazado");
			setRejectOpen(false);
			setRejectReason("");
			setRejectDocId("");
			invalidate();
		},
		onError: (error: Error) => {
			toast.error(error.message || "Error al rechazar el documento");
		},
	});

	const handleUpload = async () => {
		if (!uploadDocType) {
			toast.error("Selecciona el tipo de documento");
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
			// 1. Subir a R2
			const { key } = await uploadFileToR2WithRetry(
				selectedFile,
				{
					resourceType: "investment_document",
					resourceId: opportunityId,
				},
				{ onProgress: setUploadProgress },
			);

			// 2. Guardar referencia en DB
			uploadMutation.mutate({
				documentType: uploadDocType,
				fileUrl: key,
				fileName: selectedFile.name,
				mimeType: selectedFile.type,
			});
		} catch (error) {
			toast.error("Error al subir el archivo");
		} finally {
			setUploading(false);
		}
	};

	const handleReject = () => {
		if (!rejectReason.trim()) {
			toast.error("Ingresa el motivo de rechazo");
			return;
		}
		rejectMutation.mutate({
			documentId: rejectDocId,
			rejectionReason: rejectReason.trim(),
		});
	};

	const openRejectDialog = (docId: string) => {
		setRejectDocId(docId);
		setRejectReason("");
		setRejectOpen(true);
	};

	const openUploadDialog = (docType?: string) => {
		setUploadDocType(docType ?? "");
		setSelectedFile(null);
		setUploadProgress(0);
		setUploadOpen(true);
	};

	// Build map of doc type -> uploaded documents
	const docsByType = documents.reduce<Record<string, DocumentItem[]>>(
		(acc, doc) => {
			if (!acc[doc.documentType]) acc[doc.documentType] = [];
			acc[doc.documentType].push(doc);
			return acc;
		},
		{},
	);

	const approvedCount = documents.filter((d) => d.status === "approved").length;
	const totalUploaded = documents.length;

	return (
		<>
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<CardTitle className="flex items-center gap-2 text-lg">
						<FileText className="h-5 w-5" />
						Documentos
					</CardTitle>
					<div className="flex items-center gap-3">
						<span className="text-muted-foreground text-sm">
							{approvedCount} / {ALL_DOC_TYPES.length} aprobados
						</span>
						<Button
							size="sm"
							variant="outline"
							onClick={() => openUploadDialog()}
							disabled={!investorId}
						>
							<Upload className="mr-1 h-4 w-4" />
							Subir documento
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{!investorId && (
						<p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700 text-sm dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
							Primero crea el perfil del inversionista para poder subir
							documentos.
						</p>
					)}
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						{ALL_DOC_TYPES.map((docType) => {
							const uploaded = docsByType[docType] ?? [];
							const latestDoc = uploaded[0] ?? null;
							const status: DocumentStatus = latestDoc
								? (latestDoc.status as DocumentStatus)
								: "not_uploaded";

							return (
								<div
									key={docType}
									className="flex flex-col gap-2 rounded-lg border p-3"
								>
									<div className="flex items-start justify-between gap-2">
										<div className="min-w-0 flex-1">
											<p className="truncate font-medium text-sm">
												{DOC_TYPE_LABELS[docType]}
											</p>
											{latestDoc?.fileName && (
												<p className="truncate text-muted-foreground text-xs">
													{latestDoc.fileName}
												</p>
											)}
											{latestDoc?.rejectionReason && status === "rejected" && (
												<p className="mt-1 text-red-600 text-xs">
													Motivo: {latestDoc.rejectionReason}
												</p>
											)}
											{latestDoc?.reviewedAt && (
												<p className="text-muted-foreground text-xs">
													{new Date(latestDoc.reviewedAt).toLocaleDateString(
														"es-GT",
													)}
												</p>
											)}
										</div>
										<div className="shrink-0">{getStatusBadge(status)}</div>
									</div>

									<div className="flex flex-wrap gap-2">
										{!latestDoc && investorId && (
											<Button
												size="sm"
												variant="outline"
												className="h-7 text-xs"
												onClick={() => openUploadDialog(docType)}
											>
												<Upload className="mr-1 h-3 w-3" />
												Subir
											</Button>
										)}

										{latestDoc && status === "rejected" && (
											<Button
												size="sm"
												variant="outline"
												className="h-7 text-xs"
												onClick={() => openUploadDialog(docType)}
											>
												<Upload className="mr-1 h-3 w-3" />
												Volver a subir
											</Button>
										)}

										{latestDoc && latestDoc.fileUrl.startsWith("http") && (
											<Button
												size="sm"
												variant="ghost"
												className="h-7 text-xs"
												asChild
											>
												<a
													href={latestDoc.fileUrl}
													target="_blank"
													rel="noopener noreferrer"
												>
													Ver archivo
												</a>
											</Button>
										)}

										{canReview && latestDoc && status === "pending" && (
											<>
												<Button
													size="sm"
													className="h-7 bg-green-600 text-white text-xs hover:bg-green-700"
													onClick={() => approveMutation.mutate(latestDoc.id)}
													disabled={approveMutation.isPending}
												>
													Aprobar
												</Button>
												<Button
													size="sm"
													variant="destructive"
													className="h-7 text-xs"
													onClick={() => openRejectDialog(latestDoc.id)}
												>
													Rechazar
												</Button>
											</>
										)}
									</div>
								</div>
							);
						})}
					</div>

					{totalUploaded === 0 && investorId && (
						<p className="mt-4 text-center text-muted-foreground text-sm">
							No se han subido documentos aún.
						</p>
					)}
				</CardContent>
			</Card>

			{/* Upload Dialog */}
			<Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Subir Documento</DialogTitle>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="docType">Tipo de Documento</Label>
							<Select value={uploadDocType} onValueChange={setUploadDocType}>
								<SelectTrigger>
									<SelectValue placeholder="Selecciona el tipo" />
								</SelectTrigger>
								<SelectContent>
									{ALL_DOC_TYPES.map((type) => (
										<SelectItem key={type} value={type}>
											{DOC_TYPE_LABELS[type]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
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
							disabled={uploading || uploadMutation.isPending || !selectedFile}
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

			{/* Rejection Dialog */}
			<Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Rechazar Documento</DialogTitle>
					</DialogHeader>
					<div className="space-y-2">
						<Label htmlFor="rejectReason">Motivo de Rechazo</Label>
						<Textarea
							id="rejectReason"
							placeholder="Describe el motivo por el que se rechaza el documento..."
							rows={3}
							value={rejectReason}
							onChange={(e) => setRejectReason(e.target.value)}
						/>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setRejectOpen(false)}
							disabled={rejectMutation.isPending}
						>
							Cancelar
						</Button>
						<Button
							variant="destructive"
							onClick={handleReject}
							disabled={rejectMutation.isPending}
						>
							{rejectMutation.isPending ? "Rechazando..." : "Rechazar"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
