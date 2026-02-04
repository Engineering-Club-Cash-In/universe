import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
	Copy,
	Edit,
	ExternalLink,
	FileText,
	Loader2,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
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
import { useJuridicoPermissions } from "@/hooks/usePermissions";
import { getContractTypeLabel } from "@/lib/crm-formatters";
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
		pdfLink?: string | null;
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
	onDelete?: (contractId: string) => Promise<void>;
	isDeleting?: boolean;
}

const statusConfig = {
	pending: {
		label: "Pendiente",
		color: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border-yellow-500/50",
	},
	signed: {
		label: "Firmado",
		color: "bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/50",
	},
	cancelled: {
		label: "Cancelado",
		color: "bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/50",
	},
};

export function ContractCard({
	contract,
	opportunity,
	onUpdate,
	onEdit,
	onDelete,
	isDeleting = false,
}: ContractCardProps) {
	const { canAssignLegal, canCreateLegal } = useJuridicoPermissions();
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);

	const copyToClipboard = (text: string, label: string) => {
		navigator.clipboard.writeText(text);
		toast.success(`${label} copiado al portapapeles`);
	};

	const openLink = (url: string) => {
		window.open(url, "_blank", "noopener,noreferrer");
	};

	const handleDelete = async () => {
		if (onDelete) {
			await onDelete(contract.id);
			setShowDeleteDialog(false);
		}
	};

	const formattedDate = format(
		new Date(contract.generatedAt),
		"dd 'de' MMMM 'de' yyyy, HH:mm",
		{ locale: es },
	);

	return (
		<Card className="overflow-hidden">
			<CardHeader>
				<div className="flex items-start justify-between gap-3">
					<div className="flex flex-1 items-start gap-3">
						<div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
							<FileText className="h-5 w-5 text-amber-600" />
						</div>
						<div className="min-w-0 flex-1">
							<CardTitle className="text-lg">{contract.contractName}</CardTitle>
							<CardDescription className="mt-1">
								{formattedDate}
							</CardDescription>
						</div>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						{contract.clientSigningLink && (
							<Badge
								variant="outline"
								className={statusConfig[contract.status].color}
							>
								{statusConfig[contract.status].label}
							</Badge>
						)}
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
						{canCreateLegal && onDelete && (
							<Button
								size="sm"
								variant="outline"
								onClick={() => setShowDeleteDialog(true)}
								className="h-8 text-red-600 hover:bg-red-50 hover:text-red-700"
								disabled={isDeleting}
							>
								{isDeleting ? (
									<Loader2 className="h-3 w-3 animate-spin" />
								) : (
									<Trash2 className="h-3 w-3" />
								)}
							</Button>
						)}
					</div>
				</div>
			</CardHeader>

			<CardContent className="space-y-4">
				{/* Tipo de contrato */}
				<div>
					<p className="font-medium text-muted-foreground text-sm">
						Tipo de contrato
					</p>
					<p className="mt-1 text-sm">
						{getContractTypeLabel(contract.contractType)}
					</p>
				</div>

				{/* Links de documentos - más compacto */}
				{(contract.clientSigningLink ||
					contract.representativeSigningLink ||
					(contract.additionalSigningLinks &&
						contract.additionalSigningLinks.length > 0)) && (
					<div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
						<p className="font-medium text-muted-foreground text-xs">
							Enlaces de firma
						</p>

						{/* Link del cliente */}
						{contract.clientSigningLink && (
							<div className="flex items-center justify-between gap-2 rounded border-blue-500 border-l-2 bg-blue-500/10 px-2 py-1.5">
								<p className="shrink-0 font-medium text-blue-600 dark:text-blue-400 text-xs">
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
							<div className="flex items-center justify-between gap-2 rounded border-green-500 border-l-2 bg-green-500/10 px-2 py-1.5">
								<p className="shrink-0 font-medium text-green-600 dark:text-green-400 text-xs">
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
									className="flex items-center justify-between gap-2 rounded border-purple-500 border-l-2 bg-purple-500/10 px-2 py-1.5"
								>
									<p className="shrink-0 font-medium text-purple-600 dark:text-purple-400 text-xs">
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

				{/* PDF del contrato */}
				{contract.pdfLink && (
					<div className="rounded-lg border border-border bg-amber-500/10 p-3">
						<div className="flex items-center justify-between gap-2">
							<p className="font-medium text-amber-600 dark:text-amber-400 text-sm">
								📄 Documento PDF
							</p>
							<div className="flex gap-1">
								<Button
									size="sm"
									variant="outline"
									className="h-7"
									onClick={() => openLink(contract.pdfLink!)}
								>
									<ExternalLink className="mr-1 h-3 w-3" />
									Ver PDF
								</Button>
								<Button
									size="sm"
									variant="ghost"
									className="h-7 px-2"
									onClick={() =>
										copyToClipboard(contract.pdfLink!, "Link del PDF")
									}
								>
									<Copy className="h-3 w-3" />
								</Button>
							</div>
						</div>
					</div>
				)}
			</CardContent>

			{/* Dialog de confirmación para eliminar */}
			<AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>¿Eliminar contrato?</AlertDialogTitle>
						<AlertDialogDescription>
							Estás a punto de eliminar el contrato "{contract.contractName}".
							Esta acción no se puede deshacer.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isDeleting}>
							Cancelar
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDelete}
							disabled={isDeleting}
							className="bg-red-600 hover:bg-red-700"
						>
							{isDeleting ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Eliminando...
								</>
							) : (
								"Eliminar"
							)}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Card>
	);
}
