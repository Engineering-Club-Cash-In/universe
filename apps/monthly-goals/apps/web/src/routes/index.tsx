import { createFileRoute } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";
import { useEffect } from "react";

export const Route = createFileRoute("/")({
	component: HomeComponent,
});

function HomeComponent() {
	const { data: session, isPending } = authClient.useSession();
	const navigate = Route.useNavigate();

	useEffect(() => {
		if (!isPending && session) {
			// If user is logged in, redirect to dashboard
			navigate({ to: "/dashboard", replace: true });
		}
	}, [session, isPending, navigate]);

	if (isPending) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="text-lg">Cargando...</div>
			</div>
		);
	}

	if (session) {
		return null; // Will redirect to dashboard
	}

	// Show landing page for non-authenticated users
	return (
		<div className="p-6">
			<div className="max-w-4xl mx-auto text-center space-y-8">
				<div className="space-y-4">
					<h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
						CCI Sync
					</h1>
					<p className="text-xl text-gray-600 dark:text-gray-400">
						Sistema de Gestión de Metas Mensuales
					</p>
					<p className="text-lg text-gray-500 dark:text-gray-500">
						Gestiona y presenta metas departamentales con seguimiento mensual, 
						jerarquía organizacional completa y generación automática de presentaciones.
					</p>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
					<div className="p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
						<h3 className="text-lg font-semibold mb-2">Gestión Organizacional</h3>
						<p className="text-gray-600 dark:text-gray-400">
							Administra departamentos, áreas y equipos de trabajo con jerarquía completa.
						</p>
					</div>
					
					<div className="p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
						<h3 className="text-lg font-semibold mb-2">Tracking de Metas</h3>
						<p className="text-gray-600 dark:text-gray-400">
							Configuración y seguimiento mensual de objetivos individuales con sistema de semáforo.
						</p>
					</div>
					
					<div className="p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
						<h3 className="text-lg font-semibold mb-2">Presentaciones Automatizadas</h3>
						<p className="text-gray-600 dark:text-gray-400">
							Generación automática de dashboards interactivos para reuniones de seguimiento.
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}
