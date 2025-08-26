import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/dashboard")({
	component: RouteComponent,
});

function RouteComponent() {
	const { data: session, isPending } = authClient.useSession();
	const navigate = Route.useNavigate();
	
	const currentDate = new Date();
	const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1);
	const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());

	// Queries
	const dashboardMetrics = useQuery(
		orpc.dashboard.metrics.queryOptions({
			input: {
				month: selectedMonth,
				year: selectedYear,
			}
		})
	);
	const healthStatus = useQuery(orpc.dashboard.health.queryOptions());

	useEffect(() => {
		if (!session && !isPending) {
			navigate({ to: "/login" });
		}
	}, [session, isPending, navigate]);

	if (isPending) {
		return <div>Cargando...</div>;
	}

	if (!session) {
		return null;
	}

	const months = [
		{ value: 1, label: "Enero" },
		{ value: 2, label: "Febrero" },
		{ value: 3, label: "Marzo" },
		{ value: 4, label: "Abril" },
		{ value: 5, label: "Mayo" },
		{ value: 6, label: "Junio" },
		{ value: 7, label: "Julio" },
		{ value: 8, label: "Agosto" },
		{ value: 9, label: "Septiembre" },
		{ value: 10, label: "Octubre" },
		{ value: 11, label: "Noviembre" },
		{ value: 12, label: "Diciembre" },
	];

	const years = Array.from({ length: 5 }, (_, i) => currentDate.getFullYear() - 2 + i);
	const metrics = dashboardMetrics.data;

	return (
		<div className="p-6">
			<div className="max-w-6xl mx-auto space-y-6">
				{/* Header */}
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-3xl font-bold">Dashboard</h1>
						<p className="text-gray-600">Bienvenido, {session.user.name}</p>
					</div>
					
					<div className="flex items-end gap-4">
						<div className="space-y-2">
							<Label className="text-sm font-medium text-gray-700">Mes</Label>
							<Select
								value={selectedMonth.toString()}
								onValueChange={(value) => setSelectedMonth(parseInt(value))}
							>
								<SelectTrigger className="w-40">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{months.map((month) => (
										<SelectItem key={month.value} value={month.value.toString()}>
											{month.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-2">
							<Label className="text-sm font-medium text-gray-700">Año</Label>
							<Select
								value={selectedYear.toString()}
								onValueChange={(value) => setSelectedYear(parseInt(value))}
							>
								<SelectTrigger className="w-24">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{years.map((year) => (
										<SelectItem key={year} value={year.toString()}>
											{year}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
				</div>

				{/* Overview Metrics */}
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium text-gray-600">Total de Metas</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">{metrics?.overview.totalGoals || 0}</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium text-gray-600">Metas Completadas</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold text-green-600">{metrics?.overview.completedGoals || 0}</div>
							<div className="text-xs text-gray-500">
								{metrics?.overview.completionRate || 0}% de completitud
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium text-gray-600">Progreso Promedio</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">{metrics?.overview.avgProgress || 0}%</div>
							<Progress value={metrics?.overview.avgProgress || 0} className="mt-2" />
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium text-gray-600">Estado del Sistema</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="flex items-center gap-2">
								<div
									className={`h-3 w-3 rounded-full ${
										healthStatus.data?.status === "healthy" ? "bg-green-500" : "bg-red-500"
									}`}
								/>
								<span className="text-sm">
									{healthStatus.isLoading
										? "Verificando..."
										: healthStatus.data?.status === "healthy"
										? "Saludable"
										: "Error"}
								</span>
							</div>
							{healthStatus.data && (
								<div className="text-xs text-gray-500 mt-1">
									{healthStatus.data.users} usuarios, {healthStatus.data.departments} departamentos
								</div>
							)}
						</CardContent>
					</Card>
				</div>

				{/* Goals by Status */}
				<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
					<Card>
						<CardHeader>
							<CardTitle>Distribución por Estado</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="space-y-4">
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-2">
										<div className="w-3 h-3 bg-green-500 rounded"></div>
										<span>Exitosas (&ge;80%)</span>
									</div>
									<Badge className="bg-green-100 text-green-800">
										{metrics?.goalsByStatus.successful || 0}
									</Badge>
								</div>
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-2">
										<div className="w-3 h-3 bg-yellow-500 rounded"></div>
										<span>En Progreso (50-80%)</span>
									</div>
									<Badge className="bg-yellow-100 text-yellow-800">
										{metrics?.goalsByStatus.warning || 0}
									</Badge>
								</div>
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-2">
										<div className="w-3 h-3 bg-red-500 rounded"></div>
										<span>Necesitan Atención (&lt;50%)</span>
									</div>
									<Badge className="bg-red-100 text-red-800">
										{metrics?.goalsByStatus.danger || 0}
									</Badge>
								</div>
							</div>
						</CardContent>
					</Card>

					{/* Top Performers */}
					<Card>
						<CardHeader>
							<CardTitle>Mejores Desempeños</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="space-y-3">
								{metrics?.topPerformers.length === 0 ? (
									<p className="text-gray-500 text-center py-4">No hay datos disponibles</p>
								) : (
									metrics?.topPerformers.map((performer: any, index: number) => (
										<div key={performer.email} className="flex items-center justify-between">
											<div>
												<div className="font-medium">{performer.name}</div>
												<div className="text-xs text-gray-500">
													{performer.areaName} - {performer.departmentName}
												</div>
											</div>
											<div className="text-right">
												<div className="font-bold text-lg">{Math.round(performer.avgPercentage)}%</div>
												<div className="text-xs text-gray-500">#{index + 1}</div>
											</div>
										</div>
									))
								)}
							</div>
						</CardContent>
					</Card>
				</div>

				{/* Department Summary */}
				{(metrics?.departmentSummary.length || 0) > 0 && (
					<Card>
						<CardHeader>
							<CardTitle>Resumen por Departamento</CardTitle>
						</CardHeader>
						<CardContent>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Departamento</TableHead>
										<TableHead>Total Metas</TableHead>
										<TableHead>Progreso Promedio</TableHead>
										<TableHead>Tasa de Éxito</TableHead>
										<TableHead>Estado</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{metrics?.departmentSummary.map((dept: any) => (
										<TableRow key={dept.name}>
											<TableCell className="font-medium">{dept.name}</TableCell>
											<TableCell>{dept.goalCount}</TableCell>
											<TableCell>
												<div className="flex items-center space-x-2">
													<Progress value={dept.avgPercentage} className="flex-1" />
													<span className="text-sm font-medium">{Math.round(dept.avgPercentage)}%</span>
												</div>
											</TableCell>
											<TableCell>{Math.round(dept.successRate)}%</TableCell>
											<TableCell>
												{dept.avgPercentage >= 80 ? (
													<Badge className="bg-green-100 text-green-800">Excelente</Badge>
												) : dept.avgPercentage >= 50 ? (
													<Badge className="bg-yellow-100 text-yellow-800">Bueno</Badge>
												) : (
													<Badge className="bg-red-100 text-red-800">Necesita Mejora</Badge>
												)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</CardContent>
					</Card>
				)}
			</div>
		</div>
	);
}
