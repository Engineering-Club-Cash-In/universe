import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Copy, Edit, ExternalLink, FileText } from "lucide-react";
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

// Contract types mapping
const CONTRACT_TYPES_MAP: Record<string, string> = {
	solicitud_compra_vehiculo_tercero: "Solicitud Compra Vehiculo Tercero",
	carta_aceptacion_instalacion_gps: "Carta Aceptacion Instalacion Gps",
	carta_traspaso_vehiculo_rdbe: "Carta Traspaso Vehiculo Rdbe",
	descargo_responsabilidades: "Descargo Responsabilidades",
	cobertura_inrexsa: "Cobertura Inrexsa",
	reconocimiento_deuda_feb_2025: "Reconocimiento Deuda Feb 2025",
	carta_carro_nuevo: "Carta Carro Nuevo",
	contrato_privado_uso_carro_nuevo: "Contrato Privado Uso Carro Nuevo",
	pagare_unico_libre_protesto: "Pagare Unico Libre Protesto",
	carta_emision_cheques: "Carta Emision Cheques",
	garantia_mobiliaria: "Garantia Mobiliaria",
	declaracion_vendedor: "Declaracion Vendedor",
	contrato_privado_uso_carro_usado: "Contrato Privado Uso Carro Usado",
};

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
	onEdit?: () => void;
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
	onEdit,
}: ContractCardProps) {
	const { canAssignLegal, canCreateLegal } = useJuridicoPermissions();

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
			<CardHeader className="bg-linear-to-r from-amber-50 to-white pb-4">
				<div className="flex items-start justify-between gap-3">
					<div className="flex items-start gap-3 flex-1">
						<div className="mt-1 flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 shrink-0">
							<FileText className="h-5 w-5 text-amber-600" />
						</div>
						<div className="flex-1 min-w-0">
							<CardTitle className="text-lg">{contract.contractName}</CardTitle>
							<CardDescription className="mt-1">
								{formattedDate}
							</CardDescription>
						</div>
					</div>
					<div className="flex items-center gap-2 shrink-0">
						<Badge
							variant="outline"
							className={statusConfig[contract.status].color}
						>
							{statusConfig[contract.status].label}
						</Badge>
						{canCreateLegal && onEdit && (
							<Button
								size="sm"
								variant="outline"
								onClick={onEdit}
								className="h-8"
							>
								<Edit className="mr-1 h-3 w-3" />
								Editar
							</Button>
						)}
					</div>
				</div>
			</CardHeader>

			<CardContent className="space-y-3 pt-4">
				{/* Tipo de contrato y Oportunidad en grid */}
				<div className="grid gap-3 md:grid-cols-2">
					{/* Tipo de contrato */}
					<div>
						<p className="font-medium text-muted-foreground text-xs mb-1">
							Tipo de contrato
						</p>
						<p className="text-sm">
							{CONTRACT_TYPES_MAP[contract.contractType] ||
								contract.contractType}
						</p>
					</div>

					{/* Oportunidad asignada */}
					<div>
						<p className="mb-1 font-medium text-muted-foreground text-xs">
							Oportunidad
						</p>
						{opportunity ? (
							<div className="text-sm">
								{opportunity.title} - Q
								{Number(opportunity.value || 0).toLocaleString()}
							</div>
						) : (
							<div className="text-muted-foreground text-sm">Sin asignar</div>
						)}
					</div>
				</div>

				{/* Links de documentos - más compacto */}
				{(contract.clientSigningLink ||
					contract.representativeSigningLink ||
					(contract.additionalSigningLinks &&
						contract.additionalSigningLinks.length > 0)) && (
					<div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
						<p className="font-medium text-xs text-muted-foreground">
							Enlaces de firma
						</p>

						{/* Link del cliente */}
						{contract.clientSigningLink && (
							<div className="flex items-center justify-between gap-2 rounded border-blue-500 border-l-2 bg-blue-50/50 py-1.5 px-2">
								<p className="font-medium text-blue-900 text-xs shrink-0">
									👤 Cliente
								</p>
								<div className="flex gap-1">
									<Button
										size="sm"
										variant="ghost"
										className="h-6 px-2"
										onClick={() => openLink(contract.clientSigningLink!)}
									>
										<ExternalLink className="h-3 w-3" />
									</Button>
									<Button
										size="sm"
										variant="ghost"
										className="h-6 px-2"
										onClick={() =>
											copyToClipboard(
												contract.clientSigningLink!,
												"Link del cliente",
											)
										}
									>
										<Copy className="h-3 w-3" />
									</Button>
								</div>
							</div>
						)}

						{/* Link del representante */}
						{contract.representativeSigningLink && (
							<div className="flex items-center justify-between gap-2 rounded border-green-500 border-l-2 bg-green-50/50 py-1.5 px-2">
								<p className="font-medium text-green-900 text-xs shrink-0">
									🏢 Representante
								</p>
								<div className="flex gap-1">
									<Button
										size="sm"
										variant="ghost"
										className="h-6 px-2"
										onClick={() =>
											openLink(contract.representativeSigningLink!)
										}
									>
										<ExternalLink className="h-3 w-3" />
									</Button>
									<Button
										size="sm"
										variant="ghost"
										className="h-6 px-2"
										onClick={() =>
											copyToClipboard(
												contract.representativeSigningLink!,
												"Link del representante",
											)
										}
									>
										<Copy className="h-3 w-3" />
									</Button>
								</div>
							</div>
						)}

						{/* Links adicionales */}
						{contract.additionalSigningLinks &&
							contract.additionalSigningLinks.length > 0 &&
							contract.additionalSigningLinks.map((link, index) => (
								<div
									key={index}
									className="flex items-center justify-between gap-2 rounded border-purple-500 border-l-2 bg-purple-50/50 py-1.5 px-2"
								>
									<p className="font-medium text-purple-900 text-xs shrink-0">
										👥 Adicional {index + 1}
									</p>
									<div className="flex gap-1">
										<Button
											size="sm"
											variant="ghost"
											className="h-6 px-2"
											onClick={() => openLink(link)}
										>
											<ExternalLink className="h-3 w-3" />
										</Button>
										<Button
											size="sm"
											variant="ghost"
											className="h-6 px-2"
											onClick={() =>
												copyToClipboard(link, `Link adicional ${index + 1}`)
											}
										>
											<Copy className="h-3 w-3" />
										</Button>
									</div>
								</div>
							))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
