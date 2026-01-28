import {
	AlertCircle,
	CheckCircle,
	Copy,
	ExternalLink,
	FileText,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface ContractResult {
	contractType: string;
	contractName: string;
	success: boolean;
	contractId?: string;
	documentLink?: string;
	signingLinks?: string[];
	templateId?: number;
	apiResponse?: unknown;
	error?: string;
}

interface ContractResultsProps {
	results: ContractResult[];
	totalRequested: number;
	successCount: number;
	failCount: number;
}

export function ContractResults({
	results,
	totalRequested,
	successCount,
	failCount,
}: ContractResultsProps) {
	const copyToClipboard = (text: string, label: string) => {
		navigator.clipboard.writeText(text);
		toast.success(`Link de ${label} copiado al portapapeles`);
	};

	return (
		<div className="space-y-6">
			{/* Resumen */}
			<div
				className={`rounded-lg border p-4 ${
					failCount === 0
						? "border-green-200 bg-green-50"
						: "border-amber-200 bg-amber-50"
				}`}
			>
				<div className="flex items-center gap-3">
					{failCount === 0 ? (
						<CheckCircle className="h-6 w-6 text-green-600" />
					) : (
						<AlertCircle className="h-6 w-6 text-amber-600" />
					)}
					<div>
						<h4 className="font-semibold">
							{failCount === 0
								? "Todos los contratos generados exitosamente"
								: `${successCount} de ${totalRequested} contratos generados`}
						</h4>
						<p className="text-muted-foreground text-sm">
							{failCount === 0
								? "Los links de firma están disponibles abajo"
								: `${failCount} contrato(s) fallaron. Revise los detalles abajo.`}
						</p>
					</div>
				</div>
			</div>

			{/* Lista de resultados */}
			<div className="space-y-4">
				{results.map((result, index) => (
					<div
						key={index}
						className={`rounded-lg border p-4 ${
							result.success
								? "border-green-200 bg-white"
								: "border-red-200 bg-red-50"
						}`}
					>
						<div className="mb-3 flex items-center justify-between">
							<div className="flex items-center gap-3">
								<FileText
									className={`h-5 w-5 ${
										result.success ? "text-green-600" : "text-red-600"
									}`}
								/>
								<div>
									<h5 className="font-medium">{result.contractName}</h5>
									<span className="text-muted-foreground text-xs">
										{result.contractType}
									</span>
								</div>
							</div>
							<Badge variant={result.success ? "default" : "destructive"}>
								{result.success ? "Generado" : "Error"}
							</Badge>
						</div>

						{result.success && (
							<div className="space-y-2">
								{/* Document PDF link */}
								{result.documentLink && (
									<div className="flex items-center justify-between rounded bg-purple-50 p-2">
										<span className="font-medium text-purple-700 text-sm">
											Documento PDF
										</span>
										<div className="flex gap-2">
											<Button
												variant="ghost"
												size="sm"
												onClick={() =>
													copyToClipboard(result.documentLink!, "documento")
												}
											>
												<Copy className="mr-1 h-4 w-4" />
												Copiar
											</Button>
											<Button
												size="sm"
												className="bg-purple-600 text-white hover:bg-purple-700"
												onClick={() =>
													window.open(result.documentLink, "_blank")
												}
											>
												<ExternalLink className="mr-1 h-4 w-4" />
												Ver PDF
											</Button>
										</div>
									</div>
								)}

								{/* Signing links */}
								{result.signingLinks?.map((link, linkIndex) => {
									const linkLabel =
										linkIndex === 0
											? "Firma Cliente"
											: linkIndex === 1
												? "Firma Representante"
												: `Firma ${linkIndex + 1}`;
									return (
										<div
											key={linkIndex}
											className="flex items-center justify-between rounded bg-muted/50 p-2"
										>
											<span className="text-sm">{linkLabel}</span>
											<div className="flex gap-2">
												<Button
													variant="ghost"
													size="sm"
													onClick={() => copyToClipboard(link, linkLabel)}
												>
													<Copy className="mr-1 h-4 w-4" />
													Copiar
												</Button>
												<Button
													variant="ghost"
													size="sm"
													onClick={() => window.open(link, "_blank")}
												>
													<ExternalLink className="mr-1 h-4 w-4" />
													Abrir
												</Button>
											</div>
										</div>
									);
								})}
							</div>
						)}

						{!result.success && result.error && (
							<div className="mt-2 rounded bg-red-100 p-2 text-red-700 text-sm">
								<strong>Error:</strong> {result.error}
							</div>
						)}
					</div>
				))}
			</div>
		</div>
	);
}
