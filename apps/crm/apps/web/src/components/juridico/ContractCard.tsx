import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
	Copy,
	ExternalLink,
	FileText,
	FileUp,
	Loader2,
	Mail,
	RefreshCw,
	Search,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { esFirmaFisica } from "server/src/lib/contract-signature-mode";
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
import {
	type FirmanteDeContrato,
	firmantesEnFicha,
} from "@/lib/contract-signers-display";
import { getContractTypeLabel } from "@/lib/crm-formatters";
import { client } from "@/utils/orpc";
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
	/**
	 * Firmantes con su rol. Los contratos generados antes de que se guardara el
	 * rol no los tienen: para esos se cae a las columnas por posición.
	 */
	signatories?: FirmanteDeContrato[];
	opportunity?: {
		id: string;
		title: string;
		value: string | null;
	} | null;
	onUpdate?: () => void;
	/** Abre la subida para reemplazar el documento de este contrato. */
	onReplace?: () => void;
	onDelete?: (contractId: string) => Promise<void>;
	isDeleting?: boolean;
}

const statusConfig = {
	pending: {
		label: "Pendiente",
		color:
			"bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border-yellow-500/50",
	},
	signed: {
		label: "Firmado",
		color:
			"bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/50",
	},
	cancelled: {
		label: "Cancelado",
		color: "bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/50",
	},
};

export function ContractCard({
	contract,
	signatories,
	opportunity,
	onUpdate,
	onReplace,
	onDelete,
	isDeleting = false,
}: ContractCardProps) {
	const { canAssignLegal, canCreateLegal } = useJuridicoPermissions();
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);

	// Este contrato se imprime y se firma a mano: que no tenga links no es que
	// haya fallado, y mostrarlo como "Pendiente" hacía que jurídico lo buscara.
	const firmaEnPapel = esFirmaFisica(contract.contractType);

	// Cada firmante trae su rol. El bloque anterior leía tres columnas fijas y
	// rotulaba como "Representante" al que estuviera segundo, que con cofirmante
	// era el cofirmante.
	const firmantes = firmantesEnFicha(signatories, contract);

	// Estado que devolvió WeeTrust en la última consulta, para no obligar a
	// jurídico a entrar al portal de WeeTrust a ver quién falta.
	const [estadoWeeTrust, setEstadoWeeTrust] = useState<{
		status: string;
		signatories: Array<{
			emailID: string;
			name: string;
			isSigned: boolean;
			expiry: number | null;
		}>;
	} | null>(null);

	const consultarEstado = useMutation({
		mutationFn: () =>
			client.getContractSigningStatus({ contractId: contract.id }),
		onSuccess: (data) => {
			setEstadoWeeTrust(data);
			const firmados = data.signatories.filter((f) => f.isSigned).length;
			toast.success(
				`${firmados} de ${data.signatories.length} firmaron (${data.status})`,
			);
			onUpdate?.();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const reenviarCorreo = useMutation({
		mutationFn: () =>
			client.resendContractSigningEmails({ contractId: contract.id }),
		onSuccess: (data) => toast.success(data.message),
		onError: (error: Error) => toast.error(error.message),
	});

	const ocupado = consultarEstado.isPending || reenviarCorreo.isPending;

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
						{firmaEnPapel && (
							<Badge
								variant="outline"
								className="border-amber-500/50 bg-amber-500/20 text-amber-700 dark:text-amber-400"
							>
								Firma en papel
							</Badge>
						)}
						{!firmaEnPapel && contract.clientSigningLink && (
							<Badge
								variant="outline"
								className={statusConfig[contract.status].color}
							>
								{statusConfig[contract.status].label}
							</Badge>
						)}
						{canCreateLegal && onReplace && (
							<Button
								size="sm"
								variant="outline"
								onClick={onReplace}
								className="h-8"
								title={
									firmaEnPapel
										? "Subí el PDF corregido: reemplaza a este."
										: "Subí el PDF corregido: reemplaza a este y emite enlaces de firma nuevos."
								}
							>
								<FileUp className="mr-1 h-3 w-3" />
								Reemplazar
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

				{firmaEnPapel && (
					<div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 text-sm dark:text-amber-400">
						Se firma en papel. Imprimí el PDF y que lo firme el vendedor: este
						documento no se sube a firma electrónica.
					</div>
				)}

				{/* Enlaces de firma, uno por firmante y con su rol real */}
				{!firmaEnPapel && firmantes.length > 0 && (
					<div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
						<p className="font-medium text-muted-foreground text-xs">
							Enlaces de firma
						</p>

						{firmantes.map((firmante) => (
							<div
								key={firmante.clave}
								className="flex items-center justify-between gap-2 rounded border-blue-500 border-l-2 bg-blue-500/10 px-2 py-1.5"
							>
								<div className="min-w-0">
									<p className="font-medium text-blue-600 text-xs dark:text-blue-400">
										{firmante.etiqueta}
										{firmante.estado === "signed" && " · firmado"}
									</p>
									{firmante.nombre && (
										<p className="truncate text-muted-foreground text-xs">
											{firmante.nombre}
										</p>
									)}
								</div>
								{firmante.url ? (
									<div className="flex shrink-0 gap-1">
										<Button
											size="sm"
											variant="ghost"
											className="h-6 px-2"
											onClick={() => openLink(firmante.url as string)}
										>
											<ExternalLink className="h-3 w-3" />
										</Button>
										<Button
											size="sm"
											variant="ghost"
											className="h-6 px-2"
											onClick={() =>
												copyToClipboard(
													firmante.url as string,
													`Link de ${firmante.etiqueta}`,
												)
											}
										>
											<Copy className="h-3 w-3" />
										</Button>
									</div>
								) : (
									<span className="shrink-0 text-muted-foreground text-xs">
										sin link
									</span>
								)}
							</div>
						))}
					</div>
				)}

				{/* Estado de firma y reintentos, sin salir del CRM */}
				{!firmaEnPapel && firmantes.length > 0 && (
					<div className="space-y-2 rounded-lg border border-border p-3">
						<div className="flex flex-wrap gap-2">
							<Button
								size="sm"
								variant="outline"
								className="h-7"
								disabled={ocupado}
								onClick={() => consultarEstado.mutate()}
							>
								{consultarEstado.isPending ? (
									<Loader2 className="mr-1 h-3 w-3 animate-spin" />
								) : (
									<Search className="mr-1 h-3 w-3" />
								)}
								Ver estado
							</Button>

							{canCreateLegal && (
								<>
									<Button
										size="sm"
										variant="outline"
										className="h-7"
										disabled={ocupado}
										onClick={() => reenviarCorreo.mutate()}
										title="Reenvía el correo de firma a los firmantes pendientes."
									>
										{reenviarCorreo.isPending ? (
											<Loader2 className="mr-1 h-3 w-3 animate-spin" />
										) : (
											<Mail className="mr-1 h-3 w-3" />
										)}
										Reenviar correo
									</Button>
								</>
							)}
						</div>

						{estadoWeeTrust && (
							<div className="space-y-1">
								<p className="text-muted-foreground text-xs">
									Estado de la firma: {estadoWeeTrust.status}
								</p>
								{estadoWeeTrust.signatories.map((firmante) => (
									<p
										key={firmante.emailID}
										className="flex items-center justify-between gap-2 text-xs"
									>
										<span className="truncate">
											{firmante.name || firmante.emailID}
										</span>
										<span
											className={
												firmante.isSigned
													? "shrink-0 text-green-600 dark:text-green-400"
													: "shrink-0 text-muted-foreground"
											}
										>
											{firmante.isSigned ? "firmado" : "pendiente"}
											{!firmante.isSigned &&
												firmante.expiry &&
												firmante.expiry < Date.now() &&
												" · link vencido"}
										</span>
									</p>
								))}
							</div>
						)}
					</div>
				)}

				{/* PDF del contrato */}
				{contract.pdfLink && (
					<div className="rounded-lg border border-border bg-amber-500/10 p-3">
						<div className="flex items-center justify-between gap-2">
							<p className="font-medium text-amber-600 text-sm dark:text-amber-400">
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
