import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Plus, User } from "lucide-react";
import { useState } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ContractsList } from "@/components/juridico/ContractsList";
import { CreateContractModal } from "@/components/juridico/CreateContractModal";
import { useJuridicoPermissions } from "@/hooks/usePermissions";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/juridico/$leadId")({
	component: RouteComponent,
});

function RouteComponent() {
	const { leadId } = Route.useParams();
	const navigate = Route.useNavigate();
	const { canViewLegal, canCreateLegal, isLoading: isLoadingPermissions } =
		useJuridicoPermissions();

	const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

	// Obtener contratos del lead
	const {
		data: contracts,
		isLoading,
		refetch,
	} = useQuery({
		...orpc.listLegalContractsByLead.queryOptions({ input: { leadId } }),
		enabled: canViewLegal && !!leadId,
	});

	// Redireccionar si no tiene permisos
	if (!isLoadingPermissions && !canViewLegal) {
		navigate({ to: "/dashboard" });
		return null;
	}

	if (isLoading) {
		return (
			<div className="container mx-auto flex min-h-[400px] items-center justify-center py-8">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	const leadInfo = contracts && contracts.length > 0 ? contracts[0].lead : null;

	return (
		<div className="container mx-auto space-y-6 py-8">
			{/* Header con breadcrumb */}
			<div className="space-y-4">
				<Link
					to="/juridico"
					className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
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
							<h1 className="text-3xl font-bold">
								{leadInfo
									? `${leadInfo.firstName} ${leadInfo.lastName}`
									: "Cargando..."}
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
								<p className="text-sm font-medium text-muted-foreground">
									Email
								</p>
								<p className="mt-1">{leadInfo.email || "No disponible"}</p>
							</div>
							<div>
								<p className="text-sm font-medium text-muted-foreground">
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
					<ContractsList contracts={contracts || []} onUpdate={refetch} />
				</CardContent>
			</Card>

			{/* Modal para crear contrato */}
			<CreateContractModal
				leadId={leadId}
				open={isCreateModalOpen}
				onOpenChange={setIsCreateModalOpen}
				onSuccess={refetch}
			/>
		</div>
	);
}
