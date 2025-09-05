import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
	CalendarClock,
	DollarSign,
	FileText,
	Mail,
	MessageCircle,
	Phone,
	TrendingDown,
	TrendingUp,
	Users,
	Car,
	MapPin,
	Shield,
	AlertCircle,
	CheckCircle2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import { PERMISSIONS } from "server/src/types/roles";
import { ContactoModal } from "@/components/contacto-modal";

export const Route = createFileRoute("/cobros/")({
	component: RouteComponent,
});

function RouteComponent() {
	const { data: session } = authClient.useSession();
	const navigate = useNavigate();
	
	// Obtener estadísticas del dashboard
	const dashboardStats = useQuery({
		...orpc.getCobrosDashboardStats.queryOptions(),
		enabled: !!session,
	})

	// Obtener todos los contratos (al día, en mora, incobrables)
	const todosLosContratos = useQuery({
		...orpc.getTodosLosContratos.queryOptions({
			input: {
				limit: 20,
				offset: 0,
			}
		}),
		enabled: !!session,
	})


	const userProfile = useQuery({
		...orpc.getUserProfile.queryOptions(),
		enabled: !!session,
	})

	const userRole = userProfile.data?.role;

	// Verificar permisos
	if (!userRole || !PERMISSIONS.canAccessCobros(userRole)) {
		return (
			<div className="container mx-auto p-6">
				<div className="text-center">
					<h1 className="text-2xl font-bold text-gray-900 mb-4">
						Acceso Denegado
					</h1>
					<p className="text-gray-600">
						No tienes permisos para acceder a la sección de cobros.
					</p>
				</div>
			</div>
		)
	}

	const stats = dashboardStats.data?.estatusStats || [];
	const contratos = todosLosContratos.data || [];

	// Crear embudo visual de estados
	const embudoEstados = [
		{ 
			key: "al_dia", 
			label: "Al Día", 
			color: "bg-green-100 text-green-800",
			icon: CheckCircle2
		},
		{ 
			key: "mora_30", 
			label: "Mora 30", 
			color: "bg-yellow-100 text-yellow-800",
			icon: AlertCircle
		},
		{ 
			key: "mora_60", 
			label: "Mora 60", 
			color: "bg-orange-100 text-orange-800",
			icon: AlertCircle
		},
		{ 
			key: "mora_90", 
			label: "Mora 90", 
			color: "bg-red-100 text-red-800",
			icon: AlertCircle
		},
		{ 
			key: "mora_120", 
			label: "Mora 120", 
			color: "bg-red-200 text-red-900",
			icon: AlertCircle
		},
		{ 
			key: "incobrable", 
			label: "Incobrable", 
			color: "bg-gray-100 text-gray-800",
			icon: FileText
		},
		{ 
			key: "completado", 
			label: "Completado", 
			color: "bg-blue-100 text-blue-800",
			icon: CheckCircle2
		}
	]

	const getEstadoStats = (estado: string) => {
		return stats.find(s => s.estadoMora === estado) || { totalCases: 0, montoTotal: "0" };
	}

	return (
		<div className="container mx-auto p-6 space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold">Dashboard de Cobros</h1>
					<p className="text-muted-foreground">
						Gestión y seguimiento de cobranza
					</p>
				</div>
			</div>

			{/* Estadísticas Generales */}
			<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							Total Casos Asignados
						</CardTitle>
						<Users className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{dashboardStats.data?.totalCasosAsignados || 0}
						</div>
						<p className="text-xs text-muted-foreground">
							Casos bajo tu responsabilidad
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							Contactos Hoy
						</CardTitle>
						<Phone className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{dashboardStats.data?.contactosHoy || 0}
						</div>
						<p className="text-xs text-muted-foreground">
							Interacciones realizadas hoy
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							Monto Total en Mora
						</CardTitle>
						<DollarSign className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							Q{stats.reduce((sum, s) => sum + Number(s.montoTotal || 0), 0).toLocaleString()}
						</div>
						<p className="text-xs text-muted-foreground">
							Suma de todos los montos en mora
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							Efectividad
						</CardTitle>
						<TrendingUp className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">85%</div>
						<p className="text-xs text-muted-foreground">
							Tasa de recuperación mensual
						</p>
					</CardContent>
				</Card>
			</div>

			{/* Embudo Visual de Estados */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<TrendingDown className="h-5 w-5" />
						Embudo de Cobranza
					</CardTitle>
					<CardDescription>
						Distribución de casos por estado de mora
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
						{embudoEstados.map((estado) => {
							const stats = getEstadoStats(estado.key);
							const Icon = estado.icon;
							
							return (
								<div key={estado.key} className="text-center">
									<Card className="border-2 hover:shadow-md transition-shadow cursor-pointer">
										<CardContent className="p-4">
											<div className="flex flex-col items-center gap-2">
												<Icon className="h-8 w-8 text-muted-foreground" />
												<Badge className={estado.color}>
													{estado.label}
												</Badge>
												<div className="text-2xl font-bold">
													{stats.totalCases}
												</div>
												<div className="text-sm text-muted-foreground">
													Q{Number(stats.montoTotal || 0).toLocaleString()}
												</div>
											</div>
										</CardContent>
									</Card>
								</div>
							)
						})}
					</div>
				</CardContent>
			</Card>

			{/* Lista de Casos Recientes */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<FileText className="h-5 w-5" />
						Casos Recientes
					</CardTitle>
					<CardDescription>
						Últimos casos de cobranza asignados
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="space-y-4">
						{contratos.length === 0 ? (
							<div className="text-center py-8">
								<FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
								<p className="text-muted-foreground">
									No hay contratos de financiamiento
								</p>
							</div>
						) : (
							contratos.slice(0, 10).map((contrato) => {
								// Determinar estado visual según el tipo de contrato
								const estadoVisual = contrato.estadoContrato === "activo" 
									? (contrato.estadoMora || "al_dia")
									: contrato.estadoContrato;
								
								const esAlDia = estadoVisual === "al_dia" || (!contrato.casoCobroId && contrato.estadoContrato === "activo");
								const linkId = contrato.casoCobroId || contrato.contratoId;
								const tipoLink = contrato.casoCobroId ? "caso" : "contrato";
								
								return (
								<div
									key={contrato.contratoId}
									className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
								>
									<div className="space-y-2">
										<div className="flex items-center gap-4">
											<div className="flex items-center gap-2">
												<Car className="h-4 w-4 text-muted-foreground" />
												<span className="font-medium">
													{contrato.vehiculoMarca} {contrato.vehiculoModelo} {contrato.vehiculoYear}
												</span>
												<Badge variant="outline">
													{contrato.vehiculoPlaca}
												</Badge>
											</div>
											<Badge className={
												estadoVisual === 'al_dia' ? 'bg-green-100 text-green-800' :
												estadoVisual === 'mora_30' ? 'bg-yellow-100 text-yellow-800' :
												estadoVisual === 'mora_60' ? 'bg-orange-100 text-orange-800' :
												estadoVisual === 'mora_90' ? 'bg-red-100 text-red-800' :
												estadoVisual === 'mora_120' ? 'bg-red-200 text-red-900' :
												estadoVisual === 'incobrable' ? 'bg-gray-100 text-gray-800' :
												estadoVisual === 'completado' ? 'bg-blue-100 text-blue-800' :
												'bg-gray-100 text-gray-800'
											}>
												{esAlDia ? "AL DÍA" : estadoVisual?.replace('_', ' ')?.toUpperCase()}
											</Badge>
										</div>
										<div className="flex items-center gap-4 text-sm text-muted-foreground">
											<div className="flex items-center gap-1">
												<Users className="h-3 w-3" />
												{contrato.clienteNombre}
											</div>
											<div className="flex items-center gap-1">
												<DollarSign className="h-3 w-3" />
												Q{Number(contrato.montoEnMora).toLocaleString()}
											</div>
											<div className="flex items-center gap-1">
												<CalendarClock className="h-3 w-3" />
												{contrato.diasMoraMaximo} días
											</div>
										</div>
									</div>
									
									<div className="flex items-center gap-2">
										{/* Botones de contacto solo para casos activos */}
										{contrato.casoCobroId && !esAlDia && (
											<>
												<ContactoModal
													casoCobroId={contrato.casoCobroId}
													clienteNombre={contrato.clienteNombre || ""}
													telefonoPrincipal={contrato.telefonoPrincipal || ""}
													metodoInicial="llamada"
												>
													<Button variant="outline" size="sm">
														<Phone className="h-4 w-4" />
													</Button>
												</ContactoModal>

												<ContactoModal
													casoCobroId={contrato.casoCobroId}
													clienteNombre={contrato.clienteNombre || ""}
													telefonoPrincipal={contrato.telefonoPrincipal || ""}
													metodoInicial="whatsapp"
												>
													<Button variant="outline" size="sm">
														<MessageCircle className="h-4 w-4" />
													</Button>
												</ContactoModal>

												<ContactoModal
													casoCobroId={contrato.casoCobroId}
													clienteNombre={contrato.clienteNombre || ""}
													telefonoPrincipal={contrato.telefonoPrincipal || ""}
													metodoInicial="email"
												>
													<Button variant="outline" size="sm">
														<Mail className="h-4 w-4" />
													</Button>
												</ContactoModal>
											</>
										)}

										<Button 
											variant="outline" 
											size="sm"
											onClick={() => navigate({ 
												to: "/cobros/$id", 
												params: { id: linkId },
												search: { tipo: tipoLink }
											})}
										>
											Ver Detalles
										</Button>
									</div>
								</div>
								)
							})
						)}
					</div>
				</CardContent>
			</Card>
		</div>
	)
}