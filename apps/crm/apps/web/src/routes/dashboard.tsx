import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	AlertCircle,
	Banknote,
	Building,
	CheckCircle,
	ClipboardList,
	DollarSign,
	FileText,
	Gavel,
	HandshakeIcon,
	Scale,
	Target,
	TrendingUp,
	Trophy,
	Users,
} from "lucide-react";
import { useEffect } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Legend,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { getRoleLabel, PERMISSIONS, ROLES } from "@/lib/roles";
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
		enabled: userProfile.data?.role === ROLES.ADMIN,
	});

	// CRM Dashboard Stats
	const crmStats = useQuery({
		...orpc.getDashboardStats.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: ["getDashboardStats", session?.user?.id, userProfile.data?.role],
	});

	// Chart data for dashboard graphs
	const chartData = useQuery({
		...orpc.getDashboardChartData.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: [
			"getDashboardChartData",
			session?.user?.id,
			userProfile.data?.role,
		],
	});

	// Cobros Dashboard Stats
	const cobrosStats = useQuery({
		...orpc.getCobrosDashboardStats.queryOptions({}),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCobros(userProfile.data.role),
		queryKey: ["getCobrosDashboardStats", userProfile.data?.role],
	});

	// Juridico Dashboard Stats - Oportunidades pendientes de contrato
	const juridicoStats = useQuery({
		...orpc.getOpportunitiesForContracts.queryOptions({}),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessJuridico(userProfile.data.role),
		queryKey: ["getOpportunitiesForContracts", userProfile.data?.role],
	});

	// Analyst Dashboard Stats - Oportunidades para análisis
	const analysisStats = useQuery({
		...orpc.getOpportunitiesForAnalysis.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessAnalysis(userProfile.data.role),
		queryKey: ["getOpportunitiesForAnalysis", userProfile.data?.role],
	});

	useEffect(() => {
		if (!session && !isPending) {
			navigate({ to: "/login" });
		}
	}, [session, isPending, navigate]);

	if (isPending || userProfile.isPending) {
		return <div>Cargando...</div>;
	}

	if (!session) {
		return null;
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
					Rol: {getRoleLabel(userRole || "")}
				</div>
			</div>

			{/* CRM Metrics */}
			{userRole === ROLES.ADMIN && crmStats.data && (
				<div className="space-y-4">
					<h2 className="font-semibold text-2xl">Resumen Global del CRM</h2>
					<div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
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
						<Card className="border-green-200 bg-green-50/50">
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="font-medium text-sm">
									Créditos Colocados
								</CardTitle>
								<Trophy className="h-4 w-4 text-green-600" />
							</CardHeader>
							<CardContent>
								<div className="font-bold text-2xl text-green-700">
									{crmStats.data.placedCount || 0}
								</div>
							</CardContent>
						</Card>
						<Card className="border-green-200 bg-green-50/50">
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="font-medium text-sm">
									Monto Colocado
								</CardTitle>
								<Banknote className="h-4 w-4 text-green-600" />
							</CardHeader>
							<CardContent>
								<div className="font-bold text-2xl text-green-700">
									Q{(crmStats.data.placedAmount || 0).toLocaleString()}
								</div>
							</CardContent>
						</Card>
					</div>
				</div>
			)}

			{userRole === ROLES.SALES && crmStats.data && (
				<div className="space-y-4">
					<h2 className="font-semibold text-2xl text-blue-600">
						Mi Rendimiento de Ventas
					</h2>
					<div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
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
								<p className="text-muted-foreground text-xs">
									En mis oportunidades
								</p>
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
						<Card className="border-green-200 bg-green-50/50">
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="font-medium text-sm">
									Mis Colocados
								</CardTitle>
								<Trophy className="h-4 w-4 text-green-600" />
							</CardHeader>
							<CardContent>
								<div className="font-bold text-2xl text-green-700">
									{crmStats.data.placedCount || 0}
								</div>
							</CardContent>
						</Card>
						<Card className="border-green-200 bg-green-50/50">
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="font-medium text-sm">
									Mi Monto Colocado
								</CardTitle>
								<Banknote className="h-4 w-4 text-green-600" />
							</CardHeader>
							<CardContent>
								<div className="font-bold text-2xl text-green-700">
									Q{(crmStats.data.placedAmount || 0).toLocaleString()}
								</div>
							</CardContent>
						</Card>
					</div>
				</div>
			)}

			{/* Sales Supervisor Dashboard */}
			{userRole === ROLES.SALES_SUPERVISOR && crmStats.data && (
				<div className="space-y-4">
					<h2 className="font-semibold text-2xl text-indigo-600">
						Panel de Supervisor de Ventas
					</h2>
					<div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="font-medium text-sm">
									Total Prospectos
								</CardTitle>
								<Users className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="font-bold text-2xl">
									{crmStats.data.teamLeads || 0}
								</div>
								<p className="text-muted-foreground text-xs">
									Prospectos del equipo
								</p>
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="font-medium text-sm">
									Total Oportunidades
								</CardTitle>
								<Target className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="font-bold text-2xl">
									{crmStats.data.teamOpportunities || 0}
								</div>
								<p className="text-muted-foreground text-xs">
									Oportunidades del equipo
								</p>
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="font-medium text-sm">
									Total Clientes
								</CardTitle>
								<HandshakeIcon className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="font-bold text-2xl">
									{crmStats.data.teamClients || 0}
								</div>
								<p className="text-muted-foreground text-xs">
									Clientes del equipo
								</p>
							</CardContent>
						</Card>
						<Card className="border-green-200 bg-green-50/50">
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="font-medium text-sm">
									Créditos Colocados
								</CardTitle>
								<Trophy className="h-4 w-4 text-green-600" />
							</CardHeader>
							<CardContent>
								<div className="font-bold text-2xl text-green-700">
									{crmStats.data.placedCount || 0}
								</div>
							</CardContent>
						</Card>
						<Card className="border-green-200 bg-green-50/50">
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="font-medium text-sm">
									Monto Colocado
								</CardTitle>
								<Banknote className="h-4 w-4 text-green-600" />
							</CardHeader>
							<CardContent>
								<div className="font-bold text-2xl text-green-700">
									Q{(crmStats.data.placedAmount || 0).toLocaleString()}
								</div>
							</CardContent>
						</Card>
					</div>
				</div>
			)}

			{/* Analyst Dashboard */}
			{userRole === ROLES.ANALYST && (
				<div className="space-y-4">
					<h2 className="font-semibold text-2xl text-purple-600">
						Panel de Análisis
					</h2>
					<div className="grid gap-4 md:grid-cols-3">
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="font-medium text-sm">
									Pendientes Análisis
								</CardTitle>
								<ClipboardList className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="font-bold text-2xl text-purple-600">
									{analysisStats.data?.data?.filter(
										(o) => o.stage?.closurePercentage === 30,
									).length || 0}
								</div>
								<p className="text-muted-foreground text-xs">
									Etapa 30% - Por analizar
								</p>
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="font-medium text-sm">
									Pendientes Desembolso
								</CardTitle>
								<Banknote className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="font-bold text-2xl text-blue-600">
									{analysisStats.data?.data?.filter(
										(o) => o.stage?.closurePercentage === 40,
									).length || 0}
								</div>
								<p className="text-muted-foreground text-xs">
									Etapa 40% - Por desembolsar
								</p>
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="font-medium text-sm">
									Total en Cola
								</CardTitle>
								<Target className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="font-bold text-2xl">
									{analysisStats.data?.total || 0}
								</div>
								<p className="text-muted-foreground text-xs">
									Oportunidades por procesar
								</p>
							</CardContent>
						</Card>
					</div>
				</div>
			)}

			{/* Cobros Dashboard */}
			{(userRole === ROLES.COBROS || userRole === ROLES.COBROS_SUPERVISOR) && (
				<div className="space-y-4">
					<h2 className="font-semibold text-2xl text-orange-600">
						Panel de Cobros
					</h2>
					{cobrosStats.isLoading ? (
						<div className="text-muted-foreground">
							Cargando estadísticas...
						</div>
					) : cobrosStats.data ? (
						<div className="grid gap-4 md:grid-cols-4">
							<Card>
								<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
									<CardTitle className="font-medium text-sm">
										Total Casos
									</CardTitle>
									<Users className="h-4 w-4 text-muted-foreground" />
								</CardHeader>
								<CardContent>
									<div className="font-bold text-2xl">
										{cobrosStats.data.totalCasosAsignados || 0}
									</div>
									<p className="text-muted-foreground text-xs">
										Casos en cartera
									</p>
								</CardContent>
							</Card>
							<Card>
								<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
									<CardTitle className="font-medium text-sm">Al Día</CardTitle>
									<CheckCircle className="h-4 w-4 text-green-500" />
								</CardHeader>
								<CardContent>
									<div className="font-bold text-2xl text-green-600">
										{cobrosStats.data.estatusStats?.find(
											(s: { estadoMora: string }) => s.estadoMora === "al_dia",
										)?.totalCases || 0}
									</div>
									<p className="text-muted-foreground text-xs">
										Casos sin mora
									</p>
								</CardContent>
							</Card>
							<Card>
								<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
									<CardTitle className="font-medium text-sm">En Mora</CardTitle>
									<AlertCircle className="h-4 w-4 text-red-500" />
								</CardHeader>
								<CardContent>
									<div className="font-bold text-2xl text-red-600">
										{(cobrosStats.data.estatusStats || [])
											.filter(
												(s: { estadoMora: string }) =>
													s.estadoMora !== "al_dia" &&
													s.estadoMora !== "completado" &&
													s.estadoMora !== "incobrable",
											)
											.reduce(
												(acc: number, s: { totalCases: number }) =>
													acc + (s.totalCases || 0),
												0,
											)}
									</div>
									<p className="text-muted-foreground text-xs">
										Casos con atraso
									</p>
								</CardContent>
							</Card>
							<Card>
								<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
									<CardTitle className="font-medium text-sm">
										Contactos Hoy
									</CardTitle>
									<Target className="h-4 w-4 text-muted-foreground" />
								</CardHeader>
								<CardContent>
									<div className="font-bold text-2xl">
										{cobrosStats.data.contactosHoy || 0}
									</div>
									<p className="text-muted-foreground text-xs">
										Gestiones realizadas
									</p>
								</CardContent>
							</Card>
						</div>
					) : (
						<Card>
							<CardContent className="pt-6">
								<p className="text-muted-foreground">
									No se pudieron cargar las estadísticas de cobros
								</p>
							</CardContent>
						</Card>
					)}
				</div>
			)}

			{/* Juridico Dashboard */}
			{userRole === ROLES.JURIDICO && (
				<div className="space-y-4">
					<h2 className="font-semibold text-2xl text-amber-600">
						Panel Jurídico
					</h2>
					<div className="grid gap-4 md:grid-cols-3">
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="font-medium text-sm">
									Sin Contrato
								</CardTitle>
								<FileText className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="font-bold text-2xl text-amber-600">
									{juridicoStats.data?.filter((o) => o.contractCount === 0)
										.length || 0}
								</div>
								<p className="text-muted-foreground text-xs">
									Pendientes de generar
								</p>
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="font-medium text-sm">
									Con Contrato
								</CardTitle>
								<CheckCircle className="h-4 w-4 text-green-500" />
							</CardHeader>
							<CardContent>
								<div className="font-bold text-2xl text-green-600">
									{juridicoStats.data?.filter((o) => o.contractCount > 0)
										.length || 0}
								</div>
								<p className="text-muted-foreground text-xs">
									Contratos generados
								</p>
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="font-medium text-sm">
									Total en Proceso
								</CardTitle>
								<Scale className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="font-bold text-2xl">
									{juridicoStats.data?.length || 0}
								</div>
								<p className="text-muted-foreground text-xs">
									Oportunidades en etapa legal
								</p>
							</CardContent>
						</Card>
					</div>
				</div>
			)}

			{/* Quick Actions */}
			<Card>
				<CardHeader>
					<CardTitle>Acciones Rápidas</CardTitle>
					<CardDescription>Tareas comunes y atajos</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
						{userRole && PERMISSIONS.canAccessCRM(userRole) && (
							<Link to="/crm/leads">
								<button className="flex w-full items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-accent">
									<Users className="h-4 w-4" />
									<span className="text-sm">Ver Prospectos</span>
								</button>
							</Link>
						)}
						{userRole && PERMISSIONS.canAccessCRM(userRole) && (
							<Link to="/crm/opportunities">
								<button className="flex w-full items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-accent">
									<Target className="h-4 w-4" />
									<span className="text-sm">Ver Oportunidades</span>
								</button>
							</Link>
						)}
						{userRole && PERMISSIONS.canAccessAnalysis(userRole) && (
							<Link to="/crm/analysis">
								<button className="flex w-full items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-accent">
									<ClipboardList className="h-4 w-4" />
									<span className="text-sm">Análisis de Crédito</span>
								</button>
							</Link>
						)}
						{userRole && PERMISSIONS.canAccessCobros(userRole) && (
							<Link to="/cobros">
								<button className="flex w-full items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-accent">
									<DollarSign className="h-4 w-4" />
									<span className="text-sm">Módulo de Cobros</span>
								</button>
							</Link>
						)}
						{userRole && PERMISSIONS.canAccessJuridico(userRole) && (
							<Link to="/juridico">
								<button className="flex w-full items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-accent">
									<Scale className="h-4 w-4" />
									<span className="text-sm">Módulo Jurídico</span>
								</button>
							</Link>
						)}
						{userRole && PERMISSIONS.canAccessAdmin(userRole) && (
							<Link to="/admin/reports">
								<button className="flex w-full items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-accent">
									<Banknote className="h-4 w-4" />
									<span className="text-sm">Ver Reportes</span>
								</button>
							</Link>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Dashboard Charts */}
			{chartData.data && (
				<div className="grid gap-4 md:grid-cols-2">
					{/* Pipeline por Etapa */}
					{chartData.data.pipeline.length > 0 && (
						<Card>
							<CardHeader>
								<CardTitle>Pipeline por Etapa</CardTitle>
								<CardDescription>
									Valor acumulado en cada etapa de ventas
								</CardDescription>
							</CardHeader>
							<CardContent>
								<ResponsiveContainer width="100%" height={300}>
									<BarChart data={chartData.data.pipeline}>
										<CartesianGrid strokeDasharray="3 3" />
										<XAxis
											dataKey="name"
											angle={-45}
											textAnchor="end"
											height={100}
											fontSize={12}
										/>
										<YAxis
											tickFormatter={(v: number) =>
												`Q${(v / 1000).toFixed(0)}k`
											}
										/>
										<Tooltip
											formatter={(value: number) =>
												`Q${value.toLocaleString()}`
											}
										/>
										<Bar dataKey="valor" name="Valor">
											{chartData.data.pipeline.map((entry, i) => (
												<Cell
													key={`pipeline-${
														// biome-ignore lint/suspicious/noArrayIndexKey: chart cell
														i
													}`}
													fill={entry.color || "#3b82f6"}
												/>
											))}
										</Bar>
									</BarChart>
								</ResponsiveContainer>
							</CardContent>
						</Card>
					)}

					{/* Ranking Vendedores por Monto Colocado */}
					{chartData.data.ranking.length > 0 && (
						<Card>
							<CardHeader>
								<CardTitle>Ranking Colocados</CardTitle>
								<CardDescription>
									Monto colocado por vendedor (etapas {"\u2265"}90%)
								</CardDescription>
							</CardHeader>
							<CardContent>
								<ResponsiveContainer width="100%" height={300}>
									<BarChart data={chartData.data.ranking} layout="vertical">
										<CartesianGrid strokeDasharray="3 3" />
										<YAxis
											dataKey="name"
											type="category"
											width={100}
											fontSize={12}
										/>
										<XAxis
											type="number"
											tickFormatter={(v: number) =>
												`Q${(v / 1000).toFixed(0)}k`
											}
										/>
										<Tooltip
											formatter={(value: number) =>
												`Q${value.toLocaleString()}`
											}
										/>
										<Bar dataKey="monto" name="Monto" fill="#22c55e" />
									</BarChart>
								</ResponsiveContainer>
							</CardContent>
						</Card>
					)}

					{/* Actividad por Vendedor */}
					{chartData.data.activity.length > 0 && (
						<Card className="md:col-span-2">
							<CardHeader>
								<CardTitle>Actividad por Vendedor</CardTitle>
								<CardDescription>
									Oportunidades abiertas vs cerradas por vendedor
								</CardDescription>
							</CardHeader>
							<CardContent>
								<ResponsiveContainer width="100%" height={300}>
									<BarChart data={chartData.data.activity}>
										<CartesianGrid strokeDasharray="3 3" />
										<XAxis dataKey="name" fontSize={12} />
										<YAxis />
										<Tooltip />
										<Legend />
										<Bar dataKey="abiertas" name="Abiertas" fill="#3b82f6" />
										<Bar dataKey="cerradas" name="Cerradas" fill="#94a3b8" />
									</BarChart>
								</ResponsiveContainer>
							</CardContent>
						</Card>
					)}
				</div>
			)}
		</div>
	);
}
