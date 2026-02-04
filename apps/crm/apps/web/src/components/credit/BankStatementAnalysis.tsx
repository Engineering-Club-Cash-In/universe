import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ChevronDown,
	ChevronUp,
	FileText,
	Loader2,
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
import { client } from "@/utils/orpc";

const MAX_AI_ATTEMPTS = 2;

interface BankStatementAnalysisProps {
	leadId: string;
	onAnalysisComplete?: () => void;
}

export function BankStatementAnalysis({
	leadId,
	onAnalysisComplete,
}: BankStatementAnalysisProps) {
	const [files, setFiles] = useState<File[]>([]);
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [annualRate, setAnnualRate] = useState("0.18");
	const [termMonths, setTermMonths] = useState("60");
	const [maxDebtRatio, setMaxDebtRatio] = useState("0.2");
	const [maxVariableDebtRatio, setMaxVariableDebtRatio] = useState("0.3");
	const fileInputRef = useRef<HTMLInputElement>(null);
	const queryClient = useQueryClient();

	// Obtener estado del análisis desde el servidor
	const { data: existingAnalysis, isLoading: isLoadingAnalysis } = useQuery({
		queryKey: ["creditAnalysis", leadId],
		queryFn: () => client.getCreditAnalysisByLeadId({ leadId }),
	});

	const hasSuccessfulAnalysis = existingAnalysis?.analyzedAt !== null;
	const attemptCount = existingAnalysis?.attemptCount ?? 0;
	const canAnalyze =
		!hasSuccessfulAnalysis && attemptCount < MAX_AI_ATTEMPTS;

	const analyzeMutation = useMutation({
		mutationFn: async () => {
			const filePayloads = await Promise.all(
				files.map(
					(file) =>
						new Promise<{ name: string; data: string; mimeType: string }>(
							(resolve, reject) => {
								const reader = new FileReader();
								reader.onload = () => {
									const base64 = (reader.result as string).split(",")[1];
									resolve({
										name: file.name,
										data: base64,
										mimeType: file.type || "application/pdf",
									});
								};
								reader.onerror = reject;
								reader.readAsDataURL(file);
							},
						),
				),
			);

			return client.analyzeBankStatements({
				leadId,
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
			queryClient.invalidateQueries({ queryKey: ["creditAnalysis", leadId] });
			onAnalysisComplete?.();
		},
		onError: (error) => {
			toast.error(`Error al analizar: ${error.message}`);
			// Invalidar query para obtener el contador actualizado
			queryClient.invalidateQueries({ queryKey: ["creditAnalysis", leadId] });
		},
	});

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const selectedFiles = Array.from(e.target.files || []);
		const pdfFiles = selectedFiles.filter((f) => f.type === "application/pdf");

		if (pdfFiles.length !== selectedFiles.length) {
			toast.warning("Solo se permiten archivos PDF");
		}

		const totalFiles = files.length + pdfFiles.length;
		if (totalFiles > 3) {
			toast.warning("Máximo 3 archivos permitidos");
			const allowed = pdfFiles.slice(0, 3 - files.length);
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
					Suba 1 a 3 estados de cuenta bancarios en PDF para análisis automático
					con IA
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
						disabled={files.length >= 3 || analyzeMutation.isPending}
					/>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="w-full"
						onClick={() => fileInputRef.current?.click()}
						disabled={files.length >= 3 || analyzeMutation.isPending}
					>
						<Upload className="mr-2 h-4 w-4" />
						Seleccionar PDFs ({files.length}/3)
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
					<p className="text-center text-xs text-green-600">
						Análisis completado exitosamente.
					</p>
				)}
				{!hasSuccessfulAnalysis && attemptCount >= MAX_AI_ATTEMPTS && (
					<p className="text-center text-xs text-muted-foreground">
						Se alcanzó el límite de {MAX_AI_ATTEMPTS} intentos. Contacte al
						administrador.
					</p>
				)}
			</CardContent>
		</Card>
	);
}
