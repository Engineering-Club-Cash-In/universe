import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	AlertTriangle,
	ChevronDown,
	ChevronUp,
	FileText,
	History,
	Loader2,
	RotateCcw,
	ShieldCheck,
	Trash2,
	Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ManualDocumentApproval } from "@/components/credit/ManualDocumentApprovalButton";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	getReusableBatchSyncAction,
	hasCompleteIntegrityValidation,
	type IntegrityResult,
	requiresManualApproval,
} from "@/lib/document-integrity-flow";
import { uploadFileToR2WithRetry } from "@/lib/upload-to-r2";
import { client, orpc } from "@/utils/orpc";

const MAX_AI_ATTEMPTS = 2;

function isPdfFile(file: File) {
	return (
		file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
	);
}

interface BankStatementAnalysisProps {
	leadId?: string;
	coDebtorId?: string;
	opportunityId?: string;
	onAnalysisComplete?: () => void;
}

interface ValidatedUploadBatch {
	payloads: Array<{ name: string; key: string; mimeType: string }>;
	results: Array<{
		file: string;
		error?: string;
		validation: {
			id: string;
			result: IntegrityResult;
			reason: string;
			recommendedAction: string;
			validatedAt: Date;
			manualApproval: ManualDocumentApproval | null;
		} | null;
	}>;
}

const INTEGRITY_META: Record<
	IntegrityResult,
	{ label: string; className: string }
> = {
	valido: { label: "Válido", className: "bg-green-100 text-green-800" },
	observacion: {
		label: "Con observación",
		className: "bg-amber-100 text-amber-800",
	},
	revision_manual: {
		label: "Revisión manual",
		className: "bg-blue-100 text-blue-800",
	},
	rechazado: { label: "Rechazado", className: "bg-red-100 text-red-800" },
	error: { label: "Error", className: "bg-gray-100 text-gray-800" },
};

export function BankStatementAnalysis({
	leadId,
	coDebtorId,
	opportunityId,
	onAnalysisComplete,
}: BankStatementAnalysisProps) {
	const [files, setFiles] = useState<File[]>([]);
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [annualRate, setAnnualRate] = useState("0.18");
	const [termMonths, setTermMonths] = useState("60");
	const [maxDebtRatio, setMaxDebtRatio] = useState("0.2");
	const [maxVariableDebtRatio, setMaxVariableDebtRatio] = useState("0.2");
	const [validatedBatch, setValidatedBatch] =
		useState<ValidatedUploadBatch | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const queryClient = useQueryClient();
	const hasOwner = !!coDebtorId || !!(leadId && opportunityId);
	const ownerInput =
		leadId && opportunityId
			? { leadId, opportunityId }
			: coDebtorId
				? { coDebtorId }
				: null;

	const queryKey = leadId
		? ["creditAnalysis", "opportunity", opportunityId]
		: ["creditAnalysis", "coDebtor", coDebtorId];

	// Obtener estado del análisis desde el servidor
	const { data: existingAnalysis, isLoading: isLoadingAnalysis } = useQuery({
		queryKey,
		queryFn: () => {
			if (!ownerInput) throw new Error("Falta el propietario del análisis.");
			return client.getCreditAnalysisByLeadId(ownerInput);
		},
		enabled: hasOwner,
	});

	// Verificar si hay un análisis exitoso (analyzedAt debe existir y no ser null)
	const hasSuccessfulAnalysis =
		existingAnalysis != null && existingAnalysis.analyzedAt != null;
	const attemptCount = existingAnalysis?.attemptCount ?? 0;
	const canAnalyze = !hasSuccessfulAnalysis && attemptCount < MAX_AI_ATTEMPTS;
	const integrityAttemptQuery = useQuery({
		...orpc.getDocumentIntegrityAttemptStatus.queryOptions({
			input: { opportunityId: opportunityId ?? "" },
		}),
		enabled: !!leadId && !!opportunityId,
	});
	const canValidateIntegrity = integrityAttemptQuery.data?.canValidate ?? false;
	const latestValidatedRunQuery = useQuery({
		...orpc.getLatestReusableDocumentIntegrityRun.queryOptions({
			input: { opportunityId: opportunityId ?? "" },
		}),
		enabled:
			!!leadId &&
			!!opportunityId &&
			!isLoadingAnalysis &&
			!hasSuccessfulAnalysis,
	});
	const restoredRunIdRef = useRef<string | undefined>(undefined);
	const previousOpportunityIdRef = useRef(opportunityId);
	useEffect(() => {
		if (previousOpportunityIdRef.current !== opportunityId) {
			setFiles([]);
			setValidatedBatch(null);
			restoredRunIdRef.current = undefined;
			previousOpportunityIdRef.current = opportunityId;
		}
	}, [opportunityId]);
	const reusableRunRef = useRef(latestValidatedRunQuery.data);
	reusableRunRef.current = latestValidatedRunQuery.data;
	const reusableRunId = latestValidatedRunQuery.data?.runId;
	const approvalKey = latestValidatedRunQuery.data?.results
		.map((result) => result.validation?.manualApproval?.id ?? "")
		.join("|");
	useEffect(() => {
		const reusableRun = reusableRunRef.current;
		const reusableRunApprovalKey = reusableRun?.results
			.map((result) => result.validation?.manualApproval?.id ?? "")
			.join("|");
		const action = getReusableBatchSyncAction({
			reusableRunId,
			reusableOpportunityId: reusableRun?.opportunityId,
			currentOpportunityId: opportunityId,
			restoredRunId: restoredRunIdRef.current,
		});
		if (
			action === "restore" &&
			reusableRun &&
			reusableRunApprovalKey === approvalKey
		) {
			restoredRunIdRef.current = reusableRun.runId;
			setValidatedBatch(reusableRun);
		} else if (action === "clear_restored") {
			restoredRunIdRef.current = undefined;
			setValidatedBatch(null);
		}
	}, [reusableRunId, approvalKey, opportunityId]);

	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const canViewIntegrityDetail = [
		"admin",
		"analyst",
		"sales",
		"sales_supervisor",
	].includes(userProfile.data?.role ?? "");
	const canApproveIntegrityDocuments =
		userProfile.data?.role === "admin" ||
		userProfile.data?.role === "sales_supervisor";
	const canReset =
		userProfile.data?.role === "admin" ||
		userProfile.data?.role === "sales_supervisor" ||
		userProfile.data?.role === "analyst";

	const resetMutation = useMutation({
		mutationFn: () => {
			if (!ownerInput) throw new Error("Falta el propietario del análisis.");
			return client.resetCreditAnalysis(ownerInput);
		},
		onSuccess: () => {
			toast.success(
				"Análisis reseteado. Puede volver a subir estados de cuenta.",
			);
			queryClient.invalidateQueries({ queryKey });
			if (opportunityId) {
				queryClient.invalidateQueries({
					queryKey: ["getAnalysisChecklist", opportunityId],
				});
				queryClient.invalidateQueries({
					queryKey: ["consolidatedCreditAnalysis", opportunityId],
				});
				queryClient.invalidateQueries({
					queryKey: ["getConsolidatedCreditAnalysis", opportunityId],
				});
			}
			onAnalysisComplete?.();
		},
		onError: (error) => {
			toast.error(`Error al resetear: ${error.message}`);
		},
	});
	const resetIntegrityMutation = useMutation({
		mutationFn: () => {
			if (!opportunityId) throw new Error("Falta la oportunidad.");
			return client.resetDocumentIntegrityAttempts({ opportunityId });
		},
		onSuccess: () => {
			setFiles([]);
			setValidatedBatch(null);
			restoredRunIdRef.current = undefined;
			toast.success(
				"Cupo de validaciones reiniciado. Hay 2 validaciones disponibles.",
			);
			queryClient.invalidateQueries({
				queryKey: orpc.getDocumentIntegrityAttemptStatus.key(),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getLatestReusableDocumentIntegrityRun.key(),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getDocumentIntegrityStatus.key(),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.listDocumentIntegrityValidations.key(),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getDocumentIntegrityValidationGroup.key(),
			});
		},
		onError: (error) => {
			toast.error(`Error al reiniciar validaciones: ${error.message}`);
		},
	});

	const validationMutation = useMutation({
		mutationFn: async () => {
			if (!(leadId && opportunityId)) {
				throw new Error("Falta la oportunidad que se debe validar.");
			}
			const filePayloads = await Promise.all(
				files.map(async (file) => {
					const { key } = await uploadFileToR2WithRetry(file, {
						resourceType: "bank_statement",
						resourceId: opportunityId,
					});
					return {
						name: file.name,
						key,
						mimeType: file.type || "application/pdf",
					};
				}),
			);
			const results = await client.validarDocumentosSubidos({
				leadId,
				opportunityId,
				files: filePayloads,
			});
			return { payloads: filePayloads, results } as ValidatedUploadBatch;
		},
		onSuccess: (batch) => {
			restoredRunIdRef.current = undefined;
			setValidatedBatch(batch);
			toast.success("Validación documental completada");
			queryClient.invalidateQueries({
				queryKey: orpc.getDocumentIntegrityAttemptStatus.key(),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getLatestReusableDocumentIntegrityRun.key(),
			});
		},
		onError: (error) => {
			toast.error(`Error al validar: ${error.message}`);
			queryClient.invalidateQueries({
				queryKey: orpc.getDocumentIntegrityAttemptStatus.key(),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getLatestReusableDocumentIntegrityRun.key(),
			});
		},
	});

	const analyzeMutation = useMutation({
		mutationFn: async () => {
			if (!ownerInput) throw new Error("Falta el propietario del análisis.");
			const filePayloads = leadId
				? validatedBatch?.payloads
				: await Promise.all(
						files.map(async (file) => {
							if (!coDebtorId) throw new Error("Falta el codeudor.");
							const { key } = await uploadFileToR2WithRetry(file, {
								resourceType: "bank_statement",
								resourceId: coDebtorId,
							});
							return {
								name: file.name,
								key,
								mimeType: file.type || "application/pdf",
							};
						}),
					);
			if (!filePayloads)
				throw new Error("Valida los documentos antes de analizarlos.");
			const integrityValidationIds = validatedBatch?.results.flatMap(
				(result) => (result.validation ? [result.validation.id] : []),
			);

			return client.analyzeBankStatements({
				...ownerInput,
				files: filePayloads,
				...(leadId ? { integrityValidationIds } : {}),
				annualRate: Number.parseFloat(annualRate),
				termMonths: Number.parseInt(termMonths, 10),
				maxDebtRatio: Number.parseFloat(maxDebtRatio),
				maxVariableDebtRatio: Number.parseFloat(maxVariableDebtRatio),
			});
		},
		onSuccess: () => {
			toast.success("Análisis completado exitosamente");
			setFiles([]);
			setValidatedBatch(null);
			// Invalidar query para obtener estado actualizado del servidor
			queryClient.invalidateQueries({ queryKey });
			if (opportunityId) {
				queryClient.invalidateQueries({
					queryKey: ["getAnalysisChecklist", opportunityId],
				});
				queryClient.invalidateQueries({
					queryKey: ["consolidatedCreditAnalysis", opportunityId],
				});
				queryClient.invalidateQueries({
					queryKey: ["getConsolidatedCreditAnalysis", opportunityId],
				});
				queryClient.invalidateQueries({
					queryKey: ["getOpportunityDocuments", opportunityId],
				});
			}
			onAnalysisComplete?.();
		},
		onError: (error) => {
			toast.error(`Error al analizar: ${error.message}`);
			// Invalidar query para obtener el contador actualizado
			queryClient.invalidateQueries({ queryKey });
		},
	});

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const selectedFiles = Array.from(e.target.files || []);
		const pdfFiles = selectedFiles.filter(isPdfFile);

		if (pdfFiles.length !== selectedFiles.length) {
			toast.warning("Solo se permiten archivos PDF");
		}

		const totalFiles = files.length + pdfFiles.length;
		if (totalFiles > 9) {
			toast.warning("Máximo 9 archivos permitidos");
			const allowed = pdfFiles.slice(0, 9 - files.length);
			setFiles((prev) => [...prev, ...allowed]);
		} else {
			setFiles((prev) => [...prev, ...pdfFiles]);
		}
		setValidatedBatch(null);

		if (fileInputRef.current) {
			fileInputRef.current.value = "";
		}
	};

	const removeFile = (index: number) => {
		setFiles((prev) => prev.filter((_, i) => i !== index));
		setValidatedBatch(null);
	};
	const hasRejectedDocument = validatedBatch?.results.some(
		(result) => result.validation?.result === "rechazado",
	);
	const allDocumentsValidated = hasCompleteIntegrityValidation(validatedBatch);
	const hasPendingManualApproval = validatedBatch?.results.some(
		(result) =>
			!!result.validation &&
			requiresManualApproval(result.validation.result) &&
			!result.validation.manualApproval,
	);
	const hasIncompleteValidation = !!validatedBatch && !allDocumentsValidated;
	const activeFileCount = validatedBatch?.payloads.length ?? files.length;
	const isBusy =
		validationMutation.isPending ||
		analyzeMutation.isPending ||
		resetIntegrityMutation.isPending;
	const hasIntegrityLookupError =
		!!leadId &&
		!!opportunityId &&
		!validatedBatch &&
		(integrityAttemptQuery.isError || latestValidatedRunQuery.isError);
	const isRetryingIntegrityLookup =
		integrityAttemptQuery.isFetching || latestValidatedRunQuery.isFetching;
	const isRestoringValidation =
		latestValidatedRunQuery.isLoading || hasIntegrityLookupError;

	return (
		<Card className="border-dashed">
			<CardHeader className="pb-3">
				<CardTitle className="font-medium text-sm">
					{leadId && !hasSuccessfulAnalysis && !validatedBatch
						? "Validación de Estados de Cuenta"
						: "Análisis de Estados de Cuenta"}
				</CardTitle>
				<CardDescription className="text-xs">
					{leadId && !hasSuccessfulAnalysis && !validatedBatch
						? "Suba de 1 a 9 estados de cuenta bancarios en PDF para evaluar su legitimidad y legibilidad."
						: hasSuccessfulAnalysis
							? "El análisis de capacidad de pago ya fue completado."
							: "Los documentos ya fueron validados. Revise el resultado y decida si desea continuar con el análisis de capacidad de pago."}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{leadId && !opportunityId && (
					<p className="text-amber-700 text-xs">
						Seleccione una oportunidad para consultar o crear su análisis.
					</p>
				)}
				{leadId && !hasSuccessfulAnalysis && !validatedBatch && (
					<div className="flex gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-blue-900 text-xs">
						<ShieldCheck className="h-4 w-4 shrink-0" />
						<span>
							Se evaluará la legitimidad y legibilidad de los documentos antes
							de habilitar el análisis de capacidad de pago.
						</span>
					</div>
				)}
				{leadId &&
					opportunityId &&
					!hasSuccessfulAnalysis &&
					hasIntegrityLookupError && (
						<div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 text-xs">
							<div className="flex gap-2">
								<AlertTriangle className="h-4 w-4 shrink-0" />
								<span>
									No se pudo consultar la validación documental vigente. Reintenta
									antes de cargar o validar documentos nuevos.
								</span>
							</div>
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={isRetryingIntegrityLookup}
								onClick={() => {
									void Promise.all([
										integrityAttemptQuery.refetch(),
										latestValidatedRunQuery.refetch(),
									]);
								}}
							>
								{isRetryingIntegrityLookup && (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								)}
								Reintentar consulta
							</Button>
						</div>
					)}
				{leadId && opportunityId && integrityAttemptQuery.data && (
					<div className="flex flex-wrap items-center justify-between gap-2">
						<p className="text-muted-foreground text-xs">
							Validaciones documentales utilizadas:{" "}
							{integrityAttemptQuery.data.attemptCount}/
							{integrityAttemptQuery.data.maxAttempts}
						</p>
						{integrityAttemptQuery.data.attemptCount > 0 &&
							canViewIntegrityDetail && (
								<Button asChild size="sm" variant="outline">
									<Link
										to="/crm/documentacion/estados-cuenta"
										search={{ opportunityId }}
									>
										<History className="mr-2 h-4 w-4" />
										Ver historial de validación
									</Link>
								</Button>
							)}
					</div>
				)}
				{leadId &&
					opportunityId &&
					!hasSuccessfulAnalysis &&
					integrityAttemptQuery.data &&
					!integrityAttemptQuery.data.canValidate &&
					!integrityAttemptQuery.data.hasProcessingRun &&
					canReset && (
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="w-full text-destructive hover:text-destructive"
									disabled={isBusy || hasIntegrityLookupError}
								>
									<RotateCcw className="mr-2 h-4 w-4" />
									Resetear validaciones documentales
								</Button>
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>
										¿Reiniciar el cupo de validaciones?
									</AlertDialogTitle>
									<AlertDialogDescription>
										El historial se conservará y se habilitarán 2 validaciones
										documentales nuevas.
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>Cancelar</AlertDialogCancel>
									<AlertDialogAction
										onClick={() => resetIntegrityMutation.mutate()}
										className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
									>
										Reiniciar cupo
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					)}
				{leadId &&
					opportunityId &&
					!hasSuccessfulAnalysis &&
					!validatedBatch &&
					!canValidateIntegrity && (
						<div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-800 text-xs">
							<AlertTriangle className="h-4 w-4 shrink-0" />
							<span>
								Esta oportunidad alcanzó el límite de validaciones documentales.
							</span>
						</div>
					)}
				{/* File input */}
				<div className={hasSuccessfulAnalysis ? "hidden" : undefined}>
					<input
						ref={fileInputRef}
						type="file"
						accept=".pdf,application/pdf"
						multiple
						className="hidden"
						onChange={handleFileChange}
						disabled={
							files.length >= 9 ||
							isBusy ||
							isRestoringValidation ||
							(!!leadId && !canValidateIntegrity)
						}
					/>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="w-full"
						onClick={() => fileInputRef.current?.click()}
						disabled={
							files.length >= 9 ||
							isBusy ||
							isRestoringValidation ||
							(!!leadId && !canValidateIntegrity)
						}
					>
						<Upload className="mr-2 h-4 w-4" />
						Seleccionar PDFs ({files.length}/9)
					</Button>
				</div>

				{/* File list */}
				{!hasSuccessfulAnalysis && files.length > 0 && (
					<div className="space-y-1.5">
						{files.map((file, index) => (
							<div
								key={`${file.name}-${index}`}
								className="flex items-center justify-between rounded-md border bg-muted/50 px-3 py-1.5 text-sm"
							>
								<div className="flex items-center gap-2 truncate">
									<FileText className="h-4 w-4 shrink-0 text-red-500" />
									<span className="truncate">{file.name}</span>
									<span className="shrink-0 text-muted-foreground text-xs">
										({(file.size / 1024).toFixed(0)} KB)
									</span>
								</div>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-6 w-6 p-0"
									onClick={() => removeFile(index)}
									disabled={isBusy}
								>
									<Trash2 className="h-3.5 w-3.5 text-destructive" />
								</Button>
							</div>
						))}
					</div>
				)}

				{leadId && !hasSuccessfulAnalysis && !validatedBatch && (
					<Button
						type="button"
						size="sm"
						className="w-full"
						onClick={() => validationMutation.mutate()}
						disabled={
							isLoadingAnalysis ||
							files.length === 0 ||
							isBusy ||
							!hasOwner ||
							!canValidateIntegrity ||
							integrityAttemptQuery.isLoading ||
							isRestoringValidation
						}
					>
						{validationMutation.isPending ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Validando documentos…
							</>
						) : (
							"Validar documentos"
						)}
					</Button>
				)}

				{validatedBatch && (
					<div className="space-y-2 rounded-md border p-3">
						{validatedBatch.results.map((result) => {
							const status = result.validation?.result ?? "error";
							const meta =
								status === "revision_manual" &&
								result.validation?.manualApproval
									? {
											label: "Aprobado manualmente",
											className: "bg-green-100 text-green-800",
										}
									: INTEGRITY_META[status];
							return (
								<div key={result.file} className="space-y-1 text-xs">
									<div className="flex items-center justify-between gap-2">
										<span className="truncate font-medium">{result.file}</span>
										<Badge className={meta.className}>{meta.label}</Badge>
									</div>
									<p className="text-muted-foreground">
										{result.validation?.reason ??
											result.error ??
											"No se pudo validar el archivo."}
									</p>
									{result.validation?.recommendedAction && (
										<p className="text-foreground">
											<span className="font-medium">Recomendación:</span>{" "}
											{result.validation.recommendedAction}
										</p>
									)}
									{result.validation &&
										(result.validation.result === "rechazado" ||
											(requiresManualApproval(result.validation.result) &&
												!result.validation.manualApproval)) && (
											<Button asChild size="sm" variant="outline">
												<Link
													to="/crm/documentacion/estados-cuenta"
													search={{
														opportunityId,
														validationId: result.validation.id,
													}}
												>
													{result.validation.result === "rechazado"
														? "Ver rechazo"
														: canApproveIntegrityDocuments
															? "Revisar y aprobar"
															: "Revisar documento"}
												</Link>
											</Button>
										)}
								</div>
							);
						})}
					</div>
				)}

				{leadId && hasIncompleteValidation && (
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="w-full"
						disabled={isBusy || !canValidateIntegrity}
						onClick={() => setValidatedBatch(null)}
					>
						Cambiar documentos o volver a validar
					</Button>
				)}

				{hasRejectedDocument && (
					<div className="flex gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-red-800 text-xs">
						<AlertTriangle className="h-4 w-4 shrink-0" />
						<span>
							Uno o más archivos fueron rechazados. Solicita documentos válidos
							y realiza una nueva validación antes de continuar.
						</span>
					</div>
				)}
				{hasPendingManualApproval && (
					<div className="flex gap-2 rounded-md border border-blue-300 bg-blue-50 p-3 text-blue-800 text-xs">
						<AlertTriangle className="h-4 w-4 shrink-0" />
						<span>
							El análisis de capacidad de pago permanecerá bloqueado hasta que
							se aprueben todos los documentos pendientes de revisión manual.
						</span>
					</div>
				)}

				{validatedBatch && (
					<div className="border-t pt-3">
						<p className="font-medium text-sm">Análisis de capacidad de pago</p>
						<p className="text-muted-foreground text-xs">
							{hasRejectedDocument
								? "Hay documentos rechazados. Reemplázalos y realiza una nueva validación documental."
								: hasPendingManualApproval
									? "Hay documentos pendientes de aprobación manual."
									: "La validación documental terminó. Puede continuar con estos archivos o solicitar documentos nuevos."}
						</p>
					</div>
				)}

				{/* Advanced options */}
				{(!leadId || validatedBatch) && (
					<button
						type="button"
						className="flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
						onClick={() => setShowAdvanced(!showAdvanced)}
					>
						{showAdvanced ? (
							<ChevronUp className="h-3 w-3" />
						) : (
							<ChevronDown className="h-3 w-3" />
						)}
						Opciones avanzadas
					</button>
				)}

				{(!leadId || validatedBatch) && showAdvanced && (
					<div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/30 p-3">
						<div className="space-y-1">
							<Label className="text-xs">Plazo (meses)</Label>
							<Input
								type="number"
								min="12"
								max="120"
								value={termMonths}
								onChange={(e) => setTermMonths(e.target.value)}
								className="h-8 text-sm"
							/>
						</div>
						<div className="space-y-1">
							<Label className="text-xs">Tasa anual</Label>
							<Input
								type="number"
								step="0.01"
								min="0"
								max="1"
								value={annualRate}
								onChange={(e) => setAnnualRate(e.target.value)}
								className="h-8 text-sm"
							/>
						</div>
						<div className="space-y-1">
							<Label className="text-xs">Ratio deuda máx.</Label>
							<Input
								type="number"
								step="0.01"
								min="0"
								max="1"
								value={maxDebtRatio}
								onChange={(e) => setMaxDebtRatio(e.target.value)}
								className="h-8 text-sm"
							/>
						</div>
						<div className="space-y-1">
							<Label className="text-xs">Ratio deuda var. máx.</Label>
							<Input
								type="number"
								step="0.01"
								min="0"
								max="1"
								value={maxVariableDebtRatio}
								onChange={(e) => setMaxVariableDebtRatio(e.target.value)}
								className="h-8 text-sm"
							/>
						</div>
					</div>
				)}

				{(!leadId || validatedBatch) && (
					<Button
						type="button"
						size="sm"
						className="w-full"
						onClick={() => analyzeMutation.mutate()}
						disabled={
							isLoadingAnalysis ||
							activeFileCount === 0 ||
							isBusy ||
							!hasOwner ||
							!canAnalyze ||
							(!!leadId && !allDocumentsValidated)
						}
					>
						{isLoadingAnalysis ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Cargando...
							</>
						) : analyzeMutation.isPending ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Analizando con IA...
							</>
						) : (
							"Analizar Capacidad de Pago"
						)}
					</Button>
				)}
				{hasSuccessfulAnalysis && (
					<div className="space-y-2">
						<p className="text-center text-green-600 text-xs">
							Análisis completado exitosamente.
						</p>
						{canReset && (
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="w-full text-destructive hover:text-destructive"
								onClick={() => {
									if (
										window.confirm(
											"¿Está seguro? Esto eliminará el análisis actual y permitirá volver a subir estados de cuenta.",
										)
									) {
										resetMutation.mutate();
									}
								}}
								disabled={resetMutation.isPending}
							>
								{resetMutation.isPending ? (
									<>
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										Reseteando...
									</>
								) : (
									<>
										<RotateCcw className="mr-2 h-4 w-4" />
										Resetear Análisis
									</>
								)}
							</Button>
						)}
					</div>
				)}
				{!hasSuccessfulAnalysis && attemptCount >= MAX_AI_ATTEMPTS && (
					<div className="space-y-2">
						<p className="text-center text-muted-foreground text-xs">
							Se alcanzó el límite de {MAX_AI_ATTEMPTS} intentos. Contacte al
							administrador.
						</p>
						{canReset && (
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="w-full text-destructive hover:text-destructive"
								onClick={() => resetMutation.mutate()}
								disabled={resetMutation.isPending}
							>
								{resetMutation.isPending ? (
									<>
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										Reseteando...
									</>
								) : (
									<>
										<RotateCcw className="mr-2 h-4 w-4" />
										Resetear Intentos
									</>
								)}
							</Button>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
