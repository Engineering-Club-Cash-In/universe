import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowLeft,
	CheckCircle,
	Loader2,
	Plus,
	RefreshCw,
	User,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ApproveOpportunityModal } from "@/components/juridico/ApproveOpportunityModal";
import { ContractsList } from "@/components/juridico/ContractsList";
import { CreateContractModal } from "@/components/juridico/CreateContractModal";
import { RegenerateContractsModal } from "@/components/juridico/RegenerateContractsModal";
import {
	OpportunityDetailModal,
	type OpportunityForModal,
} from "@/components/opportunity-detail-modal";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useJuridicoPermissions } from "@/hooks/usePermissions";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/juridico/$leadId")({
	validateSearch: z
		.object({
			opportunityId: z.string().uuid().optional(),
		})
		.optional(),
	component: RouteComponent,
});

function RouteComponent() {
	const { leadId } = Route.useParams();
	const searchParams = Route.useSearch();
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();
	const {
		canViewLegal,
		canCreateLegal,
		canApproveLegalStage,
		isLoading: isLoadingPermissions,
	} = useJuridicoPermissions();

	const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
	const [isOpportunityModalOpen, setIsOpportunityModalOpen] = useState(false);
	const [isApproveModalOpen, setIsApproveModalOpen] = useState(false);
	const [isRegenerateModalOpen, setIsRegenerateModalOpen] = useState(false);
	const [deletingContractId, setDeletingContractId] = useState<string | null>(
		null,
	);
	const [contractToEdit, setContractToEdit] = useState<{
		id: string;
		contractType: string;
		contractName: string;
		clientSigningLink: string | null;
		representativeSigningLink: string | null;
		additionalSigningLinks: string[] | null;
		pdfLink?: string | null;
		opportunityId: string | null;
	} | null>(null);
	const [opportunityInfo, setOpportunityInfo] = useState<{
		id: string;
		title: string;
		value: string | null;
	} | null>(null);

	const opportunityId = searchParams?.opportunityId;

	// Mutación para aprobar oportunidad (mover a 90%)
	const approveMutation = useMutation({
		mutationFn: async (opportunityId: string) => {
			return await client.approveOpportunityLegal({ opportunityId });
		},
		onSuccess: (data) => {
			toast.success(data.message);
			queryClient.invalidateQueries({
				queryKey: ["getOpportunitiesForContracts"],
			});
			// Regresar a la página de jurídico
			navigate({ to: "/juridico" });
		},
		onError: (error: Error) => {
			toast.error(error.message || "Error al aprobar la oportunidad");
		},
	});

	// Mutación para eliminar contrato
	const deleteMutation = useMutation({
		mutationFn: async (contractId: string) => {
			return await client.deleteLegalContract({ contractId });
		},
		onSuccess: () => {
			toast.success("Contrato eliminado correctamente");
			refetch();
		},
		onError: (error: Error) => {
			toast.error(error.message || "Error al eliminar el contrato");
		},
		onSettled: () => {
			setDeletingContractId(null);
		},
	});

	const handleDeleteContract = async (contractId: string) => {
		setDeletingContractId(contractId);
		await deleteMutation.mutateAsync(contractId);
	};

	// Obtener información del lead
	const { data: leadInfo, isLoading: isLoadingLead } = useQuery({
		...orpc.getLeadById.queryOptions({ input: { leadId } }),
		enabled: canViewLegal && !!leadId,
	});

	// Obtener contratos del lead
	const {
		data: contracts,
		isLoading: isLoadingContracts,
		refetch,
	} = useQuery({
		...orpc.listLegalContractsByOpportunity.queryOptions({
			input: { opportunityId: opportunityId ?? "" },
		}),
		enabled: canViewLegal && !!opportunityId,
	});

	// Obtener detalle completo de la oportunidad
	const { data: opportunitiesData } = useQuery({
		...orpc.getOpportunities.queryOptions({
			input: { opportunityId: opportunityId ?? "" },
		}),
		enabled: canViewLegal && !!opportunityId,
	});

	// Obtener snapshot de generación para poder regenerar
	const { data: generationSnapshot } = useQuery({
		...orpc.getGenerationSnapshot.queryOptions({
			input: { opportunityId: opportunityId ?? "" },
		}),
		enabled: canViewLegal && !!opportunityId,
	});

	// Mutación para regenerar contratos
	const regenerateMutation = useMutation({
		mutationFn: async ({
			contractTypes,
			newDate,
		}: {
			contractTypes: string[];
			newDate: Date;
		}) => {
			if (!opportunityId || !generationSnapshot) {
				throw new Error("No hay datos de generación disponibles");
			}
			return await client.regenerateContracts({
				opportunityId,
				leadId,
				contractTypes,
				newDate,
				generationData: generationSnapshot.data as Array<{
					contractType: string;
					data: Record<string, string>;
					emails?: string[];
					options: {
						gender: "male" | "female";
						generatePdf: boolean;
						filenamePrefix: string;
					};
				}>,
			});
		},
		onSuccess: (data) => {
			toast.success(data.message);
			refetch();
			queryClient.invalidateQueries({
				queryKey: ["getGenerationSnapshot"],
			});
		},
		onError: (error: Error) => {
			toast.error(error.message || "Error al regenerar contratos");
		},
	});

	// Redireccionar si no tiene permisos
	if (!isLoadingPermissions && !canViewLegal) {
		navigate({ to: "/dashboard" });
		return null;
	}

	const isLoading = isLoadingLead || isLoadingContracts;

	const handleEdit = (
		contract: {
			id: string;
			contractType: string;
			contractName: string;
			clientSigningLink: string | null;
			representativeSigningLink: string | null;
			additionalSigningLinks: string[] | null;
			pdfLink?: string | null;
			opportunityId: string | null;
		},
		opportunity?: { id: string; title: string; value: string | null } | null,
	) => {
		setContractToEdit(contract);
		setOpportunityInfo(opportunity || null);
		setIsCreateModalOpen(true);
	};

	const handleCloseModal = (open: boolean) => {
		setIsCreateModalOpen(open);
		if (!open) {
			setContractToEdit(null);
			setOpportunityInfo(null);
		}
	};

	const handleOpenOpportunityModal = () => {
		setIsOpportunityModalOpen(true);
	};

	const handleCloseOpportunityModal = (open: boolean) => {
		setIsOpportunityModalOpen(open);
	};

	// Obtener datos de la oportunidad desde el endpoint
	const opportunityData =
		opportunitiesData && opportunitiesData.length > 0
			? opportunitiesData[0]
			: null;

	// Transformar datos de oportunidad para el modal
	const selectedOpportunity: OpportunityForModal | null = opportunityData
		? {
				id: opportunityData.id,
				title: opportunityData.title,
				value: opportunityData.value,
				creditType: opportunityData.creditType,
				status: opportunityData.status,
				expectedCloseDate: opportunityData.expectedCloseDate,
				createdAt: opportunityData.createdAt,
				lead: opportunityData.lead
					? {
							id: opportunityData.lead.id,
							firstName: opportunityData.lead.firstName,
							lastName: opportunityData.lead.lastName,
							dpi: null,
							email: opportunityData.lead.email,
							phone: null,
						}
					: null,
				stage: opportunityData.stage,
				assignedUser: opportunityData.assignedUser,
				vehicle: opportunityData.vehicle?.id
					? {
							id: opportunityData.vehicle.id,
							make: opportunityData.vehicle.make,
							model: opportunityData.vehicle.model,
							year: opportunityData.vehicle.year,
							licensePlate: opportunityData.vehicle.licensePlate,
							color: opportunityData.vehicle.color,
							isNew: opportunityData.vehicle.isNew,
						}
					: null,
			}
		: null;

	if (isLoading) {
		return (
			<div className="container mx-auto flex min-h-[400px] items-center justify-center py-8">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="container mx-auto space-y-6 py-8">
			{/* Header con breadcrumb */}
			<div className="space-y-4">
				<Link
					to="/juridico"
					className="inline-flex items-center text-muted-foreground text-sm hover:text-foreground"
				>
					<ArrowLeft className="mr-2 h-4 w-4" />
					Volver a Jurídico
				</Link>

				<div className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						<div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100">
							<User className="h-6 w-6 text-blue-600" />
						</div>
						<div>
							<h1 className="font-bold text-3xl">
								{leadInfo
									? `${leadInfo.firstName} ${leadInfo.lastName}`
									: "Lead"}
							</h1>
							{leadInfo && (
								<p className="text-muted-foreground">
									DPI: {leadInfo.dpi || "No disponible"}
								</p>
							)}
							{opportunityData && (
								<Button
									variant="link"
									size="sm"
									className="h-auto p-0 text-primary"
									onClick={handleOpenOpportunityModal}
								>
									Ver detalle de oportunidad →
								</Button>
							)}
						</div>
					</div>

					<div className="flex gap-2">
						{canCreateLegal &&
							generationSnapshot &&
							contracts &&
							contracts.length > 0 && (
								<Button
									variant="outline"
									onClick={() => setIsRegenerateModalOpen(true)}
								>
									<RefreshCw className="mr-2 h-4 w-4" />
									Regenerar con nueva fecha
								</Button>
							)}
						{canCreateLegal && (
							<Button onClick={() => setIsCreateModalOpen(true)}>
								<Plus className="mr-2 h-4 w-4" />
								Registrar Contrato
							</Button>
						)}
					</div>
				</div>
			</div>

			{/* Grid superior: Información de contacto + Card de aprobación */}
			<div className="grid gap-4 md:grid-cols-2">
				{/* Información del lead */}
				{leadInfo && (
					<Card>
						<CardHeader className="pb-3">
							<CardTitle className="text-base">
								Información de Contacto
							</CardTitle>
						</CardHeader>
						<CardContent className="pt-0">
							<div className="grid gap-3 sm:grid-cols-2">
								<div>
									<p className="font-medium text-muted-foreground text-xs">
										Email
									</p>
									<p className="text-sm">{leadInfo.email || "No disponible"}</p>
								</div>
								<div>
									<p className="font-medium text-muted-foreground text-xs">
										Teléfono
									</p>
									<p className="text-sm">{leadInfo.phone || "No disponible"}</p>
								</div>
							</div>
						</CardContent>
					</Card>
				)}

				{/* Card para enviar a análisis */}
				{canApproveLegalStage &&
					opportunityData &&
					opportunityData.stage?.closurePercentage === 80 && (
						<Card className="border-green-200 bg-green-50">
							<CardContent className="flex h-full flex-col justify-center py-4">
								<div className="flex flex-col gap-3">
									<div className="flex items-center gap-2">
										<div className="rounded-full bg-green-100 p-1.5">
											<CheckCircle className="h-4 w-4 text-green-600" />
										</div>
										<h4 className="font-semibold text-green-800 text-sm">
											¿Listo para enviar a análisis?
										</h4>
									</div>
									<p className="text-green-700 text-xs">
										Cuando todos los contratos estén completos y verificados,
										avanza la oportunidad a la siguiente etapa.
									</p>
									<Button
										onClick={() => setIsApproveModalOpen(true)}
										disabled={
											approveMutation.isPending ||
											!contracts ||
											contracts.length === 0
										}
										size="sm"
										className="w-full bg-green-600 text-white hover:bg-green-700"
									>
										<CheckCircle className="mr-2 h-4 w-4" />
										Contratos Completados
									</Button>
								</div>
							</CardContent>
						</Card>
					)}
			</div>

			{/* Lista de contratos */}
			<Card>
				<CardHeader>
					<CardTitle>Contratos Legales</CardTitle>
					<CardDescription>
						{contracts && contracts.length > 0
							? `${contracts.length} contrato${contracts.length > 1 ? "s" : ""} registrado${contracts.length > 1 ? "s" : ""}`
							: "No hay contratos registrados para esta persona"}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<ContractsList
						contracts={contracts || []}
						onUpdate={refetch}
						onEdit={canCreateLegal ? handleEdit : undefined}
						onDelete={canCreateLegal ? handleDeleteContract : undefined}
						deletingContractId={deletingContractId}
					/>
				</CardContent>
			</Card>

			{/* Modal para crear contrato */}
			<CreateContractModal
				leadId={leadId}
				open={isCreateModalOpen}
				onOpenChange={handleCloseModal}
				onSuccess={refetch}
				preselectedOpportunityId={opportunityId}
				contractToEdit={contractToEdit || undefined}
				opportunityInfo={opportunityInfo}
			/>

			{/* Modal de detalle de oportunidad */}
			<OpportunityDetailModal
				open={isOpportunityModalOpen}
				onOpenChange={handleCloseOpportunityModal}
				opportunity={selectedOpportunity}
				userRole="juridico"
				readOnly
			/>

			{/* Modal de confirmación para aprobar */}
			<ApproveOpportunityModal
				open={isApproveModalOpen}
				onOpenChange={setIsApproveModalOpen}
				onConfirm={() => {
					if (opportunityId) {
						approveMutation.mutate(opportunityId);
						setIsApproveModalOpen(false);
					}
				}}
				isLoading={approveMutation.isPending}
				opportunityTitle={opportunityData?.title}
			/>

			{/* Modal para regenerar contratos */}
			{contracts && (
				<RegenerateContractsModal
					open={isRegenerateModalOpen}
					onOpenChange={setIsRegenerateModalOpen}
					contracts={contracts.map((c) => ({
						id: c.contract.id,
						contractType: c.contract.contractType,
						contractName: c.contract.contractName,
					}))}
					onRegenerate={async (contractTypes, newDate) => {
						await regenerateMutation.mutateAsync({ contractTypes, newDate });
					}}
					isLoading={regenerateMutation.isPending}
				/>
			)}
		</div>
	);
}
