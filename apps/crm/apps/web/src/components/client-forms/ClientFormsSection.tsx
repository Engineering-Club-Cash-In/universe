import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Check,
	ClipboardCopy,
	Download,
	FileText,
	Link2,
	Loader2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	generateCreditApplicationPdf,
	generateFinancialStatementPdf,
} from "@/lib/generate-client-form-pdfs";
import { client } from "@/utils/orpc";

interface ClientFormsSectionProps {
	opportunityId: string;
}

export function ClientFormsSection({ opportunityId }: ClientFormsSectionProps) {
	const queryClient = useQueryClient();
	const [copied, setCopied] = useState(false);

	// Check if token exists
	const { data: tokenData, isLoading: isLoadingToken } = useQuery({
		queryKey: ["formToken", opportunityId],
		queryFn: () => client.getFormTokenByOpportunity({ opportunityId }),
	});

	// Get form data
	const { data: formData, isLoading: isLoadingForms } = useQuery({
		queryKey: ["clientFormData", opportunityId],
		queryFn: () => client.getClientFormData({ opportunityId }),
	});

	// Generate token mutation
	const generateMutation = useMutation({
		mutationFn: () => client.generateFormToken({ opportunityId }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["formToken", opportunityId] });
			toast.success("Enlace generado exitosamente");
		},
		onError: () => {
			toast.error("Error al generar el enlace");
		},
	});

	const handleCopyLink = async (url: string) => {
		try {
			await navigator.clipboard.writeText(url);
			setCopied(true);
			toast.success("Enlace copiado al portapapeles");
			setTimeout(() => setCopied(false), 2000);
		} catch {
			toast.error("Error al copiar el enlace");
		}
	};

	if (isLoadingToken || isLoadingForms) {
		return (
			<div className="flex items-center justify-center py-8">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	const hasCreditApp = !!formData?.creditApplication;
	const hasFinancialStmt = !!formData?.financialStatement;
	const isComplete = hasCreditApp && hasFinancialStmt;

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-2">
				<FileText className="h-5 w-5 text-muted-foreground" />
				<h3 className="font-semibold text-lg">Formularios del Cliente</h3>
				{isComplete && (
					<Badge variant="default" className="bg-green-600">
						Completado
					</Badge>
				)}
				{tokenData && !isComplete && (
					<Badge variant="secondary">Pendiente</Badge>
				)}
			</div>

			{/* Link Generation / Display */}
			<div className="space-y-3 rounded-lg border p-4">
				<div className="flex items-center gap-2 font-medium text-sm">
					<Link2 className="h-4 w-4" />
					Enlace del Formulario
				</div>

				{!tokenData ? (
					<Button
						onClick={() => generateMutation.mutate()}
						disabled={generateMutation.isPending}
					>
						{generateMutation.isPending ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Generando...
							</>
						) : (
							"Generar Enlace"
						)}
					</Button>
				) : (
					<div className="space-y-2">
						<div className="flex gap-2">
							<Input
								readOnly
								value={tokenData.url}
								className="font-mono text-xs"
							/>
							<Button
								variant="outline"
								size="icon"
								onClick={() => handleCopyLink(tokenData.url)}
							>
								{copied ? (
									<Check className="h-4 w-4 text-green-500" />
								) : (
									<ClipboardCopy className="h-4 w-4" />
								)}
							</Button>
						</div>
						<div className="flex items-center gap-4 text-muted-foreground text-xs">
							<span>
								Expira:{" "}
								{new Date(tokenData.expiresAt).toLocaleDateString("es-GT")}
							</span>
							{tokenData.used && (
								<Badge variant="outline" className="text-xs">
									Usado
								</Badge>
							)}
						</div>
					</div>
				)}
			</div>

			{/* Form Status */}
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div className="rounded-lg border p-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<FileText className="h-4 w-4 text-muted-foreground" />
							<span className="font-medium text-sm">Solicitud de Crédito</span>
						</div>
						{hasCreditApp ? (
							<Badge variant="default" className="bg-green-600">
								Completado
							</Badge>
						) : (
							<Badge variant="secondary">Pendiente</Badge>
						)}
					</div>
				</div>

				<div className="rounded-lg border p-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<FileText className="h-4 w-4 text-muted-foreground" />
							<span className="font-medium text-sm">Estado Patrimonial</span>
						</div>
						{hasFinancialStmt ? (
							<Badge variant="default" className="bg-green-600">
								Completado
							</Badge>
						) : (
							<Badge variant="secondary">Pendiente</Badge>
						)}
					</div>
				</div>
			</div>

			{/* PDF Downloads */}
			{isComplete && formData && (
				<div className="flex gap-3">
					<Button
						variant="outline"
						size="sm"
						onClick={() =>
							generateCreditApplicationPdf(
								formData.creditApplication as Record<string, unknown>,
							)
						}
					>
						<Download className="mr-2 h-4 w-4" />
						Descargar Solicitud PDF
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={() =>
							generateFinancialStatementPdf(
								formData.financialStatement as Record<string, unknown>,
							)
						}
					>
						<Download className="mr-2 h-4 w-4" />
						Descargar Estado Patrimonial PDF
					</Button>
				</div>
			)}
		</div>
	);
}
