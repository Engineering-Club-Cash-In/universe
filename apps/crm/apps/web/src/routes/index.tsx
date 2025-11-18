import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BarChart3, Building2, Clock, TrendingUp, Users } from "lucide-react";
import { useEffect } from "react";
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

export const Route = createFileRoute("/")({
	component: HomeComponent,
});

function HomeComponent() {
	const { data: session, isPending } = authClient.useSession();
	const navigate = Route.useNavigate();
	const healthCheck = useQuery(orpc.healthCheck.queryOptions());

	// Redirect to dashboard if user is already logged in
	useEffect(() => {
		if (session && !isPending) {
			navigate({ to: "/dashboard" });
		}
	}, [session, isPending, navigate]);

	return (
		<div className="container mx-auto max-w-6xl px-4 py-8">
			{/* Hero Section */}
			<div className="mb-12 text-center">
				<h1 className="mb-4 font-bold text-4xl">
					Bienvenido a Club Cash In CRM
				</h1>
				<p className="mb-8 text-muted-foreground text-xl">
					Gestiona tus prospectos, oportunidades y clientes de manera eficiente
				</p>

				{!session ? (
					<div className="flex justify-center gap-4">
						<Button size="lg" asChild>
							<Link to="/login">Iniciar Sesión</Link>
						</Button>
					</div>
				) : (
					<Button size="lg" asChild>
						<Link to="/dashboard">Ir al Tablero</Link>
					</Button>
				)}
			</div>

			{/* Features Grid */}
			<div className="mb-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Users className="h-5 w-5" />
							Gestión de Prospectos
						</CardTitle>
						<CardDescription>
							Administra y haz seguimiento a tus prospectos potenciales
						</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-muted-foreground text-sm">
							Registra, categoriza y da seguimiento a todos tus prospectos desde
							una sola plataforma.
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<TrendingUp className="h-5 w-5" />
							Oportunidades
						</CardTitle>
						<CardDescription>
							Convierte prospectos en oportunidades de negocio
						</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-muted-foreground text-sm">
							Gestiona el pipeline de ventas y aumenta tus tasas de conversión.
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Building2 className="h-5 w-5" />
							Clientes y Empresas
						</CardTitle>
						<CardDescription>
							Mantén relaciones duraderas con tus clientes
						</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-muted-foreground text-sm">
							Centraliza la información de clientes y empresas para mejorar el
							servicio.
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<BarChart3 className="h-5 w-5" />
							Reportes y Análisis
						</CardTitle>
						<CardDescription>Toma decisiones basadas en datos</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-muted-foreground text-sm">
							Genera reportes detallados y analiza el rendimiento de tu equipo.
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Clock className="h-5 w-5" />
							Seguimiento en Tiempo Real
						</CardTitle>
						<CardDescription>
							Monitorea el progreso de tus ventas
						</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-muted-foreground text-sm">
							Mantente actualizado con notificaciones y alertas en tiempo real.
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<div
								className={`h-3 w-3 rounded-full ${healthCheck.data ? "bg-green-500" : "bg-red-500"}`}
							/>
							Estado del Sistema
						</CardTitle>
						<CardDescription>Conectividad y rendimiento</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-muted-foreground text-sm">
							{healthCheck.isLoading
								? "Verificando conexión..."
								: healthCheck.data
									? "Sistema operativo y funcionando correctamente"
									: "Sistema desconectado - contacta soporte"}
						</p>
					</CardContent>
				</Card>
			</div>

			{/* Call to Action */}
			{!session && (
				<div className="rounded-lg bg-muted p-8 text-center">
					<h2 className="mb-4 font-bold text-2xl">
						¿Listo para impulsar tu negocio?
					</h2>
					<p className="mb-6 text-muted-foreground">
						Únete a Club Cash In CRM y transforma la manera en que gestionas tus
						relaciones comerciales.
					</p>
					<Button size="lg" asChild>
						<Link to="/login">Iniciar Sesión</Link>
					</Button>
				</div>
			)}
		</div>
	);
}
