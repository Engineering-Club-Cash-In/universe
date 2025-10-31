import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText, Loader2, Scale, Search, User } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useJuridicoPermissions } from "@/hooks/usePermissions";
import { orpc } from "@/utils/orpc";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export const Route = createFileRoute("/juridico/")({
	component: RouteComponent,
});

function RouteComponent() {
	const navigate = Route.useNavigate();
	const { canViewLegal, isLoading: isLoadingPermissions } =
		useJuridicoPermissions();
	const [searchQuery, setSearchQuery] = useState("");

	// Obtener leads con contratos
	const { data: leadsWithContracts, isLoading } = useQuery({
		...orpc.getLeadsWithContracts.queryOptions(),
		enabled: canViewLegal,
	});

	// Redireccionar si no tiene permisos
	if (!isLoadingPermissions && !canViewLegal) {
		navigate({ to: "/dashboard" });
		return null;
	}

	// Filtrar leads por búsqueda
	const filteredLeads = leadsWithContracts?.filter(
		(lead) =>
			lead.firstName.toLowerCase().includes(searchQuery.toLowerCase()) ||
			lead.lastName.toLowerCase().includes(searchQuery.toLowerCase()) ||
			lead.dpi?.toLowerCase().includes(searchQuery.toLowerCase()) ||
			lead.email?.toLowerCase().includes(searchQuery.toLowerCase()),
	);

	return (
		<div className="container mx-auto space-y-6 py-8">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<div className="flex h-12 w-12 items-center justify-center rounded-lg bg-amber-100">
						<Scale className="h-6 w-6 text-amber-600" />
					</div>
					<div>
						<h1 className="text-3xl font-bold">Jurídico</h1>
						<p className="text-muted-foreground">
							Gestión de contratos y documentos legales
						</p>
					</div>
				</div>
			</div>

			{/* Stats Cards */}
			<div className="grid gap-4 md:grid-cols-3">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							Total de Personas
						</CardTitle>
						<User className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{leadsWithContracts?.length || 0}
						</div>
						<p className="text-xs text-muted-foreground">
							Con contratos registrados
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							Total de Contratos
						</CardTitle>
						<FileText className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{leadsWithContracts?.reduce(
								(sum, lead) => sum + lead.contractCount,
								0,
							) || 0}
						</div>
						<p className="text-xs text-muted-foreground">En el sistema</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							Generación Reciente
						</CardTitle>
						<FileText className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{leadsWithContracts?.filter((lead) => {
								if (!lead.latestContractDate) return false;
								const daysSince =
									(Date.now() - new Date(lead.latestContractDate).getTime()) /
									(1000 * 60 * 60 * 24);
								return daysSince <= 7;
							}).length || 0}
						</div>
						<p className="text-xs text-muted-foreground">Últimos 7 días</p>
					</CardContent>
				</Card>
			</div>

			{/* Tabla de Leads */}
			<Card>
				<CardHeader>
					<CardTitle>Personas con Contratos</CardTitle>
					<CardDescription>
						Lista de personas que tienen contratos legales registrados
					</CardDescription>

					{/* Barra de búsqueda */}
					<div className="relative">
						<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							placeholder="Buscar por nombre, DPI o email..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="pl-9"
						/>
					</div>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="flex items-center justify-center py-8">
							<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
						</div>
					) : filteredLeads && filteredLeads.length > 0 ? (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Nombre</TableHead>
									<TableHead>DPI</TableHead>
									<TableHead>Contacto</TableHead>
									<TableHead className="text-center">Contratos</TableHead>
									<TableHead>Último Contrato</TableHead>
									<TableHead className="text-right">Acciones</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{filteredLeads.map((lead) => (
									<TableRow
										key={lead.id}
										className="cursor-pointer hover:bg-muted/50"
										onClick={() =>
											navigate({ to: `/juridico/${lead.id}` })
										}
									>
										<TableCell className="font-medium">
											{lead.firstName} {lead.lastName}
										</TableCell>
										<TableCell className="font-mono text-sm">
											{lead.dpi || "N/A"}
										</TableCell>
										<TableCell>
											<div className="text-sm">
												<div>{lead.email || "Sin email"}</div>
												<div className="text-muted-foreground">
													{lead.phone || "Sin teléfono"}
												</div>
											</div>
										</TableCell>
										<TableCell className="text-center">
											<Badge variant="outline">{lead.contractCount}</Badge>
										</TableCell>
										<TableCell>
											{lead.latestContractDate ? (
												<div className="text-sm">
													<div>
														{format(
															new Date(lead.latestContractDate),
															"dd MMM yyyy",
															{ locale: es },
														)}
													</div>
													<div className="text-muted-foreground">
														{lead.latestContractName}
													</div>
												</div>
											) : (
												<span className="text-sm text-muted-foreground">
													N/A
												</span>
											)}
										</TableCell>
										<TableCell className="text-right">
											<Link
												to="/juridico/$leadId"
												params={{ leadId: lead.id }}
												className="text-sm font-medium text-primary hover:underline"
												onClick={(e) => e.stopPropagation()}
											>
												Ver detalles →
											</Link>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					) : (
						<div className="flex flex-col items-center justify-center py-12 text-center">
							<FileText className="mb-3 h-12 w-12 text-gray-400" />
							<h3 className="mb-1 text-lg font-semibold text-gray-900">
								{searchQuery
									? "No se encontraron resultados"
									: "No hay contratos registrados"}
							</h3>
							<p className="text-sm text-gray-500">
								{searchQuery
									? "Intenta con otros términos de búsqueda"
									: "Los contratos registrados aparecerán aquí"}
							</p>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
