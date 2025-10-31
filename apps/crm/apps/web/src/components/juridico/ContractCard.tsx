import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Copy, ExternalLink, FileText } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useJuridicoPermissions } from "@/hooks/usePermissions";
import { OpportunitySelector } from "./OpportunitySelector";

interface ContractCardProps {
	contract: {
		id: string;
		contractType: string;
		contractName: string;
		clientSigningLink: string | null;
		representativeSigningLink: string | null;
		additionalSigningLinks: string[] | null;
		status: "pending" | "signed" | "cancelled";
		generatedAt: Date | string;
		opportunityId: string | null;
		leadId: string;
	};
	opportunity?: {
		id: string;
		title: string;
		value: string | null;
	} | null;
	onUpdate?: () => void;
}

const statusConfig = {
	pending: {
		label: "Pendiente",
		color: "bg-yellow-100 text-yellow-800 border-yellow-300",
	},
	signed: {
		label: "Firmado",
		color: "bg-green-100 text-green-800 border-green-300",
	},
	cancelled: {
		label: "Cancelado",
		color: "bg-red-100 text-red-800 border-red-300",
	},
};

export function ContractCard({
	contract,
	opportunity,
	onUpdate,
}: ContractCardProps) {
	const { canAssignLegal } = useJuridicoPermissions();

	const copyToClipboard = (text: string, label: string) => {
		navigator.clipboard.writeText(text);
		toast.success(`${label} copiado al portapapeles`);
	};

	const openLink = (url: string) => {
		window.open(url, "_blank", "noopener,noreferrer");
	};

	const formattedDate = format(
		new Date(contract.generatedAt),
		"dd 'de' MMMM 'de' yyyy, HH:mm",
		{ locale: es },
	);

	return (
		<Card className="overflow-hidden">
			<CardHeader className="bg-gradient-to-r from-amber-50 to-white">
				<div className="flex items-start justify-between">
					<div className="flex items-start gap-3">
						<div className="mt-1 flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100">
							<FileText className="h-5 w-5 text-amber-600" />
						</div>
						<div className="flex-1">
							<CardTitle className="text-lg">
								{contract.contractName}
							</CardTitle>
							<CardDescription className="mt-1">
								Generado el {formattedDate}
							</CardDescription>
						</div>
					</div>
					<Badge
						variant="outline"
						className={statusConfig[contract.status].color}
					>
						{statusConfig[contract.status].label}
					</Badge>
				</div>
			</CardHeader>

			<CardContent className="space-y-4 pt-6">
				{/* Tipo de contrato */}
				<div>
					<p className="text-sm font-medium text-muted-foreground">
						Tipo de contrato
					</p>
					<p className="mt-1 text-sm">{contract.contractType}</p>
				</div>

				{/* Asignación de oportunidad */}
				<div>
					<p className="mb-2 text-sm font-medium text-muted-foreground">
						Oportunidad asignada
					</p>
					{canAssignLegal ? (
						<OpportunitySelector
							contractId={contract.id}
							leadId={contract.leadId}
							currentOpportunityId={contract.opportunityId}
							onAssignSuccess={onUpdate}
						/>
					) : opportunity ? (
						<div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
							{opportunity.title} - Q
							{Number(opportunity.value || 0).toLocaleString()}
						</div>
					) : (
						<div className="text-sm text-muted-foreground">Sin asignar</div>
					)}
				</div>

				{/* Links de documentos */}
				<div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
					<p className="text-sm font-medium">Enlaces de firma</p>

					{/* Link del cliente */}
					{contract.clientSigningLink && (
						<div className="space-y-2 rounded-md border-l-4 border-blue-500 bg-blue-50/50 p-3">
							<div className="flex items-center justify-between">
								<p className="text-sm font-medium text-blue-900">
									👤 Link del Cliente
								</p>
								<div className="flex gap-2">
									<Button
										size="sm"
										variant="outline"
										className="h-8"
										onClick={() => openLink(contract.clientSigningLink!)}
									>
										<ExternalLink className="mr-1 h-3 w-3" />
										Abrir
									</Button>
									<Button
										size="sm"
										variant="outline"
										className="h-8"
										onClick={() =>
											copyToClipboard(
												contract.clientSigningLink!,
												"Link del cliente",
											)
										}
									>
										<Copy className="mr-1 h-3 w-3" />
										Copiar
									</Button>
								</div>
							</div>
							<p className="truncate text-xs font-mono text-blue-700">
								{contract.clientSigningLink}
							</p>
						</div>
					)}

					{/* Link del representante */}
					{contract.representativeSigningLink && (
						<div className="space-y-2 rounded-md border-l-4 border-green-500 bg-green-50/50 p-3">
							<div className="flex items-center justify-between">
								<p className="text-sm font-medium text-green-900">
									🏢 Link del Representante
								</p>
								<div className="flex gap-2">
									<Button
										size="sm"
										variant="outline"
										className="h-8"
										onClick={() => openLink(contract.representativeSigningLink!)}
									>
										<ExternalLink className="mr-1 h-3 w-3" />
										Abrir
									</Button>
									<Button
										size="sm"
										variant="outline"
										className="h-8"
										onClick={() =>
											copyToClipboard(
												contract.representativeSigningLink!,
												"Link del representante",
											)
										}
									>
										<Copy className="mr-1 h-3 w-3" />
										Copiar
									</Button>
								</div>
							</div>
							<p className="truncate text-xs font-mono text-green-700">
								{contract.representativeSigningLink}
							</p>
						</div>
					)}

					{/* Links adicionales */}
					{contract.additionalSigningLinks &&
						contract.additionalSigningLinks.length > 0 &&
						contract.additionalSigningLinks.map((link, index) => (
							<div
								key={index}
								className="space-y-2 rounded-md border-l-4 border-purple-500 bg-purple-50/50 p-3"
							>
								<div className="flex items-center justify-between">
									<p className="text-sm font-medium text-purple-900">
										👥 Link Adicional {index + 1}
									</p>
									<div className="flex gap-2">
										<Button
											size="sm"
											variant="outline"
											className="h-8"
											onClick={() => openLink(link)}
										>
											<ExternalLink className="mr-1 h-3 w-3" />
											Abrir
										</Button>
										<Button
											size="sm"
											variant="outline"
											className="h-8"
											onClick={() =>
												copyToClipboard(link, `Link adicional ${index + 1}`)
											}
										>
											<Copy className="mr-1 h-3 w-3" />
											Copiar
										</Button>
									</div>
								</div>
								<p className="truncate text-xs font-mono text-purple-700">
									{link}
								</p>
							</div>
						))}
				</div>
			</CardContent>
		</Card>
	);
}
