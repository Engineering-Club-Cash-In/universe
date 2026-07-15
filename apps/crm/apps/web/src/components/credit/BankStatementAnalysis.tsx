import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ChevronDown,
	ChevronUp,
	FileText,
	Loader2,
	RotateCcw,
	Trash2,
	Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
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
	const fileInputRef = useRef<HTMLInputElement>(null);
	const queryClient = useQueryClient();

	const queryKey = leadId
		? ["creditAnalysis", "lead", leadId]
		: ["creditAnalysis", "coDebtor", coDebtorId];

	// Obtener estado del análisis desde el servidor
	const { data: existingAnalysis, isLoading: isLoadingAnalysis } = useQuery({
		queryKey,
		queryFn: () =>
			client.getCreditAnalysisByLeadId(
				leadId ? { leadId } : { coDebtorId: coDebtorId! },
			),
		enabled: !!(leadId || coDebtorId),
	});

	// Verificar si hay un análisis exitoso (analyzedAt debe existir y no ser null)
	const hasSuccessfulAnalysis =
		existingAnalysis != null && existingAnalysis.analyzedAt != null;
	const attemptCount = existingAnalysis?.attemptCount ?? 0;
	const canAnalyze = !hasSuccessfulAnalysis && attemptCount < MAX_AI_ATTEMPTS;

	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const canReset =
		userProfile.data?.role === "admin" ||
		userProfile.data?.role === "sales_supervisor" ||
		userProfile.data?.role === "analyst";

	const resetMutation = useMutation({
		mutationFn: () =>
			client.resetCreditAnalysis(
				leadId ? { leadId } : { coDebtorId: coDebtorId! },
			),
		onSuccess: () => {
			toast.success(
				"Análisis reseteado. Puede volver a subir estados de cuenta.",
			);
			queryClient.invalidateQueries({ queryKey });
			onAnalysisComplete?.();
		},
		onError: (error) => {
			toast.error(`Error al resetear: ${error.message}`);
		},
	});

	const analyzeMutation = useMutation({
		mutationFn: async () => {
			// Upload all files to R2 first
			const filePayloads = await Promise.all(
				files.map(async (file) => {
					const { key } = await uploadFileToR2WithRetry(file, {
						resourceType: "bank_statement",
						resourceId: leadId || coDebtorId!,
					});
					return {
						name: file.name,
						key,
						mimeType: file.type || "application/pdf",
					};
				}),
			);

			return client.analyzeBankStatements({
				...(leadId ? { leadId } : { coDebtorId: coDebtorId! }),
				...(leadId && opportunityId ? { opportunityId } : {}),
				files: filePayloads,
				annualRate: Number.parseFloat(annualRate),
				termMonths: Number.parseInt(termMonths),
				maxDebtRatio: Number.parseFloat(maxDebtRatio),
				maxVariableDebtRatio: Number.parseFloat(maxVariableDebtRatio),
			});
		},
		onSuccess: () => {
			toast.success("Análisis completado exitosamente");
			setFiles([]);
			// Invalidar query para obtener estado actualizado del servidor
			queryClient.invalidateQueries({ queryKey });
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

		if (fileInputRef.current) {
			fileInputRef.current.value = "";
		}
	};

	const removeFile = (index: number) => {
		setFiles((prev) => prev.filter((_, i) => i !== index));
	};

	return (
		<Card className="border-dashed">
			<CardHeader className="pb-3">
				<CardTitle className="font-medium text-sm">
					Análisis de Estados de Cuenta
				</CardTitle>
				<CardDescription className="text-xs">
					Suba de 1 a 9 estados de cuenta bancarios en PDF para análisis
					automático con IA (hasta 3 bancos diferentes)
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{/* File input */}
				<div>
					<input
						ref={fileInputRef}
						type="file"
						accept=".pdf,application/pdf"
						multiple
						className="hidden"
						onChange={handleFileChange}
						disabled={files.length >= 9 || analyzeMutation.isPending}
					/>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="w-full"
						onClick={() => fileInputRef.current?.click()}
						disabled={files.length >= 9 || analyzeMutation.isPending}
					>
						<Upload className="mr-2 h-4 w-4" />
						Seleccionar PDFs ({files.length}/9)
					</Button>
				</div>

				{/* File list */}
				{files.length > 0 && (
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
									disabled={analyzeMutation.isPending}
								>
									<Trash2 className="h-3.5 w-3.5 text-destructive" />
								</Button>
							</div>
						))}
					</div>
				)}

				{/* Advanced options */}
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

				{showAdvanced && (
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

				{/* Analyze button */}
				<Button
					type="button"
					size="sm"
					className="w-full"
					onClick={() => analyzeMutation.mutate()}
					disabled={
						isLoadingAnalysis ||
						files.length === 0 ||
						analyzeMutation.isPending ||
						!canAnalyze
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
					) : attemptCount > 0 && !hasSuccessfulAnalysis ? (
						`Reintentar Análisis (${attemptCount}/${MAX_AI_ATTEMPTS})`
					) : (
						"Analizar"
					)}
				</Button>
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
