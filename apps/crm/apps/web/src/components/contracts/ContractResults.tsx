import {
	AlertCircle,
	CheckCircle,
	Copy,
	ExternalLink,
	FileText,
	Loader2,
	RefreshCw,
} from "lucide-react";
import { esFirmaFisica } from "server/src/lib/contract-signature-mode";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	type FirmanteDeContrato,
	firmantesEnFicha,
} from "@/lib/contract-signers-display";

export interface ContractResult {
	contractType: string;
	contractName: string;
	success: boolean;
	contractId?: string;
	documentLink?: string;
	r2Key?: string;
	signingLinks?: string[];
	/**
	 * Firmantes con su rol. Sin esto los links se etiquetaban por posición y
	 * mentían: en los contratos donde el representante legal firma primero, el
	 * primer link salía rotulado "Firma Cliente".
	 */
	signatories?: FirmanteDeContrato[];
	templateId?: number;
	apiResponse?: unknown;
	error?: string;
}

interface ContractResultsProps {
	results: ContractResult[];
	totalRequested: number;
	successCount: number;
	failCount: number;
	/** Vuelve a generar un solo documento, sin tocar los que ya salieron bien */
	onRetry?: (contractType: string) => void;
	/** Tipo de contrato que se está reintentando en este momento */
	retryingType?: string | null;
}

export function ContractResults({
	results,
	totalRequested,
	successCount,
	failCount,
	onRetry,
	retryingType,
}: ContractResultsProps) {
	const failedNames = results
		.filter((r) => !r.success)
		.map((r) => r.contractName);
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
								: `No se generó: ${failedNames.join(", ")}. Usa "Reintentar" en el documento marcado en rojo; los demás no se vuelven a generar.`}
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

								{/* Firma en papel: no hay links y no debería parecer un faltante */}
								{esFirmaFisica(result.contractType) && (
									<div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-amber-800 text-sm">
										<FileText className="h-4 w-4 shrink-0" />
										<span>
											Se firma en papel: imprimí el PDF y que lo firme el
											vendedor. No lleva link de firma.
										</span>
									</div>
								)}

								{/* Enlaces de firma, etiquetados por el rol real de cada quien */}
								{firmantesEnFicha(result.signatories, {
									clientSigningLink: result.signingLinks?.[0] ?? null,
									representativeSigningLink: result.signingLinks?.[1] ?? null,
									additionalSigningLinks: result.signingLinks?.slice(2) ?? null,
								}).map((firmante) =>
									firmante.url ? (
										<div
											key={firmante.clave}
											className="flex items-center justify-between rounded bg-muted/50 p-2"
										>
											<div className="min-w-0">
												<span className="text-sm">{firmante.etiqueta}</span>
												{firmante.nombre && (
													<p className="truncate text-muted-foreground text-xs">
														{firmante.nombre}
													</p>
												)}
											</div>
											<div className="flex shrink-0 gap-2">
												<Button
													variant="ghost"
													size="sm"
													onClick={() =>
														copyToClipboard(
															firmante.url as string,
															firmante.etiqueta,
														)
													}
												>
													<Copy className="mr-1 h-4 w-4" />
													Copiar
												</Button>
												<Button
													variant="ghost"
													size="sm"
													onClick={() =>
														window.open(firmante.url as string, "_blank")
													}
												>
													<ExternalLink className="mr-1 h-4 w-4" />
													Abrir
												</Button>
											</div>
										</div>
									) : null,
								)}
							</div>
						)}

						{!result.success && (
							<div className="mt-2 space-y-2">
								<div className="rounded bg-red-100 p-2 text-red-700 text-sm">
									<strong>Error:</strong>{" "}
									{result.error || "No se pudo generar el documento"}
								</div>
								{onRetry && (
									<div className="flex items-center justify-between gap-3 rounded bg-white p-2">
										<span className="text-muted-foreground text-sm">
											Este documento no se va a enlazar a la oportunidad.
										</span>
										<Button
											size="sm"
											variant="destructive"
											disabled={Boolean(retryingType)}
											onClick={() => onRetry(result.contractType)}
										>
											{retryingType === result.contractType ? (
												<>
													<Loader2 className="mr-1 h-4 w-4 animate-spin" />
													Reintentando...
												</>
											) : (
												<>
													<RefreshCw className="mr-1 h-4 w-4" />
													Reintentar
												</>
											)}
										</Button>
									</div>
								)}
							</div>
						)}
					</div>
				))}
			</div>
		</div>
	);
}
