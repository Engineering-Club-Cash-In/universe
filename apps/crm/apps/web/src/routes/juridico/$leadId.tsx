import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Plus, User } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { ContractsList } from "@/components/juridico/ContractsList";
import { CreateContractModal } from "@/components/juridico/CreateContractModal";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useJuridicoPermissions } from "@/hooks/usePermissions";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/juridico/$leadId")({
	validateSearch: z.object({
		opportunityId: z.string().uuid().optional(),
	}).optional(),
	component: RouteComponent,
});

function RouteComponent() {
	const { leadId } = Route.useParams();
	const searchParams = Route.useSearch();
	const navigate = Route.useNavigate();
	const {
		canViewLegal,
		canCreateLegal,
		isLoading: isLoadingPermissions,
	} = useJuridicoPermissions();

	const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
	const [contractToEdit, setContractToEdit] = useState<{
		id: string;
		contractType: string;
		contractName: string;
		clientSigningLink: string | null;
		representativeSigningLink: string | null;
		additionalSigningLinks: string[] | null;
		opportunityId: string | null;
	} | null>(null);
	const [opportunityInfo, setOpportunityInfo] = useState<{
		id: string;
		title: string;
		value: string | null;
	} | null>(null);

	const opportunityId = searchParams?.opportunityId;

	// Obtener información del lead
	const {
		data: leadInfo,
		isLoading: isLoadingLead,
	} = useQuery({
		...orpc.getLeadById.queryOptions({ input: { leadId } }),
		enabled: canViewLegal && !!leadId,
	});

	// Obtener contratos del lead
	const {
		data: contracts,
		isLoading: isLoadingContracts,
		refetch,
	} = useQuery({
		...orpc.listLegalContractsByOpportunity.queryOptions({ input: { opportunityId: opportunityId ?? "" } }),
		enabled: canViewLegal && !!opportunityId,
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
						</div>
					</div>

					{canCreateLegal && (
						<Button onClick={() => setIsCreateModalOpen(true)}>
							<Plus className="mr-2 h-4 w-4" />
							Registrar Contrato
						</Button>
					)}
				</div>
			</div>

			{/* Información del lead */}
			{leadInfo && (
				<Card>
					<CardHeader>
						<CardTitle>Información de Contacto</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="grid gap-4 md:grid-cols-2">
							<div>
								<p className="font-medium text-muted-foreground text-sm">
									Email
								</p>
								<p className="mt-1">{leadInfo.email || "No disponible"}</p>
							</div>
							<div>
								<p className="font-medium text-muted-foreground text-sm">
									Teléfono
								</p>
								<p className="mt-1">{leadInfo.phone || "No disponible"}</p>
							</div>
						</div>
					</CardContent>
				</Card>
			)}

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
		</div>
	);
}
