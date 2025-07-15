import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Building,
	DollarSign,
	HandshakeIcon,
	Target,
	TrendingUp,
	Users,
} from "lucide-react";
import { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/dashboard")({
	component: RouteComponent,
});

function RouteComponent() {
	const { data: session, isPending } = authClient.useSession();

	const navigate = Route.useNavigate();

	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const adminData = useQuery({
		...orpc.adminOnlyData.queryOptions(),
		enabled: userProfile.data?.role === "admin",
	});

	// CRM Dashboard Stats
	const crmStats = useQuery({
		...orpc.getDashboardStats.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			["admin", "sales"].includes(userProfile.data.role),
	});

	// Sales Stages for funnel
	const salesStages = useQuery({
		...orpc.getSalesStages.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			["admin", "sales"].includes(userProfile.data.role),
	});

	useEffect(() => {
		// Only redirect if we're absolutely sure there's no session
		// Wait a bit longer to ensure session has time to update after sign-in
		if (!session && !isPending) {
			const timer = setTimeout(() => {
				// Re-check the current session state
				const currentSession = authClient.useSession();
				if (!currentSession.data && !currentSession.isPending) {
					navigate({
						to: "/login",
					});
				}
			}, 1000); // Increased delay to 1 second

			return () => clearTimeout(timer);
		}
	}, [session, isPending, navigate]);

	if (isPending || userProfile.isPending) {
		return <div>Cargando...</div>;
	}

	const userRole = userProfile.data?.role;

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div>
				<h1 className="font-bold text-3xl">Panel de Control CRM</h1>
				<p className="text-muted-foreground">
					Bienvenido de vuelta, {session?.user.name}
				</p>
				<div className="mt-2 inline-flex items-center rounded-full border px-2.5 py-0.5 font-semibold text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
					Rol: {userRole}
				</div>
			</div>

			{/* CRM Metrics */}
			{userRole === "admin" && crmStats.data && (
				<div className="space-y-4">
					<h2 className="font-semibold text-2xl">Resumen Global del CRM</h2>
					<div className="grid gap-4 md:grid-cols-4">
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="font-medium text-sm">
									Total de Prospectos
								</CardTitle>
								<Users className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="font-bold text-2xl">
									{crmStats.data.totalLeads || 0}
								</div>
								<p className="text-muted-foreground text-xs">
									Prospectos activos
								</p>
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="font-medium text-sm">
									Oportunidades
								</CardTitle>
								<Target className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="font-bold text-2xl">
									{crmStats.data.totalOpportunities || 0}
								</div>
								<p className="text-muted-foreground text-xs">En proceso</p>
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="font-medium text-sm">
									Clientes Activos
								</CardTitle>
								<HandshakeIcon className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="font-bold text-2xl">
									{crmStats.data.totalClients || 0}
								</div>
								<p className="text-muted-foreground text-xs">
									Clientes que pagan
								</p>
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="font-medium text-sm">
									Total de Usuarios
								</CardTitle>
								<Building className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="font-bold text-2xl">
									{adminData.data?.adminStats.totalUsers || 0}
								</div>
								<p className="text-muted-foreground text-xs">
									Usuarios del sistema
								</p>
							</CardContent>
						</Card>
					</div>
				</div>
			)}

			{userRole === "sales" && crmStats.data && (
				<div className="space-y-4">
					<h2 className="font-semibold text-2xl text-blue-600">
						Mi Rendimiento de Ventas
					</h2>
					<div className="grid gap-4 md:grid-cols-3">
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="font-medium text-sm">
									Mis Prospectos
								</CardTitle>
								<Users className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="font-bold text-2xl">
									{crmStats.data.myLeads || 0}
								</div>
								<p className="text-muted-foreground text-xs">Asignados a mí</p>
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="font-medium text-sm">
									Mis Oportunidades
								</CardTitle>
								<Target className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="font-bold text-2xl">
									{crmStats.data.myOpportunities || 0}
								</div>
								<p className="text-muted-foreground text-xs">En mis oportunidades</p>
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="font-medium text-sm">
									Mis Clientes
								</CardTitle>
								<HandshakeIcon className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="font-bold text-2xl">
									{crmStats.data.myClients || 0}
								</div>
								<p className="text-muted-foreground text-xs">
									Gestionados por mí
								</p>
							</CardContent>
						</Card>
					</div>
				</div>
			)}

			{/* Sales Funnel Visualization */}
			{salesStages.data && salesStages.data.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<TrendingUp className="h-5 w-5" />
							Etapas de Oportunidades
						</CardTitle>
						<CardDescription>
							Seguir las oportunidades a través del proceso de ventas
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="space-y-3">
							{salesStages.data.map((stage) => (
								<div
									key={stage.id}
									className="flex items-center justify-between rounded-lg border p-3"
								>
									<div className="flex items-center gap-3">
										<Badge
											style={{ backgroundColor: stage.color, color: "white" }}
											className="min-w-[60px] justify-center"
										>
											{stage.closurePercentage}%
										</Badge>
										<div>
											<p className="font-medium">{stage.name}</p>
											{stage.description && (
												<p className="text-muted-foreground text-sm">
													{stage.description}
												</p>
											)}
										</div>
									</div>
									<div className="text-right">
										<p className="font-medium text-sm">Etapa {stage.order}</p>
										<p className="text-muted-foreground text-xs">
											{stage.closurePercentage}% tasa de cierre
										</p>
									</div>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			)}

			{/* Quick Actions */}
			<Card>
				<CardHeader>
					<CardTitle>Acciones Rápidas</CardTitle>
					<CardDescription>Tareas comunes de CRM y atajos</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
						<button className="flex items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-accent">
							<Users className="h-4 w-4" />
							<span className="text-sm">Agregar Nuevo Prospecto</span>
						</button>
						<button className="flex items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-accent">
							<Target className="h-4 w-4" />
							<span className="text-sm">Crear Oportunidad</span>
						</button>
						<button className="flex items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-accent">
							<Building className="h-4 w-4" />
							<span className="text-sm">Agregar Empresa</span>
						</button>
						<button className="flex items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-accent">
							<DollarSign className="h-4 w-4" />
							<span className="text-sm">Ver Reportes</span>
						</button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
